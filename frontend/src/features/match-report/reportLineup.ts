import type { MatchPlayer, MatchSnapshot, TeamSide } from "@/types/match"

export function reportLineup(match: MatchSnapshot, side: TeamSide) {
  const team = match.players.filter((player) => player.team === side)
  const snapshots = [...(match.formationSnapshots ?? [])].sort(
    (a, b) => a.tick - b.tick
  )
  const first = snapshots.find((snapshot) =>
    snapshot.players.some((player) => player.team === side && player.isStarter)
  )
  const original =
    first?.players.filter(
      (player) => player.team === side && player.isStarter
    ) ?? team.filter((player) => player.isStarter)
  const starters = original.map((initial): MatchPlayer => {
    const final = team.find(
      (player) =>
        player.id === initial.id ||
        (initial.uid != null && player.uid === initial.uid)
    )
    // Keep final match counters/status, but restore the initial players and roles.
    return {
      ...initial,
      ...final,
      inPossession: initial.inPossession ?? final?.inPossession,
      outOfPossession: initial.outOfPossession ?? final?.outOfPossession,
      isStarter: true,
      isOnPitch: true,
    }
  })
  const ids = new Set(starters.map((player) => player.id))
  return { starters, substitutes: team.filter((player) => !ids.has(player.id)) }
}

export function substitutePlayed(player: MatchPlayer) {
  return player.status?.subbedOnMinute != null || player.isOnPitch
}
