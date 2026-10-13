import { describe, expect, it } from "vitest"

import { activePlaybackOverlays } from "@/components/tactical/playback/core/overlayTimeline"
import type { PlaybackOverlay } from "@/components/tactical/playback/core/types"

describe("playback overlay timeline", () => {
  const overlays: PlaybackOverlay[] = [
    {
      id: "zone",
      kind: "region",
      timing: {
        fromTick: 10,
        toTick: 20,
        enter: "fade",
        exit: "fade",
        transitionTicks: 2,
      },
      geometry: { shape: "circle", x: 50, y: 50, radius: 10 },
    },
    {
      id: "player-label",
      kind: "label",
      variant: "entity",
      timing: { fromTick: 12 },
      anchor: { target: "player", playerId: 7 },
      title: { key: "playback.player", defaultValue: "Player" },
    },
  ]

  it("filters overlays by tick and keeps an open-ended overlay active", () => {
    expect(activePlaybackOverlays(overlays, 9)).toEqual([])
    expect(
      activePlaybackOverlays(overlays, 12).map(({ overlay }) => overlay.id)
    ).toEqual(["zone", "player-label"])
    expect(
      activePlaybackOverlays(overlays, 30).map(({ overlay }) => overlay.id)
    ).toEqual(["player-label"])
  })

  it("calculates declarative enter and exit transitions", () => {
    expect(activePlaybackOverlays(overlays, 10)[0]).toMatchObject({
      opacity: 0,
      scale: 1,
    })
    expect(activePlaybackOverlays(overlays, 11)[0]?.opacity).toBeCloseTo(0.5)
    expect(activePlaybackOverlays(overlays, 19)[0]?.opacity).toBeCloseTo(0.5)
  })
})
