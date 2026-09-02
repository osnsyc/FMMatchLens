import { useCallback, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Coffee01Icon, Github01Icon, GlobalIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { BrandIcon } from "@/components/BrandIcon"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { FormationPitch } from "@/components/FormationPitch"
import { MatchStatsPanel } from "@/components/MatchStatsPanel"
import { MatchTimeline } from "@/components/MatchTimeline"
import { Momentum } from "@/components/Momentum"
import { ScoreHeader } from "@/components/ScoreHeader"
import { SquadPanel } from "@/components/SquadPanel"
import { TacticalBoard } from "@/components/TacticalBoard"
import { ThemeToggle } from "@/components/ThemeToggle"
import { XgTimeline } from "@/components/XgTimeline"
import { ZonePanel } from "@/components/ZonePanel"
import {
  buildMatchEvents,
  buildMomentumTimeline,
  buildPositionHeatmaps,
  buildRollingMomentumTimeline,
  buildTacticalEvents,
  buildXgTimeline,
  toMatchSnapshot,
  useRealtimeMatch,
  type RealtimeFrame,
  type RealtimeMatchMetadata,
} from "@/api/realtimeMatch"
import { parseLocalArchive, type ParsedLocalArchive } from "@/api/localArchive"
import { metadataAtTick } from "@/api/archiveMetadata"
import { changeLanguage, type SupportedLanguage } from "@/i18n"
import type { MatchEvent, MatchMomentumPoint, MatchSnapshot, PlayerPositionHeatmap, TacticalEventPoint, XgTimelinePoint } from "@/types/match"

export function App() {
  const { t, i18n } = useTranslation()
  const [replayMatch, setReplayMatch] = useState<MatchSnapshot | null>(null)
  const realtimeMatch = useRealtimeMatch(replayMatch === null)
  const [startupArchive, setStartupArchive] = useState<ParsedLocalArchive>()
  const [archiveError, setArchiveError] = useState("")
  const [draggingArchive, setDraggingArchive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const showReplayFrame = useCallback((
    frame: RealtimeFrame,
    metadata: RealtimeMatchMetadata | undefined,
    xgTimeline: XgTimelinePoint[],
    events: MatchEvent[],
    positionHeatmaps: PlayerPositionHeatmap[],
    tacticalEvents: TacticalEventPoint[],
    momentum: MatchMomentumPoint[],
    rollingMomentum: MatchMomentumPoint[],
  ) => {
    setReplayMatch(toMatchSnapshot(
      frame,
      xgTimeline,
      metadata,
      events,
      positionHeatmaps,
      tacticalEvents,
      momentum,
      rollingMomentum,
    ))
  }, [])
  const returnToLive = useCallback(() => setReplayMatch(null), [])
  const openStartupArchive = useCallback(async (file: File) => {
    setDraggingArchive(false)
    setArchiveError("")
    try {
      if (!file.name.toLowerCase().endsWith(".fmlens")) {
        throw new Error(t("timeline.chooseArchive"))
      }
      const parsed = await parseLocalArchive(await file.arrayBuffer(), file.name)
      const frameIndex = 0
      const frame = parsed.frames[frameIndex]
      const frameMetadata = metadataAtTick(parsed.metadataTimeline, frame.tick)
        ?? parsed.metadataTimeline[0]
        ?? parsed.metadata
      setStartupArchive(parsed)
      setReplayMatch(toMatchSnapshot(
        frame,
        buildXgTimeline(parsed.frames, frameIndex),
        frameMetadata,
        buildMatchEvents(parsed.frames, frameIndex),
        buildPositionHeatmaps(parsed.frames, frameIndex),
        buildTacticalEvents(parsed.frames, frameIndex),
        buildMomentumTimeline(parsed.frames, frameIndex),
        buildRollingMomentumTimeline(parsed.frames, frameIndex),
      ))
    } catch (error) {
      setArchiveError(error instanceof Error ? error.message : t("timeline.localArchiveReadFailed"))
    }
  }, [t])
  const currentLanguage: SupportedLanguage = i18n.language === "en" ? "en" : "zh-CN"
  const handleLanguageChange = (value: string | null) => {
    if (value === "en" || value === "zh-CN") {
      void changeLanguage(value)
      document.documentElement.lang = value
    }
  }
  const match = replayMatch ?? realtimeMatch
  if (!match) {
    return (
      <main className="relative flex h-svh w-full items-center justify-center overflow-hidden bg-background p-6">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_25%,color-mix(in_oklch,var(--primary)_18%,transparent),transparent_38%)]" />
        <div className="relative flex w-full max-w-lg flex-col items-center">
          <Card className="w-full overflow-hidden border-border/70 bg-card/90 p-0 shadow-2xl backdrop-blur-xl">
            <div className="h-1 bg-gradient-to-r from-transparent via-primary to-transparent" />
            <div className="flex flex-col items-center px-8 py-10 text-center sm:px-12">
            <BrandIcon className="mb-5 size-20 text-primary drop-shadow-[0_0_24px_color-mix(in_oklch,var(--primary)_55%,transparent)]" />
            <h1 className="font-fm-universe text-3xl tracking-tight text-foreground">FMMatchLens</h1>
            <div className="mt-6 flex items-center gap-2 text-sm font-medium text-foreground">
              <span className="relative flex size-2.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
                <span className="relative inline-flex size-2.5 rounded-full bg-primary" />
              </span>
              {t("timeline.waitingForConnection")}
            </div>
            <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
              {t("timeline.waitingDescription")}
            </p>

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
              className={`mt-7 flex w-full flex-col items-center rounded-xl border border-dashed px-5 py-5 transition-colors ${draggingArchive ? "border-primary bg-primary/10" : "border-border bg-background/40"}`}
              onDragEnter={(event) => {
                event.preventDefault()
                setDraggingArchive(true)
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingArchive(false)
              }}
              onDrop={(event) => {
                event.preventDefault()
                const file = event.dataTransfer.files[0]
                if (file) void openStartupArchive(file)
                else setDraggingArchive(false)
              }}
            >
              <span className="text-xs text-muted-foreground">{t("timeline.dropArchive")}</span>
              <Button type="button" size="lg" className="mt-3 min-w-32" onClick={() => fileInputRef.current?.click()}>
                {t("timeline.openArchive")}
              </Button>
            </div>
            {archiveError && <p className="mt-3 text-xs text-destructive">{archiveError}</p>}

            <div className="mt-6 flex items-center gap-2">
              <ThemeToggle />
              <Select value={currentLanguage} onValueChange={handleLanguageChange}>
                <SelectTrigger size="sm" className="h-8 w-28" aria-label={t("common.language")}>
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
            <nav aria-label="FMMatchLens project links" className="mt-2 flex flex-wrap justify-center gap-2">
                <a
                  href={__AUTHOR_BLOG_URL__}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background/60 px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                  aria-label="Author blog"
                >
                  <HugeiconsIcon icon={GlobalIcon} strokeWidth={1.8} className="size-3.5" />
                  Blog
                </a>
                <a
                  href={__GITHUB_PROJECT_URL__}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background/60 px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                  aria-label="GitHub project"
                >
                  <HugeiconsIcon icon={Github01Icon} strokeWidth={1.8} className="size-3.5" />
                  GitHub
                </a>
                <a
                  href={__KOFI_URL__}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#ff5e5b]/35 bg-[#ff5e5b]/10 px-2.5 text-xs font-semibold text-[#e84d4a] transition-colors hover:border-[#ff5e5b]/60 hover:bg-[#ff5e5b]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5e5b]/30 dark:text-[#ff817f]"
                  aria-label={__KOFI_LABEL__}
                >
                  <HugeiconsIcon icon={Coffee01Icon} strokeWidth={2} className="size-3.5" />
                  Ko-fi
                </a>
            </nav>
          </div>
        </div>
      </main>
    )
  }
  const homePlayers = match.players.filter(
    (player) => player.team === "home"
  )

  const awayPlayers = match.players.filter(
    (player) => player.team === "away"
  )

  return (
    <main className="scrollbar-hidden h-svh w-full overflow-auto bg-background p-4 sm:p-6">
      <div
        data-player-profile-blur-scope
        className="
      grid h-full min-h-0 w-full min-w-0
      grid-cols-1
      grid-rows-[64px_minmax(0,1fr)_88px]
      gap-2
      md:min-w-[1360px]
    "
      >
        {/* Score header */}
        <Card data-player-profile-blur-target className="min-h-0 border-transparent bg-transparent p-0 shadow-none">
          <ScoreHeader match={match} />
        </Card>

        {/* Main layout: home squad | central dashboard | away squad */}
        <div
          className="
        grid min-h-0 min-w-0
        grid-cols-1
        gap-2
        md:grid-cols-[minmax(260px,1fr)_minmax(0,6fr)_minmax(260px,1fr)]
      "
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
            />
          </Card>

          {/* Central dashboard */}
          <div
            data-player-profile-blur-target
            className="
          grid min-h-0 min-w-0
          grid-rows-2
          gap-2
          md:grid-rows-[minmax(0,0.8fr)_minmax(0,1.25fr)]
        "
          >
            {/* Top row: momentum | xG | formation */}
            <div
              className="
            grid min-h-0 min-w-0
            grid-cols-1
            gap-2
            md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,3fr)]
          "
            >
              <Card className="min-h-0 min-w-0 overflow-hidden p-0">
                <Momentum match={match} />
              </Card>

              <Card className="min-h-0 min-w-0 overflow-hidden p-0">
                <XgTimeline match={match} />
              </Card>

              <Card className="min-h-0 min-w-0 overflow-hidden p-0">
                <FormationPitch match={match} />
              </Card>
            </div>

            {/* Bottom row: stats | tactical board | zone */}
            <div
              className="
            grid min-h-0 min-w-0
            grid-cols-1
            gap-2
            md:grid-cols-[minmax(180px,2.2fr)_minmax(0,6fr)_minmax(220px,2.5fr)]
          "
            >
              <Card className="min-h-0 min-w-0 overflow-hidden p-0">
                <MatchStatsPanel match={match} />
              </Card>

              <Card className="min-h-0 min-w-0 overflow-hidden p-0">
                <TacticalBoard match={match} />
              </Card>

              <Card className="min-h-0 min-w-0 overflow-hidden p-0">
                <ZonePanel match={match} />
              </Card>
            </div>
          </div>

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
            />
          </Card>
        </div>

        {/* Match timeline */}
        <Card data-player-profile-blur-target className="min-h-0 border-transparent bg-transparent p-0 shadow-none">
          <MatchTimeline
            match={match}
            initialLocalArchive={startupArchive}
            onReplayFrame={showReplayFrame}
            onLive={returnToLive}
          />
        </Card>
      </div>
    </main>
  )
}

export default App
