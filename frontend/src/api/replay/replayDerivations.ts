import { HeatmapDerivations, type HeatmapDerivationsState } from "@/api/heatmap"
import {
  attachAuxiliaryEventAnnotations,
  nativeMomentumEventAnnotations,
  nativeMomentumEventMetric,
  nativeMomentumEventMetricIds,
} from "@/api/momentumEventSemantics"
import {
  sameMomentumPoint,
  streamRevision,
} from "@/api/replay/replayPreprocessor"
import { MomentumEventReconciler } from "@/api/momentumEventReconciler"
import type {
  HistoricalDerivationSnapshot,
  ReplayStreamRevision,
  StreamRevision,
} from "@/api/replay/replayTypes"
import type {
  RealtimeFrame,
  RealtimeMomentumEvent,
  RealtimeMomentumEventUpdate,
  RealtimeMomentumPoint,
} from "@/api/realtimeMatch"
import type {
  MatchEvent,
  MatchMomentumPoint,
  TacticalEventPoint,
  TeamSide,
  XgShotConfidence,
  XgShotPoint,
  XgTimelinePoint,
} from "@/types/match"

type PendingShotCandidate = {
  sequenceIndex: number
  firstSeenFrameTick: number
  lastSeenFrameTick: number
}

type PlayerXgDelta = {
  playerId: number
  shotDelta: number
  xgDelta: number
}

type PendingXgChange = {
  team: TeamSide
  frameTick: number
  displayTick: number
  teamShotDelta: number
  teamXgDelta: number
  players: PlayerXgDelta[]
}

const XG_EPSILON = 1e-5
const SHOT_MATCH_WINDOW_TICKS = 96

export type HistoricalDerivationsState = {
  previous?: RealtimeFrame
  xg: XgTimelinePoint[]
  events: MatchEvent[]
  tactical: Array<[number, TacticalEventPoint]>
  xgShots: Array<[number, XgShotPoint]>
  pendingShotCandidates: Array<[number, PendingShotCandidate]>
  pendingXgChanges: PendingXgChange[]
  momentum: Array<[number, MatchMomentumPoint]>
  rollingMomentum: Array<[number, MatchMomentumPoint]>
  nativeEvents: Array<
    [number, { event: RealtimeMomentumEvent; revision: number }]
  >
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
  private xgShots = new Map<number, XgShotPoint>()
  private pendingShotCandidates = new Map<number, PendingShotCandidate>()
  private pendingXgChanges: PendingXgChange[] = []
  private momentum = new Map<number, MatchMomentumPoint>()
  private rollingMomentum = new Map<number, MatchMomentumPoint>()
  private nativeEvents = new Map<
    number,
    { event: RealtimeMomentumEvent; revision: number }
  >()
  private legacyEventReconciler = new MomentumEventReconciler()
  private momentumStream: RealtimeMomentumPoint[] = []
  private rollingStream: RealtimeMomentumPoint[] = []
  private heatmaps = new HeatmapDerivations()
  private tacticalOutput: TacticalEventPoint[] = []
  private xgShotOutput: XgShotPoint[] = []
  private momentumOutput: MatchMomentumPoint[] = []
  private rollingOutput: MatchMomentumPoint[] = []
  private xgOutput: XgTimelinePoint[] = this.xg.slice()
  private eventsOutput: MatchEvent[] = []
  private tacticalDirty = true
  private xgShotsDirty = true
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
    this.xgShots.clear()
    this.pendingShotCandidates.clear()
    this.pendingXgChanges = []
    this.momentum.clear()
    this.rollingMomentum.clear()
    this.nativeEvents.clear()
    this.legacyEventReconciler = new MomentumEventReconciler()
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
      momentumEvents: {
        commonLength: 0,
        tail:
          frame.momentumEventUpdates ??
          this.legacyEventReconciler.apply(frame.momentumEvents),
      },
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
    this.ingestShotCandidates(frame, streams.momentumEvents.tail)
    if (this.previous) {
      this.appendMatchEvents(this.previous, frame)
      this.appendXgChanges(this.previous, frame)
    }
    this.resolvePendingXg(frame.tick)
    this.expirePendingXg(frame.tick)
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
        (left, right) =>
          left.tick - right.tick ||
          (left.sequenceIndex ?? 0) - (right.sequenceIndex ?? 0)
      )
      this.tacticalDirty = false
    }
    if (this.xgShotsDirty) {
      this.xgShotOutput = [...this.xgShots.values()].sort(
        (left, right) =>
          left.tick - right.tick || left.eventIndex - right.eventIndex
      )
      this.xgShotsDirty = false
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
      xgShots: this.xgShotOutput,
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
      xgShots: [...this.xgShots],
      pendingShotCandidates: [...this.pendingShotCandidates].map(
        ([key, value]) => [key, { ...value }]
      ),
      pendingXgChanges: this.pendingXgChanges.map((change) => ({
        ...change,
        players: change.players.map((player) => ({ ...player })),
      })),
      momentum: [...this.momentum],
      rollingMomentum: [...this.rollingMomentum],
      nativeEvents: [...this.nativeEvents].map(([key, value]) => [
        key,
        { event: value.event, revision: value.revision },
      ]),
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
    this.xgShots = new Map(state.xgShots)
    this.pendingShotCandidates = new Map(
      state.pendingShotCandidates.map(([key, value]) => [key, { ...value }])
    )
    this.pendingXgChanges = state.pendingXgChanges.map((change) => ({
      ...change,
      players: change.players.map((player) => ({ ...player })),
    }))
    this.momentum = new Map(state.momentum)
    this.rollingMomentum = new Map(state.rollingMomentum)
    this.nativeEvents = new Map(state.nativeEvents)
    this.momentumStream = state.momentumStream.slice()
    this.rollingStream = state.rollingStream.slice()
    this.heatmaps.restoreState(state.heatmaps)
    this.markAllDirty()
  }

  private markAllDirty() {
    this.tacticalDirty = true
    this.xgShotsDirty = true
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
    revision: StreamRevision<RealtimeMomentumEventUpdate>
  ) {
    for (const update of revision.tail) {
      const event = update.event
      const existing = this.nativeEvents.get(update.sequenceIndex)
      if (existing && update.revision <= existing.revision) continue
      this.nativeEvents.set(update.sequenceIndex, {
        event,
        revision: update.revision,
      })
      const point = nativeMomentumEventToTacticalPoint(frame, event)
      if (point) {
        const previousPoint = this.tactical.get(event.sequenceIndex)
        this.tactical.set(
          event.sequenceIndex,
          previousPoint?.annotations?.some(
            (annotation) =>
              annotation === "clearCutChance" || annotation === "penaltyKick"
          )
            ? {
                ...point,
                annotations: [
                  ...(point.annotations ?? []),
                  ...(previousPoint.annotations ?? []).filter(
                    (annotation) =>
                      (annotation === "clearCutChance" ||
                        annotation === "penaltyKick") &&
                      !point.annotations?.includes(annotation)
                  ),
                ],
              }
            : point
        )
      }
      this.appendNativeCard(frame, event)
      this.refreshAuxiliaryAnnotations()
    }
    if (revision.tail.length > 0) this.tacticalDirty = true
  }

  private appendNativeCard(frame: RealtimeFrame, event: RealtimeMomentumEvent) {
    if (event.eventType !== 20 && event.eventType !== 21) return
    const type = event.eventType === 20 ? "yellow_card" : "red_card"
    const id = `${frame.matchId}-native-${type}-${event.sequenceIndex}`
    const displayTick = nativeMomentumEventDisplayTick(frame, event)
    const card: MatchEvent = {
      id,
      type,
      minute: Math.floor(displayTick / 240),
      tick: event.tick,
      team: event.team,
      playerId: event.playerId,
    }
    const existingIndex = this.events.findIndex(
      (existing) => existing.id === id
    )
    if (existingIndex >= 0) this.events[existingIndex] = card
    else this.events.push(card)
    this.eventsDirty = true
  }

  private refreshAuxiliaryAnnotations() {
    for (const [key, point] of this.tactical) {
      const annotations = point.annotations?.filter(
        (annotation) =>
          annotation !== "clearCutChance" && annotation !== "penaltyKick"
      )
      if (annotations?.length !== point.annotations?.length)
        this.tactical.set(key, { ...point, annotations })
    }
    attachAuxiliaryEventAnnotations(
      this.tactical,
      [...this.nativeEvents.values()].map((state) => state.event)
    )
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

  private ingestShotCandidates(
    frame: RealtimeFrame,
    updates: readonly RealtimeMomentumEventUpdate[]
  ) {
    for (const { event, sequenceIndex } of updates) {
      if (!isShotEvent(event.eventType)) continue
      const existingShot = this.xgShots.get(sequenceIndex)
      const point = this.tactical.get(sequenceIndex)
      if (existingShot) {
        if (!point || !validShotCoordinates(event)) continue
        const refreshed = toXgShotPoint(
          point,
          event.eventIndex,
          existingShot.xg,
          existingShot.confidence
        )
        if (sameXgShotPoint(existingShot, refreshed)) continue
        this.xgShots.set(sequenceIndex, refreshed)
        this.xgShotsDirty = true
        continue
      }

      const candidate = this.pendingShotCandidates.get(sequenceIndex)
      this.pendingShotCandidates.set(sequenceIndex, {
        sequenceIndex,
        firstSeenFrameTick: candidate?.firstSeenFrameTick ?? frame.tick,
        lastSeenFrameTick: frame.tick,
      })
    }
    if (
      updates.some(
        ({ event }) => event.eventType === 22 || event.eventType === 35
      )
    ) {
      this.refreshXgShotDetails()
    }
  }

  private appendXgChanges(previous: RealtimeFrame, frame: RealtimeFrame) {
    const previousPlayers = new Map(
      previous.players.map((player) => [player.playerId, player])
    )
    const playersByTeam: Record<TeamSide, PlayerXgDelta[]> = {
      home: [],
      away: [],
    }
    for (const player of frame.players) {
      const old = previousPlayers.get(player.playerId)
      if (!old) continue
      const delta = {
        playerId: player.playerId,
        shotDelta: (player.shots ?? 0) - (old.shots ?? 0),
        xgDelta: (player.xg ?? 0) - (old.xg ?? 0),
      }
      if (Math.abs(delta.xgDelta) > XG_EPSILON || delta.shotDelta !== 0) {
        playersByTeam[player.team].push(delta)
      }
    }

    for (const team of ["home", "away"] as const) {
      const teamXgDelta = frame[team].xg - previous[team].xg
      const teamShotDelta = frame[team].shots - previous[team].shots
      const players = playersByTeam[team]
      if (
        teamXgDelta < -XG_EPSILON ||
        players.some((player) => player.xgDelta < -XG_EPSILON)
      ) {
        this.applyNegativeXgCorrection(team, frame.tick, teamXgDelta, players)
      }
      if (
        teamXgDelta > XG_EPSILON ||
        teamShotDelta > 0 ||
        players.some(
          (player) => player.xgDelta > XG_EPSILON || player.shotDelta > 0
        )
      ) {
        this.pendingXgChanges.push({
          team,
          frameTick: frame.tick,
          displayTick: frame.displayTick,
          teamShotDelta: Math.max(0, teamShotDelta),
          teamXgDelta: Math.max(0, teamXgDelta),
          players: players.filter(
            (player) => player.xgDelta > XG_EPSILON || player.shotDelta > 0
          ),
        })
      }
    }
  }

  private resolvePendingXg(currentTick: number) {
    for (let changeIndex = 0; changeIndex < this.pendingXgChanges.length;) {
      const change = this.pendingXgChanges[changeIndex]
      const expectedShots = Math.max(
        1,
        change.teamShotDelta,
        change.players.reduce(
          (total, player) => total + Math.max(0, player.shotDelta),
          0
        )
      )
      const matchingPlayerIds = new Set(
        change.players
          .filter(
            (player) =>
              player.shotDelta > 0 || player.xgDelta > XG_EPSILON
          )
          .map((player) => player.playerId)
      )
      const candidates = [...this.pendingShotCandidates.values()]
        .map((candidate) => ({
          candidate,
          point: this.tactical.get(candidate.sequenceIndex),
          event: this.nativeEvents.get(candidate.sequenceIndex)?.event,
        }))
        .filter(
          (
            entry
          ): entry is {
            candidate: PendingShotCandidate
            point: TacticalEventPoint
            event: RealtimeMomentumEvent
          } =>
            entry.point != null &&
            entry.event != null &&
            entry.point.team === change.team &&
            validShotCoordinates(entry.event) &&
            (Math.abs(change.frameTick - entry.candidate.firstSeenFrameTick) <=
              SHOT_MATCH_WINDOW_TICKS ||
              Math.abs(change.frameTick - entry.point.tick) <=
                SHOT_MATCH_WINDOW_TICKS)
        )
        .sort((left, right) =>
          compareShotCandidates(left, right, change, matchingPlayerIds)
        )

      if (candidates.length < expectedShots) {
        changeIndex += 1
        continue
      }

      const selected = candidates.slice(0, expectedShots)
      const playerXgTotal = selected.reduce((total, entry) => {
        const player = change.players.find(
          (candidate) => candidate.playerId === entry.point.playerId
        )
        return total + Math.max(0, player?.xgDelta ?? 0)
      }, 0)
      const totalXg =
        change.teamXgDelta > XG_EPSILON ? change.teamXgDelta : playerXgTotal

      for (const entry of selected) {
        const player = change.players.find(
          (candidate) => candidate.playerId === entry.point.playerId
        )
        const playerMatches =
          player != null &&
          (player.shotDelta > 0 || player.xgDelta > XG_EPSILON)
        const xg =
          selected.length === 1
            ? totalXg
            : playerXgTotal > XG_EPSILON
              ? totalXg * (Math.max(0, player?.xgDelta ?? 0) / playerXgTotal)
              : totalXg / selected.length
        const exact =
          selected.length === 1 &&
          change.teamShotDelta === 1 &&
          player?.shotDelta === 1 &&
          (player.xgDelta ?? 0) > XG_EPSILON &&
          candidates.filter(
            (candidate) => candidate.point.playerId === entry.point.playerId
          ).length === 1
        const confidence: XgShotConfidence = exact
          ? "exact"
          : playerMatches
            ? "matched"
            : "estimated"
        this.xgShots.set(
          entry.candidate.sequenceIndex,
          toXgShotPoint(
            entry.point,
            entry.event.eventIndex,
            Math.max(0, xg),
            confidence
          )
        )
        this.pendingShotCandidates.delete(entry.candidate.sequenceIndex)
      }
      this.xgShotsDirty = true
      this.pendingXgChanges.splice(changeIndex, 1)
    }

    // A change from a future frame can only happen after restoring malformed
    // data; keep it pending rather than matching it across an unbounded range.
    void currentTick
  }

  private expirePendingXg(currentTick: number) {
    for (const [sequenceIndex, candidate] of this.pendingShotCandidates) {
      if (currentTick - candidate.lastSeenFrameTick > SHOT_MATCH_WINDOW_TICKS)
        this.pendingShotCandidates.delete(sequenceIndex)
    }
    this.pendingXgChanges = this.pendingXgChanges.filter(
      (change) => currentTick - change.frameTick <= SHOT_MATCH_WINDOW_TICKS
    )
  }

  private applyNegativeXgCorrection(
    team: TeamSide,
    frameTick: number,
    teamXgDelta: number,
    players: readonly PlayerXgDelta[]
  ) {
    const playerId = players.find(
      (player) => player.xgDelta < -XG_EPSILON
    )?.playerId
    const entry = [...this.xgShots.entries()]
      .filter(
        ([, candidate]) =>
          candidate.team === team &&
          Math.abs(candidate.tick - frameTick) <= SHOT_MATCH_WINDOW_TICKS &&
          (playerId == null || candidate.playerId === playerId)
      )
      .sort(
        ([, left], [, right]) =>
          Math.abs(left.tick - frameTick) - Math.abs(right.tick - frameTick) ||
          right.eventIndex - left.eventIndex
      )[0]
    if (!entry) return
    const [sequenceIndex, shot] = entry
    const playerDelta = players.find(
      (player) => player.playerId === shot.playerId
    )?.xgDelta
    const correction =
      teamXgDelta < -XG_EPSILON ? teamXgDelta : (playerDelta ?? 0)
    if (correction >= -XG_EPSILON) return
    this.xgShots.set(sequenceIndex, {
      ...shot,
      xg: Math.max(0, shot.xg + correction),
    })
    this.xgShotsDirty = true
  }

  private refreshXgShotDetails() {
    for (const [sequenceIndex, shot] of this.xgShots) {
      const point = this.tactical.get(sequenceIndex)
      const event = this.nativeEvents.get(sequenceIndex)?.event
      if (!point || !event || !validShotCoordinates(event)) continue
      const refreshed = toXgShotPoint(
        point,
        event.eventIndex,
        shot.xg,
        shot.confidence
      )
      if (sameXgShotPoint(shot, refreshed)) continue
      this.xgShots.set(sequenceIndex, refreshed)
      this.xgShotsDirty = true
    }
  }
}

function isShotEvent(eventType: number) {
  return eventType >= 1 && eventType <= 5
}

function validShotCoordinates(event: RealtimeMomentumEvent) {
  return (
    Number.isFinite(event.lateralPosition) &&
    Number.isFinite(event.longitudinalPosition)
  )
}

function compareShotCandidates(
  left: {
    candidate: PendingShotCandidate
    point: TacticalEventPoint
  },
  right: {
    candidate: PendingShotCandidate
    point: TacticalEventPoint
  },
  change: PendingXgChange,
  matchingPlayerIds: ReadonlySet<number>
) {
  const leftPlayerRank = matchingPlayerIds.has(left.point.playerId) ? 0 : 1
  const rightPlayerRank = matchingPlayerIds.has(right.point.playerId) ? 0 : 1
  return (
    leftPlayerRank - rightPlayerRank ||
    Number(left.candidate.firstSeenFrameTick !== change.frameTick) -
      Number(right.candidate.firstSeenFrameTick !== change.frameTick) ||
    Math.abs(left.candidate.firstSeenFrameTick - change.frameTick) -
      Math.abs(right.candidate.firstSeenFrameTick - change.frameTick) ||
    Math.abs(left.point.tick - change.frameTick) -
      Math.abs(right.point.tick - change.frameTick) ||
    left.candidate.sequenceIndex - right.candidate.sequenceIndex
  )
}

function toXgShotPoint(
  point: TacticalEventPoint,
  eventIndex: number,
  xg: number,
  confidence: XgShotConfidence
): XgShotPoint {
  return {
    id: point.id,
    eventIndex,
    team: point.team,
    playerId: point.playerId || undefined,
    tick: point.tick,
    displayTick: point.displayTick,
    minute: point.minute,
    x: point.x,
    y: point.y,
    xg,
    metricId: point.metricId as XgShotPoint["metricId"],
    nativeEventType: point.nativeEventType,
    annotations: point.annotations,
    confidence,
  }
}

function sameXgShotPoint(left: XgShotPoint, right: XgShotPoint) {
  return (
    left.id === right.id &&
    left.eventIndex === right.eventIndex &&
    left.team === right.team &&
    left.playerId === right.playerId &&
    left.tick === right.tick &&
    left.displayTick === right.displayTick &&
    left.minute === right.minute &&
    left.x === right.x &&
    left.y === right.y &&
    left.metricId === right.metricId &&
    left.nativeEventType === right.nativeEventType &&
    left.confidence === right.confidence &&
    sameAnnotations(left.annotations, right.annotations)
  )
}

function sameAnnotations(
  left: XgShotPoint["annotations"],
  right: XgShotPoint["annotations"]
) {
  return (
    left === right ||
    (left?.length === right?.length &&
      left?.every((annotation, index) => annotation === right?.[index]))
  )
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
    id: `${frame.matchId}-native-momentum-${item.sequenceIndex}`,
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
    annotations: nativeMomentumEventAnnotations(item),
  }
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
