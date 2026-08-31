import type { RealtimeMatchMetadata } from "@/api/realtimeMatch"

export function metadataAtTick(
  timeline: readonly RealtimeMatchMetadata[],
  tick: number,
): RealtimeMatchMetadata | undefined {
  let selected: RealtimeMatchMetadata | undefined
  for (const metadata of timeline) {
    if (metadata.capturedTick <= tick &&
        (!selected || metadata.capturedTick >= selected.capturedTick)) {
      selected = metadata
    }
  }
  return selected
}
