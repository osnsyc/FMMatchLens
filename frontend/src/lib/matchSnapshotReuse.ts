import type { MatchPlayer, MatchSnapshot } from "@/types/match"

export function reuseMatchSnapshot(
  previous: MatchSnapshot | undefined,
  next: MatchSnapshot
): MatchSnapshot {
  if (!previous || previous.matchId !== next.matchId) return next
  const homeStats = reuseFlatObject(previous.home.stats, next.home.stats)
  const awayStats = reuseFlatObject(previous.away.stats, next.away.stats)
  return {
    ...next,
    clock: reuseFlatObject(previous.clock, next.clock),
    score: reuseFlatObject(previous.score, next.score),
    home: reuseTeam(previous.home, { ...next.home, stats: homeStats }),
    away: reuseTeam(previous.away, { ...next.away, stats: awayStats }),
    players: reusePlayers(previous.players, next.players),
  }
}

function reuseTeam(
  previous: MatchSnapshot["home"],
  next: MatchSnapshot["home"]
) {
  return previous.uid === next.uid &&
    previous.clubUid === next.clubUid &&
    previous.name === next.name &&
    previous.color === next.color &&
    previous.themeColors?.light === next.themeColors?.light &&
    previous.themeColors?.dark === next.themeColors?.dark &&
    previous.logoPath === next.logoPath &&
    previous.logoUrl === next.logoUrl &&
    previous.manager === next.manager &&
    previous.formation === next.formation &&
    previous.stats === next.stats
    ? previous
    : next
}

function reusePlayers(previous: MatchPlayer[], next: MatchPlayer[]) {
  if (previous.length !== next.length) return next
  let allStable = true
  const reused = next.map((player, index) => {
    const prior = previous[index]
    if (prior && samePlayer(prior, player)) return prior
    allStable = false
    return player
  })
  return allStable ? previous : reused
}

function samePlayer(left: MatchPlayer, right: MatchPlayer) {
  return (
    left.id === right.id &&
    left.uid === right.uid &&
    left.name === right.name &&
    left.fullName === right.fullName &&
    left.portraitPath === right.portraitPath &&
    left.portraitUrl === right.portraitUrl &&
    left.team === right.team &&
    left.shirtNumber === right.shirtNumber &&
    left.position === right.position &&
    left.positionFamiliarities === right.positionFamiliarities &&
    left.inPossession === right.inPossession &&
    left.outOfPossession === right.outOfPossession &&
    left.rating === right.rating &&
    left.age === right.age &&
    left.isStarter === right.isStarter &&
    left.isOnPitch === right.isOnPitch &&
    left.profile === right.profile &&
    left.attributes === right.attributes &&
    sameFlatObject(left.coordinate, right.coordinate) &&
    sameFlatObject(left.status, right.status) &&
    sameFlatObject(left.stats, right.stats)
  )
}

function reuseFlatObject<T extends object>(previous: T, next: T): T {
  return sameFlatObject(previous, next) ? previous : next
}

function sameFlatObject(left: object | undefined, right: object | undefined) {
  if (left === right) return true
  if (!left || !right) return false
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const keys = Object.keys(leftRecord)
  return (
    keys.length === Object.keys(rightRecord).length &&
    keys.every((key) => Object.is(leftRecord[key], rightRecord[key]))
  )
}
