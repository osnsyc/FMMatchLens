import type {
  TacticalMotionBall,
  TacticalMotionFrame,
  TacticalMotionPlayer,
} from "@/components/tactical/shared/core/types"

export function interpolateMotionBall(
  current: TacticalMotionBall,
  next: TacticalMotionBall,
  progress: number
): TacticalMotionBall {
  const t = clamp(progress, 0, 1)
  return {
    x: lerp(current.x, next.x, t),
    y: lerp(current.y, next.y, t),
    zCentimeters: lerp(current.zCentimeters, next.zCentimeters, t),
  }
}

export function interpolateMotionPlayer(
  current: TacticalMotionPlayer,
  next: TacticalMotionPlayer,
  progress: number
): TacticalMotionPlayer {
  const t = clamp(progress, 0, 1)
  return {
    ...current,
    x: lerp(current.x, next.x, t),
    y: lerp(current.y, next.y, t),
    angleDegrees: interpolateAngle(current.angleDegrees, next.angleDegrees, t),
    velocityXPerTick: lerp(current.velocityXPerTick, next.velocityXPerTick, t),
    velocityYPerTick: lerp(current.velocityYPerTick, next.velocityYPerTick, t),
  }
}

export function interpolateMotionFrame(
  current: TacticalMotionFrame,
  next: TacticalMotionFrame,
  progress: number
): TacticalMotionFrame {
  if (progress >= 1) return next
  const nextPlayers = new Map(
    next.players.map((player) => [player.playerId, player])
  )
  const currentBall = current.ball
  const nextBall = next.ball ?? currentBall
  return {
    tick: current.tick + (next.tick - current.tick) * clamp(progress, 0, 1),
    players: current.players.map((player) =>
      interpolateMotionPlayer(
        player,
        nextPlayers.get(player.playerId) ?? player,
        progress
      )
    ),
    ball:
      currentBall && nextBall
        ? interpolateMotionBall(currentBall, nextBall, progress)
        : undefined,
  }
}

function interpolateAngle(
  current: number | undefined,
  next: number | undefined,
  progress: number
) {
  if (current == null || next == null) return undefined
  const delta = ((next - current + 540) % 360) - 180
  return normalizeAngle(current + delta * progress)
}

function lerp(current: number, next: number, progress: number) {
  return current + (next - current) * progress
}

function normalizeAngle(value: number) {
  return ((value % 360) + 360) % 360
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
