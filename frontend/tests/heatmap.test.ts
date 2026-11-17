import { describe, expect, it } from "vitest"

import {
  getHeatmap,
  getHeatmapColorScaleBounds,
  getHeatmapColorScale,
  getHeatmapDisplayDensity,
  prepareHeatmapRenderData,
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

function keeperFrame(period: number, direction: number, minute: number) {
  const frame = frameAt(50, 50, minute)
  frame.period = period
  frame.players = [
    { ...frame.players[0], slot: 11, x: -5 * direction, y: 40 * direction },
    { ...frame.players[0], playerId: 8, slot: 37, team: "away", x: 5 * direction, y: -40 * direction },
  ]
  return frame
}

describe("heatmap density", () => {
  it("preserves normalized samples through tactical gaps, excursions and checkpoint restores", () => {
    const engine = new HeatmapDerivations()
    engine.appendFrame(keeperFrame(1, -1, 10))
    const saved = engine.exportState()
    const restored = new HeatmapDerivations()
    restored.restoreState(saved)
    const excursion = keeperFrame(1, 1, 11)
    excursion.tactics = null
    // Neither a temporary goalkeeper excursion nor missing tactics changes ends.
    engine.appendFrame(excursion)
    restored.appendFrame(excursion)
    expect(playerGrid(restored, "full").density).toEqual(playerGrid(engine, "full").density)
    expect(playerGrid(restored, "full").averageY).toBeCloseTo(50)
    restored.reset()
    restored.appendFrame(keeperFrame(2, 1, 50))
    expect(playerGrid(restored, "full").averageY).toBeCloseTo(90)
  })

  it("keeps first-half stoppage time in the current half until the period actually changes", () => {
    const engine = new HeatmapDerivations()
    engine.appendFrame(keeperFrame(1, -1, 44))
    engine.appendFrame(keeperFrame(1, -1, 47))
    const query = { scope: { type: "player" as const, playerId: 7 }, phase: "all" as const, range: "half" as const }
    expect(engine.getHeatmap(query).sampleCount).toBe(2)
    engine.appendFrame(keeperFrame(2, 1, 48))
    expect(engine.getHeatmap(query).sampleCount).toBe(1)
  })

  it("rotates absolute second-half positions even when tactics are missing or the first transition frame is stale", () => {
    for (const transition of ["missing", "stale"] as const) {
      const engine = new HeatmapDerivations()
      engine.appendFrame(keeperFrame(1, -1, 44))
      const halftime = keeperFrame(2, -1, 45)
      if (transition === "missing") halftime.tactics = null
      // No possession during the change of ends: these are not play samples.
      halftime.possessionTeam = null
      engine.appendFrame(halftime)
      const secondHalf = keeperFrame(2, 1, 46)
      secondHalf.tactics = null
      engine.appendFrame(secondHalf)
      const restored = new HeatmapDerivations()
      restored.restoreState(engine.exportState())
      for (const source of [engine, restored]) {
        for (const team of ["home", "away"] as const) {
          const grid = source.getHeatmap({ scope: { type: "team", team }, phase: "all", range: "full" })
          expect(grid.sampleCount).toBe(2)
          expect(grid.averageY).toBeCloseTo(90)
          const oneHalf = new HeatmapDerivations()
          oneHalf.appendFrame(keeperFrame(1, -1, 44))
          const first = oneHalf.getHeatmap({ scope: { type: "team", team }, phase: "all", range: "full" })
          // Both halves occupy exactly the same cells, with twice the density.
          expect([...grid.density]).toEqual([...first.density].map((value) => value * 2))
        }
      }
    }
  })
  it("prepares equivalent shared-scale pixels and refreshes after in-place source updates", () => {
    const engine = new HeatmapDerivations()
    engine.appendFrame(frameAt(20, 30))
    const grid = playerGrid(engine, "full")
    const peer = { ...grid, density: grid.density.slice().reverse() }
    const scale = getHeatmapColorScale([grid, peer])
    const expected = getHeatmapDisplayDensity(grid, scale)
    const prepared = prepareHeatmapRenderData(grid, [grid, peer])
    expect(prepared.density).toEqual(expected)
    const retained = prepared.density.slice()
    grid.density.reverse()
    expect(prepareHeatmapRenderData(grid, [grid, peer]).density).not.toEqual(
      retained
    )
    expect(prepared.density).toEqual(retained)
  })

  it("uses one post-blur scale regardless of sample count or display rotation", () => {
    const engine = new HeatmapDerivations()
    engine.appendFrame(frameAt(20, 30))
    engine.appendFrame(frameAt(70, 80))
    const grid = playerGrid(engine, "full")
    const original = grid.density.slice()
    const density = getHeatmapDisplayDensity(grid)
    const repeated = {
      ...grid,
      sampleCount: grid.sampleCount * 10,
      density: Float32Array.from(grid.density, (value) => value * 10),
    }
    const repeatedDensity = getHeatmapDisplayDensity(repeated)
    const rotated = { ...grid, density: grid.density.slice().reverse() }
    const rotatedDensity = getHeatmapDisplayDensity(rotated)
    density.forEach((value, index) => {
      expect(repeatedDensity[index]).toBeCloseTo(value)
      expect(rotatedDensity[density.length - 1 - index]).toBeCloseTo(value)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    })
    expect(Math.max(...density)).toBe(1)
    expect(getHeatmapColorScale([grid]).maxCellShare).toBe(
      getHeatmapColorScaleBounds([grid]).blurredP99CellShare
    )
    expect(grid.density).toEqual(original)
  })

  it("keeps a shared team scale and renders empty heatmaps as zero", () => {
    const engine = new HeatmapDerivations()
    engine.appendFrame(frameAt(50, 50))
    const concentrated = playerGrid(engine, "full")
    const diffuse = {
      ...concentrated,
      density: new Float32Array(concentrated.density.length).fill(
        1 / concentrated.density.length
      ),
    }
    const scale = getHeatmapColorScale([concentrated, diffuse])
    expect(Math.max(...getHeatmapDisplayDensity(concentrated, scale))).toBe(1)
    expect(Math.max(...getHeatmapDisplayDensity(diffuse, scale))).toBeLessThan(
      1
    )
    const empty = {
      ...concentrated,
      density: new Float32Array(concentrated.density.length),
      sampleCount: 0,
    }
    expect(getHeatmapColorScale([empty]).maxCellShare).toBe(0)
    expect(getHeatmapDisplayDensity(empty).every((value) => value === 0)).toBe(
      true
    )
  })

  it.each(["home", "away"] as const)(
    "places the %s goalkeeper left of the forward after the popup's clockwise rotation",
    (team) => {
      const engine = new HeatmapDerivations()
      const frame = keeperFrame(1, -1, 10)
      const keeper = frame.players.find((player) => player.team === team)!
      frame.players.push({ ...keeper, playerId: 99, y: -keeper.y })
      engine.appendFrame(frame)
      const query = { phase: "all" as const, range: "full" as const }
      const goalkeeper = engine.getHeatmap({ ...query, scope: { type: "player", playerId: keeper.playerId } })
      const forward = engine.getHeatmap({ ...query, scope: { type: "player", playerId: 99 } })
      // A clockwise 90-degree CSS rotation maps vertical y to horizontal 100-y.
      expect(100 - goalkeeper.averageY).toBe(10)
      expect(100 - forward.averageY).toBe(90)
    }
  )

  it.each(
    (["all", "inPossession", "outOfPossession"] as const).flatMap((phase) =>
      (["full", "half", "recent15"] as const).map((range) => ({ phase, range }))
    )
  )(
    "orients both teams upwards across half changes in $phase/$range",
    ({ phase, range }) => {
      const engine = new HeatmapDerivations()
      for (const period of [1, 2]) {
        const direction = period === 1 ? -1 : 1
        const frame = frameAt(20, 10, period === 1 ? 10 : 50)
        frame.period = period
        frame.players = [
          { ...frame.players[0], x: -30 * direction, y: 40 * direction },
          {
            ...frame.players[0],
            playerId: 8,
            team: "away",
            x: 30 * direction,
            y: -40 * direction,
          },
        ]
        // Populate both possession phases at the same physical positions.
        engine.appendFrame(frame)
        engine.appendFrame({
          ...frame,
          tick: frame.tick + 1,
          possessionTeam: "away",
        })
      }
      const snapshot = engine.snapshot()
      const home = getHeatmap(snapshot, {
        scope: { type: "player", playerId: 7 },
        phase,
        range,
      })
      const away = getHeatmap(snapshot, {
        scope: { type: "player", playerId: 8 },
        phase,
        range,
      })
      expect(home.averageX).toBeCloseTo(80)
      expect(home.averageY).toBeCloseTo(90)
      expect(away.averageX).toBeCloseTo(home.averageX)
      expect(away.averageY).toBeCloseTo(home.averageY)
      home.density.forEach((value, index) => {
        expect(value).toBeCloseTo(away.density[index])
      })
      expect(home.sampleCount).toBe(
        (range === "full" ? 2 : 1) * (phase === "all" ? 2 : 1)
      )
      expect(prepareHeatmapRenderData(home).density).toEqual(
        prepareHeatmapRenderData(away).density
      )
    }
  )

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
    expect(
      [...grid.density].reduce((sum, value) => sum + value, 0)
    ).toBeCloseTo(1)
  })

  it("subtracts the same splat weights when recent samples expire", () => {
    const engine = new HeatmapDerivations()
    engine.appendFrame(frameAt(51, 51))
    engine.appendFrame(frameAt(75, 75, 16))

    const grid = playerGrid(engine, "recent15")
    expect(grid.sampleCount).toBe(1)
    expect(
      [...grid.density].reduce((sum, value) => sum + value, 0)
    ).toBeCloseTo(1)
    expect(grid.averageX).toBeCloseTo(75)
    expect(grid.averageY).toBeCloseTo(75)
  })

  it("uses a smoothed P99 ceiling below an isolated raw peak", () => {
    const density = new Float32Array(HEATMAP_GRID_WIDTH * HEATMAP_GRID_HEIGHT)
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
