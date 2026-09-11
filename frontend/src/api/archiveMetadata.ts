import type { RealtimeMatchMetadata } from "@/api/realtimeMatch"

export function metadataAtTick(
  timeline: readonly RealtimeMatchMetadata[],
  tick: number
): RealtimeMatchMetadata | undefined {
  let low = 0
  let high = timeline.length - 1
  let selected = -1
  while (low <= high) {
    const middle = (low + high) >>> 1
    if (timeline[middle].capturedTick <= tick) {
      selected = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return selected >= 0 ? timeline[selected] : undefined
}
