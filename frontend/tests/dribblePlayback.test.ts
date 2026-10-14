import { describe, expect, it } from "vitest"

import type { RealtimeFrame, RealtimePlayer } from "@/api/realtimeMatch"
import { buildDribblePlayback } from "@/components/tactical/playback/builders/dribblePlayback"
import {
  buildShotChainPlayback,
  isShotChainPlaybackTrigger,
  shotChainPlaybackTickRange,
} from "@/components/tactical/playback/builders/shotChainPlayback"
import {
  interpolateMotionBall,
  interpolateMotionPlayer,
} from "@/components/tactical/shared/core/interpolation"
import type { TacticalMotionPlayer } from "@/components/tactical/shared/core/types"
import type { ShotChain } from "@/components/tactical/tacticalScene"
import type { MatchPlayer, TacticalEventPoint } from "@/types/match"

const event = {
  id: "dribble-1",
  metricId: "dribblesCompleted",
  playerId: 7,
  team: "home",
  tick: 10,
  completionTick: 99,
  flags: 0,
  trajectoryStartX: 35,
  trajectoryStartY: 37.5,
  endX: 25,
  endY: 32.5,
} as TacticalEventPoint

describe("buildDribblePlayback", () => {
  it("identifies goalkeepers by tactical assignment, with metadata position as fallback", () => {
    const players = new Map<number, MatchPlayer>([
      [
        7,
        {
          id: 7,
          position: "ST",
          inPossession: { position: "GK" },
        } as MatchPlayer,
      ],
      [8, { id: 8, position: "GK" } as MatchPlayer],
    ])
    const playback = buildDribblePlayback(
      event,
      [8, 9, 10, 11, 12].map((tick) => frame(tick)),
      players
    )
    expect(
      playback?.frames[0].players.map((player) => player.isGoalkeeper)
    ).toEqual([true, true])
    players.set(7, {
      id: 7,
      position: "GK",
      inPossession: { position: "ST" },
    } as MatchPlayer)
    const outfieldPlayback = buildDribblePlayback(
      event,
      [8, 9, 10, 11, 12].map((tick) => frame(tick)),
      players
    )
    expect(outfieldPlayback?.frames[0].players[0].isGoalkeeper).toBe(false)
  })

  it("selects the event tick range and transforms coordinates and angles", () => {
    const frames = [8, 9, 10, 11, 12].map((tick) => frame(tick))
    const players = new Map<number, MatchPlayer>([
      [7, { id: 7, shirtNumber: 9 } as MatchPlayer],
    ])

    const playback = buildDribblePlayback(event, frames, players)

    expect(playback?.frames.map((item) => item.tick)).toEqual([9, 10, 11])
    expect(playback?.frames[0].players[0]).toMatchObject({
      playerId: 7,
      shirtNumber: 9,
      x: 35,
      y: 37.5,
      angleDegrees: 0,
    })
    expect(playback?.frames[0].players[0].velocityXPerTick).toBeCloseTo(0)
    expect(playback?.frames[0].players[0].velocityYPerTick).toBeCloseTo(-1)
    expect(playback?.frames[0].ball).toMatchObject({
      x: 35,
      y: 37.5,
      zCentimeters: 25,
    })
    expect(
      playback?.frames[0].players.find((player) => player.playerId === 8)
    ).toMatchObject({ angleDegrees: 0 })
    expect(playback?.frames[2].players[0]).toMatchObject({
      x: 25,
      y: 32.5,
      angleDegrees: 0,
    })
  })

  it("applies the same 180 degree pitch transform to position and angle", () => {
    const playback = buildDribblePlayback(
      {
        ...event,
        flags: 0x100,
        trajectoryStartX: 65,
        trajectoryStartY: 62.5,
        endX: 75,
        endY: 67.5,
      },
      [8, 9, 10, 11, 12].map((tick) => frame(tick)),
      new Map()
    )

    expect(playback?.frames[0].players[0]).toMatchObject({
      x: 65,
      y: 62.5,
      angleDegrees: 180,
    })
    expect(playback?.frames[0].players[0].velocityXPerTick).toBeCloseTo(0)
    expect(playback?.frames[0].players[0].velocityYPerTick).toBeCloseTo(1)
  })

  it("preserves raw held coordinates for adjacent-frame interpolation", () => {
    const heldFrames = [
      heldFrame(8, 10, 20),
      heldFrame(9, 10, 20),
      heldFrame(10, 10, 20),
      heldFrame(11, 20, 40),
    ]
    const playback = buildDribblePlayback(
      {
        ...event,
        tick: 9,
        trajectoryStartX: 40,
        trajectoryStartY: 40,
        endX: 30,
        endY: 30,
      },
      heldFrames,
      new Map()
    )

    expect(playback?.frames.map((item) => item.tick)).toEqual([8, 9, 10, 11])
    const xPositions = playback?.frames.map((item) => item.players[0].x)
    expect(xPositions?.[0]).toBeCloseTo(40)
    expect(xPositions?.[1]).toBeCloseTo(40)
    expect(xPositions?.[2]).toBeCloseTo(40)
    expect(xPositions?.[3]).toBeCloseTo(30)
    const ballXPositions = playback?.frames.map((item) => item.ball?.x)
    expect(ballXPositions?.[0]).toBeCloseTo(40)
    expect(ballXPositions?.[1]).toBeCloseTo(40)
    expect(ballXPositions?.[2]).toBeCloseTo(40)
    expect(ballXPositions?.[3]).toBeCloseTo(30)
  })

  it("interpolates positions linearly and absolute angles across zero", () => {
    const current = playbackPlayer({
      x: 0,
      angleDegrees: 350,
      velocityXPerTick: 20,
    })
    const next = playbackPlayer({
      x: 10,
      angleDegrees: 10,
      velocityXPerTick: 0,
    })

    const midpoint = interpolateMotionPlayer(current, next, 0.5)

    expect(midpoint.x).toBeCloseTo(5)
    expect(midpoint.angleDegrees).toBeCloseTo(0)
  })

  it("keeps an unavailable angle distinct from a real zero-degree angle", () => {
    const frames = [8, 9, 10, 11, 12].map((tick) => {
      const result = frame(tick)
      result.players[0].angleDegrees = undefined
      return result
    })

    const playback = buildDribblePlayback(event, frames, new Map())

    expect(playback?.frames[0].players[0].angleDegrees).toBeUndefined()
    expect(playback?.frames[0].players[1].angleDegrees).toBe(0)
    expect(
      interpolateMotionPlayer(
        playbackPlayer({ angleDegrees: undefined }),
        playbackPlayer({ angleDegrees: 0 }),
        0.5
      ).angleDegrees
    ).toBeUndefined()
  })

  it("interpolates the football position and height between ticks", () => {
    expect(
      interpolateMotionBall(
        { x: 20, y: 30, zCentimeters: 0 },
        { x: 40, y: 50, zCentimeters: 100 },
        0.25
      )
    ).toEqual({ x: 25, y: 35, zCentimeters: 25 })
  })

  it("rejects events without usable trajectory endpoints", () => {
    expect(
      buildDribblePlayback(
        {
          ...event,
          trajectoryStartX: undefined,
          trajectoryStartY: undefined,
          endX: undefined,
          endY: undefined,
        },
        [frame(10), frame(11)],
        new Map()
      )
    ).toBeNull()
  })
})

describe("buildShotChainPlayback", () => {
  const chain = {
    id: "shot-chain-shot-1",
    shotEventId: "shot-1",
    team: "home",
    events: [
      {
        ...event,
        id: "pass-1",
        metricId: "passesCompleted",
        nativeEventType: 6,
        tick: 9,
        completionTick: 10,
      },
      {
        ...event,
        id: "shot-1",
        metricId: "shotsOnTarget",
        nativeEventType: 2,
        tick: 11,
        completionTick: 12,
      },
    ],
  } as ShotChain

  it("plays every captured frame from the earliest action through shot completion", () => {
    const playback = buildShotChainPlayback(
      chain,
      [8, 9, 10, 11, 12, 13].map((tick) => frame(tick)),
      new Map()
    )

    expect(playback?.id).toBe(chain.id)
    expect(playback?.frames.map((item) => item.tick)).toEqual([9, 10, 11, 12])
    expect(playback?.trail).toEqual({ target: "ball" })
    expect(playback?.frames[0].ball).toMatchObject({
      x: 35,
      y: 37.5,
      zCentimeters: 25,
    })
  })

  it("only lets the earliest expanded event trigger playback", () => {
    expect(isShotChainPlaybackTrigger(chain, "pass-1")).toBe(true)
    expect(isShotChainPlaybackTrigger(chain, "shot-1")).toBe(false)
  })

  it("falls back to the shot tick when completion precedes the shot", () => {
    expect(
      shotChainPlaybackTickRange({
        ...chain,
        events: [chain.events[0], { ...chain.events[1], completionTick: 0 }],
      })
    ).toEqual({ startTick: 9, endTick: 11 })
  })
})

function frame(tick: number): RealtimeFrame {
  const step = tick - 8
  return {
    tick,
    period: 1,
    ballXCentimeters: (10 + step * 2.5) * 100,
    ballYCentimeters: (20 + step * 10) * 100,
    ballZCentimeters: 25,
    halfPitchWidth: 50,
    halfPitchLength: 100,
    players: [
      {
        playerId: 7,
        team: "home",
        isOnPitch: true,
        x: 10 + step * 2.5,
        y: 20 + step * 10,
        speedCentimetersPerSecond: 400,
        angleDegrees: 90,
      } as RealtimePlayer,
      {
        playerId: 8,
        team: "away",
        isOnPitch: true,
        x: -10,
        y: -20,
        speedCentimetersPerSecond: 400,
        angleDegrees: 90,
      } as RealtimePlayer,
    ],
  } as RealtimeFrame
}

function heldFrame(tick: number, x: number, y: number): RealtimeFrame {
  return {
    tick,
    period: 1,
    ballXCentimeters: x * 100,
    ballYCentimeters: y * 100,
    ballZCentimeters: 0,
    halfPitchWidth: 50,
    halfPitchLength: 100,
    players: [
      {
        playerId: 7,
        team: "home",
        isOnPitch: true,
        x,
        y,
        speedCentimetersPerSecond: 0,
        angleDegrees: 0,
      } as RealtimePlayer,
    ],
  } as RealtimeFrame
}

function playbackPlayer(
  overrides: Partial<TacticalMotionPlayer>
): TacticalMotionPlayer {
  return {
    playerId: 7,
    team: "home",
    x: 0,
    y: 0,
    angleDegrees: 0,
    velocityXPerTick: 0,
    velocityYPerTick: 0,
    ...overrides,
  }
}
