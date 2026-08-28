import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import {
  CartesianGrid,
  ComposedChart,
  Label,
  Line,
  ReferenceDot,
  XAxis,
  YAxis,
} from "recharts"

import {
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import type {
  MatchSnapshot,
  TeamSide,
  XgTimelinePoint,
} from "@/types/match"

type XgTimelineProps = {
  match: MatchSnapshot
}

type GoalMarker = {
  id: string
  minute: number
  team: TeamSide
  xg: number
  scorer: string | undefined
  assistants: string[]
}

export function XgTimeline({
  match,
}: XgTimelineProps) {
  const { t } = useTranslation()

  const homeColor =
    match.home.color ?? "#6cabdd"

  const awayColor =
    match.away.color ?? "#ef0107"

  const timeline = useMemo(
    () => buildTimeline(match),
    [match]
  )

  const goalMarkers = useMemo(
    () =>
      buildGoalMarkers(
        match,
        timeline
      ),
    [match, timeline]
  )

  const chartConfig = {
    home: {
      label: match.home.name,
      color: homeColor,
    },
    away: {
      label: match.away.name,
      color: awayColor,
    },
  } satisfies ChartConfig

  const maxXg = Math.max(
    match.home.stats.xg,
    match.away.stats.xg,
    ...timeline.flatMap((point) => [point.home, point.away])
  )

  // Keep 20% headroom so goal markers stay inside the plotting area.
  const yMax = Math.max(0.5, Math.ceil(maxXg * 1.2 * 10) / 10)

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Header */}
      <CardHeader className="flex shrink-0 flex-row items-center gap-3 border-b px-4 py-2">
        <CardTitle className="shrink-0 text-sm font-semibold">
          {t("stats.expectedGoals")}
        </CardTitle>

        {/* Teams + current xG */}
        <div className="ml-auto flex min-w-0 items-center gap-3">
          {/* Home */}
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className="max-w-24 truncate text-[10px] font-medium text-muted-foreground">
              {match.home.name}
            </span>

            <span
              className="text-sm font-semibold leading-none tabular-nums"
              style={{
                color: homeColor,
              }}
            >
              {match.home.stats.xg.toFixed(2)}
            </span>
          </div>

          {/* Divider */}
          <span className="text-[10px] text-muted-foreground/40">
            /
          </span>

          {/* Away */}
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span
              className="text-sm font-semibold leading-none tabular-nums"
              style={{
                color: awayColor,
              }}
            >
              {match.away.stats.xg.toFixed(2)}
            </span>

            <span className="max-w-24 truncate text-[10px] font-medium text-muted-foreground">
              {match.away.name}
            </span>
          </div>
        </div>
      </CardHeader>

      {/* Chart */}
      <CardContent className="flex min-h-0 flex-1 flex-col p-0">
        <ChartContainer
          config={chartConfig}
          className="min-h-0 flex-1 px-2 py-2"
        >
          <ComposedChart
            data={timeline}
            margin={{
              top: 4,
              right: 12,
              bottom: 4,
              left: 0,
            }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
            />

            <XAxis
              dataKey="minute"
              type="number"
              domain={[0, 90]}
              ticks={[
                0,
                15,
                30,
                45,
                60,
                75,
                90,
              ]}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) =>
                `${value}'`
              }
            />

            <YAxis
              type="number"
              domain={[0, yMax]}
              allowDataOverflow
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => Number(value).toFixed(value < 1 ? 1 : 0)}
              width={28}
            />

            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  indicator="line"
                  labelFormatter={(
                    _,
                    payload
                  ) => {
                    const minute =
                      payload?.[0]
                        ?.payload
                        ?.minute

                    return minute != null
                      ? `${minute}'`
                      : t(
                          "stats.expectedGoals"
                        )
                  }}
                  formatter={(
                    value,
                    name
                  ) => (
                    <>
                      <span className="text-muted-foreground">
                        {chartConfig[
                          String(
                            name
                          ) as keyof typeof chartConfig
                        ]?.label ?? name}
                      </span>

                      <span className="ml-auto font-mono font-medium tabular-nums text-foreground">
                        {Number(
                          value
                        ).toFixed(2)}
                      </span>
                    </>
                  )}
                />
              }
            />

            <Line
              dataKey="home"
              type="stepAfter"
              stroke="var(--color-home)"
              strokeWidth={2}
              dot={false}
              activeDot={{
                r: 3,
              }}
              isAnimationActive={false}
            />

            <Line
              dataKey="away"
              type="stepAfter"
              stroke="var(--color-away)"
              strokeWidth={2}
              dot={false}
              activeDot={{
                r: 3,
              }}
              isAnimationActive={false}
            />

            {goalMarkers.map(
              (marker) => (
                <ReferenceDot
                  key={marker.id}
                  x={marker.minute}
                  y={marker.xg}
                  r={1}
                  fill="transparent"
                  stroke="transparent"
                  ifOverflow="visible"
                >
                  <Label
                    content={
                      <GoalMarkerLabel
                        color={
                          marker.team ===
                          "home"
                            ? homeColor
                            : awayColor
                        }
                        title={[
                          `${marker.minute}'`,
                          marker.scorer ? `${t("squad.goal")} · ${marker.scorer}` : t("squad.goal"),
                          ...marker.assistants.map((name) => `${t("squad.assist")} · ${name}`),
                        ].join("\n")}
                      />
                    }
                  />
                </ReferenceDot>
              )
            )}
          </ComposedChart>
        </ChartContainer>
      </CardContent>
    </section>
  )
}

function GoalMarkerLabel({
  color,
  title,
  viewBox,
}: {
  color: string
  title: string
  viewBox?: unknown
}) {
  const point =
    viewBox &&
    typeof viewBox === "object" &&
    "x" in viewBox &&
    "y" in viewBox
      ? (viewBox as {
          x?: number
          y?: number
        })
      : null

  if (
    point?.x == null ||
    point.y == null
  ) {
    return null
  }

  return (
    <g
      transform={`translate(${point.x - 7}, ${point.y - 17})`}
      className="cursor-help drop-shadow-sm"
    >
      <title>{title}</title>
      <circle
        cx="7"
        cy="7"
        r="7"
        fill="hsl(var(--background))"
        stroke={color}
        strokeWidth="1.25"
      />

      <image
        href="./goal.svg"
        x="1.5"
        y="1.5"
        width="11"
        height="11"
        preserveAspectRatio="xMidYMid meet"
      />
    </g>
  )
}

function buildTimeline(
  match: MatchSnapshot
): XgTimelinePoint[] {
  if (match.xgTimeline.length) {
    const throughMinute = Math.max(0, match.clock.minute)
    const byMinute = new Map<number, XgTimelinePoint>()
    byMinute.set(0, { minute: 0, home: 0, away: 0 })

    for (const point of match.xgTimeline) {
      if (point.minute >= 0 && point.minute <= throughMinute) {
        byMinute.set(point.minute, point)
      }
    }

    return [...byMinute.values()].sort((left, right) => left.minute - right.minute)
  }

  const current = {
    minute: Math.max(0, match.clock.minute),
    home: match.home.stats.xg,
    away: match.away.stats.xg,
  }

  return current.minute === 0
    ? [current]
    : [{ minute: 0, home: 0, away: 0 }, current]
}

function buildGoalMarkers(
  match: MatchSnapshot,
  points: XgTimelinePoint[]
) {
  return match.events
    .filter(
      (event) =>
        event.type === "goal"
    )
    .map((event) => {
      const team =
        event.team ??
        match.players.find(
          (player) =>
            player.id ===
            event.playerId
        )?.team

      if (!team) {
        return null
      }

      return {
        id: event.id,
        minute: event.minute,
        team,
        scorer: match.players.find((player) => player.id === event.playerId)?.name,
        assistants: match.events
          .filter((candidate) =>
            candidate.type === "assist_candidate" &&
            candidate.minute === event.minute &&
            candidate.team === team
          )
          .map((candidate) => match.players.find((player) => player.id === candidate.playerId)?.name)
          .filter((name): name is string => Boolean(name)),
        xg: xgAtMinute(
          points,
          event.minute,
          team
        ),
      }
    })
    .filter(
      (
        marker
      ): marker is GoalMarker =>
        marker != null
    )
}

function xgAtMinute(
  points: XgTimelinePoint[],
  minute: number,
  team: TeamSide
) {
  const sorted = [...points].sort(
    (a, b) =>
      a.minute - b.minute
  )

  let current =
    sorted[0]?.[team] ?? 0

  for (const point of sorted) {
    if (
      point.minute > minute
    ) {
      break
    }

    current = point[team]
  }

  return current
}
