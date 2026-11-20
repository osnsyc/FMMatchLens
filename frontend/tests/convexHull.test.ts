import { describe, expect, it } from "vitest"
import { BitmapText, Graphics } from "pixi.js"
import {
  calculateTeamHull,
  convexHull,
  createTeamHull,
  polygonArea,
} from "@/components/tactical/shared/core/convexHull"
import { ConvexHullRenderer } from "@/components/tactical/shared/renderer/ConvexHullRenderer"
import type {
  TacticalMotionFrame,
  TacticalMotionPlayer,
} from "@/components/tactical/shared/core/types"

function player(
  playerId: number,
  x: number,
  y: number,
  extra: Partial<TacticalMotionPlayer> = {}
): TacticalMotionPlayer {
  return {
    playerId,
    team: "home",
    x,
    y,
    velocityXPerTick: 0,
    velocityYPerTick: 0,
    ...extra,
  }
}

function frame(): TacticalMotionFrame {
  return {
    tick: 1,
    pitchDimensions: { length: 100, width: 50 },
    players: [
      player(1, 10, 20),
      player(2, 30, 20),
      player(3, 30, 60),
      player(4, 10, 60),
      player(5, 20, 40),
      player(6, 0, 50, { isGoalkeeper: true }),
      player(7, 60, 20, { team: "away" }),
      player(8, 80, 20, { team: "away" }),
      player(9, 60, 60, { team: "away" }),
      player(10, 100, 50, { team: "away", isGoalkeeper: true }),
    ],
  }
}

describe("convex hull geometry and metric area", () => {
  it("excludes interior/duplicate points and handles collinear and empty sets", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
      { x: 1, y: 1 },
      { x: 0, y: 0 },
    ]
    const hull = convexHull(points)
    expect(hull).toHaveLength(4)
    expect(polygonArea(hull)).toBe(4)
    expect(polygonArea([...hull].reverse())).toBe(4)
    expect(convexHull([])).toEqual([])
    expect(
      convexHull([
        { x: 1, y: 1 },
        { x: 1, y: 1 },
      ])
    ).toHaveLength(1)
    const line = convexHull([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ])
    expect(line).toHaveLength(2)
    expect(polygonArea(line)).toBe(0)
  })

  it("separates teams, excludes goalkeepers and converts percentages to square metres", () => {
    const sample = frame()
    const snapshot = structuredClone(sample)
    const home = calculateTeamHull(sample, "home")
    const away = calculateTeamHull(sample, "away")
    expect(home.area).toBe(400)
    expect(home.hull).toHaveLength(4)
    expect(home.rearmostPlayer?.playerId).toBe(1)
    expect(away.area).toBe(200)
    expect(away.rearmostPlayer?.playerId).toBe(8)
    expect(sample).toEqual(snapshot)
  })

  it("uses unclipped physical coordinates instead of screen positions", () => {
    const sample = frame()
    sample.players = [
      player(1, 0, 0, { positionMeters: { x: -10, y: -10 } }),
      player(2, 0, 0, { positionMeters: { x: 10, y: -10 } }),
      player(3, 0, 0, { positionMeters: { x: -10, y: 10 } }),
      player(4, NaN, 0),
    ]
    expect(calculateTeamHull(sample, "home").area).toBe(200)
  })

  it("keeps equal-depth labels stable across frame order changes and follows the new rearmost player", () => {
    const sample = frame()
    sample.players = [...sample.players].reverse()
    const result = calculateTeamHull(sample, "home")
    expect(result.rearmostPlayer?.playerId).toBe(1)
    expect(calculateTeamHull(sample, "away").rearmostPlayer?.playerId).toBe(8)
    sample.players = sample.players.map((p) =>
      p.playerId === 1 ? { ...p, x: 40 } : p
    )
    calculateTeamHull(sample, "home", result)
    expect(result.rearmostPlayer?.playerId).toBe(4)
  })

  it("reuses buffers and clears stale results when dimensions or players are missing", () => {
    const result = createTeamHull()
    const points = result.points
    const hull = result.hull
    calculateTeamHull(frame(), "home", result)
    expect(result.area).toBe(400)
    calculateTeamHull({ tick: 2, players: [] }, "home", result)
    expect(result.area).toBeNull()
    expect(result.rearmostPlayer).toBeUndefined()
    expect(result.hull).toHaveLength(0)
    expect(result.points).toBe(points)
    expect(result.hull).toBe(hull)
    calculateTeamHull({ ...frame(), players: [] }, "home", result)
    expect(result.area).toBe(0)
    expect(result.rearmostPlayer).toBeUndefined()
  })
})

describe("convex hull optional layer", () => {
  it("anchors team-coloured integer labels beside the rearmost outfield players and resizes without changing area", () => {
    const renderer = new ConvexHullRenderer(500, 250, {
      home: 0xff0000,
      away: 0x0000ff,
      fontFamily: ["sans-serif"],
    })
    const labels = renderer.labels.children as BitmapText[]
    const contexts = (renderer.container.children as Graphics[]).map(
      (g) => g.context
    )
    try {
      const sample = frame()
      renderer.renderFrame(sample)
      expect(renderer.container.visible).toBe(false)
      expect(labels[0].text).toBe("")
      renderer.setEnabled(true)
      expect(renderer.container.visible).toBe(true)
      expect(labels.map((label) => label.text)).toEqual(["400", "200"])
      expect(labels[0].x).toBe(50 - 16)
      expect(labels[0].y).toBe(50)
      expect(labels[0].anchor.x).toBe(1)
      expect(labels[0].anchor.y).toBe(0.5)
      expect(labels[0].style.fill).toBe(0xff0000)
      expect(labels[1].x).toBe(400 + 16)
      expect(labels[1].anchor.x).toBe(0)
      expect(labels[1].anchor.y).toBe(0.5)
      expect(labels[1].style.fill).toBe(0x0000ff)
      renderer.resize(1000, 500)
      expect(labels[0].text).toBe("400")
      expect(labels[0].x).toBe(100 - 16)
      expect(labels[0].y).toBe(100)
      expect(labels[1].x).toBe(800 + 16)
      renderer.renderFrame({
        ...sample,
        pitchDimensions: { length: 100.2, width: 50 },
      })
      expect(labels[0].text).toBe("401")
      renderer.updateAppearance({
        home: 0x00ff00,
        away: 0xffff00,
        fontFamily: ["sans-serif"],
      })
      expect(labels[0].style.fill).toBe(0x00ff00)
      expect(labels[1].style.fill).toBe(0xffff00)
      renderer.setEnabled(false)
      expect(renderer.labels.visible).toBe(false)
      renderer.renderFrame({ ...sample, players: [] })
      renderer.setEnabled(true)
      expect(labels.every((label) => !label.visible)).toBe(true)
      renderer.renderFrame(sample)
      renderer.clear()
      renderer.setEnabled(true)
      expect(renderer.labels.visible).toBe(false)
    } finally {
      renderer.destroy()
    }
    expect(contexts.every((context) => context.destroyed)).toBe(true)
    expect(labels.every((label) => label.destroyed)).toBe(true)
  })
})
