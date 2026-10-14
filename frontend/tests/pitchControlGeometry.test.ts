import { describe, expect, it } from "vitest"
import type { MotionSample } from "@/api/liveMotionSource"
import type { RealtimeFrame } from "@/api/realtimeMatch"
import { LiveMotionSession } from "@/components/tactical/live/runtime/liveMotionSession"
import { ArchiveMotionSession } from "@/components/tactical/archive/runtime/archiveMotionSession"
import { projectPositionToPitchMeters } from "@/components/tactical/shared/core/frameProjector"
import { interpolateMotionFrame } from "@/components/tactical/shared/core/interpolation"
import {
  calculatePitchControl,
  controlAt,
  prepareInfluences,
} from "@/components/tactical/shared/core/pitchControl"
import { pitchControlContours } from "@/components/tactical/shared/renderer/pitchControlContours"
import type { TacticalMotionFrame } from "@/components/tactical/shared/core/types"

function sample(tick = 1, playerY = 57.5, ballY = 52.5): MotionSample {
  return {
    generation: 1,
    matchId: "boundary",
    tick,
    displayTick: tick,
    sequence: tick,
    period: 1,
    receivedAtMs: tick * 250,
    anchor: true,
    halfPitchLength: 52.5,
    halfPitchWidth: 34,
    players: [
      {
        playerId: 1,
        team: "home",
        x: 0,
        y: playerY,
        speed: 0,
        angleDegrees: 0,
      },
    ],
    ball: { x: 0, y: ballY, z: 0 },
  }
}
function raw(s: MotionSample): RealtimeFrame {
  return {
    ...s,
    players: s.players.map((p) => ({
      ...p,
      isOnPitch: true,
      speedCentimetersPerSecond: p.speed! * 100,
    })),
    ballXCentimeters: s.ball!.x * 100,
    ballYCentimeters: s.ball!.y * 100,
    ballZCentimeters: 0,
  } as unknown as RealtimeFrame
}
function boundaryControl(frame: TacticalMotionFrame) {
  const grid = calculatePitchControl(frame)!
  return grid.values[17 * grid.columns + grid.columns - 1]
}

describe("unclipped physical tracking for pitch control", () => {
  it.each([false, true])(
    "preserves off-pitch coordinates with rotation=%s",
    (rotate) => {
      expect(projectPositionToPitchMeters(38, 57.5, rotate, 34, 52.5)).toEqual(
        rotate ? { x: -5, y: -4 } : { x: 110, y: 72 }
      )
    }
  )
  it("uses the same real distances in live and archive while display markers remain clipped", () => {
    const s = sample(),
      live = new LiveMotionSession(),
      archive = new ArchiveMotionSession()
    live.push(s)
    const liveFrame = live.sample(s.receivedAtMs, new Map(), true).frame!
    const archiveFrame = archive.sample(
      { frames: [raw(s)], position: 0, playing: false },
      new Map()
    ).frame!
    const expected = controlAt(
      prepareInfluences([{ x: 110, y: 34, vx: 0, vy: 0, team: "home" }], {
        x: 105,
        y: 34,
      }),
      105,
      34
    )
    for (const frame of [liveFrame, archiveFrame]) {
      expect(frame.players[0].x).toBe(100)
      expect(frame.players[0].positionMeters).toEqual({ x: 110, y: 34 })
      expect(boundaryControl(frame)).toBeCloseTo(expected, 7)
      expect(boundaryControl(frame)).toBeLessThan(0.52)
    }
    expect(calculatePitchControl(liveFrame)).toEqual(
      calculatePitchControl(archiveFrame)
    )
  })
  it("preserves an out-of-bounds ball and interpolates physical positions independently of clipped markers", () => {
    const archive = new ArchiveMotionSession(),
      frames = [raw(sample(1, 57.5, 57.5)), raw(sample(2, 59.5, 59.5))],
      details = new Map()
    const from = archive.sample(
      { frames, position: 0, playing: false },
      details
    ).frame!
    const to = archive.sample(
      { frames, position: 1, playing: false },
      details
    ).frame!
    const between = interpolateMotionFrame(from, to, 0.5)
    expect(between.players[0].x).toBe(100)
    expect(between.ball?.x).toBe(100)
    expect(between.players[0].positionMeters).toEqual({ x: 111, y: 34 })
    expect(between.ball?.positionMeters).toEqual({ x: 111, y: 34 })
    const expected = controlAt(
      prepareInfluences([{ x: 111, y: 34, vx: 0, vy: 0, team: "home" }], {
        x: 111,
        y: 34,
      }),
      105,
      34
    )
    expect(boundaryControl(between)).toBeCloseTo(expected, 7)
  })
  it("does not substitute clipped marker coordinates when physical tracking is absent", () => {
    const archive = new ArchiveMotionSession()
    const frame = archive.sample(
      { frames: [raw(sample())], position: 0, playing: false },
      new Map()
    ).frame!
    expect(
      calculatePitchControl({
        ...frame,
        players: [{ ...frame.players[0], positionMeters: undefined }],
      })
    ).toBeUndefined()
    expect(
      calculatePitchControl({
        ...frame,
        ball: { ...frame.ball!, positionMeters: undefined },
      })
    ).toBeUndefined()
  })
})

function contours(corners: number[]) {
  return pitchControlContours({
    columns: 2,
    rows: 2,
    values: new Float32Array([corners[0], corners[1], corners[3], corners[2]]),
  })
}
function edge(point: { x: number; y: number }) {
  if (point.y === 0) return 0
  if (point.x === 1) return 1
  if (point.y === 1) return 2
  return 3
}
function connections(corners: number[]) {
  return contours(corners)
    .map(({ from, to }) => [edge(from), edge(to)].sort().join("-"))
    .sort()
}
describe("pitch control saddle contours", () => {
  it.each([
    { corners: [0.875, 0.25, 0.75, 0.375], expected: ["0-1", "2-3"] },
    { corners: [0.625, 0.125, 0.75, 0.25], expected: ["0-3", "1-2"] },
    // The mean is positive here, but the bilinear saddle is negative.
    { corners: [0.9375, 0.25, 0.5625, 0.3125], expected: ["0-3", "1-2"] },
  ])(
    "uses bilinear topology and is unchanged by team swaps: $corners",
    ({ corners, expected }) => {
      expect(connections(corners)).toEqual(expected)
      expect(connections(corners.map((v) => 1 - v))).toEqual(expected)
      expect(contours(corners.map((v) => 1 - v))).toEqual(contours(corners))
    }
  )
  it("preserves a true saddle crossing when the determinant is zero", () => {
    const corners = [0.75, 0.25, 0.75, 0.25]
    expect(connections(corners)).toEqual(["0-2", "1-3"])
    expect(contours(corners.map((v) => 1 - v))).toEqual(contours(corners))
  })
  it("keeps ordinary crossings and neutral cells unchanged", () => {
    expect(connections([0.75, 0.75, 0.25, 0.25])).toEqual(["1-3"])
    expect(contours([0.5, 0.5, 0.5, 0.5])).toEqual([])
  })
})
