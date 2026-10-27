import type { RealtimeFrame } from "@/api/realtimeMatch"

export const PLAYER_SPEED_ZONE_LIMITS_KMH = [7, 20, 25] as const

export type PlayerMovementAnalysis = {
  maximumSpeedKmh: number
  sprintCount: number
  zoneSamples: readonly [number, number, number, number]
}

export const EMPTY_PLAYER_MOVEMENT: PlayerMovementAnalysis = {
  maximumSpeedKmh: 0,
  sprintCount: 0,
  zoneSamples: [0, 0, 0, 0],
}

type MutablePlayerMovement = {
  maximumSpeedKmh: number
  sprintCount: number
  zoneSamples: [number, number, number, number]
  sprinting: boolean
  sprintSamples: number
}

export function analyzePlayerMovement(
  frames: readonly RealtimeFrame[],
  playerId: number,
  throughTick: number
): PlayerMovementAnalysis {
  const movement = createMutableMovement()

  for (const frame of frames) {
    if (frame.tick > throughTick) break
    const player = frame.players.find((candidate) => candidate.playerId === playerId)
    appendSpeed(movement, player?.isOnPitch ? player.speedCentimetersPerSecond : undefined)
  }

  return snapshotMovement(movement)
}

/**
 * Time-sliced variant used by the popup so opening it never synchronously scans
 * a full archive on the animation's first frame.
 */
export async function analyzePlayerMovementAsync(
  frames: readonly RealtimeFrame[],
  playerId: number,
  throughTick: number,
  cancelled: () => boolean = () => false
): Promise<PlayerMovementAnalysis> {
  const movement = createMutableMovement()
  let sliceStarted = performance.now()

  for (let index = 0; index < frames.length; index += 1) {
    if (cancelled()) return EMPTY_PLAYER_MOVEMENT
    const frame = frames[index]
    if (frame.tick > throughTick) break
    const player = frame.players.find((candidate) => candidate.playerId === playerId)
    appendSpeed(movement, player?.isOnPitch ? player.speedCentimetersPerSecond : undefined)

    if (index % 256 === 255 && performance.now() - sliceStarted >= 4) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
      sliceStarted = performance.now()
    }
  }

  return snapshotMovement(movement)
}

/** Lightweight aggregate for live history; it retains no frame/player arrays. */
export class PlayerMovementTracker {
  private matchId = ""
  private lastTick = -1
  private readonly players = new Map<number, MutablePlayerMovement>()

  reset() {
    this.matchId = ""
    this.lastTick = -1
    this.players.clear()
  }

  append(frames: readonly RealtimeFrame[]) {
    let changed = false
    for (const frame of frames) {
      if (!frame.matchId) continue
      if (this.matchId !== frame.matchId) {
        this.reset()
        this.matchId = frame.matchId
      }
      if (frame.tick <= this.lastTick) continue

      for (const player of frame.players) {
        let movement = this.players.get(player.playerId)
        if (!movement) {
          movement = createMutableMovement()
          this.players.set(player.playerId, movement)
        }
        appendSpeed(
          movement,
          player.isOnPitch ? player.speedCentimetersPerSecond : undefined
        )
      }
      this.lastTick = frame.tick
      changed = true
    }
    return changed
  }

  get(playerId: number): PlayerMovementAnalysis {
    const movement = this.players.get(playerId)
    return movement ? snapshotMovement(movement) : EMPTY_PLAYER_MOVEMENT
  }
}

function createMutableMovement(): MutablePlayerMovement {
  return {
    maximumSpeedKmh: 0,
    sprintCount: 0,
    zoneSamples: [0, 0, 0, 0],
    sprinting: false,
    sprintSamples: 0,
  }
}

function appendSpeed(
  movement: MutablePlayerMovement,
  speedCentimetersPerSecond?: number
) {
  if (speedCentimetersPerSecond == null) {
    movement.sprinting = false
    movement.sprintSamples = 0
    return
  }

  const speedKmh = speedCentimetersPerSecond * 0.036
  if (!Number.isFinite(speedKmh) || speedKmh < 0) return
  movement.maximumSpeedKmh = Math.max(movement.maximumSpeedKmh, speedKmh)
  const zone = speedZone(speedKmh)
  movement.zoneSamples[zone] += 1

  if (zone === 3) {
    movement.sprintSamples += 1
    if (!movement.sprinting && movement.sprintSamples >= 3) {
      movement.sprintCount += 1
      movement.sprinting = true
    }
  } else {
    movement.sprintSamples = 0
    // Exit hysteresis avoids counting threshold jitter as a new effort.
    if (speedKmh < 24) movement.sprinting = false
  }
}

function snapshotMovement(movement: MutablePlayerMovement): PlayerMovementAnalysis {
  return {
    maximumSpeedKmh: movement.maximumSpeedKmh,
    sprintCount: movement.sprintCount,
    zoneSamples: [...movement.zoneSamples],
  }
}

function speedZone(speedKmh: number) {
  if (speedKmh < PLAYER_SPEED_ZONE_LIMITS_KMH[0]) return 0
  if (speedKmh < PLAYER_SPEED_ZONE_LIMITS_KMH[1]) return 1
  if (speedKmh < PLAYER_SPEED_ZONE_LIMITS_KMH[2]) return 2
  return 3
}

