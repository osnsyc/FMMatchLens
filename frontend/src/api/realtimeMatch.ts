import type { LiveMotionSource } from "@/api/liveMotionSource"
import { startTransition, useEffect, useRef, useState } from "react"

import { HeatmapDerivations } from "@/api/heatmap"
import {
  attachAuxiliaryEventAnnotations,
  nativeMomentumEventAnnotations,
  nativeMomentumEventMetric,
  nativeMomentumEventMetricIds,
} from "@/api/momentumEventSemantics"
import { HistoricalDerivations } from "@/api/replay/replayDerivations"
import { reuseMatchSnapshot } from "@/lib/matchSnapshotReuse"
import {
  calculateRatingContribution,
  decodeArchiveRatingInputs,
  decodeRealtimeRatingInputs,
  decodeLiveRatingInputs,
  observedRatingWeightConfiguration,
  type RatingWeightConfiguration,
} from "@/lib/ratingCalculator"
import {
  backendWebSocketUrl,
  defaultBackendUrl,
  loadBackendUrl,
} from "@/api/backend"

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
  XgShotPoint,
  XgTimelinePoint,
} from "@/types/match"

const liveFramePageSize = 2_400

export type RealtimeTeam = {
  goals: number
  xg: number
  possessionTime: number
  shots: number
  shotsOnTarget: number
  firstHalfShots: number
  secondHalfShots: number
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
  /** Integer wire value; divide by 100 for m/s. */
  speedCentimetersPerSecond?: number
  angleDegrees?: number
  rating: number
  isSubstitute: boolean
  isOnPitch: boolean
  subbedOnMinute: number
  subbedOffMinute: number
  penalties: number
  ownGoals: number
  shotsFaced: number
  savesHeld: number
  savesParried: number
  savesTipped: number
  ratingInputs?: RealtimeRatingInputs
  archiveRatingInputs?: ArchiveRatingInputs
  ratingContribution?: RatingContribution
}

/** Compact binary-archive input retained until its frame is displayed. */
export type ArchiveRatingInputs = {
  /** The 34 archive-only bytes not already represented by RealtimePlayer stats. */
  statsPacked: Uint8Array
  internalW25: number
  internalW24: number
  specialW2C: number
  specialW2D: number
  specialW2E: number
  specialW2F: number
  specialW30: number
  specialW31: number
  internalScore: number
  specialConditionA: number
  specialConditionB: number
  inPossessionRoleDuty: bigint
  outOfPossessionRoleDuty: bigint
  totalEligibleDuration: number
  classificationDurations: RatingClassificationDuration[]
  qualityFlags: string[]
  ratingEvents: Uint8Array[]
}

export type RealtimeRatingInputs = {
  /** Base64-encoded 34-byte rating-only stat vector. */
  statsPacked: string
  internalW25: number
  internalW24: number
  specialW2C: number
  specialW2D: number
  specialW2E: number
  specialW2F: number
  specialW30: number
  specialW31: number
  rawInternalRating: number
  specialConditionA: number
  specialConditionB: number
  /** Decimal uint64 strings preserve the raw role/duty values losslessly over JSON. */
  inPossessionRoleDuty: string
  outOfPossessionRoleDuty: string
  totalEligibleDuration: number
  ratingEventsCommonLength: number
  ratingEventsTail: string[]
}

export type RealtimeRatingModel = {
  ratingBaseCondition: number
  matchPhase: number
  eventRewardBranch: number
  activeBaseline: number
  homeBackgroundInput: number
  awayBackgroundInput: number
}

export type RatingContribution = {
  nativeRating: number
  internalScore: number
  groupContributionsPreFactor: Record<RatingContributionGroup, number>
  groupContributionsPostFactor: Record<RatingContributionGroup, number>
  preFactorTotal: number
  selectedFactorIndex: number
  selectedBaseFactor: number
  effectiveFactor: number
  globalFactorAdjustment: number
  predictedInternalScore: number
  reconstructionResidual: number
  classificationDurations: RatingClassificationDuration[]
  qualityFlags: string[]
  terms: RatingContributionTerm[]
  limitation: string
}

export type RatingContributionGroup =
  | "BaseContext" | "Shooting" | "Creativity" | "Passing" | "Defence" | "Goalkeeping"

export type RatingClassificationDuration = { categoryBit: number; duration: number }

export type RatingContributionTerm = {
  index: number
  categoryBit: number
  group: RatingContributionGroup
  input: number
  coefficient: number
  contribution: number
  postFactorContribution: number
  confidence: string
}

export type RealtimeFrame = {
  sequence: number
  matchId: string
  tick: number
  displayTick: number
  period: number
  ratingModel?: RealtimeRatingModel
  capturedUnixMilliseconds: number
  possessionTeam?: TeamSide
  ballHolderPlayerId?: number
  /** Integer wire values in centimeters. */
  ballXCentimeters: number
  ballYCentimeters: number
  ballZCentimeters: number
  halfPitchWidth: number
  halfPitchLength: number
  momentumEvents: RealtimeMomentumEvent[]
  momentumEventUpdates?: RealtimeMomentumEventUpdate[]
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

export type RealtimeMomentumEventUpdate = {
  updateSequence: number
  operation: "add" | "update"
  sequenceIndex: number
  revision: number
  event: RealtimeMomentumEvent
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
  squadNumber?: number
  shirtName?: string
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
  shirtNumberColor?: number
  shirtBackgroundColor?: number
  shirtBackgroundColorGK?: number
  logoPath?: string
  manager?: RealtimeManagerMetadata
}

export type RealtimeManagerMetadata = {
  uid?: number
  firstName?: string
  secondName?: string
  isHumanControlled: boolean
}

export type RealtimeCompetitionMetadata = {
  uid?: number
  name?: string
  logoPath?: string
  primaryColour?: number
  secondaryColour?: number
  tertiaryColour?: number
}

export type RealtimeMatchMetadata = {
  matchId: string
  startedUnixMilliseconds: number
  capturedTick: number
  matchDate?: string
  halfPitchWidth?: number
  halfPitchLength?: number
  competition?: RealtimeCompetitionMetadata
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
/** @deprecated Legacy parity oracle; live and replay use HistoricalDerivations. */
export class LegacyLiveDerivations {
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
      if (item.eventType === 20 || item.eventType === 21) {
        const type = item.eventType === 20 ? "yellow_card" : "red_card"
        const id = `${frame.matchId}-native-${type}-${item.sequenceIndex}`
        if (!this.events.some((event) => event.id === id)) {
          const displayTick = nativeMomentumEventDisplayTick(frame, item)
          this.events.push({
            id,
            type,
            minute: Math.floor(displayTick / 240),
            tick: item.tick,
            team: item.team,
            playerId: item.playerId,
          })
        }
      }
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
      this.tactical.set(item.sequenceIndex, {
        id: `${frame.matchId}-native-momentum-${item.sequenceIndex}`,
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
        completionTick: item.completionTick,
        annotations: nativeMomentumEventAnnotations(item),
      })
    }
  }
}

export function useRealtimeMatch(
  enabled = true,
  backendUrl = defaultBackendUrl,
  motionSource?: LiveMotionSource
): MatchSnapshot | null {
  const [match, setMatch] = useState<MatchSnapshot | null>(null)
  const metadata = useRef<RealtimeMatchMetadata | null>(null)
  const enabledRef = useRef(enabled)

  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

  useEffect(() => {
    // Do not even create the localhost WebSocket or issue an API request until
    // the caller explicitly enables live connectivity.
    motionSource?.reset()
    motionSource?.resetMovement()
    if (!enabled) return

    const apiBase = backendUrl
    const webSocketUrl = backendWebSocketUrl(backendUrl)

    let disposed = false
    let connectionGeneration = 0
    let controller = new AbortController()
    const liveFetch: typeof fetch = (input, init) =>
      fetch(input, { ...init, signal: controller.signal })
    let socket: WebSocket | null = null
    let reconnectTimer: number | undefined
    let latestFrame: RealtimeFrame | null = null
    let liveRatingInputs = new Map<number, ArchiveRatingInputs>()
    let historyRatingInputs = new Map<number, ArchiveRatingInputs>()
    const liveRatingContributions = new RatingContributionResolverCache()
    const ratingConfiguration = observedRatingWeightConfiguration
    let historyMatchId = ""
    let historyLastTick = -1
    let formationHistoryIndex = 0
    let formationHistoryEntries: RealtimeFormationTimelineEntry[] = []
    let formationSnapshots: FormationSnapshot[] = []
    let publishedSnapshot: MatchSnapshot | undefined
    let derived = new HistoricalDerivations()
    let historical = derived.snapshot(0)
    let syncing = false
    let syncPending = false
    let formationSyncing = false
    let formationSyncPending = false

    const fetchMetadata = async () => {
      const generation = connectionGeneration
      try {
        const response = await liveFetch(`${apiBase}/api/match/meta`, {
          cache: "no-store",
        })
        if (!response.ok) return false
        const next = (await response.json()) as RealtimeMatchMetadata | null
        if (
          disposed ||
          generation !== connectionGeneration ||
          (next?.matchId &&
            latestFrame?.matchId &&
            next.matchId !== latestFrame.matchId)
        )
          return false
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
      const commit = () => {
        publishedSnapshot = toMatchSnapshot(
          frame,
          historical.xgTimeline,
          metadata.current,
          historical.events,
          historical.heatmaps,
          historical.tacticalEvents,
          historical.xgShots,
          historical.momentum,
          historical.rollingMomentum,
          formationSnapshots,
          publishedSnapshot,
          true,
          ratingConfiguration,
          undefined,
          liveRatingContributions,
        )
        setMatch(publishedSnapshot)
      }
      if (lowPriority) startTransition(commit)
      else commit()
    }

    const resetFor = (matchId: string) => {
      if (historyMatchId === matchId) return
      motionSource?.reset()
      motionSource?.resetMovement()
      motionSource?.setStatus("buffering")
      historyMatchId = matchId
      historyLastTick = -1
      formationHistoryIndex = 0
      formationHistoryEntries = []
      formationSnapshots = []
      liveRatingInputs = new Map()
      historyRatingInputs = new Map()
      liveRatingContributions.clear()
      publishedSnapshot = undefined
      derived = new HistoricalDerivations()
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
      const generation = connectionGeneration
      let changed = false
      let keepLoading = true
      while (!disposed && enabledRef.current && keepLoading) {
        const response = await liveFetch(
          `${apiBase}/api/match/formation/history?fromIndex=${formationHistoryIndex}&limit=256`,
          { cache: "no-store" }
        )
        if (!response.ok) throw new Error("live formation history read failed")
        const slice = (await response.json()) as RealtimeFormationTimelineSlice
        if (disposed || generation !== connectionGeneration) return false
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

      const generation = connectionGeneration
      syncing = true
      syncPending = false
      try {
        let keepLoading = true
        let changed = false
        while (!disposed && enabledRef.current && keepLoading) {
          const fromTick = historyLastTick + 1
          const response = await liveFetch(
            `${apiBase}/api/match/frames?fromTick=${fromTick}&stride=1&limit=${liveFramePageSize}`
          )
          if (!response.ok) throw new Error("live frame read failed")
          const slice = (await response.json()) as RealtimeFrameSlice
          if (disposed || generation !== connectionGeneration) return
          // An old request may finish after the WebSocket has already switched
          // to a new match. Never let that response roll live state backwards.
          if (
            slice.matchId &&
            latestFrame?.matchId &&
            slice.matchId !== latestFrame.matchId
          )
            return
          if (slice.matchId) resetFor(slice.matchId)
          if (
            slice.status === "ended" &&
            slice.matchId === latestFrame?.matchId
          )
            motionSource?.setStatus("ended")
          const hydratedFrames = slice.frames.map((frame) =>
            hydrateRealtimeRatingFrame(frame, historyRatingInputs)
          )
          const additions = hydratedFrames.filter(
            (frame) => frame.tick > historyLastTick
          )
          derived.append(additions)
          motionSource?.ingestMovementFrames(additions)
          if (additions.length > 0) {
            historyLastTick = additions.at(-1)!.tick
          }
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
      const generation = connectionGeneration
      try {
        const expected = latestFrame
        const response = await liveFetch(`${apiBase}/api/match/current`)
        if (!response.ok) return
        const rawFrame = (await response.json()) as RealtimeFrame | null
        if (
          disposed ||
          generation !== connectionGeneration ||
          latestFrame !== expected
        )
          return
        if (rawFrame?.matchId) {
          resetFor(rawFrame.matchId)
          const frame = hydrateRealtimeRatingFrame(rawFrame, liveRatingInputs)
          latestFrame = frame
          motionSource?.publish(frame, false)
          publish(frame, false)
        }
      } catch {
        // The plugin may not be running yet; reconnect and polling handle recovery.
      }
    }

    const connect = () => {
      if (disposed) return

      connectionGeneration++
      if (controller.signal.aborted) controller = new AbortController()
      socket = new WebSocket(webSocketUrl)
      const connection = socket
      socket.onopen = () => {
        if (disposed || socket !== connection) return
        motionSource?.reset()
        motionSource?.setStatus("buffering")
        if (enabledRef.current) {
          void fetchCurrent()
          void syncHistory()
          void syncFormationState()
        }
      }
      socket.onmessage = (event: MessageEvent<string>) => {
        if (disposed || socket !== connection) return
        try {
          const envelope = JSON.parse(event.data) as RealtimeEnvelope
          if (envelope.type === "realtime_tick") {
            const rawFrame = envelope.payload as RealtimeFrame
            if (!rawFrame?.matchId) return
            if (
              latestFrame?.matchId === rawFrame.matchId &&
              rawFrame.tick < latestFrame.tick
            ) return
            resetFor(rawFrame.matchId)
            const frame = hydrateRealtimeRatingFrame(
              rawFrame,
              liveRatingInputs,
            )
            latestFrame = frame
            motionSource?.publish(frame)
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
        if (socket !== connection) return
        connectionGeneration++
        controller.abort()
        motionSource?.setStatus("disconnected")
        if (!disposed) {
          reconnectTimer = window.setTimeout(connect, 2_000)
        }
      }
      socket.onerror = () => socket?.close()
    }

    const syncTimer = window.setInterval(() => {
      if (enabledRef.current) void syncHistory()
    }, 1_000)
    connect()

    return () => {
      disposed = true
      controller.abort()
      motionSource?.reset()
      motionSource?.resetMovement()
      if (socket)
        socket.onopen =
          socket.onmessage =
          socket.onclose =
          socket.onerror =
            null
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer)
      window.clearInterval(syncTimer)
      socket?.close()
    }
  }, [backendUrl, enabled, motionSource])

  return enabled ? match : null
}

export function toMatchSnapshot(
  frame: RealtimeFrame,
  xgTimeline?: MatchSnapshot["xgTimeline"],
  metadata?: RealtimeMatchMetadata | null,
  events: MatchEvent[] = [],
  heatmaps: HeatmapSnapshot = { grids: new Map(), revision: 0 },
  tacticalEvents: TacticalEventPoint[] = [],
  xgShots: XgShotPoint[] = [],
  momentum: MatchMomentumPoint[] = [],
  rollingMomentum: MatchMomentumPoint[] = [],
  formationSnapshots?: FormationSnapshot[],
  previous?: MatchSnapshot,
  allowLocalAssets = true,
  ratingConfiguration?: RatingWeightConfiguration,
  cachedRatingContributions?: readonly (RatingContribution | undefined)[],
  ratingResolverCache?: RatingContributionResolverCache,
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

  const next: MatchSnapshot = {
    matchId: frame.matchId,
    pitchDimensions: toPitchDimensions(metadata),
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
      colorSource: metadata?.home,
      logoPath: metadata?.home.logoPath,
      manager: metadata?.home.manager,
      logoUrl:
        allowLocalAssets && homeClubUid != null
          ? graphicsAssetUrl("club", homeClubUid, "logo")
          : archivedAssetUrl(metadata?.home.logoPath),
      stats: toTeamStats(frame.home),
    },
    away: {
      uid: metadata?.away.uid,
      clubUid: awayClubUid,
      name: metadata?.away.name || "Away",
      colorSource: metadata?.away,
      logoPath: metadata?.away.logoPath,
      manager: metadata?.away.manager,
      logoUrl:
        allowLocalAssets && awayClubUid != null
          ? graphicsAssetUrl("club", awayClubUid, "logo")
          : archivedAssetUrl(metadata?.away.logoPath),
      stats: toTeamStats(frame.away),
    },
    players: frame.players.map((player, index) => {
      const ratingContribution = cachedRatingContributions?.[index]
        ?? (ratingResolverCache
          ? player.ratingContribution
          : calculatePlayerRatingContribution(player, frame.ratingModel, ratingConfiguration))
      const resolveRatingContribution = ratingResolverCache?.resolverFor(
        player,
        frame.ratingModel,
        ratingConfiguration,
      )
      return toPlayer(
        ratingContribution ? { ...player, ratingContribution } : player,
        playerMetadataBySlot.get(player.slot),
        metadata?.matchDate,
        allowLocalAssets,
        resolveRatingContribution,
      )
    }),
    events,
    heatmaps,
    tacticalEvents,
    xgShots,
    momentum,
    rollingMomentum,
    formationSnapshots,
    xgTimeline: xgTimeline?.length
      ? xgTimeline
      : appendXgPoint([{ minute: 0, home: 0, away: 0 }], {
          minute,
          home: frame.home.xg,
          away: frame.away.xg,
        }),
  }
  return reuseMatchSnapshot(previous, next)
}

export class RatingContributionResolverCache {
  private readonly entries = new Map<number, RatingResolverEntry>()

  clear() {
    this.entries.clear()
  }

  resolverFor(
    player: RealtimePlayer,
    model: RealtimeRatingModel | undefined,
    configuration?: RatingWeightConfiguration,
  ) {
    if (player.ratingContribution) return () => player.ratingContribution
    if (!model || !configuration || (!player.archiveRatingInputs && !player.ratingInputs)) return undefined
    const previous = this.entries.get(player.slot)
    if (
      previous
      && previous.input === (player.archiveRatingInputs ?? player.ratingInputs)
      && previous.configuration === configuration
      && sameRatingModel(previous.model, model)
      && sameRatingPlayerSource(previous.player, player)
    ) return previous.resolve

    let calculated: RatingContribution | undefined
    let hasCalculated = false
    const resolve = () => {
      if (!hasCalculated) {
        calculated = calculatePlayerRatingContribution(player, model, configuration)
        hasCalculated = true
      }
      return calculated
    }
    this.entries.set(player.slot, {
      input: player.archiveRatingInputs ?? player.ratingInputs!,
      configuration,
      model,
      player,
      resolve,
    })
    return resolve
  }
}

type RatingResolverEntry = {
  input: ArchiveRatingInputs | RealtimeRatingInputs
  configuration: RatingWeightConfiguration
  model: RealtimeRatingModel
  player: RealtimePlayer
  resolve: () => RatingContribution | undefined
}

function sameRatingModel(left: RealtimeRatingModel, right: RealtimeRatingModel) {
  return left.ratingBaseCondition === right.ratingBaseCondition
    && left.matchPhase === right.matchPhase
    && left.eventRewardBranch === right.eventRewardBranch
    && left.activeBaseline === right.activeBaseline
    && left.homeBackgroundInput === right.homeBackgroundInput
    && left.awayBackgroundInput === right.awayBackgroundInput
}

function sameRatingPlayerSource(left: RealtimePlayer, right: RealtimePlayer) {
  return left.team === right.team && left.rating === right.rating && left.xg === right.xg
    && left.goals === right.goals && left.penalties === right.penalties && left.ownGoals === right.ownGoals
    && left.shots === right.shots && left.shotsOnTarget === right.shotsOnTarget
    && left.savesHeld === right.savesHeld && left.savesParried === right.savesParried && left.savesTipped === right.savesTipped
    && left.assists === right.assists && left.dribbles === right.dribbles && left.fouls === right.fouls && left.fouled === right.fouled
    && left.tacklesAttempted === right.tacklesAttempted && left.tacklesWon === right.tacklesWon
    && left.aerials === right.aerials && left.aerialsWon === right.aerialsWon
    && left.interceptions === right.interceptions && left.clearances === right.clearances
}

function hydrateRealtimeRatingFrame(
  frame: RealtimeFrame,
  priorBySlot: Map<number, ArchiveRatingInputs>,
) {
  let changed = false
  const players = frame.players.map((player) => {
    if (!player.ratingInputs) return player
    try {
      const compact = decodeRealtimeRatingInputs(
        player.ratingInputs,
        priorBySlot.get(player.slot),
      )
      priorBySlot.set(player.slot, compact)
      changed = true
      return { ...player, ratingInputs: undefined, archiveRatingInputs: compact }
    } catch {
      return { ...player, ratingInputs: undefined, archiveRatingInputs: undefined }
    }
  })
  return changed ? { ...frame, players } : frame
}

export function calculateFrameRatingContributions(
  frame: RealtimeFrame,
  ratingConfiguration?: RatingWeightConfiguration,
): readonly (RatingContribution | undefined)[] {
  return frame.players.map((player) =>
    calculatePlayerRatingContribution(player, frame.ratingModel, ratingConfiguration)
  )
}

function calculatePlayerRatingContribution(
  player: RealtimePlayer,
  model: RealtimeRatingModel | undefined,
  ratingConfiguration?: RatingWeightConfiguration,
) {
  if (player.ratingContribution) return player.ratingContribution
  if (!model || !ratingConfiguration) return undefined
  if (player.archiveRatingInputs) {
    return calculateRatingContribution(
      decodeArchiveRatingInputs(player.archiveRatingInputs, player, model, ratingConfiguration)
    )
  }
  if (player.ratingInputs) {
    return calculateRatingContribution(
      decodeLiveRatingInputs(player.ratingInputs, player, model, ratingConfiguration)
    )
  }
  return undefined
}

export function toPitchDimensions(metadata?: RealtimeMatchMetadata | null) {
  const halfWidth = metadata?.halfPitchWidth
  const halfLength = metadata?.halfPitchLength
  return halfWidth != null &&
    halfLength != null &&
    Number.isFinite(halfWidth) &&
    Number.isFinite(halfLength) &&
    halfWidth > 0 &&
    halfLength > 0
    ? { length: halfLength * 2, width: halfWidth * 2 }
    : undefined
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
  if (end < 0) return []

  const events: MatchEvent[] = []
  const nativeCards = new Set<number>()
  const appendNativeCards = (frame: RealtimeFrame) => {
    for (const item of frame.momentumEvents) {
      if (
        (item.eventType !== 20 && item.eventType !== 21) ||
        nativeCards.has(item.sequenceIndex)
      )
        continue
      nativeCards.add(item.sequenceIndex)
      const displayTick = nativeMomentumEventDisplayTick(frame, item)
      const type = item.eventType === 20 ? "yellow_card" : "red_card"
      events.push({
        id: `${frame.matchId}-native-${type}-${item.sequenceIndex}`,
        type,
        minute: Math.floor(displayTick / 240),
        tick: item.tick,
        team: item.team,
        playerId: item.playerId,
      })
    }
  }
  appendNativeCards(frames[0])
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

    appendNativeCards(frame)

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
  const nativeEvents = new Map<number, RealtimeMomentumEvent>()
  for (let index = 0; index <= end; index += 1) {
    const frame = frames[index]
    const halfWidth = validPitchHalf(frame.halfPitchWidth)
    const halfLength = validPitchHalf(frame.halfPitchLength)
    if (!halfWidth || !halfLength) continue
    for (const item of frame.momentumEvents) {
      const existing = nativeEvents.get(item.sequenceIndex)
      if (
        existing &&
        (existing.tick !== item.tick ||
          existing.team !== item.team ||
          existing.playerSlot !== item.playerSlot)
      )
        continue
      nativeEvents.set(item.sequenceIndex, item)
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
      events.set(item.sequenceIndex, {
        id: `${frame.matchId}-native-momentum-${item.sequenceIndex}`,
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
        completionTick: item.completionTick,
        annotations: nativeMomentumEventAnnotations(item),
      })
    }
  }

  attachAuxiliaryEventAnnotations(events, [...nativeEvents.values()])
  return [...events.values()].sort((left, right) => left.tick - right.tick)
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
          details?.shirtName ||
          details?.commonName ||
          details?.displayName ||
          `Player ${player.playerId}`,
        fullName:
          `${details?.firstName ?? ""} ${details?.secondName ?? ""}`.trim() ||
          details?.displayName,
        portraitPath: details?.portraitPath,
        portraitUrl:
          uid != null
            ? graphicsAssetUrl("person", uid, "portrait")
            : archivedAssetUrl(details?.portraitPath),
        team: player.team,
        shirtNumber: details?.shirtNumber,
        squadNumber: details?.squadNumber,
        shirtName: details?.shirtName,
        position: details?.position,
        positionFamiliarities: details?.positionFamiliarities,
        inPossession: player.inPossession,
        outOfPossession: player.outOfPossession,
        age: calculateAge(details?.profile?.dateOfBirth, metadata.matchDate),
        isStarter: !player.isSubstitute,
        isOnPitch: player.isOnPitch,
        status: {
          subbedOnMinute: player.subbedOnMinute || undefined,
          subbedOffMinute: player.subbedOffMinute || undefined,
        },
        profile: details?.profile,
        attributes: details?.attributes,
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
  metadata?: RealtimePlayerMetadata,
  matchDate?: string,
  allowLocalAssets = true,
  resolveRatingContribution?: () => RatingContribution | undefined,
): MatchPlayer {
  const uid = metadata?.uid
  return {
    id: uid ?? player.playerId,
    uid,
    name:
      metadata?.shirtName ||
      metadata?.commonName ||
      metadata?.displayName ||
      `Player ${player.playerId}`,
    fullName:
      `${metadata?.firstName ?? ""} ${metadata?.secondName ?? ""}`.trim() ||
      metadata?.displayName,
    portraitPath: metadata?.portraitPath,
    portraitUrl:
      allowLocalAssets && uid != null
        ? graphicsAssetUrl("person", uid, "portrait")
        : archivedAssetUrl(metadata?.portraitPath),
    team: player.team,
    shirtNumber: metadata?.shirtNumber,
    squadNumber: metadata?.squadNumber,
    shirtName: metadata?.shirtName,
    position: metadata?.position,
    positionFamiliarities: metadata?.positionFamiliarities,
    inPossession: metadata?.inPossession,
    outOfPossession: metadata?.outOfPossession,
    rating: player.rating > 0 ? player.rating : undefined,
    ratingContribution: player.ratingContribution,
    resolveRatingContribution,
    age: calculateAge(metadata?.profile?.dateOfBirth, matchDate),
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
      savesHeld: player.savesHeld,
      savesParried: player.savesParried,
      savesTipped: player.savesTipped,
      distanceM: player.distanceM,
      overallPhysicalCondition: player.overallPhysicalCondition,
      matchSharpness: player.matchSharpness,
    },
  }
}

function calculateAge(
  dateOfBirth?: string,
  referenceDate?: string
): number | undefined {
  const birth = parseIsoDate(dateOfBirth)
  const reference = parseIsoDate(referenceDate) ?? new Date()
  if (!birth || birth > reference) return undefined
  let age = reference.getUTCFullYear() - birth.getUTCFullYear()
  if (
    reference.getUTCMonth() < birth.getUTCMonth() ||
    (reference.getUTCMonth() === birth.getUTCMonth() &&
      reference.getUTCDate() < birth.getUTCDate())
  ) {
    age -= 1
  }
  return age >= 0 && age <= 120 ? age : undefined
}

function parseIsoDate(value?: string): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? undefined : date
}

export function graphicsAssetUrl(
  entityType: string,
  uid: number,
  imageType: string
): string {
  return `${loadBackendUrl()}/api/assets/${encodeURIComponent(entityType)}/${uid}/${encodeURIComponent(imageType)}`
}

export function archivedAssetUrl(path: string | undefined) {
  if (!path) return undefined
  try {
    const url = new URL(path)
    return url.protocol === "https:" && url.hostname === "img.osnsyc.top"
      ? url.toString()
      : undefined
  } catch {
    return undefined
  }
}

function normalize(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 50
  return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
}
