import type { MatchEventType, MatchSnapshot, TeamSide } from "@/types/match"

type TimelineEventKind = MatchEventType | "substitution"

export type TimelineEvent = {
  id: string
  type: TimelineEventKind
  minute: number
  tick?: number
  team: TeamSide
  label: string
  primaryPeople: string[]
  secondaryPeople: string[]
  occurrences: number
}

export function buildTimelineEvents(
  match: MatchSnapshot,
  t: (key: string) => string,
  options: { groupSimultaneous?: boolean } = {}
) {
  const playerById = new Map(match.players.map((player) => [player.id, player]))
  const goals = match.events
    .filter((event) => event.type === "goal")
    .map((event) => ({
      event,
      team: event.team ?? playerById.get(event.playerId ?? -1)?.team,
    }))
  const assistantsByGoal = new Map<string, string[]>()
  for (const assist of match.events) {
    if (assist.type !== "assist_candidate") continue
    const team = assist.team ?? playerById.get(assist.playerId ?? -1)?.team
    let closest: (typeof goals)[number] | undefined
    let closestDistance = Number.POSITIVE_INFINITY
    for (const goal of goals) {
      const distance = Math.abs(goal.event.minute - assist.minute)
      if (goal.team === team && distance <= 2 && distance < closestDistance) {
        closest = goal
        closestDistance = distance
      }
    }
    const assistant = playerById.get(assist.playerId ?? -1)?.name
    if (!closest || !assistant) continue
    const names = assistantsByGoal.get(closest.event.id) ?? []
    names.push(assistant)
    assistantsByGoal.set(closest.event.id, names)
  }

  const matchEvents = match.events
    .filter(
      (event) =>
        event.type === "goal" ||
        event.type === "own_goal" ||
        event.type === "yellow_card" ||
        event.type === "red_card"
    )
    .map((event): TimelineEvent | null => {
      const player = playerById.get(event.playerId ?? -1)
      const team = event.team ?? player?.team
      if (!team) return null

      const eventLabel = labelForEvent(event.type, t)
      return {
        id: event.id,
        type: event.type,
        minute: event.minute,
        tick: event.tick,
        team,
        label: eventLabel,
        primaryPeople: player?.name ? [player.name] : [],
        secondaryPeople:
          event.type === "goal" ? (assistantsByGoal.get(event.id) ?? []) : [],
        occurrences: 1,
      }
    })
    .filter((event): event is TimelineEvent => event != null)

  const substitutionEvents = buildSubstitutionEvents(match, t)
  const events = [...matchEvents, ...substitutionEvents].sort(
    (left, right) =>
      left.minute - right.minute || (left.tick ?? 0) - (right.tick ?? 0)
  )
  // The report lists each substitution pair and goal on its own row.
  if (options.groupSimultaneous === false) return events

  const grouped = new Map<string, TimelineEvent>()
  for (const event of events) {
    const key = `${event.team}-${event.minute}-${event.type}`
    const existing = grouped.get(key)
    if (existing) {
      existing.occurrences += event.occurrences
      for (const person of event.primaryPeople) {
        if (!existing.primaryPeople.includes(person))
          existing.primaryPeople.push(person)
      }
      for (const person of event.secondaryPeople) {
        if (!existing.secondaryPeople.includes(person))
          existing.secondaryPeople.push(person)
      }
    } else {
      grouped.set(key, {
        ...event,
        id: key,
        primaryPeople: [...event.primaryPeople],
        secondaryPeople: [...event.secondaryPeople],
      })
    }
  }

  return [...grouped.values()].sort((left, right) => left.minute - right.minute)
}

function buildSubstitutionEvents(
  match: MatchSnapshot,
  t: (key: string) => string
): TimelineEvent[] {
  const result: TimelineEvent[] = []

  for (const team of ["home", "away"] as const) {
    const entering = match.players
      .filter(
        (player) =>
          player.team === team && player.status?.subbedOnMinute != null
      )
      .map((player) => ({ player, minute: player.status!.subbedOnMinute! }))
      .sort((left, right) => left.minute - right.minute)
    const leaving = match.players
      .filter(
        (player) =>
          player.team === team && player.status?.subbedOffMinute != null
      )
      .map((player) => ({ player, minute: player.status!.subbedOffMinute! }))
      .sort((left, right) => left.minute - right.minute)
    const usedEntering = new Set<number>()

    for (const off of leaving) {
      let pairedIndex = -1
      let smallestGap = Number.POSITIVE_INFINITY
      entering.forEach((on, index) => {
        const gap = Math.abs(on.minute - off.minute)
        if (!usedEntering.has(index) && gap <= 2 && gap < smallestGap) {
          pairedIndex = index
          smallestGap = gap
        }
      })

      const on = pairedIndex >= 0 ? entering[pairedIndex] : undefined
      if (pairedIndex >= 0) usedEntering.add(pairedIndex)
      result.push({
        id: `sub-${team}-${off.player.id}-${on?.player.id ?? "none"}`,
        type: "substitution",
        minute: Math.min(off.minute, on?.minute ?? off.minute),
        team,
        label: t("timeline.substitution"),
        occurrences: 1,
        primaryPeople: on ? [on.player.name] : [],
        secondaryPeople: [off.player.name],
      })
    }

    entering.forEach((on, index) => {
      if (!usedEntering.has(index)) {
        result.push({
          id: `sub-${team}-none-${on.player.id}`,
          type: "substitution",
          minute: on.minute,
          team,
          label: t("timeline.substitution"),
          occurrences: 1,
          primaryPeople: [on.player.name],
          secondaryPeople: [],
        })
      }
    })
  }

  return result
}

function labelForEvent(type: MatchEventType, t: (key: string) => string) {
  switch (type) {
    case "goal":
      return t("squad.goal")
    case "own_goal":
      return t("squad.ownGoal")
    case "yellow_card":
      return t("squad.yellowCard")
    case "red_card":
      return t("squad.redCard")
    default:
      return type
  }
}
