import type { RealtimeFrame } from "@/api/realtimeMatch"
import type { ShotChain } from "@/components/tactical/tacticalScene"
import type { MatchPlayer, TacticalEventPoint, TeamSide } from "@/types/match"

export type TacticalPlaybackPlayer = {
  playerId: number
  team: TeamSide
  shirtNumber?: number
  x: number
  y: number
  angleDegrees?: number
  velocityXPerTick: number
  velocityYPerTick: number
}

export type TacticalPlaybackBall = {
  x: number
  y: number
  zCentimeters: number
}

export type TacticalPlaybackFrame = {
  tick: number
  players: readonly TacticalPlaybackPlayer[]
  ball?: TacticalPlaybackBall
}

export type TacticalPlayback = {
  id: string
  team: TeamSide
  frames: readonly TacticalPlaybackFrame[]
  trailPlayerId?: number
}

export type DribblePlayback = TacticalPlayback & {
  dribblerPlayerId: number
}

export const DRIBBLE_PLAYBACK_SEARCH_RADIUS_TICKS = 32
export const SHOT_CHAIN_PLAYBACK_PADDING_TICKS = 8
const MAX_ENDPOINT_ERROR = 8
const SECONDS_PER_TICK = 0.25

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
  return {
    id: event.id,
    dribblerPlayerId: event.playerId,
    trailPlayerId: event.playerId,
    team: event.team,
    frames: smoothHeldPositions(playbackFrames),
  }
}

export function buildShotChainPlayback(
  chain: ShotChain,
  frames: readonly RealtimeFrame[],
  players: ReadonlyMap<number, MatchPlayer>
): TacticalPlayback | null {
  const firstEvent = chain.events[0]
  const shot = chain.events.at(-1)
  if (!firstEvent || !shot || chain.events.length < 2 || frames.length === 0)
    return null

  const range = shotChainPlaybackTickRange(chain)
  const start = lowerBoundFrameTick(frames, range.startTick)
  const end = upperBoundFrameTick(frames, range.endTick) - 1
  if (start < 0 || end <= start || start >= frames.length) return null

  const playbackFrames = buildPlaybackFrames(
    frames,
    start,
    Math.min(end, frames.length - 1),
    players,
    needsDisplayRotation(firstEvent)
  )
  if (playbackFrames.length < 2) return null
  return {
    id: chain.id,
    team: chain.team,
    frames: smoothHeldPositions(playbackFrames),
  }
}

export function shotChainPlaybackTickRange(chain: ShotChain) {
  const firstEvent = chain.events[0]
  const shot = chain.events.at(-1)
  const startTick = firstEvent?.tick ?? 0
  const shotTick = shot?.tick ?? startTick
  const completionTick =
    shot?.completionTick != null && shot.completionTick >= shotTick
      ? shot.completionTick
      : shotTick
  return { startTick, endTick: completionTick }
}

export function isShotChainPlaybackTrigger(chain: ShotChain, eventId: string) {
  return chain.events[0]?.id === eventId
}

function buildPlaybackFrames(
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
      // Raw coordinates are absolute: x=lateral, y=longitudinal, angle 0=+y,
      // and increasing angles turn toward +x. Tactical Board puts longitudinal
      // on screen X and rotates the whole pitch 180 degrees when required so
      // home always attacks right and away always attacks left.
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

function projectBallToTacticalBoard(
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

export function interpolatePlaybackBall(
  current: TacticalPlaybackBall,
  next: TacticalPlaybackBall,
  progress: number
): TacticalPlaybackBall {
  const t = Math.min(1, Math.max(0, progress))
  return {
    x: current.x + (next.x - current.x) * t,
    y: current.y + (next.y - current.y) * t,
    zCentimeters:
      current.zCentimeters + (next.zCentimeters - current.zCentimeters) * t,
  }
}

function smoothHeldPositions(
  frames: readonly TacticalPlaybackFrame[]
): TacticalPlaybackFrame[] {
  const result = frames.map((frame) => ({
    ...frame,
    players: frame.players.map((player) => ({ ...player })),
  }))
  const samplesByPlayer = new Map<
    number,
    Array<{ frame: TacticalPlaybackFrame; player: TacticalPlaybackPlayer }>
  >()
  for (const frame of result) {
    for (const player of frame.players) {
      const samples = samplesByPlayer.get(player.playerId) ?? []
      samples.push({ frame, player })
      samplesByPlayer.set(player.playerId, samples)
    }
  }

  for (const samples of samplesByPlayer.values()) {
    if (samples.length < 3) continue
    const anchorIndexes = [0]
    for (let index = 1; index < samples.length; index += 1) {
      const anchor = samples[anchorIndexes.at(-1) ?? 0].player
      const candidate = samples[index].player
      if (Math.hypot(candidate.x - anchor.x, candidate.y - anchor.y) > 0.001) {
        anchorIndexes.push(index)
      }
    }

    for (
      let anchorIndex = 0;
      anchorIndex < anchorIndexes.length - 1;
      anchorIndex += 1
    ) {
      const fromIndex = anchorIndexes[anchorIndex]
      const toIndex = anchorIndexes[anchorIndex + 1]
      if (toIndex - fromIndex < 2) continue
      const from = samples[fromIndex]
      const to = samples[toIndex]
      const tickSpan = Math.max(1, to.frame.tick - from.frame.tick)
      for (let index = fromIndex + 1; index < toIndex; index += 1) {
        const sample = samples[index]
        const interpolated = interpolatePlaybackPlayer(
          from.player,
          to.player,
          (sample.frame.tick - from.frame.tick) / tickSpan,
          tickSpan
        )
        sample.player.x = interpolated.x
        sample.player.y = interpolated.y
      }
    }
  }
  smoothHeldBallPositions(result)
  return result
}

function smoothHeldBallPositions(frames: TacticalPlaybackFrame[]) {
  const samples = frames.flatMap((frame) =>
    frame.ball ? [{ frame, ball: frame.ball }] : []
  )
  if (samples.length < 3) return
  const anchorIndexes = [0]
  for (let index = 1; index < samples.length; index += 1) {
    const anchor = samples[anchorIndexes.at(-1) ?? 0].ball
    const candidate = samples[index].ball
    if (
      Math.hypot(candidate.x - anchor.x, candidate.y - anchor.y) > 0.001 ||
      Math.abs(candidate.zCentimeters - anchor.zCentimeters) > 0.5
    ) {
      anchorIndexes.push(index)
    }
  }
  for (
    let anchorIndex = 0;
    anchorIndex < anchorIndexes.length - 1;
    anchorIndex += 1
  ) {
    const fromIndex = anchorIndexes[anchorIndex]
    const toIndex = anchorIndexes[anchorIndex + 1]
    if (toIndex - fromIndex < 2) continue
    const from = samples[fromIndex]
    const to = samples[toIndex]
    const tickSpan = Math.max(1, to.frame.tick - from.frame.tick)
    for (let index = fromIndex + 1; index < toIndex; index += 1) {
      const sample = samples[index]
      sample.frame.ball = interpolatePlaybackBall(
        from.ball,
        to.ball,
        (sample.frame.tick - from.frame.tick) / tickSpan
      )
    }
  }
}

export function interpolatePlaybackPlayer(
  current: TacticalPlaybackPlayer,
  next: TacticalPlaybackPlayer,
  progress: number,
  tickSpan: number
): TacticalPlaybackPlayer {
  const t = Math.min(1, Math.max(0, progress))
  const span = Math.max(1, tickSpan)
  const deltaX = next.x - current.x
  const deltaY = next.y - current.y
  const segmentLength = Math.hypot(deltaX, deltaY)
  let startTangent = constrainTangent(
    current.velocityXPerTick * span,
    current.velocityYPerTick * span,
    segmentLength
  )
  let endTangent = constrainTangent(
    next.velocityXPerTick * span,
    next.velocityYPerTick * span,
    segmentLength
  )
  if (
    segmentLength > 0.001 &&
    Math.hypot(startTangent.x, startTangent.y) < 0.001 &&
    Math.hypot(endTangent.x, endTangent.y) < 0.001
  ) {
    // Old archives and temporarily unavailable movement records still get a
    // stable linear segment instead of an artificial stop at every tick.
    startTangent = { x: deltaX, y: deltaY }
    endTangent = { x: deltaX, y: deltaY }
  }

  const t2 = t * t
  const t3 = t2 * t
  const h00 = 2 * t3 - 3 * t2 + 1
  const h10 = t3 - 2 * t2 + t
  const h01 = -2 * t3 + 3 * t2
  const h11 = t3 - t2
  const angleDegrees = interpolateAngle(
    current.angleDegrees,
    next.angleDegrees,
    t
  )
  return {
    ...current,
    x: clampPercent(
      h00 * current.x + h10 * startTangent.x + h01 * next.x + h11 * endTangent.x
    ),
    y: clampPercent(
      h00 * current.y + h10 * startTangent.y + h01 * next.y + h11 * endTangent.y
    ),
    angleDegrees,
    velocityXPerTick:
      current.velocityXPerTick +
      (next.velocityXPerTick - current.velocityXPerTick) * t,
    velocityYPerTick:
      current.velocityYPerTick +
      (next.velocityYPerTick - current.velocityYPerTick) * t,
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

function constrainTangent(x: number, y: number, segmentLength: number) {
  const length = Math.hypot(x, y)
  const maximum = segmentLength * 2
  if (!Number.isFinite(length) || length === 0 || maximum === 0)
    return { x: 0, y: 0 }
  const scale = length > maximum ? maximum / length : 1
  return { x: x * scale, y: y * scale }
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value))
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

  const candidates: Array<{
    index: number
    x: number
    y: number
  }> = []
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

function lowerBoundFrameTick(frames: readonly RealtimeFrame[], tick: number) {
  let low = 0
  let high = frames.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (frames[middle].tick < tick) low = middle + 1
    else high = middle
  }
  return low
}

function upperBoundFrameTick(frames: readonly RealtimeFrame[], tick: number) {
  let low = 0
  let high = frames.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (frames[middle].tick <= tick) low = middle + 1
    else high = middle
  }
  return low
}

function distance(
  left: { x: number; y: number },
  right: { x: number; y: number }
) {
  return Math.hypot(left.x - right.x, left.y - right.y)
}

function needsDisplayRotation(event: TacticalEventPoint) {
  const reverseDirection = (event.flags & 0x100) !== 0
  return event.team === "home" ? !reverseDirection : reverseDirection
}

function projectPositionToTacticalBoard(
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

function validPitchHalf(value: number) {
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
