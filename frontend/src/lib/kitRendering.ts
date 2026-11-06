import type { TeamColorSource } from "@/lib/teamColors"

export type KitDescriptor = {
  resource: string
  squareResource?: string
  colours: readonly [number, number, number]
  numberColor: string
  numberOutlineColor: string
}

export type MatchKit = KitDescriptor & { id: string }

export function describeKit(source: TeamColorSource | undefined, goalkeeper: boolean): KitDescriptor | undefined {
  const style = goalkeeper ? source?.goalkeeperShirtStyle : source?.shirtStyle
  const back = goalkeeper ? source?.goalkeeperShirtBackType : source?.shirtBackType
  const colours = goalkeeper
    ? [source?.goalkeeperShirtBackgroundColor, source?.goalkeeperShirtForegroundColor, source?.goalkeeperShirtOutlineColor]
    : [source?.shirtBackgroundColor, source?.shirtForegroundColor, source?.shirtOutlineColor]
  if (!Number.isInteger(style) || style! < 0 || style! > 255 ||
      !Number.isInteger(back) || back! < 0 || back! > 2 ||
      colours.some((value) => value === undefined || !Number.isInteger(value) || value < 0 || value > 0xffffffff)) return undefined
  const effectiveStyle = back === 2 ? 1 : style!
  if (effectiveStyle < 1 || effectiveStyle > (goalkeeper ? 55 : 56)) return undefined
  return {
    resource: `kits/${goalkeeper ? "g" : "o"}/s${effectiveStyle}.webp`,
    ...(back === 1 ? { squareResource: "kits/square.webp" } : {}),
    colours: colours as [number, number, number],
    numberColor: numberColour(goalkeeper ? source?.goalkeeperShirtNumberColor : source?.shirtNumberColor, "#ffffff"),
    numberOutlineColor: numberColour(goalkeeper ? source?.goalkeeperShirtNumberOutlineColor : source?.shirtNumberOutlineColor, "#111111"),
  }
}

function numberColour(value: number | undefined, fallback: string): string {
  if (value === undefined || !Number.isInteger(value) || value < 0 || value > 0xffffffff) return fallback
  const argb = value.toString(16).padStart(8, "0")
  return `#${argb.slice(2)}${argb.slice(0, 2)}`
}

// Matches SI/UI/Recoloured2D: the mask's RGB channels are independent
// coefficients, not normalised weights. Preserve its alpha exactly.
export function kitColourMatrix(colours: KitDescriptor["colours"]): number[] {
  return [
    ...colours.map((colour) => ((colour >>> 16) & 255) / 255), 0, 0,
    ...colours.map((colour) => ((colour >>> 8) & 255) / 255), 0, 0,
    ...colours.map((colour) => (colour & 255) / 255), 0, 0,
    0, 0, 0, 1, 0,
  ]
}
