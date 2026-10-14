export function projectPositionToTacticalBoard(
  rawLateralX: number,
  rawLongitudinalY: number,
  rotate: boolean,
  halfWidth: number,
  halfLength: number
) {
  const direction = rotate ? -1 : 1
  return {
    x: normalize(direction * rawLongitudinalY, -halfLength, halfLength),
    y: normalize(direction * rawLateralX, -halfWidth, halfWidth),
  }
}

export function validPitchHalf(value: number) {
  return Number.isFinite(value) && value > 0 && value < 1_000
    ? value
    : undefined
}

function normalize(value: number, min: number, max: number) {
  return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
}
