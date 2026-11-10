import type {
  RealtimeFrame,
  RealtimeMatchMetadata,
  RealtimePlayer,
} from "@/api/realtimeMatch"
import type {
  MatchPlayer,
  PlayerTacticalAssignment,
  TacticalConfiguration,
  TacticalSnapshot,
} from "@/types/match"
import { decodePosition } from "./formationDecoder"
import { inPossessionRoles, outOfPossessionRoles } from "./data/formationRoles"

const dutyMask = 0x6e00000n | 0x400000000n
const duties = [
  [0x2000000n, "Stopper"],
  [0x4000000n, "Cover"],
  [0x200000n, "Defend"],
  [0x400000n, "Support"],
  [0x800000n, "Attack"],
  [0x400000000n, "Float"],
] as const

export function decodeAssignment(
  positionMask: number,
  roleDuty: string,
  inPossession: boolean
): PlayerTacticalAssignment | undefined {
  if (!(positionMask & 0x1ffff) || !/^[0-9a-f]{16}$/i.test(roleDuty))
    return undefined
  const bits = BigInt(`0x${roleDuty}`)
  const roleKey = bits & ~dutyMask
  const role = (inPossession ? inPossessionRoles : outOfPossessionRoles)[
    roleKey.toString(16)
  ]
  return {
    positionMask,
    position: decodePosition(positionMask),
    roleDuty: roleDuty.toUpperCase(),
    role: role?.[0] ?? `Unknown (0x${roleKey.toString(16).toUpperCase()})`,
    roleAbbreviation: role?.[1] ?? "?",
    duty: duties.find(([mask]) => (bits & mask) !== 0n)?.[1],
  }
}

type Assignments = {
  inPossession?: PlayerTacticalAssignment
  outOfPossession?: PlayerTacticalAssignment
}
const projections = new WeakMap<TacticalSnapshot, Map<string, Assignments>>()
const configurations = new WeakMap<TacticalConfiguration, Assignments[]>()
const observedMetadata = new WeakMap<RealtimeFrame, RealtimeMatchMetadata>()
export function formationMetadata(
  frame: RealtimeFrame,
  fallback?: RealtimeMatchMetadata | null
) {
  return frame.tactics === undefined
    ? (observedMetadata.get(frame) ?? fallback)
    : fallback
}

function configurationAssignments(
  config: TacticalConfiguration,
  slot: number
): Assignments {
  const cached = configurations.get(config)
  if (cached) return cached[slot]
  const mapping = Uint8Array.from(atob(config.phaseSlotMapping), (c) =>
    c.charCodeAt(0)
  )
  const assignments = Array.from({ length: 11 }, (_, index) => {
    const oop = mapping[index] === 255 ? index : mapping[index]
    const ipPosition = config.inPossession[index]
    const oopPosition =
      oop >= 0 && oop < 11 ? config.outOfPossession[oop] : undefined
    return {
      inPossession: ipPosition
        ? decodeAssignment(ipPosition.positionMask, ipPosition.roleDuty, true)
        : undefined,
      outOfPossession: oopPosition
        ? decodeAssignment(
            oopPosition.positionMask,
            oopPosition.roleDuty,
            false
          )
        : undefined,
    }
  })
  configurations.set(config, assignments)
  return assignments[slot]
}

/** Q is applied state. Never combine it with S or a legacy role label. */
export function playerFormation(
  tactics: TacticalSnapshot | null | undefined,
  player: Pick<RealtimePlayer, "team" | "slot" | "playerId">,
  legacy?: Assignments
): Assignments {
  // Undefined denotes a legacy source; explicit null denotes an observed gap.
  if (tactics === undefined) {
    if (
      legacy &&
      (("team" in legacy && legacy.team !== player.team) ||
        ("playerId" in legacy && legacy.playerId !== player.playerId) ||
        ("id" in legacy && legacy.id !== player.playerId))
    )
      return {}
    return legacy ?? {}
  }
  if (!tactics) return {}
  let projected = projections.get(tactics)
  if (!projected) {
    projected = new Map()
    for (const side of ["home", "away"] as const) {
      const team = tactics[side]
      if (!team.processing || team.status === "unavailable") continue
      for (const binding of team.players) {
        if (
          binding.tacticSlot === null ||
          binding.tacticSlot < 0 ||
          binding.tacticSlot >= 11
        )
          continue
        projected.set(
          `${side}:${binding.slot}:${binding.playerId}`,
          configurationAssignments(team.processing, binding.tacticSlot)
        )
      }
    }
    projections.set(tactics, projected)
  }
  return projected.get(`${player.team}:${player.slot}:${player.playerId}`) ?? {}
}

export function formationGoalkeeper(
  frame: RealtimeFrame,
  player: RealtimePlayer,
  legacy?: Assignments & { position?: string }
) {
  const tactics = frame.legacyFormation ? undefined : frame.tactics
  const assignment = playerFormation(tactics, player, legacy)
  const position =
    assignment.inPossession?.position ??
    assignment.outOfPossession?.position ??
    (tactics === undefined ? legacy?.position : undefined)
  return position?.trim().toUpperCase() === "GK"
}

/** Retain only changes; independent of UI mounting, instruction revisions and coordinates. */
export class FormationTimeline {
  readonly frames: RealtimeFrame[] = []
  private signature?: string
  private lastTick = -1
  private previous?: RealtimeFrame
  private metadata?: RealtimeMatchMetadata | null
  append(frame: RealtimeFrame, metadata?: RealtimeMatchMetadata | null) {
    let previous = this.previous
    if (previous && previous.matchId !== frame.matchId) {
      this.frames.length = 0
      this.signature = undefined
      this.lastTick = -1
      this.metadata = undefined
      previous = undefined
    }
    if (
      frame.tick < this.lastTick ||
      (frame.tick === this.lastTick &&
        frame.sequence <= (previous?.sequence ?? -1))
    )
      return
    this.lastTick = frame.tick
    this.previous = frame
    const stable =
      previous?.tactics === frame.tactics &&
      (frame.tactics !== undefined || metadata === this.metadata) &&
      (frame.tactics !== undefined ||
        !metadata ||
        !previous ||
        metadata.capturedTick <= previous.tick ===
          metadata.capturedTick <= frame.tick) &&
      previous?.players.length === frame.players.length &&
      frame.players.every((p, index) => {
        const prior = previous.players[index]
        return (
          p.playerId === prior.playerId &&
          p.team === prior.team &&
          p.slot === prior.slot &&
          p.isOnPitch === prior.isOnPitch
        )
      })
    this.metadata = metadata
    if (stable) return
    const details = new Map(
      metadata && metadata.capturedTick <= frame.tick
        ? metadata.players.map((p) => [p.slot, p])
        : []
    )
    const signature = JSON.stringify([
      frame.tactics === null
        ? "gap"
        : frame.tactics === undefined
          ? "legacy"
          : "tactics",
      frame.players
        .filter((p) => p.isOnPitch)
        .map((p) => {
          const legacy = details.get(p.slot)
          const assignments = playerFormation(frame.tactics, p, legacy)
          return [
            p.team,
            p.slot,
            p.playerId,
            assignments.inPossession?.positionMask,
            assignments.inPossession?.roleDuty,
            assignments.outOfPossession?.positionMask,
            assignments.outOfPossession?.roleDuty,
          ]
        })
        .sort((a, b) => String(a).localeCompare(String(b))),
    ])
    if (signature === this.signature) return
    this.signature = signature
    if (this.frames.at(-1)?.tick === frame.tick) this.frames.pop()
    if (metadata) observedMetadata.set(frame, metadata)
    this.frames.push(frame)
  }
}

/** Older files can omit the incoming substitute's assignment. This heuristic is legacy-only. */
export function repairLegacyFormation(players: MatchPlayer[]): MatchPlayer[] {
  if (
    !players.some(p => p.isOnPitch && (!p.inPossession || !p.outOfPossession)) ||
    !players.some(p => !p.isOnPitch && p.status?.subbedOffMinute != null && (p.inPossession || p.outOfPossession))
  ) return players
  const result = players.slice()
  for (const side of ["home", "away"] as const)
    for (const phase of ["inPossession", "outOfPossession"] as const) {
      const occupied = new Set(
        result
          .filter((p) => p.team === side && p.isOnPitch)
          .map((p) => p[phase]?.positionMask)
      )
      const vacated = result.filter(
        (p) =>
          p.team === side &&
          !p.isOnPitch &&
          p.status?.subbedOffMinute != null &&
          p[phase] &&
          !occupied.has(p[phase]!.positionMask)
      )
      result.forEach((player, index) => {
        if (player.team !== side || !player.isOnPitch || player[phase]) return
        const at = vacated.findIndex(
          (p) =>
            player.status?.subbedOnMinute != null &&
            p.status?.subbedOffMinute === player.status.subbedOnMinute
        )
        const prior = vacated.splice(at >= 0 ? at : 0, 1)[0]
        if (prior) result[index] = { ...player, [phase]: prior[phase] }
      })
    }
  return result
}
