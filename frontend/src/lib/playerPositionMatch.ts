import type { MatchPlayer } from "@/types/match"

export type PositionMatchKind = "formation" | "matchup"

type PositionPoint = {
  depth: number
  lane: number
}

const maximumDepth = 5

export function findNearestPositionPlayerIds(
  source: MatchPlayer,
  candidates: readonly MatchPlayer[],
  kind: PositionMatchKind,
) {
  if (!source.isOnPitch) return new Set<number>()
  const sourcePoint = positionPoint(source.inPossession?.position)
  if (!sourcePoint) return new Set<number>()
  const sourceIsGoalkeeper = isGoalkeeperPosition(source.inPossession?.position)
  const distances = candidates
    .filter((candidate) => candidate.isOnPitch)
    .flatMap((candidate) => {
      const candidatePosition = candidate.outOfPossession?.position
      const candidatePoint = positionPoint(candidatePosition)
      if (!candidatePoint || isGoalkeeperPosition(candidatePosition) !== sourceIsGoalkeeper) return []
      return [{
        id: candidate.id,
        distance: positionDistance(sourcePoint, candidatePoint, kind),
      }]
    })
    .filter((candidate): candidate is { id: number; distance: number } => candidate.distance != null)

  if (distances.length === 0) return new Set<number>()
  const nearest = Math.min(...distances.map(({ distance }) => distance))
  return new Set(
    distances
      .filter(({ distance }) => Math.abs(distance - nearest) < 0.000_001)
      .map(({ id }) => id),
  )
}

function isGoalkeeperPosition(position?: string) {
  return position?.trim().toUpperCase() === "GK"
}

function positionDistance(
  sourcePoint: PositionPoint,
  candidatePoint: PositionPoint,
  kind: PositionMatchKind,
) {
  const comparedCandidate = kind === "matchup"
    ? { depth: maximumDepth - candidatePoint.depth, lane: -candidatePoint.lane }
    : candidatePoint
  return Math.hypot(
    sourcePoint.depth - comparedCandidate.depth,
    sourcePoint.lane - comparedCandidate.lane,
  )
}

function positionPoint(rawPosition?: string): PositionPoint | undefined {
  const position = rawPosition?.trim().toUpperCase()
  if (!position) return undefined

  const depth = position === "GK"
    ? 0
    : position === "SW"
      ? 0.5
      : position.startsWith("WB")
        ? 1.5
        : position.startsWith("DM")
          ? 2
          : position.startsWith("AM")
            ? 4
            : position.startsWith("ST")
              ? 5
              : position.startsWith("M")
                ? 3
                : position.startsWith("D")
                  ? 1
                  : undefined
  if (depth == null) return undefined

  const lane = ["DR", "WBR", "MR", "AMR"].includes(position)
    ? -2
    : ["DCR", "DMR", "MCR", "AMCR", "STR"].includes(position)
      ? -1
      : ["DCL", "DML", "MCL", "AMCL", "STL"].includes(position)
        ? 1
        : ["DL", "WBL", "ML", "AML"].includes(position)
          ? 2
          : 0
  return { depth, lane }
}
