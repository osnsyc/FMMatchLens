export function hexColorToNormalizedRgb(
  color: string
): [number, number, number] | null {
  const match = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!match) return null

  const hex =
    match[1].length === 3
      ? Array.from(match[1], (digit) => `${digit}${digit}`).join("")
      : match[1]
  const value = Number.parseInt(hex, 16)
  return [
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255,
  ]
}
