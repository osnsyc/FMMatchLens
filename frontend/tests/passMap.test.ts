import { describe, expect, it } from "vitest"

import {
  buildPassMap,
  isOpenPlayPass,
  passMapEdgesForPlayer,
  passMapFrequencyThresholds,
  passMapFrequencyTier,
  passMapPlayerIds,
} from "@/api/passMap"
import type { MatchPlayer, TacticalEventPoint } from "@/types/match"

const players = [
  { id: 1, team: "home", isOnPitch: true },
  { id: 2, team: "home", isOnPitch: true },
  { id: 3, team: "home", isOnPitch: false },
  { id: 4, team: "away", isOnPitch: true },
] as MatchPlayer[]

describe("pass map final lineup", () => {
  const lineup = [
    ...Array.from({ length: 11 }, (_, id) => ({
      id,
      team: "home",
      isStarter: true,
      isOnPitch: id > 1,
      position: id === 0 ? "GK" : "CM",
      status:
        id === 0
          ? { subbedOffMinute: 70 }
          : id === 1
            ? { subbedOffMinute: 60 }
            : {},
    })),
    {
      id: 11,
      team: "home",
      isStarter: false,
      isOnPitch: true,
      position: "GK",
      status: { subbedOnMinute: 70 },
    },
    {
      id: 12,
      team: "home",
      isStarter: false,
      isOnPitch: true,
      position: "CM",
      status: { subbedOnMinute: 60 },
    },
    {
      id: 13,
      team: "home",
      isStarter: false,
      isOnPitch: false,
      position: "GK",
      status: {},
    },
    {
      id: 14,
      team: "away",
      isStarter: true,
      isOnPitch: true,
      position: "GK",
      status: {},
    },
  ] as MatchPlayer[]

  it("uses the current lineup before full time", () => {
    expect([...passMapPlayerIds(lineup, "home", 90)]).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ])
  })

  it("selects ten longest-playing outfield players and exactly one goalkeeper", () => {
    const ids = passMapPlayerIds(lineup, "home", 90, true)
    expect(ids.size).toBe(11)
    expect([...ids].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 11 }, (_, id) => id)
    )
    const earlyKeeperChange = lineup.map((player) =>
      player.id === 0
        ? { ...player, status: { subbedOffMinute: 20 } }
        : player.id === 11
          ? { ...player, status: { subbedOnMinute: 20 } }
          : player
    )
    const replaced = passMapPlayerIds(earlyKeeperChange, "home", 120, true)
    expect(replaced.size).toBe(11)
    expect(replaced.has(0)).toBe(false)
    expect(replaced.has(11)).toBe(true)
    expect(replaced.has(13)).toBe(false)
  })
})

function pass(overrides: Partial<TacticalEventPoint> = {}): TacticalEventPoint {
  return {
    id: "pass",
    metricId: "passesCompleted",
    playerId: 1,
    receiverPlayerId: 2,
    team: "home",
    tick: 2_400,
    displayTick: 2_400,
    minute: 10,
    x: 40,
    y: 60,
    nativeEventType: 7,
    flags: 0,
    ...overrides,
  }
}

describe("pass map aggregation", () => {
  it.each(["pass", "receive", "combined"] as const)(
    "orients both teams towards the top in %s mode",
    (mode) => {
      const homeEvents = [
        pass({
          playerId: 1,
          receiverPlayerId: 2,
          x: 10,
          y: 30,
          endX: 80,
          endY: 70,
        }),
        pass({
          playerId: 2,
          receiverPlayerId: 1,
          x: 80,
          y: 70,
          endX: 10,
          endY: 30,
        }),
      ]
      const awayEvents = homeEvents.map((event) => ({
        ...event,
        team: "away" as const,
        x: 100 - event.x,
        y: 100 - event.y,
        endX: 100 - event.endX!,
        endY: 100 - event.endY!,
      }))
      const homePlayers = [
        { id: 1, team: "home", isOnPitch: true },
        { id: 2, team: "home", isOnPitch: true },
      ] as MatchPlayer[]
      const awayPlayers = homePlayers.map((player) => ({
        ...player,
        team: "away" as const,
      }))
      const home = buildPassMap(
        homeEvents,
        homePlayers,
        "home",
        "full",
        20,
        mode
      )
      const away = buildPassMap(
        awayEvents,
        awayPlayers,
        "away",
        "full",
        20,
        mode
      )
      expect(away).toEqual(home)
      expect(home.nodes.find((node) => node.playerId === 1)).toMatchObject({
        x: 30,
        y: 90,
      })
      expect(home.nodes.find((node) => node.playerId === 2)).toMatchObject({
        x: 70,
        y: 20,
      })
    }
  )

  it.each(["pass", "receive", "combined"] as const)(
    "excludes set-piece flags and annotations from all %s data",
    (mode) => {
      const openPlay = [
        pass({ endX: 80, endY: 20 }),
        pass({ playerId: 2, receiverPlayerId: 1, endX: 30, endY: 70 }),
      ]
      const setPieces = [
        ...[0x08, 0x10, 0x20, 0x40, 0x50].map((flags) =>
          pass({ flags, x: 0, y: 0, endX: 100, endY: 100 })
        ),
        ...(
          [
            "corner",
            "attackingFreeKick",
            "defensiveFreeKick",
            "penaltyKick",
          ] as const
        ).map((annotation) =>
          pass({
            annotations: [annotation],
            x: 0,
            y: 0,
            endX: 100,
            endY: 100,
          })
        ),
      ]
      expect(
        buildPassMap(setPieces, players, "home", "full", 20, mode)
      ).toEqual({ nodes: [], edges: [] })
      expect(
        buildPassMap(
          [...openPlay, ...setPieces],
          players,
          "home",
          "full",
          20,
          mode
        )
      ).toEqual(buildPassMap(openPlay, players, "home", "full", 20, mode))
    }
  )

  it("averages valid completed reception endpoints without changing pass stats", () => {
    const events = [
      pass({ endX: 80, endY: 20 }),
      pass({ endX: 60, endY: 40 }),
      pass({ metricId: "passesIncomplete", endX: 100, endY: 100 }),
      pass({ endX: Number.NaN, endY: 50 }),
      pass(),
      pass({ playerId: 2, receiverPlayerId: 1, endX: 30, endY: 70 }),
    ]
    const result = buildPassMap(events, players, "home", "full", 20, "receive")
    expect(result.nodes.find((node) => node.playerId === 2)).toEqual({
      playerId: 2,
      x: 30,
      y: 30,
      attempts: 1,
      completed: 1,
      successRate: 100,
    })
    expect(result.nodes.find((node) => node.playerId === 1)).toMatchObject({
      x: 70,
      y: 70,
      attempts: 5,
      completed: 4,
    })
  })

  it("weights combined positions by samples and includes receive-only players", () => {
    const events = [
      pass({ x: 20, y: 40, endX: 80, endY: 20 }),
      pass({ x: 40, y: 60, endX: 60, endY: 40 }),
    ]
    const received = buildPassMap(
      events,
      players,
      "home",
      "full",
      20,
      "receive"
    )
    expect(received.nodes).toEqual([
      { playerId: 2, x: 30, y: 30, attempts: 0, completed: 0, successRate: 0 },
    ])
    const combined = buildPassMap(
      [
        ...events,
        pass({
          playerId: 2,
          receiverPlayerId: 1,
          x: 50,
          y: 80,
          endX: 90,
          endY: 20,
        }),
      ],
      players,
      "home",
      "full",
      20,
      "combined"
    )
    expect(combined.nodes.find((node) => node.playerId === 1)?.x).toBe(40)
    expect(combined.nodes.find((node) => node.playerId === 1)?.y).toBe(50)
    expect(combined.nodes.find((node) => node.playerId === 2)?.x).toBeCloseTo(
      140 / 3
    )
  })

  it("aggregates open-play passes and averages passer positions", () => {
    const result = buildPassMap(
      [
        pass(),
        pass({
          id: "failed",
          metricId: "passesIncomplete",
          nativeEventType: 8,
          x: 60,
          y: 40,
        }),
        pass({ id: "return", playerId: 2, receiverPlayerId: 1, x: 70, y: 50 }),
      ],
      players,
      "home",
      "full",
      20
    )

    expect(result.nodes).toEqual([
      { playerId: 1, x: 50, y: 50, attempts: 2, completed: 1, successRate: 50 },
      {
        playerId: 2,
        x: 50,
        y: 30,
        attempts: 1,
        completed: 1,
        successRate: 100,
      },
    ])
    expect(result.edges).toEqual([
      { passerId: 1, receiverId: 2, count: 2 },
      { passerId: 2, receiverId: 1, count: 1 },
    ])
  })

  it("excludes set pieces, crosses, other teams, and off-pitch players", () => {
    const setPiece = pass({ annotations: ["attackingFreeKick"] })
    const throwIn = pass({ flags: 0x08 })
    const cross = pass({ nativeEventType: 12, metricId: "crossesCompleted" })
    const offPitch = pass({ playerId: 3 })
    const away = pass({ team: "away", playerId: 4, receiverPlayerId: 1 })

    expect(isOpenPlayPass(setPiece)).toBe(false)
    expect(isOpenPlayPass(throwIn)).toBe(false)
    expect(isOpenPlayPass(cross)).toBe(false)
    expect(
      buildPassMap(
        [setPiece, throwIn, cross, offPitch, away],
        players,
        "home",
        "full",
        20
      )
    ).toEqual({ nodes: [], edges: [] })
  })

  it("keeps only the selected half or latest fifteen minutes", () => {
    const events = [
      pass({ id: "first-half", minute: 40 }),
      pass({ id: "early-second-half", minute: 50 }),
      pass({ id: "recent", minute: 76 }),
      pass({ id: "future", minute: 81 }),
      pass({ id: "receiver", playerId: 2, receiverPlayerId: 1, minute: 76 }),
    ]

    expect(
      buildPassMap(events, players, "home", "half", 80).nodes[0].attempts
    ).toBe(2)
    expect(
      buildPassMap(events, players, "home", "recent15", 80).nodes[0].attempts
    ).toBe(1)
  })
})

describe("pass map frequency tiers", () => {
  it("uses distribution quartiles and filters edges by player", () => {
    const edges = [1, 2, 3, 4, 100].map((count, index) => ({
      passerId: index + 1,
      receiverId: index + 2,
      count,
    }))
    const thresholds = passMapFrequencyThresholds(edges)

    expect(thresholds).toEqual([2, 3, 4])
    expect(passMapFrequencyTier(1, thresholds)).toBe(0)
    expect(passMapFrequencyTier(3, thresholds)).toBe(1)
    expect(passMapFrequencyTier(4, thresholds)).toBe(2)
    expect(passMapFrequencyTier(100, thresholds)).toBe(3)
    expect(passMapEdgesForPlayer(edges, 2)).toHaveLength(2)
  })
})
