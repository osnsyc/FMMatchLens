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
} from "@/api/realtimeMatch"
import { preprocessReplayArchive } from "@/api/replay/replayPreprocessor"
import {
  ReplaySession,
  replayFrameIndexAtPercent,
} from "@/api/replay/replaySession"
import { frame, replayFixture } from "./replayTestFixtures"

describe("ReplaySession", () => {
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
