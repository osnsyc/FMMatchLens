import { describe, expect, it } from "vitest"

import {
  getHeatmap,
  getHeatmapColorScaleBounds,
  HEATMAP_GRID_HEIGHT,
  HEATMAP_GRID_WIDTH,
  HeatmapDerivations,
} from "@/api/heatmap"
import type { RealtimeFrame } from "@/api/realtimeMatch"
import type { HeatmapGrid } from "@/types/match"

function frameAt(normalizedX: number, normalizedY: number, minute = 0) {
  return {
    tick: minute * 240,
    displayTick: minute * 240,
    period: 1,
    possessionTeam: "home",
    halfPitchWidth: 50,
    halfPitchLength: 50,
    players: [
      {
        playerId: 7,
        team: "home",
        isOnPitch: true,
        x: normalizedX - 50,
        y: 50 - normalizedY,
      },
    ],
  } as RealtimeFrame
}

function playerGrid(engine: HeatmapDerivations, range: "full" | "recent15") {
  return getHeatmap(engine.snapshot(), {
    scope: { type: "player", playerId: 7 },
    phase: "all",
    range,
  })
}

describe("heatmap density", () => {
  it("splats an interior sample across four cells without changing its mass", () => {
    const engine = new HeatmapDerivations()
    engine.appendFrame(frameAt(51, 51))

    const grid = playerGrid(engine, "full")
    const populated = [...grid.density].filter((value) => value > 0)

    expect(grid.width).toBe(HEATMAP_GRID_WIDTH)
    expect(grid.height).toBe(HEATMAP_GRID_HEIGHT)
    expect(populated).toHaveLength(4)
    expect(populated.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1)
  })

  it("preserves sample mass at the pitch boundary", () => {
    const engine = new HeatmapDerivations()
    engine.appendFrame(frameAt(0, 0))

    const grid = playerGrid(engine, "full")
    expect([...grid.density].reduce((sum, value) => sum + value, 0)).toBeCloseTo(
      1
    )
  })

  it("subtracts the same splat weights when recent samples expire", () => {
    const engine = new HeatmapDerivations()
    engine.appendFrame(frameAt(51, 51))
    engine.appendFrame(frameAt(75, 75, 16))

    const grid = playerGrid(engine, "recent15")
    expect(grid.sampleCount).toBe(1)
    expect([...grid.density].reduce((sum, value) => sum + value, 0)).toBeCloseTo(
      1
    )
    expect(grid.averageX).toBeCloseTo(75)
    expect(grid.averageY).toBeCloseTo(75)
  })

  it("uses a smoothed P99 ceiling below an isolated raw peak", () => {
    const density = new Float32Array(
      HEATMAP_GRID_WIDTH * HEATMAP_GRID_HEIGHT
    )
    density[
      Math.floor(HEATMAP_GRID_HEIGHT / 2) * HEATMAP_GRID_WIDTH +
        Math.floor(HEATMAP_GRID_WIDTH / 2)
    ] = 1
    const grid: HeatmapGrid = {
      width: HEATMAP_GRID_WIDTH,
      height: HEATMAP_GRID_HEIGHT,
      density,
      sampleCount: 1,
      averageX: 50,
      averageY: 50,
    }

    const bounds = getHeatmapColorScaleBounds([grid])
    expect(bounds.blurredP99CellShare).toBeGreaterThan(0)
    expect(bounds.blurredP99CellShare).toBeLessThan(bounds.rawMaxCellShare)
  })
})
