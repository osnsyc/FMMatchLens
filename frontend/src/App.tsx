import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useTranslation } from "react-i18next"
import { motion, MotionConfig } from "framer-motion"
import {
  Coffee01Icon,
  Github01Icon,
  GlobalIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { BrandIcon } from "@/components/BrandIcon"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ScoreHeader } from "@/components/ScoreHeader"
import { PlayerComparisonPopup, SquadPanel } from "@/components/SquadPanel"
import { ThemeToggle } from "@/components/ThemeToggle"
import { useTheme } from "@/components/theme-provider"
import { useRealtimeMatch } from "@/api/realtimeMatch"
import { parseLocalArchive } from "@/api/localArchive"
import { preprocessReplayArchive } from "@/api/replay/replayPreprocessor"
import { buildInitialReplaySnapshot } from "@/api/replay/replaySession"
import type { ReplayArchive } from "@/api/replay/replayTypes"
import { changeLanguage, type SupportedLanguage } from "@/i18n"
import type {
  MatchSnapshot,
  TacticalEventFilterMode,
  TeamSide,
} from "@/types/match"
import { selectTeamDisplayColors } from "@/lib/teamColors"
import {
  pinnedPlayerMatchScopeKey,
  updatePinnedPlayer,
  type PinnedPlayersState,
} from "@/lib/pinnedPlayerSelection"
import {
  shortcutForKeyboardEvent,
  playbackToggleEventName,
  type DashboardFocusPanel,
} from "@/lib/appShortcuts"

const FormationPitch = lazy(() =>
  import("@/components/FormationPitch").then((module) => ({
    default: module.FormationPitch,
  }))
)
const MatchStatsPanel = lazy(() =>
  import("@/components/MatchStatsPanel").then((module) => ({
    default: module.MatchStatsPanel,
  }))
)
const MatchTimeline = lazy(() =>
  import("@/components/MatchTimeline").then((module) => ({
    default: module.MatchTimeline,
  }))
)
const Momentum = lazy(() =>
  import("@/components/Momentum").then((module) => ({
    default: module.Momentum,
  }))
)
const TacticalBoard = lazy(() =>
  import("@/components/TacticalBoard").then((module) => ({
    default: module.TacticalBoard,
  }))
)
const XgTimeline = lazy(() =>
  import("@/components/XgTimeline").then((module) => ({
    default: module.XgTimeline,
  }))
)
const ZonePanel = lazy(() =>
  import("@/components/ZonePanel").then((module) => ({
    default: module.ZonePanel,
  }))
)

const layoutTransition = {
  duration: 0.20,
  ease: [0.2, 0, 0, 1],
} as const

const cardTransition = {
  duration: 0.12,
  ease: [0.2, 0, 0, 1],
} as const

function AnimatedDashboardCard({
  active = true,
  tacticalBoard = false,
  children,
}: {
  active?: boolean
  tacticalBoard?: boolean
  children: ReactNode
}) {
  return (
    <motion.div
      layout
      initial={false}
      animate={{ opacity: active ? 1 : 0 }}
      transition={layoutTransition}
      aria-hidden={!active}
      inert={!active ? true : undefined}
      className={`${active ? "" : "hidden"} min-h-0 min-w-0 overflow-hidden`}
    >
      <Card
        data-tactical-board={tacticalBoard || undefined}
        className="h-full min-h-0 min-w-0 overflow-hidden p-0"
      >
        {children}
      </Card>
    </motion.div>
  )
}

export function App() {
  const { t, i18n } = useTranslation()
  const {
    settings,
    resolvedScheme,
    preset,
    schemeLocked,
    setSchemePreference,
  } = useTheme()
  const [replayMatch, setReplayMatch] = useState<MatchSnapshot | null>(null)
  const [experimentalLiveEnabled, setExperimentalLiveEnabled] = useState(false)
  const liveConnectionEnabled =
    !__ONLINE_DEMO_ENABLED__ || experimentalLiveEnabled
  const realtimeMatch = useRealtimeMatch(
    replayMatch === null && liveConnectionEnabled
  )
  const [startupArchive, setStartupArchive] = useState<ReplayArchive>()
  const [archiveError, setArchiveError] = useState("")
  const [draggingArchive, setDraggingArchive] = useState(false)
  const [isDemoLoading, setIsDemoLoading] = useState(false)
  const [focusedPanel, setFocusedPanel] = useState<DashboardFocusPanel | null>(
    null
  )
  const [isChromeHidden, setIsChromeHidden] = useState(false)
  const isTacticalFocusMode = focusedPanel === "tactical"
  const [tacticalEventFilterMode, setTacticalEventFilterMode] =
    useState<TacticalEventFilterMode>("all")
  const [tacticalPlayerIds, setTacticalPlayerIds] = useState<
    ReadonlySet<number>
  >(() => new Set())
  const [pinnedPlayers, setPinnedPlayers] = useState<PinnedPlayersState>({
    ids: {},
  })
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const demoAbortRef = useRef<AbortController | null>(null)
  const showReplayFrame = useCallback((snapshot: MatchSnapshot) => {
    setReplayMatch(snapshot)
  }, [])
  const returnToLive = useCallback(() => setReplayMatch(null), [])
  const prepareStartupArchive = useCallback(
    async (buffer: ArrayBuffer, fileName: string) => {
      if (!fileName.toLowerCase().endsWith(".fmlens")) {
        throw new Error(t("timeline.chooseArchive"))
      }
      const parsed = await parseLocalArchive(buffer, fileName)
      return preprocessReplayArchive({
        summary: parsed.archive,
        metadata: parsed.metadata,
        metadataTimeline: parsed.metadataTimeline,
        frames: parsed.frames,
      })
    },
    [t]
  )
  const showStartupArchive = useCallback(
    (archive: ReplayArchive) => {
      setStartupArchive(archive)
      setReplayMatch(
        buildInitialReplaySnapshot(archive, {
          allowLocalAssets: liveConnectionEnabled,
        })
      )
    },
    [liveConnectionEnabled]
  )
  const openStartupArchive = useCallback(
    async (file: File) => {
      demoAbortRef.current?.abort()
      demoAbortRef.current = null
      setIsDemoLoading(false)
      setDraggingArchive(false)
      setArchiveError("")
      try {
        showStartupArchive(
          await prepareStartupArchive(await file.arrayBuffer(), file.name)
        )
      } catch (error) {
        setArchiveError(
          error instanceof Error
            ? error.message
            : t("timeline.localArchiveReadFailed")
        )
      }
    },
    [prepareStartupArchive, showStartupArchive, t]
  )
  const openDemoArchive = useCallback(async () => {
    const controller = new AbortController()
    demoAbortRef.current?.abort()
    demoAbortRef.current = controller
    setArchiveError("")
    setIsDemoLoading(true)
    try {
      const response = await fetch(__DEMO_ARCHIVE_URL__, {
        signal: controller.signal,
        cache: "force-cache",
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const archive = await prepareStartupArchive(
        await response.arrayBuffer(),
        "online-demo.fmlens"
      )
      if (!controller.signal.aborted) showStartupArchive(archive)
    } catch (error) {
      if (!controller.signal.aborted) {
        setArchiveError(t("timeline.demoArchiveReadFailed"))
        console.error("Unable to load online demo archive", error)
      }
    } finally {
      if (demoAbortRef.current === controller) {
        demoAbortRef.current = null
        setIsDemoLoading(false)
      }
    }
  }, [prepareStartupArchive, showStartupArchive, t])
  useEffect(() => () => demoAbortRef.current?.abort(), [])
  const currentLanguage: SupportedLanguage =
    i18n.language === "en" ? "en" : "zh-CN"
  const handleLanguageChange = (value: string | null) => {
    if (value === "en" || value === "zh-CN") {
      void changeLanguage(value)
      document.documentElement.lang = value
    }
  }
  const sourceMatch = replayMatch ?? realtimeMatch
  const pinnedPlayerMatchScope = pinnedPlayerMatchScopeKey(sourceMatch)
  const pinnedPlayerMatchScopeRef = useRef(pinnedPlayerMatchScope)

  useLayoutEffect(() => {
    if (pinnedPlayerMatchScopeRef.current === pinnedPlayerMatchScope) return
    pinnedPlayerMatchScopeRef.current = pinnedPlayerMatchScope
    setPinnedPlayers({ ids: {} })
    setTacticalPlayerIds(new Set())
  }, [pinnedPlayerMatchScope])

  const match = useMemo(() => {
    if (!sourceMatch) return null
    const displayColors = selectTeamDisplayColors(
      sourceMatch.home.colorSource ??
        colorSourceFromCss(sourceMatch.home.color),
      sourceMatch.away.colorSource ??
        colorSourceFromCss(sourceMatch.away.color),
      {
        presetId: settings.presetId,
        resolvedScheme,
        colorVision: settings.colorVision,
        fixedTeamColors: preset.teamColors,
      }
    )
    const homeColor = displayColors.home
    const awayColor = displayColors.away
    if (
      homeColor === sourceMatch.home.color &&
      awayColor === sourceMatch.away.color
    ) {
      return sourceMatch
    }
    return {
      ...sourceMatch,
      home:
        homeColor === sourceMatch.home.color
          ? sourceMatch.home
          : { ...sourceMatch.home, color: homeColor },
      away:
        awayColor === sourceMatch.away.color
          ? sourceMatch.away
          : { ...sourceMatch.away, color: awayColor },
    }
  }, [
    sourceMatch,
    resolvedScheme,
    settings.colorVision,
    settings.presetId,
    preset,
  ])
  const hasMatch = match !== null

  const setPinnedPlayer = useCallback((side: TeamSide, playerId?: number) => {
    setPinnedPlayers((current) => updatePinnedPlayer(current, side, playerId))
  }, [])
  const setPinnedHomePlayer = useCallback(
    (playerId?: number) => setPinnedPlayer("home", playerId),
    [setPinnedPlayer]
  )
  const setPinnedAwayPlayer = useCallback(
    (playerId?: number) => setPinnedPlayer("away", playerId),
    [setPinnedPlayer]
  )
  const toggleTacticalPlayer = useCallback((playerId: number) => {
    setTacticalPlayerIds((current) => {
      const next = new Set(current)
      if (next.has(playerId)) next.delete(playerId)
      else next.add(playerId)
      return next
    })
  }, [])

  useEffect(() => {
    if (pinnedPlayers.ids.home == null && pinnedPlayers.ids.away == null) return
    const closePinnedProfiles = (event: PointerEvent) => {
      const target = event.target
      if (
        target instanceof Element &&
        target.closest(
          "[data-player-profile-popup], [data-player-comparison-popup], [data-player-profile-pin]"
        )
      )
        return
      setPinnedPlayers({ ids: {} })
    }
    document.addEventListener("pointerdown", closePinnedProfiles, true)
    return () =>
      document.removeEventListener("pointerdown", closePinnedProfiles, true)
  }, [pinnedPlayers.ids.away, pinnedPlayers.ids.home])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const shortcut = shortcutForKeyboardEvent(event)
      if (!shortcut || (shortcut.requiresMatch && !hasMatch)) return

      event.preventDefault()
      switch (shortcut.id) {
        case "zen":
          setIsChromeHidden((current) => !current)
          break
        case "matchStats":
        case "tactical":
        case "heatmap":
        case "formation": {
          const panel = shortcut.id
          setFocusedPanel((current) => (current === panel ? null : panel))
          break
        }
        case "playback":
          window.dispatchEvent(new Event(playbackToggleEventName))
          break
        case "theme":
          if (!schemeLocked) {
            setSchemePreference(resolvedScheme === "dark" ? "light" : "dark")
          }
          break
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [hasMatch, resolvedScheme, schemeLocked, setSchemePreference])

  if (!match) {
    return (
      <main className="relative flex h-svh w-full items-center justify-center overflow-hidden bg-background p-6">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_25%,color-mix(in_oklch,var(--primary)_18%,transparent),transparent_38%)]" />
        <div className="relative flex w-full max-w-lg flex-col items-center">
          <Card className="w-full overflow-hidden border-border/70 bg-card/90 p-0 shadow-2xl backdrop-blur-xl">
            <div className="flex flex-col items-center px-8 py-10 text-center sm:px-12">
              <BrandIcon className="mb-5 size-20 text-primary drop-shadow-[0_0_24px_color-mix(in_oklch,var(--primary)_55%,transparent)]" />
              <h1 className="font-fm-universe text-3xl tracking-tight text-foreground">
                FMMatchLens
              </h1>
              {__ONLINE_DEMO_ENABLED__ && (
                <label className="mt-6 flex cursor-pointer items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Switch
                    size="sm"
                    checked={experimentalLiveEnabled}
                    onCheckedChange={setExperimentalLiveEnabled}
                    aria-label={t("timeline.connectMatch")}
                  />
                  <span>{t("timeline.connectMatch")}</span>
                  <Badge variant="outline">
                    {t("timeline.experimentalBadge")}
                  </Badge>
                </label>
              )}
              <div
                className={`${__ONLINE_DEMO_ENABLED__ ? "mt-3" : "mt-6"} flex items-center gap-2 text-sm font-medium text-foreground`}
              >
                <span className="relative flex size-2.5">
                  {liveConnectionEnabled && (
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
                  )}
                  <span
                    className={`relative inline-flex size-2.5 rounded-full ${liveConnectionEnabled ? "bg-primary" : "bg-muted-foreground/40"}`}
                  />
                </span>
                {liveConnectionEnabled
                  ? t("timeline.waitingForConnection")
                  : t("timeline.enableLiveConnection")}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".fmlens,application/octet-stream"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void openStartupArchive(file)
                  event.target.value = ""
                }}
              />
              <div
                className={`mt-7 flex min-h-44 w-full max-w-sm flex-col items-center justify-center rounded-xl border border-dashed px-5 py-7 transition-colors ${draggingArchive ? "border-primary bg-primary/10" : "border-border bg-background/40"}`}
                onDragEnter={(event) => {
                  event.preventDefault()
                  setDraggingArchive(true)
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => {
                  if (
                    !event.currentTarget.contains(
                      event.relatedTarget as Node | null
                    )
                  )
                    setDraggingArchive(false)
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  const file = event.dataTransfer.files[0]
                  if (file) void openStartupArchive(file)
                  else setDraggingArchive(false)
                }}
              >
                <span className="text-xs text-muted-foreground">
                  {t("timeline.dropArchive")}
                </span>
                <div className="mt-4 flex items-center gap-3">
                  {__ONLINE_DEMO_ENABLED__ && (
                    <>
                      <Button
                        type="button"
                        size="lg"
                        variant="outline"
                        className="min-w-32"
                        disabled={isDemoLoading}
                        onClick={() => void openDemoArchive()}
                      >
                        {isDemoLoading
                          ? t("timeline.loadingDemo")
                          : t("timeline.onlineDemo")}
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        {t("timeline.archiveChoiceSeparator")}
                      </span>
                    </>
                  )}
                  <Button
                    type="button"
                    size="lg"
                    className="min-w-32"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {t("timeline.openArchive")}
                  </Button>
                </div>
              </div>
              {archiveError && (
                <p className="mt-3 text-xs text-destructive">{archiveError}</p>
              )}

              <div className="mt-6 flex items-center gap-2">
                <ThemeToggle />
                <Select
                  value={currentLanguage}
                  onValueChange={handleLanguageChange}
                >
                  <SelectTrigger
                    size="sm"
                    className="h-8 w-28"
                    aria-label={t("common.language")}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="zh-CN">{t("common.chinese")}</SelectItem>
                    <SelectItem value="en">{t("common.english")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </Card>

          <div className="mt-4 flex w-full flex-col items-center">
            <p className="text-[11px] text-muted-foreground">
              v{__APP_VERSION__} · {__APP_AUTHOR__}
            </p>
            <nav
              aria-label="FMMatchLens project links"
              className="mt-2 flex flex-wrap justify-center gap-2"
            >
              <a
                href={__AUTHOR_BLOG_URL__}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background/60 px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none"
                aria-label="Author blog"
              >
                <HugeiconsIcon
                  icon={GlobalIcon}
                  strokeWidth={1.8}
                  className="size-3.5"
                />
                Blog
              </a>
              <a
                href={__GITHUB_PROJECT_URL__}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background/60 px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none"
                aria-label="GitHub project"
              >
                <HugeiconsIcon
                  icon={Github01Icon}
                  strokeWidth={1.8}
                  className="size-3.5"
                />
                GitHub
              </a>
              <a
                href={__KOFI_URL__}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[color:color-mix(in_srgb,var(--brand-kofi)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--brand-kofi)_10%,transparent)] px-2.5 text-xs font-semibold text-[color:var(--brand-kofi)] transition-colors hover:border-[color:color-mix(in_srgb,var(--brand-kofi-hover)_60%,transparent)] hover:bg-[color:color-mix(in_srgb,var(--brand-kofi-hover)_20%,transparent)] focus-visible:ring-2 focus-visible:ring-[color:color-mix(in_srgb,var(--brand-kofi)_30%,transparent)] focus-visible:outline-none"
                aria-label={__KOFI_LABEL__}
              >
                <HugeiconsIcon
                  icon={Coffee01Icon}
                  strokeWidth={2}
                  className="size-3.5"
                />
                Ko-fi
              </a>
            </nav>
          </div>
        </div>
      </main>
    )
  }
  const homePlayers = match.players.filter((player) => player.team === "home")

  const awayPlayers = match.players.filter((player) => player.team === "away")
  const pinnedHomePlayer = homePlayers.find(
    (player) => player.id === pinnedPlayers.ids.home
  )
  const pinnedAwayPlayer = awayPlayers.find(
    (player) => player.id === pinnedPlayers.ids.away
  )
  const comparisonOpen = pinnedHomePlayer != null && pinnedAwayPlayer != null

  return (
    <main className="scrollbar-hidden h-svh w-full overflow-auto bg-background p-4 sm:p-6">
      <Suspense
        fallback={
          <div className="grid h-full place-items-center text-sm text-muted-foreground">
            {t("timeline.loadingDemo")}
          </div>
        }
      >
        <MotionConfig reducedMotion="user" transition={layoutTransition}>
          <motion.div
            data-player-profile-blur-scope
            data-chrome-hidden={isChromeHidden || undefined}
            className={`relative grid h-full min-h-0 w-full min-w-0 grid-cols-1 gap-x-2 md:min-w-[1360px] ${
              isChromeHidden
                ? "grid-rows-[minmax(0,1fr)] gap-y-0"
                : "grid-rows-[64px_minmax(0,1fr)_88px] gap-y-2"
            }`}
          >
            {/* Score header */}
            <motion.div
              data-player-profile-blur-target
              initial={false}
              animate={{
                opacity: isChromeHidden ? 0 : 1,
                y: isChromeHidden ? -4 : 0,
              }}
              transition={cardTransition}
              aria-hidden={isChromeHidden}
              inert={isChromeHidden ? true : undefined}
              layout
              className={`${isChromeHidden ? "pointer-events-none absolute inset-x-0 top-0 h-16" : "relative min-h-0"} overflow-hidden`}
            >
              <Card className="h-full min-h-0 border-transparent bg-transparent p-0 shadow-none">
                <ScoreHeader match={match} />
              </Card>
            </motion.div>

            {/* Main layout: home squad | central dashboard | away squad */}
            <motion.div
              layout
              transition={layoutTransition}
              className="grid min-h-0 min-w-0 grid-cols-1 gap-2 md:grid-cols-[minmax(260px,1fr)_minmax(0,6fr)_minmax(260px,1fr)]"
            >
              {/* Home squad */}
              <Card
                data-squad-panel
                className="min-h-0 min-w-0 overflow-hidden p-0"
              >
                <SquadPanel
                  title={match.home.name}
                  teamUid={match.home.uid}
                  side="home"
                  players={homePlayers}
                  allPlayers={match.players}
                  events={match.events}
                  teamColor={match.home.color}
                  pinnedPlayerId={pinnedHomePlayer?.id}
                  attackingOpponent={
                    pinnedPlayers.attackingSide === "away"
                      ? pinnedAwayPlayer
                      : undefined
                  }
                  profilePopupSuppressed={comparisonOpen}
                  onPinnedPlayerChange={setPinnedHomePlayer}
                  tacticalSelectionActive={
                    isTacticalFocusMode &&
                    tacticalEventFilterMode === "individual"
                  }
                  tacticalSelectedPlayerIds={tacticalPlayerIds}
                  onTacticalPlayerToggle={toggleTacticalPlayer}
                />
              </Card>

              {/* Central dashboard */}
              <motion.div
                data-dashboard-focus={focusedPanel ?? "none"}
                layout
                transition={layoutTransition}
                className={`relative grid min-h-0 min-w-0 gap-2 ${
                  focusedPanel != null
                    ? "grid-rows-1"
                    : "grid-rows-2 md:grid-rows-[minmax(0,0.8fr)_minmax(0,1.25fr)]"
                }`}
              >
                {/* Top row: momentum | xG | formation */}
                <motion.div
                  data-player-profile-blur-target
                  layout
                  initial={false}
                  animate={{
                    opacity:
                      focusedPanel != null && focusedPanel !== "formation"
                        ? 0
                        : 1,
                  }}
                  transition={cardTransition}
                  aria-hidden={
                    focusedPanel != null && focusedPanel !== "formation"
                  }
                  inert={
                    focusedPanel != null && focusedPanel !== "formation"
                      ? true
                      : undefined
                  }
                  className={`${
                    focusedPanel != null && focusedPanel !== "formation"
                      ? "hidden"
                      : "grid"
                  } min-h-0 min-w-0 grid-cols-1 gap-2 overflow-hidden ${
                    focusedPanel === "formation"
                      ? ""
                      : "md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,3fr)]"
                  }`}
                >
                  <AnimatedDashboardCard active={focusedPanel !== "formation"}>
                    <Momentum match={match} />
                  </AnimatedDashboardCard>

                  <AnimatedDashboardCard active={focusedPanel !== "formation"}>
                    <XgTimeline match={match} />
                  </AnimatedDashboardCard>

                  <AnimatedDashboardCard>
                    <FormationPitch match={match} />
                  </AnimatedDashboardCard>
                </motion.div>

                {/* Bottom row: stats | tactical board | zone */}
                <motion.div
                  data-player-profile-blur-target
                  layout
                  initial={false}
                  animate={{
                    opacity: focusedPanel === "formation" ? 0 : 1,
                  }}
                  transition={cardTransition}
                  aria-hidden={focusedPanel === "formation"}
                  inert={focusedPanel === "formation" ? true : undefined}
                  className={`${focusedPanel === "formation" ? "hidden" : "grid"} min-h-0 min-w-0 grid-cols-1 gap-2 overflow-hidden ${
                    focusedPanel == null
                      ? "md:grid-cols-[minmax(180px,2.2fr)_minmax(0,6fr)_minmax(220px,2.5fr)]"
                      : ""
                  }`}
                >
                  <AnimatedDashboardCard
                    active={
                      focusedPanel == null || focusedPanel === "matchStats"
                    }
                  >
                    <MatchStatsPanel
                      match={match}
                      isFocusMode={focusedPanel === "matchStats"}
                    />
                  </AnimatedDashboardCard>

                  <AnimatedDashboardCard
                    active={focusedPanel == null || focusedPanel === "tactical"}
                    tacticalBoard
                  >
                    <TacticalBoard
                      match={match}
                      isFocusMode={isTacticalFocusMode}
                      eventFilterMode={tacticalEventFilterMode}
                      selectedPlayerIds={tacticalPlayerIds}
                      onEventFilterModeChange={setTacticalEventFilterMode}
                    />
                  </AnimatedDashboardCard>

                  <AnimatedDashboardCard
                    active={focusedPanel == null || focusedPanel === "heatmap"}
                  >
                    <ZonePanel match={match} />
                  </AnimatedDashboardCard>
                </motion.div>
                {comparisonOpen && (
                  <PlayerComparisonPopup
                    leftPlayer={pinnedHomePlayer}
                    rightPlayer={pinnedAwayPlayer}
                    leftColor={match.home.color ?? "var(--team-home-fallback)"}
                    rightColor={match.away.color ?? "var(--team-away-fallback)"}
                  />
                )}
              </motion.div>

              {/* Away squad */}
              <Card
                data-squad-panel
                className="min-h-0 min-w-0 overflow-hidden p-0"
              >
                <SquadPanel
                  title={match.away.name}
                  teamUid={match.away.uid}
                  side="away"
                  players={awayPlayers}
                  allPlayers={match.players}
                  events={match.events}
                  teamColor={match.away.color}
                  pinnedPlayerId={pinnedAwayPlayer?.id}
                  attackingOpponent={
                    pinnedPlayers.attackingSide === "home"
                      ? pinnedHomePlayer
                      : undefined
                  }
                  profilePopupSuppressed={comparisonOpen}
                  onPinnedPlayerChange={setPinnedAwayPlayer}
                  tacticalSelectionActive={
                    isTacticalFocusMode &&
                    tacticalEventFilterMode === "individual"
                  }
                  tacticalSelectedPlayerIds={tacticalPlayerIds}
                  onTacticalPlayerToggle={toggleTacticalPlayer}
                />
              </Card>
            </motion.div>

            {/* Match timeline */}
            <motion.div
              data-player-profile-blur-target
              initial={false}
              animate={{
                opacity: isChromeHidden ? 0 : 1,
                y: isChromeHidden ? 4 : 0,
              }}
              transition={cardTransition}
              aria-hidden={isChromeHidden}
              inert={isChromeHidden ? true : undefined}
              layout
              className={`${isChromeHidden ? "pointer-events-none absolute inset-x-0 bottom-0 h-[88px]" : "relative min-h-0"} overflow-hidden`}
            >
              <Card className="h-full min-h-0 border-transparent bg-transparent p-0 shadow-none">
                <MatchTimeline
                  match={match}
                  initialLocalArchive={startupArchive}
                  localConnectionEnabled={liveConnectionEnabled}
                  onReplayFrame={showReplayFrame}
                  onLive={returnToLive}
                />
              </Card>
            </motion.div>
          </motion.div>
        </MotionConfig>
      </Suspense>
    </main>
  )
}

function colorSourceFromCss(color?: string) {
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return undefined
  return { backgroundColour: Number.parseInt(color.slice(1), 16) }
}

export default App
