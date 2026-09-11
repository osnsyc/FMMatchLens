import { HeatmapDerivations, type HeatmapDerivationsState } from "@/api/heatmap"
import {
  sameMomentumEvent,
  sameMomentumPoint,
  streamRevision,
} from "@/api/replay/replayPreprocessor"
import type {
  HistoricalDerivationSnapshot,
  ReplayStreamRevision,
  StreamRevision,
} from "@/api/replay/replayTypes"
import type {
  RealtimeFrame,
  RealtimeMomentumEvent,
  RealtimeMomentumPoint,
} from "@/api/realtimeMatch"
import type {
  MatchEvent,
  MatchMomentumPoint,
  TacticalEventPoint,
  TeamSide,
  XgTimelinePoint,
} from "@/types/match"

export type HistoricalDerivationsState = {
  previous?: RealtimeFrame
  xg: XgTimelinePoint[]
  events: MatchEvent[]
  tactical: Array<[number, TacticalEventPoint]>
  momentum: Array<[number, MatchMomentumPoint]>
  rollingMomentum: Array<[number, MatchMomentumPoint]>
  nativeStream: RealtimeMomentumEvent[]
  momentumStream: RealtimeMomentumPoint[]
  rollingStream: RealtimeMomentumPoint[]
  heatmaps: HeatmapDerivationsState
}

/** Shared incremental history engine used by both live capture and replay. */
export class HistoricalDerivations {
  private previous?: RealtimeFrame
  private xg: XgTimelinePoint[] = [{ minute: 0, home: 0, away: 0 }]
  private events: MatchEvent[] = []
  private tactical = new Map<number, TacticalEventPoint>()
  private momentum = new Map<number, MatchMomentumPoint>()
  private rollingMomentum = new Map<number, MatchMomentumPoint>()
  private nativeStream: RealtimeMomentumEvent[] = []
  private momentumStream: RealtimeMomentumPoint[] = []
  private rollingStream: RealtimeMomentumPoint[] = []
  private heatmaps = new HeatmapDerivations()
  private tacticalOutput: TacticalEventPoint[] = []
  private momentumOutput: MatchMomentumPoint[] = []
  private rollingOutput: MatchMomentumPoint[] = []
  private xgOutput: XgTimelinePoint[] = this.xg.slice()
  private eventsOutput: MatchEvent[] = []
  private tacticalDirty = true
  private momentumDirty = true
  private rollingDirty = true
  private xgDirty = true
  private eventsDirty = true
  private momentumNextChangeTick = Number.NEGATIVE_INFINITY

  reset() {
    this.previous = undefined
    this.xg = [{ minute: 0, home: 0, away: 0 }]
    this.events = []
    this.tactical.clear()
    this.momentum.clear()
    this.rollingMomentum.clear()
    this.nativeStream = []
    this.momentumStream = []
    this.rollingStream = []
    this.heatmaps.reset()
    this.markAllDirty()
  }

  append(frames: readonly RealtimeFrame[]) {
    this.appendRange(frames, 0, frames.length - 1)
  }

  appendRange(
    frames: readonly RealtimeFrame[],
    fromInclusive: number,
    toInclusive: number
  ) {
    const start = Math.max(0, fromInclusive)
    const end = Math.min(frames.length - 1, toInclusive)
    for (let index = start; index <= end; index += 1) {
      this.appendFrame(frames[index])
    }
  }

  appendFrame(frame: RealtimeFrame, revision?: ReplayStreamRevision) {
    const streams = revision ?? {
      momentumEvents: streamRevision(
        this.nativeStream,
        frame.momentumEvents,
        sameMomentumEvent
      ),
      momentum: streamRevision(
        this.momentumStream,
        frame.momentum,
        sameMomentumPoint
      ),
      rollingMomentum: streamRevision(
        this.rollingStream,
        frame.rollingMomentum,
        sameMomentumPoint
      ),
    }

    this.appendXg(frame)
    this.applyMomentumRevision(streams.momentum, false)
    this.applyMomentumRevision(streams.rollingMomentum, true)
    this.applyNativeRevision(frame, streams.momentumEvents)
    if (this.previous) this.appendMatchEvents(this.previous, frame)
    this.heatmaps.appendFrame(frame)
    this.previous = frame
  }

  snapshot(currentTick: number): HistoricalDerivationSnapshot {
    if (this.xgDirty) {
      this.xgOutput = this.xg.slice()
      this.xgDirty = false
    }
    if (this.eventsDirty) {
      this.eventsOutput = this.events.slice()
      this.eventsDirty = false
    }
    if (this.tacticalDirty) {
      this.tacticalOutput = [...this.tactical.values()].sort(
        (left, right) => left.tick - right.tick
      )
      this.tacticalDirty = false
    }
    if (this.momentumDirty || currentTick >= this.momentumNextChangeTick) {
      const points = [...this.momentum.values()].sort(
        (left, right) => left.timeTicks - right.timeTicks
      )
      const cutoff = currentTick + 1_200
      this.momentumOutput = points.filter((point) => point.timeTicks <= cutoff)
      const nextFuturePoint = points.find((point) => point.timeTicks > cutoff)
      this.momentumNextChangeTick = nextFuturePoint
        ? nextFuturePoint.timeTicks - 1_200
        : Number.POSITIVE_INFINITY
      this.momentumDirty = false
    }
    if (this.rollingDirty) {
      this.rollingOutput = [...this.rollingMomentum.values()].sort(
        (left, right) => left.timeTicks - right.timeTicks
      )
      this.rollingDirty = false
    }
    return {
      xgTimeline: this.xgOutput,
      events: this.eventsOutput,
      tacticalEvents: this.tacticalOutput,
      heatmaps: this.heatmaps.snapshot(),
      momentum: this.momentumOutput,
      rollingMomentum: this.rollingOutput,
    }
  }

  exportState(): HistoricalDerivationsState {
    return {
      previous: this.previous,
      xg: this.xg.slice(),
      events: this.events.slice(),
      tactical: [...this.tactical],
      momentum: [...this.momentum],
      rollingMomentum: [...this.rollingMomentum],
      nativeStream: this.nativeStream.slice(),
      momentumStream: this.momentumStream.slice(),
      rollingStream: this.rollingStream.slice(),
      heatmaps: this.heatmaps.exportState(),
    }
  }

  restoreState(state: HistoricalDerivationsState) {
    this.previous = state.previous
    this.xg = state.xg.slice()
    this.events = state.events.slice()
    this.tactical = new Map(state.tactical)
    this.momentum = new Map(state.momentum)
    this.rollingMomentum = new Map(state.rollingMomentum)
    this.nativeStream = state.nativeStream.slice()
    this.momentumStream = state.momentumStream.slice()
    this.rollingStream = state.rollingStream.slice()
    this.heatmaps.restoreState(state.heatmaps)
    this.markAllDirty()
  }

  private markAllDirty() {
    this.tacticalDirty = true
    this.momentumDirty = true
    this.rollingDirty = true
    this.xgDirty = true
    this.eventsDirty = true
    this.momentumNextChangeTick = Number.NEGATIVE_INFINITY
  }

  private appendXg(frame: RealtimeFrame) {
    const point = {
      minute: frameMinute(frame),
      home: frame.home.xg,
      away: frame.away.xg,
    }
    const last = this.xg.at(-1)
    if (last?.minute === point.minute) {
      if (last.home === point.home && last.away === point.away) return
      this.xg[this.xg.length - 1] = point
    } else {
      this.xg.push(point)
    }
    this.xgDirty = true
  }

  private applyMomentumRevision(
    revision: StreamRevision<RealtimeMomentumPoint>,
    rolling: boolean
  ) {
    const stream = rolling ? this.rollingStream : this.momentumStream
    const output = rolling ? this.rollingMomentum : this.momentum
    // These arrays are bounded current buffers, not authoritative complete
    // histories. Items falling out of a native buffer remain part of the
    // accumulated match timeline.
    stream.length = revision.commonLength
    for (const point of revision.tail) {
      stream.push(point)
      if (!Number.isFinite(point.value) || !Number.isFinite(point.timeTicks))
        continue
      output.set(point.timeTicks, {
        ...point,
        minute: rolling ? point.timeTicks / 240 : (point.timeTicks + 1) / 240,
      })
    }
    if (revision.tail.length > 0) {
      if (rolling) this.rollingDirty = true
      else this.momentumDirty = true
    }
  }

  private applyNativeRevision(
    frame: RealtimeFrame,
    revision: StreamRevision<RealtimeMomentumEvent>
  ) {
    // MomentumEvents is capped by the capture layer. Buffer rotation must not
    // erase historical render points. A later item with the same eventIndex
    // still replaces the point below.
    this.nativeStream.length = revision.commonLength
    for (const event of revision.tail) {
      this.nativeStream.push(event)
      const point = nativeMomentumEventToTacticalPoint(frame, event)
      if (point) this.tactical.set(event.eventIndex, point)
    }
    if (revision.tail.length > 0) this.tacticalDirty = true
  }

  private appendMatchEvents(previous: RealtimeFrame, frame: RealtimeFrame) {
    const previousEventCount = this.events.length
    const previousPlayers = new Map(
      previous.players.map((player) => [player.playerId, player])
    )
    let identifiedHomeGoals = 0
    let identifiedAwayGoals = 0
    for (const player of frame.players) {
      const old = previousPlayers.get(player.playerId)
      if (!old) continue
      const goalDelta = Math.max(0, player.goals - old.goals)
      const assistDelta = Math.max(0, player.assists - old.assists)
      const ownGoalDelta = Math.max(0, player.ownGoals - old.ownGoals)
      for (let count = 0; count < goalDelta; count += 1) {
        this.events.push({
          id: `${frame.matchId}-player-${player.playerId}-goal-${player.goals - goalDelta + count + 1}-${frame.tick}`,
          type: "goal",
          minute: frameMinute(frame),
          tick: frame.tick,
          team: player.team,
          playerId: player.playerId,
        })
        if (player.team === "home") identifiedHomeGoals += 1
        else identifiedAwayGoals += 1
      }
      for (let count = 0; count < assistDelta; count += 1) {
        this.events.push({
          id: `${frame.matchId}-player-${player.playerId}-assist-${player.assists - assistDelta + count + 1}-${frame.tick}`,
          type: "assist_candidate",
          minute: frameMinute(frame),
          tick: frame.tick,
          team: player.team,
          playerId: player.playerId,
        })
      }
      for (let count = 0; count < ownGoalDelta; count += 1) {
        const scoringTeam = oppositeTeam(player.team)
        this.events.push({
          id: `${frame.matchId}-player-${player.playerId}-own-goal-${frame.tick}-${count}`,
          type: "own_goal",
          minute: frameMinute(frame),
          tick: frame.tick,
          team: player.team,
          playerId: player.playerId,
        })
        if (scoringTeam === "home") identifiedHomeGoals += 1
        else identifiedAwayGoals += 1
      }
    }
    appendUnidentifiedGoals(
      this.events,
      frame,
      "home",
      Math.max(0, frame.home.goals - previous.home.goals - identifiedHomeGoals)
    )
    appendUnidentifiedGoals(
      this.events,
      frame,
      "away",
      Math.max(0, frame.away.goals - previous.away.goals - identifiedAwayGoals)
    )
    if (this.events.length !== previousEventCount) this.eventsDirty = true
  }
}

export function nativeMomentumEventToTacticalPoint(
  frame: RealtimeFrame,
  item: RealtimeMomentumEvent
): TacticalEventPoint | undefined {
  const halfWidth = validPitchHalf(frame.halfPitchWidth)
  const halfLength = validPitchHalf(frame.halfPitchLength)
  const metricId = nativeMomentumEventMetric(item.eventType)
  if (!halfWidth || !halfLength || !metricId) return undefined
  const rotate = nativeMomentumEventNeedsDisplayRotation(item)
  const rotateValue = (value: number | null | undefined) => {
    const finite = finiteCoordinate(value)
    return finite == null ? undefined : rotate ? -finite : finite
  }
  const anchorLateral = rotate ? -item.lateralPosition : item.lateralPosition
  const anchorLongitudinal = rotate
    ? -item.longitudinalPosition
    : item.longitudinalPosition
  const startLateral = rotateValue(item.trajectoryStartLateralPosition)
  const startLongitudinal = rotateValue(
    item.trajectoryStartLongitudinalPosition
  )
  const endLateral = rotateValue(item.trajectoryEndLateralPosition)
  const endLongitudinal = rotateValue(item.trajectoryEndLongitudinalPosition)
  const displayTick = nativeMomentumEventDisplayTick(frame, item)
  return {
    id: `${frame.matchId}-native-momentum-${item.eventIndex}`,
    metricId,
    metricIds: nativeMomentumEventMetricIds(item, metricId),
    playerId: item.playerId,
    receiverPlayerId: item.receiverPlayerId || undefined,
    team: item.team,
    tick: item.tick,
    displayTick,
    minute: Math.floor(displayTick / 240),
    x: normalize(anchorLongitudinal, -halfLength, halfLength),
    y: normalize(anchorLateral, -halfWidth, halfWidth),
    anchorX: normalize(anchorLongitudinal, -halfLength, halfLength),
    anchorY: normalize(anchorLateral, -halfWidth, halfWidth),
    trajectoryStartX:
      startLongitudinal == null
        ? undefined
        : normalize(startLongitudinal, -halfLength, halfLength),
    trajectoryStartY:
      startLateral == null
        ? undefined
        : normalize(startLateral, -halfWidth, halfWidth),
    trajectoryPoints: normalizeMomentumTrajectory(
      item,
      rotate,
      halfWidth,
      halfLength
    ),
    endX:
      endLongitudinal == null
        ? undefined
        : normalize(endLongitudinal, -halfLength, halfLength),
    endY:
      endLateral == null
        ? undefined
        : normalize(endLateral, -halfWidth, halfWidth),
    nativeEventType: item.eventType,
    flags: item.flags,
    sequenceIndex: item.sequenceIndex,
  }
}

function nativeMomentumEventMetric(
  eventType: number
): TacticalEventPoint["metricId"] | undefined {
  const metrics: Partial<Record<number, TacticalEventPoint["metricId"]>> = {
    1: "goals",
    2: "shotsOffTarget",
    3: "hitWoodwork",
    4: "shotsOnTarget",
    5: "blockedShots",
    6: "passesIncomplete",
    7: "passesCompleted",
    8: "passesIncomplete",
    9: "passesIncomplete",
    10: "passesIncomplete",
    11: "passesIncomplete",
    12: "crossesCompleted",
    13: "crossesIncomplete",
    14: "crossesIncomplete",
    15: "crossesIncomplete",
    16: "crossesIncomplete",
    17: "crossesIncomplete",
    18: "fouled",
    19: "foulsCommitted",
    20: "foulsCommitted",
    21: "foulsCommitted",
    23: "offsides",
    24: "clearances",
    25: "defensiveBlocks",
    26: "tacklesWon",
    27: "tacklesLost",
    28: "aerialsWon",
    29: "aerialsLost",
    31: "interceptions",
    34: "dribblesCompleted",
    37: "goalkeeperSavesHeld",
    38: "goalkeeperSavesParried",
    52: "possessionGained",
    53: "possessionLost",
    54: "touches",
  }
  return metrics[eventType]
}

function nativeMomentumEventMetricIds(
  item: RealtimeMomentumEvent,
  primary: TacticalEventPoint["metricId"]
) {
  return item.eventType >= 6 &&
    item.eventType <= 17 &&
    (item.flags & 0x02) !== 0
    ? [primary, "keyPasses" as const]
    : [primary]
}

function nativeMomentumEventNeedsDisplayRotation(item: RealtimeMomentumEvent) {
  const reverseDirection = (item.flags & 0x100) !== 0
  return item.team === "home" ? !reverseDirection : reverseDirection
}

function nativeMomentumEventDisplayTick(
  frame: RealtimeFrame,
  item: RealtimeMomentumEvent
) {
  const reverseDirection = (item.flags & 0x100) !== 0
  const secondPeriodDirection =
    item.team === "home" ? reverseDirection : !reverseDirection
  if (!secondPeriodDirection || frame.period < 2) return Math.max(0, item.tick)
  return Math.max(0, item.tick - Math.max(0, frame.tick - frame.displayTick))
}

function normalizeMomentumTrajectory(
  event: RealtimeMomentumEvent,
  rotate: boolean,
  halfWidth: number,
  halfLength: number
) {
  let points = (event.trajectoryPoints ?? []).filter(
    (point) =>
      Number.isFinite(point.lateralPosition) &&
      Number.isFinite(point.longitudinalPosition)
  )
  if (points.length === 0) {
    const startLateral = finiteCoordinate(event.trajectoryStartLateralPosition)
    const startLongitudinal = finiteCoordinate(
      event.trajectoryStartLongitudinalPosition
    )
    const endLateral = finiteCoordinate(event.trajectoryEndLateralPosition)
    const endLongitudinal = finiteCoordinate(
      event.trajectoryEndLongitudinalPosition
    )
    if (
      startLateral != null &&
      startLongitudinal != null &&
      endLateral != null &&
      endLongitudinal != null
    ) {
      points = [
        {
          lateralPosition: startLateral,
          longitudinalPosition: startLongitudinal,
        },
        { lateralPosition: endLateral, longitudinalPosition: endLongitudinal },
      ]
    }
  }
  return points.map((point) => ({
    x: normalize(
      rotate ? -point.longitudinalPosition : point.longitudinalPosition,
      -halfLength,
      halfLength
    ),
    y: normalize(
      rotate ? -point.lateralPosition : point.lateralPosition,
      -halfWidth,
      halfWidth
    ),
  }))
}

function appendUnidentifiedGoals(
  events: MatchEvent[],
  frame: RealtimeFrame,
  team: TeamSide,
  count: number
) {
  for (let index = 0; index < count; index += 1) {
    events.push({
      id: `${frame.matchId}-${team}-unknown-goal-${frame.tick}-${index}`,
      type: "goal",
      minute: frameMinute(frame),
      tick: frame.tick,
      team,
    })
  }
}

function frameMinute(frame: RealtimeFrame) {
  const tick = Number.isFinite(frame.displayTick)
    ? frame.displayTick
    : frame.tick
  return Math.floor(Math.max(0, tick) / 240)
}

function oppositeTeam(team: TeamSide): TeamSide {
  return team === "home" ? "away" : "home"
}

function validPitchHalf(value: number) {
  return Number.isFinite(value) && value > 0 ? value : undefined
}

function finiteCoordinate(value: number | null | undefined) {
  return value != null && Number.isFinite(value) ? value : undefined
}

function normalize(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return 50
  return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
}
