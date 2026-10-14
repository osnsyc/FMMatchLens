import type { ControlGrid } from "../core/pitchControl"
import { pitchControlColor } from "./pitchControlColor"

/** Interpolate scores before colour mapping so opposing colours meet at neutral control. */
export function rasterizePitchControl(
  grid: ControlGrid,
  home: number,
  away: number,
  subdivisions = 4
) {
  const { columns, rows, values } = grid
  const width = (columns - 1) * subdivisions + 1
  const height = (rows - 1) * subdivisions + 1
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    const gridY = y / subdivisions
    const top = Math.min(rows - 2, Math.floor(gridY)),
      fy = gridY - top
    for (let x = 0; x < width; x++) {
      const gridX = x / subdivisions
      const left = Math.min(columns - 2, Math.floor(gridX)),
        fx = gridX - left
      const a = values[top * columns + left],
        b = values[top * columns + left + 1]
      const c = values[(top + 1) * columns + left],
        d = values[(top + 1) * columns + left + 1]
      const upper = a + (b - a) * fx,
        lower = c + (d - c) * fx
      const { color, alpha } = pitchControlColor(
        upper + (lower - upper) * fy,
        home,
        away
      )
      const offset = (y * width + x) * 4
      pixels[offset] = (color >> 16) & 255
      pixels[offset + 1] = (color >> 8) & 255
      pixels[offset + 2] = color & 255
      pixels[offset + 3] = alpha
    }
  }
  return { width, height, pixels }
}
