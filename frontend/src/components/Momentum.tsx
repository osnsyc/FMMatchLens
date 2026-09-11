import { memo, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  Area,
  Bar,
  Cell,
  ComposedChart,
  Label,
  ReferenceDot,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts"

import { CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { NativeTabs } from "@/components/uitripled/native-tabs-shadcnui"
import { samePlayerLabels } from "@/lib/matchRenderEquality"
import type { MatchSnapshot, TacticalEventPoint, TeamSide, XgTimelinePoint } from "@/types/match"

type MomentumProps = {
  match: MatchSnapshot
}

type MomentumMode = "line" | "bars"

type MomentumPoint = {
  minute: number
  value: number
  positive: number | null
  negative: number | null
  timeTicks?: number
  homeWeight?: number
  awayWeight?: number
}

type MomentumBar = MomentumPoint & {
  startMinute: number
  endMinute: number
}

type GoalMarker = {
  id: string
  minute: number
  team: TeamSide
  title: string
}

const eventWeights: Partial<Record<TacticalEventPoint["metricId"], number>> = {
  goals: 0.5,
  shotsOnTarget: 0.32,
  shotsOffTarget: 0.14,
  hitWoodwork: 0.4,
  blockedShots: 0.1,
}

const momentumYTicks = [-1, -0.5, 0, 0.5, 1]

export const Momentum = memo(function Momentum({ match }: MomentumProps) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<MomentumMode>("line")
  const homeColor = match.home.color ?? "var(--team-home-fallback)"
  const awayColor = match.away.color ?? "var(--team-away-fallback)"
  const nativeBarPoints = useMemo(() => buildNativeMomentum(match.momentum), [match.momentum])
  const hasNativeMomentum = nativeBarPoints.length > 0
  const minutePoints = useMemo(
    () => buildLineMomentum(
      match.rollingMomentum,
      match.momentum,
      match.clock.minute,
      match.xgTimeline,
      match.tacticalEvents,
    ),
    [match.clock.minute, match.momentum, match.rollingMomentum, match.tacticalEvents, match.xgTimeline],
  )
  const linePoints = useMemo(() => splitAtZeroCrossings(minutePoints), [minutePoints])
  const goalLabel = t("squad.goal")
  const goalMarkers = useMemo(
    () => buildGoalMarkers(match.events, match.players, goalLabel),
    [goalLabel, match.events, match.players],
  )
  const bars = useMemo(
    () => hasNativeMomentum ? buildNativeBars(nativeBarPoints) : buildFiveMinuteBars(minutePoints),
    [hasNativeMomentum, minutePoints, nativeBarPoints],
  )
  const data = mode === "line" ? linePoints : bars
  const maximumMinute = Math.max(90, ...minutePoints.map((point) => point.minute))
  const domainEnd = Math.ceil(maximumMinute / 15) * 15
  const xTicks = Array.from({ length: domainEnd / 15 + 1 }, (_, index) => index * 15)

  const chartConfig = {
    positive: { label: match.home.name, color: homeColor },
    negative: { label: match.away.name, color: awayColor },
    value: { label: t("momentum.title"), color: homeColor },
  } satisfies ChartConfig

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <CardHeader className="flex shrink-0 flex-row items-center gap-3 border-b px-4 py-2">
        <CardTitle className="shrink-0 text-sm font-semibold">{t("momentum.title")}</CardTitle>
        <NativeTabs
          value={mode}
          onValueChange={(value) => setMode(value as MomentumMode)}
          renderContent={false}
          className="ml-auto w-auto max-w-none"
          listClassName="h-6"
          triggerClassName="h-5 px-2 text-[10px]"
          items={[
            { id: "line", label: t("momentum.line"), content: null },
            { id: "bars", label: t("momentum.bars"), content: null },
          ]}
        />
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col p-0">
        <ChartContainer config={chartConfig} className="min-h-0 flex-1 px-2 py-2">
          <ComposedChart data={data} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
            <XAxis
              dataKey="minute"
              type="number"
              domain={[0, domainEnd]}
              ticks={xTicks}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => `${value}'`}
            />
            <YAxis
              type="number"
              domain={[-1.18, 1.18]}
              ticks={momentumYTicks}
              allowDataOverflow
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => Number(value).toFixed(value === 0 ? 0 : 1)}
              width={28}
            />
            {momentumYTicks.filter((tick) => tick !== 0).map((tick) => (
              <ReferenceLine
                key={tick}
                y={tick}
                stroke="var(--border)"
                strokeDasharray="3 3"
              />
            ))}
            <ReferenceLine y={0} stroke="var(--border)" strokeWidth={1.2} />
            {goalMarkers.map((marker) => {
              const markerY = marker.team === "home" ? 1.1 : -1.1
              return (
                <ReferenceLine
                  key={`${marker.id}-line`}
                  segment={[
                    { x: marker.minute, y: 0 },
                    { x: marker.minute, y: markerY },
                  ]}
                  stroke={marker.team === "home" ? homeColor : awayColor}
                  strokeOpacity={0.7}
                  strokeDasharray="3 3"
                  ifOverflow="visible"
                />
              )
            })}
            <ChartTooltip
              cursor={{ stroke: "var(--border)", strokeDasharray: "3 3" }}
              content={(
                <MomentumTooltipDetails
                  homeName={match.home.name}
                  awayName={match.away.name}
                  fallback={t("momentum.title")}
                />
              )}
            />

            {mode === "line" ? (
              <>
                <Area
                  dataKey="positive"
                  type="monotone"
                  stroke="var(--color-positive)"
                  fill={homeColor}
                  fillOpacity={0.5}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 3 }}
                  isAnimationActive={false}
                />
                <Area
                  dataKey="negative"
                  type="monotone"
                  stroke="var(--color-negative)"
                  fill={awayColor}
                  fillOpacity={0.5}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 3 }}
                  isAnimationActive={false}
                />
              </>
            ) : (
              <Bar dataKey="value" barSize={12} radius={[2, 2, 2, 2]} isAnimationActive={false}>
                {bars.map((bar) => (
                  <Cell key={`${bar.startMinute}-${bar.endMinute}`} fill={bar.value >= 0 ? homeColor : awayColor} fillOpacity={0.78} />
                ))}
              </Bar>
            )}

            {goalMarkers.map((marker) => {
              const isHome = marker.team === "home"
              const markerY = isHome ? 1.1 : -1.1
              const color = isHome ? homeColor : awayColor
              return (
                <ReferenceDot
                  key={`${marker.id}-icon`}
                  x={marker.minute}
                  y={markerY}
                  r={1}
                  fill="transparent"
                  stroke="transparent"
                  ifOverflow="visible"
                >
                  <Label
                    content={(
                      <GoalMarkerLabel
                        color={color}
                        title={marker.title}
                        side={isHome ? "top" : "bottom"}
                      />
                    )}
                  />
                </ReferenceDot>
              )
            })}
          </ComposedChart>
        </ChartContainer>
      </CardContent>
    </section>
  )
}, sameMomentumProps)

function buildLineMomentum(
  rollingMomentum: MatchSnapshot["rollingMomentum"],
  momentum: MatchSnapshot["momentum"],
  currentMinute: number,
  xgTimeline: MatchSnapshot["xgTimeline"],
  tacticalEvents: MatchSnapshot["tacticalEvents"],
): MomentumPoint[] {
  if (rollingMomentum.length) {
    return [...rollingMomentum]
      .filter((point) => Number.isFinite(point.value) && Number.isFinite(point.minute))
      .sort((left, right) => left.timeTicks - right.timeTicks)
      .map((point) => toMomentumPoint(point.minute, Math.max(-1, Math.min(1, point.value)), point))
  }

  const native = buildNativeMomentum(momentum)
  if (native.length) return native
  return buildEstimatedMomentum(currentMinute, xgTimeline, tacticalEvents)
}

function buildNativeMomentum(points: MatchSnapshot["momentum"]): MomentumPoint[] {
  if (!points?.length) return []
  return [...points]
    .filter((point) => Number.isFinite(point.value) && Number.isFinite(point.minute))
    .sort((left, right) => left.timeTicks - right.timeTicks)
    .map((point) => toMomentumPoint(point.minute, Math.max(-1, Math.min(1, point.value)), point))
}

function buildEstimatedMomentum(
  currentMinute: number,
  xgTimeline: MatchSnapshot["xgTimeline"],
  tacticalEvents: MatchSnapshot["tacticalEvents"],
): MomentumPoint[] {
  const throughMinute = Math.max(0, Math.min(90, currentMinute))
  const raw = Array.from({ length: throughMinute + 1 }, () => 0)
  const xgByMinute = cumulativeXgByMinute(xgTimeline, throughMinute)

  for (let minute = 1; minute <= throughMinute; minute += 1) {
    const current = xgByMinute[minute]
    const previous = xgByMinute[minute - 1]
    raw[minute] += Math.max(0, current.home - previous.home) * 2.8
    raw[minute] -= Math.max(0, current.away - previous.away) * 2.8
  }

  for (const event of tacticalEvents) {
    if (event.minute < 0 || event.minute > throughMinute) continue
    const direction = event.team === "home" ? 1 : -1
    raw[Math.floor(event.minute)] += direction * (eventWeights[event.metricId] ?? 0)
  }

  return raw.map((_, minute) => {
    let pressure = 0
    for (let lag = 0; lag < 5; lag += 1) {
      const sourceMinute = minute - lag
      if (sourceMinute < 0) break
      pressure += raw[sourceMinute] * (1 - lag * 0.16)
    }
    const value = Math.tanh(pressure / 1.35)
    return toMomentumPoint(minute, value)
  })
}

function buildNativeBars(points: readonly MomentumPoint[]): MomentumBar[] {
  return points.map((point) => {
    const endMinute = Math.round(point.minute)
    const startMinute = Math.max(0, endMinute - 5)
    return { ...toMomentumPoint(startMinute + (endMinute - startMinute) / 2, point.value, point), startMinute, endMinute }
  })
}

function cumulativeXgByMinute(points: readonly XgTimelinePoint[], throughMinute: number) {
  const sorted = [...points]
    .filter((point) => point.minute >= 0 && point.minute <= throughMinute)
    .sort((left, right) => left.minute - right.minute)
  const result: Array<{ home: number; away: number }> = []
  let home = 0
  let away = 0
  let pointIndex = 0

  for (let minute = 0; minute <= throughMinute; minute += 1) {
    while (pointIndex < sorted.length && sorted[pointIndex].minute <= minute) {
      home = sorted[pointIndex].home
      away = sorted[pointIndex].away
      pointIndex += 1
    }
    result.push({ home, away })
  }
  return result
}

function splitAtZeroCrossings(points: readonly MomentumPoint[]) {
  const result: MomentumPoint[] = []
  for (const point of points) {
    const previous = result.at(-1)
    if (previous && previous.value * point.value < 0) {
      const ratio = Math.abs(previous.value) / (Math.abs(previous.value) + Math.abs(point.value))
      result.push(toMomentumPoint(previous.minute + (point.minute - previous.minute) * ratio, 0))
    }
    result.push(point)
  }
  return result
}

function buildFiveMinuteBars(points: readonly MomentumPoint[]): MomentumBar[] {
  const bars: MomentumBar[] = []
  for (let startMinute = 0; startMinute < 90; startMinute += 5) {
    const endMinute = startMinute + 5
    const bucket = points.filter((point) => point.minute >= startMinute && point.minute < endMinute)
    if (bucket.length === 0) break
    const value = bucket.reduce((total, point) => total + point.value, 0) / bucket.length
    bars.push({ ...toMomentumPoint(startMinute + 2.5, value), startMinute, endMinute })
  }
  return bars
}

function buildGoalMarkers(
  events: MatchSnapshot["events"],
  players: MatchSnapshot["players"],
  goalLabel: string,
): GoalMarker[] {
  return events
    .filter((event) => event.type === "goal" || event.type === "own_goal")
    .map((event) => {
      const player = players.find((candidate) => candidate.id === event.playerId)
      const eventTeam = event.team ?? player?.team
      if (!eventTeam) return null
      const team = event.type === "own_goal"
        ? eventTeam === "home" ? "away" : "home"
        : eventTeam
      return {
        id: event.id,
        minute: event.minute,
        team,
        title: `${formatMinute(event.minute)} · ${goalLabel}${player ? ` · ${player.name}` : ""}`,
      }
    })
    .filter((marker): marker is GoalMarker => marker != null)
}

function sameMomentumProps(previous: MomentumProps, next: MomentumProps) {
  const left = previous.match
  const right = next.match
  return left.home.name === right.home.name
    && left.home.color === right.home.color
    && left.away.name === right.away.name
    && left.away.color === right.away.color
    && left.clock.minute === right.clock.minute
    && left.momentum === right.momentum
    && left.rollingMomentum === right.rollingMomentum
    && left.xgTimeline === right.xgTimeline
    && left.tacticalEvents === right.tacticalEvents
    && left.events === right.events
    && samePlayerLabels(left.players, right.players)
}

function GoalMarkerLabel({
  color,
  title,
  side,
  viewBox,
}: {
  color: string
  title: string
  side: "top" | "bottom"
  viewBox?: unknown
}) {
  const point = viewBox && typeof viewBox === "object" && "x" in viewBox && "y" in viewBox
    ? viewBox as { x?: number; y?: number }
    : null
  if (point?.x == null || point.y == null) return null

  return (
    <foreignObject
      x={point.x - 8}
      y={point.y - 8}
      width="16"
      height="16"
      style={{ overflow: "visible" }}
    >
      <HoverCard>
        <HoverCardTrigger
          render={(
            <button
              type="button"
              aria-label={title}
              className="flex size-4 cursor-help items-center justify-center rounded-full border bg-background shadow-sm outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring"
              style={{ borderColor: color }}
            />
          )}
        >
          <img src="./goal.svg" alt="" aria-hidden="true" className="size-3" />
        </HoverCardTrigger>
        <HoverCardContent
          side={side}
          sideOffset={6}
          className="w-auto max-w-72 whitespace-nowrap px-2.5 py-1.5 font-medium"
        >
          {title}
        </HoverCardContent>
      </HoverCard>
    </foreignObject>
  )
}

function toMomentumPoint(
  minute: number,
  value: number,
  source?: Pick<MomentumPoint, "timeTicks" | "homeWeight" | "awayWeight">,
): MomentumPoint {
  return {
    minute,
    value,
    positive: value >= 0 ? value : null,
    negative: value <= 0 ? value : null,
    timeTicks: source?.timeTicks,
    homeWeight: source?.homeWeight,
    awayWeight: source?.awayWeight,
  }
}

type MomentumTooltipDetailsProps = {
  active?: boolean
  payload?: Array<{ payload?: MomentumPoint | MomentumBar }>
  homeName: string
  awayName: string
  fallback: string
}

function MomentumTooltipDetails({
  active,
  payload,
  homeName,
  awayName,
  fallback,
}: MomentumTooltipDetailsProps) {
  const point = payload?.find((entry) => entry.payload)?.payload
  if (!active || !point) return null
  const label = momentumTooltipLabel(point, fallback)
  const leadingTeam = point.value >= 0 ? homeName : awayName

  return (
    <div className="grid min-w-40 gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-2 text-xs shadow-xl">
      <div className="font-medium tabular-nums">{label}</div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground">{leadingTeam}</span>
        <span className="font-mono font-medium tabular-nums text-foreground">
          {Math.abs(point.value).toFixed(4)}
        </span>
      </div>
      {point.homeWeight != null && point.awayWeight != null && (
        <div className="flex items-center justify-between gap-4 text-[10px] text-muted-foreground">
          <span>{homeName} {point.homeWeight}</span>
          <span>{awayName} {point.awayWeight}</span>
        </div>
      )}
    </div>
  )
}

function momentumTooltipLabel(payload: MomentumPoint | MomentumBar, fallback: string) {
  if ("startMinute" in payload && "endMinute" in payload) {
    return `${formatMinute(payload.startMinute)}–${formatMinute(payload.endMinute)}`
  }
  if (payload.timeTicks != null) return formatMomentumTick(payload.timeTicks)
  if (Number.isFinite(payload.minute)) return formatMinute(payload.minute)
  return fallback
}

function formatMomentumTick(ticks: number) {
  const totalSeconds = Math.floor(Math.max(0, ticks) / 4)
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`
}

function formatMinute(minute: number) {
  const totalSeconds = Math.round(Math.max(0, minute) * 60)
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`
}
