import type { TeamSide } from "@/types/match"

export type PinnedPlayersState = {
  ids: Partial<Record<TeamSide, number>>
  attackingSide?: TeamSide
}

type MatchPinScope = {
  matchId?: string
  home: { uid?: number; clubUid?: number; name: string }
  away: { uid?: number; clubUid?: number; name: string }
}

export function pinnedPlayerMatchScopeKey(match?: MatchPinScope | null) {
  if (!match) return null
  const matchId = match.matchId?.trim()
  if (matchId) return `match:${matchId}`
  return `teams:${JSON.stringify([
    match.home.uid ?? match.home.clubUid ?? match.home.name,
    match.away.uid ?? match.away.clubUid ?? match.away.name,
  ])}`
}

export function updatePinnedPlayer(
  current: PinnedPlayersState,
  side: TeamSide,
  playerId?: number,
): PinnedPlayersState {
  if (playerId == null) {
    if (current.attackingSide === side) return { ids: {} }
    return { ...current, ids: { ...current.ids, [side]: undefined } }
  }

  const defendingSide = side === "home" ? "away" : "home"
  if (
    current.attackingSide === side &&
    current.ids[defendingSide] != null &&
    current.ids[side] !== playerId
  ) {
    return { attackingSide: side, ids: { [side]: playerId } }
  }

  return {
    attackingSide: current.attackingSide ?? side,
    ids: { ...current.ids, [side]: playerId },
  }
}
