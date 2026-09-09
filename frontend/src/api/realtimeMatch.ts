import { startTransition, useEffect, useRef, useState } from "react"

import { HeatmapDerivations } from "@/api/heatmap"

import type {
  FormationSnapshot,
  MatchPlayer,
  MatchEvent,
  MatchSnapshot,
  MatchMomentumPoint,
  HeatmapSnapshot,
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
  penalties: number
  ownGoals: number
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
  trajectoryStartLateralPosition?: number | null
  trajectoryStartLongitudinalPosition?: number | null
  trajectoryEndLateralPosition?: number | null
  trajectoryEndLongitudinalPosition?: number | null
  trajectoryPoints?: Array<{
    lateralPosition: number
    longitudinalPosition: number
  }> | null
  team: TeamSide
  playerSlot: number
  playerId: number
  receiverPlayerSlot: number
  receiverPlayerId: number
  eventType: number
  flags: number
  sequenceIndex: number
  completionTick: number
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
  manager?: RealtimeManagerMetadata
}

export type RealtimeManagerMetadata = {
  uid?: number
  firstName?: string
  secondName?: string
  isHumanControlled: boolean
}

export type RealtimeMatchMetadata = {
  matchId: string
  startedUnixMilliseconds: number
  capturedTick: number
  matchDate?: string
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

type RealtimeFormationPlayerSnapshot = {
  slot: number
  playerId: number
  team: TeamSide
  isSubstitute: boolean
  isOnPitch: boolean
  subbedOnMinute: number
  subbedOffMinute: number
  inPossession?: PlayerTacticalAssignment
  outOfPossession?: PlayerTacticalAssignment
}

type RealtimeFormationTimelineEntry = {
  index: number
  tick: number
  displayTick: number
  players: RealtimeFormationPlayerSnapshot[]
}

type RealtimeFormationTimelineSlice = {
  matchId?: string
  status: string
  totalEntryCount: number
  entries: RealtimeFormationTimelineEntry[]
}

/** Incremental historical state. Each accepted frame is visited exactly once. */
class LiveDerivations {
  private previous?: RealtimeFrame
  private xg: XgTimelinePoint[] = [{ minute: 0, home: 0, away: 0 }]
  private events: MatchEvent[] = []
  private tactical = new Map<number, TacticalEventPoint>()
  private momentum = new Map<number, MatchMomentumPoint>()
  private rollingMomentum = new Map<number, MatchMomentumPoint>()
  private heatmaps = new HeatmapDerivations()

  reset() {
    this.previous = undefined
    this.xg = [{ minute: 0, home: 0, away: 0 }]
    this.events = []
    this.tactical.clear()
    this.momentum.clear()
    this.rollingMomentum.clear()
    this.heatmaps.reset()
  }

  append(frames: readonly RealtimeFrame[]) {
    for (const frame of frames) this.appendFrame(frame)
  }

  snapshot(currentTick: number) {
    return {
      xg: [...this.xg],
      events: [...this.events],
      tactical: [...this.tactical.values()].sort(
        (left, right) => left.tick - right.tick
      ),
      heatmaps: this.heatmaps.snapshot(),
      momentum: [...this.momentum.values()]
        .filter((point) => point.timeTicks <= currentTick + 1_200)
        .sort((left, right) => left.timeTicks - right.timeTicks),
      rollingMomentum: [...this.rollingMomentum.values()].sort(
        (left, right) => left.timeTicks - right.timeTicks
      ),
    }
  }

  private appendFrame(frame: RealtimeFrame) {
    const minute = frameMinute(frame)
    const xgPoint = { minute, home: frame.home.xg, away: frame.away.xg }
    const lastXg = this.xg.at(-1)
    if (lastXg?.minute === minute) this.xg[this.xg.length - 1] = xgPoint
    else this.xg.push(xgPoint)

    for (const point of frame.momentum) {
      if (!Number.isFinite(point.value) || !Number.isFinite(point.timeTicks))
        continue
      this.momentum.set(point.timeTicks, {
        ...point,
        minute: (point.timeTicks + 1) / 240,
      })
    }
    for (const point of frame.rollingMomentum) {
      if (!Number.isFinite(point.value) || !Number.isFinite(point.timeTicks))
        continue
      this.rollingMomentum.set(point.timeTicks, {
        ...point,
        minute: point.timeTicks / 240,
      })
    }

    this.appendNativeMomentumEvents(frame)
    const previous = this.previous
    if (previous) {
      this.appendEvents(previous, frame)
    }
    this.heatmaps.append([frame])
    this.previous = frame
  }

  private appendEvents(previous: RealtimeFrame, frame: RealtimeFrame) {
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
  }

  private appendNativeMomentumEvents(frame: RealtimeFrame) {
    const halfWidth = validPitchHalf(frame.halfPitchWidth)
    const halfLength = validPitchHalf(frame.halfPitchLength)
    if (!halfWidth || !halfLength) return
    for (const item of frame.momentumEvents) {
      const metricId = nativeMomentumEventMetric(item.eventType)
      if (!metricId) continue
      const metricIds = nativeMomentumEventMetricIds(item, metricId)
      const rotateForDisplay = nativeMomentumEventNeedsDisplayRotation(item)
      const rawStartLateral = finiteCoordinate(
        item.trajectoryStartLateralPosition
      )
      const rawStartLongitudinal = finiteCoordinate(
        item.trajectoryStartLongitudinalPosition
      )
      const rawEndLateral = finiteCoordinate(item.trajectoryEndLateralPosition)
      const rawEndLongitudinal = finiteCoordinate(
        item.trajectoryEndLongitudinalPosition
      )
      const anchorLateral = rotateForDisplay
        ? -item.lateralPosition
        : item.lateralPosition
      const anchorLongitudinal = rotateForDisplay
        ? -item.longitudinalPosition
        : item.longitudinalPosition
      const trajectoryStartLateral =
        rawStartLateral == null
          ? undefined
          : rotateForDisplay
            ? -rawStartLateral
            : rawStartLateral
      const trajectoryStartLongitudinal =
        rawStartLongitudinal == null
          ? undefined
          : rotateForDisplay
            ? -rawStartLongitudinal
            : rawStartLongitudinal
      const endLateral =
        rawEndLateral == null
          ? undefined
          : rotateForDisplay
            ? -rawEndLateral
            : rawEndLateral
      const endLongitudinal =
        rawEndLongitudinal == null
          ? undefined
          : rotateForDisplay
            ? -rawEndLongitudinal
            : rawEndLongitudinal
      const trajectoryPoints = normalizeMomentumTrajectory(
        item,
        rotateForDisplay,
        halfWidth,
        halfLength
      )
      const displayTick = nativeMomentumEventDisplayTick(frame, item)
      this.tactical.set(item.eventIndex, {
        id: `${frame.matchId}-native-momentum-${item.eventIndex}`,
        metricId,
        metricIds,
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
          trajectoryStartLongitudinal == null
            ? undefined
            : normalize(trajectoryStartLongitudinal, -halfLength, halfLength),
        trajectoryStartY:
          trajectoryStartLateral == null
            ? undefined
            : normalize(trajectoryStartLateral, -halfWidth, halfWidth),
        trajectoryPoints,
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
      })
    }
  }
}

export function useRealtimeMatch(enabled = true): MatchSnapshot | null {
  const [match, setMatch] = useState<MatchSnapshot | null>(null)
  const metadata = useRef<RealtimeMatchMetadata | null>(null)
  const enabledRef = useRef(enabled)
  const resumeRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    enabledRef.current = enabled
    if (enabled) resumeRef.current?.()
  }, [enabled])

  useEffect(() => {
    let disposed = false
    let socket: WebSocket | null = null
    let reconnectTimer: number | undefined
    let latestFrame: RealtimeFrame | null = null
    let historyMatchId = ""
    let historyLastTick = -1
    let formationHistoryIndex = 0
    let formationHistoryEntries: RealtimeFormationTimelineEntry[] = []
    let formationSnapshots: FormationSnapshot[] = []
    let derived = new LiveDerivations()
    let historical = derived.snapshot(0)
    let syncing = false
    let syncPending = false
    let formationSyncing = false
    let formationSyncPending = false

    const fetchMetadata = async () => {
      try {
        const response = await fetch(`${apiBase}/api/match/meta`, {
          cache: "no-store",
        })
        if (!response.ok) return false
        const next = (await response.json()) as RealtimeMatchMetadata | null
        const changed =
          JSON.stringify(next) !== JSON.stringify(metadata.current)
        metadata.current = next
        return changed
      } catch {
        // Metadata is retried on future snapshots.
        return false
      }
    }

    const publish = (frame: RealtimeFrame | null, lowPriority: boolean) => {
      if (disposed || !enabledRef.current || !frame) return
      const commit = () =>
        setMatch(
          toMatchSnapshot(
            frame,
            historical.xg,
            metadata.current,
            historical.events,
            historical.heatmaps,
            historical.tactical,
            historical.momentum,
            historical.rollingMomentum,
            formationSnapshots
          )
        )
      if (lowPriority) startTransition(commit)
      else commit()
    }

    const resetFor = (matchId: string) => {
      if (historyMatchId === matchId) return
      historyMatchId = matchId
      historyLastTick = -1
      formationHistoryIndex = 0
      formationHistoryEntries = []
      formationSnapshots = []
      derived = new LiveDerivations()
      historical = derived.snapshot(0)
      if (metadata.current?.matchId !== matchId) metadata.current = null
    }

    const rebuildFormationSnapshots = () => {
      if (!metadata.current) return
      formationSnapshots = formationHistoryEntries.map((entry) =>
        toFormationSnapshot(entry, metadata.current!)
      )
    }

    const acceptFormationSlice = (slice: RealtimeFormationTimelineSlice) => {
      if (
        slice.matchId &&
        latestFrame?.matchId &&
        slice.matchId !== latestFrame.matchId
      ) {
        return { changed: false, gap: false }
      }
      if (slice.matchId) resetFor(slice.matchId)

      let changed = false
      let gap = false
      const additions = slice.entries
        .filter((entry) => entry.index >= formationHistoryIndex)
        .sort((left, right) => left.index - right.index)
      for (const entry of additions) {
        if (entry.index > formationHistoryIndex) {
          gap = true
          break
        }
        formationHistoryEntries.push(entry)
        formationHistoryIndex = entry.index + 1
        if (metadata.current) {
          metadata.current = mergeFormationEntryIntoMetadata(
            metadata.current,
            entry
          )
        }
        changed = true
      }
      if (changed) rebuildFormationSnapshots()
      return { changed, gap }
    }

    const fetchFormationHistory = async () => {
      let changed = false
      let keepLoading = true
      while (!disposed && enabledRef.current && keepLoading) {
        const response = await fetch(
          `${apiBase}/api/match/formation/history?fromIndex=${formationHistoryIndex}&limit=256`,
          { cache: "no-store" }
        )
        if (!response.ok) throw new Error("live formation history read failed")
        const slice = (await response.json()) as RealtimeFormationTimelineSlice
        const accepted = acceptFormationSlice(slice)
        if (accepted.gap)
          throw new Error("live formation history has an index gap")
        changed ||= accepted.changed
        keepLoading =
          accepted.changed && formationHistoryIndex < slice.totalEntryCount
      }
      return changed
    }

    const syncFormationState = async () => {
      if (!enabledRef.current) {
        formationSyncPending = true
        return
      }
      if (formationSyncing) {
        formationSyncPending = true
        return
      }

      formationSyncing = true
      formationSyncPending = false
      try {
        const metadataChanged = await fetchMetadata()
        const historyChanged = await fetchFormationHistory()
        if (metadataChanged || historyChanged) {
          rebuildFormationSnapshots()
          publish(latestFrame, true)
        }
      } catch {
        // Reconnect and explicit Live resume retry the missing formation range.
      } finally {
        formationSyncing = false
        if (formationSyncPending && !disposed && enabledRef.current) {
          formationSyncPending = false
          void syncFormationState()
        }
      }
    }

    const refreshMetadataAfterFormationChange = async () => {
      if (!enabledRef.current) return
      if (await fetchMetadata()) {
        rebuildFormationSnapshots()
        publish(latestFrame, true)
      }
    }

    const syncHistory = async () => {
      if (!enabledRef.current) return
      if (syncing) {
        syncPending = true
        return
      }

      syncing = true
      syncPending = false
      try {
        let keepLoading = true
        let changed = false
        while (!disposed && enabledRef.current && keepLoading) {
          const fromTick = historyLastTick + 1
          const response = await fetch(
            `${apiBase}/api/match/frames?fromTick=${fromTick}&stride=1&limit=${liveFramePageSize}`
          )
          if (!response.ok) throw new Error("live frame read failed")
          const slice = (await response.json()) as RealtimeFrameSlice
          // An old request may finish after the WebSocket has already switched
          // to a new match. Never let that response roll live state backwards.
          if (
            slice.matchId &&
            latestFrame?.matchId &&
            slice.matchId !== latestFrame.matchId
          )
            return
          if (slice.matchId) resetFor(slice.matchId)
          const additions = slice.frames.filter(
            (frame) => frame.tick > historyLastTick
          )
          derived.append(additions)
          if (additions.length > 0) historyLastTick = additions.at(-1)!.tick
          changed ||= additions.length > 0
          keepLoading =
            slice.frames.length >= liveFramePageSize && additions.length > 0
        }
        if (changed)
          historical = derived.snapshot(latestFrame?.tick ?? historyLastTick)
        if (changed) publish(latestFrame, true)
      } catch {
        // WebSocket still keeps the current score/player state live. The next
        // low-frequency sync retries the missing historical range.
      } finally {
        syncing = false
        if (syncPending && !disposed && enabledRef.current) {
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
        if (enabledRef.current) {
          void fetchCurrent()
          void syncHistory()
          void syncFormationState()
        }
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
          } else if (envelope.type === "formation_changed") {
            const slice = envelope.payload as RealtimeFormationTimelineSlice
            const accepted = acceptFormationSlice(slice)
            if (accepted.gap) {
              formationSyncPending = true
              if (enabledRef.current) void syncFormationState()
              return
            }
            if (accepted.changed) {
              publish(latestFrame, false)
              void refreshMetadataAfterFormationChange()
            }
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

    resumeRef.current = () => {
      if (disposed) return
      void fetchCurrent()
      void syncHistory()
      void syncFormationState()
    }
    const syncTimer = window.setInterval(() => {
      if (enabledRef.current) void syncHistory()
    }, 1_000)
    connect()

    return () => {
      disposed = true
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer)
      window.clearInterval(syncTimer)
      socket?.close()
      resumeRef.current = null
    }
  }, [])

  return match
}

export function toMatchSnapshot(
  frame: RealtimeFrame,
  xgTimeline?: MatchSnapshot["xgTimeline"],
  metadata?: RealtimeMatchMetadata | null,
  events: MatchEvent[] = [],
  heatmaps: HeatmapSnapshot = { grids: new Map() },
  tacticalEvents: TacticalEventPoint[] = [],
  momentum: MatchMomentumPoint[] = [],
  rollingMomentum: MatchMomentumPoint[] = [],
  formationSnapshots?: FormationSnapshot[]
): MatchSnapshot {
  const clockTick = Number.isFinite(frame.displayTick)
    ? frame.displayTick
    : frame.tick
  const minute = Math.floor(Math.max(0, clockTick) / 240)
  const second = Math.floor(Math.max(0, clockTick) / 4) % 60
  const playerMetadataBySlot = new Map(
    metadata?.players.map((player) => [player.slot, player]) ?? []
  )
  const homeClubUid = metadata?.home.clubUid
  const awayClubUid = metadata?.away.clubUid

  return {
    matchId: frame.matchId,
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
      manager: metadata?.home.manager,
      logoUrl:
        homeClubUid != null
          ? graphicsAssetUrl("club", homeClubUid, "logo")
          : undefined,
      stats: toTeamStats(frame.home),
    },
    away: {
      uid: metadata?.away.uid,
      clubUid: awayClubUid,
      name: metadata?.away.name || "Away",
      color: argbToCss(metadata?.away.foregroundColour),
      logoPath: metadata?.away.logoPath,
      manager: metadata?.away.manager,
      logoUrl:
        awayClubUid != null
          ? graphicsAssetUrl("club", awayClubUid, "logo")
          : undefined,
      stats: toTeamStats(frame.away),
    },
    players: frame.players.map((player) =>
      toPlayer(player, playerMetadataBySlot.get(player.slot))
    ),
    events: [...events],
    heatmaps,
    tacticalEvents,
    momentum,
    rollingMomentum,
    formationSnapshots,
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
  throughIndex = frames.length - 1
): MatchMomentumPoint[] {
  const end = Math.min(Math.max(throughIndex, -1), frames.length - 1)
  if (end < 0) return []

  const points = new Map<number, MatchMomentumPoint>()
  for (let index = 0; index <= end; index += 1) {
    for (const point of frames[index].momentum) {
      if (!Number.isFinite(point.value) || !Number.isFinite(point.timeTicks))
        continue
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
  throughIndex = frames.length - 1
): MatchMomentumPoint[] {
  const end = Math.min(Math.max(throughIndex, -1), frames.length - 1)
  if (end < 0) return []

  const points = new Map<number, MatchMomentumPoint>()
  for (let index = 0; index <= end; index += 1) {
    for (const point of frames[index].rollingMomentum) {
      if (!Number.isFinite(point.value) || !Number.isFinite(point.timeTicks))
        continue
      points.set(point.timeTicks, {
        ...point,
        minute: point.timeTicks / 240,
      })
    }
  }

  return [...points.values()].sort(
    (left, right) => left.timeTicks - right.timeTicks
  )
}

export function buildXgTimeline(
  frames: readonly RealtimeFrame[],
  throughIndex = frames.length - 1
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
  throughIndex = frames.length - 1
): MatchEvent[] {
  const end = Math.min(Math.max(throughIndex, -1), frames.length - 1)
  if (end < 1) return []

  const events: MatchEvent[] = []
  let homeGoals = frames[0].home.goals
  let awayGoals = frames[0].away.goals
  const previousPlayers = new Map(
    frames[0].players.map((player) => [
      player.playerId,
      {
        goals: player.goals,
        assists: player.assists,
        ownGoals: player.ownGoals,
      },
    ])
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
        const ownGoalDelta = Math.max(0, player.ownGoals - previous.ownGoals)

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

        for (let count = 0; count < ownGoalDelta; count += 1) {
          const scoringTeam = oppositeTeam(player.team)
          events.push({
            id: `${frame.matchId}-player-${player.playerId}-own-goal-${frame.tick}-${count}`,
            type: "own_goal",
            minute,
            tick: frame.tick,
            team: player.team,
            playerId: player.playerId,
          })
          if (scoringTeam === "home") identifiedHomeGoals += 1
          else identifiedAwayGoals += 1
        }
      }

      previousPlayers.set(player.playerId, {
        goals: player.goals,
        assists: player.assists,
        ownGoals: player.ownGoals,
      })
    }

    appendUnidentifiedGoals(
      events,
      frame,
      "home",
      Math.max(0, frame.home.goals - homeGoals - identifiedHomeGoals)
    )
    appendUnidentifiedGoals(
      events,
      frame,
      "away",
      Math.max(0, frame.away.goals - awayGoals - identifiedAwayGoals)
    )
    homeGoals = frame.home.goals
    awayGoals = frame.away.goals
  }

  return events
}

export function buildTacticalEvents(
  frames: readonly RealtimeFrame[],
  throughIndex = frames.length - 1
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
      const metricIds = nativeMomentumEventMetricIds(item, metricId)
      const rotateForDisplay = nativeMomentumEventNeedsDisplayRotation(item)
      const rawStartLateral = finiteCoordinate(
        item.trajectoryStartLateralPosition
      )
      const rawStartLongitudinal = finiteCoordinate(
        item.trajectoryStartLongitudinalPosition
      )
      const rawEndLateral = finiteCoordinate(item.trajectoryEndLateralPosition)
      const rawEndLongitudinal = finiteCoordinate(
        item.trajectoryEndLongitudinalPosition
      )
      const anchorLateral = rotateForDisplay
        ? -item.lateralPosition
        : item.lateralPosition
      const anchorLongitudinal = rotateForDisplay
        ? -item.longitudinalPosition
        : item.longitudinalPosition
      const trajectoryStartLateral =
        rawStartLateral == null
          ? undefined
          : rotateForDisplay
            ? -rawStartLateral
            : rawStartLateral
      const trajectoryStartLongitudinal =
        rawStartLongitudinal == null
          ? undefined
          : rotateForDisplay
            ? -rawStartLongitudinal
            : rawStartLongitudinal
      const endLateral =
        rawEndLateral == null
          ? undefined
          : rotateForDisplay
            ? -rawEndLateral
            : rawEndLateral
      const endLongitudinal =
        rawEndLongitudinal == null
          ? undefined
          : rotateForDisplay
            ? -rawEndLongitudinal
            : rawEndLongitudinal
      const trajectoryPoints = normalizeMomentumTrajectory(
        item,
        rotateForDisplay,
        halfWidth,
        halfLength
      )
      const displayTick = nativeMomentumEventDisplayTick(frame, item)
      events.set(item.eventIndex, {
        id: `${frame.matchId}-native-momentum-${item.eventIndex}`,
        metricId,
        metricIds,
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
          trajectoryStartLongitudinal == null
            ? undefined
            : normalize(trajectoryStartLongitudinal, -halfLength, halfLength),
        trajectoryStartY:
          trajectoryStartLateral == null
            ? undefined
            : normalize(trajectoryStartLateral, -halfWidth, halfWidth),
        trajectoryPoints,
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
      })
    }
  }

  return [...events.values()].sort((left, right) => left.tick - right.tick)
}

function nativeMomentumEventMetric(
  eventType: number
): TacticalEventPoint["metricId"] | undefined {
  switch (eventType) {
    case 1:
      return "goals"
    case 2:
      return "shotsOffTarget"
    case 3:
      return "hitWoodwork"
    case 4:
      return "shotsOnTarget"
    case 5:
      return "blockedShots"
    case 7:
      return "passesCompleted"
    case 6:
    case 8:
    case 9:
    case 10:
    case 11:
      return "passesIncomplete"
    case 12:
      return "crossesCompleted"
    case 13:
    case 14:
    case 15:
    case 16:
    case 17:
      return "crossesIncomplete"
    case 18:
      return "fouled"
    case 19:
    case 20:
    case 21:
      return "foulsCommitted"
    case 23:
      return "offsides"
    case 24:
      return "clearances"
    case 25:
      return "defensiveBlocks"
    case 26:
      return "tacklesWon"
    case 27:
      return "tacklesLost"
    case 28:
      return "aerialsWon"
    case 29:
      return "aerialsLost"
    case 31:
      return "interceptions"
    case 34:
      return "dribblesCompleted"
    case 37:
      return "goalkeeperSavesHeld"
    case 38:
      return "goalkeeperSavesParried"
    case 52:
      return "possessionGained"
    case 53:
      return "possessionLost"
    case 54:
      return "touches"
    default:
      return undefined
  }
}

function nativeMomentumEventMetricIds(
  item: RealtimeMomentumEvent,
  primaryMetricId: TacticalEventPoint["metricId"]
): TacticalEventPoint["metricId"][] {
  const isPassOrCross = item.eventType >= 6 && item.eventType <= 17
  return isPassOrCross && (item.flags & 0x02) !== 0
    ? [primaryMetricId, "keyPasses"]
    : [primaryMetricId]
}

function nativeMomentumEventNeedsDisplayRotation(
  item: RealtimeMomentumEvent
): boolean {
  const reverseDirection = (item.flags & 0x100) !== 0
  return item.team === "home" ? !reverseDirection : reverseDirection
}

function nativeMomentumEventDisplayTick(
  frame: RealtimeFrame,
  item: RealtimeMomentumEvent
): number {
  const reverseDirection = (item.flags & 0x100) !== 0
  const usesSecondPeriodDirection =
    item.team === "home" ? reverseDirection : !reverseDirection
  if (!usesSecondPeriodDirection || frame.period < 2)
    return Math.max(0, item.tick)

  // Native event ticks retain first-half stoppage time; displayTick removes it
  // once the second half starts. A replayed historical second-half event uses
  // the same stable engine/display delta as the current capture frame.
  const displayOffset = Math.max(0, frame.tick - frame.displayTick)
  return Math.max(0, item.tick - displayOffset)
}

function validPitchHalf(value: number): number | undefined {
  return Number.isFinite(value) && value > 0 ? value : undefined
}

function finiteCoordinate(
  value: number | null | undefined
): number | undefined {
  return value != null && Number.isFinite(value) ? value : undefined
}

function normalizeMomentumTrajectory(
  event: RealtimeMomentumEvent,
  rotateForDisplay: boolean,
  halfWidth: number,
  halfLength: number
): Array<{ x: number; y: number }> {
  let rawPoints = (event.trajectoryPoints ?? []).filter(
    (point) =>
      Number.isFinite(point.lateralPosition) &&
      Number.isFinite(point.longitudinalPosition)
  )
  if (rawPoints.length === 0) {
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
      rawPoints = [
        {
          lateralPosition: startLateral,
          longitudinalPosition: startLongitudinal,
        },
        { lateralPosition: endLateral, longitudinalPosition: endLongitudinal },
      ]
    }
  }
  return rawPoints.map((point) => {
    const lateral = rotateForDisplay
      ? -point.lateralPosition
      : point.lateralPosition
    const longitudinal = rotateForDisplay
      ? -point.longitudinalPosition
      : point.longitudinalPosition
    return {
      x: normalize(longitudinal, -halfLength, halfLength),
      y: normalize(lateral, -halfWidth, halfWidth),
    }
  })
}

function frameMinute(frame: RealtimeFrame): number {
  const clockTick = Number.isFinite(frame.displayTick)
    ? frame.displayTick
    : frame.tick
  return Math.floor(Math.max(0, clockTick) / 240)
}

function oppositeTeam(team: TeamSide): TeamSide {
  return team === "home" ? "away" : "home"
}

function appendXgPoint(
  points: readonly XgTimelinePoint[],
  point: XgTimelinePoint
): XgTimelinePoint[] {
  const next = points.filter((entry) => entry.minute < point.minute)
  next.push(point)
  return next
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

function toFormationSnapshot(
  entry: RealtimeFormationTimelineEntry,
  metadata: RealtimeMatchMetadata
): FormationSnapshot {
  const playerMetadataBySlot = new Map(
    metadata.players.map((player) => [player.slot, player])
  )
  return {
    tick: Math.max(0, entry.tick),
    minute: Math.floor(Math.max(0, entry.displayTick) / 240),
    players: entry.players.map((player) => {
      const details = playerMetadataBySlot.get(player.slot)
      const uid = details?.uid
      return {
        id: uid ?? player.playerId,
        uid,
        name:
          details?.commonName ||
          details?.displayName ||
          `Player ${player.playerId}`,
        fullName:
          `${details?.firstName ?? ""} ${details?.secondName ?? ""}`.trim() ||
          details?.displayName,
        portraitPath: details?.portraitPath,
        portraitUrl:
          uid != null ? graphicsAssetUrl("person", uid, "portrait") : undefined,
        team: player.team,
        shirtNumber: details?.shirtNumber,
        position: details?.position,
        positionFamiliarities: details?.positionFamiliarities,
        inPossession: player.inPossession,
        outOfPossession: player.outOfPossession,
        isStarter: !player.isSubstitute,
        isOnPitch: player.isOnPitch,
        status: {
          subbedOnMinute: player.subbedOnMinute || undefined,
          subbedOffMinute: player.subbedOffMinute || undefined,
        },
        stats: { goals: 0, assists: 0 },
      }
    }),
  }
}

function mergeFormationEntryIntoMetadata(
  metadata: RealtimeMatchMetadata,
  entry: RealtimeFormationTimelineEntry
): RealtimeMatchMetadata {
  const assignmentsBySlot = new Map(
    entry.players.map((player) => [player.slot, player])
  )
  return {
    ...metadata,
    capturedTick: entry.tick,
    players: metadata.players.map((player) => {
      const assignment = assignmentsBySlot.get(player.slot)
      return assignment
        ? {
            ...player,
            inPossession: assignment.inPossession,
            outOfPossession: assignment.outOfPossession,
          }
        : player
    }),
  }
}

function toPlayer(
  player: RealtimePlayer,
  metadata?: RealtimePlayerMetadata
): MatchPlayer {
  const uid = metadata?.uid
  return {
    id: uid ?? player.playerId,
    uid,
    name:
      metadata?.commonName ||
      metadata?.displayName ||
      `Player ${player.playerId}`,
    fullName:
      `${metadata?.firstName ?? ""} ${metadata?.secondName ?? ""}`.trim() ||
      metadata?.displayName,
    portraitPath: metadata?.portraitPath,
    portraitUrl:
      uid != null ? graphicsAssetUrl("person", uid, "portrait") : undefined,
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
      penalties: player.penalties || undefined,
      ownGoals: player.ownGoals || undefined,
    },
    profile: metadata?.profile,
    attributes: metadata?.attributes,
    stats: {
      goals: player.goals,
      assists: player.assists,
      penalties: player.penalties,
      ownGoals: player.ownGoals,
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

function graphicsAssetUrl(
  entityType: string,
  uid: number,
  imageType: string
): string {
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
