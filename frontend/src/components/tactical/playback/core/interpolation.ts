import type {
  PlaybackRenderFrame,
  TacticalPlaybackBall,
  TacticalPlaybackFrame,
  TacticalPlaybackPlayer,
} from "@/components/tactical/playback/core/types"

export function interpolatePlaybackBall(
  current: TacticalPlaybackBall,
  next: TacticalPlaybackBall,
  progress: number
): TacticalPlaybackBall {
  const t = clamp(progress, 0, 1)
  return {
    x: lerp(current.x, next.x, t),
    y: lerp(current.y, next.y, t),
    zCentimeters: lerp(current.zCentimeters, next.zCentimeters, t),
  }
}

export function interpolatePlaybackPlayer(
  current: TacticalPlaybackPlayer,
  next: TacticalPlaybackPlayer,
  progress: number
): TacticalPlaybackPlayer {
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

export function interpolatePlaybackFrame(
  current: TacticalPlaybackFrame,
  next: TacticalPlaybackFrame,
  progress: number
): PlaybackRenderFrame {
  if (progress >= 1) return next
  const nextPlayers = new Map(
    next.players.map((player) => [player.playerId, player])
  )
  const currentBall = current.ball
  const nextBall = next.ball ?? currentBall
  return {
    tick: current.tick + (next.tick - current.tick) * clamp(progress, 0, 1),
    players: current.players.map((player) =>
      interpolatePlaybackPlayer(
        player,
        nextPlayers.get(player.playerId) ?? player,
        progress
      )
    ),
    ball:
      currentBall && nextBall
        ? interpolatePlaybackBall(currentBall, nextBall, progress)
        : undefined,
  }
}

export function smoothHeldPositions(
  frames: readonly TacticalPlaybackFrame[]
): TacticalPlaybackFrame[] {
  const result = frames.map((frame) => ({
    ...frame,
    ball: frame.ball ? { ...frame.ball } : undefined,
    players: frame.players.map((player) => ({ ...player })),
  }))
  const samplesByPlayer = new Map<number, PlayerSample[]>()
  for (const [frameIndex, frame] of result.entries()) {
    for (const player of frame.players) {
      const samples = samplesByPlayer.get(player.playerId) ?? []
      samples.push({ frame, player, frameIndex })
      samplesByPlayer.set(player.playerId, samples)
    }
  }

  for (const samples of samplesByPlayer.values()) {
    // A missing player marks a new track (e.g. a substitution), not a held
    // position. Never smooth across that boundary.
    let start = 0
    for (let end = 1; end <= samples.length; end += 1) {
      if (
        end === samples.length ||
        samples[end].frameIndex !== samples[end - 1].frameIndex + 1
      ) {
        preparePlayerTrack(samples.slice(start, end))
        start = end
      }
    }
  }

  const ballSamples = result.flatMap((frame) =>
    frame.ball ? [{ frame, ball: frame.ball }] : []
  )
  smoothHeldSamples(
    ballSamples,
    ({ ball }) => ball,
    (sample, from, to, progress) => {
      sample.frame.ball = interpolatePlaybackBall(from.ball, to.ball, progress)
      sample.ball = sample.frame.ball
    },
    (left, right) =>
      Math.hypot(left.x - right.x, left.y - right.y) > 0.001 ||
      Math.abs(left.zCentimeters - right.zCentimeters) > 0.5
  )
  return result
}

type PlayerSample = {
  frame: TacticalPlaybackFrame
  player: TacticalPlaybackPlayer
  frameIndex: number
}

function preparePlayerTrack(samples: PlayerSample[]) {
  // Fill held samples linearly, just like the ball.
  smoothHeldSamples(
    samples,
    ({ player }) => player,
    (sample, from, to, progress) => {
      sample.player.x = from.player.x + (to.player.x - from.player.x) * progress
      sample.player.y = from.player.y + (to.player.y - from.player.y) * progress
    }
  )
}

function smoothHeldSamples<
  TSample extends { frame: TacticalPlaybackFrame },
  TPoint extends { x: number; y: number },
>(
  samples: TSample[],
  point: (sample: TSample) => TPoint,
  update: (
    sample: TSample,
    from: TSample,
    to: TSample,
    progress: number,
    tickSpan: number
  ) => void,
  moved = (left: TPoint, right: TPoint) =>
    Math.hypot(left.x - right.x, left.y - right.y) > 0.001
) {
  if (samples.length < 3) return
  const anchorIndexes = [0]
  for (let index = 1; index < samples.length; index += 1) {
    const anchor = point(samples[anchorIndexes.at(-1) ?? 0])
    if (moved(point(samples[index]), anchor)) anchorIndexes.push(index)
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
      update(
        sample,
        from,
        to,
        (sample.frame.tick - from.frame.tick) / tickSpan,
        tickSpan
      )
    }
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
