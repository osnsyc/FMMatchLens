import type { TeamSide } from "@/types/match"
import type { TacticalMotionFrame, TacticalMotionPlayer } from "./types"

type Point = { x: number; y: number }

export type TeamHull = {
  points: Point[]
  hull: Point[]
  rearmostPlayer?: TacticalMotionPlayer
  area: number | null
}

export function createTeamHull(): TeamHull {
  return { points: [], hull: [], area: null }
}

/** Andrew's monotone chain: O(n log n), no angles, reusable input/output buffers.
 * Sorts points in place. Duplicate and collinear interior points are discarded.
 */
export function convexHull(points: Point[], hull: Point[] = []) {
  hull.length = 0
  points.sort((a, b) => a.x - b.x || a.y - b.y)
  let unique = 0
  for (const point of points) {
    if (
      unique === 0 ||
      point.x !== points[unique - 1].x ||
      point.y !== points[unique - 1].y
    )
      points[unique++] = point
  }
  points.length = unique
  for (const point of points) {
    while (
      hull.length >= 2 &&
      cross(hull[hull.length - 2], hull[hull.length - 1], point) <= 0
    )
      hull.pop()
    hull.push(point)
  }
  const lowerLength = hull.length
  for (let i = points.length - 2; i >= 0; i--) {
    const point = points[i]
    while (
      hull.length > lowerLength &&
      cross(hull[hull.length - 2], hull[hull.length - 1], point) <= 0
    )
      hull.pop()
    hull.push(point)
  }
  if (hull.length > 1) hull.pop()
  return hull
}

export function polygonArea(points: readonly Point[]) {
  let twiceArea = 0
  for (let i = 1; i < points.length - 1; i++) {
    twiceArea += cross(points[0], points[i], points[i + 1])
  }
  return Math.abs(twiceArea) / 2
}

/** Use unclipped metres for analysis; percentage coordinates are a fallback. */
export function calculateTeamHull(
  frame: TacticalMotionFrame,
  team: TeamSide,
  result = createTeamHull()
) {
  result.rearmostPlayer = undefined
  result.area = null
  result.hull.length = 0
  const dimensions = frame.pitchDimensions
  if (
    !dimensions ||
    !Number.isFinite(dimensions.length) ||
    dimensions.length <= 0 ||
    !Number.isFinite(dimensions.width) ||
    dimensions.width <= 0
  ) {
    result.points.length = 0
    return result
  }
  let count = 0
  let rearmostX = team === "home" ? Infinity : -Infinity
  for (let i = 0; i < Math.min(frame.players.length, 64); i++) {
    const player = frame.players[i]
    if (player.team !== team) continue
    if (player.isGoalkeeper) continue
    const x = player.positionMeters?.x ?? (player.x * dimensions.length) / 100
    const y = player.positionMeters?.y ?? (player.y * dimensions.width) / 100
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    // Use the overlay's home-left/away-right convention for depth.
    // Resolve equal-depth players by id so frame ordering cannot move the label.
    if (
      Number.isFinite(player.x) &&
      Number.isFinite(player.y) &&
      ((team === "home" ? x < rearmostX : x > rearmostX) ||
        (x === rearmostX &&
          player.playerId < (result.rearmostPlayer?.playerId ?? Infinity)))
    ) {
      result.rearmostPlayer = player
      rearmostX = x
    }
    const point = result.points[count] ?? (result.points[count] = { x, y })
    point.x = x
    point.y = y
    count++
  }
  result.points.length = count
  convexHull(result.points, result.hull)
  result.area = polygonArea(result.hull)
  return result
}

function cross(a: Point, b: Point, c: Point) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}
