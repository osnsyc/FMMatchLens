import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  ArrowRight02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { motion } from "framer-motion"
import { useTranslation } from "react-i18next"

import { getHeatmap, getHeatmapColorScaleBounds } from "@/api/heatmap"
import {
  analyzePlayerMovementAsync,
  EMPTY_PLAYER_MOVEMENT,
  type PlayerMovementAnalysis,
} from "@/api/playerMovement"
import { PixiHeatmap } from "@/components/heatmap/PixiHeatmap"
import { PitchMarkings } from "@/components/pitch/PitchMarkings"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Card } from "@/components/ui/card"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { setPlayerProfileBackdrop } from "@/lib/playerProfileBackdrop"
import type { RatingContribution, RatingContributionGroup, RealtimeFrame } from "@/api/realtimeMatch"
import type { HeatmapSnapshot, MatchPlayer, TeamSide } from "@/types/match"

type PlayerMatchDetailsPopupProps = {
  player: MatchPlayer
  side: TeamSide
  teamColor: string
  panelElement: HTMLElement
  anchorElement: HTMLElement
  pinned: boolean
  matchMinute: number
  matchTick: number
  movementFrames: readonly RealtimeFrame[]
  movementAnalysis?: PlayerMovementAnalysis
  heatmaps: HeatmapSnapshot
  pitchDimensions?: { length: number; width: number }
  onPointerEnter?: () => void
  onPointerLeave?: () => void
  onClose: () => void
}

type StatItem = {
  id: string
  value: string
}

const outfieldRatingGroups: RatingContributionGroup[] = [
  "Shooting",
  "Creativity",
  "Passing",
  "Defence",
]
const goalkeeperRatingGroups: RatingContributionGroup[] = [
  "Goalkeeping",
  "Creativity",
  "Passing",
  "Defence",
]
const ratingGroupTranslationKeys: Record<RatingContributionGroup, string> = {
  BaseContext: "baseContext",
  Shooting: "shooting",
  Creativity: "creativity",
  Passing: "passing",
  Defence: "defence",
  Goalkeeping: "goalkeeping",
}

export function PlayerMatchDetailsPopup({
  player,
  side,
  teamColor,
  panelElement,
  anchorElement,
  pinned,
  matchMinute,
  matchTick,
  movementFrames,
  movementAnalysis,
  heatmaps,
  pitchDimensions,
  onPointerEnter,
  onPointerLeave,
  onClose,
}: PlayerMatchDetailsPopupProps) {
  const { t } = useTranslation()
  const popupRef = useRef<HTMLDivElement | null>(null)
  const [panelRect, setPanelRect] = useState(() => panelElement.getBoundingClientRect())
  const [anchorRect, setAnchorRect] = useState(() => anchorElement.getBoundingClientRect())
  const [popupHeight, setPopupHeight] = useState(0)
  const isGoalkeeper = playerIsGoalkeeper(player)
  const contribution =
    player.ratingContribution ?? player.resolveRatingContribution?.()
  const playedMinutes = playerMatchMinutes(player, matchMinute)
  const groups = useMemo(() => playerStatSections(player, isGoalkeeper), [isGoalkeeper, player])
  const [archiveMovement, setArchiveMovement] = useState<{
    frames: readonly RealtimeFrame[]
    playerId: number
    throughTick: number
    value: PlayerMovementAnalysis
  }>(() => ({
    frames: movementFrames,
    playerId: player.id,
    throughTick: matchTick,
    value: EMPTY_PLAYER_MOVEMENT,
  }))
  const movement = movementAnalysis ?? (
    archiveMovement.frames === movementFrames &&
    archiveMovement.playerId === player.id &&
    archiveMovement.throughTick === matchTick
      ? archiveMovement.value
      : EMPTY_PLAYER_MOVEMENT
  )

  useEffect(() => {
    if (movementAnalysis) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      void analyzePlayerMovementAsync(
        movementFrames,
        player.id,
        matchTick,
        () => cancelled
      ).then((value) => {
        if (!cancelled) {
          setArchiveMovement({
            frames: movementFrames,
            playerId: player.id,
            throughTick: matchTick,
            value,
          })
        }
      })
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [matchTick, movementAnalysis, movementFrames, player.id])

  useLayoutEffect(() => {
    setPlayerProfileBackdrop(true)
    return () => setPlayerProfileBackdrop(false)
  }, [])

  useLayoutEffect(() => {
    const updateRect = () => {
      setPanelRect(panelElement.getBoundingClientRect())
      setAnchorRect(anchorElement.getBoundingClientRect())
    }
    const observer = new ResizeObserver(updateRect)
    observer.observe(panelElement)
    observer.observe(anchorElement)
    window.addEventListener("resize", updateRect)
    window.addEventListener("scroll", updateRect, true)
    updateRect()
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", updateRect)
      window.removeEventListener("scroll", updateRect, true)
    }
  }, [anchorElement, panelElement])

  useLayoutEffect(() => {
    const popup = popupRef.current
    if (!popup) return
    const updateHeight = () => setPopupHeight(popup.offsetHeight)
    const observer = new ResizeObserver(updateHeight)
    observer.observe(popup)
    updateHeight()
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node) || popupRef.current?.contains(target)) return
      if (target instanceof Element && target.closest("[data-player-details-trigger]")) return
      onClose()
    }
    document.addEventListener("keydown", handleKeyDown)
    document.addEventListener("pointerdown", handlePointerDown)
    return () => {
      document.removeEventListener("keydown", handleKeyDown)
      document.removeEventListener("pointerdown", handlePointerDown)
    }
  }, [onClose])

  const viewportGap = 8
  const availableWidth = side === "home"
    ? window.innerWidth - panelRect.right - viewportGap * 2
    : panelRect.left - viewportGap * 2
  const width = Math.max(500, Math.min(560, availableWidth))
  const desiredTop = anchorRect.top - 8
  const top = Math.max(
    viewportGap,
    Math.min(desiredTop, window.innerHeight - popupHeight - viewportGap),
  )
  const maxHeight = Math.max(240, window.innerHeight - viewportGap * 2)
  const horizontalStyle = side === "home"
    ? { left: panelRect.right + viewportGap }
    : { right: window.innerWidth - panelRect.left + viewportGap }

  return createPortal(
    <motion.div
      ref={popupRef}
      role="dialog"
      aria-modal={pinned || undefined}
      aria-label={t("playerDetails.title", { player: player.name })}
      data-player-details-popup
      data-pinned={pinned || undefined}
      className="fixed z-60 overflow-y-auto"
      initial={{ opacity: 0, scale: 0.96, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, y: -4 }}
      transition={{ duration: 0.1, ease: [0.2, 0, 0, 1] }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      style={{
        ...horizontalStyle,
        top,
        width,
        maxWidth: `calc(100vw - ${panelRect.width + viewportGap * 3}px)`,
        maxHeight,
        transformOrigin: side === "home" ? "left top" : "right top",
      }}
    >
      <Card className="relative w-full min-h-0 gap-0 overflow-hidden border border-border/80 bg-card p-2.5 text-card-foreground shadow-2xl">
        <div
          className="relative w-full min-h-0"
        >
        <div
          className="absolute inset-y-0 left-0 grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-2"
          style={{ width: 240 }}
        >
          <header className="relative grid min-h-0 grid-cols-[4rem_minmax(0,1fr)] overflow-hidden rounded-md border border-border/70 bg-muted/35">
            <Avatar className="h-full min-h-16 w-16 rounded-none after:hidden">
              {player.portraitUrl && (
                <AvatarImage src={player.portraitUrl} alt={player.name} className="rounded-none object-cover" />
              )}
              <AvatarFallback className="rounded-none bg-transparent text-lg font-bold" style={{ color: teamColor }}>
                {initials(player.name)}
              </AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-col justify-center px-3 py-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <h2 className="min-w-0 truncate text-sm font-bold">{player.fullName ?? player.name}</h2>
                <span className="shrink-0 text-[11px] font-bold" style={{ color: teamColor }}>#{player.shirtNumber ?? "-"}</span>
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
                  {player.position ?? player.inPossession?.position ?? "-"}
                </span>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-2">
                <HeaderMetric
                  label={t("playerDetails.minutesPlayed")}
                  value={`${playedMinutes}'`}
                  valueClassName="bg-muted text-foreground"
                />
                <HeaderMetric
                  label={t("stats.rating")}
                  value={player.rating?.toFixed(1) ?? "-"}
                  valueClassName={ratingBadgeClass(player.rating)}
                />
              </dl>
            </div>
          </header>

          <div className="grid min-h-0 grid-rows-3 gap-2">
            {groups.map((group) => (
              <section key={group.id} className="flex min-h-0 flex-col overflow-hidden rounded-md border border-border/70 bg-muted/10 p-2">
                <SectionTitle title={t(`playerDetails.groups.${group.id}`)} />
                <dl className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto overscroll-contain">
                  {group.items.map((item) => (
                    <div key={item.id} className="flex min-h-5 items-center justify-between gap-2 py-0.5">
                      <dt className="min-w-0 truncate text-[10px] text-muted-foreground" title={t(playerMetricTranslationKeys[item.id])}>
                        {t(playerMetricTranslationKeys[item.id])}
                      </dt>
                      <dd className="shrink-0 text-[11px] font-semibold tabular-nums">{item.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </div>

        <div className="flex min-h-0 flex-col gap-2" style={{ marginLeft: 248 }}>
          <section className="shrink-0 rounded-md border border-border/70 bg-muted/10 p-2">
            {contribution ? (
              <PlayerRatingBreakdown player={player} contribution={contribution} />
            ) : (
              <div className="flex min-h-20 items-center justify-center rounded border border-dashed p-3 text-center text-xs text-muted-foreground">
                {t("playerDetails.noRatingBreakdown")}
              </div>
            )}
          </section>

          <MovementAnalysisCard
            distanceM={player.stats.distanceM}
            sprints={player.stats.sprints}
            movement={movement}
          />

          <section className="flex min-h-0 shrink-0 flex-col overflow-hidden rounded-md border border-border/70 bg-muted/10 p-2">
            <SectionTitle title={t("playerDetails.heatmap")} />
            <div className="min-h-0 overflow-hidden">
              <PlayerHeatmap player={player} heatmaps={heatmaps} pitchDimensions={pitchDimensions} />
            </div>
          </section>
        </div>
        </div>
      </Card>
    </motion.div>,
    document.body
  )
}

function PlayerHeatmap({
  player,
  heatmaps,
  pitchDimensions,
}: {
  player: MatchPlayer
  heatmaps: HeatmapSnapshot
  pitchDimensions?: { length: number; width: number }
}) {
  const { t } = useTranslation()
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const grid = getHeatmap(heatmaps, {
    scope: { type: "player", playerId: player.id },
    phase: "all",
    range: "full",
  })
  const bounds = getHeatmapColorScaleBounds([grid])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const update = () => {
      const availableWidth = Math.max(0, host.clientWidth - 8)
      const ratio = (pitchDimensions?.length ?? 105) / (pitchDimensions?.width ?? 68)
      const width = availableWidth
      setSize({ width, height: width / ratio })
    }
    const observer = new ResizeObserver(update)
    observer.observe(host)
    update()
    return () => observer.disconnect()
  }, [pitchDimensions?.length, pitchDimensions?.width])

  return (
    <div ref={hostRef} className="flex w-full min-h-0 items-center justify-center px-1">
      <div
        className="pitch-frame relative shrink-0 overflow-hidden bg-[var(--heatmap-pitch-surface)] text-[var(--pitch-line)]"
        style={{ width: size.width, height: size.height }}
      >
        {size.width > 1 && size.height > 1 && grid.sampleCount > 0 && (
          <div
            className="pointer-events-none absolute left-1/2 top-1/2"
            style={{
              width: Math.max(1, size.height - 8),
              height: Math.max(1, size.width - 8),
              transform: "translate(-50%, -50%) rotate(90deg)",
            }}
          >
            <PixiHeatmap
              grid={grid}
              width={Math.max(1, size.height - 8)}
              height={Math.max(1, size.width - 8)}
              colorScale={{
                maxCellShare: bounds.rawMaxCellShare,
                sampleDivisor: grid.sampleCount,
                lutScale: bounds.blurredP99CellShare > 0
                  ? bounds.rawMaxCellShare / bounds.blurredP99CellShare
                  : 1,
              }}
            />
          </div>
        )}
        <div className="pointer-events-none absolute inset-px">
          <PitchMarkings dimensions={pitchDimensions} orientation="horizontal" />
        </div>
        <div
          role="img"
          aria-label={t("playerDetails.attackDirection")}
          className="pointer-events-none absolute left-1/2 top-2 z-10 flex -translate-x-1/2 items-center justify-center rounded-sm bg-background/65 p-0.5 text-primary shadow-sm backdrop-blur-[1px]"
        >
          <HugeiconsIcon icon={ArrowRight02Icon} className="size-4" strokeWidth={2.2} />
        </div>
        {grid.sampleCount === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
            {t("playerDetails.noHeatmap")}
          </div>
        )}
      </div>
    </div>
  )
}

function PlayerRatingBreakdown({
  player,
  contribution,
}: {
  player: MatchPlayer
  contribution: RatingContribution
}) {
  const { t } = useTranslation()
  const groups = playerIsGoalkeeper(player) ? goalkeeperRatingGroups : outfieldRatingGroups
  const penaltyShootout = contribution.terms
    .filter((term) => term.index >= 44 && term.index <= 49)
    .reduce((sum, term) => sum + term.postFactorContribution, 0)
  const metrics = [
    ...groups.map((group) => ({
      id: group,
      label: t(`squad.ratingBreakdown.groups.${ratingGroupTranslationKeys[group]}`),
      value: contribution.groupContributionsPostFactor[group] ?? 0,
    })),
    {
      id: "TimeAdjustment",
      label: t("ratingBreakdown.groups.TimeAdjustment"),
      value: contribution.groupContributionsPostFactor.BaseContext ?? 0,
    },
    {
      id: "PenaltyShootout",
      label: t("ratingBreakdown.groups.PenaltyShootout"),
      value: penaltyShootout,
    },
  ]
  const maximum = Math.max(1, ...metrics.map((metric) => Math.abs(metric.value)))

  return (
    <section>
      <SectionTitle title={t("squad.ratingBreakdown.title")} />
      <div className="grid grid-cols-3 gap-x-3 gap-y-3">
        {metrics.map((metric) => {
          const value = metric.value
          return (
            <div key={metric.id} className="min-w-0">
              <div className="flex items-center justify-between gap-2 text-[10px]">
                <span className="truncate text-muted-foreground" title={metric.label}>{metric.label}</span>
                <span className={`font-semibold tabular-nums ${value > 0 ? "text-status-positive" : value < 0 ? "text-status-negative" : "text-muted-foreground"}`}>
                  {value > 0 ? "+" : ""}{(value / 1000).toFixed(2)}
                </span>
              </div>
              <div className="relative mt-1 h-1.5 overflow-hidden rounded bg-muted">
                <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
                {value !== 0 && (
                  <span
                    className={`absolute inset-y-0 rounded ${value > 0 ? "left-1/2 bg-status-positive" : "right-1/2 bg-status-negative"}`}
                    style={{ width: `${Math.max(1, Math.abs(value) / maximum * 50)}%` }}
                  />
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function playerStatSections(
  player: MatchPlayer,
  isGoalkeeper: boolean
) {
  const stats = player.stats
  const percent = (made?: number, attempted?: number) => attempted
    ? `${((made ?? 0) / attempted * 100).toFixed(1)}%`
    : "0.0%"
  const combined = (made?: number, attempted?: number) =>
    `${number(made)} / ${number(attempted)} · ${percent(made, attempted)}`
  const number = (value?: number, digits = 0) => Number(value ?? 0).toFixed(digits)
  const sections: Array<{ id: string; items: StatItem[] }> = []
  if (!isGoalkeeper) {
    sections.push({
      id: "attack",
      items: [
        { id: "goalsExpected", value: `${number(stats.goals)} / ${number(stats.xg, 2)}` },
        { id: "assistsExpected", value: `${number(stats.assists)} / ${number(stats.xa, 2)}` },
        { id: "shooting", value: combined(stats.shotsOnTarget, stats.shots) },
        { id: "dribblesChances", value: `${number(stats.dribbles)} / ${number(stats.clearCutChances)}` },
      ],
    })
  }
  sections.push(
    {
      id: "passing",
      items: [
        { id: "passSummary", value: combined(stats.passesCompleted, stats.passes) },
        { id: "keyProgressivePasses", value: `${number(stats.keyPasses)} / ${number(stats.progressivePasses)}` },
        { id: "crossSummary", value: combined(stats.crossesCompleted, stats.crosses) },
        { id: "chancesCreated", value: number(stats.chancesCreated) },
      ],
    },
    {
      id: "defence",
      items: [
        { id: "tackleSummary", value: combined(stats.tacklesWon, stats.tacklesAttempted) },
        { id: "aerialSummary", value: combined(stats.aerialsWon, stats.aerials) },
        { id: "defensiveActions", value: `${number(stats.interceptions)} / ${number(stats.clearances)} / ${number(stats.blocks)}` },
        { id: "pressesPossessionWon", value: `${number(stats.pressesWon)} / ${number(stats.possessionWon)}` },
      ],
    },
  )
  if (isGoalkeeper) {
    const saves = Number(stats.savesHeld ?? 0) + Number(stats.savesParried ?? 0) + Number(stats.savesTipped ?? 0)
    sections.push({
      id: "goalkeeping",
      items: [
        { id: "saveTypes", value: `${number(stats.savesHeld)} / ${number(stats.savesParried)} / ${number(stats.savesTipped)}` },
        { id: "saveSummary", value: number(saves) },
        { id: "concededShotsFaced", value: `${number(stats.goalsConceded)} / ${number(stats.shotsFaced)}` },
      ],
    })
  }
  return sections
}

const playerMetricTranslationKeys: Record<string, string> = {
  goalsExpected: "playerDetails.metrics.goalsExpected",
  assistsExpected: "playerDetails.metrics.assistsExpected",
  shooting: "playerDetails.metrics.shooting",
  dribblesChances: "playerDetails.metrics.dribblesChances",
  passSummary: "playerDetails.metrics.passSummary",
  keyProgressivePasses: "playerDetails.metrics.keyProgressivePasses",
  crossSummary: "playerDetails.metrics.crossSummary",
  chancesCreated: "stats.chancesCreated",
  tackleSummary: "playerDetails.metrics.tackleSummary",
  aerialSummary: "playerDetails.metrics.aerialSummary",
  defensiveActions: "playerDetails.metrics.defensiveActions",
  pressesPossessionWon: "playerDetails.metrics.pressesPossessionWon",
  saveSummary: "playerDetails.metrics.saveSummary",
  saveTypes: "playerDetails.metrics.saveTypes",
  concededShotsFaced: "playerDetails.metrics.concededShotsFaced",
}

function playerMatchMinutes(player: MatchPlayer, matchMinute: number) {
  const start = player.status?.subbedOnMinute ?? (player.isStarter || player.isOnPitch ? 0 : matchMinute)
  const end = player.status?.subbedOffMinute ?? matchMinute
  return Math.max(0, Math.round(end - start))
}

function playerIsGoalkeeper(player: MatchPlayer) {
  return player.inPossession?.position === "GK" || player.outOfPossession?.position === "GK" ||
    (player.positionFamiliarities?.GK ?? 0) >= 15 || player.position === "GK"
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()
}

function ratingBadgeClass(rating?: number) {
  if (rating == null) return "bg-muted text-muted-foreground"
  if (rating >= 7.5) return "bg-status-positive text-background"
  if (rating < 6.5) return "bg-status-negative text-background"
  return "bg-foreground text-background"
}

function SectionTitle({ title }: { title: string }) {
  return (
    <div className="mb-2 flex min-h-4 shrink-0 items-center gap-1.5">
      <h3 className="truncate text-[11px] font-bold uppercase tracking-wide">{title}</h3>
    </div>
  )
}

function MovementAnalysisCard({
  distanceM,
  sprints,
  movement,
}: {
  distanceM?: number
  sprints?: number
  movement: PlayerMovementAnalysis
}) {
  const { t } = useTranslation()
  const total = movement.zoneSamples.reduce((sum, samples) => sum + samples, 0)
  const shares = movement.zoneSamples.map((samples) => total > 0 ? samples / total * 100 : 0)
  const colors = ["var(--viz-series-1)", "var(--viz-series-2)", "var(--viz-series-3)", "var(--viz-series-4)"]
  let accumulatedShare = 0
  const segments = shares.map((share, index) => {
    const offset = accumulatedShare
    accumulatedShare += share
    return { color: colors[index], offset, share }
  })

  return (
    <section className="flex shrink-0 flex-col overflow-hidden rounded-md border border-border/70 bg-muted/10 p-2">
      <SectionTitle title={t("playerDetails.movement.title")} />
      <div className="relative min-h-0">
        <div className="grid w-20 grid-cols-1 gap-2 text-center">
          <MovementMetric label={t("playerDetails.movement.distance")} value={`${(Number(distanceM ?? 0) / 1000).toFixed(2)} km`} />
          <MovementMetric label={t("playerDetails.movement.sprints")} value={sprints == null ? "-" : String(sprints)} />
          <MovementMetric label={t("playerDetails.movement.maximumSpeed")} value={total > 0 ? `${movement.maximumSpeedKmh.toFixed(1)} km/h` : "-"} />
        </div>
        <div
          className="absolute inset-y-0 left-22 right-0 flex min-w-0 items-center gap-1.5"
        >
          <div
            role="img"
            aria-label={t("playerDetails.movement.distribution")}
            className="relative aspect-square h-4/5 shrink-0"
          >
            <svg className="size-full -rotate-90" viewBox="0 0 36 36" aria-hidden="true">
              <circle
                cx="18"
                cy="18"
                r="14"
                fill="none"
                stroke="var(--muted)"
                strokeWidth="8"
              />
              {total > 0 && segments.map((segment, index) => (
                <circle
                  key={index}
                  cx="18"
                  cy="18"
                  r="14"
                  pathLength="100"
                  fill="none"
                  stroke={segment.color}
                  strokeWidth="8"
                  strokeDasharray={`${segment.share} ${100 - segment.share}`}
                  strokeDashoffset={-segment.offset}
                />
              ))}
            </svg>
            <span className="absolute inset-[29%] flex items-center justify-center rounded-full bg-card text-[8px] font-semibold text-muted-foreground ring-1 ring-border/40">
              {t("playerDetails.movement.speed")}
            </span>
          </div>
          <div className="grid min-w-0 flex-1 grid-cols-1 gap-3">
            {(["walking", "running", "highSpeedRunning", "sprinting"] as const).map((zone, index) => (
              <div key={zone} className="grid min-w-0 grid-cols-[0.375rem_minmax(0,1fr)_auto] items-center gap-x-1 leading-none">
                <span className="size-1.5 shrink-0 rounded-sm" style={{ backgroundColor: colors[index] }} />
                <HoverCard>
                  <HoverCardTrigger
                    delay={120}
                    render={<button type="button" className="min-w-0 truncate text-left text-[9px] font-medium outline-none hover:text-primary focus-visible:text-primary" />}
                  >
                    {t(`playerDetails.movement.zones.${zone}.label`)}
                  </HoverCardTrigger>
                  <HoverCardContent
                    side="right"
                    sideOffset={6}
                    positionerClassName="z-[80]"
                    className="z-[80] w-auto px-2 py-1 text-[10px] whitespace-nowrap"
                  >
                    {t(`playerDetails.movement.zones.${zone}.detail`)}
                  </HoverCardContent>
                </HoverCard>
                <span className="text-[10px] font-bold tabular-nums">{shares[index].toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function MovementMetric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><div className="truncate text-[8px] text-muted-foreground">{label}</div><div className="truncate text-[10px] font-bold tabular-nums">{value}</div></div>
}

function HeaderMetric({ label, value, valueClassName = "" }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-1">
      <dt className="truncate text-[9px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`shrink-0 rounded px-1 py-0.5 text-center text-[10px] font-bold leading-4 tabular-nums ${valueClassName}`}>
        {value}
      </dd>
    </div>
  )
}


