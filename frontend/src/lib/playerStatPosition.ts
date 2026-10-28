import { playerPositionLabels, type MatchPlayer, type PlayerPosition } from "@/types/match"

const tacticalPositions: Partial<Record<string, PlayerPosition>> = {
  DCL: "DC", DCR: "DC",
  DMC: "DM", DML: "DM", DMR: "DM",
  MCL: "MC", MCR: "MC",
  AMCL: "AMC", AMCR: "AMC",
  STL: "ST", STR: "ST",
}

/** Prefer the current tactical position, then the strongest familiar position. */
export function playerStatPosition(player: MatchPlayer): string {
  for (const position of [player.inPossession?.position, player.outOfPossession?.position, player.position]) {
    if (!position) continue
    const normalized = tacticalPositions[position] ?? playerPositionLabels.find((label) => label === position)
    if (normalized) return normalized
  }
  let bestPosition: string | undefined
  let bestFamiliarity = 0
  for (const position of playerPositionLabels) {
    const familiarity = player.positionFamiliarities?.[position] ?? 0
    if (familiarity > bestFamiliarity) {
      bestPosition = position
      bestFamiliarity = familiarity
    }
  }
  return bestPosition ?? "-"
}
