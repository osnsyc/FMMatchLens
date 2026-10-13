import type { RealtimeFrame } from "@/api/realtimeMatch"
import type { PlaybackRange } from "@/components/tactical/playback/core/types"
import type { TacticalEventPoint } from "@/types/match"

export type PlaybackFrameIndexRange = {
  start: number
  end: number
}

export function eventCompletionTick(event: TacticalEventPoint) {
  return event.completionTick != null && event.completionTick >= event.tick
    ? event.completionTick
    : event.tick
}

export function eventPlaybackRange(
  event: TacticalEventPoint,
  leadTicks = 0,
  followTicks = 0
): PlaybackRange {
  return {
    startTick: Math.max(0, event.tick - leadTicks),
    endTick: eventCompletionTick(event) + followTicks,
  }
}

export function frameIndexesForTickRange(
  frames: readonly RealtimeFrame[],
  range: PlaybackRange
): PlaybackFrameIndexRange | undefined {
  const start = lowerBoundFrameTick(frames, range.startTick)
  const end = upperBoundFrameTick(frames, range.endTick) - 1
  if (start >= frames.length || end <= start) return undefined
  return { start, end: Math.min(end, frames.length - 1) }
}

export function lowerBoundFrameTick(
  frames: readonly RealtimeFrame[],
  tick: number
) {
  let low = 0
  let high = frames.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (frames[middle].tick < tick) low = middle + 1
    else high = middle
  }
  return low
}

export function upperBoundFrameTick(
  frames: readonly RealtimeFrame[],
  tick: number
) {
  let low = 0
  let high = frames.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (frames[middle].tick <= tick) low = middle + 1
    else high = middle
  }
  return low
}
