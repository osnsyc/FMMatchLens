import type {
  ArchiveRatingInputs,
  RealtimeFrame,
  RealtimeMatchMetadata,
  RealtimeMomentumEvent,
  RealtimeMomentumPoint,
  RealtimePlayer,
} from "@/api/realtimeMatch"
import {
  MomentumEventReconciler,
  sameMomentumEventSemanticContent,
} from "@/api/momentumEventReconciler"
import type { LocalArchiveSummary } from "@/api/localArchive"
import { decodeRealtimeRatingInputs, type RatingWeightConfiguration } from "@/lib/ratingCalculator"
import type {
  ReplayArchive,
  ReplayFrame,
  ReplayStreamRevision,
  StreamRevision,
} from "@/api/replay/replayTypes"

export type ReplayPreprocessInput = {
  summary: LocalArchiveSummary
  metadata?: RealtimeMatchMetadata
  metadataTimeline?: readonly RealtimeMatchMetadata[]
  frames: readonly RealtimeFrame[]
  ratingConfiguration?: RatingWeightConfiguration
}

export type ReplayPreprocessOptions = {
  batchSize?: number
  signal?: AbortSignal
  onProgress?: (progress: number) => void
}

export async function preprocessReplayArchive(
  input: ReplayPreprocessInput,
  options: ReplayPreprocessOptions = {}
): Promise<ReplayArchive> {
  const batchSize = Math.max(1, options.batchSize ?? 400)
  const frames: ReplayFrame[] = new Array(input.frames.length)
  const streamRevisions: ReplayStreamRevision[] = new Array(input.frames.length)
  const ticks = new Int32Array(input.frames.length)
  const eventReconciler = new MomentumEventReconciler()
  let previousMomentum: readonly RealtimeMomentumPoint[] = []
  let previousRolling: readonly RealtimeMomentumPoint[] = []
  const ratingInputsBySlot = new Map<number, ReplayRatingPlayer>()

  for (let start = 0; start < input.frames.length; start += batchSize) {
    throwIfAborted(options.signal)
    const end = Math.min(input.frames.length, start + batchSize)
    for (let index = start; index < end; index += 1) {
      const source = input.frames[index]
      const previous = input.frames[index - 1]
      if (previous && (source.matchId !== previous.matchId || source.tick < previous.tick)) {
        ratingInputsBySlot.clear()
      }
      const players = hydrateReplayPlayers(source.players, ratingInputsBySlot, index)
      const logicalUpdates =
        source.momentumEventUpdates ??
        eventReconciler.apply(source.momentumEvents)
      const momentumEvents = { commonLength: 0, tail: logicalUpdates }
      const momentum = streamRevision(
        previousMomentum,
        source.momentum,
        sameMomentumPoint
      )
      const rollingMomentum = streamRevision(
        previousRolling,
        source.rollingMomentum,
        sameMomentumPoint
      )
      streamRevisions[index] = { momentumEvents, momentum, rollingMomentum }
      previousMomentum = source.momentum
      previousRolling = source.rollingMomentum
      ticks[index] = source.tick
      frames[index] = {
        ...source,
        players,
        momentumEvents: [],
        momentumEventUpdates: [],
        momentum: [],
        rollingMomentum: [],
      }
    }
    options.onProgress?.(end / Math.max(1, input.frames.length))
    if (end < input.frames.length) await yieldToMainThread()
  }

  throwIfAborted(options.signal)
  const metadataTimeline = [...(input.metadataTimeline ?? [])].sort(
    (left, right) => left.capturedTick - right.capturedTick
  )
  return {
    summary: input.summary,
    frameCount: frames.length,
    ticks,
    metadata: input.metadata,
    metadataTimeline,
    frames,
    streamRevisions,
    ratingConfiguration: input.ratingConfiguration,
  }
}

type ReplayRatingPlayer = {
  playerId: number
  team: RealtimePlayer["team"]
  frameIndex: number
  inputs: ArchiveRatingInputs
}

function hydrateReplayPlayers(
  players: RealtimePlayer[],
  previousBySlot: Map<number, ReplayRatingPlayer>,
  frameIndex: number,
) {
  let hydrated: RealtimePlayer[] | undefined
  players.forEach((player, index) => {
    const previous = previousBySlot.get(player.slot)
    const priorInputs = previous?.frameIndex === frameIndex - 1
      && previous.playerId === player.playerId && previous.team === player.team
      ? previous.inputs : undefined
    const inputs = player.ratingInputs
      ? decodeRealtimeRatingInputs(player.ratingInputs, priorInputs)
      : player.archiveRatingInputs
    if (!inputs) {
      previousBySlot.delete(player.slot)
      return
    }
    if (previous) {
      previous.playerId = player.playerId
      previous.team = player.team
      previous.frameIndex = frameIndex
      previous.inputs = inputs
    } else {
      previousBySlot.set(player.slot, { playerId: player.playerId, team: player.team, frameIndex, inputs })
    }
    if (player.ratingInputs) {
      hydrated ??= players.slice()
      hydrated[index] = { ...player, ratingInputs: undefined, archiveRatingInputs: inputs }
    }
  })
  return hydrated ?? players
}

export function streamRevision<T>(
  previous: readonly T[],
  next: readonly T[],
  equal: (left: T, right: T) => boolean = Object.is
): StreamRevision<T> {
  const limit = Math.min(previous.length, next.length)
  let commonLength = 0
  while (
    commonLength < limit &&
    equal(previous[commonLength], next[commonLength])
  ) {
    commonLength += 1
  }
  return { commonLength, tail: next.slice(commonLength) }
}

export function sameMomentumPoint(
  left: RealtimeMomentumPoint,
  right: RealtimeMomentumPoint
) {
  return (
    left.timeTicks === right.timeTicks &&
    left.value === right.value &&
    left.homeWeight === right.homeWeight &&
    left.awayWeight === right.awayWeight
  )
}

export function sameMomentumEvent(
  left: RealtimeMomentumEvent,
  right: RealtimeMomentumEvent
) {
  return sameMomentumEventSemanticContent(left, right)
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted)
    throw new DOMException("Replay preprocessing aborted", "AbortError")
}

function yieldToMainThread() {
  return new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0))
}
