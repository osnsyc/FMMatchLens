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
import { replayFixture } from "./replayTestFixtures"

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
      ["fixture-native-momentum-7", "fixture-native-momentum-8"]
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
})
