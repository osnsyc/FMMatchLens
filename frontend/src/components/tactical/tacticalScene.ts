import type {
  TacticalEventMetricId,
  TacticalEventPoint,
  TeamSide,
} from "@/types/match"

export type DataGroupId =
  | "shots"
  | "distribution"
  | "defensive"
  | "possession"
  | "discipline"
  | "goalkeeping"

export type Shape =
  "square" | "circle" | "triangle" | "triangle-down" | "pentagon" | "diamond"

export type MarkerVariant =
  "solid" | "outline" | "important" | "dashed" | "contrast" | "double"

export type DataMetric = {
  id: TacticalEventMetricId
  label: string
  group: DataGroupId
  shape: Shape
  variant: MarkerVariant
  scale?: number
}

export type TacticalRenderPoint = {
  id: string
  playerId: number
  receiverPlayerId?: number
  team: TeamSide
  metricId: TacticalEventMetricId
  group: DataGroupId
  shape: Shape
  variant: MarkerVariant
  x: number
  y: number
  anchorX?: number
  anchorY?: number
  endX?: number
  endY?: number
  trajectoryStartX?: number
  trajectoryStartY?: number
  trajectoryPoints?: Array<{ x: number; y: number }>
  showTrajectory: boolean
  size: number
  tick: number
  displayTick: number
  counterpart?: {
    playerId: number
    team: TeamSide
    metricId: TacticalEventMetricId
  }
}

export type ShotChain = {
  id: string
  shotEventId: string
  team: TeamSide
  events: TacticalEventPoint[]
}

export type TacticalScene = {
  points: TacticalRenderPoint[]
  sourceEventIds: ReadonlySet<string>
}

export const groups: Array<{
  id: DataGroupId
  label: string
  shape: Shape
}> = [
  { id: "shots", label: "Shots", shape: "square" },
  { id: "distribution", label: "Distribution", shape: "circle" },
  { id: "defensive", label: "Defensive", shape: "triangle" },
  { id: "possession", label: "Possession", shape: "triangle-down" },
  { id: "discipline", label: "Discipline", shape: "pentagon" },
  { id: "goalkeeping", label: "Goalkeeping", shape: "diamond" },
]

export const metrics: DataMetric[] = [
  {
    id: "goals",
    label: "Goals",
    group: "shots",
    shape: "square",
    variant: "important",
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
    variant: "important",
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
  {
    id: "passesCompleted",
    label: "Completed passes",
    group: "distribution",
    shape: "circle",
    variant: "solid",
    scale: 0.65,
  },
  {
    id: "passesIncomplete",
    label: "Incomplete passes",
    group: "distribution",
    shape: "circle",
    variant: "outline",
    scale: 0.65,
  },
  {
    id: "keyPasses",
    label: "Key passes",
    group: "distribution",
    shape: "circle",
    variant: "important",
    scale: 0.8,
  },
  {
    id: "crossesCompleted",
    label: "Completed crosses",
    group: "distribution",
    shape: "circle",
    variant: "double",
    scale: 0.8,
  },
  {
    id: "crossesIncomplete",
    label: "Incomplete crosses",
    group: "distribution",
    shape: "circle",
    variant: "dashed",
    scale: 0.8,
  },
  {
    id: "tacklesWon",
    label: "Tackles won",
    group: "defensive",
    shape: "triangle",
    variant: "solid",
    scale: 0.8,
  },
  {
    id: "tacklesLost",
    label: "Tackles lost",
    group: "defensive",
    shape: "triangle",
    variant: "outline",
    scale: 0.8,
  },
  {
    id: "aerialsWon",
    label: "Aerial duels won",
    group: "defensive",
    shape: "triangle",
    variant: "contrast",
    scale: 0.8,
  },
  {
    id: "aerialsLost",
    label: "Aerial duels lost",
    group: "defensive",
    shape: "triangle",
    variant: "dashed",
    scale: 0.8,
  },
  {
    id: "interceptions",
    label: "Interceptions",
    group: "defensive",
    shape: "triangle",
    variant: "double",
    scale: 0.8,
  },
  {
    id: "clearances",
    label: "Clearances",
    group: "defensive",
    shape: "triangle",
    variant: "important",
    scale: 0.8,
  },
  {
    id: "defensiveBlocks",
    label: "Defensive blocks",
    group: "defensive",
    shape: "triangle",
    variant: "dashed",
    scale: 0.8,
  },
  {
    id: "dribblesCompleted",
    label: "Completed dribbles",
    group: "possession",
    shape: "triangle-down",
    variant: "solid",
    scale: 0.8,
  },
  {
    id: "possessionGained",
    label: "Possession gained",
    group: "possession",
    shape: "triangle-down",
    variant: "important",
    scale: 0.8,
  },
  {
    id: "possessionLost",
    label: "Possession lost",
    group: "possession",
    shape: "triangle-down",
    variant: "outline",
    scale: 0.8,
  },
  {
    id: "touches",
    label: "Specific touches",
    group: "possession",
    shape: "triangle-down",
    variant: "contrast",
    scale: 0.7,
  },
  {
    id: "foulsCommitted",
    label: "Fouls committed",
    group: "discipline",
    shape: "pentagon",
    variant: "dashed",
    scale: 0.85,
  },
  {
    id: "fouled",
    label: "Fouled",
    group: "discipline",
    shape: "pentagon",
    variant: "contrast",
    scale: 0.85,
  },
  {
    id: "offsides",
    label: "Offsides",
    group: "discipline",
    shape: "pentagon",
    variant: "outline",
    scale: 0.85,
  },
  {
    id: "goalkeeperSavesHeld",
    label: "Saves held",
    group: "goalkeeping",
    shape: "diamond",
    variant: "solid",
    scale: 0.9,
  },
  {
    id: "goalkeeperSavesParried",
    label: "Saves parried",
    group: "goalkeeping",
    shape: "diamond",
    variant: "outline",
    scale: 0.9,
  },
]

export const metricById = new Map(metrics.map((metric) => [metric.id, metric]))

export const initialSelectedMetrics = Object.fromEntries(
  metrics.map((metric) => [metric.id, metric.group === "shots"])
) as Record<string, boolean>

const maxShotChainLookbackTicks = 120
const shotChainRestartFlags = 0x08 | 0x10 | 0x20

const pairingRules: Array<{
  display: TacticalEventMetricId
  hidden: TacticalEventMetricId
}> = [
  { display: "fouled", hidden: "foulsCommitted" },
  { display: "aerialsWon", hidden: "aerialsLost" },
]

export function buildTacticalScene(
  events: readonly TacticalEventPoint[],
  selectedMetrics: Readonly<Record<string, boolean>>
): TacticalScene {
  const sourceEventIds = new Set<string>()
  const eventsByMetric = new Map<TacticalEventMetricId, TacticalEventPoint[]>()
  for (const event of events) {
    sourceEventIds.add(event.id)
    const bucket = eventsByMetric.get(event.metricId)
    if (bucket) bucket.push(event)
    else eventsByMetric.set(event.metricId, [event])
  }

  const hiddenEventIds = new Set<string>()
  const counterpartByEventId = new Map<string, TacticalEventPoint>()
  for (const rule of pairingRules) {
    if (!selectedMetrics[rule.display] || !selectedMetrics[rule.hidden])
      continue
    const hiddenByTick = new Map<number, TacticalEventPoint[]>()
    for (const event of eventsByMetric.get(rule.hidden) ?? []) {
      const bucket = hiddenByTick.get(event.tick)
      if (bucket) bucket.push(event)
      else hiddenByTick.set(event.tick, [event])
    }
    for (const event of eventsByMetric.get(rule.display) ?? []) {
      const candidates = hiddenByTick.get(event.tick)
      if (!candidates) continue
      const counterpartIndex = candidates.findIndex(
        (candidate) => candidate.team !== event.team
      )
      if (counterpartIndex < 0) continue
      const [counterpart] = candidates.splice(counterpartIndex, 1)
      counterpartByEventId.set(event.id, counterpart)
      hiddenEventIds.add(counterpart.id)
    }
  }

  const points: TacticalRenderPoint[] = []
  for (const event of events) {
    if (hiddenEventIds.has(event.id)) continue
    let metric: DataMetric | undefined
    if (event.metricIds) {
      for (let index = event.metricIds.length - 1; index >= 0; index -= 1) {
        const candidateId = event.metricIds[index]
        if (!selectedMetrics[candidateId]) continue
        metric = metricById.get(candidateId)
        if (metric) break
      }
    } else if (selectedMetrics[event.metricId]) {
      metric = metricById.get(event.metricId)
    }
    if (!metric) continue

    const counterpartEvent = counterpartByEventId.get(event.id)
    const counterpartMetric = counterpartEvent
      ? metricById.get(counterpartEvent.metricId)
      : undefined
    points.push(
      renderPointForEvent(event, metric, counterpartEvent, counterpartMetric)
    )
  }

  return { points, sourceEventIds }
}

export function buildShotChainRenderPoints(chains: readonly ShotChain[]) {
  const historicalEvents = new Map<string, TacticalEventPoint>()
  for (const chain of chains) {
    for (let index = 0; index < chain.events.length - 1; index += 1) {
      const event = chain.events[index]
      historicalEvents.set(event.id, event)
    }
  }

  const points: TacticalRenderPoint[] = []
  for (const event of historicalEvents.values()) {
    const metricId = event.metricIds?.includes("keyPasses")
      ? "keyPasses"
      : event.metricId
    const metric = metricById.get(metricId)
    if (metric) {
      const point = renderPointForEvent(event, metric)
      point.size = Math.max(13, 15 * (metric.scale ?? 1))
      points.push(point)
    }
  }
  return points
}

export function renderPointForEvent(
  event: TacticalEventPoint,
  metric: DataMetric,
  counterpartEvent?: TacticalEventPoint,
  counterpartMetric?: DataMetric
): TacticalRenderPoint {
  return {
    id: event.id,
    playerId: event.playerId,
    receiverPlayerId: event.receiverPlayerId,
    team: event.team,
    metricId: metric.id,
    group: metric.group,
    shape: metric.shape,
    variant: metric.variant,
    x: event.x,
    y: event.y,
    anchorX: event.anchorX,
    anchorY: event.anchorY,
    trajectoryStartX: event.trajectoryStartX,
    trajectoryStartY: event.trajectoryStartY,
    trajectoryPoints: event.trajectoryPoints,
    endX: event.endX,
    endY: event.endY,
    showTrajectory:
      metric.id === "dribblesCompleted" ||
      metric.group === "shots" ||
      metric.group === "distribution",
    size: Math.max(15, 17 * (metric.scale ?? 1)),
    tick: event.tick,
    displayTick: event.displayTick,
    counterpart:
      counterpartEvent && counterpartMetric
        ? {
            playerId: counterpartEvent.playerId,
            team: counterpartEvent.team,
            metricId: counterpartMetric.id,
          }
        : undefined,
  }
}

export function buildShotChains(
  events: readonly TacticalEventPoint[],
  selectedMetrics: Readonly<Record<string, boolean>>
): ShotChain[] {
  const ordered = [...events].sort((left, right) => {
    const leftOrder = left.sequenceIndex ?? left.tick
    const rightOrder = right.sequenceIndex ?? right.tick
    return leftOrder - rightOrder || left.tick - right.tick
  })
  const chains: ShotChain[] = []

  for (let shotIndex = 0; shotIndex < ordered.length; shotIndex += 1) {
    const shot = ordered[shotIndex]
    if (!isShotEvent(shot.nativeEventType) || !selectedMetrics[shot.metricId])
      continue

    const previousActions: TacticalEventPoint[] = []
    for (let index = shotIndex - 1; index >= 0; index -= 1) {
      const candidate = ordered[index]
      if (
        shot.tick - candidate.tick > maxShotChainLookbackTicks ||
        isShotChainBoundary(candidate.nativeEventType)
      )
        break

      const passOrDribble =
        isPassEvent(candidate.nativeEventType) ||
        candidate.nativeEventType === 34
      if (!passOrDribble) continue
      if (candidate.team !== shot.team) break

      previousActions.unshift(candidate)
      if (
        previousActions.length === 3 ||
        (candidate.flags & shotChainRestartFlags) !== 0
      )
        break
    }
    if (previousActions.length === 0) continue

    chains.push({
      id: `shot-chain-${shot.id}`,
      shotEventId: shot.id,
      team: shot.team,
      events: [...previousActions, shot],
    })
  }

  return chains
}

function isShotEvent(eventType: number) {
  return eventType >= 1 && eventType <= 5
}

function isPassEvent(eventType: number) {
  return eventType >= 6 && eventType <= 17
}

function isShotChainBoundary(eventType: number) {
  return (
    isShotEvent(eventType) ||
    (eventType >= 18 && eventType <= 21) ||
    eventType === 23 ||
    eventType === 52 ||
    eventType === 53
  )
}

export function deduplicateTrajectoryPoints(
  points: Array<{ x: number; y: number }>
) {
  const unique: Array<{ x: number; y: number }> = []
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue
    if (
      unique.some(
        (existing) =>
          Math.hypot(existing.x - point.x, existing.y - point.y) < 0.01
      )
    )
      continue
    unique.push(point)
  }
  return unique
}
