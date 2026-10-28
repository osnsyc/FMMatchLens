import type { MomentumEventMapData } from "@/lib/momentumEventMap"
import type { TeamSide } from "@/types/match"

type LaneShare = {
  row: number
  count: number
  percentage: number
}

export function calculateMomentumLaneShares(
  data: MomentumEventMapData,
): Record<TeamSide, LaneShare[]> {
  const lanes = (): LaneShare[] => Array.from({ length: 3 }, (_, row) => ({
    row, count: 0, percentage: 0,
  }))
  const shares = { home: lanes(), away: lanes() }
  for (const cell of data.cells) {
    const lane = shares[cell.team][cell.row]
    lane.count += cell.count
    // Sum displayed tenths so the arrow matches its three visible cell labels.
    lane.percentage += Math.round(cell.percentage * 10)
  }
  for (const team of ["home", "away"] as const) {
    for (const lane of shares[team]) lane.percentage /= 10
  }
  return shares
}
