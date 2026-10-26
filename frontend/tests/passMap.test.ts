import { describe, expect, it } from "vitest"

import {
  buildPassMap,
  isOpenPlayPass,
  passMapEdgesForPlayer,
  passMapFrequencyThresholds,
  passMapFrequencyTier,
} from "@/api/passMap"
import type { MatchPlayer, TacticalEventPoint } from "@/types/match"

const players = [
  { id: 1, team: "home", isOnPitch: true },
  { id: 2, team: "home", isOnPitch: true },
  { id: 3, team: "home", isOnPitch: false },
  { id: 4, team: "away", isOnPitch: true },
] as MatchPlayer[]

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
      { playerId: 2, x: 50, y: 30, attempts: 1, completed: 1, successRate: 100 },
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

    expect(buildPassMap(events, players, "home", "half", 80).nodes[0].attempts).toBe(2)
    expect(buildPassMap(events, players, "home", "recent15", 80).nodes[0].attempts).toBe(1)
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
