import type { MotionSample } from "@/api/liveMotionSource"
export const LIVE_MOTION_DELAY_MS = 500
const CLOCK_FILTER_RADIUS_MS = 250
/** Integrate the observed clock, holding at both boundaries. */
function integrateClock(
  anchors: readonly MotionSample[],
  from: number,
  to: number
) {
  const first = anchors[0],
    last = anchors.at(-1)!
  let area = Math.max(0, Math.min(to, first.receivedAtMs) - from) * first.tick
  for (let i = 1; i < anchors.length; i++) {
    const left = anchors[i - 1],
      right = anchors[i]
    const start = Math.max(from, left.receivedAtMs),
      end = Math.min(to, right.receivedAtMs)
    if (end <= start) continue
    const rate =
      (right.tick - left.tick) / (right.receivedAtMs - left.receivedAtMs)
    area +=
      ((2 * left.tick + (start + end - 2 * left.receivedAtMs) * rate) *
        (end - start)) /
      2
  }
  area += Math.max(0, to - Math.max(from, last.receivedAtMs)) * last.tick
  return area
}
/** Finite wall-time filtering preserves uniform rates without elapsed integration or prediction. */
export function sampleLiveClock(
  samples: readonly MotionSample[],
  now: number,
  delayMs = LIVE_MOTION_DELAY_MS
) {
  const anchors = samples.filter((s) => s.anchor)
  const first = anchors[0],
    last = anchors.at(-1),
    target = now - delayMs
  if (!first || !last || anchors.length < 2 || target < first.receivedAtMs)
    return {
      status: "buffering" as const,
      current: first ?? samples.at(-1),
      next: first,
      progress: 0,
    }
  // The filtered tail reaches the final position within delayMs + filter radius.
  if (target - CLOCK_FILTER_RADIUS_MS >= last.receivedAtMs)
    return {
      status: "waiting" as const,
      current: last,
      next: last,
      progress: 0,
    }
  const tick =
    integrateClock(
      anchors,
      target - CLOCK_FILTER_RADIUS_MS,
      target + CLOCK_FILTER_RADIUS_MS
    ) /
    (2 * CLOCK_FILTER_RADIUS_MS)
  for (let i = 1; i < anchors.length; i++) {
    const next = anchors[i],
      current = anchors[i - 1]
    if (tick <= next.tick)
      return {
        status: "playing" as const,
        current,
        next,
        progress: Math.max(
          0,
          (tick - current.tick) / (next.tick - current.tick)
        ),
      }
  }
  return { status: "playing" as const, current: last, next: last, progress: 0 }
}
