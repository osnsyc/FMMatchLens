import type { RealtimeFrame } from "@/api/realtimeMatch"
import type {
  TacticalPlaybackBall,
  TacticalPlaybackFrame,
  TacticalPlaybackPlayer,
} from "@/components/tactical/playback/core/types"
import type { MatchPlayer, TacticalEventPoint } from "@/types/match"

const SECONDS_PER_TICK = 0.25

export function buildPlaybackFrames(
  frames: readonly RealtimeFrame[],
  start: number,
  end: number,
  players: ReadonlyMap<number, MatchPlayer>,
  rotateForDisplay: boolean
) {
  const playbackFrames: TacticalPlaybackFrame[] = []
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
    const playbackPlayers: TacticalPlaybackPlayer[] = []
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
): TacticalPlaybackBall | undefined {
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

export function projectPositionToTacticalBoard(
  rawLateralX: number,
  rawLongitudinalY: number,
  rotate: boolean,
  halfWidth: number,
  halfLength: number
) {
  const direction = rotate ? -1 : 1
  return {
    x: normalize(direction * rawLongitudinalY, -halfLength, halfLength),
    y: normalize(direction * rawLateralX, -halfWidth, halfWidth),
  }
}

export function validPitchHalf(value: number) {
  return Number.isFinite(value) && value > 0 && value < 1_000
    ? value
    : undefined
}

function normalize(value: number, min: number, max: number) {
  return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
}

function normalizeAngle(value: number) {
  return ((value % 360) + 360) % 360
}
