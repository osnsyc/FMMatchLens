import {
  buildPitchGeometry,
  type PitchDimensions,
} from "@/components/pitch/pitchGeometry"

type PitchMarkingsProps = {
  dimensions?: Partial<PitchDimensions>
  orientation?: "horizontal" | "vertical"
  className?: string
  lineClassName?: string
}

export function PitchMarkings({
  dimensions,
  orientation = "horizontal",
  className = "pointer-events-none absolute inset-0 size-full overflow-visible",
  lineClassName = "text-foreground/35",
}: PitchMarkingsProps) {
  const pitch = buildPitchGeometry(dimensions)
  const vertical = orientation === "vertical"
  const viewBox = vertical
    ? `0 0 ${pitch.width} ${pitch.length}`
    : `0 0 ${pitch.length} ${pitch.width}`
  const transform = vertical ? `matrix(0 -1 1 0 0 ${pitch.length})` : undefined
  const rightPenaltyX = pitch.length - pitch.penaltyAreaDepth
  const rightGoalAreaX = pitch.length - pitch.goalAreaDepth
  const rightPenaltyMarkX = pitch.length - pitch.penaltyMarkDistance
  const arcTop = pitch.centreY - pitch.penaltyArcHalfSpan
  const arcBottom = pitch.centreY + pitch.penaltyArcHalfSpan

  const lineProps = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    vectorEffect: "non-scaling-stroke" as const,
    className: lineClassName,
  }

  return (
    <svg
      className={className}
      viewBox={viewBox}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <g transform={transform}>
        <rect
          x="0"
          y="0"
          width={pitch.length}
          height={pitch.width}
          {...lineProps}
          className="text-foreground/40"
        />
        <line
          x1={pitch.centreX}
          y1="0"
          x2={pitch.centreX}
          y2={pitch.width}
          {...lineProps}
        />
        <circle
          cx={pitch.centreX}
          cy={pitch.centreY}
          r={pitch.circleRadius}
          {...lineProps}
        />
        <circle
          cx={pitch.centreX}
          cy={pitch.centreY}
          r="0.45"
          fill="currentColor"
          className="text-foreground/40"
        />

        <path
          d={`M0 ${pitch.penaltyAreaY}H${pitch.penaltyAreaDepth}V${pitch.penaltyAreaY + pitch.penaltyAreaWidth}H0`}
          {...lineProps}
        />
        <path
          d={`M${pitch.length} ${pitch.penaltyAreaY}H${rightPenaltyX}V${pitch.penaltyAreaY + pitch.penaltyAreaWidth}H${pitch.length}`}
          {...lineProps}
        />
        <path
          d={`M0 ${pitch.goalAreaY}H${pitch.goalAreaDepth}V${pitch.goalAreaY + pitch.goalAreaWidth}H0`}
          {...lineProps}
        />
        <path
          d={`M${pitch.length} ${pitch.goalAreaY}H${rightGoalAreaX}V${pitch.goalAreaY + pitch.goalAreaWidth}H${pitch.length}`}
          {...lineProps}
        />

        <circle
          cx={pitch.penaltyMarkDistance}
          cy={pitch.centreY}
          r="0.35"
          fill="currentColor"
          className="text-foreground/40"
        />
        <circle
          cx={rightPenaltyMarkX}
          cy={pitch.centreY}
          r="0.35"
          fill="currentColor"
          className="text-foreground/40"
        />
        <path
          d={`M${pitch.penaltyAreaDepth} ${arcTop}A${pitch.circleRadius} ${pitch.circleRadius} 0 0 1 ${pitch.penaltyAreaDepth} ${arcBottom}`}
          {...lineProps}
        />
        <path
          d={`M${rightPenaltyX} ${arcTop}A${pitch.circleRadius} ${pitch.circleRadius} 0 0 0 ${rightPenaltyX} ${arcBottom}`}
          {...lineProps}
        />

        <path
          d={`M0 ${pitch.cornerRadius}A${pitch.cornerRadius} ${pitch.cornerRadius} 0 0 0 ${pitch.cornerRadius} 0`}
          {...lineProps}
        />
        <path
          d={`M${pitch.length - pitch.cornerRadius} 0A${pitch.cornerRadius} ${pitch.cornerRadius} 0 0 0 ${pitch.length} ${pitch.cornerRadius}`}
          {...lineProps}
        />
        <path
          d={`M0 ${pitch.width - pitch.cornerRadius}A${pitch.cornerRadius} ${pitch.cornerRadius} 0 0 1 ${pitch.cornerRadius} ${pitch.width}`}
          {...lineProps}
        />
        <path
          d={`M${pitch.length - pitch.cornerRadius} ${pitch.width}A${pitch.cornerRadius} ${pitch.cornerRadius} 0 0 1 ${pitch.length} ${pitch.width - pitch.cornerRadius}`}
          {...lineProps}
        />
      </g>
    </svg>
  )
}
