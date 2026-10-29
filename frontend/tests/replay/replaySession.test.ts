import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/teamColors", () => ({
  selectTeamThemeColors: () => ({
    home: { light: "#fff", dark: "#000" },
    away: { light: "#fff", dark: "#000" },
  }),
}))

import { buildHeatmapSnapshot } from "@/api/heatmap"
import {
  buildMatchEvents,
  buildMomentumTimeline,
  buildRollingMomentumTimeline,
  buildTacticalEvents,
  buildXgTimeline,
  RatingContributionResolverCache,
  toMatchSnapshot,
} from "@/api/realtimeMatch"
import { preprocessReplayArchive } from "@/api/replay/replayPreprocessor"
import {
  buildInitialReplaySnapshot,
  ReplaySession,
  replayFrameIndexAtPercent,
} from "@/api/replay/replaySession"
import { frame, replayFixture } from "./replayTestFixtures"
import type { RealtimeRatingInputs } from "@/api/realtimeMatch"

function wireRatingInputs(overrides: Partial<RealtimeRatingInputs> = {}): RealtimeRatingInputs {
  const packed = new Uint8Array(36)
  packed[35] = 12
  return {
    statsPacked: btoa(String.fromCharCode(...packed)),
    internalW25: 0, internalW24: 0,
    specialW2C: 0, specialW2D: 0, specialW2E: 0,
    specialW2F: 0, specialW30: 0, specialW31: 0,
    rawInternalRating: 6700,
    specialConditionA: 0, specialConditionB: 0,
    inPossessionRoleDuty: "128", outOfPossessionRoleDuty: "0",
    totalEligibleDuration: 100,
    ratingEventsCommonLength: 0, ratingEventsTail: [],
    ...overrides,
  }
}

describe("ReplaySession", () => {
  it("keeps server archive ratings and sprints through bootstrap, playback and backward seek", async () => {
    const fixture = replayFixture()
    fixture.frames = fixture.frames.slice(0, 3)
    fixture.frames.forEach((current, index) => {
      const packed = new Uint8Array(36)
      packed[35] = index * 3
      current.ratingModel = {
        ratingBaseCondition: 0, matchPhase: 0, eventRewardBranch: 0,
        activeBaseline: 6700, homeBackgroundInput: 0, awayBackgroundInput: 0,
      }
      current.players[0].shots = index
      current.players[0].ratingInputs = wireRatingInputs({ statsPacked: btoa(String.fromCharCode(...packed)) })
    })
    const original = structuredClone(fixture.frames)
    const weights = Array<number>(52).fill(0)
    weights[10] = 100
    const archive = await preprocessReplayArchive({
      ...fixture, ratingConfiguration: { weightsByCategoryBit: new Map([[7, weights]]) },
    }, { batchSize: 1 })
    const initial = buildInitialReplaySnapshot(archive).players[0]
    expect(initial.stats.sprints).toBe(0)
    expect(initial.ratingContribution?.groupContributionsPreFactor.Shooting).toBe(0)
    const session = new ReplaySession(archive, { checkpointInterval: 2 })
    for (const index of [0, 1, 2, 1, 0]) {
      const player = session.seek(index).players[0]
      expect(player.stats.sprints).toBe(index * 3)
      expect(player.ratingContribution?.groupContributionsPreFactor.Shooting).toBe(index * 100)
    }
    expect(archive.frames[0].players[0].ratingInputs).toBeUndefined()
    expect(archive.frames[0].players[0].archiveRatingInputs).toBeDefined()
    expect(fixture.frames).toEqual(original)
  })

  it("hydrates server event deltas and role history across preprocessing batches", async () => {
    const fixture = replayFixture()
    fixture.frames = fixture.frames.slice(0, 2)
    const firstEvent = new Uint8Array(16)
    firstEvent[0] = 1
    const secondEvent = new Uint8Array(16)
    secondEvent[0] = 2
    fixture.frames[0].players[0].ratingInputs = wireRatingInputs({
      ratingEventsTail: [btoa(String.fromCharCode(...firstEvent))],
    })
    fixture.frames[1].players[0].ratingInputs = wireRatingInputs({
      totalEligibleDuration: 175, inPossessionRoleDuty: "512", outOfPossessionRoleDuty: "1024",
      ratingEventsCommonLength: 1, ratingEventsTail: [btoa(String.fromCharCode(...secondEvent))],
    })
    const archive = await preprocessReplayArchive(fixture, { batchSize: 1 })
    const inputs = archive.frames[1].players[0].archiveRatingInputs!
    expect(inputs.ratingEvents).toEqual([firstEvent, secondEvent])
    expect(inputs.classificationDurations).toEqual([
      { categoryBit: 7, duration: 100 }, { categoryBit: 9, duration: 75 },
    ])
  })

  it("does not carry rating history into a replacement player in the same slot", async () => {
    const fixture = replayFixture()
    fixture.frames = fixture.frames.slice(0, 2)
    fixture.frames[0].players[0].ratingInputs = wireRatingInputs()
    fixture.frames[1].players[0].playerId = 999
    fixture.frames[1].players[0].ratingInputs = wireRatingInputs({
      inPossessionRoleDuty: "512", totalEligibleDuration: 175,
    })
    const archive = await preprocessReplayArchive(fixture)
    expect(archive.frames[1].players[0].archiveRatingInputs!.classificationDurations)
      .toEqual([{ categoryBit: 9, duration: 175 }])
  })

  it("leaves legacy replay rating breakdown and sprint counts unavailable", async () => {
    const fixture = replayFixture()
    const archive = await preprocessReplayArchive(fixture)
    const session = new ReplaySession(archive)
    const player = session.advanceTo(1).players[0]
    expect(player.ratingContribution).toBeUndefined()
    expect(player.resolveRatingContribution?.()).toBeUndefined()
    expect(player.stats.sprints).toBeUndefined()
  })

  it("defers live contribution work and reuses the resolver for unchanged inputs", () => {
    const current = frame(0)
    const weights = Array<number>(52).fill(0)
    weights[10] = 100
    current.ratingModel = {
      ratingBaseCondition: 0, matchPhase: 0, eventRewardBranch: 0,
      activeBaseline: 6_700, homeBackgroundInput: 0, awayBackgroundInput: 0,
    }
    current.players[0].shots = 2
    current.players[0].archiveRatingInputs = {
      statsPacked: new Uint8Array(36),
      internalW25: 0, internalW24: 0,
      specialW2C: 0, specialW2D: 0, specialW2E: 0,
      specialW2F: 0, specialW30: 0, specialW31: 0,
      internalScore: 6_900,
      specialConditionA: 0, specialConditionB: 0,
      inPossessionRoleDuty: 0x80n, outOfPossessionRoleDuty: 0n,
      totalEligibleDuration: 10_800,
      classificationDurations: [{ categoryBit: 7, duration: 10_800 }],
      qualityFlags: [], ratingEvents: [],
    }
    const packed = current.players[0].archiveRatingInputs!.statsPacked
    const confirmedStats = { penaltyAttempts: 4, blocks: 5, penaltiesFaced: 6, penaltiesSaved: 7, yellowCards: 9, redCards: 10, openPlayKeyPasses: 11, possessionWon: 15, goalsConceded: 20, chancesCreated: 8, offsides: 21, headersLost: 22, possessionLost: 23, pressesAttempted: 24, pressesWon: 25, shotsOutsideBox: 34, sprints: 35 } as const
    Object.values(confirmedStats).forEach((index) => { packed[index] = index + 1 })
    new DataView(packed.buffer).setFloat32(0, 0.375, true)
    current.players[0].progressivePasses = 9
    const configuration = {
      weightsByCategoryBit: new Map([[7, weights]]),
    }
    const cache = new RatingContributionResolverCache()
    const first = toMatchSnapshot(
      current, undefined, undefined, [], undefined, [], [], [], [], [],
      undefined, true, configuration, undefined, cache,
    ).players[0]
    const second = toMatchSnapshot(
      { ...current, tick: 1 }, undefined, undefined, [], undefined, [], [], [], [], [],
      undefined, true, configuration, undefined, cache,
    ).players[0]

    for (const [key, index] of Object.entries(confirmedStats)) {
      expect(first.stats[key as keyof typeof confirmedStats]).toBe(index + 1)
    }
    expect(first.stats.progressivePasses).toBe(9)
    expect(first.stats.openPlayXa).toBe(0.375)
    expect(first.ratingContribution).toBeUndefined()
    expect(first.resolveRatingContribution).toBe(second.resolveRatingContribution)
    const contribution = first.resolveRatingContribution?.()
    expect(contribution?.groupContributionsPreFactor.Shooting).toBe(200)
    expect(second.resolveRatingContribution?.()).toBe(contribution)
  })

  it("recalculates compact archive rating inputs at the selected timeline frame", async () => {
    const fixture = replayFixture()
    fixture.frames = fixture.frames.slice(0, 2)
    const weights = Array<number>(52).fill(0)
    weights[10] = 100
    fixture.frames.forEach((current, index) => {
      const packed = new Uint8Array(36)
      current.players[0].shots = index * 2
      current.ratingModel = {
        ratingBaseCondition: 0,
        matchPhase: 0,
        eventRewardBranch: 0,
        activeBaseline: 6_700,
        homeBackgroundInput: 0,
        awayBackgroundInput: 0,
      }
      current.players[0].ratingInputs = {
        statsPacked: btoa(String.fromCharCode(...packed)),
        internalW25: 0,
        internalW24: 0,
        specialW2C: 0,
        specialW2D: 0,
        specialW2E: 0,
        specialW2F: 0,
        specialW30: 0,
        specialW31: 0,
        rawInternalRating: index === 0 ? 6_700 : 6_900,
        specialConditionA: 0,
        specialConditionB: 0,
        inPossessionRoleDuty: "128",
        outOfPossessionRoleDuty: "0",
        totalEligibleDuration: 10_800,
        ratingEventsCommonLength: 0,
        ratingEventsTail: [],
      }
    })
    const archive = await preprocessReplayArchive({
      ...fixture,
      ratingConfiguration: {
        weightsByCategoryBit: new Map([[7, weights]]),
      },
    })
    const session = new ReplaySession(archive, {
      checkpointInterval: 1,
      maxCheckpoints: 2,
    })

    expect(archive.frames.every((frame) =>
      frame.players.every((player) => player.ratingContribution == null)
    )).toBe(true)

    const before = session.advanceTo(0).players[0].ratingContribution
    const after = session.advanceTo(1).players[0].ratingContribution
    const rewound = session.seek(0).players[0].ratingContribution

    expect(before?.groupContributionsPreFactor.Shooting).toBe(0)
    expect(after?.groupContributionsPreFactor.Shooting).toBe(200)
    expect(after?.predictedInternalScore).toBe(6_900)
    expect(rewound?.groupContributionsPreFactor.Shooting).toBe(0)
    expect(rewound).toBe(before)
  })

  it("matches the legacy derivation builders at every frame", async () => {
    const fixture = replayFixture()
    const archive = await preprocessReplayArchive(fixture, { batchSize: 2 })
    const session = new ReplaySession(archive, {
      checkpointInterval: 2,
      maxCheckpoints: 3,
    })

    for (let index = 0; index < fixture.frames.length; index += 1) {
      const snapshot = session.advanceTo(index)
      expect(snapshot.xgTimeline).toEqual(
        buildXgTimeline(fixture.frames, index)
      )
      expect(snapshot.events).toEqual(buildMatchEvents(fixture.frames, index))
      expect(snapshot.tacticalEvents).toEqual(
        buildTacticalEvents(fixture.frames, index)
      )
      expect(snapshot.momentum).toEqual(
        buildMomentumTimeline(fixture.frames, index)
      )
      expect(snapshot.rollingMomentum).toEqual(
        buildRollingMomentumTimeline(fixture.frames, index)
      )
      expect(snapshot.heatmaps).toEqual(
        buildHeatmapSnapshot(fixture.frames, index)
      )
    }
    const finalSnapshot = session.advanceTo(fixture.frames.length - 1)
    expect(session.advanceTo(fixture.frames.length - 1)).toBe(finalSnapshot)
    expect(session.processedFrameCount).toBe(fixture.frames.length)
    expect(
      archive.frames.every((frame) => frame.momentumEvents.length === 0)
    ).toBe(true)
  })

  it("replaces a native event revision instead of duplicating it", async () => {
    const fixture = replayFixture()
    const archive = await preprocessReplayArchive(fixture)
    const session = new ReplaySession(archive)
    const snapshot = session.advanceTo(2)

    expect(snapshot.tacticalEvents).toHaveLength(1)
    expect(snapshot.tacticalEvents[0].receiverPlayerId).toBe(102)
    expect(snapshot.tacticalEvents[0].trajectoryPoints).toHaveLength(2)

    const afterBufferRotation = session.advanceTo(4)
    expect(afterBufferRotation.tacticalEvents.map((event) => event.id)).toEqual(
      ["fixture-native-momentum-1", "fixture-native-momentum-2"]
    )
    expect(afterBufferRotation.momentum).toHaveLength(5)
    expect(afterBufferRotation.rollingMomentum).toHaveLength(5)

    const afterTransientEmptyBuffer = session.advanceTo(5)
    expect(afterTransientEmptyBuffer.tacticalEvents).toBe(
      afterBufferRotation.tacticalEvents
    )
    expect(afterTransientEmptyBuffer.momentum).toBe(
      afterBufferRotation.momentum
    )
    expect(afterTransientEmptyBuffer.rollingMomentum).toBe(
      afterBufferRotation.rollingMomentum
    )
  })

  it("restores bounded checkpoints for repeated backward and forward seeks", async () => {
    const fixture = replayFixture()
    const archive = await preprocessReplayArchive(fixture)
    const session = new ReplaySession(archive, {
      checkpointInterval: 1,
      maxCheckpoints: 3,
    })

    for (const index of [0, 3, 1, 2, 0, 3]) {
      const snapshot = session.seek(index)
      expect(snapshot.events).toEqual(buildMatchEvents(fixture.frames, index))
      expect(snapshot.tacticalEvents).toEqual(
        buildTacticalEvents(fixture.frames, index)
      )
      expect(session.checkpointCount).toBeLessThanOrEqual(3)
    }
  })

  it("uses capturedTick metadata and tick-based slider lookup", async () => {
    const fixture = replayFixture()
    const archive = await preprocessReplayArchive(fixture)
    const session = new ReplaySession(archive)

    expect(session.advanceTo(1).home.name).toBe("Home")
    expect(session.advanceTo(2).home.name).toBe("Updated Home")
    expect(replayFrameIndexAtPercent(new Int32Array([0, 100, 500]), 50)).toBe(1)
  })

  it("preserves goalkeeper save breakdowns in player statistics", async () => {
    const fixture = replayFixture()
    fixture.frames[0].players[0].savesHeld = 2
    fixture.frames[0].players[0].savesParried = 1
    fixture.frames[0].players[0].savesTipped = 3
    const archive = await preprocessReplayArchive(fixture)
    const snapshot = new ReplaySession(archive).advanceTo(0)

    expect(snapshot.players[0].stats).toMatchObject({
      savesHeld: 2,
      savesParried: 1,
      savesTipped: 3,
    })
  })

  it("uses shirt identity for display while retaining full and squad identity", async () => {
    const fixture = replayFixture()
    const archive = await preprocessReplayArchive(fixture)
    const player = new ReplaySession(archive).advanceTo(0).players[0]

    expect(player).toMatchObject({
      name: "SCORER",
      shirtName: "SCORER",
      fullName: "Sample Player",
      shirtNumber: 9,
      squadNumber: 255,
    })
  })

  it("does not expose localhost asset URLs when local access is disabled", async () => {
    const fixture = replayFixture()
    fixture.metadata.home.clubUid = 11
    fixture.metadata.away.clubUid = 22
    fixture.metadata.players[0].uid = 101
    const archive = await preprocessReplayArchive(fixture)

    const blocked = new ReplaySession(archive, { allowLocalAssets: false })
    const blockedSnapshot = blocked.advanceTo(0)
    expect(blockedSnapshot.home.logoUrl).toBeUndefined()
    expect(blockedSnapshot.away.logoUrl).toBeUndefined()
    expect(blockedSnapshot.players[0].portraitUrl).toBeUndefined()

    const allowed = new ReplaySession(archive)
    const allowedSnapshot = allowed.advanceTo(0)
    expect(allowedSnapshot.home.logoUrl).toContain("127.0.0.1")
    expect(allowedSnapshot.away.logoUrl).toContain("127.0.0.1")
    expect(allowedSnapshot.players[0].portraitUrl).toContain("127.0.0.1")
  })

  it("preserves render-facing references until their values change", async () => {
    const fixture = replayFixture()
    fixture.frames = [frame(0), frame(1), frame(2, { homeXg: 0.1 })]
    fixture.summary = {
      ...fixture.summary,
      frameCount: fixture.frames.length,
      lastTick: fixture.frames.at(-1)?.tick ?? 0,
    }
    const archive = await preprocessReplayArchive(fixture)
    const session = new ReplaySession(archive)

    const first = session.advanceTo(0)
    const unchanged = session.advanceTo(1)
    expect(unchanged).not.toBe(first)
    expect(unchanged.clock).not.toBe(first.clock)
    expect(unchanged.home).toBe(first.home)
    expect(unchanged.away).toBe(first.away)
    expect(unchanged.players).toBe(first.players)
    expect(unchanged.xgTimeline).toBe(first.xgTimeline)
    expect(unchanged.events).toBe(first.events)
    expect(unchanged.xgShots).toBe(first.xgShots)
    expect(unchanged.heatmaps).not.toBe(first.heatmaps)
    expect(unchanged.heatmaps.revision).toBe(first.heatmaps.revision + 1)

    const changed = session.advanceTo(2)
    expect(changed.xgTimeline).not.toBe(unchanged.xgTimeline)
    expect(changed.home).not.toBe(unchanged.home)
    expect(changed.players).toBe(unchanged.players)
    expect(changed.events).toBe(unchanged.events)
  })

  it("matches a shot event to team and player xG deltas", async () => {
    const fixture = replayFixture()
    const shot = {
      ...fixture.frames[1].momentumEvents[0],
      eventIndex: 42,
      sequenceIndex: 42,
      eventType: 4,
      tick: 40,
      playerId: 101,
      playerSlot: 1,
    }
    fixture.frames = [
      frame(0),
      frame(40, { homeXg: 0.36, momentumEvents: [shot] }),
    ]
    fixture.frames[1].home.shots = 1
    fixture.frames[1].players[0].shots = 1
    fixture.frames[1].players[0].xg = 0.36
    fixture.summary = {
      ...fixture.summary,
      frameCount: fixture.frames.length,
      lastTick: 40,
    }

    const archive = await preprocessReplayArchive(fixture)
    const snapshot = new ReplaySession(archive).advanceTo(1)

    expect(snapshot.xgShots).toEqual([
      expect.objectContaining({
        id: "fixture-native-momentum-42",
        eventIndex: 42,
        team: "home",
        playerId: 101,
        xg: 0.36,
        metricId: "shotsOnTarget",
        confidence: "exact",
      }),
    ])
  })

  it("keeps one shot when its native buffer eventIndex relocates", async () => {
    const fixture = replayFixture()
    const shot = {
      ...fixture.frames[1].momentumEvents[0],
      eventIndex: 50,
      sequenceIndex: 100,
      eventType: 4,
      tick: 40,
      playerId: 101,
      playerSlot: 1,
    }
    const relocated = { ...shot, eventIndex: 51 }
    const revised = { ...relocated, eventType: 1 }
    fixture.frames = [
      frame(0),
      frame(40, { homeXg: 0.2, momentumEvents: [shot] }),
      frame(60, { homeXg: 0.2, momentumEvents: [relocated] }),
      frame(80, { homeXg: 0.2, momentumEvents: [revised] }),
    ]
    for (const current of fixture.frames.slice(1)) {
      current.home.shots = 1
      current.players[0].shots = 1
      current.players[0].xg = 0.2
    }
    fixture.summary = {
      ...fixture.summary,
      frameCount: fixture.frames.length,
      lastTick: 80,
    }

    const archive = await preprocessReplayArchive(fixture)
    const snapshot = new ReplaySession(archive).advanceTo(3)

    expect(snapshot.xgShots).toEqual([
      expect.objectContaining({
        id: "fixture-native-momentum-100",
        eventIndex: 51,
        xg: 0.2,
        metricId: "goals",
      }),
    ])
  })

  it("keeps distinct shots when a native eventIndex is reused", async () => {
    const fixture = replayFixture()
    const firstShot = {
      ...fixture.frames[1].momentumEvents[0],
      eventIndex: 50,
      sequenceIndex: 100,
      eventType: 4,
      tick: 40,
      playerId: 101,
      playerSlot: 1,
    }
    const secondShot = {
      ...firstShot,
      sequenceIndex: 101,
      eventType: 5,
      tick: 200,
    }
    fixture.frames = [
      frame(0),
      frame(40, { homeXg: 0.2, momentumEvents: [firstShot] }),
      frame(200, { homeXg: 0.5, momentumEvents: [secondShot] }),
    ]
    fixture.frames[1].home.shots = 1
    fixture.frames[1].players[0].shots = 1
    fixture.frames[1].players[0].xg = 0.2
    fixture.frames[2].home.shots = 2
    fixture.frames[2].players[0].shots = 2
    fixture.frames[2].players[0].xg = 0.5
    fixture.summary = {
      ...fixture.summary,
      frameCount: fixture.frames.length,
      lastTick: 200,
    }

    const archive = await preprocessReplayArchive(fixture)
    const snapshot = new ReplaySession(archive).advanceTo(2)

    expect(snapshot.xgShots).toEqual([
      expect.objectContaining({
        id: "fixture-native-momentum-100",
        eventIndex: 50,
        xg: 0.2,
      }),
      expect.objectContaining({
        id: "fixture-native-momentum-101",
        eventIndex: 50,
        xg: 0.3,
      }),
    ])
  })

  it("resolves a delayed shot event without scanning by eventIndex", async () => {
    const fixture = replayFixture()
    const shot = {
      ...fixture.frames[1].momentumEvents[0],
      eventIndex: 60,
      sequenceIndex: 120,
      eventType: 2,
      tick: 40,
      playerId: 101,
      playerSlot: 1,
    }
    fixture.frames = [
      frame(0),
      frame(40, { homeXg: 0.24 }),
      frame(80, { homeXg: 0.24, momentumEvents: [shot] }),
    ]
    for (const current of fixture.frames.slice(1)) {
      current.home.shots = 1
      current.players[0].shots = 1
      current.players[0].xg = 0.24
    }
    fixture.summary = {
      ...fixture.summary,
      frameCount: fixture.frames.length,
      lastTick: 80,
    }

    const archive = await preprocessReplayArchive(fixture)
    const snapshot = new ReplaySession(archive).advanceTo(2)

    expect(snapshot.xgShots).toEqual([
      expect.objectContaining({
        id: "fixture-native-momentum-120",
        eventIndex: 60,
        xg: 0.24,
      }),
    ])
  })

  it("restores xG shots without duplicates after backward seeks", async () => {
    const fixture = replayFixture()
    const shot = {
      ...fixture.frames[1].momentumEvents[0],
      eventIndex: 43,
      sequenceIndex: 43,
      eventType: 2,
      tick: 40,
      playerId: 101,
      playerSlot: 1,
    }
    fixture.frames = [
      frame(0),
      frame(40, { homeXg: 0.2, momentumEvents: [shot] }),
      frame(80, { homeXg: 0.2, momentumEvents: [shot] }),
    ]
    for (const current of fixture.frames.slice(1)) {
      current.home.shots = 1
      current.players[0].shots = 1
      current.players[0].xg = 0.2
    }
    fixture.summary = {
      ...fixture.summary,
      frameCount: fixture.frames.length,
      lastTick: 80,
    }
    const archive = await preprocessReplayArchive(fixture)
    const session = new ReplaySession(archive, {
      checkpointInterval: 1,
      maxCheckpoints: 3,
    })

    const original = session.advanceTo(2).xgShots
    session.seek(0)
    const replayed = session.advanceTo(2).xgShots
    expect(replayed).toEqual(original)
    expect(replayed).toHaveLength(1)
  })
})
