import type {
  RealtimeFrame,
  RealtimeMatchMetadata,
  RealtimeMomentumEvent,
  RealtimeMomentumPoint,
} from "@/api/realtimeMatch"
import type { LocalArchiveSummary } from "@/api/localArchive"
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
  let previousEvents: readonly RealtimeMomentumEvent[] = []
  let previousMomentum: readonly RealtimeMomentumPoint[] = []
  let previousRolling: readonly RealtimeMomentumPoint[] = []

  for (let start = 0; start < input.frames.length; start += batchSize) {
    throwIfAborted(options.signal)
    const end = Math.min(input.frames.length, start + batchSize)
    for (let index = start; index < end; index += 1) {
      const source = input.frames[index]
      const momentumEvents = streamRevision(
        previousEvents,
        source.momentumEvents,
        sameMomentumEvent
      )
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
      previousEvents = source.momentumEvents
      previousMomentum = source.momentum
      previousRolling = source.rollingMomentum
      ticks[index] = source.tick
      frames[index] = {
        ...source,
        momentumEvents: [],
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
  }
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
  if (
    left.eventIndex !== right.eventIndex ||
    left.tick !== right.tick ||
    left.lateralPosition !== right.lateralPosition ||
    left.longitudinalPosition !== right.longitudinalPosition ||
    left.trajectoryStartLateralPosition !==
      right.trajectoryStartLateralPosition ||
    left.trajectoryStartLongitudinalPosition !==
      right.trajectoryStartLongitudinalPosition ||
    left.trajectoryEndLateralPosition !== right.trajectoryEndLateralPosition ||
    left.trajectoryEndLongitudinalPosition !==
      right.trajectoryEndLongitudinalPosition ||
    left.team !== right.team ||
    left.playerSlot !== right.playerSlot ||
    left.playerId !== right.playerId ||
    left.receiverPlayerSlot !== right.receiverPlayerSlot ||
    left.receiverPlayerId !== right.receiverPlayerId ||
    left.eventType !== right.eventType ||
    left.flags !== right.flags ||
    left.sequenceIndex !== right.sequenceIndex ||
    left.completionTick !== right.completionTick
  ) {
    return false
  }
  const leftPoints = left.trajectoryPoints ?? []
  const rightPoints = right.trajectoryPoints ?? []
  return (
    leftPoints.length === rightPoints.length &&
    leftPoints.every(
      (point, index) =>
        point.lateralPosition === rightPoints[index]?.lateralPosition &&
        point.longitudinalPosition === rightPoints[index]?.longitudinalPosition
    )
  )
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted)
    throw new DOMException("Replay preprocessing aborted", "AbortError")
}

function yieldToMainThread() {
  return new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0))
}
