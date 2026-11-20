// Player of the Match laurels — 5:1, based on slender natural laurel leaves.

const VIEWBOX_WIDTH = 600
const VIEWBOX_HEIGHT = 120

const sprigs = [
  {
    // Left: upward-bowing arc (visually from upper-left to lower-right).
    start: [310, 95],
    control1: [198, 44],
    control2: [110, 36],
    end: [18, 36],
  },
  {
    // Right: downward-bowing arc (same overall diagonal direction).
    start: [581, 101],
    control1: [488, 96],
    control2: [386, 76],
    end: [290, 20],
  },
] as const

// Leaf pairs have a slight offset, like naturally alternating leaves.
const LEAF_PAIRS = 10
const LEAF_START = 0.09
const LEAF_END = 0.91
const leafPositions = Array.from(
  { length: LEAF_PAIRS },
  (_, index) => LEAF_START + (index * (LEAF_END - LEAF_START)) / (LEAF_PAIRS - 1),
)

// The blade is narrower at the stem, fuller around its middle, and tapered
// near the tip. Both sides use the same forward-pointing blade geometry.
const LEAF_PATH =
  'M0 0 C7 -2.5 15 -5.4 22 -5.3 C29 -4.6 36 -2 39 0 ' +
  'C31 1 25 5 17 5.4 C9 5.6 4 2 0 0 Z'

type Axis = 0 | 1
type Sprig = (typeof sprigs)[number]

function pointOnCurve(curve: Sprig, t: number, axis: Axis): number {
  const u = 1 - t
  const { start, control1, control2, end } = curve
  return (
    u ** 3 * start[axis] +
    3 * u * u * t * control1[axis] +
    3 * u * t * t * control2[axis] +
    t ** 3 * end[axis]
  )
}

function tangentOnCurve(curve: Sprig, t: number, axis: Axis): number {
  const u = 1 - t
  const { start, control1, control2, end } = curve
  return (
    3 * u * u * (control1[axis] - start[axis]) +
    6 * u * t * (control2[axis] - control1[axis]) +
    3 * t * t * (end[axis] - control2[axis])
  )
}

function LaurelSprig({ curve }: { curve: Sprig }) {
  const { start, control1, control2, end } = curve
  const stemPath =
    `M${start.join(' ')} ` +
    `C${control1.join(' ')} ${control2.join(' ')} ${end.join(' ')}`

  function leafAt(t: number, side: 'upper' | 'lower', index: number) {
    // Small stagger keeps pairs from looking like a rigid fishbone.
    const leafT = Math.max(0, Math.min(1, t + (side === 'upper' ? -0.009 : 0.009)))
    const x = pointOnCurve(curve, leafT, 0)
    const y = pointOnCurve(curve, leafT, 1)
    const stemAngle =
      (Math.atan2(tangentOnCurve(curve, leafT, 1), tangentOnCurve(curve, leafT, 0)) * 180) /
      Math.PI

    // A forward lean on both sides; blades are closer to the stem than before.
    const openingAngle = side === 'upper' ? -27 : 37
    const spreadVariation = 2.5 * Math.sin(index * 1.25)
    const leafAngle = stemAngle + openingAngle + spreadVariation
    const size = (0.72 + 0.17 * Math.sin(Math.PI * t)) * (side === 'upper' ? 1 : 0.96)

    return (
      <path
        key={`${side}-${index}`}
        className="report-laurel-leaf"
        d={LEAF_PATH}
        transform={`translate(${x} ${y}) rotate(${leafAngle}) scale(${size})`}
      />
    )
  }

  return (
    <g>
      <path
        d={stemPath}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.05"
        strokeLinecap="round"
      />
      {leafPositions.map((t, index) => (
        <g key={index}>
          {leafAt(t, 'upper', index)}
          {leafAt(t, 'lower', index)}
        </g>
      ))}
    </g>
  )
}

export function ReportLaurel() {
  return (
    <svg
      className="report-pom-laurel"
      viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      {sprigs.map((curve, index) => (
        <LaurelSprig key={index} curve={curve} />
      ))}
    </svg>
  )
}
