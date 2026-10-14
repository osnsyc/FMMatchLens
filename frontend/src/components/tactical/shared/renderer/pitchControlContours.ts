import type { ControlGrid } from "../core/pitchControl"
import { PITCH_CONTROL_NEUTRAL_TOLERANCE } from "./pitchControlColor"

type Point = { x: number; y: number }
export type ControlContourSegment = { from: Point; to: Point }

/** Marching squares with a bilinear asymptotic decider; coordinates are pitch fractions. */
export function pitchControlContours({ columns, rows, values }: ControlGrid) {
  const segments: ControlContourSegment[] = []
  for (let y = 0; y < rows - 1; y++)
    for (let x = 0; x < columns - 1; x++) {
      const corners = [
        { x, y, v: values[y * columns + x] - 0.5 },
        { x: x + 1, y, v: values[y * columns + x + 1] - 0.5 },
        { x: x + 1, y: y + 1, v: values[(y + 1) * columns + x + 1] - 0.5 },
        { x, y: y + 1, v: values[(y + 1) * columns + x] - 0.5 },
      ]
      if (
        corners.every((p) => Math.abs(p.v) <= PITCH_CONTROL_NEUTRAL_TOLERANCE)
      )
        continue
      const crossings: Point[] = []
      for (let i = 0; i < 4; i++) {
        const a = corners[i],
          b = corners[(i + 1) % 4]
        if (a.v > 0 === b.v > 0) continue
        const t = -a.v / (b.v - a.v)
        crossings.push({
          x: (a.x + t * (b.x - a.x)) / (columns - 1),
          y: (a.y + t * (b.y - a.y)) / (rows - 1),
        })
      }
      if (crossings.length === 4) {
        // Negating all values (swapping teams) preserves this determinant and topology.
        const determinant =
          corners[0].v * corners[2].v - corners[1].v * corners[3].v
        const pairs =
          determinant > 0
            ? [
                [0, 1],
                [2, 3],
              ]
            : determinant < 0
              ? [
                  [0, 3],
                  [1, 2],
                ]
              : [
                  [0, 2],
                  [1, 3],
                ]
        for (const [a, b] of pairs)
          segments.push({ from: crossings[a], to: crossings[b] })
      } else if (crossings.length === 2)
        segments.push({ from: crossings[0], to: crossings[1] })
    }
  return segments
}
