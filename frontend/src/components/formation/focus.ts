import policy from "@/components/formation/data/instructionPolicy"
import lookup from "@/components/formation/data/instructionOptions"
import { teamOptions } from "@/components/formation/data/instructionDefinitions"
import {
  instructionIcon,
  type TacticalIconName,
} from "@/components/formation/data/tacticIcons"
import type { DecodedTacticalSnapshot } from "@/components/formation/tactics"
import type { MatchPlayer, MatchSnapshot, TeamSide } from "@/types/match"

export type FocusConfiguration = NonNullable<
  DecodedTacticalSnapshot["home"]["processing"]
>
export type FocusPhase = "inPossession" | "outOfPossession"
export function focusFormationPositions(
  match: Pick<MatchSnapshot, "tactics"> & {
    players: readonly Pick<
      MatchPlayer,
      "id" | "team" | "isOnPitch" | "inPossession" | "outOfPossession"
    >[]
  },
  side: TeamSide,
  phase: FocusPhase,
  fallback?: readonly {
    playerId: number
    position: string
    positionMask: number
  }[]
) {
  const native = match.tactics?.[side].processing?.[phase]
  if (native)
    return native.positions.map((p) => ({
      slot: p.slot,
      position: p.position,
      positionMask: p.raw.positionMask,
      playerIds: p.players
        .filter((binding) =>
          match.players.some(
            (player) =>
              player.team === side &&
              player.isOnPitch &&
              player.id === binding.playerId &&
              player[phase]?.positionMask === p.raw.positionMask
          )
        )
        .map((player) => player.playerId),
    }))
  // Reuse the normal panel's substitution repair when supplied by FormationPitch.
  if (fallback)
    return fallback.map((p, slot) => ({
      slot,
      position: p.position,
      positionMask: p.positionMask,
      playerIds: [p.playerId],
    }))
  // Older archives still contain formation assignments, but no tactical instruction snapshot.
  return match.players
    .filter((p) => p.team === side && p.isOnPitch && p[phase])
    .map((p, slot) => ({
      slot,
      position: p[phase]!.position,
      positionMask: p[phase]!.positionMask,
      playerIds: [p.id],
    }))
}
export const oppositionDimensions = [
  "marking",
  "pressing",
  "tackling",
  "foot",
] as const
export type OppositionDimension = (typeof oppositionDimensions)[number]

/** Direct keys, not inclusive-range extrapolation: out-of-domain values stay unknown. */
export function oppositionOption(
  dimension: OppositionDimension,
  value: number
) {
  const option = lookup.opposition[dimension].options.find(
    (o) => o.value === value
  )
  return {
    value,
    state: option?.state ?? "unknown",
    icon: option?.icon as TacticalIconName | undefined,
  }
}

export function instructionLevel(
  family: "team" | "player",
  id: number | undefined
) {
  const group = lookup.instructionGroups.find(
    (g) => g.family === family && g.choices.some((c) => c.id === id && id !== 0)
  )
  return group
    ? {
        count: group.choices.length,
        selected: group.choices.findIndex((c) => c.id === id),
      }
    : { count: 1, selected: -1 }
}

export type FocusInstruction = {
  rawBit?: number
  id: number | undefined
  key: string
  family: "team" | "player"
  labelKey: string
  groupKey: string
  icon: TacticalIconName | undefined
  level: { count: number; selected: number }
  state:
    | "explicit"
    | "defaultInstruction"
    | "forcedInstruction"
    | "restrictedInstruction"
    | "policyUnknown"
    | "conflictingInstructions"
  locked: boolean
  choices: {
    id: number
    icon: TacticalIconName
    labelKey: string
    policy?: number
  }[]
}
const teamGroupPhase = (phase: number | null) =>
  [4, 5, 7, 10].includes(phase ?? -1) ? "outOfPossession" : "inPossession"
const teamChoiceLabel = (id: number, group: string) => {
  const entry = teamOptions.find((option) => option.id === id)
  return entry
    ? `teamTactics.teamInstructions.${entry.bit}`
    : `teamTactics.teamDefaults.${group}`
}

/** One current card for every UI group, including the unique non-bit default. */
export function focusTeamInstructions(
  config: FocusConfiguration,
  phase: FocusPhase
): FocusInstruction[] {
  const groups = lookup.instructionGroups.filter(
    (g) => g.family === "team" && teamGroupPhase(g.phase) === phase
  )
  const result: FocusInstruction[] = groups.flatMap((group) => {
    const active = group.choices.filter((choice) =>
      config.teamInstructions.some((i) => i.id === choice.id)
    )
    const defaults = group.choices.filter(
      (choice) => !teamOptions.some((option) => option.id === choice.id)
    )
    const selected = active.length
      ? active
      : defaults.length === 1
        ? defaults
        : [undefined]
    return selected.map((choice) => ({
      id: choice?.id,
      key: `team-${group.group}-${choice?.id ?? "unknown"}`,
      family: "team",
      groupKey: `teamTactics.teamGroups.${group.group}`,
      labelKey: choice
        ? teamChoiceLabel(choice.id, group.group)
        : "teamTactics.unknown",
      icon: choice?.icon as TacticalIconName | undefined,
      level: {
        count: group.choices.length,
        selected: group.choices.findIndex((c) => c.id === choice?.id),
      },
      state:
        active.length > 1
          ? "conflictingInstructions"
          : active.length
            ? "explicit"
            : choice
              ? "defaultInstruction"
              : "policyUnknown",
      locked: false,
      choices: group.choices.map((c) => ({
        id: c.id,
        icon: c.icon as TacticalIconName,
        labelKey: teamChoiceLabel(c.id, group.group),
      })),
    }))
  })
  // Preserve unknown/unmapped active bits instead of dropping them from a complete group view.
  for (const instruction of config.teamInstructions) {
    if (
      !lookup.instructionGroups.some(
        (g) =>
          g.family === "team" && g.choices.some((c) => c.id === instruction.id)
      ) &&
      (instruction.phase === phase ||
        (instruction.phase === "unknown" && phase === "inPossession"))
    )
      result.push({
        rawBit: instruction.bit,
        id: instruction.id,
        key: `team-bit-${instruction.bit}`,
        family: "team",
        groupKey: "teamTactics.unknownBits",
        labelKey: instruction.known
          ? `teamTactics.teamInstructions.${instruction.bit}`
          : "teamTactics.unknown",
        icon: instructionIcon("team", instruction.id) ?? undefined,
        level: { count: 1, selected: -1 },
        state: "policyUnknown",
        locked: false,
        choices: [],
      })
  }
  return result
}

/** Mirrors the native UI group's first explicit-or-forced choice, keeping all alternatives and restrictions. */
export function focusPlayerInstructions(
  position: FocusConfiguration["inPossession"]["positions"][number],
  phase: FocusPhase
): FocusInstruction[] {
  return lookup.instructionGroups
    .filter(
      (g) =>
        g.family === "player" &&
        (Number(g.group) >= 11 && Number(g.group) <= 14
          ? "outOfPossession"
          : "inPossession") === phase
    )
    .map((group) => {
      const choices = group.choices.map((choice) => ({
        id: choice.id,
        icon: choice.icon as TacticalIconName,
        labelKey: choice.id
          ? `teamTactics.playerInstructions.${choice.id}`
          : `teamTactics.playerDefaults.${group.group}`,
        policy: choice.id
          ? playerInstructionPolicy(
              phase,
              position.raw.positionMask,
              position.raw.roleDuty,
              choice.id
            )
          : undefined,
      }))
      const explicit = new Set(
        position.explicit.instructions.map((i) => i.value)
      )
      const order = playerInstructionOrder(Number(group.group))
      const selectedId =
        order?.find(
          (id) =>
            id !== 0 &&
            (explicit.has(id) || choices.find((c) => c.id === id)?.policy === 3)
        ) ?? 0
      const selected = choices.find((c) => c.id === selectedId)
      const unknown =
        position.explicit.status === "unavailable" ||
        !order ||
        choices.some((c) => c.id !== 0 && c.policy === undefined)
      const forced = selected?.policy === 3
      const restricted =
        selected?.policy === 1 ||
        selected?.policy === 2 ||
        choices
          .filter((c) => c.id)
          .every((c) => c.policy === 1 || c.policy === 2)
      return {
        id: unknown && !explicit.has(selectedId) ? undefined : selectedId,
        key: `player-group-${group.group}`,
        family: "player",
        groupKey: `teamTactics.playerGroups.${group.group}`,
        labelKey:
          unknown && !explicit.has(selectedId)
            ? "teamTactics.unknown"
            : selected!.labelKey,
        icon: selected?.icon,
        level: {
          count: choices.length,
          selected:
            unknown && !explicit.has(selectedId)
              ? -1
              : choices.findIndex((c) => c.id === selectedId),
        },
        state: unknown
          ? "policyUnknown"
          : forced
            ? "forcedInstruction"
            : restricted
              ? "restrictedInstruction"
              : explicit.has(selectedId)
                ? "explicit"
                : "defaultInstruction",
        locked: !unknown && (forced || restricted),
        choices,
      }
    })
}

export function focusPlayerPosition(
  config: FocusConfiguration,
  phase: FocusPhase,
  playerId: number
) {
  return config[phase].positions.find((position) =>
    position.players.some((p) => p.playerId === playerId)
  )
}

/** OI is owned by the opposing team. Keep phase-independent roster/position resolution from the snapshot. */
export function oppositionAgainstPlayer(
  snapshot: DecodedTacticalSnapshot | undefined,
  side: "home" | "away",
  playerId: number
) {
  return snapshot?.[side === "home" ? "away" : "home"].resolvedOpposition.find(
    (row) => row.target.playerId === playerId
  )
}

export type InstructionPolicyState = 0 | 1 | 2 | 3
// Native UI: 0 editable, 1 not applicable, 2 forced off, 3 forced on.
// Unknown roles/positions are deliberately not approximated by a nearby table entry.
export function playerInstructionPolicy(
  phase: FocusPhase,
  positionMask: number,
  roleDuty: string,
  instructionId: number
): InstructionPolicyState | undefined {
  if (
    !Number.isInteger(instructionId) ||
    instructionId < 1 ||
    instructionId > 42 ||
    !/^[0-9a-f]{1,16}$/i.test(roleDuty)
  )
    return undefined
  const positions = policy.positions.indexOf(positionMask)
  const table: Readonly<Record<string, number>> = policy[phase]
  const rowIndex = table[BigInt(`0x${roleDuty}`).toString(16).toUpperCase()]
  if (positions < 0 || rowIndex === undefined) return undefined
  const row = policy.rows[rowIndex]
  return Number(
    policy.states[row[positions]][instructionId - 1]
  ) as InstructionPolicyState
}

export function playerInstructionOrder(group: number) {
  return policy.groupOrder[group] as readonly number[] | undefined
}
