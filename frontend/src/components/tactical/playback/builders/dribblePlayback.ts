import type { RealtimeFrame } from "@/api/realtimeMatch"
import {
  buildPlaybackFrames,
  needsDisplayRotation,
  projectPositionToTacticalBoard,
  validPitchHalf,
} from "@/components/tactical/playback/core/frameProjector"
import { smoothHeldPositions } from "@/components/tactical/playback/core/interpolation"
import { lowerBoundFrameTick } from "@/components/tactical/playback/core/playbackRange"
import type { DribblePlayback } from "@/components/tactical/playback/core/types"
import type { MatchPlayer, TacticalEventPoint } from "@/types/match"

export const DRIBBLE_PLAYBACK_SEARCH_RADIUS_TICKS = 32
const MAX_ENDPOINT_ERROR = 8

export function buildDribblePlayback(
  event: TacticalEventPoint,
  frames: readonly RealtimeFrame[],
  players: ReadonlyMap<number, MatchPlayer>
): DribblePlayback | null {
  if (event.metricId !== "dribblesCompleted" || frames.length === 0) return null
  const rotateForDisplay = needsDisplayRotation(event)
  const range = findTrajectoryFrameRange(event, frames, rotateForDisplay)
  if (!range) return null
  const playbackFrames = buildPlaybackFrames(
    frames,
    range.start,
    range.end,
    players,
    rotateForDisplay
  )
  if (playbackFrames.length < 2) return null
  const smoothedFrames = smoothHeldPositions(playbackFrames)
  return {
    id: event.id,
    dribblerPlayerId: event.playerId,
    team: event.team,
    range: {
      startTick: smoothedFrames[0].tick,
      endTick: smoothedFrames.at(-1)!.tick,
    },
    frames: smoothedFrames,
    trail: { target: "player", playerId: event.playerId },
    overlays: [],
  }
}

function findTrajectoryFrameRange(
  event: TacticalEventPoint,
  frames: readonly RealtimeFrame[],
  rotateForDisplay: boolean
) {
  const firstTrajectoryPoint = event.trajectoryPoints?.[0]
  const lastTrajectoryPoint = event.trajectoryPoints?.at(-1)
  const start = {
    x: event.trajectoryStartX ?? firstTrajectoryPoint?.x ?? event.anchorX,
    y: event.trajectoryStartY ?? firstTrajectoryPoint?.y ?? event.anchorY,
  }
  const end = {
    x: event.endX ?? lastTrajectoryPoint?.x,
    y: event.endY ?? lastTrajectoryPoint?.y,
  }
  if (
    !Number.isFinite(start.x) ||
    !Number.isFinite(start.y) ||
    !Number.isFinite(end.x) ||
    !Number.isFinite(end.y)
  )
    return undefined

  const candidates: Array<{ index: number; x: number; y: number }> = []
  const minimumTick = event.tick - DRIBBLE_PLAYBACK_SEARCH_RADIUS_TICKS
  const maximumTick = event.tick + DRIBBLE_PLAYBACK_SEARCH_RADIUS_TICKS
  for (
    let index = lowerBoundFrameTick(frames, minimumTick);
    index < frames.length;
    index += 1
  ) {
    const frame = frames[index]
    if (frame.tick > maximumTick) break
    const player = frame.players.find(
      (candidate) =>
        candidate.playerId === event.playerId && candidate.isOnPitch
    )
    const halfWidth = validPitchHalf(frame.halfPitchWidth)
    const halfLength = validPitchHalf(frame.halfPitchLength)
    if (!player || !halfWidth || !halfLength) continue
    candidates.push({
      index,
      ...projectPositionToTacticalBoard(
        player.x,
        player.y,
        rotateForDisplay,
        halfWidth,
        halfLength
      ),
    })
  }

  let best:
    | {
        start: number
        end: number
        score: number
        startError: number
        endError: number
      }
    | undefined
  for (
    let startIndex = 0;
    startIndex < candidates.length - 1;
    startIndex += 1
  ) {
    const startCandidate = candidates[startIndex]
    const startError = distance(
      startCandidate,
      start as { x: number; y: number }
    )
    for (
      let endIndex = startIndex + 1;
      endIndex < candidates.length;
      endIndex += 1
    ) {
      const endCandidate = candidates[endIndex]
      const endError = distance(endCandidate, end as { x: number; y: number })
      const score = startError + endError
      if (!best || score < best.score) {
        best = {
          start: startCandidate.index,
          end: endCandidate.index,
          score,
          startError,
          endError,
        }
      }
    }
  }
  return best &&
    best.startError <= MAX_ENDPOINT_ERROR &&
    best.endError <= MAX_ENDPOINT_ERROR
    ? { start: best.start, end: best.end }
    : undefined
}

function distance(
  left: { x: number; y: number },
  right: { x: number; y: number }
) {
  return Math.hypot(left.x - right.x, left.y - right.y)
}
