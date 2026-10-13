import { afterEach, describe, expect, it, vi } from "vitest"

const { renderOverlays } = vi.hoisted(() => ({ renderOverlays: vi.fn() }))

vi.mock("pixi.js", () => {
  class Container {
    visible = true
    addChild() {}
    removeChild() {}
    removeChildren() {
      return []
    }
    destroy() {}
  }
  class Graphics {
    clear() {
      return this
    }
  }
  class Sprite {
    anchor = { set() {} }
    visible = true
  }
  return { Container, Graphics, Sprite, BitmapText: class {} }
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
import { PlaybackRenderer } from "@/components/tactical/playback/renderer/PlaybackRenderer"

function createRenderer(reduceMotion: boolean) {
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
