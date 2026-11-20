import { describe, expect, it } from "vitest"
import type { RealtimeFrame } from "@/api/realtimeMatch"
import type { MotionSample } from "@/api/liveMotionSource"
import type { MatchPlayer } from "@/types/match"
import { LiveMotionSession } from "@/components/tactical/live/runtime/liveMotionSession"
import { ArchiveMotionSession } from "@/components/tactical/archive/runtime/archiveMotionSession"
import { calculatePitchControl } from "@/components/tactical/shared/core/pitchControl"
import { motionVelocity } from "@/components/tactical/shared/core/motionVelocity"

function sample(period: number): MotionSample {
  const direction = period === 1 || period === 3 ? -1 : 1
  const positions = [
    [-45, 0],
    [-30, -10],
    [-20, -10],
    [-20, 10],
    [-30, 10],
    [45, 0],
    [30, -10],
    [20, -10],
    [20, 10],
    [30, 10],
  ]
  return {
    generation: 1,
    matchId: "direction",
    tick: 10,
    displayTick: 10,
    sequence: 1,
    period,
    receivedAtMs: 0,
    anchor: true,
    halfPitchLength: 50,
    halfPitchWidth: 25,
    players: positions.map(([longitudinal, lateral], i) => ({
      playerId: i + 1,
      team: i < 5 ? "home" : "away",
      x: direction * lateral,
      y: direction * longitudinal,
      speed: 4,
      angleDegrees: (i < 5 ? direction : -direction) > 0 ? 0 : 180,
    })),
    ball: { x: 0, y: direction * -25, z: 10 },
  }
}

describe("fixed home-left-to-right motion display", () => {
  it.each([1, 2, 3, 4])(
    "normalizes players, ball, heading, velocity and pitch control in period %s",
    (period) => {
      const input = sample(period)
      const details = new Map<number, MatchPlayer & { isGoalkeeper: boolean }>([
        [
          1,
          {
            id: 1,
            name: "Home GK",
            team: "home",
            isStarter: true,
            isOnPitch: true,
            isGoalkeeper: true,
            position: "GK",
          },
        ],
        [
          6,
          {
            id: 6,
            name: "Away GK",
            team: "away",
            isStarter: true,
            isOnPitch: true,
            isGoalkeeper: true,
            position: "GK",
          },
        ],
      ])
      const live = new LiveMotionSession()
      live.push(input)
      const liveFrame = live.sample(0, details, true).frame!
      const raw = {
        ...input,
        players: input.players.map((p) => ({
          ...p,
          isOnPitch: true,
          speedCentimetersPerSecond: 400,
        })),
        ballXCentimeters: 0,
        ballYCentimeters: input.ball!.y * 100,
        ballZCentimeters: 10,
      } as unknown as RealtimeFrame
      const archive = new ArchiveMotionSession()
      const archiveFrame = archive.sample(
        { frames: [raw], position: 0, playing: false },
        details
      ).frame!
      for (const frame of [liveFrame, archiveFrame]) {
        expect(frame.players[0].x).toBe(5)
        expect(frame.players[5].x).toBe(95)
        expect(frame.players[1].angleDegrees).toBe(90)
        expect(frame.players[6].angleDegrees).toBe(270)
        expect(frame.players[1].velocity?.x).toBeCloseTo(4)
        expect(frame.players[6].velocity?.x).toBeCloseTo(-4)
        expect(frame.ball).toMatchObject({
          x: 25,
          y: 50,
          positionMeters: { x: 25, y: 25 },
        })
        expect(calculatePitchControl(frame)).toBeDefined()
      }
      expect(calculatePitchControl(liveFrame)).toEqual(
        calculatePitchControl(archiveFrame)
      )
    }
  )

  it("rotates inferred physical velocity as well as measured velocity", () => {
    expect(
      motionVelocity(
        undefined,
        undefined,
        { tick: 11, period: 1, matchId: "direction" },
        { x: 1, y: 1 },
        { tick: 10, period: 1, matchId: "direction" },
        { x: 0, y: 0 },
        true
      )
    ).toEqual({ x: -4, y: -4 })
  })
})
