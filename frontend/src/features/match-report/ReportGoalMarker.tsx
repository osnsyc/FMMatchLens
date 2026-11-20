import { goalIconUrl } from "@/lib/goalIcon"

// Keep the entire marker in SVG. Nested HTML/foreignObject controls acquire
// incorrect intrinsic image sizes when html-to-image serializes the chart.
export function ReportGoalMarker({
  x,
  y,
  size,
  color,
  title,
}: {
  x: number
  y: number
  size: number
  color: string
  title: string
}) {
  return (
    <g data-report-goal-marker>
      <title>{title}</title>
      <circle
        cx={x + size / 2}
        cy={y + size / 2}
        r={size / 2}
        fill="var(--background)"
        stroke={color}
        strokeWidth={1}
      />
      <image
        href={goalIconUrl}
        x={x + 2}
        y={y + 2}
        width={size - 4}
        height={size - 4}
        preserveAspectRatio="xMidYMid meet"
      />
    </g>
  )
}
