import { validPitchHalf } from "@/components/tactical/shared/core/frameProjector"
import type { RealtimeFrame } from "@/api/realtimeMatch"
import {
  PlayerMovementTracker,
  type PlayerMovementAnalysis,
} from "@/api/playerMovement"
import type { TeamSide } from "@/types/match"
export type LiveMotionStatus =
  "buffering" | "playing" | "waiting" | "disconnected" | "ended" | "suspended"
export type MotionSample = {
  generation: number
  matchId: string
  tick: number
  displayTick: number
  sequence: number
  period: number
  receivedAtMs: number
  anchor: boolean
  halfPitchWidth: number
  halfPitchLength: number
  ballHolderPlayerId?: number
  ball?: { x: number; y: number; z: number }
  players: readonly {
    playerId: number
    team: TeamSide
    x: number
    y: number
    speed?: number
    angleDegrees?: number
  }[]
}
export class LiveMotionSource {
  private latest?: MotionSample
  private listeners = new Set<(sample: MotionSample) => void>()
  private statuses = new Set<(status: LiveMotionStatus) => void>()
  private generation = 0
  private status: LiveMotionStatus = "disconnected"
  private readonly movement = new PlayerMovementTracker()
  getLatest() {
    return this.latest
  }
  getStatus() {
    return this.status
  }
  get subscriberCount() {
    return this.listeners.size
  }
  subscribe(listener: (sample: MotionSample) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
      if (!this.listeners.size) this.latest = undefined
    }
  }
  subscribeStatus(listener: (status: LiveMotionStatus) => void) {
    this.statuses.add(listener)
    return () => {
      this.statuses.delete(listener)
    }
  }
  setStatus(status: LiveMotionStatus) {
    if (status === this.status) return
    this.status = status
    for (const listener of this.statuses) listener(status)
  }
  reset() {
    this.generation++
    this.latest = undefined
    this.setStatus("disconnected")
  }
  resetMovement() {
    this.movement.reset()
  }
  ingestMovementFrames(frames: readonly RealtimeFrame[]) {
    this.movement.append(frames)
  }
  getPlayerMovement(playerId: number): PlayerMovementAnalysis {
    return this.movement.get(playerId)
  }
  publish(
    frame: RealtimeFrame,
    anchor = true,
    receivedAtMs = performance.now()
  ) {
    if (!this.listeners.size || !Number.isFinite(frame.tick) || !frame.matchId)
      return
    if (this.status === "ended") return
    const previous = this.latest
    if (previous?.matchId === frame.matchId && frame.tick < previous.tick)
      return
    if (previous && previous.matchId !== frame.matchId) {
      this.generation++
      this.latest = undefined
    }
    const halfPitchWidth =
      validPitchHalf(frame.halfPitchWidth) ??
      (previous?.matchId === frame.matchId
        ? previous.halfPitchWidth
        : frame.halfPitchWidth)
    const halfPitchLength =
      validPitchHalf(frame.halfPitchLength) ??
      (previous?.matchId === frame.matchId
        ? previous.halfPitchLength
        : frame.halfPitchLength)
    const validPosition = (x: number, y: number) =>
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      (!validPitchHalf(halfPitchWidth) || Math.abs(x) <= halfPitchWidth + 20) &&
      (!validPitchHalf(halfPitchLength) || Math.abs(y) <= halfPitchLength + 20)
    const sample: MotionSample = {
      generation: this.generation,
      matchId: frame.matchId,
      tick: frame.tick,
      displayTick: frame.displayTick,
      sequence: frame.sequence,
      period: frame.period,
      receivedAtMs,
      anchor,
      halfPitchWidth,
      halfPitchLength,
      ballHolderPlayerId: frame.ballHolderPlayerId,
      ball:
        [
          frame.ballXCentimeters,
          frame.ballYCentimeters,
          frame.ballZCentimeters,
        ].every(Number.isFinite) &&
        validPosition(
          frame.ballXCentimeters / 100,
          frame.ballYCentimeters / 100
        )
          ? {
              x: frame.ballXCentimeters / 100,
              y: frame.ballYCentimeters / 100,
              z: frame.ballZCentimeters,
            }
          : undefined,
      players: frame.players
        .filter((p) => p.isOnPitch && validPosition(p.x, p.y))
        .slice(0, 64)
        .map((p) => ({
          playerId: p.playerId,
          team: p.team,
          x: p.x,
          y: p.y,
          speed:
            Number.isFinite(p.speedCentimetersPerSecond) &&
            p.speedCentimetersPerSecond! >= 0
              ? p.speedCentimetersPerSecond! / 100
              : undefined,
          angleDegrees:
            Number.isFinite(p.angleDegrees) &&
            p.angleDegrees! >= 0 &&
            p.angleDegrees! <= 360
              ? p.angleDegrees
              : undefined,
        })),
    }
    if (previous?.matchId === sample.matchId && previous.tick === sample.tick) {
      sample.receivedAtMs = previous.receivedAtMs
      sample.anchor = previous.anchor
    }
    this.latest = sample
    for (const listener of this.listeners) listener(sample)
  }
  dispose() {
    this.reset()
    this.resetMovement()
    this.listeners.clear()
    this.statuses.clear()
  }
}
