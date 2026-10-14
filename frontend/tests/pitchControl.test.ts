import { describe, expect, it } from "vitest"
import {
  calculatePitchControl,
  controlAt,
  prepareInfluences,
} from "@/components/tactical/shared/core/pitchControl"
import { motionVelocity } from "@/components/tactical/shared/core/motionVelocity"
import { interpolateMotionFrame } from "@/components/tactical/shared/core/interpolation"
import { ArchiveMotionSession } from "@/components/tactical/archive/runtime/archiveMotionSession"
import { LiveMotionSession } from "@/components/tactical/live/runtime/liveMotionSession"
import type { TacticalMotionFrame } from "@/components/tactical/shared/core/types"
import type { RealtimeFrame } from "@/api/realtimeMatch"
import type { MotionSample } from "@/api/liveMotionSource"
import { pitchControlColor } from "@/components/tactical/shared/renderer/pitchControlColor"
import { rasterizePitchControl } from "@/components/tactical/shared/renderer/pitchControlRaster"

describe("pitch control colour mapping", () => {
  const home = 0xff0000,
    away = 0x0000ff
  it.each([0.5, 0.4995, 0.5005])(
    "keeps neutral control %s transparent",
    (control) => {
      expect(pitchControlColor(control, home, away).alpha).toBe(0)
    }
  )
  it.each([0.4989, 0.49, 0.1, 0.5011, 0.51, 0.9])(
    "maps non-neutral control %s to the correct team with positive opacity",
    (control) => {
      const result = pitchControlColor(control, home, away)
      expect(result.alpha).toBeGreaterThan(0)
      expect(result.alpha).toBeLessThanOrEqual(255 * 0.7)
      expect(result.color).toBe(control > 0.5 ? home : away)
    }
  )
  it("treats both teams symmetrically and increases opacity with advantage", () => {
    expect(pitchControlColor(0.49, home, away).alpha).toBeCloseTo(
      pitchControlColor(0.51, home, away).alpha
    )
    expect(pitchControlColor(0.8, home, away).alpha).toBeGreaterThan(
      pitchControlColor(0.51, home, away).alpha
    )
    expect(pitchControlColor(1, home, away).alpha).toBe(255 * 0.7)
    expect(pitchControlColor(NaN, home, away).alpha).toBe(0)
  })
  it("feathers the neutral edge without a hard opacity jump", () => {
    const edge = 0.501
    expect(pitchControlColor(edge - 1e-8, home, away).alpha).toBe(0)
    expect(pitchControlColor(edge + 1e-8, home, away).alpha).toBeLessThan(1e-8)
    expect(pitchControlColor(edge + 1e-5, home, away).alpha).toBeLessThan(0.01)
  })
  it("boosts weak advantages nonlinearly while remaining monotone and bounded", () => {
    expect(pitchControlColor(0.51, home, away).alpha / 255).toBeGreaterThan(
      0.08
    )
    let previous = 0
    for (let i = 0; i <= 1000; i++) {
      const alpha = pitchControlColor(0.5 + i / 2000, home, away).alpha
      expect(alpha).toBeGreaterThanOrEqual(previous)
      expect(alpha).toBeLessThanOrEqual(255 * 0.7)
      expect(alpha).toBeCloseTo(
        pitchControlColor(0.5 - i / 2000, home, away).alpha,
        8
      )
      previous = alpha
    }
  })
  it("interpolates opposing control through transparency instead of blending opaque team colours", () => {
    const grid = {
      columns: 2,
      rows: 2,
      values: new Float32Array([0.25, 0.75, 0.25, 0.75]),
    }
    const raster = rasterizePitchControl(grid, home, away)
    expect(raster.width).toBe(5)
    expect(raster.height).toBe(5)
    for (let y = 0; y < raster.height; y++) {
      expect(raster.pixels[(y * raster.width + 2) * 4 + 3]).toBe(0)
      expect(raster.pixels[y * raster.width * 4 + 2]).toBe(255)
      expect(raster.pixels[(y * raster.width + 4) * 4]).toBe(255)
    }
  })
  it("produces an entirely transparent neutral raster", () => {
    const raster = rasterizePitchControl(
      { columns: 2, rows: 2, values: new Float32Array(4).fill(0.5) },
      home,
      away
    )
    expect(
      raster.pixels.filter((_, i) => i % 4 === 3).every((alpha) => alpha === 0)
    ).toBe(true)
  })
})

const ball = { x: 52, y: 30 }
describe("Wide Open Spaces control model", () => {
  it("matches the document's NumPy reference at (55, 30)", () => {
    const players = [
      { x: 50, y: 30, vx: 4, vy: 0, team: "home" as const },
      { x: 60, y: 30, vx: -1, vy: 0, team: "away" as const },
    ]
    expect(controlAt(prepareInfluences(players, ball), 55, 30)).toBeCloseTo(
      0.6105,
      4
    )
  })
  it("normalizes influence at the player's position and keeps its moving peak above one", () => {
    const influence = prepareInfluences(
      [{ x: 50, y: 30, vx: 4, vy: 0, team: "home" }],
      ball
    )
    expect(controlAt(influence, 50, 30)).toBeCloseTo(1 / (1 + Math.exp(-1)), 12)
    expect(controlAt(influence, 52, 30)).toBeGreaterThan(
      controlAt(influence, 50, 30)
    )
  })
  it("is symmetric, complementary under team swaps, and neutral without players", () => {
    const a = { x: 40, y: 34, vx: 0, vy: 0, team: "home" as const }
    const b = { ...a, x: 65, team: "away" as const }
    expect(
      controlAt(prepareInfluences([a, b], { x: 52.5, y: 34 }), 52.5, 34)
    ).toBe(0.5)
    expect(
      controlAt(prepareInfluences([a, b], ball), 42, 34) +
        controlAt(
          prepareInfluences(
            [
              { ...a, team: "away" },
              { ...b, team: "home" },
            ],
            ball
          ),
          42,
          34
        )
    ).toBeCloseTo(1)
    expect(controlAt([], 10, 10)).toBe(0.5)
  })
  it("guards singular velocities and ignores non-finite input", () => {
    const influences = prepareInfluences(
      [
        { x: 50, y: 30, vx: 100, vy: 0, team: "home" },
        { x: NaN, y: 30, vx: 0, vy: 0, team: "away" },
      ],
      ball
    )
    for (const x of [0, 50, 55, 105]) {
      const value = controlAt(influences, x, 30)
      expect(Number.isFinite(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
  })
  it("hides incomplete tracking rather than substituting a stationary player", () => {
    const frame: TacticalMotionFrame = {
      tick: 1,
      pitchDimensions: { length: 105, width: 68 },
      ball: {
        x: 50,
        y: 50,
        positionMeters: { x: 52.5, y: 34 },
        zCentimeters: 0,
      },
      players: [
        {
          playerId: 1,
          team: "home",
          x: 40,
          y: 50,
          velocityXPerTick: 0,
          velocityYPerTick: 0,
        },
      ],
    }
    expect(calculatePitchControl(frame)).toBeUndefined()
    expect(
      calculatePitchControl({ ...frame, players: [] })?.values.every(
        (v) => v === 0.5
      )
    ).toBe(true)
    expect(calculatePitchControl({ ...frame, ball: undefined })).toBeUndefined()
  })
})

describe("motion velocity and live/archive parity", () => {
  const now = { tick: 12, period: 1, matchId: "match" }
  it("maps FM direction and uses actual simulation ticks for a missing velocity", () => {
    expect(motionVelocity(4, 0, now, { x: 0, y: 0 })).toEqual({ x: 4, y: 0 })
    expect(motionVelocity(4, 90, now, { x: 0, y: 0 })?.y).toBeCloseTo(4)
    expect(
      motionVelocity(
        undefined,
        undefined,
        now,
        { x: 2, y: 3 },
        { ...now, tick: 10 },
        { x: 1, y: 1 }
      )
    ).toEqual({ x: 4, y: 2 })
  })
  it.each([{ tick: 2 }, { period: 2 }, { matchId: "other" }, { tick: 12 }])(
    "rejects discontinuities %j",
    (change) => {
      expect(
        motionVelocity(
          undefined,
          undefined,
          now,
          { x: 2, y: 3 },
          { ...now, tick: 10, ...change },
          { x: 1, y: 1 }
        )
      ).toBeUndefined()
    }
  )
  it("produces identical grids for live and archive and deterministic seeks", () => {
    const sample: MotionSample = {
      generation: 1,
      matchId: "match",
      tick: 12,
      displayTick: 12,
      sequence: 1,
      period: 1,
      receivedAtMs: 0,
      anchor: true,
      halfPitchWidth: 34,
      halfPitchLength: 52.5,
      players: [
        { playerId: 1, team: "home", x: -4, y: 0, speed: 4, angleDegrees: 0 },
        { playerId: 2, team: "away", x: 4, y: 10, speed: 2, angleDegrees: 180 },
      ],
      ball: { x: 0, y: 2, z: 0 },
    }
    const raw = {
      ...sample,
      players: sample.players.map((p) => ({
        ...p,
        isOnPitch: true,
        speedCentimetersPerSecond: p.speed! * 100,
      })),
      ballXCentimeters: 0,
      ballYCentimeters: 200,
      ballZCentimeters: 0,
    } as unknown as RealtimeFrame
    const live = new LiveMotionSession()
    live.push(sample)
    const liveFrame = live.sample(0, new Map(), true).frame!
    const archive = new ArchiveMotionSession(),
      details = new Map()
    const cursor = { frames: [raw], position: 0, playing: false }
    const archiveFrame = archive.sample(cursor, details).frame!
    expect(calculatePitchControl(liveFrame)).toEqual(
      calculatePitchControl(archiveFrame)
    )
    archive.clear()
    expect(
      calculatePitchControl(archive.sample(cursor, details).frame!)
    ).toEqual(calculatePitchControl(liveFrame))
    const interpolated = interpolateMotionFrame(
      liveFrame,
      { ...archiveFrame, tick: 13 },
      0.5
    )
    expect(interpolated.pitchDimensions).toEqual(liveFrame.pitchDimensions)
    expect(calculatePitchControl(interpolated)).toEqual(
      calculatePitchControl(liveFrame)
    )
  })
})
