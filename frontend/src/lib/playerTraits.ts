const playerTraitBits = [
  [0, "runsWithBallDownLeft"], [1, "runsWithBallDownRight"], [2, "runsWithBallDownCenter"],
  [3, "getsIntoOppositionArea"], [4, "movesIntoChannels"], [5, "getsForwardWheneverPossible"],
  [6, "playsShortSimplePasses"], [7, "triesKillerBallsOften"], [8, "shootsFromDistance"],
  [9, "shootsWithPower"], [10, "placesShots"], [11, "curlsBall"], [12, "likesToRoundKeeper"],
  [13, "likesToTryToBreakOffsideTrap"], [14, "usesOutsideOfFoot"], [15, "marksOpponentTightly"],
  [16, "windsUpOpponents"], [17, "arguesWithOfficials"], [18, "playsWithBackToGoal"],
  [19, "comesDeepToGetBall"], [20, "playsOneTwos"], [21, "likesToLobKeeper"], [22, "dictatesTempo"],
  [23, "attemptsOverheadKicks"], [24, "looksForPassRatherThanAttemptingToScore"],
  [25, "playsNoThroughBalls"], [26, "stopsPlay"], [27, "knocksBallPastOpponent"],
  [28, "movesBallToRightFootBeforeDribbleAttempt"], [29, "movesBallToLeftFootBeforeDribbleAttempt"],
  [30, "dwellsOnBall"], [31, "arrivesLateInOpponentsArea"], [32, "triesToPlayWayOutOfTrouble"],
  [33, "staysBackAtAllTimes"], [34, "avoidsUsingWeakerFoot"], [35, "triesTricks"],
  [36, "triesLongRangeFreeKicks"], [37, "divesIntoTackles"], [38, "doesNotDiveIntoTackles"],
  [39, "cutsInsideFromBothWings"], [40, "hugsLine"], [41, "getsCrowdGoing"],
  [42, "triesFirstTimeShots"], [43, "triesLongRangePasses"], [44, "likesBallPlayedIntoFeet"],
  [45, "hitsFreeKickWithPower"], [46, "likesToBeatManRepeatedly"],
  [47, "likesToSwitchBallToOtherFlank"], [50, "possessesLongFlatThrow"], [51, "runsWithBallOften"],
  [52, "runsWithBallRarely"], [54, "doesNotMoveIntoChannels"],
  [55, "usesLongThrowToStartCounterAttacks"], [56, "refrainsFromTakingLongShots"],
  [57, "cutsInsideFromLeftWing"], [58, "cutsInsideFromRightWing"], [59, "crossesEarly"],
  [60, "bringsBallOutOfDefense"], [63, "playsBallWithFeet"],
] as const

export type PlayerTraitKey = (typeof playerTraitBits)[number][1]

export function decodePlayerTraits(rawTraits?: string): PlayerTraitKey[] {
  if (!rawTraits || !/^[\dA-Fa-f]{16}$/.test(rawTraits)) return []
  const value = BigInt(`0x${rawTraits}`)
  return playerTraitBits
    .filter(([bit]) => (value & (1n << BigInt(bit))) !== 0n)
    .map(([, key]) => key)
}
