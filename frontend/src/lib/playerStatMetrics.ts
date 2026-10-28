import type { MatchPlayer, PlayerStats, PlayerSeasonStatsSlot, PlayerSeasonDetailedStats } from "@/types/match"

export type PlayerMetric = {
  id: string
  value: (player: MatchPlayer) => number | undefined
  seasonValue?: (stats: PlayerSeasonStatsSlot) => number | undefined
  format?: (value: number) => string
  lowerIsBetter?: boolean
}

const integer = (value: number) => Math.round(value).toString()
const decimal = (value: number) => value.toFixed(2)
const percent = (value: number) => `${value.toFixed(1)}%`
const metric = (id: keyof PlayerStats, detailed?: keyof PlayerSeasonDetailedStats, slot?: keyof PlayerSeasonStatsSlot, lowerIsBetter = false): PlayerMetric => ({
  id, value: (player) => player.stats[id], format: integer, lowerIsBetter,
  seasonValue: detailed ? (stats) => stats.detailed?.[detailed] : slot ? (stats) => {
    const value = stats[slot]
    return typeof value === "number" ? value : undefined
  } : undefined,
})
const seasonOnly = (id: string, detailed?: keyof PlayerSeasonDetailedStats, slot?: keyof PlayerSeasonStatsSlot, scale = 1, lowerIsBetter = false): PlayerMetric => ({
  id, value: () => undefined, lowerIsBetter, format: scale === 1 ? integer : decimal,
  seasonValue: (stats) => {
    const value = detailed ? stats.detailed?.[detailed] : slot ? stats[slot] : undefined
    return typeof value === "number" ? value / scale : undefined
  },
})
const rate = (id: string, won: keyof PlayerStats, attempted: keyof PlayerStats, seasonWon: keyof PlayerSeasonDetailedStats, seasonAttempted: keyof PlayerSeasonDetailedStats): PlayerMetric => ({
  id, format: percent,
  value: (player) => ratio(player.stats[won], player.stats[attempted]),
  seasonValue: (stats) => ratio(stats.detailed?.[seasonWon], stats.detailed?.[seasonAttempted]),
})
function ratio(won?: number, attempted?: number) {
  return won == null || attempted == null ? undefined : attempted > 0 ? won / attempted * 100 : 0
}
const rating: PlayerMetric = {
  id: "rating", value: (player) => player.rating, format: decimal,
  seasonValue: (stats) => stats.ratingSumTimes10 != null && (stats.appearances ?? 0) > 0
    ? stats.ratingSumTimes10 / stats.appearances! / 10 : undefined,
}
const xg: PlayerMetric = { ...metric("xg", "expectedGoalsTimes100"), format: decimal, seasonValue: (stats) => stats.detailed?.expectedGoalsTimes100 == null ? undefined : stats.detailed.expectedGoalsTimes100 / 100 }
const xa: PlayerMetric = { ...metric("xa", "expectedAssistsTimes100"), format: decimal, seasonValue: (stats) => stats.detailed?.expectedAssistsTimes100 == null ? undefined : stats.detailed.expectedAssistsTimes100 / 100 }
const distance: PlayerMetric = {
  id: "distance", value: (player) => player.stats.distanceM == null ? undefined : player.stats.distanceM / 1000,
  seasonValue: (stats) => stats.detailed?.distanceKmTimes10 == null ? undefined : stats.detailed.distanceKmTimes10 / 10,
  format: (value) => `${value.toFixed(2)} km`,
}
const goals = metric("goals", undefined, "goals")
const assists = metric("assists", undefined, "assists")
const chances = metric("chancesCreated", "chancesCreated")
const passRate = rate("passAccuracy", "passesCompleted", "passes", "passesCompleted", "passesAttempted")

export const playerStatGroups = [
  {
    id: "key",
    fields: [
      rating,
      goals,
      xg,
      assists,
      xa,
      chances,
      metric("keyPasses", "keyPasses"),
      metric("dribbles", "dribbles"),
      metric("progressivePasses", "progressivePasses"),
      passRate,
      metric("crossesCompleted", "crossesCompleted"),
      metric("tacklesWon", "tacklesWon"),
      metric("possessionWon", "possessionWon"),
      metric("possessionLost", "possessionLost", undefined, true),
      distance,
    ],
  },
  {
    id: "attack",
    fields: [
      goals,
      xg,
      seasonOnly("nonPenaltyXg", "nonPenaltyExpectedGoalsTimes100", undefined, 100),
      metric("shots", "shots"),
      metric("shotsOnTarget", "shotsOnTarget"),
      rate("shotAccuracy", "shotsOnTarget", "shots", "shotsOnTarget", "shots"),
      metric("blockedShots"),
      metric("hitWoodwork"),
      metric("clearCutChances"),
      metric("shotsOutsideBox", "shotsOutsideBox"),
      seasonOnly("goalsOutsideBox", "goalsOutsideBox"),
      metric("penaltyAttempts", undefined, "penaltyAttempts"),
      metric("penalties", undefined, "penaltiesScored"),
      metric("ownGoals", undefined, undefined, true),
    ],
  },
  {
    id: "creation",
    fields: [
      assists,
      xa,
      metric("openPlayXa"),
      chances,
      metric("keyPasses", "keyPasses"),
      metric("openPlayKeyPasses", "openPlayKeyPasses"),
      metric("dribbles", "dribbles"),
      metric("offsides", "offsides", undefined, true),
    ],
  },
  {
    id: "passing",
    fields: [
      metric("passes", "passesAttempted"),
      metric("passesCompleted", "passesCompleted"),
      passRate,
      metric("progressivePasses", "progressivePasses"),
      metric("crosses", "crossesAttempted"),
      metric("crossesCompleted", "crossesCompleted"),
      rate("crossAccuracy", "crossesCompleted", "crosses", "crossesCompleted", "crossesAttempted"),
      seasonOnly("openPlayCrossesAttempted", "openPlayCrossesAttempted"),
      metric("corners"),
      metric("attackingFreeKicks"),
      metric("defensiveFreeKicks"),
      metric("throwIns"),
    ],
  },
  {
    id: "defence",
    fields: [
      metric("tacklesAttempted", "tacklesAttempted"),
      metric("tacklesWon", "tacklesWon"),
      rate("tackleAccuracy", "tacklesWon", "tacklesAttempted", "tacklesWon", "tacklesAttempted"),
      metric("keyTackles", "keyTackles"),
      metric("interceptions", "interceptions"),
      metric("blocks", "blocks"),
      metric("clearances", "clearances"),
      metric("aerials", "headersAttempted"),
      metric("aerialsWon", "headersWon"),
      rate("aerialAccuracy", "aerialsWon", "aerials", "headersWon", "headersAttempted"),
      metric("pressesAttempted", "pressesAttempted"),
      metric("pressesWon", "pressesWon"),
      rate("pressAccuracy", "pressesWon", "pressesAttempted", "pressesWon", "pressesAttempted"),
      metric("possessionWon", "possessionWon"),
      metric("possessionLost", "possessionLost", undefined, true),
      metric("fouls", "fouls", undefined, true),
      metric("fouled", "fouled"),
      metric("yellowCards", undefined, "yellowCards", true),
      metric("redCards", undefined, "redCards", true),
      seasonOnly("errorsLeadingToGoal", "errorsLeadingToGoal", undefined, 1, true),
    ],
  },
  {
    id: "goalkeeping",
    fields: [
      seasonOnly("goalsPrevented", "goalsPreventedTimes100", undefined, 100),
      metric("goalsConceded", undefined, "goalsConceded", true),
      seasonOnly("cleanSheets", undefined, "cleanSheets"),
      metric("shotsFaced"),
      metric("savesHeld"),
      metric("savesParried"),
      metric("savesTipped"),
      metric("penaltiesFaced"),
      metric("penaltiesSaved"),
    ],
  },
  {
    id: "season",
    fields: [
      seasonOnly("appearances", undefined, "appearances"),
      seasonOnly("starts", undefined, "starts"),
      seasonOnly("substituteAppearances", undefined, "substituteAppearances"),
      seasonOnly("minutes", undefined, "minutes"),
      seasonOnly("wins", "wins"),
      seasonOnly("losses", "losses", undefined, 1, true),
      seasonOnly("teamGoals", "teamGoals"),
      seasonOnly("teamGoalsConceded", "teamGoalsConceded", undefined, 1, true),
      seasonOnly("playerOfMatchAwards", undefined, "playerOfMatchAwards"),
    ],
  },
] satisfies Array<{ id: string; fields: PlayerMetric[] }>

export type StatGroupId = typeof playerStatGroups[number]["id"]
