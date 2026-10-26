import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react"
import { useTranslation } from "react-i18next"

import {
  buildPassMapForPlayerIds,
  passMapEdgesForPlayer,
  passMapFrequencyThresholds,
  passMapFrequencyTier,
  type PassMapEdge,
  type PassMapData,
  type PassMapFrequencyThresholds,
  type PassMapFrequencyTier,
  type PassMapNode,
} from "@/api/passMap"
import {
  MapPanelControls,
  type SpatialMapView,
} from "@/components/map/MapPanelControls"
import { PitchMarkings } from "@/components/pitch/PitchMarkings"
import { resolvePitchDimensions } from "@/components/pitch/pitchGeometry"
import { PitchPlayerBadge } from "@/components/pitch/PitchPlayerBadge"
import {
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type {
  MatchPlayer,
  MatchSnapshot,
  PositionHeatmapRange,
  TeamSide,
} from "@/types/match"

type PassMapProps = {
  match: MatchSnapshot
  isFocusMode: boolean
  selectedTeam: TeamSide
  selectedRange: PositionHeatmapRange
  onViewChange: (view: SpatialMapView) => void
  onTeamChange: (team: TeamSide) => void
  onRangeChange: (range: PositionHeatmapRange) => void
}

type EdgeGeometry = PassMapEdge & {
  key: string
  bodyPath: string
  hitPath: string
  midpointX: number
  midpointY: number
  headPoints: string
  tier: PassMapFrequencyTier
  strokeWidth: number
  opacity: number
}

const PITCH_HOST_PADDING = 12
const FOCUSED_PITCH_GAP = 12
const FOCUSED_TEAM_LABEL_HEIGHT = 24
const TEAM_SIDES = ["home", "away"] as const satisfies readonly TeamSide[]
const FREQUENCY_STYLES = [
  { strokeWidth: 0.5, opacity: 0.3, headLength: 5.5, headHalfWidth: 2.5 },
  { strokeWidth: 0.75, opacity: 0.42, headLength: 6.5, headHalfWidth: 3 },
  { strokeWidth: 1.6, opacity: 0.64, headLength: 8.5, headHalfWidth: 4.25 },
  { strokeWidth: 3.4, opacity: 0.92, headLength: 11, headHalfWidth: 6 },
] as const
const BIDIRECTIONAL_LANE_OVERLAP = 0.35

export const PassMap = memo(function PassMap({
  match,
  isFocusMode,
  selectedTeam,
  selectedRange,
  onViewChange,
  onTeamChange,
  onRangeChange,
}: PassMapProps) {
  const { t } = useTranslation()
  const pitchDimensions = resolvePitchDimensions(match.pitchDimensions)
  const pitchFrameAspect = pitchDimensions.width / pitchDimensions.length
  const pitchHostRef = useRef<HTMLDivElement | null>(null)
  const [pitchSize, setPitchSize] = useState({ width: 0, height: 0 })
  const [hoveredEdgeByTeam, setHoveredEdgeByTeam] = useState<
    Partial<Record<TeamSide, string>>
  >({})
  const [selectedPlayerByTeam, setSelectedPlayerByTeam] = useState<
    Partial<Record<TeamSide, number>>
  >({})
  const playersById = useMemo(
    () => new Map(match.players.map((player) => [player.id, player])),
    [match.players]
  )
  const displayedTeams = isFocusMode ? TEAM_SIDES : ([selectedTeam] as const)
  const onPitchPlayerIdsKeyByTeam = TEAM_SIDES.reduce(
    (keys, team) => {
      keys[team] = match.players
        .filter((player) => player.team === team && player.isOnPitch)
        .map((player) => player.id)
        .sort((left, right) => left - right)
        .join(",")
      return keys
    },
    { home: "", away: "" } as Record<TeamSide, string>
  )
  const dataByTeam = useMemo(() => {
    const next: Partial<Record<TeamSide, PassMapData>> = {}
    for (const team of isFocusMode ? TEAM_SIDES : [selectedTeam]) {
      const playerIdsKey =
        team === "home"
          ? onPitchPlayerIdsKeyByTeam.home
          : onPitchPlayerIdsKeyByTeam.away
      next[team] = buildPassMapForPlayerIds(
        match.tacticalEvents,
        new Set(playerIdsKey ? playerIdsKey.split(",").map(Number) : []),
        team,
        selectedRange,
        match.clock.minute
      )
    }
    return next
  }, [
    isFocusMode,
    match.clock.minute,
    match.tacticalEvents,
    onPitchPlayerIdsKeyByTeam.away,
    onPitchPlayerIdsKeyByTeam.home,
    selectedRange,
    selectedTeam,
  ])
  const presentationByTeam = useMemo(() => {
    const next: Partial<
      Record<
        TeamSide,
        {
          activePlayerId: number | undefined
          edgeGeometry: EdgeGeometry[]
        }
      >
    > = {}
    for (const team of isFocusMode ? TEAM_SIDES : [selectedTeam]) {
      const data = dataByTeam[team]
      if (!data) continue
      const selectedPlayerId = selectedPlayerByTeam[team]
      const activePlayerId = data.nodes.some(
        (node) => node.playerId === selectedPlayerId
      )
        ? selectedPlayerId
        : undefined
      const edges = passMapEdgesForPlayer(data.edges, activePlayerId)
      next[team] = {
        activePlayerId,
        edgeGeometry: buildEdgeGeometry(
          data.nodes,
          edges,
          pitchSize,
          passMapFrequencyThresholds(data.edges)
        ),
      }
    }
    return next
  }, [
    dataByTeam,
    isFocusMode,
    pitchSize,
    selectedPlayerByTeam,
    selectedTeam,
  ])

  useEffect(() => {
    const host = pitchHostRef.current
    if (!host) return

    const updatePitchSize = () => {
      const contentWidth = Math.max(
        0,
        host.clientWidth - PITCH_HOST_PADDING * 2
      )
      const contentHeight = Math.max(
        0,
        host.clientHeight -
          PITCH_HOST_PADDING * 2 -
          (isFocusMode ? FOCUSED_TEAM_LABEL_HEIGHT : 0)
      )
      const availableWidth = isFocusMode
        ? Math.max(0, (contentWidth - FOCUSED_PITCH_GAP) / 2)
        : contentWidth
      const availableHeight = contentHeight
      if (availableWidth <= 0 || availableHeight <= 0) return
      const pitchRatio = pitchDimensions.width / pitchDimensions.length
      const availableRatio = availableWidth / availableHeight
      const nextSize =
        availableRatio > pitchRatio
          ? { width: availableHeight * pitchRatio, height: availableHeight }
          : { width: availableWidth, height: availableWidth / pitchRatio }
      setPitchSize((current) =>
        current.width === nextSize.width && current.height === nextSize.height
          ? current
          : nextSize
      )
    }

    const resizeObserver = new ResizeObserver(updatePitchSize)
    resizeObserver.observe(host)
    updatePitchSize()
    return () => resizeObserver.disconnect()
  }, [isFocusMode, pitchDimensions.length, pitchDimensions.width])

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <CardHeader className="shrink-0 grid-cols-[auto_1fr] items-center gap-2 border-b px-3 py-2">
        <CardTitle className="min-w-0 text-sm font-semibold">
          <button
            type="button"
            className="block w-full cursor-pointer truncate py-1 text-left hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            aria-label={t("mapView.switchToHeatmap")}
            onClick={() => onViewChange("heatmap")}
          >
            {t("panels.passMap")}
          </button>
        </CardTitle>
        <CardAction className="flex min-w-0 flex-nowrap items-center justify-end gap-1.5">
          <MapPanelControls
            selectedRange={selectedRange}
            selectedTeam={selectedTeam}
            onRangeChange={onRangeChange}
            onTeamChange={onTeamChange}
            showTeam={!isFocusMode}
          />
        </CardAction>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 p-0">
        <div
          ref={pitchHostRef}
          className={`${isFocusMode ? "grid grid-cols-2 gap-3" : "flex items-center justify-center"} min-h-0 min-w-0 flex-1 overflow-hidden p-3`}
        >
          {displayedTeams.map((team) => {
            const data = dataByTeam[team]
            const presentation = presentationByTeam[team]
            if (!data || !presentation) return null
            const hoveredEdge = presentation.edgeGeometry.find(
              (edge) => edge.key === hoveredEdgeByTeam[team]
            )
            const teamColor =
              match[team].color ??
              (team === "home"
                ? "var(--team-home-fallback)"
                : "var(--team-away-fallback)")

            return (
              <div
                key={team}
                className="flex min-h-0 min-w-0 flex-col items-center justify-center"
              >
                {isFocusMode && (
                  <div className="flex h-6 max-w-full shrink-0 items-start justify-center truncate px-2 text-xs font-semibold text-muted-foreground">
                    {match[team].name}
                  </div>
                )}
                <div
                  className="pitch-frame relative shrink-0 text-[var(--pitch-line)]"
                  style={
                    {
                      width: `${pitchSize.width}px`,
                      height: `${pitchSize.height}px`,
                      "--pitch-frame-aspect": pitchFrameAspect,
                    } as CSSProperties
                  }
                >
                  <div
                    className="player-pitch relative size-full bg-[var(--heatmap-pitch-surface)]"
                    onClick={() =>
                      setSelectedPlayerByTeam((current) => ({
                        ...current,
                        [team]: undefined,
                      }))
                    }
                  >
                    <PitchMarkings
                      dimensions={pitchDimensions}
                      orientation="vertical"
                    />

                    {pitchSize.width > 1 && pitchSize.height > 1 && (
                      <svg
                        className="absolute inset-0 size-full overflow-visible"
                        viewBox={`0 0 ${pitchSize.width} ${pitchSize.height}`}
                        preserveAspectRatio="none"
                        aria-label={t("passMap.networkLabel")}
                      >
                        {presentation.edgeGeometry.map((edge) => (
                          <g key={edge.key}>
                            <g
                              pointerEvents="none"
                              style={{
                                color: "var(--status-positive)",
                                opacity: edge.opacity,
                              }}
                            >
                              <path
                                d={edge.bodyPath}
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={edge.strokeWidth}
                                strokeLinecap="round"
                                vectorEffect="non-scaling-stroke"
                              />
                              <polygon
                                points={edge.headPoints}
                                fill="currentColor"
                              />
                            </g>
                            <path
                              d={edge.hitPath}
                              fill="none"
                              stroke="transparent"
                              strokeWidth={Math.max(14, edge.strokeWidth + 8)}
                              strokeLinecap="round"
                              vectorEffect="non-scaling-stroke"
                              className="cursor-default"
                              onPointerEnter={() =>
                                setHoveredEdgeByTeam((current) => ({
                                  ...current,
                                  [team]: edge.key,
                                }))
                              }
                              onPointerLeave={() =>
                                setHoveredEdgeByTeam((current) => ({
                                  ...current,
                                  [team]: undefined,
                                }))
                              }
                            />
                          </g>
                        ))}
                      </svg>
                    )}

                    {data.nodes.map((node) => {
                      const player = playersById.get(node.playerId)
                      if (!player) return null
                      return (
                        <PassMapPlayer
                          key={node.playerId}
                          node={node}
                          player={player}
                          teamColor={teamColor}
                          selected={
                            node.playerId === presentation.activePlayerId
                          }
                          onSelect={(playerId) =>
                            setSelectedPlayerByTeam((current) => ({
                              ...current,
                              [team]: playerId,
                            }))
                          }
                        />
                      )
                    })}

                    {data.nodes.length === 0 && (
                      <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center p-6 text-center text-xs text-muted-foreground">
                        {t("passMap.empty")}
                      </div>
                    )}

                    {hoveredEdge && (
                      <div
                        role="tooltip"
                        className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-[calc(100%+8px)] whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-[10px] font-medium text-popover-foreground shadow-lg"
                        style={{
                          left: `${hoveredEdge.midpointX}px`,
                          top: `${hoveredEdge.midpointY}px`,
                        }}
                      >
                        {t("passMap.edgeTooltip", {
                          passer:
                            playersById.get(hoveredEdge.passerId)?.name ?? "-",
                          receiver:
                            playersById.get(hoveredEdge.receiverId)?.name ?? "-",
                          count: hoveredEdge.count,
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </section>
  )
}, samePassMapProps)

function samePassMapProps(previous: PassMapProps, next: PassMapProps) {
  return (
    previous.isFocusMode === next.isFocusMode &&
    previous.selectedTeam === next.selectedTeam &&
    previous.selectedRange === next.selectedRange &&
    previous.onViewChange === next.onViewChange &&
    previous.onTeamChange === next.onTeamChange &&
    previous.onRangeChange === next.onRangeChange &&
    previous.match.matchId === next.match.matchId &&
    previous.match.clock.minute === next.match.clock.minute &&
    previous.match.tacticalEvents === next.match.tacticalEvents &&
    previous.match.pitchDimensions?.length ===
      next.match.pitchDimensions?.length &&
    previous.match.pitchDimensions?.width === next.match.pitchDimensions?.width &&
    previous.match.home.name === next.match.home.name &&
    previous.match.home.color === next.match.home.color &&
    previous.match.away.name === next.match.away.name &&
    previous.match.away.color === next.match.away.color &&
    samePassMapPlayers(previous.match.players, next.match.players)
  )
}

function samePassMapPlayers(
  previous: readonly MatchPlayer[],
  next: readonly MatchPlayer[]
) {
  return (
    previous === next ||
    (previous.length === next.length &&
      previous.every((player, index) => {
        const candidate = next[index]
        return (
          candidate != null &&
          player.id === candidate.id &&
          player.team === candidate.team &&
          player.isOnPitch === candidate.isOnPitch &&
          player.name === candidate.name &&
          player.shirtNumber === candidate.shirtNumber
        )
      }))
  )
}

function PassMapPlayer({
  node,
  player,
  teamColor,
  selected,
  onSelect,
}: {
  node: PassMapNode
  player: MatchPlayer
  teamColor: string
  selected: boolean
  onSelect: (playerId: number) => void
}) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      className={`group/pass-node absolute flex -translate-x-1/2 -translate-y-1/2 cursor-default flex-col items-center rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${selected ? "z-40" : "z-20"}`}
      style={{ left: `${node.x}%`, top: `${node.y}%` }}
      aria-pressed={selected}
      aria-label={t("passMap.playerTooltip", {
        player: player.name,
        attempts: node.attempts,
        rate: Math.round(node.successRate),
      })}
      onClick={(event) => {
        event.stopPropagation()
        onSelect(player.id)
      }}
    >
      <PitchPlayerBadge
        number={player.shirtNumber}
        numberColor="var(--heatmap-player-number)"
        className={`border-2 border-background shadow-md after:hidden transition-transform group-hover/pass-node:scale-110 ${selected ? "ring-2 ring-foreground ring-offset-2 ring-offset-background" : ""}`}
        style={{ backgroundColor: teamColor }}
      />
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-30 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-[10px] font-medium text-popover-foreground shadow-lg group-hover/pass-node:block group-focus-visible/pass-node:block"
      >
        {t("passMap.playerStats", {
          attempts: node.attempts,
          rate: Math.round(node.successRate),
        })}
      </span>
    </button>
  )
}

function buildEdgeGeometry(
  nodes: readonly PassMapNode[],
  edges: readonly PassMapEdge[],
  pitchSize: { width: number; height: number },
  frequencyThresholds: PassMapFrequencyThresholds
): EdgeGeometry[] {
  if (pitchSize.width <= 1 || pitchSize.height <= 1) return []
  const nodePositions = new Map(
    nodes.map((node) => [
      node.playerId,
      {
        x: (node.x / 100) * pitchSize.width,
        y: (node.y / 100) * pitchSize.height,
      },
    ])
  )
  const edgesByKey = new Map(
    edges.map((edge) => [`${edge.passerId}:${edge.receiverId}`, edge])
  )
  const playerRadius = Math.min(
    23,
    Math.max(11, Math.min(pitchSize.width, pitchSize.height) * 0.05 + 3)
  )

  const geometry = edges.flatMap((edge) => {
    const start = nodePositions.get(edge.passerId)
    const end = nodePositions.get(edge.receiverId)
    if (!start || !end) return []
    const deltaX = end.x - start.x
    const deltaY = end.y - start.y
    const length = Math.hypot(deltaX, deltaY)
    if (length < playerRadius * 2.5) return []
    const unitX = deltaX / length
    const unitY = deltaY / length
    const normalX = -unitY
    const normalY = unitX
    const reverseKey = `${edge.receiverId}:${edge.passerId}`
    const tier = passMapFrequencyTier(edge.count, frequencyThresholds)
    const { strokeWidth, opacity, headLength, headHalfWidth } =
      FREQUENCY_STYLES[tier]
    const reverseEdge = edgesByKey.get(reverseKey)
    const reverseStyle = reverseEdge
      ? FREQUENCY_STYLES[
          passMapFrequencyTier(reverseEdge.count, frequencyThresholds)
        ]
      : undefined
    const laneSeparation = reverseStyle
      ? Math.max(
          0,
          Math.min(
            headHalfWidth + reverseStyle.strokeWidth / 2,
            reverseStyle.headHalfWidth + strokeWidth / 2
          ) - BIDIRECTIONAL_LANE_OVERLAP
        )
      : 0
    const laneOffset = laneSeparation / 2
    const startRadius = playerRadius + 1
    const endRadius = playerRadius + 2
    const startTrim = Math.sqrt(
      Math.max(0, startRadius * startRadius - laneOffset * laneOffset)
    )
    const endTrim = Math.sqrt(
      Math.max(0, endRadius * endRadius - laneOffset * laneOffset)
    )
    if (length <= startTrim + endTrim + headLength + 2) return []
    const x1 = start.x + unitX * startTrim + normalX * laneOffset
    const y1 = start.y + unitY * startTrim + normalY * laneOffset
    const hitEndX = end.x - unitX * endTrim + normalX * laneOffset
    const hitEndY = end.y - unitY * endTrim + normalY * laneOffset
    const lineEndX = hitEndX - unitX * headLength
    const lineEndY = hitEndY - unitY * headLength
    const headPoints = [
      `${hitEndX},${hitEndY}`,
      `${lineEndX + normalX * headHalfWidth},${lineEndY + normalY * headHalfWidth}`,
      `${lineEndX - normalX * headHalfWidth},${lineEndY - normalY * headHalfWidth}`,
    ].join(" ")

    return [
      {
        ...edge,
        key: `${edge.passerId}:${edge.receiverId}`,
        bodyPath: `M ${x1} ${y1} L ${lineEndX} ${lineEndY}`,
        hitPath: `M ${x1} ${y1} L ${hitEndX} ${hitEndY}`,
        midpointX: (x1 + hitEndX) / 2,
        midpointY: (y1 + hitEndY) / 2,
        headPoints,
        tier,
        strokeWidth,
        opacity,
      },
    ]
  })

  return geometry.sort(
    (left, right) =>
      left.tier - right.tier ||
      left.count - right.count ||
      left.passerId - right.passerId ||
      left.receiverId - right.receiverId
  )
}
