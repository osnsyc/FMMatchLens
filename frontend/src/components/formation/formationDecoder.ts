import templates from "@/components/formation/data/formationTemplates"

/** Port of the native position compression; signed result is in [-16, 11]. */
export function compressPosition(mask: number): number {
  const has = (bits: number) => (mask & bits) !== 0
  if (!mask) return -16
  if (has(1)) return -15
  if (has(0x1c)) {
    if (has(0x8924)) return -13
    if (has(0x200000)) return -12
    const central = has(0x400000) || (!has(0x100000) && has(0x6490))
    if (has(0x100000) || central) return -10 - Number(central)
    return has(0x11248) ? -9 : -15
  }
  if (has(0xe0)) {
    if (has(0x8920)) return -8
    if (has(0x200000)) return -7
    const central = has(0x400000) || (!has(0x100000) && has(0x6480))
    if (has(0x100000) || central) return (Number(central) ^ 0xfb) - 256
    return has(0x11240) ? -4 : -15
  }
  if (has(0x700)) {
    if (has(0x8900)) return -3
    if (has(0x200000)) return -2
    const central = has(0x400000) || (!has(0x100000) && has(0x6400))
    if (has(0x100000) || central) return -Number(central)
    return has(0x11200) ? 1 : -15
  }
  if (has(0x3800)) {
    if (has(0x8800)) return 2
    if (has(0x200000)) return 3
    const central = has(0x400000) || (!has(0x100000) && has(0x6000))
    if (has(0x100000) || central) return Number(central) ^ 5
    return has(0x11000) ? 6 : -15
  }
  if (has(0x1c000)) {
    if (has(0x8000)) return 7
    if (has(0x200000)) return 8
    if (has(0x400000) || (mask & 0x104000) === 0x4000) return 9
    if (has(0x100000)) return 10
    return has(0x10000) ? 11 : -15
  }
  return -15
}

function shapeKey(positions: number[]) {
  return positions
    .map((p) => templates.comparisonClasses[compressPosition(p) + 15] ?? 0)
    .sort((a, b) => a - b)
    .join(",")
}
// Native matching treats some lateral variants as equivalent; first enum wins.
const knownShapes = templates.templates
  .filter(
    (entry) =>
      entry.id >= 1 &&
      entry.id <= 69 &&
      (entry.id > 49 ||
        ((0x19c1000011001n >> BigInt(entry.id - 1)) & 1n) === 0n)
  )
  .map((entry) => ({ ...entry, key: shapeKey(entry.positions) }))

function displayName(name: string) {
  return name
    .replace(/^\d+/, (digits) => digits.split("").join("-"))
    .replace(/([0-9])([A-Z])/, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
}

export function decodeFormation(positions: number[]) {
  if (positions.length !== 11 || positions.some((p) => p === 0))
    return { id: 0, name: "Custom", displayName: "Custom", matched: false }
  const key = shapeKey(positions)
  const match = knownShapes.find((entry) => entry.key === key)
  return match
    ? {
        id: match.id,
        name: match.name,
        displayName: displayName(match.name),
        matched: true,
      }
    : { id: 0, name: "Custom", displayName: "Custom", matched: false }
}

export function decodePosition(mask: number): string {
  const base = mask & 0x1ffff
  const direct: Record<number, string> = {
    1: "GK",
    4: "DR",
    8: "DL",
    32: "WBR",
    64: "WBL",
    256: "MR",
    512: "ML",
    2048: "AMR",
    4096: "AML",
    32768: "STR",
    65536: "STL",
  }
  if (direct[base]) return direct[base]
  const centre: Record<number, string> = {
    16: "DC",
    128: "DM",
    1024: "MC",
    8192: "AMC",
    16384: "ST",
  }
  const label = centre[base]
  if (!label) return `Unknown (0x${mask.toString(16)})`
  return label + (mask & 0x100000 ? "L" : mask & 0x200000 ? "R" : "")
}

const lines: Record<number, number> = {
  1: 90,
  4: 74,
  8: 74,
  16: 76,
  32: 60,
  64: 60,
  128: 60,
  256: 44,
  512: 44,
  1024: 44,
  2048: 27,
  4096: 27,
  8192: 28,
  16384: 12,
  32768: 12,
  65536: 12,
}
/** Schematic formation coordinates, not tracked locations or native role movement. */
export function tacticalPitchPoints(masks: readonly number[]) {
  return masks.map((mask, index) => {
    const base = mask & 0x1ffff
    const y = lines[base]
    if (y === undefined) return null
    if ([8, 64, 512, 4096, 65536].includes(base)) return { x: 14, y }
    if ([4, 32, 256, 2048, 32768].includes(base)) return { x: 86, y }
    if (mask & 0x100000) return { x: 32, y }
    if (mask & 0x200000) return { x: 68, y }
    const central = masks
      .map((other, slot) => ({ other, slot }))
      .filter(({ other }) => (other & 0x1ffff) === base && !(other & 0x300000))
    const rank = central.findIndex(({ slot }) => slot === index)
    return {
      x: central.length === 1 ? 50 : 32 + (rank * 36) / (central.length - 1),
      y,
    }
  })
}
