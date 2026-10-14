import { describe, expect, it } from "vitest"
import { LiveMotionSource, type MotionSample } from "@/api/liveMotionSource"
import type { RealtimeFrame } from "@/api/realtimeMatch"
import { LiveMotionSession } from "@/components/tactical/live/runtime/liveMotionSession"
import {
  LIVE_MOTION_DELAY_MS,
  sampleLiveClock,
} from "@/components/tactical/live/runtime/liveMotionClock"
import { continuity } from "@/components/tactical/live/core/continuity"
import { TacticalRenderScheduler } from "@/components/tactical/shared/runtime/tacticalRenderScheduler"

const details = new Map([[1, { shirtNumber: 7 }]])
function sample(
  tick: number,
  receivedAtMs: number,
  overrides: Partial<MotionSample> = {}
): MotionSample {
  return {
    generation: 1,
    matchId: "match",
    tick,
    displayTick: tick,
    sequence: tick,
    period: 1,
    receivedAtMs,
    anchor: true,
    halfPitchWidth: 34,
    halfPitchLength: 52.5,
    players: [
      { playerId: 1, team: "home", x: 0, y: 0, speed: 0, angleDegrees: 0 },
    ],
    ball: { x: 0, y: 0, z: 0 },
    ...overrides,
  }
}
function raw(tick: number, matchId = "match") {
  return {
    matchId,
    tick,
    displayTick: tick,
    sequence: tick,
    period: 1,
    halfPitchWidth: 34,
    halfPitchLength: 52.5,
    players: [
      {
        playerId: 1,
        team: "home",
        isOnPitch: true,
        x: 3,
        y: 4,
        speedCentimetersPerSecond: 700,
        angleDegrees: 45,
        stats: { enormous: [] },
      },
    ],
    ballXCentimeters: 100,
    ballYCentimeters: 200,
    ballZCentimeters: 300,
    momentum: [1, 2],
    home: {},
    away: {},
  } as unknown as RealtimeFrame
}
describe("live motion clock and bounded session", () => {
  it.each([1, 10, 20])(
    "follows %sx for 60 seconds with a fixed 500ms wall delay",
    (rate) => {
      const session = new LiveMotionSession()
      for (let i = 0; i <= 240; i++) {
        session.push(sample(i * rate, i * 250))
        const result = session.sample(i * 250, details)
        if (i >= 4) {
          expect(result.status).toBe("playing")
          expect(result.frame?.tick).toBeCloseTo(
            (i - LIVE_MOTION_DELAY_MS / 250) * rate,
            8
          )
        }
        expect(session.bufferCount).toBeLessThanOrEqual(32)
      }
    }
  )
  it("holds the first sample while buffering so startup never plays backwards", () => {
    const session = new LiveMotionSession()
    session.push(sample(0, 0))
    session.push(sample(20, 250))
    expect(session.sample(250, details).frame?.tick).toBe(0)
    session.push(sample(40, 500))
    expect(session.sample(499, details).frame?.tick).toBe(0)
    expect(session.sample(750, details).frame?.tick).toBe(20)
  })
  it("reflects repeated 1x/20x/1x changes after the delay without reversing", () => {
    const session = new LiveMotionSession(),
      ticks: number[] = [0]
    let previous = 0
    for (let i = 0; i < 240; i++) {
      if (i) ticks.push(ticks[i - 1] + (Math.floor(i / 12) % 2 ? 20 : 1))
      session.push(sample(ticks[i], i * 250))
      if (i < 4) continue
      const frame = session.sample(i * 250 + 125, details).frame!
      if (i % 12 >= 5)
        expect(frame.tick).toBeCloseTo((ticks[i - 2] + ticks[i - 1]) / 2, 8)
      expect(frame.tick).toBeGreaterThanOrEqual(previous)
      previous = frame.tick
    }
  })
  it("keeps HTTP seeds out of the wall clock and rejects duplicate and old anchors", () => {
    const session = new LiveMotionSession()
    session.push(sample(0, 0, { anchor: false }))
    session.push(sample(1, 250))
    expect(session.sample(500, details).status).toBe("buffering")
    expect(session.push(sample(1, 600))).toBe(false)
    expect(session.push(sample(0, 650))).toBe(false)
    session.push(sample(2, 500))
    session.push(sample(3, 750))
    expect(session.sample(1000, details).frame?.tick).toBeCloseTo(2)
  })
  it("stops at the last actual frame, then waits without extrapolating", () => {
    const session = new LiveMotionSession()
    session.push(sample(0, 0))
    session.push(sample(20, 250))
    session.push(sample(40, 500))
    const end = session.sample(1500, details)
    expect(end.frame?.tick).toBe(40)
    expect(end.animate).toBe(false)
    expect(end.status).toBe("waiting")
    expect(session.sample(30000, details)).toMatchObject({
      animate: false,
      status: "waiting",
    })
    expect(session.bufferCount).toBe(0)
    session.push(sample(500, 30250))
    session.push(sample(520, 30500))
    session.push(sample(540, 30750))
    expect(session.sample(31000, details).frame?.tick).toBe(520)
  })
  it.each([
    { period: 2 },
    { matchId: "new" },
    { generation: 2 },
    { receivedAtMs: 10 },
    { receivedAtMs: 2000 },
    { tick: 1000 },
  ])("re-buffers on a continuity boundary %j", (overrides) => {
    const session = new LiveMotionSession()
    session.push(sample(0, 0))
    session.push(sample(1, 250, overrides))
    expect(session.bufferCount).toBe(1)
    expect(session.sample(750, details).status).toBe("buffering")
  })
  it("uses match time for physical displacement at 20x and resets whole-team relocation", () => {
    const players = Array.from({ length: 11 }, (_, i) => ({
      playerId: i,
      team: "home" as const,
      x: 0,
      y: 0,
      speed: 8,
    }))
    expect(
      continuity(
        sample(0, 0, { players }),
        sample(20, 250, { players: players.map((p) => ({ ...p, y: 30 })) })
      ).action
    ).toBe("interpolate")
    expect(
      continuity(
        sample(0, 0, { players }),
        sample(1, 250, { players: players.map((p) => ({ ...p, y: 30 })) })
      ).action
    ).toBe("reset")
  })
  it("projects meters and ball centimeters on a fixed camera, and takes the short angle path", () => {
    const session = new LiveMotionSession()
    const first = sample(0, 0, {
      players: [
        {
          playerId: 1,
          team: "home",
          x: -34,
          y: -52.5,
          angleDegrees: 269,
          speed: 1,
        },
      ],
      ball: { x: 0, y: 0, z: 200 },
    })
    const next = sample(1, 250, {
      players: [{ ...first.players[0], x: 34, y: 52.5, angleDegrees: 270 }],
      ball: { x: 34, y: 52.5, z: 300 },
    })
    session.push(first)
    session.push(next)
    const frame = session.sample(625, details).frame!
    expect(frame.players[0]).toMatchObject({
      x: 50,
      y: 50,
      shirtNumber: 7,
      angleDegrees: 359.5,
    })
    expect(frame.ball).toEqual({
      x: 75,
      y: 75,
      positionMeters: { x: 78.75, y: 51 },
      zCentimeters: 250,
    })
  })
  it("does not keep missing entities or a missing ball beyond the next sample boundary", () => {
    const session = new LiveMotionSession()
    session.push(sample(0, 0))
    session.push(sample(1, 250, { players: [], ball: undefined }))
    session.push(sample(2, 500, { players: [], ball: undefined }))
    expect(session.sample(1000, details).frame).toMatchObject({
      players: [],
      ball: undefined,
    })
  })
  it("updates latest positions on every sample under reduced motion", () => {
    const session = new LiveMotionSession()
    for (let i = 0; i < 5; i++) {
      session.push(sample(i, i * 250))
      const result = session.sample(i * 250, details, true)
      expect(result.frame?.tick).toBe(i)
      expect(result.animate).toBe(false)
    }
  })
  it("keeps long-running and burst inputs bounded, clearing all state on suspension", () => {
    const session = new LiveMotionSession()
    for (let i = 0; i < 20000; i++) {
      session.push(sample(i, i * 50))
      expect(session.bufferCount).toBeLessThanOrEqual(32)
    }
    session.suspend()
    expect(session.bufferCount).toBe(0)
    expect(session.sample(1e7, details).frame).toBeUndefined()
  })
  it("has no division by zero for a single anchor", () => {
    const result = sampleLiveClock([sample(1, 0)], 1000)
    expect(result.progress).toBe(0)
    expect(result.status).toBe("buffering")
  })
})
describe("live source lifecycle", () => {
  it("copies only bounded motion scalars, including ball unit conversion", () => {
    const source = new LiveMotionSource()
    source.subscribe(() => {})
    const frame = raw(1)
    source.publish(frame, true, 10)
    const latest = source.getLatest()!
    expect(latest).not.toHaveProperty("momentum")
    expect(latest).not.toHaveProperty("home")
    expect(latest.players[0]).not.toHaveProperty("stats")
    expect(latest.players[0].speed).toBe(7)
    expect(latest.ball).toEqual({ x: 1, y: 2, z: 300 })
    frame.players[0].x = 100
    expect(latest.players[0].x).toBe(3)
  })
  it("keeps one anchor time for duplicate ticks and rejects reordered input", () => {
    const source = new LiveMotionSource()
    source.subscribe(() => {})
    source.publish(raw(2), true, 100)
    source.publish(raw(2), true, 200)
    expect(source.getLatest()?.receivedAtMs).toBe(100)
    source.publish(raw(1), true, 300)
    expect(source.getLatest()?.tick).toBe(2)
    source.publish(raw(2, "next"), true, 400)
    expect(source.getLatest()?.matchId).toBe("next")
  })
  it("rejects invalid coordinates and keeps pitch dimensions only within the same match", () => {
    const source = new LiveMotionSource()
    source.subscribe(() => {})
    source.publish(raw(1), true, 0)
    const invalid = raw(2)
    invalid.halfPitchWidth = NaN
    invalid.players[0].x = Infinity
    invalid.ballXCentimeters = Infinity
    source.publish(invalid, true, 250)
    expect(source.getLatest()?.halfPitchWidth).toBe(34)
    expect(source.getLatest()?.players).toEqual([])
    expect(source.getLatest()?.ball).toBeUndefined()
    invalid.matchId = "new"
    source.publish(invalid, true, 500)
    expect(source.getLatest()?.halfPitchWidth).toBeNaN()
  })
  it("can enable and disable 100 times without retaining samples or subscriptions", () => {
    const source = new LiveMotionSource()
    for (let i = 0; i < 100; i++) {
      const unsubscribe = source.subscribe(() => {})
      source.publish(raw(i))
      expect(source.subscriberCount).toBe(1)
      unsubscribe()
      unsubscribe()
      expect(source.subscriberCount).toBe(0)
      expect(source.getLatest()).toBeUndefined()
    }
    source.publish(raw(101))
    expect(source.getLatest()).toBeUndefined()
    source.dispose()
    source.dispose()
  })
})
describe("single tactical scheduler", () => {
  it("coalesces all tasks and dirty renders, sleeps when idle, and cancels on dispose", () => {
    let id = 0,
      renders = 0
    const callbacks = new Map<number, FrameRequestCallback>()
    const scheduler = new TacticalRenderScheduler(
      () => renders++,
      (fn) => {
        callbacks.set(++id, fn)
        return id
      },
      (key) => {
        callbacks.delete(key)
      }
    )
    for (let i = 0; i < 100; i++) {
      scheduler.setTask("live", () => false)
      scheduler.setTask("events", () => false)
      scheduler.invalidate()
      scheduler.invalidate()
      expect(callbacks.size).toBe(1)
      const [key, fn] = [...callbacks][0]
      callbacks.delete(key)
      fn(i * 250)
      expect(renders).toBe(i + 1)
      expect(callbacks.size).toBe(0)
    }
    scheduler.setTask("live", () => true)
    scheduler.dispose()
    scheduler.dispose()
    expect(callbacks.size).toBe(0)
    expect(scheduler.activeRAF).toBe(0)
  })
})
