import { afterEach, describe, expect, it, vi } from "vitest"

const textures = vi.hoisted(() => [] as Float32Array[])

vi.mock("pixi.js", () => ({
  Container: class {
    addChild() {}
    removeChild() {}
    destroy() {}
  },
  Sprite: class {
    destroy() {}
  },
  autoDetectRenderer: vi.fn(async () => ({
    canvas: { className: "", setAttribute() {} },
    screen: {},
    resize: vi.fn(),
    render: vi.fn(),
    destroy: vi.fn(),
  })),
}))

vi.mock("@/components/heatmap/heatmapTexture", () => ({
  createDensityTexture: (width: number, height: number) => {
    const data = new Float32Array(width * height * 4)
    textures.push(data)
    return { data, source: { update() {} }, texture: { destroy() {} } }
  },
  createHeatmapLutFilter: () => ({
    setStops() {},
    setToneMapping() {},
    destroy() {},
  }),
}))

import {
  HeatmapDerivations,
  getHeatmap,
  getHeatmapDisplayDensity,
  prepareHeatmapRenderData,
} from "@/api/heatmap"
import { PixiHeatmapRenderer } from "@/components/heatmap/PixiHeatmapRenderer"
import type { RealtimeFrame } from "@/api/realtimeMatch"

afterEach(() => {
  vi.unstubAllGlobals()
  textures.length = 0
})

describe("heatmap renderer size independence", () => {
  it("uploads identical normalized density at different canvas sizes and pixel ratios", async () => {
    const engine = new HeatmapDerivations()
    engine.appendFrame({
      tick: 0,
      displayTick: 0,
      period: 1,
      possessionTeam: "home",
      halfPitchWidth: 34,
      halfPitchLength: 52.5,
      players: [{ playerId: 7, team: "home", isOnPitch: true, x: 10, y: 20 }],
    } as RealtimeFrame)
    const grid = getHeatmap(engine.snapshot(), {
      scope: { type: "player", playerId: 7 },
      phase: "all",
      range: "full",
    })
    const data = prepareHeatmapRenderData(grid)
    const host = { appendChild() {} } as unknown as HTMLDivElement
    vi.stubGlobal("window", { devicePixelRatio: 1 })
    const small = await PixiHeatmapRenderer.create(host, 90, 140)
    vi.stubGlobal("window", { devicePixelRatio: 2 })
    const large = await PixiHeatmapRenderer.create(host, 600, 900)
    try {
      small.update(data)
      large.update(data)
      expect(textures[0]).toEqual(textures[1])
      const original = textures[0].slice()
      small.resize(800, 1200)
      small.update(data)
      expect(textures[0]).toEqual(original)
      getHeatmapDisplayDensity(grid).forEach((value, index) => {
        expect(textures[0][index * 4]).toBe(value)
      })
    } finally {
      small.destroy()
      large.destroy()
    }
  })
})
