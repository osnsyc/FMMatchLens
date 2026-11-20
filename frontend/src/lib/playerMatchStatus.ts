import type { MatchEvent, MatchPlayer } from "@/types/match"

export type StatusIcon =
  | "goal"
  | "own-goal"
  | "assist"
  | "sub-on"
  | "sub-off"
  | "yellow-card"
  | "red-card"

export type PlayerStatus = {
  key: string
  label: string
  icon: StatusIcon
  minutes?: number[]
  count?: number
  className?: string
}

export function getPlayerMatchStatuses(
  player: MatchPlayer,
  events: readonly MatchEvent[],
  t: (key: string) => string
): PlayerStatus[] {
  const minutesFor = (player: MatchPlayer, type: MatchEvent["type"]) =>
    events
      .filter((event) => event.playerId === player.id && event.type === type)
      .map((event) => event.minute)

  const statuses: PlayerStatus[] = []

  if (player.status?.ownGoals) {
    statuses.push({
      key: "own-goal",
      label: t("squad.ownGoal"),
      icon: "own-goal",
      className: "text-status-negative",
      minutes: minutesFor(player, "own_goal"),
      count: player.status.ownGoals,
    })
  }

  if (player.status?.subbedOnMinute) {
    statuses.push({
      key: "on",
      label: t("squad.subbedOn"),
      icon: "sub-on",
      className: "text-status-positive",
      minutes: [player.status.subbedOnMinute],
    })
  }

  if (player.status?.subbedOffMinute) {
    statuses.push({
      key: "off",
      label: t("squad.subbedOff"),
      icon: "sub-off",
      className: "text-status-negative",
      minutes: [player.status.subbedOffMinute],
    })
  }

  if (player.stats.goals) {
    statuses.push({
      key: "goal",
      label: t("squad.goal"),
      icon: "goal",
      className: "text-foreground",
      minutes: minutesFor(player, "goal"),
      count: player.stats.goals,
    })
  }

  if (player.stats.assists) {
    statuses.push({
      key: "assist",
      label: t("squad.assist"),
      icon: "assist",
      className: "text-primary",
      minutes: minutesFor(player, "assist_candidate"),
      count: player.stats.assists,
    })
  }

  const yellowCardMinutes = minutesFor(player, "yellow_card")
  if (yellowCardMinutes.length > 0) {
    statuses.push({
      key: "yellow-card",
      label: t("squad.yellowCard"),
      icon: "yellow-card",
      className: "text-status-warning",
      minutes: yellowCardMinutes,
      count: yellowCardMinutes.length,
    })
  }

  const redCardMinutes = minutesFor(player, "red_card")
  if (redCardMinutes.length > 0) {
    statuses.push({
      key: "red-card",
      label: t("squad.redCard"),
      icon: "red-card",
      className: "text-status-negative",
      minutes: redCardMinutes,
      count: redCardMinutes.length,
    })
  }

  return statuses
}
