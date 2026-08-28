import type {
  RealtimeFrame,
  RealtimeMatchMetadata,
  RealtimePlayer,
  RealtimePlayerMetadata,
  RealtimeTeam,
  RealtimeTeamMetadata,
} from "@/api/realtimeMatch"
import type { PlayerAttributes, PlayerProfile, PlayerTacticalAssignment, TeamSide } from "@/types/match"

const magic = "FMLENS"
const frameRecord = 1
const endRecord = 2
const metadataRecord = 3

export type LocalArchiveSummary = {
  matchId: string
  fileName: string
  startedUnixMilliseconds: number
  endedUnixMilliseconds?: number
  ended: boolean
  frameCount: number
  firstTick: number
  lastTick: number
  homeGoals: number
  awayGoals: number
  fileSizeBytes: number
}

export type ParsedLocalArchive = {
  archive: LocalArchiveSummary
  metadata?: RealtimeMatchMetadata
  metadataTimeline: RealtimeMatchMetadata[]
  frames: RealtimeFrame[]
}

export function parseLocalArchive(buffer: ArrayBuffer, fileName: string): ParsedLocalArchive {
  const reader = new DotNetBinaryReader(buffer)
  if (reader.readAscii(magic.length) !== magic) {
    throw new Error("不是有效的 FMMatchLens 存档")
  }

  // The producer version is informational; parse archives optimistically.
  reader.readString()

  const matchId = reader.readString()
  const startedUnixMilliseconds = reader.readInt64()
  const frames: RealtimeFrame[] = []
  const metadataTimeline: RealtimeMatchMetadata[] = []
  let metadata: RealtimeMatchMetadata | undefined
  let endedUnixMilliseconds: number | undefined

  while (!reader.atEnd) {
    const recordStart = reader.offset
    try {
      const recordType = reader.readByte()
      if (recordType === endRecord) {
        endedUnixMilliseconds = reader.readInt64()
        break
      }
      if (recordType === metadataRecord) {
        metadata = readMetadata(reader, matchId, startedUnixMilliseconds)
        metadataTimeline.push(metadata)
        continue
      }
      if (recordType !== frameRecord) break
      frames.push(readFrame(reader, matchId))
    } catch (error) {
      if (error instanceof ArchiveEndOfFileError && recordStart > 0) break
      throw error
    }
  }

  if (frames.length === 0) {
    throw new Error("存档中没有完整的比赛帧")
  }

  return {
    archive: {
      matchId,
      fileName,
      startedUnixMilliseconds,
      endedUnixMilliseconds,
      ended: endedUnixMilliseconds != null,
      frameCount: frames.length,
      firstTick: frames[0].tick,
      lastTick: frames.at(-1)!.tick,
      homeGoals: frames.at(-1)!.home.goals,
      awayGoals: frames.at(-1)!.away.goals,
      fileSizeBytes: buffer.byteLength,
    },
    metadata,
    metadataTimeline,
    frames,
  }
}

function readFrame(reader: DotNetBinaryReader, matchId: string): RealtimeFrame {
  const sequence = reader.readInt64()
  const tick = reader.readInt32()
  const displayTick = reader.readInt32()
  const period = reader.readInt32()
  const capturedUnixMilliseconds = reader.readInt64()
  const possessionRaw = reader.readInt8()
  const ballHolderRaw = reader.readInt32()
  const halfPitchWidth = reader.readFloat32()
  const halfPitchLength = reader.readFloat32()
  const momentumEventCount = reader.readByte()
  const momentumEvents = Array.from({ length: momentumEventCount }, () => ({
    eventIndex: reader.readInt32(),
    tick: reader.readInt32(),
    lateralPosition: reader.readFloat32(),
    longitudinalPosition: reader.readFloat32(),
    team: readTeamSide(reader),
    playerSlot: reader.readByte(),
    playerId: reader.readInt32(),
    receiverPlayerSlot: reader.readByte(),
    receiverPlayerId: reader.readInt32(),
    eventType: reader.readByte(),
    flags: reader.readUint16(),
  }))
  const home = readTeam(reader)
  const away = readTeam(reader)
  const playerCount = reader.readByte()
  const players = Array.from({ length: playerCount }, () => readPlayer(reader))
  const momentumCount = reader.readByte()
  const momentum = Array.from({ length: momentumCount }, () => ({
    value: reader.readFloat32(),
    timeTicks: reader.readInt32(),
    homeWeight: reader.readInt32(),
    awayWeight: reader.readInt32(),
  }))
  const rollingMomentumCount = reader.readByte()
  const rollingMomentum = Array.from({ length: rollingMomentumCount }, () => ({
    value: reader.readFloat32(),
    timeTicks: reader.readInt32(),
    homeWeight: reader.readInt32(),
    awayWeight: reader.readInt32(),
  }))

  return {
    sequence,
    matchId,
    tick,
    displayTick,
    period,
    capturedUnixMilliseconds,
    possessionTeam: possessionRaw === 0 ? "home" : possessionRaw === 1 ? "away" : undefined,
    ballHolderPlayerId: ballHolderRaw || undefined,
    halfPitchWidth,
    halfPitchLength,
    momentumEvents,
    momentum,
    rollingMomentum,
    home,
    away,
    players,
  }
}

function readTeam(reader: DotNetBinaryReader): RealtimeTeam {
  return {
    goals: reader.readByte(),
    xg: reader.readFloat32(),
    possessionTime: reader.readInt32(),
    shots: reader.readByte(),
    shotsOnTarget: reader.readByte(),
    shotsOffTarget: reader.readByte(),
    blockedShots: reader.readByte(),
    clearCutChances: reader.readByte(),
    passes: reader.readInt32(),
    passesCompleted: reader.readInt32(),
    crosses: reader.readInt16(),
    crossesCompleted: reader.readInt16(),
    aerials: reader.readInt16(),
    aerialsWon: reader.readInt16(),
    progressivePasses: reader.readInt16(),
    finalThirdPasses: reader.readInt16(),
    tacklesAttempted: reader.readByte(),
    tacklesWon: reader.readByte(),
    fouls: reader.readByte(),
    corners: reader.readByte(),
    offsides: reader.readByte(),
    yellowCards: reader.readByte(),
    redCards: reader.readByte(),
  }
}

function readPlayer(reader: DotNetBinaryReader): RealtimePlayer {
  const slot = reader.readByte()
  const playerId = reader.readInt32()
  const team = readTeamSide(reader)
  const isBallHolder = reader.readBoolean()
  const x = reader.readFloat32()
  const y = reader.readFloat32()
  const rating = reader.readFloat32()
  const isSubstitute = reader.readBoolean()
  const isOnPitch = reader.readBoolean()
  const subbedOnMinute = reader.readByte()
  const subbedOffMinute = reader.readByte()
  const yellowCards = reader.readByte()
  const redCards = reader.readByte()
  const goals = reader.readByte()
  const assists = reader.readByte()
  const xg = reader.readFloat32()
  const xa = reader.readFloat32()

  return {
    slot,
    playerId,
    team,
    isBallHolder,
    x,
    y,
    rating,
    isSubstitute,
    isOnPitch,
    subbedOnMinute,
    subbedOffMinute,
    yellowCards,
    redCards,
    goals,
    assists,
    xg,
    xa,
    shots: reader.readByte(),
    shotsOnTarget: reader.readByte(),
    blockedShots: reader.readByte(),
    clearCutChances: reader.readByte(),
    hitWoodwork: reader.readByte(),
    dribbles: reader.readByte(),
    fouls: reader.readByte(),
    fouled: reader.readByte(),
    crosses: reader.readByte(),
    crossesCompleted: reader.readByte(),
    passes: reader.readByte(),
    passesCompleted: reader.readByte(),
    keyPasses: reader.readByte(),
    tacklesAttempted: reader.readByte(),
    tacklesWon: reader.readByte(),
    keyTackles: reader.readByte(),
    aerials: reader.readByte(),
    aerialsWon: reader.readByte(),
    interceptions: reader.readByte(),
    throwIns: reader.readByte(),
    corners: reader.readByte(),
    defensiveFreeKicks: reader.readByte(),
    attackingFreeKicks: reader.readByte(),
    clearances: reader.readByte(),
    shotsFaced: reader.readByte(),
    distanceM: reader.readFloat32(),
  }
}

function readMetadata(
  reader: DotNetBinaryReader,
  matchId: string,
  startedUnixMilliseconds: number,
): RealtimeMatchMetadata {
  const capturedTick = reader.readInt32()
  const home = readTeamMetadata(reader)
  const away = readTeamMetadata(reader)
  const playerCount = reader.readByte()
  const players = Array.from({ length: playerCount }, () => readPlayerMetadata(reader))
  return { matchId, startedUnixMilliseconds, capturedTick, home, away, players }
}

function readTeamMetadata(reader: DotNetBinaryReader): RealtimeTeamMetadata {
  return {
    uid: undefinedIfZero(reader.readUint32()),
    clubUid: undefinedIfZero(reader.readUint32()),
    name: reader.readString(),
    backgroundColour: undefinedIfZero(reader.readUint32()),
    foregroundColour: undefinedIfZero(reader.readUint32()),
    outlineColour: undefinedIfZero(reader.readUint32()),
    logoPath: undefinedIfEmpty(reader.readString()),
  }
}

function readPlayerMetadata(reader: DotNetBinaryReader): RealtimePlayerMetadata {
  return {
    slot: reader.readByte(),
    playerId: reader.readInt32(),
    uid: undefinedIfZero(reader.readUint32()),
    team: readTeamSide(reader),
    shirtNumber: undefinedIfZero(reader.readByte()),
    position: undefinedIfEmpty(reader.readString()),
    inPossession: readTacticalAssignment(reader),
    outOfPossession: readTacticalAssignment(reader),
    firstName: undefinedIfEmpty(reader.readString()),
    secondName: undefinedIfEmpty(reader.readString()),
    commonName: undefinedIfEmpty(reader.readString()),
    displayName: reader.readString(),
    portraitPath: undefinedIfEmpty(reader.readString()),
    profile: readProfile(reader),
    attributes: readAttributes(reader),
  }
}

function readTacticalAssignment(reader: DotNetBinaryReader): PlayerTacticalAssignment | undefined {
  if (!reader.readBoolean()) return undefined
  return {
    positionMask: reader.readUint32(),
    position: reader.readString(),
    roleDuty: reader.readUint64(),
    role: reader.readString(),
    roleAbbreviation: reader.readString(),
    duty: undefinedIfEmpty(reader.readString()),
  }
}

function readProfile(reader: DotNetBinaryReader): PlayerProfile | undefined {
  if (!reader.readBoolean()) return undefined
  return {
    weeklyWage: readNullableInt(reader),
    heightCm: readNullableInt(reader),
    condition: readNullableInt(reader),
    morale: readNullableInt(reader),
    currentAbility: readNullableInt(reader),
    potentialAbility: readNullableInt(reader),
    currentReputation: readNullableInt(reader),
  }
}

function readAttributes(reader: DotNetBinaryReader): PlayerAttributes | undefined {
  if (!reader.readBoolean()) return undefined
  return {
    technical: readAttributeGroup(reader),
    mental: readAttributeGroup(reader),
    physical: readAttributeGroup(reader),
    goalkeeping: readAttributeGroup(reader),
  }
}

function readAttributeGroup(reader: DotNetBinaryReader) {
  const result: Record<string, number> = {}
  const count = reader.readByte()
  for (let index = 0; index < count; index += 1) result[reader.readString()] = reader.readByte()
  return result
}

function readNullableInt(reader: DotNetBinaryReader) {
  return undefinedIfZero(reader.readInt32())
}

function readTeamSide(reader: DotNetBinaryReader): TeamSide {
  return reader.readByte() === 1 ? "away" : "home"
}

function undefinedIfZero(value: number) {
  return value === 0 ? undefined : value
}

function undefinedIfEmpty(value: string) {
  return value.trim() === "" ? undefined : value
}

class ArchiveEndOfFileError extends Error {}

class DotNetBinaryReader {
  private readonly view: DataView
  private readonly bytes: Uint8Array
  private readonly decoder = new TextDecoder("utf-8")
  offset = 0

  constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer)
    this.bytes = new Uint8Array(buffer)
  }

  get atEnd() {
    return this.offset >= this.view.byteLength
  }

  readByte() {
    this.ensure(1)
    return this.view.getUint8(this.offset++)
  }

  readInt8() {
    this.ensure(1)
    return this.view.getInt8(this.offset++)
  }

  readBoolean() {
    return this.readByte() !== 0
  }

  readInt16() {
    this.ensure(2)
    const value = this.view.getInt16(this.offset, true)
    this.offset += 2
    return value
  }

  readUint16() {
    this.ensure(2)
    const value = this.view.getUint16(this.offset, true)
    this.offset += 2
    return value
  }

  readInt32() {
    this.ensure(4)
    const value = this.view.getInt32(this.offset, true)
    this.offset += 4
    return value
  }

  readUint32() {
    this.ensure(4)
    const value = this.view.getUint32(this.offset, true)
    this.offset += 4
    return value
  }

  readInt64() {
    this.ensure(8)
    const value = this.view.getBigInt64(this.offset, true)
    this.offset += 8
    const number = Number(value)
    if (!Number.isSafeInteger(number)) throw new Error("存档中的 64 位整数超出浏览器安全范围")
    return number
  }

  readUint64() {
    this.ensure(8)
    const value = this.view.getBigUint64(this.offset, true)
    this.offset += 8
    return Number(value)
  }

  readFloat32() {
    this.ensure(4)
    const value = this.view.getFloat32(this.offset, true)
    this.offset += 4
    return value
  }

  readAscii(length: number) {
    this.ensure(length)
    const value = String.fromCharCode(...this.bytes.subarray(this.offset, this.offset + length))
    this.offset += length
    return value
  }

  readString() {
    const length = this.read7BitEncodedInt()
    if (length < 0 || length > 1_048_576) throw new Error("存档字符串长度无效")
    this.ensure(length)
    const value = this.decoder.decode(this.bytes.subarray(this.offset, this.offset + length))
    this.offset += length
    return value
  }

  private read7BitEncodedInt() {
    let result = 0
    for (let shift = 0; shift < 35; shift += 7) {
      const byte = this.readByte()
      result |= (byte & 0x7f) << shift
      if ((byte & 0x80) === 0) return result
    }
    throw new Error("存档字符串长度编码无效")
  }

  private ensure(length: number) {
    if (this.offset + length > this.view.byteLength) throw new ArchiveEndOfFileError("存档尾部记录未写完整")
  }
}
