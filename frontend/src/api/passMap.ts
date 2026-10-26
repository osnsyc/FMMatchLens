import type {
  MatchPlayer,
  PositionHeatmapRange,
  TacticalEventPoint,
  TeamSide,
} from "@/types/match"

export type PassMapNode = {
  playerId: number
  x: number
  y: number
  attempts: number
  completed: number
  successRate: number
}

export type PassMapEdge = {
  passerId: number
  receiverId: number
  count: number
}

export type PassMapData = {
  nodes: PassMapNode[]
  edges: PassMapEdge[]
}

export type PassMapFrequencyTier = 0 | 1 | 2 | 3
export type PassMapFrequencyThresholds = readonly [number, number, number]

type NodeAccumulator = {
  attempts: number
  completed: number
  positionSamples: number
  sumX: number
  sumY: number
}

const setPieceAnnotations = new Set([
  "corner",
  "attackingFreeKick",
  "defensiveFreeKick",
  "penaltyKick",
])
const SET_PIECE_FLAGS = 0x08 | 0x10 | 0x20 | 0x40

export function buildPassMap(
  events: readonly TacticalEventPoint[],
  players: readonly MatchPlayer[],
  team: TeamSide,
  range: PositionHeatmapRange,
  currentMinute: number
): PassMapData {
  const currentPlayerIds = new Set(
    players
      .filter((player) => player.team === team && player.isOnPitch)
      .map((player) => player.id)
  )
  return buildPassMapForPlayerIds(
    events,
    currentPlayerIds,
    team,
    range,
    currentMinute
  )
}

export function buildPassMapForPlayerIds(
  events: readonly TacticalEventPoint[],
  currentPlayerIds: ReadonlySet<number>,
  team: TeamSide,
  range: PositionHeatmapRange,
  currentMinute: number
): PassMapData {
  const rangeStart = passMapRangeStart(range, currentMinute)
  const nodes = new Map<number, NodeAccumulator>()
  const edges = new Map<string, PassMapEdge>()

  for (const event of events) {
    if (
      event.team !== team ||
      !currentPlayerIds.has(event.playerId) ||
      event.minute < rangeStart ||
      event.minute > currentMinute ||
      !isOpenPlayPass(event)
    )
      continue

    const accumulator = nodes.get(event.playerId) ?? {
      attempts: 0,
      completed: 0,
      positionSamples: 0,
      sumX: 0,
      sumY: 0,
    }
    accumulator.attempts += 1
    if (isCompletedPass(event)) accumulator.completed += 1
    if (Number.isFinite(event.x) && Number.isFinite(event.y)) {
      accumulator.positionSamples += 1
      accumulator.sumX += clampPercentage(event.y)
      accumulator.sumY += 100 - clampPercentage(event.x)
    }
    nodes.set(event.playerId, accumulator)

    const receiverId = event.receiverPlayerId
    if (
      receiverId == null ||
      receiverId === event.playerId ||
      !currentPlayerIds.has(receiverId)
    )
      continue
    const edgeKey = `${event.playerId}:${receiverId}`
    const edge = edges.get(edgeKey)
    if (edge) edge.count += 1
    else
      edges.set(edgeKey, {
        passerId: event.playerId,
        receiverId,
        count: 1,
      })
  }

  const outputNodes = [...nodes]
    .filter(([, value]) => value.positionSamples > 0)
    .map(([playerId, value]) => ({
      playerId,
      x: value.sumX / value.positionSamples,
      y: value.sumY / value.positionSamples,
      attempts: value.attempts,
      completed: value.completed,
      successRate:
        value.attempts > 0 ? (value.completed / value.attempts) * 100 : 0,
    }))
  const positionedPlayerIds = new Set(outputNodes.map((node) => node.playerId))

  return {
    nodes: outputNodes,
    edges: [...edges.values()].filter(
      (edge) =>
        positionedPlayerIds.has(edge.passerId) &&
        positionedPlayerIds.has(edge.receiverId)
    ),
  }
}

export function isOpenPlayPass(event: TacticalEventPoint) {
  return (
    event.nativeEventType >= 6 &&
    event.nativeEventType <= 11 &&
    (event.metricId === "passesCompleted" ||
      event.metricId === "passesIncomplete") &&
    (event.flags & SET_PIECE_FLAGS) === 0 &&
    !(event.annotations ?? []).some((annotation) =>
      setPieceAnnotations.has(annotation)
    )
  )
}

export function passMapFrequencyThresholds(
  edges: readonly PassMapEdge[]
): PassMapFrequencyThresholds {
  if (edges.length === 0) return [0, 0, 0]
  const counts = edges
    .map((edge) => edge.count)
    .sort((left, right) => left - right)
  return [
    nearestRank(counts, 0.25),
    nearestRank(counts, 0.5),
    nearestRank(counts, 0.75),
  ]
}

export function passMapFrequencyTier(
  count: number,
  thresholds: PassMapFrequencyThresholds
): PassMapFrequencyTier {
  if (count <= thresholds[0]) return 0
  if (count <= thresholds[1]) return 1
  if (count <= thresholds[2]) return 2
  return 3
}

export function passMapEdgesForPlayer(
  edges: readonly PassMapEdge[],
  playerId: number | undefined
): PassMapEdge[] {
  if (playerId == null) return [...edges]
  return edges.filter(
    (edge) => edge.passerId === playerId || edge.receiverId === playerId
  )
}

function isCompletedPass(event: TacticalEventPoint) {
  return (
    event.metricId === "passesCompleted" ||
    event.metricIds?.includes("passesCompleted") === true
  )
}

function passMapRangeStart(
  range: PositionHeatmapRange,
  currentMinute: number
) {
  if (range === "recent15") return Math.max(0, currentMinute - 15)
  if (range === "half") {
    if (currentMinute < 45) return 0
    if (currentMinute < 90) return 45
    if (currentMinute < 105) return 90
    return 105
  }
  return 0
}

function clampPercentage(value: number) {
  return Math.min(100, Math.max(0, value))
}

function nearestRank(values: readonly number[], percentile: number) {
  const index = Math.max(
    0,
    Math.min(values.length - 1, Math.ceil(values.length * percentile) - 1)
  )
  return values[index]
}
