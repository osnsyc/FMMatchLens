import { describe, expect, it } from "vitest"
import {
  decodeAssignment,
  FormationTimeline,
  formationGoalkeeper,
  playerFormation,
} from "@/components/formation/formationProjection"
import { TacticalWireState } from "@/components/formation/tactics"
import { focusFormationPositions } from "@/components/formation/focus"
import { formationSnapshotsAt, toMatchSnapshot } from "@/api/realtimeMatch"
import { preprocessReplayArchive } from "@/api/replay/replayPreprocessor"
import { ReplaySession } from "@/api/replay/replaySession"
import { frame, replayFixture } from "./replay/replayTestFixtures"
import type { TacticalConfiguration, TacticalSnapshot } from "@/types/match"

const hex = (value: bigint) =>
  value.toString(16).padStart(16, "0").toUpperCase()
function config(): TacticalConfiguration {
  return {
    teamInstructions: btoa("\0".repeat(16)),
    styleKey: 0,
    nameUtf8: "",
    additionalState: 0,
    mentality: 0,
    phaseSlotMapping: btoa(String.fromCharCode(1, 255, ...Array(9).fill(255))),
    inPossession: Array.from({ length: 11 }, (_, i) => ({
      positionMask: i === 0 ? 1 : 0x400,
      roleDuty: hex(i === 0 ? 1n : 0x400020n),
      auxiliary: 0,
      flags: 0,
      instructions: [],
      applicability: [],
    })),
    outOfPossession: Array.from({ length: 11 }, (_, i) => ({
      positionMask: i === 0 ? 1 : 0x10,
      roleDuty: hex(i === 0 ? 1n : 8n),
      auxiliary: 0,
      flags: 0,
      instructions: [],
      applicability: [],
    })),
    inPossessionOverrides: [],
    outOfPossessionOverrides: [],
  }
}
function tactics(revision = 1): TacticalSnapshot {
  const team = () => ({
    status: "complete" as const,
    processing: config(),
    command: config(),
    personalOpposition: btoa("\0".repeat(78)),
    positionOpposition: [],
    players: [],
  })
  return {
    revision,
    observedTick: 1,
    capturedUnixMilliseconds: 0,
    home: {
      ...team(),
      players: [
        {
          slot: 1,
          playerId: 101,
          tacticSlot: 0,
          rosterSlot: 0,
          oppositionPositionKey: 1,
        },
        {
          slot: 2,
          playerId: 102,
          tacticSlot: 1,
          rosterSlot: 1,
          oppositionPositionKey: 0x400,
        },
      ],
    },
    away: team(),
  }
}
function tacticalFrame(
  tick: number,
  state: TacticalSnapshot | null = tactics()
) {
  return { ...frame(tick), sequence: tick, tactics: state }
}

describe("formation projection", () => {
  it("repairs missing substitute assignments only for legacy input", () => {
    const metadata = replayFixture().metadata
    metadata.players[0].inPossession = decodeAssignment(1, hex(1n), true)
    const raw = frame(241)
    raw.players[0] = { ...raw.players[0], isOnPitch: false, subbedOffMinute: 1 }
    raw.players[1] = { ...raw.players[1], subbedOnMinute: 1 }
    expect(toMatchSnapshot(raw, undefined, metadata).players[1].inPossession?.position).toBe("GK")
    const state = tactics()
    state.home.players = state.home.players.filter(binding => binding.playerId !== 102)
    expect(toMatchSnapshot({ ...raw, tactics: state }, undefined, metadata).players[1].inPossession).toBeUndefined()
  })
  it("decodes precise 64-bit roles and duty, including unknown roles", () => {
    expect(decodeAssignment(0x400, hex(0x400020n), true)).toMatchObject({
      role: "Central Midfielder",
      roleAbbreviation: "CM",
      duty: "Support",
    })
    expect(
      decodeAssignment(0x10, hex(0x40000000000000n), true)?.roleAbbreviation
    ).toBe("OCB")
    expect(decodeAssignment(1, hex(1n << 63n), false)?.role).toBe(
      "Unknown (0x8000000000000000)"
    )
    expect(decodeAssignment(0, hex(1n), true)).toBeUndefined()
  })
  it("uses Q, OOP mapping and 0xFF fallback, keeping phase roles distinct", () => {
    const raw = tacticalFrame(1)
    raw.tactics!.home.command!.inPossession[0].positionMask = 0x400
    const first = playerFormation(raw.tactics, raw.players[0])
    expect(first.inPossession?.position).toBe("GK")
    expect(first.outOfPossession?.position).toBe("DC")
    expect(first.outOfPossession?.roleAbbreviation).toBe("CB")
    expect(
      playerFormation(raw.tactics, raw.players[1]).outOfPossession?.position
    ).toBe("DC")
    expect(formationGoalkeeper(raw, raw.players[0])).toBe(true)
  })
  it("does not join a replacement player, opposite team or stale public slot", () => {
    const raw = tacticalFrame(1)
    for (const change of [
      { playerId: 999 },
      { team: "away" as const },
      { slot: 9 },
    ]) {
      expect(
        playerFormation(raw.tactics, { ...raw.players[0], ...change })
      ).toEqual({})
    }
  })
  it("rejects invalid mapped slots without using command or legacy assignments", () => {
    const state = tactics()
    state.home.processing!.phaseSlotMapping = btoa(
      String.fromCharCode(12, ...Array(10).fill(255))
    )
    const assignments = playerFormation(state, frame(1).players[0])
    expect(assignments.inPossession).toBeDefined()
    expect(assignments.outOfPossession).toBeUndefined()
  })
  it("clears assignments on null or unavailable Q; legacy fallback requires absent tactics", () => {
    const legacy = { inPossession: decodeAssignment(0x400, hex(0x20n), true) }
    const player = frame(1).players[0]
    expect(playerFormation(null, player, legacy)).toEqual({})
    expect(playerFormation(undefined, player, legacy)).toBe(legacy)
    const state = tactics()
    state.home.processing = null
    expect(playerFormation(state, player, legacy)).toEqual({})
  })
  it("provides the same assignments to snapshots, focus and goalkeeper detection", () => {
    const raw = tacticalFrame(1)
    const match = toMatchSnapshot(raw)
    expect(match.players[0].inPossession?.roleAbbreviation).toBe("GK")
    const positions = focusFormationPositions(match, "home", "inPossession")
    expect(positions[0].playerIds).toEqual([101])
    const sentOff = {
      ...match,
      players: match.players.map((p) => ({ ...p, isOnPitch: false })),
    }
    expect(
      focusFormationPositions(sentOff, "home", "inPossession")[0].playerIds
    ).toEqual([])
    expect(
      formationGoalkeeper(
        tacticalFrame(2, null),
        raw.players[0],
        match.players[0]
      )
    ).toBe(false)
  })
  it("separates explicit unsupported-build fallback from missing revision gaps", () => {
    const stream = new TacticalWireState()
    expect(
      stream.hydrate({ ...frame(1), legacyFormation: true, tactics: null })
        .tactics
    ).toBeUndefined()
    expect(
      stream.hydrate({ ...frame(2), tacticsUnchangedFrom: 99 }).tactics
    ).toBeNull()
  })
  it("hydrates inherited tactical state before projecting playback goalkeeper markers", () => {
    const stream = new TacticalWireState()
    const first = stream.hydrate(tacticalFrame(1))
    const inherited = stream.hydrate({ ...tacticalFrame(2, null), tacticsUnchangedFrom: 1 })
    expect(inherited.tactics).toBe(first.tactics)
    expect(formationGoalkeeper(inherited, inherited.players[0])).toBe(true)
  })
})

describe("persistent formation history", () => {
  it("isolates consecutive matches even when the next match starts at a lower tick", () => {
    const timeline = new FormationTimeline()
    timeline.append(tacticalFrame(481))
    timeline.append({ ...tacticalFrame(1), matchId: "next-match" })
    expect(timeline.frames.map(f => [f.matchId, f.tick])).toEqual([["next-match", 1]])
  })
  it("never projects future legacy assignments backwards, including a stable metadata baseline", () => {
    const metadata = { ...replayFixture().metadata, capturedTick: 241 }
    metadata.players = metadata.players.map((p) =>
      p.playerId === 101
        ? {
            ...p,
            inPossession: decodeAssignment(1, hex(1n), true),
          }
        : p
    )
    const timeline = new FormationTimeline()
    timeline.append(frame(1), metadata)
    timeline.append(frame(241), metadata)
    const snapshots = formationSnapshotsAt(timeline.frames, 241, () => metadata)
    expect(snapshots.map((s) => s.tick)).toEqual([1, 241])
    expect(snapshots[0].players[0].inPossession).toBeUndefined()
    expect(snapshots[1].players[0].inPossession?.position).toBe("GK")
    expect(
      toMatchSnapshot(frame(1), undefined, metadata).players[0].inPossession
    ).toBeUndefined()
  })
  it("ignores instruction-only changes, retains duty changes, roster changes and gaps", () => {
    const timeline = new FormationTimeline()
    const initial = tacticalFrame(1)
    timeline.append(initial)
    timeline.append({ ...initial, tick: 2, sequence: 2 })
    const instructions = tactics(2)
    instructions.home.processing!.teamInstructions = btoa(
      "\x01" + "\0".repeat(15)
    )
    timeline.append(tacticalFrame(241, instructions))
    expect(timeline.frames.map((f) => f.tick)).toEqual([1])
    const duty = tactics(3)
    duty.home.processing!.inPossession[1].roleDuty = hex(0x800020n)
    timeline.append(tacticalFrame(481, duty))
    const roster = tacticalFrame(482, duty)
    roster.players = roster.players.map((p) =>
      p.playerId === 101 ? { ...p, isOnPitch: false } : p
    )
    timeline.append(roster)
    timeline.append(tacticalFrame(483, null))
    expect(timeline.frames.map((f) => f.tick)).toEqual([1, 481, 482, 483])
    const snapshots = formationSnapshotsAt(
      timeline.frames,
      483,
      () => undefined
    )
    expect(snapshots[0].tick).toBe(1)
    expect(snapshots[1].players[1].inPossession?.duty).toBe("Attack")
    expect(
      snapshots
        .at(-1)!
        .players.every((p) => !p.inPossession && !p.outOfPossession)
    ).toBe(true)
    expect(formationSnapshotsAt(timeline.frames, 483, () => undefined)).toBe(
      snapshots
    )
  })
  it("replaces a same-tick final observation when its sequence is newer", () => {
    const timeline = new FormationTimeline()
    timeline.append(tacticalFrame(1))
    timeline.append(tacticalFrame(241))
    const final = tactics(2)
    final.home.processing!.inPossession[0].positionMask = 0x400
    timeline.append({ ...tacticalFrame(241, final), sequence: 242 })
    expect(timeline.frames.map((f) => f.tick)).toEqual([1, 241])
    expect(
      formationSnapshotsAt(timeline.frames, 241, () => undefined).at(-1)!
        .players[0].inPossession?.position
    ).toBe("MC")
  })
  it("restores full history after remount and selects only past changes when seeking", async () => {
    const fixture = replayFixture()
    const changed = tactics(2)
    changed.home.processing!.inPossession[0].positionMask = 0x400
    const archive = await preprocessReplayArchive({
      ...fixture,
      frames: [
        tacticalFrame(1),
        tacticalFrame(241, changed),
        tacticalFrame(481, null),
      ],
    })
    const session = new ReplaySession(archive)
    expect(session.advanceTo(2).formationSnapshots?.map((s) => s.tick)).toEqual(
      [1, 241, 481]
    )
    expect(session.seek(0).formationSnapshots?.map((s) => s.tick)).toEqual([1])
    expect(session.seek(1).players[0].inPossession?.position).toBe("MC")
    expect(
      new ReplaySession(archive)
        .advanceTo(2)
        .formationSnapshots?.map((s) => s.tick)
    ).toEqual([1, 241, 481])
    session.dispose()
  })
  it("reads old assignment-only archives without changing their storage layout", async () => {
    const fixture = replayFixture()
    fixture.metadata.players[0].inPossession = decodeAssignment(
      1,
      hex(1n),
      true
    )
    fixture.metadataTimeline = []
    const archive = await preprocessReplayArchive({
      ...fixture,
      frames: [tacticalFrame(1, null), tacticalFrame(241, null)],
    })
    expect(archive.frames[0].tactics).toBeUndefined()
    expect(
      new ReplaySession(archive).advanceTo(1).players[0].inPossession?.position
    ).toBe("GK")
  })
})
