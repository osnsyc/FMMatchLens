import type { MotionSample } from "@/api/liveMotionSource"
export function continuity(
  previous: MotionSample,
  next: MotionSample
): { action: "interpolate" | "hold" | "reset"; reason?: string } {
  if (
    previous.generation !== next.generation ||
    previous.matchId !== next.matchId
  )
    return { action: "reset", reason: "identity" }
  if (previous.period !== next.period)
    return { action: "reset", reason: "period" }
  if (next.tick <= previous.tick)
    return { action: "hold", reason: "duplicate-or-old" }
  const elapsed = next.receivedAtMs - previous.receivedAtMs
  if (elapsed < 40 || elapsed > 1500)
    return { action: "reset", reason: elapsed < 40 ? "burst" : "gap" }
  // A large tick step alone is valid at 20x. Only implausible clock jumps reset.
  if ((next.tick - previous.tick) / elapsed > 0.4)
    return { action: "reset", reason: "clock-jump" }
  const seconds = (next.tick - previous.tick) * 0.25
  const players = new Map(previous.players.map((p) => [p.playerId, p]))
  let displaced = 0,
    common = 0
  for (const p of next.players) {
    const old = players.get(p.playerId)
    if (!old) continue
    common++
    if (Math.hypot(p.x - old.x, p.y - old.y) > Math.max(8, seconds * 14))
      displaced++
  }
  if (common >= 6 && displaced > common / 2)
    return { action: "reset", reason: "relocation" }
  return { action: "interpolate" }
}
