import type { MatchPlayer, TeamStats } from "@/types/match"

export function sameTeamStats(left: TeamStats, right: TeamStats) {
  if (left === right) return true
  const keys = Object.keys(left) as Array<keyof TeamStats>
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.is(left[key], right[key]))
  )
}

/** Player fields used by event labels and tactical marker annotations. */
export function samePlayerLabels(
  left: readonly MatchPlayer[],
  right: readonly MatchPlayer[]
) {
  return (
    left === right ||
    (left.length === right.length &&
      left.every((player, index) => {
        const candidate = right[index]
        return (
          player.id === candidate?.id &&
          player.uid === candidate.uid &&
          player.name === candidate.name &&
          player.team === candidate.team &&
          player.shirtNumber === candidate.shirtNumber
        )
      }))
  )
}

/** Player fields that can change the formation layout or its labels. */
export function sameFormationPlayers(
  left: readonly MatchPlayer[],
  right: readonly MatchPlayer[]
) {
  return (
    left === right ||
    (left.length === right.length &&
      left.every((player, index) => {
        const candidate = right[index]
        return (
          player.id === candidate?.id &&
          player.name === candidate.name &&
          player.team === candidate.team &&
          player.shirtNumber === candidate.shirtNumber &&
          player.isOnPitch === candidate.isOnPitch &&
          player.status?.subbedOnMinute === candidate.status?.subbedOnMinute &&
          player.status?.subbedOffMinute ===
            candidate.status?.subbedOffMinute &&
          player.inPossession === candidate.inPossession &&
          player.outOfPossession === candidate.outOfPossession
        )
      }))
  )
}

/** All squad-facing player fields, intentionally excluding live coordinates. */
export function sameSquadPlayers(
  left: readonly MatchPlayer[],
  right: readonly MatchPlayer[]
) {
  return (
    left === right ||
    (left.length === right.length &&
      left.every((player, index) => {
        const candidate = right[index]
        return candidate != null && sameSquadPlayer(player, candidate)
      }))
  )
}

function sameSquadPlayer(left: MatchPlayer, right: MatchPlayer) {
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
    sameOptionalRecord(left.status, right.status) &&
    sameOptionalRecord(left.stats, right.stats)
  )
}

function sameOptionalRecord(
  left: object | undefined,
  right: object | undefined
) {
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
