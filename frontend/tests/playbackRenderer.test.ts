import { afterEach, describe, expect, it, vi } from "vitest"

const { renderOverlays, markerFills } = vi.hoisted(() => ({
  renderOverlays: vi.fn(),
  markerFills: [] as number[],
}))

vi.mock("pixi.js", () => {
  class Container {
    visible = true
    position = { set() {} }
    addChild() {}
    removeChild() {}
    removeChildren() {
      return []
    }
    destroy() {}
  }
  class Graphics {
    visible = true
    clear() {
      return this
    }
    circle() { return this }
    stroke() { return this }
    poly() { return this }
    fill({ color }: { color: number }) {
      markerFills.push(color)
      return this
    }
  }
  class Sprite {
    anchor = { set() {} }
    visible = true
  }
  class BitmapText {
    anchor = { set() {} }
    text: string
    style: { fill: number }
    constructor(options: { text: string; style: { fill: number } }) {
      this.text = options.text
      this.style = options.style
    }
  }
  return { Container, Graphics, Sprite, BitmapText }
})

vi.mock(
  "@/components/tactical/playback/renderer/PlaybackOverlayRenderer",
  () => ({
    PlaybackOverlayRenderer: class {
      container = {}
      render = renderOverlays
      clear() {}
      destroy() {}
    },
  })
)

import type { Texture } from "pixi.js"
import type { TacticalPlayback } from "@/components/tactical/playback/core/types"
import { PlaybackRenderer, type PlaybackRendererAppearance } from "@/components/tactical/playback/renderer/PlaybackRenderer"

function createRenderer(reduceMotion: boolean, appearance: Partial<PlaybackRendererAppearance> = {}) {
  vi.stubGlobal("window", { matchMedia: () => ({ matches: reduceMotion }) })
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1)
  )
  vi.stubGlobal("cancelAnimationFrame", vi.fn())
  vi.spyOn(performance, "now").mockReturnValue(0)
  return new PlaybackRenderer(
    100,
    100,
    {} as Texture,
    {
      home: 0,
      away: 0,
      foreground: 0,
      important: 0,
      negative: 0,
      neutral: 0,
      success: 0,
      ...appearance,
    },
    undefined,
    vi.fn()
  )
}

const playback: TacticalPlayback = {
  id: "test",
  team: "home",
  range: { startTick: 10, endTick: 12 },
  frames: [10, 11, 12].map((tick) => ({ tick, players: [] })),
  overlays: [],
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  renderOverlays.mockClear()
  markerFills.length = 0
})

describe("playback goalkeeper colors", () => {
  const players = [
    { playerId: 1, team: "home", isGoalkeeper: true },
    { playerId: 2, team: "away", isGoalkeeper: true },
    { playerId: 3, team: "home", isGoalkeeper: false },
  ].map((player) => ({ ...player, x: 50, y: 50, velocityXPerTick: 0, velocityYPerTick: 0 } as const))
  const goalkeeperPlayback: TacticalPlayback = {
    ...playback,
    frames: [{ tick: 10, players }],
  }

  it("uses each team's GK kit color for the marker and arrow, retaining outfield colors", () => {
    const renderer = createRenderer(true, {
      home: 0x880000,
      away: 0x000088,
      homeGoalkeeperColor: 0xff00bb00,
      awayGoalkeeperColor: 0xffffff00,
    })
    try {
      renderer.updatePlayback(goalkeeperPlayback)
      expect(markerFills).toEqual([0x00bb00, 0x00bb00, 0xffff00, 0xffff00, 0x880000, 0x880000])
      markerFills.length = 0
      renderer.updateAppearance({
        home: 0x880000, away: 0x000088, foreground: 0, important: 0,
        negative: 0, neutral: 0, success: 0,
        homeGoalkeeperColor: 0xffbb00bb, awayGoalkeeperColor: 0xff000000,
      })
      expect(markerFills).toEqual([0xbb00bb, 0xbb00bb, 0, 0, 0x880000, 0x880000])
    } finally {
      renderer.destroy()
    }
  })

  it.each([undefined, 0, Number.NaN])("falls back to team color for invalid GK color %s", (color) => {
    const renderer = createRenderer(true, { home: 0x880000, away: 0x000088, homeGoalkeeperColor: color, awayGoalkeeperColor: color })
    try {
      renderer.updatePlayback(goalkeeperPlayback)
      expect(markerFills).toEqual([0x880000, 0x880000, 0x000088, 0x000088, 0x880000, 0x880000])
    } finally {
      renderer.destroy()
    }
  })
})

describe("playback redraw state", () => {
  it("keeps the final frame after reduced-motion redraws", () => {
    const renderer = createRenderer(true)
    try {
      renderer.updatePlayback(playback)
      renderer.resize(200, 200)
      renderer.updateTextResolver((text) => text.defaultValue)
      expect(renderOverlays.mock.calls.map((call) => call[1].tick)).toEqual([
        12, 12, 12,
      ])
      expect(requestAnimationFrame).not.toHaveBeenCalled()
    } finally {
      renderer.destroy()
    }
  })

  it("stops at the exact last frame and preserves it on redraw", () => {
    const renderer = createRenderer(false)
    try {
      renderer.updatePlayback(playback)
      const advance = vi.mocked(requestAnimationFrame).mock.calls[0][0]
      advance(500)
      renderer.resize(200, 200)
      expect(renderOverlays.mock.calls.map((call) => call[1].tick)).toEqual([
        10, 12, 12,
      ])
      expect(requestAnimationFrame).toHaveBeenCalledTimes(1)
    } finally {
      renderer.destroy()
    }
  })
})
