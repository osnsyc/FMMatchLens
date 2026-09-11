import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/teamColors", () => ({
  selectTeamThemeColors: () => ({
    home: { light: "#fff", dark: "#000" },
    away: { light: "#fff", dark: "#000" },
  }),
}))

import { preprocessReplayArchive } from "@/api/replay/replayPreprocessor"
import { ReplaySession } from "@/api/replay/replaySession"
import { frame, replayFixture } from "./replayTestFixtures"

const fixture = replayFixture()
const frames = []
let cumulativeEvents = fixture.frames[2].momentumEvents.slice(0, 0)
for (let index = 0; index < 17_000; index += 1) {
  if (index % 10 === 0) {
    cumulativeEvents = [
      ...cumulativeEvents,
      ...fixture.frames[2].momentumEvents.map((event) => ({
        ...event,
        eventIndex: index / 10,
        tick: index * 24,
      })),
    ]
  }
  frames.push(
    frame(index * 24, {
      period: index >= 8_500 ? 2 : 1,
      momentumEvents: cumulativeEvents,
    })
  )
}
const preprocessStart = performance.now()
const archive = await preprocessReplayArchive({
  ...fixture,
  frames,
  summary: {
    ...fixture.summary,
    frameCount: frames.length,
    lastTick: frames.at(-1)?.tick ?? 0,
  },
})
const preprocessMilliseconds = performance.now() - preprocessStart

describe("17k frame replay derivation", () => {
  it("records sequential advance and warm random seek", () => {
    const sequentialStart = performance.now()
    const session = new ReplaySession(archive)
    const advanceDurations: number[] = []
    let xgReferenceChanges = 0
    let eventReferenceChanges = 0
    let playerReferenceChanges = 0
    let previousSnapshot: ReturnType<ReplaySession["advanceTo"]> | undefined
    for (let index = 0; index < archive.frameCount; index += 1) {
      const start = performance.now()
      const snapshot = session.advanceTo(index)
      advanceDurations.push(performance.now() - start)
      if (previousSnapshot) {
        if (snapshot.xgTimeline !== previousSnapshot.xgTimeline)
          xgReferenceChanges += 1
        if (snapshot.events !== previousSnapshot.events)
          eventReferenceChanges += 1
        if (snapshot.players !== previousSnapshot.players)
          playerReferenceChanges += 1
      }
      previousSnapshot = snapshot
    }
    const sequentialMilliseconds = performance.now() - sequentialStart
    const sortedAdvanceDurations = advanceDurations.toSorted(
      (left, right) => left - right
    )
    const advanceP95Milliseconds =
      sortedAdvanceDurations[Math.floor(sortedAdvanceDurations.length * 0.95)]
    const firstSeekStart = performance.now()
    session.seek(Math.floor(archive.frameCount * 0.25))
    const firstSeekMilliseconds = performance.now() - firstSeekStart
    const secondSeekStart = performance.now()
    session.seek(Math.floor(archive.frameCount * 0.75))
    const secondSeekMilliseconds = performance.now() - secondSeekStart
    console.table({
      preprocessMilliseconds,
      sequentialMilliseconds,
      advanceP95Milliseconds,
      firstSeekMilliseconds,
      secondSeekMilliseconds,
      xgReferenceChanges,
      eventReferenceChanges,
      playerReferenceChanges,
    })
    expect(session.currentIndex).toBe(Math.floor(archive.frameCount * 0.75))
    session.dispose()
  })
})
