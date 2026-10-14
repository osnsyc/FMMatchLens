import {
  projectPositionToTacticalBoard,
  validPitchHalf,
} from "@/components/tactical/shared/core/frameProjector"
import type { RealtimeFrame } from "@/api/realtimeMatch"
import type {
  TacticalMotionBall,
  TacticalMotionFrame,
  TacticalMotionPlayer,
} from "@/components/tactical/shared/core/types"
import type { MatchPlayer, TacticalEventPoint } from "@/types/match"

const SECONDS_PER_TICK = 0.25

export function buildPlaybackFrames(
  frames: readonly RealtimeFrame[],
  start: number,
  end: number,
  players: ReadonlyMap<number, MatchPlayer>,
  rotateForDisplay: boolean
) {
  const playbackFrames: TacticalMotionFrame[] = []
  for (let frameIndex = start; frameIndex <= end; frameIndex += 1) {
    const frame = frames[frameIndex]
    const halfWidth = validPitchHalf(frame.halfPitchWidth)
    const halfLength = validPitchHalf(frame.halfPitchLength)
    if (!halfWidth || !halfLength) continue
    const ball = projectBallToTacticalBoard(
      frame,
      rotateForDisplay,
      halfWidth,
      halfLength
    )
    const playbackPlayers: TacticalMotionPlayer[] = []
    for (const player of frame.players) {
      if (
        !player.isOnPitch ||
        !Number.isFinite(player.x) ||
        !Number.isFinite(player.y)
      )
        continue
      const details = players.get(player.playerId)
      const hasAngle = Number.isFinite(player.angleDegrees)
      const rawAngleRadians = hasAngle
        ? (player.angleDegrees! * Math.PI) / 180
        : undefined
      const speedMetersPerSecond = (player.speedCentimetersPerSecond ?? 0) / 100
      const direction = rotateForDisplay ? -1 : 1
      const position = projectPositionToTacticalBoard(
        player.x,
        player.y,
        rotateForDisplay,
        halfWidth,
        halfLength
      )
      playbackPlayers.push({
        playerId: player.playerId,
        team: player.team,
        shirtNumber: details?.shirtNumber ?? details?.squadNumber,
        isGoalkeeper:
          (
            details?.inPossession?.position ??
            details?.outOfPossession?.position ??
            details?.position
          )
            ?.trim()
            .toUpperCase() === "GK",
        x: position.x,
        y: position.y,
        angleDegrees: hasAngle
          ? normalizeAngle(
              player.angleDegrees! + 90 + (rotateForDisplay ? 180 : 0)
            )
          : undefined,
        velocityXPerTick:
          rawAngleRadians == null
            ? 0
            : (direction *
                Math.cos(rawAngleRadians) *
                speedMetersPerSecond *
                SECONDS_PER_TICK *
                100) /
              (halfLength * 2),
        velocityYPerTick:
          rawAngleRadians == null
            ? 0
            : (direction *
                Math.sin(rawAngleRadians) *
                speedMetersPerSecond *
                SECONDS_PER_TICK *
                100) /
              (halfWidth * 2),
      })
    }
    if (playbackPlayers.length > 0) {
      playbackFrames.push({ tick: frame.tick, players: playbackPlayers, ball })
    }
  }
  return playbackFrames
}

export function projectBallToTacticalBoard(
  frame: RealtimeFrame,
  rotate: boolean,
  halfWidth: number,
  halfLength: number
): TacticalMotionBall | undefined {
  if (
    !Number.isFinite(frame.ballXCentimeters) ||
    !Number.isFinite(frame.ballYCentimeters) ||
    !Number.isFinite(frame.ballZCentimeters)
  )
    return undefined
  return {
    ...projectPositionToTacticalBoard(
      frame.ballXCentimeters / 100,
      frame.ballYCentimeters / 100,
      rotate,
      halfWidth,
      halfLength
    ),
    zCentimeters: frame.ballZCentimeters,
  }
}

export function needsDisplayRotation(event: TacticalEventPoint) {
  const reverseDirection = (event.flags & 0x100) !== 0
  return event.team === "home" ? !reverseDirection : reverseDirection
}

export {
  projectPositionToTacticalBoard,
  validPitchHalf,
} from "@/components/tactical/shared/core/frameProjector"
function normalizeAngle(value: number) {
  return ((value % 360) + 360) % 360
}
