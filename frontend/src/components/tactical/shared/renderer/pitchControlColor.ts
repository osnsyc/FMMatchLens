// Control scores within 0.1 percentage points of equal control stay transparent.
export const PITCH_CONTROL_NEUTRAL_TOLERANCE = 0.001
const MAX_ALPHA = 255 * 0.7
const OPACITY_GAMMA = 0.5
// A narrow feather beyond the neutral band avoids a hard rim around each field.
const FEATHER_WIDTH = 0.008

function smoothstep(value: number) {
  return value * value * (3 - 2 * value)
}

/** Soft influence clouds: feathered neutral edges, gamma-scaled colour, 70% maximum. */
export function pitchControlColor(control: number, home: number, away: number) {
  const difference = control - 0.5
  const distance = Math.abs(difference)
  const color = difference >= 0 ? home : away
  if (!Number.isFinite(control) || distance <= PITCH_CONTROL_NEUTRAL_TOLERANCE)
    return { color, alpha: 0 }
  const maximumDistance = 0.5 - PITCH_CONTROL_NEUTRAL_TOLERANCE
  const excess = Math.min(
    maximumDistance,
    distance - PITCH_CONTROL_NEUTRAL_TOLERANCE
  )
  const strength = Math.pow(excess / maximumDistance, OPACITY_GAMMA)
  const feather = smoothstep(Math.min(1, excess / FEATHER_WIDTH))
  return {
    color,
    // Quantize only when writing the final RGBA texture.
    alpha: MAX_ALPHA * strength * feather,
  }
}
