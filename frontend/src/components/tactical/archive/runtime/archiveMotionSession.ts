import type { RealtimeFrame } from "@/api/realtimeMatch"
import type {
  ReplayMotionSnapshot,
  ReplayMotionStatus,
} from "@/api/replay/replayMotionSource"
import {
  projectPositionToTacticalBoard,
  validPitchHalf,
} from "@/components/tactical/shared/core/frameProjector"
import { interpolateMotionFrame } from "@/components/tactical/shared/core/interpolation"
import type { TacticalMotionFrame } from "@/components/tactical/shared/core/types"
import type { MatchPlayer } from "@/types/match"

/** Projects only the cursor's neighboring frames, with no archive-wide copies. */
export class ArchiveMotionSession {
  private projections = new Map<RealtimeFrame, TacticalMotionFrame>()
  private details?: ReadonlyMap<number, MatchPlayer>
  get cacheSize() {
    return this.projections.size
  }
  clear() {
    this.projections.clear()
    this.details = undefined
  }
  sample(
    snapshot: ReplayMotionSnapshot,
    details: ReadonlyMap<number, MatchPlayer>,
    reduced = false
  ): { frame?: TacticalMotionFrame; status: ReplayMotionStatus } {
    if (this.details !== details) {
      this.projections.clear()
      this.details = details
    }
    const index = Math.floor(snapshot.position)
    const current = snapshot.frames[index]
    const next =
      snapshot.frames[Math.min(index + 1, snapshot.frames.length - 1)]
    if (!current || !next) {
      this.clear()
      return { status: "buffering" }
    }
    for (const key of this.projections.keys())
      if (key !== current && key !== next) this.projections.delete(key)
    const from = this.project(current, details),
      to = this.project(next, details)
    const continuous =
      current.matchId === next.matchId &&
      current.period === next.period &&
      next.tick > current.tick &&
      next.tick - current.tick <= 4
    const frame =
      from && to && continuous && !reduced
        ? interpolateMotionFrame(from, to, snapshot.position - index)
        : from
    return {
      frame,
      status: !frame
        ? "buffering"
        : snapshot.position >= snapshot.frames.length - 1
          ? "ended"
          : snapshot.playing
            ? "playing"
            : "paused",
    }
  }
  private project(
    raw: RealtimeFrame,
    details: ReadonlyMap<number, MatchPlayer>
  ) {
    const cached = this.projections.get(raw)
    if (cached) return cached
    const halfWidth = validPitchHalf(raw.halfPitchWidth),
      halfLength = validPitchHalf(raw.halfPitchLength)
    if (!halfWidth || !halfLength) return undefined
    const project = (x: number, y: number) =>
      projectPositionToTacticalBoard(x, y, false, halfWidth, halfLength)
    const frame: TacticalMotionFrame = {
      tick: raw.tick,
      players: raw.players
        .filter(
          (p) => p.isOnPitch && Number.isFinite(p.x) && Number.isFinite(p.y)
        )
        .slice(0, 64)
        .map((p) => {
          const detail = details.get(p.playerId)
          return {
            playerId: p.playerId,
            team: p.team,
            shirtNumber: detail?.shirtNumber ?? detail?.squadNumber,
            isGoalkeeper:
              (
                detail?.inPossession?.position ??
                detail?.outOfPossession?.position ??
                detail?.position
              )
                ?.trim()
                .toUpperCase() === "GK",
            ...project(p.x, p.y),
            angleDegrees: Number.isFinite(p.angleDegrees)
              ? (p.angleDegrees! + 90) % 360
              : undefined,
            velocityXPerTick: 0,
            velocityYPerTick: 0,
          }
        }),
      ball: [
        raw.ballXCentimeters,
        raw.ballYCentimeters,
        raw.ballZCentimeters,
      ].every(Number.isFinite)
        ? {
            ...project(raw.ballXCentimeters / 100, raw.ballYCentimeters / 100),
            zCentimeters: raw.ballZCentimeters,
          }
        : undefined,
    }
    this.projections.set(raw, frame)
    return frame
  }
}
