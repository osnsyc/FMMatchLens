export type Point = readonly [number, number]

export interface Blade {
  readonly a: Point
  readonly b: Point
  readonly angle: number
}

export interface Frame {
  readonly amount: number
  readonly opacity: number
}

export const HOLD_RATIO = 0.14
export const TRANSITION_RATIO = (1 - HOLD_RATIO * 2) / 2

// Fixed-radius circular arcs + moving inner vertices. Coordinates are SVG units.
export const CENTER = 256
export const RADIUS = 256
export const ROTATION = -22
export const EDGE_ROTATION = -18
export const ARC_EXTENSION = 1.2
export const pentagon =
  "m188.19 237.61 67.81-49.27 67.81 49.27-25.9 79.81h-83.82l-25.9-79.81Z"

const radians = (degrees: number): number => (degrees * Math.PI) / 180
const rotate = ([x, y]: Point, degrees: number): Point => {
  const c = Math.cos(radians(degrees))
  const s = Math.sin(radians(degrees))
  return [x * c - y * s, x * s + y * c]
}
const onCircle = ([x, y]: Point): Point => {
  const angle = Math.atan2(y - CENTER, x - CENTER)
  return [RADIUS * Math.cos(angle), RADIUS * Math.sin(angle)]
}
const arcStart = onCircle([421.33, 60.6])
const arcEnd = onCircle([511.81, 264.93])
const shift = (point: Point): Point => [point[0] + CENTER, point[1] + CENTER]
const cross = (a: Point, b: Point): number => a[0] * b[1] - a[1] * b[0]

export function arcEndpoints(
  blade: Blade,
  amount: number
): { a: Point; b: Point } {
  const centered = (point: Point): Point => [
    point[0] - CENTER,
    point[1] - CENTER,
  ]
  return {
    a: shift(rotate(centered(blade.a), -ARC_EXTENSION * amount)),
    b: shift(rotate(centered(blade.b), ARC_EXTENSION * amount)),
  }
}

export function innerTip(blade: Blade, amount: number): Point {
  const { a, b } = arcEndpoints(blade, amount)
  return innerTipFromEndpoints(blade, amount, a, b)
}

function innerTipFromEndpoints(
  blade: Blade,
  amount: number,
  a: Point,
  b: Point
): Point {
  const theta = 150 + EDGE_ROTATION * amount + blade.angle
  const u = rotate([1, 0], theta)
  const v = rotate([1, 0], theta + 60)
  const ab: Point = [b[0] - a[0], b[1] - a[1]]
  const distance = cross(ab, v) / cross(u, v)
  return [a[0] + distance * u[0], a[1] + distance * u[1]]
}

export const blades: readonly Blade[] = Array.from({ length: 6 }, (_, i) => {
  const angle = -60 * i
  return {
    a: shift(rotate(arcStart, angle)),
    b: shift(rotate(arcEnd, angle)),
    angle,
  }
})

const point = (value: Point): string =>
  value.map((coordinate) => coordinate.toFixed(6)).join(" ")

export function bladePath(blade: Blade, amount: number): string {
  const { a, b } = arcEndpoints(blade, amount)
  return `M ${point(a)} A ${RADIUS} ${RADIUS} 0 0 1 ${point(b)} L ${point(innerTipFromEndpoints(blade, amount, a, b))} Z`
}

const ease = (value: number): number => {
  const x = Math.max(0, Math.min(1, value))
  return x * x * x * (x * (x * 6 - 15) + 10)
}

export function frameAt(phase: number): Frame {
  const time = ((phase % 1) + 1) % 1
  const closingEnd = HOLD_RATIO + TRANSITION_RATIO
  const closedHoldEnd = closingEnd + HOLD_RATIO

  let amount: number
  if (time < HOLD_RATIO) amount = 0
  else if (time < closingEnd)
    amount = ease((time - HOLD_RATIO) / TRANSITION_RATIO)
  else if (time < closedHoldEnd) amount = 1
  else amount = 1 - ease((time - closedHoldEnd) / TRANSITION_RATIO)

  return {
    amount,
    opacity: 1 - ease(amount / 0.35),
  }
}
