export type PitchDimensions = {
  length: number
  width: number
}

export type PitchGeometry = PitchDimensions & {
  centreX: number
  centreY: number
  penaltyAreaDepth: number
  penaltyAreaWidth: number
  penaltyAreaY: number
  goalAreaDepth: number
  goalAreaWidth: number
  goalAreaY: number
  penaltyMarkDistance: number
  circleRadius: number
  penaltyArcHalfSpan: number
  cornerRadius: number
}

// A widely used international pitch size. The geometry remains configurable
// across the dimensions permitted by IFAB Law 1 for venue-specific pitches.
export const DEFAULT_PITCH_DIMENSIONS: PitchDimensions = {
  length: 105,
  width: 68,
}

const LENGTH_RANGE = { minimum: 90, maximum: 120 }
const WIDTH_RANGE = { minimum: 45, maximum: 90 }

// IFAB Law 1 measurements, in metres.
const GOAL_WIDTH = 7.32
const PENALTY_AREA_OFFSET = 16.5
const GOAL_AREA_OFFSET = 5.5
const PENALTY_MARK_DISTANCE = 11
const CIRCLE_RADIUS = 9.15
const CORNER_RADIUS = 1

export function resolvePitchDimensions(
  dimensions?: Partial<PitchDimensions>
): PitchDimensions {
  const resolved = {
    length: validDimension(
      dimensions?.length,
      LENGTH_RANGE,
      DEFAULT_PITCH_DIMENSIONS.length
    ),
    width: validDimension(
      dimensions?.width,
      WIDTH_RANGE,
      DEFAULT_PITCH_DIMENSIONS.width
    ),
  }
  return resolved.length > resolved.width
    ? resolved
    : DEFAULT_PITCH_DIMENSIONS
}

export function buildPitchGeometry(
  dimensions?: Partial<PitchDimensions>
): PitchGeometry {
  const { length, width } = resolvePitchDimensions(dimensions)
  const penaltyAreaWidth = GOAL_WIDTH + PENALTY_AREA_OFFSET * 2
  const goalAreaWidth = GOAL_WIDTH + GOAL_AREA_OFFSET * 2
  const distanceFromMarkToAreaLine = PENALTY_AREA_OFFSET - PENALTY_MARK_DISTANCE

  return {
    length,
    width,
    centreX: length / 2,
    centreY: width / 2,
    penaltyAreaDepth: PENALTY_AREA_OFFSET,
    penaltyAreaWidth,
    penaltyAreaY: (width - penaltyAreaWidth) / 2,
    goalAreaDepth: GOAL_AREA_OFFSET,
    goalAreaWidth,
    goalAreaY: (width - goalAreaWidth) / 2,
    penaltyMarkDistance: PENALTY_MARK_DISTANCE,
    circleRadius: CIRCLE_RADIUS,
    penaltyArcHalfSpan: Math.sqrt(
      CIRCLE_RADIUS ** 2 - distanceFromMarkToAreaLine ** 2
    ),
    cornerRadius: CORNER_RADIUS,
  }
}

function validDimension(
  value: number | undefined,
  range: { minimum: number; maximum: number },
  fallback: number
) {
  return value != null &&
    Number.isFinite(value) &&
    value >= range.minimum &&
    value <= range.maximum
    ? value
    : fallback
}
