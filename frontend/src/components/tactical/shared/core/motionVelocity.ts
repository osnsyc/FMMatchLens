type Observation = { tick: number; period: number; matchId: string }
type Position = { x: number; y: number }

/** FM angle zero points along +longitudinal Y, matching the board's +X. */
export function motionVelocity(
  speed: number | undefined,
  angle: number | undefined,
  current: Observation,
  position: Position,
  neighbor?: Observation,
  otherPosition?: Position
) {
  if (
    speed != null &&
    Number.isFinite(speed) &&
    speed >= 0 &&
    angle != null &&
    Number.isFinite(angle) &&
    angle >= 0 &&
    angle <= 360
  ) {
    const radians = (angle * Math.PI) / 180
    return { x: speed * Math.cos(radians), y: speed * Math.sin(radians) }
  }
  if (
    !neighbor ||
    !otherPosition ||
    current.matchId !== neighbor.matchId ||
    current.period !== neighbor.period
  )
    return undefined
  const ticks = current.tick - neighbor.tick
  // Four simulation ticks per second. Never infer movement across a gap.
  if (!Number.isFinite(ticks) || ticks === 0 || Math.abs(ticks) > 4)
    return undefined
  const x = (position.y - otherPosition.y) / (ticks * 0.25)
  const y = (position.x - otherPosition.x) / (ticks * 0.25)
  return Number.isFinite(x) && Number.isFinite(y) && Math.hypot(x, y) < 13
    ? { x, y }
    : undefined
}
