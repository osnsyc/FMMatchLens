import { useId, useMemo } from "react"
import { useTranslation } from "react-i18next"

import { PitchMarkings } from "@/components/pitch/PitchMarkings"
import { resolvePitchDimensions } from "@/components/pitch/pitchGeometry"
import { calculateMomentumLaneShares } from "@/lib/attackFocus"
import { buildMomentumEventMap } from "@/lib/momentumEventMap"
import type { MatchSnapshot } from "@/types/match"

type MomentumEventMapProps = {
  events: MatchSnapshot["tacticalEvents"]
  home: Pick<MatchSnapshot["home"], "name" | "color">
  away: Pick<MatchSnapshot["away"], "name" | "color">
  pitchDimensions?: MatchSnapshot["pitchDimensions"]
}

export function MomentumEventMap({ events, home, away, pitchDimensions }: MomentumEventMapProps) {
  const { t } = useTranslation()
  const titleId = useId()
  const descriptionId = useId()
  const data = useMemo(() => buildMomentumEventMap(events), [events])
  const laneShares = useMemo(() => calculateMomentumLaneShares(data), [data])
  const dimensions = resolvePitchDimensions(pitchDimensions)
  const width = 600
  const height = width * dimensions.width / dimensions.length
  const rowHeight = height / 3
  const teams = {
    home: { ...home, color: home.color ?? "var(--team-home-fallback)" },
    away: { ...away, color: away.color ?? "var(--team-away-fallback)" },
  }

  return (
    <div className="flex min-h-0 flex-1 px-3 py-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="min-h-0 w-full flex-1"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <title id={titleId}>{t("momentum.eventMap")}</title>
        <desc id={descriptionId}>{t("momentum.eventMapDescription")}</desc>
        <rect width={width} height={height} fill="var(--tactical-pitch-surface)" />
        {data.cells.map((cell) => (
          <rect
            key={`fill-${cell.row}-${cell.column}`}
            x={cell.column * 100}
            y={cell.row * rowHeight}
            width={100}
            height={rowHeight}
            fill={teams[cell.team].color}
            fillOpacity={cell.opacity}
            stroke="var(--border)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <PitchMarkings dimensions={dimensions} className="pointer-events-none h-full w-full" />
        {data.cells.map((cell) => {
          const x = cell.column * 100 + 50
          const y = (cell.row + 0.3) * rowHeight
          const percentage = `${Number(cell.percentage.toFixed(1))}%`
          return (
            <g
              key={`label-${cell.row}-${cell.column}`}
              stroke="var(--surface-page)"
              strokeWidth={3}
              strokeLinejoin="round"
              paintOrder="stroke fill"
            >
              <title>{t("momentum.eventMapCell", {
                team: teams[cell.team].name,
                row: cell.row + 1,
                column: cell.column + 1,
                count: cell.count,
                percentage,
              })}</title>
              <text x={x} y={y - 3} textAnchor="middle" fill="var(--text-primary)" fontSize={20} fontWeight={600} className="tabular-nums">
                {cell.count}
              </text>
              <text x={x} y={y + 17} textAnchor="middle" fill="var(--text-primary)" fontSize={14} className="tabular-nums">
                {percentage}
              </text>
            </g>
          )
        })}
        {(["away", "home"] as const).flatMap((team) => (
          laneShares[team].map((lane) => {
            const row = lane.row
            const x = team === "home" ? 450 : 150
            const y = (row + 0.77) * rowHeight
            const direction = team === "home" ? 1 : -1
            const tip = x + direction * 110
            return (
              <g key={`attack-focus-${team}-${lane.row}`}>
                <title>{`${teams[team].name} · ${t("dataMap.attackFocus")} · ${lane.percentage}%`}</title>
                <path
                  d={`M ${x - direction * 110} ${y} H ${x - direction * 28} M ${x + direction * 28} ${y} H ${tip} M ${tip - direction * 8} ${y - 6} L ${tip} ${y} L ${tip - direction * 8} ${y + 6}`}
                  fill="none"
                  stroke="var(--text-primary)"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <text
                  x={x}
                  y={y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="var(--text-primary)"
                  stroke="var(--surface-page)"
                  strokeWidth={3}
                  strokeLinejoin="round"
                  paintOrder="stroke fill"
                  fontSize={20}
                  fontWeight={600}
                  className="tabular-nums"
                >
                  {lane.percentage}%
                </text>
              </g>
            )
          })
        ))}
      </svg>
    </div>
  )
}
