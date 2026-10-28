import type { TacticalEventPoint, TeamSide } from "@/types/match"

export type MomentumEventMapCell = {
  row: number
  column: number
  team: TeamSide
  count: number
  percentage: number
  opacity: number
}

export type MomentumEventMapData = {
  cells: MomentumEventMapCell[]
  totals: Record<TeamSide, number>
  maximumCount: number
}

export function buildMomentumEventMap(
  events: readonly TacticalEventPoint[],
): MomentumEventMapData {
  const cells: MomentumEventMapCell[] = Array.from({ length: 18 }, (_, index) => ({
    row: Math.floor(index / 6),
    column: index % 6,
    team: index % 6 < 3 ? "away" : "home",
    count: 0,
    percentage: 0,
    opacity: 0,
  }))
  const totals: Record<TeamSide, number> = { home: 0, away: 0 }
  const latestEvents = new Map<string, TacticalEventPoint>()
  for (const event of events) {
    const key = event.sequenceIndex == null ? `id:${event.id}` : `sequence:${event.sequenceIndex}`
    latestEvents.set(key, event)
  }

  for (const event of latestEvents.values()) {
    const { x, y } = event
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 100 || y < 0 || y > 100) continue

    // Tactical coordinates already normalize changes of ends: home attacks right,
    // away attacks left. Recover the attacking-relative native longitudinal zone.
    const relativeX = event.team === "home" ? 100 - x : x
    if (relativeX >= 50) continue
    const zone = relativeX >= 100 / 3 ? 3 : relativeX >= 100 / 6 ? 4 : 5
    // Match the positive entries in Memory/MomentumCalculator.cs: successful
    // passes and touches in zones 3–5, and shot events only in zones 4–5.
    const weighted = event.nativeEventType === 7 || event.nativeEventType === 54
      || (event.nativeEventType >= 1 && event.nativeEventType <= 5 && zone >= 4)
    if (!weighted) continue

    const row = Math.min(2, Math.floor(y * 3 / 100))
    const column = event.team === "home" ? zone : 5 - zone
    cells[row * 6 + column].count += 1
    totals[event.team] += 1
  }

  const maximumCount = Math.max(...cells.map((cell) => cell.count))
  for (const cell of cells) {
    cell.percentage = totals[cell.team] === 0 ? 0 : cell.count / totals[cell.team] * 100
    cell.opacity = maximumCount === 0 ? 0 : cell.count / maximumCount
  }
  return { cells, totals, maximumCount }
}
