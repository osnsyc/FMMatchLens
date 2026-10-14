import type { MotionSample, LiveMotionStatus } from "@/api/liveMotionSource"
import { continuity } from "@/components/tactical/live/core/continuity"
import {
  projectPositionToTacticalBoard,
  projectPositionToPitchMeters,
  validPitchHalf,
} from "@/components/tactical/shared/core/frameProjector"
import { interpolateMotionFrame } from "@/components/tactical/shared/core/interpolation"
import type { TacticalMotionFrame } from "@/components/tactical/shared/core/types"
import { motionVelocity } from "@/components/tactical/shared/core/motionVelocity"
import { LiveMotionBuffer } from "./liveMotionBuffer"
import { LIVE_MOTION_DELAY_MS, sampleLiveClock } from "./liveMotionClock"
import { continuousRate, LiveMotionRate } from "./liveMotionRate"
export type MotionPlayerDetails = {
  shirtNumber?: number
  isGoalkeeper?: boolean
}
export class LiveMotionSession {
  private buffer = new LiveMotionBuffer()
  private projections = new Map<MotionSample, TacticalMotionFrame>()
  private playerDetails?: ReadonlyMap<number, MotionPlayerDetails>
  private readonly rate = new LiveMotionRate()
  private pending?: { previous: MotionSample; sample: MotionSample }
  lastResetReason?: string
  jumpCount = 0
  get observedMultiplier() {
    return this.rate.multiplier
  }
  get bufferCount() {
    return this.buffer.samples.length + (this.pending ? 1 : 0)
  }
  reset() {
    this.resetWindow()
    this.pending = undefined
    this.rate.clear()
  }
  private resetWindow() {
    this.buffer.clear()
    this.projections.clear()
    this.playerDetails = undefined
  }
  suspend() {
    this.reset()
  }
  dispose() {
    this.reset()
  }
  push(sample: MotionSample) {
    if (
      !validPitchHalf(sample.halfPitchWidth) ||
      !validPitchHalf(sample.halfPitchLength)
    )
      return false
    const previous = this.pending?.sample ?? this.buffer.samples.at(-1)
    if (previous) {
      const decision = continuity(previous, sample)
      if (decision.action === "hold") return false
      if (decision.action === "reset") {
        this.lastResetReason = decision.reason
        if (
          decision.reason === "clock-jump" ||
          decision.reason === "relocation"
        ) {
          if (decision.reason === "clock-jump") this.jumpCount++
          this.pending = undefined
          this.resetWindow()
        } else this.reset()
      }
    }
    if (this.pending) {
      const pending = this.pending
      this.pending = undefined
      const candidateRate = continuousRate(pending.previous, pending.sample)!
      const followingRate = continuousRate(pending.sample, sample)
      if (followingRate != null && followingRate >= candidateRate * 0.5) {
        // Sustained acceleration: retain both genuine anchors and learn the new rate.
        this.rate.clear()
        this.rate.record(candidateRate)
        this.rate.record(followingRate)
      } else {
        // One isolated large interval is a clock discontinuity, not a fast run.
        this.lastResetReason = "isolated-clock-jump"
        this.jumpCount++
        this.resetWindow()
        this.rate.record(followingRate)
      }
      this.append(pending.sample)
      this.append(sample)
      return true
    }
    const last = this.buffer.samples.at(-1)
    if (last && this.rate.isCandidate(last, sample)) {
      // Keep the suspect anchor out of the clock until the next WS interval arrives.
      // Reserve one slot for it within the total 32-sample budget.
      if (this.buffer.samples.length >= 32) {
        const evicted = this.buffer.samples.shift()
        if (evicted) this.projections.delete(evicted)
      }
      this.pending = { previous: last, sample }
      return true
    }
    if (last) this.rate.record(continuousRate(last, sample))
    this.append(sample)
    return true
  }
  private append(sample: MotionSample) {
    this.buffer.append(sample)
    const retained = new Set(this.buffer.samples)
    for (const key of this.projections.keys())
      if (!retained.has(key)) this.projections.delete(key)
  }
  sample(
    now: number,
    details: ReadonlyMap<number, MotionPlayerDetails>,
    reduced = false
  ): {
    status: LiveMotionStatus
    frame?: TacticalMotionFrame
    animate: boolean
  } {
    if (
      this.pending &&
      now - this.pending.sample.receivedAtMs >= LIVE_MOTION_DELAY_MS
    ) {
      // No confirming successor: snap to the actual observation, never invent a rate.
      const latest = this.pending.sample
      this.pending = undefined
      this.lastResetReason = "unconfirmed-clock-jump"
      this.jumpCount++
      this.resetWindow()
      this.append(latest)
    }
    const sampled = sampleLiveClock(this.buffer.samples, now)
    const newest = this.buffer.samples.at(-1)
    if (newest && now - newest.receivedAtMs > 1500) {
      this.reset()
      return { status: "waiting", animate: false }
    }
    const current = reduced
      ? (this.pending?.sample ?? this.buffer.samples.at(-1))
      : sampled.current
    if (!current) return { status: "buffering", animate: false }
    const project = (s: MotionSample) => {
      let frame = this.projections.get(s)
      if (!frame) {
        const position = (x: number, y: number) =>
          projectPositionToTacticalBoard(
            x,
            y,
            false,
            s.halfPitchWidth,
            s.halfPitchLength
          )
        frame = {
          tick: s.tick,
          pitchDimensions: {
            length: s.halfPitchLength * 2,
            width: s.halfPitchWidth * 2,
          },
          players: s.players.map((p) => ({
            playerId: p.playerId,
            team: p.team,
            ...details.get(p.playerId),
            ...position(p.x, p.y),
            positionMeters: projectPositionToPitchMeters(
              p.x,
              p.y,
              false,
              s.halfPitchWidth,
              s.halfPitchLength
            ),
            angleDegrees:
              p.angleDegrees == null ? undefined : (p.angleDegrees + 90) % 360,
            velocity: motionVelocity(
              p.speed,
              p.angleDegrees,
              s,
              p,
              this.buffer.samples[this.buffer.samples.indexOf(s) - 1],
              this.buffer.samples[
                this.buffer.samples.indexOf(s) - 1
              ]?.players.find((other) => other.playerId === p.playerId)
            ),
            velocityXPerTick: 0,
            velocityYPerTick: 0,
          })),
          ball: s.ball
            ? {
                ...position(s.ball.x, s.ball.y),
                positionMeters: projectPositionToPitchMeters(
                  s.ball.x,
                  s.ball.y,
                  false,
                  s.halfPitchWidth,
                  s.halfPitchLength
                ),
                zCentimeters: s.ball.z,
              }
            : undefined,
        }
        this.projections.set(s, frame)
      }
      return frame
    }
    if (this.playerDetails !== details) {
      this.projections.clear()
      this.playerDetails = details
    }
    const frame =
      !reduced && sampled.next
        ? interpolateMotionFrame(
            project(current),
            project(sampled.next),
            sampled.progress
          )
        : project(current)
    // No empty RAF while waiting for the second anchor. Incoming samples wake it.
    const animate =
      !reduced &&
      (this.pending != null ||
        sampled.status === "playing" ||
        (sampled.status === "buffering" &&
          this.buffer.samples.filter((s) => s.anchor).length >= 2))
    if (sampled.status === "waiting") {
      this.buffer.clear()
      this.projections.clear()
      this.buffer.append(current)
    }
    return { frame, status: reduced ? "playing" : sampled.status, animate }
  }
}
