import type {
  PlaybackOverlay,
  PlaybackOverlayTiming,
} from "@/components/tactical/playback/core/types"

export type ActivePlaybackOverlay = {
  overlay: PlaybackOverlay
  opacity: number
  scale: number
}

export function activePlaybackOverlays(
  overlays: readonly PlaybackOverlay[],
  tick: number
): ActivePlaybackOverlay[] {
  const active: ActivePlaybackOverlay[] = []
  for (const overlay of overlays) {
    if (!overlayIsActive(overlay.timing, tick)) continue
    const transition = overlayTransition(overlay.timing, tick)
    active.push({ overlay, ...transition })
  }
  return active
}

function overlayIsActive(timing: PlaybackOverlayTiming, tick: number) {
  return (
    tick >= timing.fromTick && (timing.toTick == null || tick <= timing.toTick)
  )
}

function overlayTransition(timing: PlaybackOverlayTiming, tick: number) {
  const duration = Math.max(0, timing.transitionTicks ?? 1)
  let opacity = 1
  let scale = 1
  if (duration > 0 && timing.enter !== "instant") {
    const progress = clamp((tick - timing.fromTick) / duration)
    if (timing.enter === "fade") opacity *= progress
    if (timing.enter === "scale") scale *= 0.75 + progress * 0.25
  }
  if (duration > 0 && timing.exit === "fade" && timing.toTick != null) {
    opacity *= clamp((timing.toTick - tick) / duration)
  }
  return { opacity, scale }
}

function clamp(value: number) {
  return Math.min(1, Math.max(0, value))
}
