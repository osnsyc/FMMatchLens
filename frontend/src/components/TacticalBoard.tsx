import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Toggle } from "@/components/ui/toggle"
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

import type {
  MatchPlayer,
  MatchSnapshot,
  TeamSide,
} from "@/types/match"

type TacticalBoardProps = {
  match: MatchSnapshot
}

/* =========================================================
   Groups
   ========================================================= */

type DataGroupId =
  | "shots"
  | "distribution"
  | "defensive"
  | "possession"
  | "discipline"
  | "goalkeeping"

/*
 * Use one shape for each category.
 */
type Shape =
  | "square"
  | "circle"
  | "triangle"
  | "triangle-down"
  | "pentagon"
  | "diamond"

/*
 * Distinguish metrics within a category through visual variants.
 */
type MarkerVariant =
  | "solid"
  | "outline"
  | "gold"
  | "dashed"
  | "white"
  | "double"

type DataMetric = {
  id: string
  label: string
  group: DataGroupId
  shape: Shape
  variant: MarkerVariant
  scale?: number

  /*
   * Do not constrain metric to keyof PlayerStats. This supports derived values such as:
   *
   * passes - passesCompleted
   * aerials - aerialsWon
   *
   * It also remains compatible with future goalkeeper fields.
   */
}

type MapPoint = {
  id: string
  player?: MatchPlayer
  receiver?: MatchPlayer
  team: TeamSide
  metric: DataMetric
  value: number
  x: number
  y: number
  size: number
  minute?: number
  tick?: number
  displayTick?: number
  counterpart?: {
    player?: MatchPlayer
    team: TeamSide
    metric: DataMetric
  }
}

/* =========================================================
   Groups
   ========================================================= */

const groups: Array<{
  id: DataGroupId
  label: string
  shape: Shape
}> = [
  {
    id: "shots",
    label: "Shots",
    shape: "square",
  },
  { id: "distribution", label: "Distribution", shape: "circle" },
  { id: "defensive", label: "Defensive", shape: "triangle" },
  { id: "possession", label: "Possession", shape: "triangle-down" },
  { id: "discipline", label: "Discipline", shape: "pentagon" },
  { id: "goalkeeping", label: "Goalkeeping", shape: "diamond" },
]

/* =========================================================
   Metrics
   ========================================================= */

const metrics: DataMetric[] = [
  /* =======================================================
     SHOTS — square

     Gold    = Goal
     Solid   = On target
     Outline = Off target
     Dashed  = Blocked
     ======================================================= */

  {
    id: "goals",
    label: "Goals",
    group: "shots",
    shape: "square",
    variant: "gold",
    scale: 1.1,
  },

  {
    id: "shotsOnTarget",
    label: "Shots on target",
    group: "shots",
    shape: "square",
    variant: "solid",
    scale: 0.9,
  },

  {
    id: "shotsOffTarget",
    label: "Shots off target",
    group: "shots",
    shape: "square",
    variant: "outline",
    scale: 0.8,
  },

  {
    id: "hitWoodwork",
    label: "Hit woodwork",
    group: "shots",
    shape: "square",
    variant: "gold",
    scale: 0.85,
  },

  {
    id: "blockedShots",
    label: "Blocked shots",
    group: "shots",
    shape: "square",
    variant: "dashed",
    scale: 0.85,
  },

  { id: "passesCompleted", label: "Completed passes", group: "distribution", shape: "circle", variant: "solid", scale: 0.65 },
  { id: "passesIncomplete", label: "Incomplete passes", group: "distribution", shape: "circle", variant: "outline", scale: 0.65 },
  { id: "crossesCompleted", label: "Completed crosses", group: "distribution", shape: "circle", variant: "double", scale: 0.8 },
  { id: "crossesIncomplete", label: "Incomplete crosses", group: "distribution", shape: "circle", variant: "dashed", scale: 0.8 },

  { id: "tacklesWon", label: "Tackles won", group: "defensive", shape: "triangle", variant: "solid", scale: 0.8 },
  { id: "tacklesLost", label: "Tackles lost", group: "defensive", shape: "triangle", variant: "outline", scale: 0.8 },
  { id: "aerialsWon", label: "Aerial duels won", group: "defensive", shape: "triangle", variant: "white", scale: 0.8 },
  { id: "aerialsLost", label: "Aerial duels lost", group: "defensive", shape: "triangle", variant: "dashed", scale: 0.8 },

  { id: "interceptions", label: "Interceptions", group: "defensive", shape: "triangle", variant: "double", scale: 0.8 },
  { id: "dribblesCompleted", label: "Completed dribbles", group: "possession", shape: "triangle-down", variant: "solid", scale: 0.8 },

  { id: "foulsCommitted", label: "Fouls committed", group: "discipline", shape: "pentagon", variant: "dashed", scale: 0.85 },
  { id: "fouled", label: "Fouled", group: "discipline", shape: "pentagon", variant: "white", scale: 0.85 },

]

const initialSelectedMetrics =
  Object.fromEntries(
    metrics.map(
      (metric) => [
        metric.id,
        metric.group === "shots",
      ]
    )
  ) as Record<string, boolean>

/* =========================================================
   TacticalBoard
   ========================================================= */

export function TacticalBoard({
  match,
}: TacticalBoardProps) {
  const { t } = useTranslation()
  const groupLabel = (group: (typeof groups)[number]) =>
    t(`dataMap.groups.${group.id}`, { defaultValue: group.label })
  const metricLabel = (metric: DataMetric) =>
    t(`dataMap.events.${metric.id}`, { defaultValue: metric.label })

  const [
    showNumbers,
    setShowNumbers,
  ] = useState(true)

  const [
    selectedMetrics,
    setSelectedMetrics,
  ] = useState<
    Record<string, boolean>
  >(
    initialSelectedMetrics
  )

  const selectedMetricList =
    useMemo(
      () =>
        metrics.filter(
          (metric) =>
            selectedMetrics[metric.id]
        ),
      [selectedMetrics]
    )

  const selectedMetricCount =
    selectedMetricList.length

  const points =
    useMemo<
      MapPoint[]
    >(() => {
      const playerById = new Map(match.players.map((player) => [player.id, player]))
      const metricById = new Map(selectedMetricList.map((metric) => [metric.id, metric]))
      const allMetricById = new Map(metrics.map((metric) => [metric.id, metric]))
      const hiddenEventIds = new Set<string>()
      const counterpartByEventId = new Map<string, MatchSnapshot["tacticalEvents"][number]>()

      const pairSelectedEvents = (displayMetricId: string, hiddenMetricId: string) => {
        if (!selectedMetrics[displayMetricId] || !selectedMetrics[hiddenMetricId]) return

        const hiddenByTick = new Map<number, MatchSnapshot["tacticalEvents"]>()
        for (const event of match.tacticalEvents) {
          if (event.metricId !== hiddenMetricId) continue
          const bucket = hiddenByTick.get(event.tick)
          if (bucket) bucket.push(event)
          else hiddenByTick.set(event.tick, [event])
        }

        for (const event of match.tacticalEvents) {
          if (event.metricId !== displayMetricId) continue
          const candidates = hiddenByTick.get(event.tick)
          if (!candidates) continue
          const counterpartIndex = candidates.findIndex((candidate) => candidate.team !== event.team)
          if (counterpartIndex < 0) continue

          const [counterpart] = candidates.splice(counterpartIndex, 1)
          counterpartByEventId.set(event.id, counterpart)
          hiddenEventIds.add(counterpart.id)
        }
      }

      // When both sides of a native pair are selected, keep the favourable
      // result on the pitch and retain the other participant for the tooltip.
      pairSelectedEvents("fouled", "foulsCommitted")
      pairSelectedEvents("aerialsWon", "aerialsLost")

      const eventPoints = match.tacticalEvents.flatMap((event) => {
        if (hiddenEventIds.has(event.id)) return []
        const player = playerById.get(event.playerId)
        const receiver = event.receiverPlayerId == null
          ? undefined
          : playerById.get(event.receiverPlayerId)
        const metric = metricById.get(event.metricId)
        if (!metric) return []
        const counterpartEvent = counterpartByEventId.get(event.id)
        const counterpartMetric = counterpartEvent == null
          ? undefined
          : allMetricById.get(counterpartEvent.metricId)

        return [{
          id: event.id,
          player,
          receiver,
          team: event.team,
          metric,
          value: 1,
          x: event.x,
          y: event.y,
          size: Math.max(15, 17 * (metric.scale ?? 1)),
          minute: event.minute,
          tick: event.tick,
          displayTick: event.displayTick,
          counterpart: counterpartEvent && counterpartMetric
            ? {
                player: playerById.get(counterpartEvent.playerId),
                team: counterpartEvent.team,
                metric: counterpartMetric,
              }
            : undefined,
        }]
      })

      return eventPoints
    }, [
      match.players,
      match.tacticalEvents,
      selectedMetrics,
      selectedMetricList,
    ])

  const toggleMetric = (
    metric: DataMetric
  ) => {
    setSelectedMetrics(
      (current) => ({
        ...current,

        [metric.id]:
          !current[
            metric.id
          ],
      })
    )
  }

  const setGroupSelected = (groupMetrics: DataMetric[], selected: boolean) => {
    setSelectedMetrics((current) => ({
      ...current,
      ...Object.fromEntries(groupMetrics.map((metric) => [metric.id, selected])),
    }))
  }

  const invertGroup = (groupMetrics: DataMetric[]) => {
    setSelectedMetrics((current) => ({
      ...current,
      ...Object.fromEntries(groupMetrics.map((metric) => [metric.id, !current[metric.id]])),
    }))
  }

  return (
    <TooltipProvider>
      <section className="flex h-full min-h-0 flex-col overflow-hidden">
        {/* =================================================
            Header
            ================================================= */}

        <CardHeader className="flex shrink-0 flex-row items-center gap-3 border-b px-4 py-2">
          <CardTitle className="shrink-0 text-sm font-semibold">
            {t(
              "panels.dataMap"
            )}
          </CardTitle>

          <Menubar className="h-6 min-w-0 flex-1">
            {groups.filter((group) => metrics.some((metric) => metric.group === group.id)).map(
              (group) => {
                const groupMetrics =
                  metrics.filter(
                    (metric) =>
                      metric.group ===
                      group.id
                  )

                const enabledCount =
                  groupMetrics.filter(
                    (metric) =>
                      selectedMetrics[
                        metric.id
                      ]
                  ).length

                return (
                  <MenubarMenu
                    key={
                      group.id
                    }
                  >
                    <MenubarTrigger
                      data-selected={
                        enabledCount > 0
                      }
                      className="min-w-0 flex-1 justify-center px-1.5 text-[10px]"
                    >
                      <span className="truncate">
                        {
                          groupLabel(group)
                        }
                      </span>
                      {enabledCount > 0 && (
                        <span className="ml-1 text-[9px] tabular-nums text-primary">{enabledCount}</span>
                      )}
                    </MenubarTrigger>

                    <MenubarContent
                      align="start"
                      className="z-[100] min-w-48"
                    >
                      <MenubarGroup>
                        <MenubarLabel className="flex items-center justify-between gap-4">
                          <div className="flex items-center gap-2">
                            <MarkerGlyph
                              shape={
                                group.shape
                              }
                              variant="solid"
                              color="var(--primary)"
                              size={12}
                            />

                            <span>
                              {
                                groupLabel(group)
                              }
                            </span>
                          </div>

                          <span className="tabular-nums text-muted-foreground">
                            {
                              enabledCount
                            }
                            /
                            {
                              groupMetrics.length
                            }
                          </span>
                        </MenubarLabel>

                        <MenubarSeparator />

                        <MenubarItem
                          onClick={() => setGroupSelected(groupMetrics, enabledCount !== groupMetrics.length)}
                        >
                          {enabledCount === groupMetrics.length ? t("dataMap.clearAll") : t("dataMap.selectAll")}
                        </MenubarItem>

                        <MenubarItem onClick={() => invertGroup(groupMetrics)}>
                          {t("dataMap.invertGroup")}
                        </MenubarItem>

                        <MenubarSeparator />

                        {groupMetrics.map(
                          (
                            metric
                          ) => (
                            <MenubarCheckboxItem
                              key={
                                metric.id
                              }
                              checked={
                                selectedMetrics[
                                  metric
                                    .id
                                ]
                              }
                              onCheckedChange={() =>
                                toggleMetric(
                                  metric
                                )
                              }
                            >
                              <MarkerGlyph
                                shape={
                                  metric.shape
                                }
                                variant={
                                  metric.variant
                                }
                                color="var(--primary)"
                                size={
                                  13
                                }
                              />

                              <span>
                                {
                                  metricLabel(metric)
                                }
                              </span>
                            </MenubarCheckboxItem>
                          )
                        )}
                      </MenubarGroup>
                    </MenubarContent>
                  </MenubarMenu>
                )
              }
            )}
          </Menubar>

          <Toggle
            variant="outline"
            size="sm"
            pressed={showNumbers}
            onPressedChange={setShowNumbers}
            aria-label={t("dataMap.showNumbers")}
            className="shrink-0 px-2 text-[10px] aria-pressed:border-primary/35 aria-pressed:bg-primary/15 aria-pressed:text-foreground"
          >
            {t("dataMap.showNumbers")}
          </Toggle>
        </CardHeader>

        {/* =================================================
            Pitch
            ================================================= */}

        <CardContent className="flex min-h-0 flex-1 flex-col p-0">
          <div className="flex min-h-0 min-w-0 flex-1 items-stretch gap-2 overflow-hidden p-3">
            <aside className="flex w-28 shrink-0 flex-col gap-1.5 overflow-y-auto py-1 text-[9px]">
              {selectedMetricList.length > 0 ? selectedMetricList.map((metric) => (
                <div key={`legend-${metric.id}`} className="flex items-center gap-1.5 text-muted-foreground">
                  <MarkerGlyph shape={metric.shape} variant={metric.variant} color="var(--primary)" size={13} />
                  <span className="leading-tight">{metricLabel(metric)}</span>
                </div>
              )) : (
                <span className="text-muted-foreground">{t("dataMap.noSelection")}</span>
              )}
            </aside>

            <div className="tactical-pitch-viewport flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden">
              <div className="tactical-pitch relative shrink-0 overflow-hidden rounded-md bg-muted">
              <div className="pointer-events-none absolute inset-0 bg-primary/[0.025]" />

              <PitchSvg />

              {/* ===========================================
                  Data points
                  =========================================== */}

              <div className="absolute inset-0">
                {points.map(
                  (point) => {
                    const teamColor =
                      point.team ===
                      "home"
                        ? match.home
                            .color
                        : match.away
                            .color

                    const resolvedColor =
                      teamColor ??
                      (point.team ===
                      "home"
                        ? "#6cabdd"
                        : "#ef0107")

                    const counterpartColor = point.counterpart
                      ? (point.counterpart.team === "home" ? match.home.color : match.away.color) ??
                        (point.counterpart.team === "home" ? "#6cabdd" : "#ef0107")
                      : undefined

                    const hollow =
                      point.metric
                        .variant ===
                        "outline" ||
                      point.metric
                        .variant ===
                        "dashed"

                    return (
                      <Tooltip
                        key={
                          point.id
                        }
                      >
                        <TooltipTrigger
                          render={
                            <button
                              type="button"
                              className="
                                absolute z-10
                                flex
                                -translate-x-1/2
                                -translate-y-1/2
                                items-center
                                justify-center
                                outline-none
                                transition-transform

                                hover:z-20
                                hover:scale-125

                                focus-visible:z-20
                                focus-visible:ring-2
                                focus-visible:ring-ring
                              "
                              style={{
                                left: `${point.x}%`,
                                top: `${point.y}%`,
                                width: `${point.size}px`,
                                height: `${point.size}px`,
                              }}
                              aria-label={`${point.player?.name ?? t("dataMap.unknownPlayer")}, ${metricLabel(point.metric)}: ${point.value}`}
                            >
                              <MarkerGlyph
                                shape={
                                  point
                                    .metric
                                    .shape
                                }
                                variant={
                                  point
                                    .metric
                                    .variant
                                }
                                color={
                                  resolvedColor
                                }
                                size={
                                  point.size
                                }
                              />

                              {showNumbers &&
                                point.size >=
                                  11 && (
                                  <span
                                    className="
                                      pointer-events-none
                                      absolute inset-0
                                      flex items-center
                                      justify-center
                                      text-[7px]
                                      font-bold
                                      leading-none
                                    "
                                    style={{
                                      color:
                                        hollow
                                          ? resolvedColor
                                          : "#fff",

                                      textShadow:
                                        hollow
                                          ? "0 0 3px var(--background)"
                                          : "0 1px 2px rgb(0 0 0 / 65%)",
                                    }}
                                  >
                                    {point
                                      .player
                                      ?.shirtNumber ??
                                      ""}
                                  </span>
                                )}
                            </button>
                          }
                        />

                        <TooltipContent>
                          <div className="space-y-1">
                            <div className="font-medium">
                              {
                                point
                                  .player
                                  ?.name ?? t("dataMap.unknownPlayer")
                              }{" "}
                              #
                              {point
                                .player
                                ?.shirtNumber ??
                                "-"}
                              {point.receiver && (
                                <span className="ml-1 text-muted-foreground">
                                  → {point.receiver.name} #{point.receiver.shirtNumber ?? "-"}
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-1.5 text-xs">
                              <MarkerGlyph
                                shape={
                                  point
                                    .metric
                                    .shape
                                }
                                variant={
                                  point
                                    .metric
                                    .variant
                                }
                                color={
                                  resolvedColor
                                }
                                size={
                                  11
                                }
                              />

                              <span>
                                {metricLabel(point.metric)}
                                :{" "}
                                <strong>
                                  {
                                    point.value
                                  }
                                </strong>
                              </span>
                            </div>

                            {point.counterpart && counterpartColor && (
                              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <MarkerGlyph
                                  shape={point.counterpart.metric.shape}
                                  variant={point.counterpart.metric.variant}
                                  color={counterpartColor}
                                  size={11}
                                />
                                <span>
                                  {metricLabel(point.counterpart.metric)}: {point.counterpart.player?.name ?? t("dataMap.unknownPlayer")}{" "}
                                  #{point.counterpart.player?.shirtNumber ?? "-"}
                                </span>
                              </div>
                            )}

                            {point.displayTick != null && (
                              <div className="text-[10px] tabular-nums text-muted-foreground">
                                {formatMatchTick(point.displayTick)}
                              </div>
                            )}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    )
                  }
                )}
              </div>

              {/* ===========================================
                  Empty state
                  =========================================== */}

              {(selectedMetricCount ===
                0 ||
                points.length ===
                  0) && (
                <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
                  <div className="rounded-md border bg-background/90 px-3 py-2 text-xs text-muted-foreground shadow-sm backdrop-blur-sm">
                    {selectedMetricCount ===
                    0
                      ? t(
                          "dataMap.noMetrics"
                        )
                      : t(
                          "dataMap.noData"
                        )}
                  </div>
                </div>
              )}
              </div>
            </div>
          </div>
        </CardContent>
      </section>
    </TooltipProvider>
  )
}

function formatMatchTick(tick: number) {
  const seconds = Math.floor(Math.max(0, tick) / 4)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

/* =========================================================
   Marker
   ========================================================= */

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
  /*
   * SVG is a better fit here than CSS clip-path.
   *
   * Reasons:
   * 1. A hollow polygon is difficult to outline cleanly with a div and clip-path.
   * 2. A dashed stroke cannot be applied correctly to a clip-path outline.
   * 3. The diamond shape no longer requires rotating its label.
   */

  if (
    variant === "double"
  ) {
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
          stroke="#f6c453"
          strokeWidth={1.8}
        />

        <g transform="translate(10 10) scale(.58) translate(-10 -10)">
          <ShapeElement
            shape={shape}
            fill={color}
            stroke="#ffffff"
            strokeWidth={1.2}
          />
        </g>
      </svg>
    )
  }

  const style =
    markerStyle(
      variant,
      color
    )

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
        {...style}
      />
    </svg>
  )
}

function markerStyle(
  variant: MarkerVariant,
  color: string
) {
  switch (variant) {
    case "solid":
      return {
        fill: color,
        stroke:
          "var(--background)",
        strokeWidth: 1.2,
      }

    case "outline":
      return {
        fill: "transparent",
        stroke: color,
        strokeWidth: 2.2,
      }

    case "gold":
      return {
        fill: color,
        stroke: "#f6c453",
        strokeWidth: 2,
      }

    case "dashed":
      return {
        fill: "transparent",
        stroke: color,
        strokeWidth: 2,
        strokeDasharray:
          "3 1.8",
      }

    case "white":
      return {
        fill: color,
        stroke: "#f4f0ff",
        strokeWidth: 2,
      }

    default:
      return {
        fill: color,
        stroke:
          "var(--background)",
        strokeWidth: 1,
      }
  }
}

/* =========================================================
   SVG shapes
   ========================================================= */

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
    strokeLinejoin:
      "round" as const,
    vectorEffect:
      "non-scaling-stroke" as const,
  }

  switch (shape) {
    /*
     * Shots
     */
    case "square":
      return (
        <rect
          x="3"
          y="3"
          width="14"
          height="14"
          rx="2"
          {...common}
        />
      )

    /*
     * Distribution
     */
    case "circle":
      return (
        <circle
          cx="10"
          cy="10"
          r="7"
          {...common}
        />
      )

    /*
     * Defensive
     */
    case "triangle":
      return (
        <polygon
          points="10,2.5 18,17 2,17"
          {...common}
        />
      )

    /*
     * Possession
     */
    case "triangle-down":
      return (
        <polygon
          points="2,3 18,3 10,17.5"
          {...common}
        />
      )

    /*
     * Discipline
     */
    case "pentagon":
      return (
        <polygon
          points="
            10,2
            18,7.8
            15,17
            5,17
            2,7.8
          "
          {...common}
        />
      )

    /*
     * Goalkeeping
     */
    case "diamond":
      return (
        <polygon
          points="
            10,2
            18,10
            10,18
            2,10
          "
          {...common}
        />
      )

    default:
      return null
  }
}

/* =========================================================
   Pitch
   ========================================================= */

function PitchSvg() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 size-full"
      viewBox="0 0 148 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <rect
        x="1"
        y="1"
        width="146"
        height="98"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.8"
        className="text-foreground/40"
      />

      <line
        x1="74"
        y1="1"
        x2="74"
        y2="99"
        stroke="currentColor"
        strokeWidth="0.6"
        className="text-foreground/35"
      />

      <circle
        cx="74"
        cy="50"
        r="10"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.6"
        className="text-foreground/35"
      />

      <circle
        cx="74"
        cy="50"
        r="0.8"
        fill="currentColor"
        className="text-foreground/40"
      />

      <rect
        x="1"
        y="30"
        width="18"
        height="40"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.6"
        className="text-foreground/35"
      />

      <rect
        x="129"
        y="30"
        width="18"
        height="40"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.6"
        className="text-foreground/35"
      />

      <rect
        x="1"
        y="39"
        width="7"
        height="22"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.6"
        className="text-foreground/35"
      />

      <rect
        x="140"
        y="39"
        width="7"
        height="22"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.6"
        className="text-foreground/35"
      />

      <path
        d="M19 38a15 15 0 0 1 0 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.6"
        className="text-foreground/35"
      />

      <path
        d="M129 38a15 15 0 0 0 0 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.6"
        className="text-foreground/35"
      />
    </svg>
  )
}
