import { describe, expect, it } from "vitest"
import {
  reportLineup,
  substitutePlayed,
} from "@/features/match-report/reportLineup"
import { getPlayerMatchStatuses } from "@/lib/playerMatchStatus"
import { buildTimelineEvents } from "@/lib/matchTimelineEvents"
import type { MatchPlayer, MatchSnapshot } from "@/types/match"

const t = (key: string) => key
function player(id: number, changes: Partial<MatchPlayer> = {}): MatchPlayer {
  return {
    id,
    name: `Player ${id}`,
    team: "home",
    isStarter: true,
    isOnPitch: true,
    stats: { goals: 0, assists: 0 },
    ...changes,
  } as MatchPlayer
}
function match(players: MatchPlayer[]): MatchSnapshot {
  return {
    players,
    events: [],
    formationSnapshots: [],
  } as unknown as MatchSnapshot
}

describe("report starting lineup", () => {
  it("restores initial roles and substituted starters while retaining final counters", () => {
    const assignment = {
      position: "ST",
      positionMask: 16384,
      role: "Forward",
      roleAbbreviation: "AF",
      roleDuty: "A",
    }
    const first = player(1, {
      inPossession: assignment,
      outOfPossession: assignment,
    })
    const final = player(1, {
      isOnPitch: false,
      inPossession: { ...assignment, position: "MC", positionMask: 1024 },
      stats: { goals: 2, assists: 1 },
      status: { subbedOffMinute: 60 },
    } as Partial<MatchPlayer>)
    const substitute = player(2, {
      isStarter: false,
      status: { subbedOnMinute: 60 },
    })
    const unused = player(3, { isStarter: false, isOnPitch: false })
    const current = match([final, substitute, unused])
    current.formationSnapshots = [
      { tick: 100, minute: 50, players: [final, substitute] },
      { tick: 0, minute: 0, players: [first] },
    ]
    const result = reportLineup(current, "home")
    expect(result.starters).toHaveLength(1)
    expect(result.starters[0].inPossession).toEqual(assignment)
    expect(result.starters[0].stats.goals).toBe(2)
    expect(result.starters[0].status?.subbedOffMinute).toBe(60)
    expect(result.starters[0].isOnPitch).toBe(true)
    expect(result.substitutes.map((value) => value.id)).toEqual([2, 3])
    expect(current.formationSnapshots[0].tick).toBe(100)
    expect(substitutePlayed(substitute)).toBe(true)
    expect(substitutePlayed(unused)).toBe(false)
    expect(
      substitutePlayed({
        ...substitute,
        isOnPitch: false,
        status: { subbedOnMinute: 60, subbedOffMinute: 80 },
      })
    ).toBe(true)
  })

  it("uses starter flags when an older archive has no formation history", () => {
    const current = match([
      player(1, { isOnPitch: false }),
      player(2, { isStarter: false }),
    ])
    expect(
      reportLineup(current, "home").starters.map((value) => value.id)
    ).toEqual([1])
    expect(reportLineup(current, "away").starters).toEqual([])
  })
})

describe("shared squad status and match timeline", () => {
  it("retains goals, assists, cards and substitution markers for off-pitch players", () => {
    const value = player(1, {
      isOnPitch: false,
      stats: { goals: 2, assists: 1 },
      status: { subbedOffMinute: 70 },
    } as Partial<MatchPlayer>)
    const statuses = getPlayerMatchStatuses(
      value,
      [
        { id: "g", type: "goal", playerId: 1, minute: 20 },
        { id: "a", type: "assist_candidate", playerId: 1, minute: 40 },
        { id: "y", type: "yellow_card", playerId: 1, minute: 50 },
        { id: "r", type: "red_card", playerId: 1, minute: 60 },
      ],
      t
    )
    expect(statuses.map((status) => status.icon)).toEqual([
      "sub-off",
      "goal",
      "assist",
      "yellow-card",
      "red-card",
    ])
    expect(statuses.find((status) => status.icon === "goal")?.count).toBe(2)
  })

  it("shares goal-assist grouping and substitution details with MatchTimeline", () => {
    const current = match([
      player(1, { status: { subbedOffMinute: 60 } }),
      player(2, { isStarter: false, status: { subbedOnMinute: 61 } }),
      player(3),
    ])
    current.events = [
      { id: "goal", type: "goal", playerId: 1, team: "home", minute: 20 },
      {
        id: "assist",
        type: "assist_candidate",
        playerId: 3,
        team: "home",
        minute: 20,
      },
    ]
    const events = buildTimelineEvents(current, t)
    expect(
      events.find((event) => event.type === "goal")?.secondaryPeople
    ).toEqual(["Player 3"])
    const substitution = events.find((event) => event.type === "substitution")!
    expect(substitution.primaryPeople).toEqual(["Player 2"])
    expect(substitution.secondaryPeople).toEqual(["Player 1"])
  })
})

describe("report event rows", () => {
  it("keeps simultaneous substitution pairs separate and sorts both teams chronologically", () => {
    const current = match([
      player(1, { name: "Off A", status: { subbedOffMinute: 65 } }),
      player(2, { name: "Off B", status: { subbedOffMinute: 65 } }),
      player(3, {
        name: "On A",
        isStarter: false,
        status: { subbedOnMinute: 65 },
      }),
      player(4, {
        name: "On B",
        isStarter: false,
        status: { subbedOnMinute: 65 },
      }),
      player(5, { team: "away", name: "Away Scorer" }),
      player(6, { team: "away", name: "Away Assistant" }),
    ])
    current.events = [
      { id: "late", type: "red_card", playerId: 1, team: "home", minute: 80 },
      { id: "goal", type: "goal", playerId: 5, team: "away", minute: 45 },
      {
        id: "assist",
        type: "assist_candidate",
        playerId: 6,
        team: "away",
        minute: 45,
      },
    ]
    const rows = buildTimelineEvents(current, t, { groupSimultaneous: false })
    expect(rows.map((event) => event.minute)).toEqual([45, 65, 65, 80])
    expect(rows[0]).toMatchObject({
      team: "away",
      primaryPeople: ["Away Scorer"],
      secondaryPeople: ["Away Assistant"],
    })
    expect(
      rows
        .filter((event) => event.type === "substitution")
        .map((event) => [event.primaryPeople, event.secondaryPeople])
    ).toEqual([
      [["On A"], ["Off A"]],
      [["On B"], ["Off B"]],
    ])
    expect(
      buildTimelineEvents(current, t).filter(
        (event) => event.type === "substitution"
      )
    ).toHaveLength(1)
  })
})
