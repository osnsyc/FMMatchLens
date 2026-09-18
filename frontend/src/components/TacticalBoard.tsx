import { memo, useMemo, useState, type CSSProperties } from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import {
  ArrowBigLeftDashIcon,
  ArrowBigRightDashIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { Button } from "@/components/ui/button"
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarGroup,
  MenubarItem,
  MenubarLabel,
  MenubarMenu,
  MenubarSeparator,
  MenubarTrigger,
} from "@/components/ui/menubar"
import { PixiTactical } from "@/components/tactical/PixiTactical"
import {
  TACTICAL_EVENT_OVERSCAN_PX,
  type TacticalHit,
} from "@/components/tactical/PixiTacticalRenderer"
import { PitchMarkings } from "@/components/pitch/PitchMarkings"
import { resolvePitchDimensions } from "@/components/pitch/pitchGeometry"
import { samePlayerLabels } from "@/lib/matchRenderEquality"
import {
  buildShotChains,
  buildTacticalScene,
  groups,
  initialSelectedMetrics,
  metricById,
  metrics,
  type DataMetric,
  type MarkerVariant,
  type Shape,
  type ShotChain,
  type TacticalRenderPoint,
} from "@/components/tactical/tacticalScene"
import type {
  MatchPlayer,
  MatchSnapshot,
  TacticalEventPoint,
  TeamSide,
} from "@/types/match"
import { useTheme } from "@/components/theme-provider"
import { cssVizTokens } from "@/theme/vizTokens"

type TacticalBoardProps = {
  match: MatchSnapshot
}
type HorizontalZone = 0 | 1 | 2

type LaneShare = {
  zone: HorizontalZone
  count: number
  percentage: number
}

type HoveredTacticalPoint = {
  point: TacticalRenderPoint
  clientX: number
  clientY: number
}

const emptyShotChains: readonly ShotChain[] = []

export const TacticalBoard = memo(function TacticalBoard({
  match,
}: TacticalBoardProps) {
  const { t } = useTranslation()
  const pitchDimensions = resolvePitchDimensions(match.pitchDimensions)
  const pitchStyle = {
    "--pitch-aspect-ratio": pitchDimensions.length / pitchDimensions.width,
    "--pitch-frame-gap": `${TACTICAL_EVENT_OVERSCAN_PX}px`,
  } as CSSProperties
  const { settings, resolvedScheme } = useTheme()
  const [showNumbers, setShowNumbers] = useState(true)
  const [showAttackFocus, setShowAttackFocus] = useState(true)
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null)
  const [selectedMetrics, setSelectedMetrics] = useState<
    Record<string, boolean>
  >(initialSelectedMetrics)
  const [hovered, setHovered] = useState<HoveredTacticalPoint | null>(null)

  const groupLabel = (group: (typeof groups)[number]) =>
    t(`dataMap.groups.${group.id}`, { defaultValue: group.label })
  const metricLabel = (metric: DataMetric) =>
    t(`dataMap.events.${metric.id}`, { defaultValue: metric.label })

  const selectedMetricList = useMemo(
    () => metrics.filter((metric) => selectedMetrics[metric.id]),
    [selectedMetrics]
  )
  const scene = useMemo(
    () => buildTacticalScene(match.tacticalEvents, selectedMetrics),
    [match.tacticalEvents, selectedMetrics]
  )
  const playerById = useMemo(
    () => new Map(match.players.map((player) => [player.id, player])),
    [match.players]
  )
  const activeSelectedShotId = useMemo(
    () =>
      selectedShotId != null &&
      scene.points.some((point) => point.id === selectedShotId)
        ? selectedShotId
        : null,
    [scene, selectedShotId]
  )
  const visibleShotChains = useMemo(
    () =>
      activeSelectedShotId == null
        ? emptyShotChains
        : buildShotChains(match.tacticalEvents, selectedMetrics).filter(
            (chain) => chain.shotEventId === activeSelectedShotId
          ),
    [activeSelectedShotId, match.tacticalEvents, selectedMetrics]
  )
  const momentumLaneShares = useMemo(
    () => calculateMomentumLaneShares(match.tacticalEvents),
    [match.tacticalEvents]
  )
  const appearance = useMemo(
    () => ({
      homeColor: match.home.color ?? "var(--team-home-fallback)",
      awayColor: match.away.color ?? "var(--team-away-fallback)",
      showNumbers,
      tokens: cssVizTokens(settings.presetId, resolvedScheme, settings.colorVision),
    }),
    [match.away.color, match.home.color, resolvedScheme, settings.colorVision, settings.presetId, showNumbers]
  )

  const toggleMetric = (metric: DataMetric) => {
    setSelectedMetrics((current) => ({
      ...current,
      [metric.id]: !current[metric.id],
    }))
  }
  const setGroupSelected = (groupMetrics: DataMetric[], selected: boolean) => {
    setSelectedMetrics((current) => ({
      ...current,
      ...Object.fromEntries(
        groupMetrics.map((metric) => [metric.id, selected])
      ),
    }))
  }
  const invertGroup = (groupMetrics: DataMetric[]) => {
    setSelectedMetrics((current) => ({
      ...current,
      ...Object.fromEntries(
        groupMetrics.map((metric) => [metric.id, !current[metric.id]])
      ),
    }))
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <CardHeader className="flex shrink-0 flex-row items-center gap-3 border-b px-4 py-2">
        <CardTitle className="shrink-0 text-sm font-semibold @max-[420px]/card-header:hidden">
          {t("panels.dataMap")}
        </CardTitle>

        <Menubar className="ml-auto h-6 min-w-0 flex-1">
          {groups.map((group) => {
            const groupMetrics = metrics.filter(
              (metric) => metric.group === group.id
            )
            const enabledCount = groupMetrics.filter(
              (metric) => selectedMetrics[metric.id]
            ).length
            return (
              <MenubarMenu key={group.id}>
                <MenubarTrigger className="h-5 min-w-0 flex-1 justify-center gap-1 px-1.5 text-[10px]">
                  <MarkerGlyph
                    shape={group.shape}
                    variant="solid"
                    color="var(--primary)"
                    size={12}
                  />
                  <span className="truncate">{groupLabel(group)}</span>
                  <span className="text-[9px] text-muted-foreground tabular-nums">
                    {enabledCount}/{groupMetrics.length}
                  </span>
                </MenubarTrigger>
                <MenubarContent className="z-[100] min-w-52">
                  <MenubarGroup>
                    <MenubarLabel>{groupLabel(group)}</MenubarLabel>
                    <MenubarSeparator />
                    <MenubarItem
                      onClick={() =>
                        setGroupSelected(
                          groupMetrics,
                          enabledCount !== groupMetrics.length
                        )
                      }
                    >
                      {enabledCount === groupMetrics.length
                        ? t("dataMap.clearAll")
                        : t("dataMap.selectAll")}
                    </MenubarItem>
                    <MenubarItem onClick={() => invertGroup(groupMetrics)}>
                      {t("dataMap.invertGroup")}
                    </MenubarItem>
                    <MenubarSeparator />
                    {groupMetrics.map((metric) => (
                      <MenubarCheckboxItem
                        key={metric.id}
                        checked={selectedMetrics[metric.id]}
                        onCheckedChange={() => toggleMetric(metric)}
                      >
                        <MarkerGlyph
                          shape={metric.shape}
                          variant={metric.variant}
                          color="var(--primary)"
                          size={13}
                        />
                        <span>{metricLabel(metric)}</span>
                      </MenubarCheckboxItem>
                    ))}
                  </MenubarGroup>
                </MenubarContent>
              </MenubarMenu>
            )
          })}
        </Menubar>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 px-1.5 text-[10px]"
              />
            }
          >
            {t("dataMap.displaySettings")}
            <span className="ml-1 text-[9px] text-primary tabular-nums">
              {Number(showNumbers) + Number(showAttackFocus)}
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="z-[100] min-w-36">
            <DropdownMenuCheckboxItem
              checked={showNumbers}
              onCheckedChange={(checked) => setShowNumbers(checked === true)}
            >
              {t("dataMap.showNumbers")}
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={showAttackFocus}
              onCheckedChange={(checked) =>
                setShowAttackFocus(checked === true)
              }
            >
              {t("dataMap.attackFocus")}
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col p-0">
        <div className="flex min-h-0 min-w-0 flex-1 items-stretch gap-2 overflow-hidden p-3">
          <aside className="flex w-28 shrink-0 flex-col gap-1.5 overflow-y-auto py-1 text-[9px]">
            {selectedMetricList.length > 0 ? (
              selectedMetricList.map((metric) => (
                <div
                  key={`legend-${metric.id}`}
                  className="flex items-center gap-1.5 text-muted-foreground"
                >
                  <MarkerGlyph
                    shape={metric.shape}
                    variant={metric.variant}
                    color="var(--primary)"
                    size={13}
                  />
                  <span className="leading-tight">{metricLabel(metric)}</span>
                </div>
              ))
            ) : (
              <span className="text-muted-foreground">
                {t("dataMap.noSelection")}
              </span>
            )}
          </aside>

          <div className="tactical-pitch-viewport flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden">
            <div
              className="tactical-pitch pitch-frame relative shrink-0 text-[var(--pitch-line)]"
              style={pitchStyle}
            >
              <div className="relative size-full bg-[var(--tactical-pitch-surface)]">
                <div className="pointer-events-none absolute inset-0 bg-primary/[0.025]" />
                <PitchMarkings dimensions={pitchDimensions} />

                {showAttackFocus && activeSelectedShotId == null && (
                  <AttackFocus laneShares={momentumLaneShares} />
                )}

                <PixiTactical
                  scene={scene}
                  players={playerById}
                  appearance={appearance}
                  selectedShotId={activeSelectedShotId}
                  shotChains={visibleShotChains}
                  onHover={(hit, clientX, clientY) => {
                    setHovered((current) => {
                      if (!hit) return null
                      if (
                        current?.point.id === hit.point.id &&
                        current.clientX === clientX &&
                        current.clientY === clientY
                      )
                        return current
                      return { point: hit.point, clientX, clientY }
                    })
                  }}
                  onPointClick={(hit: TacticalHit) => {
                    if (!hit.historical && hit.point.group === "shots") {
                      setSelectedShotId(hit.point.id)
                    }
                  }}
                  onEmptyClick={() => setSelectedShotId(null)}
                />

                {(selectedMetricList.length === 0 ||
                  scene.points.length === 0) && (
                  <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
                    <div className="rounded-md border bg-background/90 px-3 py-2 text-xs text-muted-foreground shadow-sm backdrop-blur-sm">
                      {selectedMetricList.length === 0
                        ? t("dataMap.noMetrics")
                        : t("dataMap.noData")}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </CardContent>

      {hovered && (
        <TacticalPointTooltip
          hovered={hovered}
          players={playerById}
          homeColor={appearance.homeColor}
          awayColor={appearance.awayColor}
          unknownPlayer={t("dataMap.unknownPlayer")}
          metricLabel={metricLabel}
        />
      )}
    </section>
  )
}, sameTacticalBoardProps)

function sameTacticalBoardProps(
  previous: TacticalBoardProps,
  next: TacticalBoardProps
) {
  const left = previous.match
  const right = next.match
  return (
    left.tacticalEvents === right.tacticalEvents &&
    left.pitchDimensions?.length === right.pitchDimensions?.length &&
    left.pitchDimensions?.width === right.pitchDimensions?.width &&
    left.home.color === right.home.color &&
    left.away.color === right.away.color &&
    samePlayerLabels(left.players, right.players)
  )
}

function TacticalPointTooltip({
  hovered,
  players,
  homeColor,
  awayColor,
  unknownPlayer,
  metricLabel,
}: {
  hovered: HoveredTacticalPoint
  players: ReadonlyMap<number, MatchPlayer>
  homeColor: string
  awayColor: string
  unknownPlayer: string
  metricLabel: (metric: DataMetric) => string
}) {
  const { point, clientX, clientY } = hovered
  const player = players.get(point.playerId)
  const receiver =
    point.receiverPlayerId == null
      ? undefined
      : players.get(point.receiverPlayerId)
  const metric = metricById.get(point.metricId)
  if (!metric) return null
  const color = point.team === "home" ? homeColor : awayColor
  const counterpartPlayer = point.counterpart
    ? players.get(point.counterpart.playerId)
    : undefined
  const counterpartMetric = point.counterpart
    ? metricById.get(point.counterpart.metricId)
    : undefined
  const counterpartColor =
    point.counterpart?.team === "home" ? homeColor : awayColor

  return createPortal(
    <div
      role="tooltip"
      className="pointer-events-none fixed z-[100] inline-flex w-max max-w-xs -translate-x-1/2 -translate-y-[calc(100%+10px)] flex-col gap-1 rounded-md bg-foreground px-3 py-1.5 text-xs text-background shadow-md"
      style={{ left: clientX, top: clientY }}
    >
      <div className="font-medium">
        {player?.name ?? unknownPlayer} #{player?.shirtNumber ?? "-"}
        {receiver && (
          <span className="ml-1 opacity-70">
            → {receiver.name} #{receiver.shirtNumber ?? "-"}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <MarkerGlyph
          shape={metric.shape}
          variant={metric.variant}
          color={color}
          size={11}
        />
        <span>
          {metricLabel(metric)}: <strong>1</strong>
        </span>
      </div>
      {point.counterpart && counterpartMetric && (
        <div className="flex items-center gap-1.5 opacity-70">
          <MarkerGlyph
            shape={counterpartMetric.shape}
            variant={counterpartMetric.variant}
            color={counterpartColor}
            size={11}
          />
          <span>
            {metricLabel(counterpartMetric)}:{" "}
            {counterpartPlayer?.name ?? unknownPlayer} #
            {counterpartPlayer?.shirtNumber ?? "-"}
          </span>
        </div>
      )}
      <div className="text-[10px] tabular-nums opacity-70">
        {formatMatchTick(point.displayTick)}
      </div>
    </div>,
    document.body
  )
}

function AttackFocus({
  laneShares,
}: {
  laneShares: Record<TeamSide, LaneShare[]>
}) {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-[5]"
      aria-hidden="true"
    >
      <div className="absolute inset-x-0 top-1/3 border-t-2 border-dashed border-foreground/15" />
      <div className="absolute inset-x-0 top-2/3 border-t-2 border-dashed border-foreground/15" />
      {(["away", "home"] as const).flatMap((team) =>
        laneShares[team].map((lane) => {
          const relativeTop = ((lane.zone + 0.5) / 3) * 100
          const top = team === "home" ? relativeTop : 100 - relativeTop
          return (
            <div
              key={`${team}-momentum-lane-${lane.zone}`}
              className="absolute h-1/4 w-[22%] -translate-x-1/2 -translate-y-1/2"
              style={{ left: team === "home" ? "60%" : "40%", top: `${top}%` }}
            >
              <HugeiconsIcon
                icon={
                  team === "home" ? ArrowBigRightDashIcon : ArrowBigLeftDashIcon
                }
                strokeWidth={0.5}
                className="size-full text-foreground/[0.10]"
              />
              <span className="absolute inset-0 flex items-center justify-center text-[clamp(11px,2cqw,18px)] font-bold text-foreground/55 tabular-nums">
                {lane.percentage}%
              </span>
            </div>
          )
        })
      )}
    </div>
  )
}

function formatMatchTick(tick: number) {
  const seconds = Math.floor(Math.max(0, tick) / 4)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

function calculateMomentumLaneShares(
  events: TacticalEventPoint[]
): Record<TeamSide, LaneShare[]> {
  const counts: Record<TeamSide, [number, number, number]> = {
    home: [0, 0, 0],
    away: [0, 0, 0],
  }
  for (const event of events) {
    const zone = weightedMomentumHorizontalZone(event)
    if (zone != null) counts[event.team][zone] += 1
  }
  return {
    home: buildLaneShares(counts.home),
    away: buildLaneShares(counts.away),
  }
}

function weightedMomentumHorizontalZone(
  event: TacticalEventPoint
): HorizontalZone | undefined {
  if (!Number.isFinite(event.x) || !Number.isFinite(event.y)) return undefined
  const reverseDirection = (event.flags & 0x100) !== 0
  const rotatedForDisplay =
    event.team === "home" ? !reverseDirection : reverseDirection
  const nativeLongitudinal = rotatedForDisplay ? 100 - event.x : event.x
  const nativeLateral = rotatedForDisplay ? 100 - event.y : event.y
  const relativeLongitudinal = reverseDirection
    ? 100 - nativeLongitudinal
    : nativeLongitudinal
  const relativeLateral = reverseDirection ? 100 - nativeLateral : nativeLateral
  if (relativeLongitudinal >= 50) return undefined
  if (relativeLateral > 200 / 3) return 0
  if (relativeLateral > 100 / 3) return 1
  return 2
}

function buildLaneShares(counts: [number, number, number]): LaneShare[] {
  const total = counts[0] + counts[1] + counts[2]
  if (total === 0) {
    return counts.map((count, zone) => ({
      zone: zone as HorizontalZone,
      count,
      percentage: 0,
    }))
  }
  const exact = counts.map((count) => (count / total) * 100)
  const percentages = exact.map(Math.floor)
  const remainder = 100 - percentages.reduce((sum, value) => sum + value, 0)
  const remainderOrder = exact
    .map((value, zone) => ({ zone, fraction: value - Math.floor(value) }))
    .sort(
      (left, right) => right.fraction - left.fraction || left.zone - right.zone
    )
  for (let index = 0; index < remainder; index += 1) {
    percentages[remainderOrder[index].zone] += 1
  }
  return counts.map((count, zone) => ({
    zone: zone as HorizontalZone,
    count,
    percentage: percentages[zone],
  }))
}

function MarkerGlyph({
  shape,
  variant,
  color,
  size,
}: {
  shape: Shape
  variant: MarkerVariant
  color: string
  size: number
}) {
  if (variant === "double") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 20 20"
        aria-hidden="true"
        className="shrink-0 overflow-visible"
      >
        <ShapeElement
          shape={shape}
          fill="transparent"
          stroke="var(--important-event)"
          strokeWidth={1.8}
        />
        <g transform="translate(10 10) scale(.58) translate(-10 -10)">
          <ShapeElement
            shape={shape}
            fill={color}
            stroke="var(--event-marker-foreground)"
            strokeWidth={1.2}
          />
        </g>
      </svg>
    )
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      aria-hidden="true"
      className="shrink-0 overflow-visible"
    >
      <ShapeElement shape={shape} {...markerStyle(variant, color)} />
    </svg>
  )
}

function markerStyle(variant: MarkerVariant, color: string) {
  switch (variant) {
    case "solid":
      return { fill: color, stroke: "var(--background)", strokeWidth: 1.2 }
    case "outline":
      return { fill: "transparent", stroke: color, strokeWidth: 2.2 }
    case "important":
      return { fill: color, stroke: "var(--important-event)", strokeWidth: 2 }
    case "dashed":
      return {
        fill: "transparent",
        stroke: color,
        strokeWidth: 2,
        strokeDasharray: "3 1.8",
      }
    case "contrast":
      return { fill: color, stroke: "var(--event-contrast)", strokeWidth: 2 }
    default:
      return { fill: color, stroke: "var(--background)", strokeWidth: 1 }
  }
}

function ShapeElement({
  shape,
  fill,
  stroke,
  strokeWidth,
  strokeDasharray,
}: {
  shape: Shape
  fill: string
  stroke: string
  strokeWidth: number
  strokeDasharray?: string
}) {
  const common = {
    fill,
    stroke,
    strokeWidth,
    strokeDasharray,
    strokeLinejoin: "round" as const,
    vectorEffect: "non-scaling-stroke" as const,
  }
  switch (shape) {
    case "square":
      return <rect x="3" y="3" width="14" height="14" rx="2" {...common} />
    case "circle":
      return <circle cx="10" cy="10" r="7" {...common} />
    case "triangle":
      return <polygon points="10,2.5 18,17 2,17" {...common} />
    case "triangle-down":
      return <polygon points="2,3 18,3 10,17.5" {...common} />
    case "pentagon":
      return <polygon points="10,2 18,7.8 15,17 5,17 2,7.8" {...common} />
    case "diamond":
      return <polygon points="10,2 18,10 10,18 2,10" {...common} />
  }
}
