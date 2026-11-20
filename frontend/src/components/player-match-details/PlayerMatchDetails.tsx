import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { ArrowRight02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Pie, PieChart, ResponsiveContainer } from "recharts"
import { getHeatmap, prepareHeatmapRenderData } from "@/api/heatmap"
import type { PlayerMovementAnalysis } from "@/api/playerMovement"
import type {
  RatingContribution,
  RatingContributionGroup,
} from "@/api/realtimeMatch"
import { PixiHeatmap } from "@/components/heatmap/PixiHeatmap"
import { PitchMarkings } from "@/components/pitch/PitchMarkings"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import type { HeatmapSnapshot, MatchPlayer } from "@/types/match"
import { playerIsGoalkeeper } from "./usePlayerMatchDetails"

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

export function PlayerHeatmap({
  exportMode = false,
  player,
  heatmaps,
  pitchDimensions,
}: {
  player: MatchPlayer
  heatmaps: HeatmapSnapshot
  pitchDimensions?: { length: number; width: number }
  exportMode?: boolean
}) {
  const { t } = useTranslation()
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const { grid, renderData } = useMemo(() => {
    const grid = getHeatmap(heatmaps, {
      scope: { type: "player", playerId: player.id },
      phase: "all",
      range: "full",
    })
    return { grid, renderData: prepareHeatmapRenderData(grid) }
  }, [heatmaps, player.id])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const update = () => {
      const availableWidth = Math.max(0, host.clientWidth - 8)
      const ratio =
        (pitchDimensions?.length ?? 105) / (pitchDimensions?.width ?? 68)
      const width = exportMode
        ? Math.min(availableWidth, host.clientHeight * ratio)
        : availableWidth
      setSize({ width, height: width / ratio })
    }
    const observer = new ResizeObserver(update)
    observer.observe(host)
    update()
    return () => observer.disconnect()
  }, [exportMode, pitchDimensions?.length, pitchDimensions?.width])

  return (
    <div
      ref={hostRef}
      className={`flex min-h-0 w-full items-center justify-center px-1 ${exportMode ? "h-full" : ""}`}
    >
      <div
        className="pitch-frame relative shrink-0 overflow-hidden bg-[var(--heatmap-pitch-surface)] text-[var(--pitch-line)]"
        style={{ width: size.width, height: size.height }}
      >
        {size.width > 1 && size.height > 1 && grid.sampleCount > 0 && (
          <div
            className="pointer-events-none absolute top-1/2 left-1/2"
            style={{
              width: Math.max(1, size.height - 8),
              height: Math.max(1, size.width - 8),
              transform: "translate(-50%, -50%) rotate(90deg)",
            }}
          >
            <PixiHeatmap
              exportMode={exportMode}
              data={renderData}
              width={Math.max(1, size.height - 8)}
              height={Math.max(1, size.width - 8)}
            />
          </div>
        )}
        <div className="pointer-events-none absolute inset-px">
          <PitchMarkings
            dimensions={pitchDimensions}
            orientation="horizontal"
          />
        </div>
        <div
          role="img"
          aria-label={t("playerDetails.attackDirection")}
          className="pointer-events-none absolute top-2 left-1/2 z-10 flex -translate-x-1/2 items-center justify-center rounded-sm bg-background/65 p-0.5 text-primary shadow-sm backdrop-blur-[1px]"
        >
          <HugeiconsIcon
            icon={ArrowRight02Icon}
            className="size-4"
            strokeWidth={2.2}
          />
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

export function PlayerRatingBreakdown({
  player,
  contribution,
}: {
  player: MatchPlayer
  contribution: RatingContribution
}) {
  const { t } = useTranslation()
  const groups = playerIsGoalkeeper(player)
    ? goalkeeperRatingGroups
    : outfieldRatingGroups
  const penaltyShootout = contribution.terms
    .filter((term) => term.index >= 44 && term.index <= 49)
    .reduce((sum, term) => sum + term.postFactorContribution, 0)
  const metrics = [
    ...groups.map((group) => ({
      id: group,
      label: t(
        `squad.ratingBreakdown.groups.${ratingGroupTranslationKeys[group]}`
      ),
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
  const maximum = Math.max(
    1,
    ...metrics.map((metric) => Math.abs(metric.value))
  )

  return (
    <section>
      <SectionTitle title={t("squad.ratingBreakdown.title")} />
      <div className="grid grid-cols-3 gap-x-3 gap-y-3">
        {metrics.map((metric) => {
          const value = metric.value
          return (
            <div key={metric.id} className="min-w-0">
              <div className="flex items-center justify-between gap-2 text-[10px]">
                <span
                  className="truncate text-muted-foreground"
                  title={metric.label}
                >
                  {metric.label}
                </span>
                <span
                  className={`font-semibold tabular-nums ${value > 0 ? "text-status-positive" : value < 0 ? "text-status-negative" : "text-muted-foreground"}`}
                >
                  {value > 0 ? "+" : ""}
                  {(value / 1000).toFixed(2)}
                </span>
              </div>
              <div className="relative mt-1 h-1.5 overflow-hidden rounded bg-muted">
                <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
                {value !== 0 && (
                  <span
                    className={`absolute inset-y-0 rounded ${value > 0 ? "left-1/2 bg-status-positive" : "right-1/2 bg-status-negative"}`}
                    style={{
                      width: `${Math.max(1, (Math.abs(value) / maximum) * 50)}%`,
                    }}
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

export function SectionTitle({ title }: { title: string }) {
  return (
    <div className="mb-2 flex min-h-4 shrink-0 items-center gap-1.5">
      <h3 className="truncate text-[11px] font-bold tracking-wide uppercase">
        {title}
      </h3>
    </div>
  )
}

export function MovementAnalysisCard({
  reportMode = false,
  distanceM,
  sprints,
  movement,
}: {
  reportMode?: boolean
  distanceM?: number
  sprints?: number
  movement: PlayerMovementAnalysis
}) {
  const { t } = useTranslation()
  const total = movement.zoneSamples.reduce((sum, samples) => sum + samples, 0)
  const shares = movement.zoneSamples.map((samples) =>
    total > 0 ? (samples / total) * 100 : 0
  )
  const colors = [7, 5, 3, 1].map((tier) => `var(--player-status-tier-${tier})`)
  const segments = movement.zoneSamples
    .map((value, index) => ({ value, fill: colors[index] }))
    .filter((segment) => segment.value > 0)
  const chartData = total > 0 ? segments : [{ value: 1, fill: "var(--muted)" }]

  return (
    <section
      data-report-movement={reportMode ? "" : undefined}
      className="flex shrink-0 flex-col overflow-hidden rounded-md border border-border/70 bg-muted/10 p-2"
    >
      <SectionTitle title={t("playerDetails.movement.title")} />
      <div className="relative min-h-0">
        <div className="grid w-20 grid-cols-1 gap-2 text-center">
          <MovementMetric
            label={t("playerDetails.movement.distance")}
            value={`${(Number(distanceM ?? 0) / 1000).toFixed(2)} km`}
          />
          <MovementMetric
            label={t("playerDetails.movement.sprints")}
            value={sprints == null ? "-" : String(sprints)}
          />
          <MovementMetric
            label={t("playerDetails.movement.maximumSpeed")}
            value={
              total > 0 ? `${movement.maximumSpeedKmh.toFixed(1)} km/h` : "-"
            }
          />
        </div>
        <div className="absolute inset-y-0 right-0 left-22 flex min-w-0 items-center gap-1.5">
          <div
            role="img"
            aria-label={t("playerDetails.movement.distribution")}
            className="relative aspect-square h-4/5 shrink-0"
          >
            <ResponsiveContainer
              width="100%"
              height="100%"
              minWidth={0}
              minHeight={0}
            >
              <PieChart
                margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
                accessibilityLayer={false}
              >
                <Pie
                  data={chartData}
                  dataKey="value"
                  cx="50%"
                  cy="50%"
                  innerRadius="56%"
                  outerRadius="100%"
                  startAngle={90}
                  endAngle={-270}
                  paddingAngle={2.4}
                  minAngle={1}
                  stroke="none"
                  isAnimationActive={false}
                />
              </PieChart>
            </ResponsiveContainer>
            <span className="absolute inset-[29%] flex items-center justify-center rounded-full bg-card text-[8px] font-semibold text-muted-foreground ring-1 ring-border/40">
              {t("playerDetails.movement.speed")}
            </span>
          </div>
          <div className="grid min-w-0 flex-1 grid-cols-1 gap-3">
            {(
              ["walking", "running", "highSpeedRunning", "sprinting"] as const
            ).map((zone, index) => (
              <div
                key={zone}
                className="grid min-w-0 grid-cols-[0.375rem_minmax(0,1fr)_auto] items-center gap-x-1 leading-none"
              >
                <span
                  className="size-1.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: colors[index] }}
                />
                <HoverCard>
                  <HoverCardTrigger
                    delay={120}
                    render={
                      <button
                        type="button"
                        className="min-w-0 truncate text-left text-[9px] font-medium outline-none hover:text-primary focus-visible:text-primary"
                      />
                    }
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
                <span className="text-[10px] font-bold tabular-nums">
                  {shares[index].toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function MovementMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[8px] text-muted-foreground">{label}</div>
      <div className="truncate text-[10px] font-bold tabular-nums">{value}</div>
    </div>
  )
}

export function HeaderMetric({
  label,
  value,
  valueClassName = "",
}: {
  label: string
  value: string
  valueClassName?: string
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-1">
      <dt className="truncate text-[9px] tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd
        className={`shrink-0 rounded px-1 py-0.5 text-center text-[10px] leading-4 font-bold tabular-nums ${valueClassName}`}
      >
        {value}
      </dd>
    </div>
  )
}
