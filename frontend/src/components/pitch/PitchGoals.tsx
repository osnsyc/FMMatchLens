import {
  resolvePitchDimensions,
  GOAL_WIDTH,
  type PitchDimensions,
} from "@/components/pitch/pitchGeometry"

type PitchGoalsProps = {
  dimensions?: Partial<PitchDimensions>
}

const GOAL_DEPTH = 0.5

/** Decorative regulation-width goals that sit outside the pitch footprint. */
export function PitchGoals({ dimensions }: PitchGoalsProps) {
  const pitch = resolvePitchDimensions(dimensions)
  const goalTop = (pitch.width - GOAL_WIDTH) / 2

  return (
    <svg
      className="pointer-events-none absolute inset-0 size-full overflow-visible text-foreground/35"
      viewBox={`0 0 ${pitch.length} ${pitch.width}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <rect
          x={-GOAL_DEPTH}
          y={goalTop}
          width={GOAL_DEPTH}
          height={GOAL_WIDTH}
          vectorEffect="non-scaling-stroke"
        />
        <rect
          x={pitch.length}
          y={goalTop}
          width={GOAL_DEPTH}
          height={GOAL_WIDTH}
          vectorEffect="non-scaling-stroke"
        />
      </g>
    </svg>
  )
}
