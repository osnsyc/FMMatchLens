import {
  teamOptions,
  playerInstructions,
  mentalities,
} from "@/components/formation/data/instructionDefinitions"
import { teamTacticsZh } from "@/i18n/teamTactics"
import {
  decodeFormation,
  decodePosition,
} from "@/components/formation/formationDecoder"
import type {
  TacticalConfiguration,
  TacticalPosition,
  TacticalSnapshot,
  TacticalTeamData,
} from "@/types/match"

export type {
  TacticalRoleInstructions,
  TacticalPosition,
  TacticalPersonalOverride,
  TacticalConfiguration,
  TacticalPlayerSlot,
  TacticalTeamData,
  TacticalSnapshot,
} from "@/types/match"
export {
  decodeFormation,
  decodePosition,
} from "@/components/formation/formationDecoder"

export const tacticalStyles = [
  "ControlPossession",
  "Gegenpress",
  "TikiTaka",
  "VerticalTikiTaka",
  "WingPlay",
  "RouteOne",
  "FluidCounterAttack",
  "DirectCounterAttack",
  "Catenaccio",
  "ParkTheBus",
  "BlankSlate",
] as const
/** Database keys differ from the TacticalStyles enum. Unknown keys stay unknown. */
export type TacticalStyleLookup = ReadonlyMap<number, number>
// Native 0x309D760 recognises these identifiers using 0x260F170's first
// four ASCII characters in big-endian order. Keep this lookup outside the plugin.
export const defaultTacticalStyleLookup: TacticalStyleLookup = new Map([
  ...[
    "CONTROL_POSSESSION",
    "GEGENPRESS",
    "TIKI_TAKA",
    "VERTICAL_TIKI_TAKA",
    "WING_PLAY",
    "ROUTE_ONE",
    "FLUID_COUNTER_ATTACK",
    "DIRECT_COUNTER_ATTACK",
    "CATENACCIO",
    "PARK_THE_BUS",
  ].map((name, type): [number, number] => [
    Array.from(name.slice(0, 4)).reduce(
      (key, c) => (key * 256 + c.charCodeAt(0)) >>> 0,
      0
    ),
    type,
  ]),
  // The native UI falls back to BlankSlate when the style is the NULL sentinel.
  [0x4e554c4c, 10],
])
const dutyMask = 0x6e00000n | 0x400000000n
const roleKeyMask = 0xfffffffbf91fffffn
const bits = (value: string) => BigInt(`0x${value}`)
function utf8(value: string | null) {
  if (value === null) return undefined
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(decodeBytes(value))
  } catch {
    return undefined
  }
}

function instructionPhase(bit: number) {
  if (
    (bit >= 1 && bit <= 30) ||
    (bit >= 46 && bit <= 53) ||
    bit === 60 ||
    bit === 78 ||
    bit === 79
  )
    return "inPossession"
  if (
    (bit >= 35 && bit <= 45 && bit !== 41) ||
    bit === 54 ||
    bit === 55 ||
    bit === 70 ||
    bit === 71
  )
    return "transition"
  if (
    (bit >= 56 && bit <= 59) ||
    (bit >= 61 && bit <= 69) ||
    bit === 72 ||
    bit === 73 ||
    bit === 76 ||
    bit === 77 ||
    (bit >= 80 && bit <= 83)
  )
    return "outOfPossession"
  return "unknown"
}

export function decodeTeamInstructions(value: string) {
  const data = decodeBytes(value)
  const activeBits: number[] = []
  for (let bit = 0; bit < data.length * 8; bit++)
    if (data[bit >> 3] & (1 << (bit & 7))) activeBits.push(bit)
  return activeBits.map((bit) => ({
    bit,
    phase: instructionPhase(bit),
    ...teamOptions.find((option) => option.bit === bit),
    known: teamOptions.some(
      (option) => option.bit === bit && option.name !== "unknown"
    ),
  }))
}

/** Explicit saved instructions only. Role-forced defaults require a separate policy decoder. */
export function decodePositionInstructions(position: TacticalPosition) {
  const roleKey = bits(position.roleDuty) & roleKeyMask
  const selected = position.instructions?.find(
    (r) => bits(r.roleKey) === roleKey
  )
  const raw = selected ? bits(selected.bits) : 0n
  return {
    status: position.instructions === null ? "unavailable" : "explicit-only",
    roleKey: roleKey.toString(16).padStart(16, "0").toUpperCase(),
    roleWithoutDuty: (bits(position.roleDuty) & ~dutyMask)
      .toString(16)
      .padStart(16, "0")
      .toUpperCase(),
    instructions: playerInstructions.filter(
      (instruction) =>
        instruction.value > 0 &&
        (raw & (1n << BigInt(instruction.value))) !== 0n
    ),
    markPosition: selected?.markPosition,
    markPlayer: selected?.markPlayer,
    unknownBits: (raw & ~((1n << 43n) - 2n))
      .toString(16)
      .padStart(16, "0")
      .toUpperCase(),
    applicability: position.applicability,
  }
}

/** The native person key must come from a verified source, not an assumed public UID. */
export function resolvePersonalPosition(
  config: TacticalConfiguration,
  phase: "inPossession" | "outOfPossession",
  slot: number,
  personKey: number | null
) {
  const position = config[phase][slot]
  if (!position) return { source: "unavailable" } as const
  const overrides =
    phase === "inPossession"
      ? config.inPossessionOverrides
      : config.outOfPossessionOverrides
  if (overrides === null || personKey === null)
    return { source: "unresolved-person-key", position } as const
  const individual = overrides
    .find((p) => p.personKey === personKey)
    ?.positions.find(
      (p) => p.positionMask === position.positionMask && p.flags !== 0
    )
  return individual
    ? ({ source: "personal", position: individual } as const)
    : ({ source: "position", position } as const)
}

export function decodeOpposition(packed: number) {
  return {
    packed,
    marking: packed & 7,
    pressing: (packed >> 3) & 7,
    tackling: (packed >> 8) & 7,
    foot: (packed >> 11) & 7,
    personalEnabled: (packed & 0x080000) !== 0,
    manuallyModified: (packed & 0x040000) !== 0,
  }
}

export function resolveOpposition(
  team: TacticalTeamData,
  rosterSlot: number | null,
  positionKey: number | null
) {
  const data =
    team.personalOpposition === null
      ? null
      : decodeBytes(team.personalOpposition)
  if (data && rosterSlot !== null && rosterSlot >= 0 && rosterSlot < 26) {
    const i = rosterSlot * 3
    const personal = decodeOpposition(
      data[i] | (data[i + 1] << 8) | (data[i + 2] << 16)
    )
    if (personal.personalEnabled)
      return { source: "personal", ...personal } as const
  }
  // Missing tables prevent proving that a fallback is the effective instruction.
  if (
    !data ||
    team.positionOpposition === null ||
    rosterSlot === null ||
    rosterSlot < 0 ||
    rosterSlot >= 26 ||
    positionKey === null
  )
    return { source: "unavailable" } as const
  const positional = team.positionOpposition.find(
    (p) => p.positionKey === positionKey
  )
  return positional
    ? ({
        source: "position",
        ...decodeOpposition(positional.packedInstructions),
      } as const)
    : ({ source: "default", ...decodeOpposition(0x080000) } as const)
}

export function decodeConfiguration(
  config: TacticalConfiguration,
  team: TacticalTeamData,
  styleLookup?: TacticalStyleLookup
) {
  const mapping = decodeBytes(config.phaseSlotMapping)
  const teamInstructions = decodeTeamInstructions(config.teamInstructions)
  const phase = (inPossession: boolean) => {
    const positions = inPossession
      ? config.inPossession
      : config.outOfPossession
    const overrides = inPossession
      ? config.inPossessionOverrides
      : config.outOfPossessionOverrides
    return {
      teamInstructions: teamInstructions.filter(
        (i) => i.phase === (inPossession ? "inPossession" : "outOfPossession")
      ),
      formation: decodeFormation(positions.map((p) => p.positionMask)),
      positions: positions.map((p, slot) => ({
        slot,
        position: decodePosition(p.positionMask),
        raw: p,
        players: team.players.filter((player) => {
          const ip = player.tacticSlot
          if (ip === null || ip < 0 || ip >= 11) return false
          return (
            (inPossession || mapping[ip] === 255 ? ip : mapping[ip]) === slot
          )
        }),
        explicit: decodePositionInstructions(p),
      })),
      // Keep native person keys distinct from public Person.Uid until proven equivalent.
      personalOverrides:
        overrides?.map((o) => ({
          personKey: o.personKey,
          positions: o.positions.map((p) => ({
            position: decodePosition(p.positionMask),
            enabled: p.flags !== 0,
            raw: p,
            explicit: decodePositionInstructions(p),
          })),
        })) ?? null,
    }
  }
  const styleType = (styleLookup ?? defaultTacticalStyleLookup).get(
    config.styleKey
  )
  return {
    mentality: {
      value: config.mentality,
      name:
        mentalities.find((m) => m.value === config.mentality)?.name ??
        "Unknown",
      nameZh:
        teamTacticsZh.mentalities[config.mentality] ?? teamTacticsZh.unknown,
    },
    style: {
      key: config.styleKey,
      type: styleType,
      name: styleType === undefined ? undefined : tacticalStyles[styleType],
      nameZh:
        styleType === undefined ? undefined : teamTacticsZh.styles[styleType],
      configurationName: utf8(config.nameUtf8),
    },
    // This bitset is shared by both phases; don't invent two independent bitsets.
    teamInstructions,
    transitionInstructions: teamInstructions.filter(
      (i) => i.phase === "transition"
    ),
    inPossession: phase(true),
    outOfPossession: phase(false),
  }
}

export function decodeTacticalSnapshot(
  raw: TacticalSnapshot,
  styleLookup?: TacticalStyleLookup
) {
  const team = (value: TacticalTeamData, opponent: TacticalTeamData) => ({
    status: value.status,
    processing: value.processing
      ? decodeConfiguration(value.processing, value, styleLookup)
      : null,
    command: value.command
      ? decodeConfiguration(value.command, value, styleLookup)
      : null,
    personalOpposition:
      value.personalOpposition === null
        ? null
        : Array.from({ length: 26 }, (_, slot) => {
            const bytes = decodeBytes(value.personalOpposition!)
            return {
              rosterSlot: slot,
              targets: opponent.players.filter((p) => p.rosterSlot === slot),
              ...decodeOpposition(
                bytes[slot * 3] |
                  (bytes[slot * 3 + 1] << 8) |
                  (bytes[slot * 3 + 2] << 16)
              ),
            }
          }),
    positionOpposition:
      value.positionOpposition?.map((p) => ({
        positionKey: p.positionKey,
        position: decodePosition(p.positionKey),
        targets: opponent.players.filter(
          (player) => player.oppositionPositionKey === p.positionKey
        ),
        ...decodeOpposition(p.packedInstructions),
      })) ?? null,
    resolvedOpposition: opponent.players.map((p) => ({
      target: p,
      ...resolveOpposition(value, p.rosterSlot, p.oppositionPositionKey),
    })),
    players: value.players,
  })
  return {
    revision: raw.revision,
    observedTick: raw.observedTick,
    capturedUnixMilliseconds: raw.capturedUnixMilliseconds,
    home: team(raw.home, raw.away),
    away: team(raw.away, raw.home),
  }
}
export type DecodedTacticalSnapshot = ReturnType<typeof decodeTacticalSnapshot>

const decoded = new WeakMap<TacticalSnapshot, DecodedTacticalSnapshot>()
export function cachedTacticalSnapshot(
  raw: TacticalSnapshot | null | undefined
) {
  if (!raw) return undefined
  let value = decoded.get(raw)
  if (!value) {
    value = decodeTacticalSnapshot(raw)
    decoded.set(raw, value)
  }
  return value
}

/** Changes are observations, not exact command execution times. Null is a gap. */
export function tacticalChanges(
  frames: readonly { tick: number; tactics?: TacticalSnapshot | null }[]
) {
  const changes: { tick: number; state: TacticalSnapshot | null }[] = []
  let previous: TacticalSnapshot | null | undefined
  let initialized = false
  for (const frame of frames) {
    const state = frame.tactics ?? null
    if (
      !initialized ||
      state?.revision !== previous?.revision ||
      (state === null) !== (previous === null)
    )
      changes.push({ tick: frame.tick, state })
    previous = state
    initialized = true
  }
  return changes
}

export function decodeBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0))
}

type ObjectValue = Record<string, unknown>
const object = (v: unknown): v is ObjectValue =>
  v !== null && typeof v === "object" && !Array.isArray(v)
const integer = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max
const hex = (v: unknown) => typeof v === "string" && /^[0-9a-f]{16}$/i.test(v)
const list = (v: unknown, max: number, check: (v: unknown) => boolean) =>
  Array.isArray(v) && v.length <= max && v.every(check)
const nullable = (v: unknown, check: (v: unknown) => boolean) =>
  v === null || check(v)
function bytes(v: unknown, min: number, max = min) {
  if (
    typeof v !== "string" ||
    v.length > Math.ceil(max / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v)
  )
    return false
  const length = decodeBytes(v).length
  return length >= min && length <= max
}
function position(v: unknown): boolean {
  return (
    object(v) &&
    integer(v.positionMask, 0, 0xffffffff) &&
    integer(v.auxiliary, 0, 255) &&
    integer(v.flags, 0, 255) &&
    hex(v.roleDuty) &&
    nullable(v.instructions, (rs) =>
      list(
        rs,
        64,
        (r) =>
          object(r) &&
          hex(r.roleKey) &&
          hex(r.bits) &&
          integer(r.markPosition, 0, 0xffffffff) &&
          integer(r.markPlayer, -128, 127)
      )
    ) &&
    nullable(v.applicability, (rs) =>
      list(
        rs,
        64,
        (r) =>
          object(r) &&
          integer(r.instructionId, -0x80000000, 0x7fffffff) &&
          hex(r.roleMask)
      )
    )
  )
}
function overrides(v: unknown) {
  return nullable(v, (rs) =>
    list(
      rs,
      26,
      (r) =>
        object(r) &&
        integer(r.personKey, 0, 0xffffffff) &&
        list(r.positions, 11, position)
    )
  )
}
function config(v: unknown): boolean {
  return nullable(
    v,
    (v) =>
      object(v) &&
      bytes(v.teamInstructions, 16) &&
      integer(v.styleKey, 0, 0xffffffff) &&
      nullable(v.nameUtf8, (name) => bytes(name, 0, 1024)) &&
      integer(v.additionalState, 0, 255) &&
      integer(v.mentality, 0, 255) &&
      bytes(v.phaseSlotMapping, 11) &&
      Array.isArray(v.inPossession) &&
      v.inPossession.length === 11 &&
      v.inPossession.every(position) &&
      Array.isArray(v.outOfPossession) &&
      v.outOfPossession.length === 11 &&
      v.outOfPossession.every(position) &&
      overrides(v.inPossessionOverrides) &&
      overrides(v.outOfPossessionOverrides)
  )
}
function team(v: unknown): boolean {
  return (
    object(v) &&
    ["complete", "partial", "unavailable"].includes(String(v.status)) &&
    config(v.processing) &&
    config(v.command) &&
    nullable(v.personalOpposition, (b) => bytes(b, 78)) &&
    nullable(v.positionOpposition, (rs) =>
      list(
        rs,
        25,
        (r) =>
          object(r) &&
          integer(r.positionKey, 0, 0xffffffff) &&
          integer(r.packedInstructions, 0, 0xffffff)
      )
    ) &&
    list(
      v.players,
      64,
      (p) =>
        object(p) &&
        integer(p.slot, 0, 63) &&
        integer(p.playerId, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER) &&
        nullable(p.rosterSlot, (s) => integer(s, -128, 127)) &&
        nullable(p.tacticSlot, (s) => integer(s, -128, 127)) &&
        nullable(p.oppositionPositionKey, (s) => integer(s, 0, 0xffffffff))
    ) &&
    new Set((v.players as { slot: number }[]).map((p) => p.slot)).size ===
      (v.players as unknown[]).length
  )
}

export function parseTacticalSnapshot(value: unknown): TacticalSnapshot {
  if (
    !object(value) ||
    !integer(value.revision, 1, Number.MAX_SAFE_INTEGER) ||
    !integer(value.observedTick, 0, 0x7fffffff) ||
    !integer(value.capturedUnixMilliseconds, 0, Number.MAX_SAFE_INTEGER) ||
    !team(value.home) ||
    !team(value.away)
  ) {
    throw new Error("Invalid tactical snapshot")
  }
  return value as TacticalSnapshot
}

/** Used by the archive reader, also useful for tools reading standalone captures. */
export function readTacticalDelta(
  marker: number,
  previous: TacticalSnapshot | null | undefined,
  keyframe: boolean,
  readJson: () => string
): TacticalSnapshot | null {
  if (marker === 0 && !keyframe) return previous ?? null
  if (marker === 1) return null
  if (marker !== 2) throw new Error("Invalid tactical state marker")
  return parseTacticalSnapshot(JSON.parse(readJson()))
}

/** One state per live/history stream. A missing change produces a gap, never a stale state. */
export class TacticalWireState {
  private matchId?: string
  private previous: TacticalSnapshot | null = null
  hydrate<
    T extends {
      matchId: string
      tactics?: TacticalSnapshot | null
      tacticsUnchangedFrom?: number
    },
  >(frame: T): T {
    if (frame.matchId !== this.matchId) {
      this.matchId = frame.matchId
      this.previous = null
    }
    const inherited = frame.tacticsUnchangedFrom
    let tactics: TacticalSnapshot | null
    if (inherited !== undefined) {
      tactics = this.previous?.revision === inherited ? this.previous : null
    } else if (frame.tactics) {
      const value = parseTacticalSnapshot(frame.tactics)
      tactics =
        this.previous?.revision === value.revision ? this.previous : value
    } else tactics = null
    this.previous = tactics
    return { ...frame, tactics }
  }
}
