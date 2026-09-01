import { startTransition, useEffect, useRef, useState } from "react"

import type {
  MatchPlayer,
  MatchEvent,
  MatchSnapshot,
  MatchMomentumPoint,
  PlayerPositionHeatmap,
  PlayerPositionHeatmapSlice,
  PlayerStats,
  PlayerTacticalAssignment,
  PlayerAttributes,
  PlayerProfile,
  PlayerPositionFamiliarities,
  TeamSide,
  TeamStats,
  TacticalEventPoint,
  XgTimelinePoint,
} from "@/types/match"

const apiBase = `http://127.0.0.1:${__API_PORT__}`
const webSocketUrl = `ws://127.0.0.1:${__API_PORT__}/ws`
const liveFramePageSize = 2_400

export type RealtimeTeam = {
  goals: number
  xg: number
  possessionTime: number
  shots: number
  shotsOnTarget: number
  shotsOffTarget: number
  blockedShots: number
  clearCutChances: number
  passes: number
  passesCompleted: number
  crosses: number
  crossesCompleted: number
  aerials: number
  aerialsWon: number
  progressivePasses: number
  finalThirdPasses: number
  tacklesAttempted: number
  tacklesWon: number
  fouls: number
  corners: number
  offsides: number
  yellowCards: number
  redCards: number
}

export type RealtimePlayer = PlayerStats & {
  slot: number
  playerId: number
  team: TeamSide
  isBallHolder: boolean
  x: number
  y: number
  rating: number
  isSubstitute: boolean
  isOnPitch: boolean
  subbedOnMinute: number
  subbedOffMinute: number
  yellowCards: number
  redCards: number
  shotsFaced: number
}

export type RealtimeFrame = {
  sequence: number
  matchId: string
  tick: number
  displayTick: number
  period: number
  capturedUnixMilliseconds: number
  possessionTeam?: TeamSide
  ballHolderPlayerId?: number
  halfPitchWidth: number
  halfPitchLength: number
  momentumEvents: RealtimeMomentumEvent[]
  momentum: RealtimeMomentumPoint[]
  rollingMomentum: RealtimeMomentumPoint[]
  home: RealtimeTeam
  away: RealtimeTeam
  players: RealtimePlayer[]
}

export type RealtimeMomentumEvent = {
  eventIndex: number
  tick: number
  lateralPosition: number
  longitudinalPosition: number
  team: TeamSide
  playerSlot: number
  playerId: number
  receiverPlayerSlot: number
  receiverPlayerId: number
  eventType: number
  flags: number
}

export type RealtimeMomentumPoint = {
  value: number
  timeTicks: number
  homeWeight: number
  awayWeight: number
}

export type RealtimePlayerMetadata = {
  slot: number
  playerId: number
  uid?: number
  team: TeamSide
  shirtNumber?: number
  position?: string
  positionFamiliarities?: PlayerPositionFamiliarities
  inPossession?: PlayerTacticalAssignment
  outOfPossession?: PlayerTacticalAssignment
  firstName?: string
  secondName?: string
  commonName?: string
  displayName: string
  portraitPath?: string
  profile?: PlayerProfile
  attributes?: PlayerAttributes
}

export type RealtimeTeamMetadata = {
  uid?: number
  clubUid?: number
  name: string
  backgroundColour?: number
  foregroundColour?: number
  outlineColour?: number
  logoPath?: string
}

export type RealtimeMatchMetadata = {
  matchId: string
  startedUnixMilliseconds: number
  capturedTick: number
  home: RealtimeTeamMetadata
  away: RealtimeTeamMetadata
  players: RealtimePlayerMetadata[]
}

type RealtimeEnvelope = {
  type: string
  payload: unknown
}

type RealtimeFrameSlice = {
  matchId?: string
  status: string
  totalFrameCount: number
  frames: RealtimeFrame[]
}

type HeatCell = { count: number; sumX: number; sumY: number }
type HeatAccumulator = {
  playerId: number
  team: TeamSide
  sampleCount: number
  sumX: number
  sumY: number
  cells: Map<string, HeatCell>
}
type HeatSample = { playerId: number; team: TeamSide; x: number; y: number; cell: string }
type RecentHeatFrame = { minute: number; samples: HeatSample[] }

/** Incremental historical state. Each accepted frame is visited exactly once. */
class LiveDerivations {
  private previous?: RealtimeFrame
  private xg: XgTimelinePoint[] = [{ minute: 0, home: 0, away: 0 }]
  private events: MatchEvent[] = []
  private tactical = new Map<number, TacticalEventPoint>()
  private momentum = new Map<number, MatchMomentumPoint>()
  private rollingMomentum = new Map<number, MatchMomentumPoint>()
  private fullHeat = new Map<number, HeatAccumulator>()
  private halfHeat = new Map<number, HeatAccumulator>()
  private recentHeat = new Map<number, HeatAccumulator>()
  private recentFrames: RecentHeatFrame[] = []
  private recentStart = 0
  private halfKey = -1

  reset() {
    this.previous = undefined
    this.xg = [{ minute: 0, home: 0, away: 0 }]
    this.events = []
    this.tactical.clear()
    this.momentum.clear()
    this.rollingMomentum.clear()
    this.fullHeat.clear()
    this.halfHeat.clear()
    this.recentHeat.clear()
    this.recentFrames = []
    this.recentStart = 0
    this.halfKey = -1
  }

  append(frames: readonly RealtimeFrame[]) {
    for (const frame of frames) this.appendFrame(frame)
  }

  snapshot(currentTick: number) {
    return {
      xg: [...this.xg],
      events: [...this.events],
      tactical: [...this.tactical.values()].sort((left, right) => left.tick - right.tick),
      heatmaps: this.buildHeatmaps(),
      momentum: [...this.momentum.values()]
        .filter((point) => point.timeTicks <= currentTick + 1_200)
        .sort((left, right) => left.timeTicks - right.timeTicks),
      rollingMomentum: [...this.rollingMomentum.values()]
        .sort((left, right) => left.timeTicks - right.timeTicks),
    }
  }

  private appendFrame(frame: RealtimeFrame) {
    const minute = frameMinute(frame)
    const xgPoint = { minute, home: frame.home.xg, away: frame.away.xg }
    const lastXg = this.xg.at(-1)
    if (lastXg?.minute === minute) this.xg[this.xg.length - 1] = xgPoint
    else this.xg.push(xgPoint)

    for (const point of frame.momentum) {
      if (!Number.isFinite(point.value) || !Number.isFinite(point.timeTicks)) continue
      this.momentum.set(point.timeTicks, { ...point, minute: (point.timeTicks + 1) / 240 })
    }
    for (const point of frame.rollingMomentum) {
      if (!Number.isFinite(point.value) || !Number.isFinite(point.timeTicks)) continue
      this.rollingMomentum.set(point.timeTicks, { ...point, minute: point.timeTicks / 240 })
    }

    this.appendNativeMomentumEvents(frame)
    const previous = this.previous
    if (previous) {
      this.appendEvents(previous, frame)
    }
    this.appendHeat(frame, minute)
    this.previous = frame
  }

  private appendEvents(previous: RealtimeFrame, frame: RealtimeFrame) {
    const previousPlayers = new Map(previous.players.map((player) => [player.playerId, player]))
    let identifiedHomeGoals = 0
    let identifiedAwayGoals = 0
    for (const player of frame.players) {
      const old = previousPlayers.get(player.playerId)
      if (!old) continue
      const goalDelta = Math.max(0, player.goals - old.goals)
      const assistDelta = Math.max(0, player.assists - old.assists)
      const redDelta = Math.max(0, player.redCards - old.redCards)
      for (let count = 0; count < goalDelta; count += 1) {
        this.events.push({
          id: `${frame.matchId}-player-${player.playerId}-goal-${player.goals - goalDelta + count + 1}-${frame.tick}`,
          type: "goal", minute: frameMinute(frame), tick: frame.tick, team: player.team, playerId: player.playerId,
        })
        if (player.team === "home") identifiedHomeGoals += 1
        else identifiedAwayGoals += 1
      }
      for (let count = 0; count < assistDelta; count += 1) {
        this.events.push({
          id: `${frame.matchId}-player-${player.playerId}-assist-${player.assists - assistDelta + count + 1}-${frame.tick}`,
          type: "assist_candidate", minute: frameMinute(frame), tick: frame.tick, team: player.team, playerId: player.playerId,
        })
      }
      for (let count = 0; count < redDelta; count += 1) {
        this.events.push({
          id: `${frame.matchId}-player-${player.playerId}-red-${frame.tick}-${count}`,
          type: "red_card", minute: frameMinute(frame), tick: frame.tick, team: player.team, playerId: player.playerId,
        })
      }
    }
    appendUnidentifiedGoals(this.events, frame, "home",
      Math.max(0, frame.home.goals - previous.home.goals - identifiedHomeGoals))
    appendUnidentifiedGoals(this.events, frame, "away",
      Math.max(0, frame.away.goals - previous.away.goals - identifiedAwayGoals))
  }

  private appendNativeMomentumEvents(frame: RealtimeFrame) {
    const halfWidth = validPitchHalf(frame.halfPitchWidth)
    const halfLength = validPitchHalf(frame.halfPitchLength)
    if (!halfWidth || !halfLength) return
    for (const item of frame.momentumEvents) {
      const metricId = nativeMomentumEventMetric(item.eventType)
      if (!metricId) continue
      const rotateForDisplay = nativeMomentumEventNeedsDisplayRotation(item)
      const lateral = rotateForDisplay ? -item.lateralPosition : item.lateralPosition
      const longitudinal = rotateForDisplay ? -item.longitudinalPosition : item.longitudinalPosition
      const displayTick = nativeMomentumEventDisplayTick(frame, item)
      this.tactical.set(item.eventIndex, {
        id: `${frame.matchId}-native-momentum-${item.eventIndex}`,
        metricId,
        playerId: item.playerId,
        receiverPlayerId: item.receiverPlayerId || undefined,
        team: item.team,
        tick: item.tick,
        displayTick,
        minute: Math.floor(displayTick / 240),
        x: normalize(longitudinal, -halfLength, halfLength),
        y: normalize(lateral, -halfWidth, halfWidth),
        nativeEventType: item.eventType,
        flags: item.flags,
      })
    }
  }

  private appendHeat(frame: RealtimeFrame, minute: number) {
    const nextHalfKey = minute < 45 ? 0 : minute < 90 ? 1 : minute < 105 ? 2 : 3
    if (nextHalfKey !== this.halfKey) {
      this.halfKey = nextHalfKey
      this.halfHeat.clear()
    }
    const samples: HeatSample[] = []
    if (frame.possessionTeam != null) {
      const secondHalf = frame.period === 2
      for (const player of frame.players) {
        if (!player.isOnPitch || !Number.isFinite(player.x) || !Number.isFinite(player.y)) continue
        const halfWidth = validPitchHalf(frame.halfPitchWidth)
        const halfLength = validPitchHalf(frame.halfPitchLength)
        if (!halfWidth || !halfLength) continue
        const x = normalize(secondHalf ? -player.x : player.x, -halfWidth, halfWidth)
        const y = normalize(secondHalf ? player.y : -player.y, -halfLength, halfLength)
        const sample = {
          playerId: player.playerId,
          team: player.team,
          x,
          y,
          cell: `${Math.min(19, Math.floor(x / 5))}:${Math.min(29, Math.floor(y / (100 / 30)))}`,
        }
        samples.push(sample)
        this.applyHeatSample(this.fullHeat, sample, 1)
        this.applyHeatSample(this.halfHeat, sample, 1)
        this.applyHeatSample(this.recentHeat, sample, 1)
      }
    }
    this.recentFrames.push({ minute, samples })
    const oldestMinute = Math.max(0, minute - 15)
    while (this.recentStart < this.recentFrames.length &&
      this.recentFrames[this.recentStart].minute < oldestMinute) {
      for (const sample of this.recentFrames[this.recentStart].samples)
        this.applyHeatSample(this.recentHeat, sample, -1)
      this.recentStart += 1
    }
    if (this.recentStart > 2_048) {
      this.recentFrames = this.recentFrames.slice(this.recentStart)
      this.recentStart = 0
    }
  }

  private applyHeatSample(target: Map<number, HeatAccumulator>, sample: HeatSample, direction: 1 | -1) {
    let player = target.get(sample.playerId)
    if (!player && direction > 0) {
      player = { playerId: sample.playerId, team: sample.team, sampleCount: 0, sumX: 0, sumY: 0, cells: new Map() }
      target.set(sample.playerId, player)
    }
    if (!player) return
    player.sampleCount += direction
    player.sumX += sample.x * direction
    player.sumY += sample.y * direction
    const cell = player.cells.get(sample.cell) ?? { count: 0, sumX: 0, sumY: 0 }
    cell.count += direction
    cell.sumX += sample.x * direction
    cell.sumY += sample.y * direction
    if (cell.count <= 0) player.cells.delete(sample.cell)
    else player.cells.set(sample.cell, cell)
    if (player.sampleCount <= 0) target.delete(sample.playerId)
  }

  private buildHeatmaps(): PlayerPositionHeatmap[] {
    return [...this.fullHeat.values()].map((player) => {
      const full = this.heatSlice(player)
      return {
        playerId: player.playerId,
        team: player.team,
        ...full,
        ranges: {
          full,
          half: this.heatSlice(this.halfHeat.get(player.playerId)),
          recent15: this.heatSlice(this.recentHeat.get(player.playerId)),
        },
      }
    })
  }

  private heatSlice(player?: HeatAccumulator): PlayerPositionHeatmapSlice {
    if (!player || player.sampleCount <= 0)
      return { sampleCount: 0, averageX: 50, averageY: 50, points: [] }
    return {
      sampleCount: player.sampleCount,
      averageX: player.sumX / player.sampleCount,
      averageY: player.sumY / player.sampleCount,
      points: [...player.cells.values()].map((cell) => ({
        x: cell.sumX / cell.count,
        y: cell.sumY / cell.count,
        weight: cell.count,
      })),
    }
  }
}

export function useRealtimeMatch(): MatchSnapshot | null {
  const [match, setMatch] = useState<MatchSnapshot | null>(null)
  const metadata = useRef<RealtimeMatchMetadata | null>(null)

  useEffect(() => {
    let disposed = false
    let socket: WebSocket | null = null
    let reconnectTimer: number | undefined
    let latestFrame: RealtimeFrame | null = null
    let historyMatchId = ""
    let historyLastTick = -1
    let derived = new LiveDerivations()
    let historical = derived.snapshot(0)
    let syncing = false
    let syncPending = false
    let lastMetadataAttempt = 0

    const fetchMetadata = async () => {
      lastMetadataAttempt = Date.now()
      try {
        const response = await fetch(`${apiBase}/api/match/meta`, { cache: "no-store" })
        if (!response.ok) return false
        const next = (await response.json()) as RealtimeMatchMetadata | null
        const changed = JSON.stringify(next) !== JSON.stringify(metadata.current)
        metadata.current = next
        return changed
      } catch {
        // Metadata is retried on future snapshots.
        return false
      }
    }

    const publish = (frame: RealtimeFrame | null, lowPriority: boolean) => {
      if (disposed || !frame) return
      const commit = () => setMatch(toMatchSnapshot(
        frame, historical.xg, metadata.current, historical.events,
        historical.heatmaps, historical.tactical, historical.momentum,
        historical.rollingMomentum,
      ))
      if (lowPriority) startTransition(commit)
      else commit()
    }

    const resetFor = (matchId: string) => {
      if (historyMatchId === matchId) return
      historyMatchId = matchId
      historyLastTick = -1
      derived = new LiveDerivations()
      historical = derived.snapshot(0)
      if (metadata.current?.matchId !== matchId) metadata.current = null
    }

    const syncHistory = async () => {
      if (syncing) {
        syncPending = true
        return
      }

      syncing = true
      try {
        let keepLoading = true
        let changed = false
        let metadataChanged = false
        while (!disposed && keepLoading) {
          const fromTick = historyLastTick + 1
          const response = await fetch(`${apiBase}/api/match/frames?fromTick=${fromTick}&stride=1&limit=${liveFramePageSize}`)
          if (!response.ok) throw new Error("live frame read failed")
          const slice = (await response.json()) as RealtimeFrameSlice
          // An old request may finish after the WebSocket has already switched
          // to a new match. Never let that response roll live state backwards.
          if (slice.matchId && latestFrame?.matchId && slice.matchId !== latestFrame.matchId) return
          if (slice.matchId) resetFor(slice.matchId)
          const additions = slice.frames.filter((frame) => frame.tick > historyLastTick)
          derived.append(additions)
          if (additions.length > 0) historyLastTick = additions.at(-1)!.tick
          changed ||= additions.length > 0
          keepLoading = slice.frames.length >= liveFramePageSize && additions.length > 0
        }
        // Tactical assignments move from the outgoing MATCH_PLAYER to the
        // substitute after a change. Keep polling metadata even after names and
        // profiles are complete so the live formation receives that update.
        if (Date.now() - lastMetadataAttempt >= 2_000)
          metadataChanged = await fetchMetadata()
        if (changed) historical = derived.snapshot(latestFrame?.tick ?? historyLastTick)
        if (changed || metadataChanged) publish(latestFrame, true)
      } catch {
        // WebSocket still keeps the current score/player state live. The next
        // low-frequency sync retries the missing historical range.
      } finally {
        syncing = false
        if (syncPending && !disposed) {
          syncPending = false
          void syncHistory()
        }
      }
    }

    const fetchCurrent = async () => {
      try {
        const response = await fetch(`${apiBase}/api/match/current`)
        if (!response.ok) return
        const frame = (await response.json()) as RealtimeFrame | null
        if (frame?.matchId) {
          resetFor(frame.matchId)
          latestFrame = frame
          publish(frame, false)
        }
      } catch {
        // The plugin may not be running yet; reconnect and polling handle recovery.
      }
    }

    const connect = () => {
      if (disposed) return

      socket = new WebSocket(webSocketUrl)
      socket.onopen = () => {
        void fetchCurrent()
        void syncHistory()
      }
      socket.onmessage = (event: MessageEvent<string>) => {
        try {
          const envelope = JSON.parse(event.data) as RealtimeEnvelope
          if (envelope.type === "realtime_tick") {
            const frame = envelope.payload as RealtimeFrame
            if (!frame?.matchId) return
            resetFor(frame.matchId)
            latestFrame = frame
            // The 250ms WebSocket path only builds the current snapshot. No
            // historical scan, HTTP round-trip, or heatmap aggregation occurs.
            publish(frame, false)
          }
        } catch {
          // Ignore malformed or unrelated development messages.
        }
      }
      socket.onclose = () => {
        if (!disposed) {
          reconnectTimer = window.setTimeout(connect, 2_000)
        }
      }
      socket.onerror = () => socket?.close()
    }

    void fetchCurrent()
    const syncTimer = window.setInterval(() => void syncHistory(), 1_000)
    connect()

    return () => {
      disposed = true
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer)
      window.clearInterval(syncTimer)
      socket?.close()
    }
  }, [])

  return match
}

export function toMatchSnapshot(
  frame: RealtimeFrame,
  xgTimeline?: MatchSnapshot["xgTimeline"],
  metadata?: RealtimeMatchMetadata | null,
  events: MatchEvent[] = [],
  positionHeatmaps: PlayerPositionHeatmap[] = [],
  tacticalEvents: TacticalEventPoint[] = [],
  momentum: MatchMomentumPoint[] = [],
  rollingMomentum: MatchMomentumPoint[] = [],
): MatchSnapshot {
  const clockTick = Number.isFinite(frame.displayTick) ? frame.displayTick : frame.tick
  const minute = Math.floor(Math.max(0, clockTick) / 240)
  const second = Math.floor(Math.max(0, clockTick) / 4) % 60
  const playerMetadata = new Map(metadata?.players.map((player) => [player.playerId, player]) ?? [])
  const homeClubUid = metadata?.home.clubUid
  const awayClubUid = metadata?.away.clubUid

  return {
    clock: {
      minute,
      second,
      elapsedMinute: Math.floor(Math.max(0, frame.tick) / 240),
      elapsedSecond: Math.floor(Math.max(0, frame.tick) / 4) % 60,
      elapsedTick: Math.max(0, frame.tick),
    },
    period: frame.period,
    score: { home: frame.home.goals, away: frame.away.goals },
    home: {
      uid: metadata?.home.uid,
      clubUid: homeClubUid,
      name: metadata?.home.name || "Home",
      color: argbToCss(metadata?.home.foregroundColour),
      logoPath: metadata?.home.logoPath,
      logoUrl: homeClubUid != null ? graphicsAssetUrl("club", homeClubUid, "logo") : undefined,
      stats: toTeamStats(frame.home),
    },
    away: {
      uid: metadata?.away.uid,
      clubUid: awayClubUid,
      name: metadata?.away.name || "Away",
      color: argbToCss(metadata?.away.foregroundColour),
      logoPath: metadata?.away.logoPath,
      logoUrl: awayClubUid != null ? graphicsAssetUrl("club", awayClubUid, "logo") : undefined,
      stats: toTeamStats(frame.away),
    },
    players: frame.players.map((player) => toPlayer(
      player,
      playerMetadata.get(player.playerId),
    )),
    events: [...events],
    positionHeatmaps,
    tacticalEvents,
    momentum,
    rollingMomentum,
    xgTimeline: xgTimeline?.length
      ? [...xgTimeline]
      : appendXgPoint([{ minute: 0, home: 0, away: 0 }], {
          minute,
          home: frame.home.xg,
          away: frame.away.xg,
        }),
  }
}

export function buildMomentumTimeline(
  frames: readonly RealtimeFrame[],
  throughIndex = frames.length - 1,
): MatchMomentumPoint[] {
  const end = Math.min(Math.max(throughIndex, -1), frames.length - 1)
  if (end < 0) return []

  const points = new Map<number, MatchMomentumPoint>()
  for (let index = 0; index <= end; index += 1) {
    for (const point of frames[index].momentum) {
      if (!Number.isFinite(point.value) || !Number.isFinite(point.timeTicks)) continue
      points.set(point.timeTicks, {
        ...point,
        minute: (point.timeTicks + 1) / 240,
      })
    }
  }

  // A first capture seeds all native phase points, including future zeroes.
  // Keep only completed bars and the currently active five-minute bar.
  const currentTick = frames[end].tick
  return [...points.values()]
    .filter((point) => point.timeTicks <= currentTick + 1_200)
    .sort((left, right) => left.timeTicks - right.timeTicks)
}

export function buildRollingMomentumTimeline(
  frames: readonly RealtimeFrame[],
  throughIndex = frames.length - 1,
): MatchMomentumPoint[] {
  const end = Math.min(Math.max(throughIndex, -1), frames.length - 1)
  if (end < 0) return []

  const points = new Map<number, MatchMomentumPoint>()
  for (let index = 0; index <= end; index += 1) {
    for (const point of frames[index].rollingMomentum) {
      if (!Number.isFinite(point.value) || !Number.isFinite(point.timeTicks)) continue
      points.set(point.timeTicks, {
        ...point,
        minute: point.timeTicks / 240,
      })
    }
  }

  return [...points.values()].sort((left, right) => left.timeTicks - right.timeTicks)
}

export function buildXgTimeline(
  frames: readonly RealtimeFrame[],
  throughIndex = frames.length - 1,
): XgTimelinePoint[] {
  let points: XgTimelinePoint[] = [{ minute: 0, home: 0, away: 0 }]
  const end = Math.min(Math.max(throughIndex, -1), frames.length - 1)

  for (let index = 0; index <= end; index += 1) {
    const frame = frames[index]
    points = appendXgPoint(points, {
      minute: frameMinute(frame),
      home: frame.home.xg,
      away: frame.away.xg,
    })
  }

  return points
}

export function buildMatchEvents(
  frames: readonly RealtimeFrame[],
  throughIndex = frames.length - 1,
): MatchEvent[] {
  const end = Math.min(Math.max(throughIndex, -1), frames.length - 1)
  if (end < 1) return []

  const events: MatchEvent[] = []
  let homeGoals = frames[0].home.goals
  let awayGoals = frames[0].away.goals
  const previousPlayers = new Map(
    frames[0].players.map((player) => [player.playerId, {
      goals: player.goals,
      assists: player.assists,
      redCards: player.redCards,
    }]),
  )

  for (let index = 1; index <= end; index += 1) {
    const frame = frames[index]
    const minute = frameMinute(frame)
    let identifiedHomeGoals = 0
    let identifiedAwayGoals = 0

    for (const player of frame.players) {
      const previous = previousPlayers.get(player.playerId)
      if (previous) {
        const goalDelta = Math.max(0, player.goals - previous.goals)
        const assistDelta = Math.max(0, player.assists - previous.assists)
        const redCardDelta = Math.max(0, player.redCards - previous.redCards)

        for (let count = 0; count < goalDelta; count += 1) {
          events.push({
            id: `${frame.matchId}-player-${player.playerId}-goal-${player.goals - goalDelta + count + 1}-${frame.tick}`,
            type: "goal",
            minute,
            tick: frame.tick,
            team: player.team,
            playerId: player.playerId,
          })
          if (player.team === "home") identifiedHomeGoals += 1
          else identifiedAwayGoals += 1
        }

        for (let count = 0; count < assistDelta; count += 1) {
          events.push({
            id: `${frame.matchId}-player-${player.playerId}-assist-${player.assists - assistDelta + count + 1}-${frame.tick}`,
            type: "assist_candidate",
            minute,
            tick: frame.tick,
            team: player.team,
            playerId: player.playerId,
          })
        }

        for (let count = 0; count < redCardDelta; count += 1) {
          events.push({
            id: `${frame.matchId}-player-${player.playerId}-red-${frame.tick}-${count}`,
            type: "red_card",
            minute,
            tick: frame.tick,
            team: player.team,
            playerId: player.playerId,
          })
        }
      }

      previousPlayers.set(player.playerId, {
        goals: player.goals,
        assists: player.assists,
        redCards: player.redCards,
      })
    }

    appendUnidentifiedGoals(events, frame, "home", Math.max(0, frame.home.goals - homeGoals - identifiedHomeGoals))
    appendUnidentifiedGoals(events, frame, "away", Math.max(0, frame.away.goals - awayGoals - identifiedAwayGoals))
    homeGoals = frame.home.goals
    awayGoals = frame.away.goals
  }

  return events
}

export function buildPositionHeatmaps(
  frames: readonly RealtimeFrame[],
  throughIndex = frames.length - 1,
): PlayerPositionHeatmap[] {
  type Cell = { count: number; sumX: number; sumY: number }
  type Accumulator = {
    playerId: number
    team: TeamSide
    sampleCount: number
    sumX: number
    sumY: number
    cells: Map<string, Cell>
  }

  const end = Math.min(Math.max(throughIndex, -1), frames.length - 1)
  if (end < 0) return []
  const currentFrame = frames[end]
  const currentMinute = frameMinute(currentFrame)
  const currentHalfStart = currentMinute < 45
    ? 0
    : currentMinute < 90
      ? 45
      : currentMinute < 105
        ? 90
        : 105

  const buildRange = (include: (frame: RealtimeFrame) => boolean) => {
    const players = new Map<number, Accumulator>()

    for (let index = 0; index <= end; index += 1) {
      const frame = frames[index]
      if (!include(frame)) continue
    // 0x141C0 is null during stoppages/out-of-play. Those frames must not
    // influence the positional distribution.
    if (frame.possessionTeam == null) continue

    for (const player of frame.players) {
      if (!player.isOnPitch || !Number.isFinite(player.x) || !Number.isFinite(player.y)) continue

      // GAME_MATCH positions are absolute pitch coordinates. Rotate second-half
      // samples by 180 degrees before aggregation so both halves share one
      // tactical orientation. The final Y negation swaps the current home/away
      // top-bottom presentation requested by the heatmap UI.
      const secondHalf = frame.period === 2
      const orientedX = secondHalf ? -player.x : player.x
      const orientedY = secondHalf ? -player.y : player.y
      // Coordinates are metres. Normalize against the live pitch half-size
      // carried by the same native event source used for the shot map.
      const halfWidth = validPitchHalf(frame.halfPitchWidth)
      const halfLength = validPitchHalf(frame.halfPitchLength)
      if (!halfWidth || !halfLength) continue
      const x = normalize(orientedX, -halfWidth, halfWidth)
      const y = normalize(-orientedY, -halfLength, halfLength)
      const column = Math.min(19, Math.floor(x / 5))
      const row = Math.min(29, Math.floor(y / (100 / 30)))
      const key = `${column}:${row}`
      let accumulator = players.get(player.playerId)
      if (!accumulator) {
        accumulator = {
          playerId: player.playerId,
          team: player.team,
          sampleCount: 0,
          sumX: 0,
          sumY: 0,
          cells: new Map(),
        }
        players.set(player.playerId, accumulator)
      }

      accumulator.sampleCount += 1
      accumulator.sumX += x
      accumulator.sumY += y
      const cell = accumulator.cells.get(key) ?? { count: 0, sumX: 0, sumY: 0 }
      cell.count += 1
      cell.sumX += x
      cell.sumY += y
      accumulator.cells.set(key, cell)
    }
    }

    return new Map([...players.values()].map((player) => [player.playerId, {
      playerId: player.playerId,
      team: player.team,
      sampleCount: player.sampleCount,
      averageX: player.sumX / player.sampleCount,
      averageY: player.sumY / player.sampleCount,
      points: [...player.cells.values()].map((cell) => ({
        x: cell.sumX / cell.count,
        y: cell.sumY / cell.count,
        weight: cell.count,
      })),
    }]))
  }

  const full = buildRange(() => true)
  const half = buildRange((frame) => {
    const minute = frameMinute(frame)
    return minute >= currentHalfStart && minute <= currentMinute
  })
  const recent15 = buildRange((frame) => frameMinute(frame) >= Math.max(0, currentMinute - 15))

  return [...full.values()].map((heatmap) => ({
    ...heatmap,
    ranges: {
      full: toHeatmapSlice(heatmap),
      half: toHeatmapSlice(half.get(heatmap.playerId)),
      recent15: toHeatmapSlice(recent15.get(heatmap.playerId)),
    },
  }))
}

function toHeatmapSlice(
  heatmap: (PlayerPositionHeatmapSlice & { playerId: number; team: TeamSide }) | undefined,
): PlayerPositionHeatmapSlice {
  return heatmap
    ? { sampleCount: heatmap.sampleCount, averageX: heatmap.averageX, averageY: heatmap.averageY, points: heatmap.points }
    : { sampleCount: 0, averageX: 50, averageY: 50, points: [] }
}

export function buildTacticalEvents(
  frames: readonly RealtimeFrame[],
  throughIndex = frames.length - 1,
): TacticalEventPoint[] {
  const end = Math.min(Math.max(throughIndex, -1), frames.length - 1)
  if (end < 0) return []

  const events = new Map<number, TacticalEventPoint>()
  for (let index = 0; index <= end; index += 1) {
    const frame = frames[index]
    const halfWidth = validPitchHalf(frame.halfPitchWidth)
    const halfLength = validPitchHalf(frame.halfPitchLength)
    if (!halfWidth || !halfLength) continue
    for (const item of frame.momentumEvents) {
      const metricId = nativeMomentumEventMetric(item.eventType)
      if (!metricId) continue
      const rotateForDisplay = nativeMomentumEventNeedsDisplayRotation(item)
      const lateral = rotateForDisplay ? -item.lateralPosition : item.lateralPosition
      const longitudinal = rotateForDisplay ? -item.longitudinalPosition : item.longitudinalPosition
      const displayTick = nativeMomentumEventDisplayTick(frame, item)
      events.set(item.eventIndex, {
        id: `${frame.matchId}-native-momentum-${item.eventIndex}`,
        metricId,
        playerId: item.playerId,
        receiverPlayerId: item.receiverPlayerId || undefined,
        team: item.team,
        tick: item.tick,
        displayTick,
        minute: Math.floor(displayTick / 240),
        x: normalize(longitudinal, -halfLength, halfLength),
        y: normalize(lateral, -halfWidth, halfWidth),
        nativeEventType: item.eventType,
        flags: item.flags,
      })
    }
  }

  return [...events.values()].sort((left, right) => left.tick - right.tick)
}

function nativeMomentumEventMetric(eventType: number): TacticalEventPoint["metricId"] | undefined {
  switch (eventType) {
    case 1: return "goals"
    case 2: return "shotsOffTarget"
    case 3: return "hitWoodwork"
    case 4: return "shotsOnTarget"
    case 5: return "blockedShots"
    case 7: return "passesCompleted"
    case 8:
    case 10:
    case 11: return "passesIncomplete"
    case 12: return "crossesCompleted"
    case 13:
    case 14:
    case 15:
    case 16: return "crossesIncomplete"
    case 18: return "fouled"
    case 19:
    case 20: return "foulsCommitted"
    case 26: return "tacklesWon"
    case 27: return "tacklesLost"
    case 28: return "aerialsWon"
    case 29: return "aerialsLost"
    case 31: return "interceptions"
    case 34: return "dribblesCompleted"
    case 54: return "touches"
    default: return undefined
  }
}

function nativeMomentumEventNeedsDisplayRotation(item: RealtimeMomentumEvent): boolean {
  const reverseDirection = (item.flags & 0x100) !== 0
  return item.team === "home" ? !reverseDirection : reverseDirection
}

function nativeMomentumEventDisplayTick(frame: RealtimeFrame, item: RealtimeMomentumEvent): number {
  const reverseDirection = (item.flags & 0x100) !== 0
  const usesSecondPeriodDirection = item.team === "home" ? reverseDirection : !reverseDirection
  if (!usesSecondPeriodDirection || frame.period < 2) return Math.max(0, item.tick)

  // Native event ticks retain first-half stoppage time; displayTick removes it
  // once the second half starts. A replayed historical second-half event uses
  // the same stable engine/display delta as the current capture frame.
  const displayOffset = Math.max(0, frame.tick - frame.displayTick)
  return Math.max(0, item.tick - displayOffset)
}

function validPitchHalf(value: number): number | undefined {
  return Number.isFinite(value) && value > 0 ? value : undefined
}

function frameMinute(frame: RealtimeFrame): number {
  const clockTick = Number.isFinite(frame.displayTick) ? frame.displayTick : frame.tick
  return Math.floor(Math.max(0, clockTick) / 240)
}

function appendXgPoint(
  points: readonly XgTimelinePoint[],
  point: XgTimelinePoint,
): XgTimelinePoint[] {
  const next = points.filter((entry) => entry.minute < point.minute)
  next.push(point)
  return next
}

function appendUnidentifiedGoals(
  events: MatchEvent[],
  frame: RealtimeFrame,
  team: TeamSide,
  count: number,
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

function toTeamStats(team: RealtimeTeam): TeamStats {
  return {
    ...team,
    hitWoodwork: 0,
    keyPasses: 0,
    dribbles: 0,
    assists: 0,
    xa: 0,
    keyTackles: 0,
    interceptions: 0,
    clearances: 0,
    fouled: 0,
    defensiveFreeKicks: 0,
    attackingFreeKicks: 0,
    throwIns: 0,
  }
}

function toPlayer(
  player: RealtimePlayer,
  metadata?: RealtimePlayerMetadata,
): MatchPlayer {
  const uid = metadata?.uid
  return {
    id: player.playerId,
    uid,
    name: metadata?.commonName || metadata?.displayName || `Player ${player.playerId}`,
    fullName: `${metadata?.firstName ?? ""} ${metadata?.secondName ?? ""}`.trim() || metadata?.displayName,
    portraitPath: metadata?.portraitPath,
    portraitUrl: uid != null ? graphicsAssetUrl("person", uid, "portrait") : undefined,
    team: player.team,
    shirtNumber: metadata?.shirtNumber,
    position: metadata?.position,
    positionFamiliarities: metadata?.positionFamiliarities,
    inPossession: metadata?.inPossession,
    outOfPossession: metadata?.outOfPossession,
    rating: player.rating > 0 ? player.rating : undefined,
    isStarter: !player.isSubstitute,
    isOnPitch: player.isOnPitch,
    coordinate: {
      rawX: player.x,
      rawY: player.y,
      displayX: normalize(player.x, -55, 55),
      displayY: normalize(player.y, -75, 75),
    },
    status: {
      subbedOnMinute: player.subbedOnMinute || undefined,
      subbedOffMinute: player.subbedOffMinute || undefined,
      yellowCards: player.yellowCards || undefined,
      redCards: player.redCards || undefined,
    },
    profile: metadata?.profile,
    attributes: metadata?.attributes,
    stats: {
      goals: player.goals,
      assists: player.assists,
      xg: player.xg,
      xa: player.xa,
      shots: player.shots,
      shotsOnTarget: player.shotsOnTarget,
      blockedShots: player.blockedShots,
      clearCutChances: player.clearCutChances,
      hitWoodwork: player.hitWoodwork,
      dribbles: player.dribbles,
      fouls: player.fouls,
      fouled: player.fouled,
      crosses: player.crosses,
      crossesCompleted: player.crossesCompleted,
      passes: player.passes,
      passesCompleted: player.passesCompleted,
      keyPasses: player.keyPasses,
      tacklesAttempted: player.tacklesAttempted,
      tacklesWon: player.tacklesWon,
      keyTackles: player.keyTackles,
      aerials: player.aerials,
      aerialsWon: player.aerialsWon,
      interceptions: player.interceptions,
      throwIns: player.throwIns,
      corners: player.corners,
      defensiveFreeKicks: player.defensiveFreeKicks,
      attackingFreeKicks: player.attackingFreeKicks,
      clearances: player.clearances,
      shotsFaced: player.shotsFaced,
      distanceM: player.distanceM,
      overallPhysicalCondition: player.overallPhysicalCondition,
      matchSharpness: player.matchSharpness,
    },
  }
}

function graphicsAssetUrl(entityType: string, uid: number, imageType: string): string {
  return `${apiBase}/api/assets/${encodeURIComponent(entityType)}/${uid}/${encodeURIComponent(imageType)}`
}

function normalize(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 50
  return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
}

function argbToCss(argb?: number): string | undefined {
  if (argb == null || !Number.isFinite(argb) || argb === 0) return undefined
  const rgb = (argb >>> 0) & 0x00ffffff
  return `#${rgb.toString(16).padStart(6, "0").toUpperCase()}`
}
