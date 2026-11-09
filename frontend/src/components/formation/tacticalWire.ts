import type { TacticalSnapshot } from "@/types/match"

export function decodeBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0))
}

type ObjectValue = Record<string, unknown>
const object = (v: unknown): v is ObjectValue => v !== null && typeof v === "object" && !Array.isArray(v)
const integer = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max
const hex = (v: unknown) => typeof v === "string" && /^[0-9a-f]{16}$/i.test(v)
const list = (v: unknown, max: number, check: (v: unknown) => boolean) => Array.isArray(v) && v.length <= max && v.every(check)
const nullable = (v: unknown, check: (v: unknown) => boolean) => v === null || check(v)
function bytes(v: unknown, min: number, max = min) {
  if (typeof v !== "string" || v.length > Math.ceil(max / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v)) return false
  const length = decodeBytes(v).length
  return length >= min && length <= max
}
function position(v: unknown): boolean {
  return object(v) && integer(v.positionMask, 0, 0xffffffff) && integer(v.auxiliary, 0, 255) && integer(v.flags, 0, 255) && hex(v.roleDuty) &&
    nullable(v.instructions, (rs) => list(rs, 64, (r) => object(r) && hex(r.roleKey) && hex(r.bits) && integer(r.markPosition, 0, 0xffffffff) && integer(r.markPlayer, -128, 127))) &&
    nullable(v.applicability, (rs) => list(rs, 64, (r) => object(r) && integer(r.instructionId, -0x80000000, 0x7fffffff) && hex(r.roleMask)))
}
function overrides(v: unknown) {
  return nullable(v, (rs) => list(rs, 26, (r) => object(r) && integer(r.personKey, 0, 0xffffffff) && list(r.positions, 11, position)))
}
function config(v: unknown): boolean {
  return nullable(v, (v) => object(v) && bytes(v.teamInstructions, 16) && integer(v.styleKey, 0, 0xffffffff) &&
    nullable(v.nameUtf8, (name) => bytes(name, 0, 1024)) && integer(v.additionalState, 0, 255) && integer(v.mentality, 0, 255) && bytes(v.phaseSlotMapping, 11) &&
    Array.isArray(v.inPossession) && v.inPossession.length === 11 && v.inPossession.every(position) &&
    Array.isArray(v.outOfPossession) && v.outOfPossession.length === 11 && v.outOfPossession.every(position) &&
    overrides(v.inPossessionOverrides) && overrides(v.outOfPossessionOverrides))
}
function team(v: unknown): boolean {
  return object(v) && ["complete", "partial", "unavailable"].includes(String(v.status)) && config(v.processing) && config(v.command) &&
    nullable(v.personalOpposition, (b) => bytes(b, 78)) &&
    nullable(v.positionOpposition, (rs) => list(rs, 25, (r) => object(r) && integer(r.positionKey, 0, 0xffffffff) && integer(r.packedInstructions, 0, 0xffffff))) &&
    list(v.players, 64, (p) => object(p) && integer(p.slot, 0, 63) && integer(p.playerId, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER) &&
      nullable(p.rosterSlot, (s) => integer(s, -128, 127)) && nullable(p.tacticSlot, (s) => integer(s, -128, 127)) && nullable(p.oppositionPositionKey, (s) => integer(s, 0, 0xffffffff)))
    && new Set((v.players as { slot: number }[]).map((p) => p.slot)).size === (v.players as unknown[]).length
}

export function parseTacticalSnapshot(value: unknown): TacticalSnapshot {
  if (!object(value) || !integer(value.revision, 1, Number.MAX_SAFE_INTEGER) || !integer(value.observedTick, 0, 0x7fffffff) || !integer(value.capturedUnixMilliseconds, 0, Number.MAX_SAFE_INTEGER) || !team(value.home) || !team(value.away)) {
    throw new Error("Invalid tactical snapshot")
  }
  return value as TacticalSnapshot
}

/** Used by the archive reader, also useful for tools reading standalone captures. */
export function readTacticalDelta(marker: number, previous: TacticalSnapshot | null | undefined, keyframe: boolean, readJson: () => string): TacticalSnapshot | null {
  if (marker === 0 && !keyframe) return previous ?? null
  if (marker === 1) return null
  if (marker !== 2) throw new Error("Invalid tactical state marker")
  return parseTacticalSnapshot(JSON.parse(readJson()))
}

/** One state per live/history stream. A missing change produces a gap, never a stale state. */
export class TacticalWireState {
  private matchId?: string
  private previous: TacticalSnapshot | null = null
  hydrate<T extends { matchId: string; tactics?: TacticalSnapshot | null; tacticsUnchangedFrom?: number }>(frame: T): T {
    if (frame.matchId !== this.matchId) { this.matchId = frame.matchId; this.previous = null }
    const inherited = frame.tacticsUnchangedFrom
    let tactics: TacticalSnapshot | null
    if (inherited !== undefined) {
      tactics = this.previous?.revision === inherited ? this.previous : null
    } else if (frame.tactics) {
      const value = parseTacticalSnapshot(frame.tactics)
      tactics = this.previous?.revision === value.revision ? this.previous : value
    } else tactics = null
    this.previous = tactics
    return { ...frame, tactics }
  }
}
