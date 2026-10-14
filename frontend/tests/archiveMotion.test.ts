import { describe, expect, it, vi } from "vitest"
import type { RealtimeFrame } from "@/api/realtimeMatch"
import { ReplayMotionSource } from "@/api/replay/replayMotionSource"
import { ArchiveMotionSession } from "@/components/tactical/archive/runtime/archiveMotionSession"

function frame(tick: number, position: number, period = 1): RealtimeFrame {
  return {
    tick,
    displayTick: tick,
    matchId: "archive",
    sequence: tick,
    period,
    halfPitchWidth: 50,
    halfPitchLength: 50,
    players: [
      {
        playerId: 1,
        team: "home",
        isOnPitch: true,
        x: 0,
        y: position,
        angleDegrees: 270,
      },
    ],
    ballXCentimeters: 0,
    ballYCentimeters: position * 100,
    ballZCentimeters: position * 10,
  } as RealtimeFrame
}
const details = new Map()

describe("archive motion driven by the timeline cursor", () => {
  it.each([0.5, 1, 2, 10, 20])(
    "follows timeline %sx and its exact fractional frame position",
    (speed) => {
      const frames = Array.from({ length: 100 }, (_, i) => frame(i, i))
      const source = new ReplayMotionSource(),
        session = new ArchiveMotionSession()
      source.setFrames(frames)
      source.setPlaying(true)
      const cursor = source.advance(125, speed)
      expect(cursor.frames).toBe(frames)
      expect(cursor.position).toBeCloseTo(speed / 2)
      const result = session.sample(cursor, details)
      expect(result.status).toBe("playing")
      expect(result.frame?.tick).toBeCloseTo(speed / 2)
      expect(result.frame?.players[0].x).toBeCloseTo(50 + speed / 2)
      expect(result.frame?.ball?.x).toBeCloseTo(50 + speed / 2)
    }
  )
  it("preserves fractional position through pause, resume and a speed change", () => {
    const source = new ReplayMotionSource()
    source.setFrames(Array.from({ length: 10 }, (_, i) => frame(i, i)))
    source.setPlaying(true)
    source.advance(125, 1)
    source.setPlaying(false)
    expect(source.advance(10000, 20).position).toBe(0.5)
    source.setPlaying(true)
    expect(source.advance(125, 2).position).toBe(1.5)
    source.setPlaying(false)
    expect(
      new ArchiveMotionSession().sample(source.getSnapshot(), details).status
    ).toBe("paused")
  })
  it("seeks immediately in both directions and settles at the exact final frame", () => {
    const source = new ReplayMotionSource(),
      session = new ArchiveMotionSession()
    source.setFrames([frame(0, 0), frame(1, 10), frame(2, 20)])
    source.seek(2)
    expect(session.sample(source.getSnapshot(), details)).toMatchObject({
      status: "ended",
      frame: { tick: 2 },
    })
    source.seek(0)
    expect(session.sample(source.getSnapshot(), details)).toMatchObject({
      status: "paused",
      frame: { tick: 0 },
    })
    source.setPlaying(true)
    const end = source.advance(1000, 20)
    expect(end.position).toBe(2)
    expect(end.playing).toBe(false)
    expect(session.sample(end, details).frame?.ball?.x).toBe(70)
  })
  it("keeps repeated raw tick coordinates and interpolates only the moving interval", () => {
    const frames = [frame(0, 20), frame(1, 20), frame(2, 20), frame(3, 23)]
    const original = structuredClone(frames),
      session = new ArchiveMotionSession()
    for (const position of [0, 0.5, 1, 1.5, 2, 2.5, 3]) {
      const result = session.sample(
        { frames, position, playing: true },
        details
      ).frame!
      const expected = position <= 2 ? 70 : 50 + 20 + (position - 2) * 3
      expect(result.players[0].x).toBeCloseTo(expected)
      expect(result.ball?.x).toBeCloseTo(expected)
    }
    expect(frames).toEqual(original)
  })
  it.each(["jump", "period", "identity"])(
    "holds instead of interpolating across a %s boundary",
    (boundary) => {
      const next = frame(
        boundary === "jump" ? 86 : 2,
        30,
        boundary === "period" ? 2 : 1
      )
      if (boundary === "identity") next.matchId = "other"
      const frames = [frame(1, 0), next],
        session = new ArchiveMotionSession()
      expect(
        session.sample({ frames, position: 0.5, playing: true }, details).frame
          ?.players[0].x
      ).toBe(50)
      expect(
        session.sample({ frames, position: 1, playing: false }, details).frame
          ?.players[0].x
      ).toBe(80)
    }
  )
  it("caches only two projected frames and releases them on source reset", () => {
    const frames = Array.from({ length: 1000 }, (_, i) => frame(i, i % 30)),
      session = new ArchiveMotionSession()
    for (let i = 0; i < frames.length; i++) {
      session.sample({ frames, position: i, playing: true }, details)
      expect(session.cacheSize).toBeLessThanOrEqual(2)
    }
    session.sample({ frames: [], position: 0, playing: false }, details)
    expect(session.cacheSize).toBe(0)
  })
  it("supports repeated subscriptions and clears archive references on disposal", () => {
    const source = new ReplayMotionSource(),
      receive = vi.fn(),
      frames = [frame(0, 0), frame(1, 1)]
    source.setFrames(frames)
    for (let i = 0; i < 100; i++) {
      const unsubscribe = source.subscribe(receive)
      expect(source.subscriberCount).toBe(1)
      source.seek(0)
      unsubscribe()
      expect(source.subscriberCount).toBe(0)
    }
    source.clear()
    expect(source.getSnapshot().frames).toHaveLength(0)
    expect(receive).toHaveBeenCalledTimes(100)
  })
  it("shows a paused archive immediately and honors reduced motion", () => {
    const source = new ReplayMotionSource(),
      session = new ArchiveMotionSession()
    source.setFrames([frame(0, 0), frame(1, 10)])
    expect(session.sample(source.getSnapshot(), details)).toMatchObject({
      status: "paused",
      frame: { tick: 0 },
    })
    source.seek(0.5)
    expect(
      session.sample(source.getSnapshot(), details, true).frame?.players[0].x
    ).toBe(50)
  })
})
