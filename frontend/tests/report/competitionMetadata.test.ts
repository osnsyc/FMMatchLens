import { describe, expect, it, vi } from "vitest"
import { preprocessReplayArchive } from "@/api/replay/replayPreprocessor"
import { ReplaySession } from "@/api/replay/replaySession"
import { replayFixture } from "../replay/replayTestFixtures"

vi.mock("@/lib/teamColors", () => ({
  selectTeamThemeColors: () => ({
    home: { light: "#fff", dark: "#000" },
    away: { light: "#fff", dark: "#000" },
  }),
}))

describe("report competition metadata", () => {
  it("retains competition details and resolves its archived or local logo", async () => {
    const fixture = replayFixture()
    const competition = {
      uid: 12,
      name: "Premier League",
      logoPath: "https://img.osnsyc.top/comp/12.png",
    }
    fixture.metadata.competition = competition
    fixture.metadataTimeline.forEach((metadata) => {
      metadata.competition = competition
    })
    const archive = await preprocessReplayArchive(fixture)
    const offline = new ReplaySession(archive, {
      allowLocalAssets: false,
    }).advanceTo(0)
    expect(offline.competition).toEqual({
      uid: 12,
      name: "Premier League",
      logoUrl: competition.logoPath,
    })
    const local = new ReplaySession(archive).advanceTo(0)
    expect(local.competition?.logoUrl).toContain("/api/assets/comp/12/logo")
  })
})
