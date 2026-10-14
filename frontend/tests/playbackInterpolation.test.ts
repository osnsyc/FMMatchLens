import { describe, expect, it } from "vitest"
import { interpolateMotionFrame } from "@/components/tactical/shared/core/interpolation"
import type { TacticalMotionFrame } from "@/components/tactical/shared/core/types"

function frame(tick: number, x: number, y = 50): TacticalMotionFrame {
  return {
    tick,
    players: [
      {
        playerId: 7,
        team: "home",
        x,
        y,
        angleDegrees: 90,
        // Facing and movement telemetry can disagree with the position track.
        velocityXPerTick: 0,
        velocityYPerTick: 8,
      },
    ],
    ball: { x, y, zCentimeters: 0 },
  }
}

function position(
  frames: readonly TacticalMotionFrame[],
  index: number,
  t: number
) {
  return interpolateMotionFrame(frames[index], frames[index + 1], t).players[0]
}

describe("playback position interpolation", () => {
  it("keeps uniform movement uniform despite conflicting movement telemetry", () => {
    const frames = [frame(0, 20), frame(1, 22), frame(2, 24)]
    for (let index = 0; index < 2; index += 1) {
      for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
        const player = position(frames, index, t)
        expect(player.x).toBeCloseTo(20 + 2 * (index + t))
        expect(player.y).toBeCloseTo(50)
        expect(player.angleDegrees).toBe(90)
      }
    }
  })

  it("matches ball positions throughout segments with different tick spans", () => {
    const frames = [
      frame(0, 20, 40),
      frame(1, 22, 41),
      frame(4, 34, 45),
      frame(6, 36, 46),
    ]
    for (let index = 0; index < frames.length - 1; index += 1) {
      for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
        const rendered = interpolateMotionFrame(
          frames[index],
          frames[index + 1],
          t
        )
        expect(rendered.players[0].x).toBe(rendered.ball?.x)
        expect(rendered.players[0].y).toBe(rendered.ball?.y)
      }
    }
  })

  it("preserves held tick positions and interpolates only adjacent frames", () => {
    const frames = [
      frame(0, 20),
      frame(1, 20),
      frame(2, 20),
      frame(3, 26),
      frame(4, 28),
    ]
    expect(frames.map((f) => f.players[0].x)).toEqual([20, 20, 20, 26, 28])
    for (const t of [0.25, 0.75]) {
      expect(position(frames, 0, t).x).toBe(20)
      expect(position(frames, 1, t).x).toBe(20)
      expect(position(frames, 2, t).x).toBeCloseTo(20 + 6 * t)
      expect(position(frames, 3, t).x).toBeCloseTo(26 + 2 * t)
    }
  })

  it("does not overshoot at reversals, stops, or pitch boundaries", () => {
    const frames = [frame(0, 95), frame(1, 100), frame(2, 96), frame(3, 96)]
    for (let index = 0; index < 3; index += 1) {
      const min = Math.min(
        frames[index].players[0].x,
        frames[index + 1].players[0].x
      )
      const max = Math.max(
        frames[index].players[0].x,
        frames[index + 1].players[0].x
      )
      for (let step = 0; step <= 100; step += 1) {
        const x = position(frames, index, step / 100).x
        expect(x).toBeGreaterThanOrEqual(min - 1e-10)
        expect(x).toBeLessThanOrEqual(max + 1e-10)
      }
    }
  })

  it("preserves linear ball interpolation and does not mutate input frames", () => {
    const input = [frame(0, 20), frame(1, 20), frame(2, 24)]
    const original = structuredClone(input)
    const frames = input
    expect(
      interpolateMotionFrame(frames[0], frames[1], 0.25).ball?.x
    ).toBeCloseTo(20)
    expect(
      interpolateMotionFrame(frames[1], frames[2], 0.5).ball?.x
    ).toBeCloseTo(22)
    expect(input).toEqual(original)
  })

  it("holds missing player tracks without interpolating across absent frames", () => {
    const absent = { ...frame(2, 60), players: [] }
    const frames = [
      frame(0, 20),
      frame(1, 20),
      absent,
      frame(3, 80),
      frame(4, 82),
    ]
    expect(position(frames, 0, 0.5).x).toBe(20)
    expect(position(frames, 3, 0.5).x).toBeCloseTo(81)
  })

  it("uses the exact next frame at a segment endpoint", () => {
    const current = frame(0, 20)
    const next = frame(1, 22)
    next.players[0].playerId = 8
    expect(interpolateMotionFrame(current, next, 1)).toEqual(next)
    expect(interpolateMotionFrame(next, next, 0.5).tick).toBe(next.tick)
  })
})
