import type {
  RealtimeFrame,
  RealtimeMatchMetadata,
  RealtimeMomentumEvent,
  RealtimeMomentumPoint,
  RealtimePlayer,
  RealtimePlayerMetadata,
  RealtimeTeam,
  RealtimeTeamMetadata,
} from "@/api/realtimeMatch"
import type { ParsedLocalArchive } from "@/api/localArchive"
import type { PlayerAttributes, PlayerPositionFamiliarities, PlayerProfile, PlayerTacticalAssignment, TeamSide } from "@/types/match"
import { playerPositionLabels } from "@/types/match"

const magic = "FMLENS2\0"
const supportedStructure = 2
const metadataRecord = 1
const chunkRecord = 2
const finalIndexRecord = 3
const endRecord = 4
const metadataDeltaRecord = 5
const blockMagic = 0x324b4c42
const blockStructure = 1
const maxRecordBytes = 4 * 1024 * 1024
const maxChunkBytes = 16 * 1024 * 1024
const allTeamFields = (1n << 23n) - 1n
const allPlayerFields = (1n << 37n) - 1n

type ArchiveHeader = {
  matchId: string
  startedUnixMilliseconds: number
  headerLength: number
}

type BlockReference = {
  recordOffset: number
  startTick: number
  endTick: number
  frameCount: number
  uncompressedLength: number
  compressedLength: number
  payloadCrc: number
  compression: number
  payload: Uint8Array
}

type FinalSummary = {
  frameCount: number
  firstTick: number
  lastTick: number
  homeGoals: number
  awayGoals: number
}

export async function parseArchiveFile(buffer: ArrayBuffer, fileName: string): Promise<ParsedLocalArchive> {
  const reader = new ArchiveBufferReader(new Uint8Array(buffer))
  const header = readHeader(reader)
  const blocks: BlockReference[] = []
  const metadataTimeline: RealtimeMatchMetadata[] = []
  let metadata: RealtimeMatchMetadata | undefined
  let metadataRevision = 0
  let finalSummary: FinalSummary | undefined
  let endedUnixMilliseconds: number | undefined

  while (!reader.atEnd) {
    const recordStart = reader.offset
    try {
      const recordType = reader.readByte()
      if (recordType === metadataRecord) {
        const decoded = readMetadata(readRecordPayload(reader, maxRecordBytes), header)
        if (decoded.revision <= metadataRevision) throw new ArchiveError("元数据修订序号不是严格递增")
        metadataRevision = decoded.revision
        metadata = decoded.metadata
        metadataTimeline.push(decoded.metadata)
      } else if (recordType === metadataDeltaRecord) {
        if (!metadata) throw new ArchiveError("Metadata 增量缺少完整基线")
        const decoded = readMetadataDelta(readRecordPayload(reader, maxRecordBytes), header, metadata)
        if (decoded.revision <= metadataRevision) throw new ArchiveError("Metadata 修订序号没有严格递增")
        metadataRevision = decoded.revision
        metadata = decoded.metadata
        metadataTimeline.push(decoded.metadata)
      } else if (recordType === chunkRecord) {
        blocks.push(readBlock(reader, recordStart))
      } else if (recordType === finalIndexRecord) {
        finalSummary = readFinalIndex(readRecordPayload(reader, maxRecordBytes), blocks)
      } else if (recordType === endRecord) {
        const payload = readRecordPayload(reader, 64)
        if (payload.byteLength !== 8) throw new ArchiveError("结束记录长度无效")
        endedUnixMilliseconds = new ArchiveBufferReader(payload).readInt64()
        break
      } else {
        readRecordPayload(reader, maxRecordBytes)
      }
    } catch (error) {
      if (error instanceof ArchiveEndOfFileError && recordStart > 0) break
      throw error
    }
  }

  const frames: RealtimeFrame[] = []
  let blockError: unknown
  for (const block of blocks) {
    try {
      const payload = await decompressBlock(block)
      frames.push(...readFrames(payload, header.matchId, block.frameCount, block.startTick, block.endTick))
    } catch (error) {
      blockError = error
      break
    }
  }
  if (frames.length === 0) {
    if (blockError instanceof Error) throw new Error(`存档没有可恢复的完整比赛帧：${blockError.message}`)
    throw new Error("存档中没有完整的比赛帧")
  }

  const last = frames.at(-1)!
  const recovered = blockError != null
  return {
    archive: {
      matchId: header.matchId,
      fileName,
      startedUnixMilliseconds: header.startedUnixMilliseconds,
      endedUnixMilliseconds: recovered ? undefined : endedUnixMilliseconds,
      ended: !recovered && endedUnixMilliseconds != null,
      frameCount: recovered ? frames.length : finalSummary?.frameCount ?? frames.length,
      firstTick: recovered ? frames[0].tick : finalSummary?.firstTick ?? frames[0].tick,
      lastTick: recovered ? last.tick : finalSummary?.lastTick ?? last.tick,
      homeGoals: recovered ? last.home.goals : finalSummary?.homeGoals ?? last.home.goals,
      awayGoals: recovered ? last.away.goals : finalSummary?.awayGoals ?? last.away.goals,
      fileSizeBytes: buffer.byteLength,
    },
    metadata,
    metadataTimeline,
    frames,
  }
}

function readHeader(reader: ArchiveBufferReader): ArchiveHeader {
  if (reader.readAscii(magic.length) !== magic) throw new ArchiveError("不是有效的 FMMatchLens 存档")
  const major = reader.readUint16()
  reader.readUint16()
  const headerLength = reader.readUint32()
  if (major !== supportedStructure) throw new ArchiveError(`不支持的存档结构 ${major}`)
  if (headerLength < 36 || headerLength > 64 * 1024 || headerLength > reader.length) throw new ArchiveError("文件头长度无效")
  const headerBytes = reader.bytes.subarray(0, headerLength)
  const expectedCrc = new DataView(headerBytes.buffer, headerBytes.byteOffset, headerBytes.byteLength).getUint32(headerLength - 4, true)
  if (crc32(headerBytes.subarray(0, headerLength - 4)) !== expectedCrc) throw new ArchiveError("文件头 CRC 校验失败")
  const headerReader = new ArchiveBufferReader(headerBytes)
  headerReader.offset = 16
  headerReader.readUint64()
  const matchId = headerReader.readString()
  const startedUnixMilliseconds = headerReader.readInt64()
  const coordinateEncoding = headerReader.readByte()
  headerReader.readUint16()
  const compression = headerReader.readByte()
  if (headerReader.offset > headerLength - 4) throw new ArchiveError("文件头字段越过 CRC 边界")
  if (coordinateEncoding !== 1) throw new ArchiveError(`不支持坐标编码 ${coordinateEncoding}`)
  if (compression > 1) throw new ArchiveError(`不支持压缩算法 ${compression}`)
  reader.offset = headerLength
  return { matchId, startedUnixMilliseconds, headerLength }
}

function readBlock(reader: ArchiveBufferReader, recordStart: number): BlockReference {
  const headerTail = reader.readBytes(29)
  const expectedHeaderCrc = reader.readUint32()
  const completeHeader = reader.bytes.subarray(recordStart, recordStart + 30)
  if (crc32(completeHeader) !== expectedHeaderCrc) throw new ArchiveError("数据块头 CRC 校验失败")
  const header = new ArchiveBufferReader(headerTail)
  if (header.readUint32() !== blockMagic) throw new ArchiveError("数据块标识无效")
  if (header.readByte() !== blockStructure) throw new ArchiveError("不支持的数据块结构")
  const compression = header.readUint16()
  const startTick = header.readInt32()
  const endTick = header.readInt32()
  const frameCount = header.readUint16()
  const uncompressedLength = header.readUint32()
  const compressedLength = header.readUint32()
  const payloadCrc = header.readUint32()
  if (compression > 1) throw new ArchiveError(`不支持数据块压缩算法 ${compression}`)
  if (frameCount === 0 || endTick < startTick) throw new ArchiveError("数据块 Tick 范围无效")
  if (uncompressedLength === 0 || uncompressedLength > maxChunkBytes || compressedLength === 0 || compressedLength > maxChunkBytes) {
    throw new ArchiveError("数据块长度无效")
  }
  const payload = reader.readBytes(compressedLength)
  return { recordOffset: recordStart, startTick, endTick, frameCount, uncompressedLength, compressedLength, payloadCrc, compression, payload }
}

async function decompressBlock(block: BlockReference) {
  let payload: Uint8Array
  if (block.compression === 0) {
    payload = block.payload
  } else {
    if (typeof DecompressionStream === "undefined") throw new ArchiveError("当前浏览器不支持 Deflate 解压")
    try {
      const input = new Blob([block.payload.slice().buffer]).stream()
      const output = input.pipeThrough(new DecompressionStream("deflate"))
      const streamReader = output.getReader()
      payload = new Uint8Array(block.uncompressedLength)
      let offset = 0
      while (true) {
        const chunk = await streamReader.read()
        if (chunk.done) break
        if (offset + chunk.value.byteLength > payload.byteLength) throw new ArchiveError("数据块解压结果超过声明长度")
        payload.set(chunk.value, offset)
        offset += chunk.value.byteLength
      }
      if (offset !== payload.byteLength) throw new ArchiveError("数据块解压长度不匹配")
    } catch (error) {
      throw new ArchiveError(`数据块解压失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (payload.byteLength !== block.uncompressedLength) throw new ArchiveError("数据块解压长度不匹配")
  if (crc32(payload) !== block.payloadCrc) throw new ArchiveError("数据块载荷 CRC 校验失败")
  return payload
}

function readFrames(payload: Uint8Array, matchId: string, frameCount: number, startTick: number, endTick: number) {
  const reader = new ArchiveBufferReader(payload)
  if (reader.readByte() !== 1) throw new ArchiveError("不支持的 帧载荷版本")
  const frames: RealtimeFrame[] = []
  let previous: RealtimeFrame | undefined
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const flags = reader.readByte()
    const rosterReset = (flags & 1) !== 0
    const pitchChanged = (flags & 2) !== 0
    if (!previous && (!rosterReset || !pitchChanged)) throw new ArchiveError("数据块缺少独立关键帧")
    const sequence = addSafe(previous?.sequence ?? 0, reader.readVarInt())
    const tick = addSafe(previous?.tick ?? 0, reader.readVarInt())
    const displayTick = addSafe(previous?.displayTick ?? 0, reader.readVarInt())
    const capturedUnixMilliseconds = addSafe(previous?.capturedUnixMilliseconds ?? 0, reader.readVarInt())
    const period = addSafe(previous?.period ?? 0, reader.readVarInt())
    const possessionRaw = reader.readByte()
    const possessionTeam: TeamSide | undefined = possessionRaw === 1 ? "home" : possessionRaw === 2 ? "away" : undefined
    if (possessionRaw > 2) throw new ArchiveError("帧持球方无效")
    const holderSlotValue = reader.readVarUint()
    let halfPitchWidth = previous?.halfPitchWidth ?? 0
    let halfPitchLength = previous?.halfPitchLength ?? 0
    if (pitchChanged) {
      halfPitchWidth = reader.readFloat32()
      halfPitchLength = reader.readFloat32()
      validatePitch(halfPitchWidth, halfPitchLength)
    }
    const home = readTeamDelta(reader, previous?.home)
    const away = readTeamDelta(reader, previous?.away)
    let players: RealtimePlayer[]
    if (rosterReset) {
      const count = reader.readVarUint()
      if (count > 255) throw new ArchiveError("球员数量过大")
      players = Array.from({ length: count }, () => readFullPlayer(reader, halfPitchWidth, halfPitchLength))
      if (new Set(players.map((player) => player.slot)).size !== players.length) throw new ArchiveError("关键帧包含重复 Slot")
    } else {
      players = previous!.players.map((prior) => {
        const qx = quantize(prior.x, halfPitchWidth) + reader.readVarInt()
        const qy = quantize(prior.y, halfPitchLength) + reader.readVarInt()
        if (qx < 0 || qx > 65535 || qy < 0 || qy > 65535) throw new ArchiveError("坐标差分越界")
        const mask = reader.readVarUintBig()
        if ((mask & ~allPlayerFields) !== 0n) throw new ArchiveError("球员状态包含未知字段")
        return readPlayerFields(reader, { ...prior, x: dequantize(qx, halfPitchWidth), y: dequantize(qy, halfPitchLength) }, mask)
      })
    }
    const holderSlot = holderSlotValue - 1
    const holder = holderSlotValue > 0 ? players.find((player) => player.slot === holderSlot) : undefined
    if (holderSlotValue > 0 && !holder) throw new ArchiveError("持球球员 Slot 无效")
    const ballHolderPlayerId = holder?.playerId
    players = players.map((player) => ({ ...player, isBallHolder: player.playerId === ballHolderPlayerId }))
    const momentumEvents = readTail(reader, previous?.momentumEvents, readEvent)
    const momentum = readTail(reader, previous?.momentum, readMomentum)
    const rollingMomentum = readTail(reader, previous?.rollingMomentum, readMomentum)
    const frame: RealtimeFrame = {
      sequence, matchId, tick, displayTick, period, capturedUnixMilliseconds, possessionTeam, ballHolderPlayerId,
      halfPitchWidth, halfPitchLength, momentumEvents, momentum, rollingMomentum, home, away, players,
    }
    frames.push(frame)
    previous = frame
  }
  if (!reader.atEnd) throw new ArchiveError("数据块含有多余字节")
  if (frames[0].tick !== startTick || frames.at(-1)!.tick !== endTick) throw new ArchiveError("数据块 Tick 范围不匹配")
  return frames
}

function readTeamDelta(reader: ArchiveBufferReader, previous?: RealtimeTeam): RealtimeTeam {
  const mask = reader.readVarUintBig()
  if ((mask & ~allTeamFields) !== 0n) throw new ArchiveError("球队状态包含未知字段")
  const prior: RealtimeTeam = previous ?? {
    goals: 0, xg: 0, possessionTime: 0, shots: 0, shotsOnTarget: 0, shotsOffTarget: 0, blockedShots: 0,
    clearCutChances: 0, passes: 0, passesCompleted: 0, crosses: 0, crossesCompleted: 0, aerials: 0,
    aerialsWon: 0, progressivePasses: 0, finalThirdPasses: 0, tacklesAttempted: 0, tacklesWon: 0,
    fouls: 0, corners: 0, offsides: 0, yellowCards: 0, redCards: 0,
  }
  const integer = (bit: number, value: number) => (mask & (1n << BigInt(bit))) === 0n ? value : addSafe(previous ? value : 0, reader.readVarInt())
  const float = (bit: number, value: number) => (mask & (1n << BigInt(bit))) === 0n ? value : reader.readFloatXor(value)
  return {
    goals: integer(0, prior.goals), xg: float(1, prior.xg), possessionTime: integer(2, prior.possessionTime),
    shots: integer(3, prior.shots), shotsOnTarget: integer(4, prior.shotsOnTarget), shotsOffTarget: integer(5, prior.shotsOffTarget),
    blockedShots: integer(6, prior.blockedShots), clearCutChances: integer(7, prior.clearCutChances), passes: integer(8, prior.passes),
    passesCompleted: integer(9, prior.passesCompleted), crosses: integer(10, prior.crosses), crossesCompleted: integer(11, prior.crossesCompleted),
    aerials: integer(12, prior.aerials), aerialsWon: integer(13, prior.aerialsWon), progressivePasses: integer(14, prior.progressivePasses),
    finalThirdPasses: integer(15, prior.finalThirdPasses), tacklesAttempted: integer(16, prior.tacklesAttempted), tacklesWon: integer(17, prior.tacklesWon),
    fouls: integer(18, prior.fouls), corners: integer(19, prior.corners), offsides: integer(20, prior.offsides),
    yellowCards: integer(21, prior.yellowCards), redCards: integer(22, prior.redCards),
  }
}

function readFullPlayer(reader: ArchiveBufferReader, halfWidth: number, halfLength: number): RealtimePlayer {
  const slot = reader.readVarUint()
  const playerId = reader.readVarInt()
  const teamRaw = reader.readByte()
  if (teamRaw > 1) throw new ArchiveError("球员所属球队无效")
  const seed = {
    slot, playerId, team: teamRaw === 1 ? "away" : "home", isBallHolder: false,
    x: dequantize(reader.readUint16(), halfWidth), y: dequantize(reader.readUint16(), halfLength), rating: 0,
    isSubstitute: false, isOnPitch: false, subbedOnMinute: 0, subbedOffMinute: 0, yellowCards: 0, redCards: 0,
    goals: 0, assists: 0, shotsFaced: 0,
  } satisfies RealtimePlayer
  return readPlayerFields(reader, seed, allPlayerFields)
}

function readPlayerFields(reader: ArchiveBufferReader, prior: RealtimePlayer, mask: bigint): RealtimePlayer {
  const result = { ...prior }
  const has = (bit: number) => (mask & (1n << BigInt(bit))) !== 0n
  if (has(0)) result.rating = reader.readFloatXor(result.rating)
  if (has(1)) result.isSubstitute = reader.readBoolean()
  if (has(2)) result.isOnPitch = reader.readBoolean()
  const integerFields: Array<[number, keyof RealtimePlayer]> = [
    [3, "subbedOnMinute"], [4, "subbedOffMinute"], [5, "yellowCards"], [6, "redCards"], [7, "goals"], [8, "assists"],
  ]
  for (const [bit, field] of integerFields) if (has(bit)) Object.assign(result, { [field]: reader.readVarInt() })
  if (has(9)) result.xg = reader.readFloatXor(result.xg ?? 0)
  if (has(10)) result.xa = reader.readFloatXor(result.xa ?? 0)
  const statFields: Array<[number, keyof RealtimePlayer]> = [
    [11, "shots"], [12, "shotsOnTarget"], [13, "blockedShots"], [14, "clearCutChances"], [15, "hitWoodwork"],
    [16, "dribbles"], [17, "fouls"], [18, "fouled"], [19, "crosses"], [20, "crossesCompleted"], [21, "passes"],
    [22, "passesCompleted"], [23, "keyPasses"], [24, "tacklesAttempted"], [25, "tacklesWon"], [26, "keyTackles"],
    [27, "aerials"], [28, "aerialsWon"], [29, "interceptions"], [30, "throwIns"], [31, "corners"],
    [32, "defensiveFreeKicks"], [33, "attackingFreeKicks"], [34, "clearances"], [35, "shotsFaced"],
  ]
  for (const [bit, field] of statFields) if (has(bit)) Object.assign(result, { [field]: reader.readVarInt() })
  if (has(36)) result.distanceM = reader.readFloatXor(result.distanceM ?? 0)
  return result
}

function readTail<T>(reader: ArchiveBufferReader, previous: readonly T[] | undefined, read: (reader: ArchiveBufferReader) => T): T[] {
  const prior = previous ?? []
  const common = reader.readVarUint()
  const tail = reader.readVarUint()
  if (common > prior.length || common + tail > 65_536) throw new ArchiveError("增量流数量无效")
  const result = prior.slice(0, common) as T[]
  for (let index = 0; index < tail; index += 1) result.push(read(reader))
  return result
}

function readEvent(reader: ArchiveBufferReader): RealtimeMomentumEvent {
  const eventIndex = reader.readVarInt()
  const tick = reader.readVarInt()
  const lateralPosition = reader.readFloat32()
  const longitudinalPosition = reader.readFloat32()
  const teamRaw = reader.readByte()
  if (teamRaw > 1) throw new ArchiveError("事件所属球队无效")
  return {
    eventIndex, tick, lateralPosition, longitudinalPosition, team: teamRaw === 1 ? "away" : "home",
    playerSlot: reader.readVarInt(), playerId: reader.readVarInt(), receiverPlayerSlot: reader.readVarInt(),
    receiverPlayerId: reader.readVarInt(), eventType: reader.readVarInt(), flags: reader.readVarInt(),
  }
}

function readMomentum(reader: ArchiveBufferReader): RealtimeMomentumPoint {
  return { value: reader.readFloat32(), timeTicks: reader.readVarInt(), homeWeight: reader.readVarInt(), awayWeight: reader.readVarInt() }
}

function readMetadata(payload: Uint8Array, header: ArchiveHeader) {
  const reader = new ArchiveBufferReader(payload)
  const revision = reader.readVarUint()
  const capturedTick = reader.readVarInt()
  const stringCount = reader.readVarUint()
  if (stringCount > 16_384) throw new ArchiveError("元数据字符串表过大")
  const strings: Array<string | undefined> = [undefined]
  for (let index = 0; index < stringCount; index += 1) strings.push(reader.readString())
  const home = readTeamMetadata(reader, strings)
  const away = readTeamMetadata(reader, strings)
  const playerCount = reader.readVarUint()
  if (playerCount > 255) throw new ArchiveError("元数据球员数量过大")
  const players = Array.from({ length: playerCount }, () => readPlayerMetadata(reader, strings))
  if (new Set(players.map((player) => player.slot)).size !== players.length) throw new ArchiveError("元数据包含重复 Slot")
  if (new Set(players.map((player) => player.playerId)).size !== players.length) throw new ArchiveError("元数据包含重复球员 ID")
  if (!reader.atEnd) throw new ArchiveError("元数据包含多余字节")
  const metadata: RealtimeMatchMetadata = { matchId: header.matchId, startedUnixMilliseconds: header.startedUnixMilliseconds, capturedTick, home, away, players }
  return { revision, metadata }
}

function readMetadataDelta(payload: Uint8Array, header: ArchiveHeader, previous: RealtimeMatchMetadata) {
  const reader = new ArchiveBufferReader(payload)
  const revision = reader.readVarUint()
  const capturedTick = reader.readVarInt()
  const stringCount = reader.readVarUint()
  if (stringCount > 16_384) throw new ArchiveError("Metadata 字符串表过大")
  const strings: Array<string | undefined> = [undefined]
  for (let index = 0; index < stringCount; index += 1) strings.push(reader.readString())

  const teamFlags = reader.readByte()
  if ((teamFlags & ~0x03) !== 0) throw new ArchiveError("Metadata 增量含有未知球队字段")
  const home = (teamFlags & 0x01) !== 0 ? readTeamMetadata(reader, strings) : previous.home
  const away = (teamFlags & 0x02) !== 0 ? readTeamMetadata(reader, strings) : previous.away
  const players = [...previous.players]
  const deltaCount = reader.readVarUint()
  if (deltaCount > 255) throw new ArchiveError("Metadata 增量球员数量过大")
  for (let index = 0; index < deltaCount; index += 1) {
    const flags = reader.readByte()
    if (flags === 0 || (flags & ~0x07) !== 0 || ((flags & 0x01) !== 0 && flags !== 0x01)) {
      throw new ArchiveError("Metadata 增量含有无效球员字段")
    }
    if ((flags & 0x01) !== 0) {
      const player = readPlayerMetadata(reader, strings)
      if (players.some((existing) => existing.playerId === player.playerId)) throw new ArchiveError("Metadata 增量重复添加球员")
      players.push(player)
      continue
    }

    const playerId = reader.readVarInt()
    const playerIndex = players.findIndex((player) => player.playerId === playerId)
    if (playerIndex < 0) throw new ArchiveError("Metadata 增量引用了未知球员")
    const existing = players[playerIndex]
    players[playerIndex] = {
      ...existing,
      inPossession: (flags & 0x02) !== 0 ? readAssignment(reader, strings) : existing.inPossession,
      outOfPossession: (flags & 0x04) !== 0 ? readAssignment(reader, strings) : existing.outOfPossession,
    }
  }
  players.sort((left, right) => left.slot - right.slot)
  if (new Set(players.map((player) => player.slot)).size !== players.length) throw new ArchiveError("Metadata 增量产生了重复 Slot")
  if (!reader.atEnd) throw new ArchiveError("Metadata 增量包含多余字节")
  const metadata: RealtimeMatchMetadata = {
    matchId: header.matchId,
    startedUnixMilliseconds: header.startedUnixMilliseconds,
    capturedTick,
    home,
    away,
    players,
  }
  return { revision, metadata }
}

function readTeamMetadata(reader: ArchiveBufferReader, strings: Array<string | undefined>): RealtimeTeamMetadata {
  return {
    uid: readNullableUint(reader), clubUid: readNullableUint(reader), name: readStringId(reader, strings) ?? "",
    backgroundColour: readNullableUint(reader), foregroundColour: readNullableUint(reader), outlineColour: readNullableUint(reader),
    logoPath: readStringId(reader, strings),
  }
}

function readPlayerMetadata(
  reader: ArchiveBufferReader,
  strings: Array<string | undefined>,
): RealtimePlayerMetadata {
  const slot = reader.readVarUint()
  const playerId = reader.readVarInt()
  const uid = readNullableUint(reader)
  const teamRaw = reader.readByte()
  if (teamRaw > 1) throw new ArchiveError("元数据球队值无效")
  const shirtNumber = readNullableInt(reader)
  const position = readStringId(reader, strings)
  const positionFamiliarities = readPositionFamiliarities(reader)
  const inPossession = readAssignment(reader, strings)
  const outOfPossession = readAssignment(reader, strings)
  const firstName = readStringId(reader, strings)
  const secondName = readStringId(reader, strings)
  const commonName = readStringId(reader, strings)
  const displayName = readStringId(reader, strings) ?? `Player ${playerId}`
  const portraitPath = readStringId(reader, strings)
  const profile = readProfile(reader)
  const attributes = readAttributes(reader, strings)
  return { slot, playerId, uid, team: teamRaw === 1 ? "away" : "home", shirtNumber, position, positionFamiliarities, inPossession, outOfPossession,
    firstName, secondName, commonName, displayName, portraitPath, profile, attributes }
}

function readPositionFamiliarities(reader: ArchiveBufferReader): PlayerPositionFamiliarities | undefined {
  if (!reader.readBoolean()) return undefined
  return Object.fromEntries(playerPositionLabels.map((label) => [label, reader.readByte()]))
}

function readAssignment(reader: ArchiveBufferReader, strings: Array<string | undefined>): PlayerTacticalAssignment | undefined {
  if (!reader.readBoolean()) return undefined
  return {
    positionMask: reader.readVarUint(), position: readStringId(reader, strings) ?? "", roleDuty: reader.readVarUintBig().toString(),
    role: readStringId(reader, strings) ?? "", roleAbbreviation: readStringId(reader, strings) ?? "", duty: readStringId(reader, strings),
  }
}

function readProfile(reader: ArchiveBufferReader): PlayerProfile | undefined {
  if (!reader.readBoolean()) return undefined
  return { weeklyWage: readNullableInt(reader), heightCm: readNullableInt(reader), condition: readNullableInt(reader),
    morale: readNullableInt(reader), currentAbility: readNullableInt(reader), potentialAbility: readNullableInt(reader), currentReputation: readNullableInt(reader) }
}

function readAttributes(reader: ArchiveBufferReader, strings: Array<string | undefined>): PlayerAttributes | undefined {
  if (!reader.readBoolean()) return undefined
  return { technical: readAttributeGroup(reader, strings), mental: readAttributeGroup(reader, strings),
    physical: readAttributeGroup(reader, strings), goalkeeping: readAttributeGroup(reader, strings) }
}

function readAttributeGroup(reader: ArchiveBufferReader, strings: Array<string | undefined>) {
  const count = reader.readVarUint()
  if (count > 1_024) throw new ArchiveError("属性组过大")
  const result: Record<string, number> = {}
  for (let index = 0; index < count; index += 1) {
    const name = readStringId(reader, strings)
    if (!name) throw new ArchiveError("属性名称引用无效")
    result[name] = reader.readVarInt()
  }
  return result
}

function readStringId(reader: ArchiveBufferReader, strings: Array<string | undefined>) {
  const id = reader.readVarUint()
  if (id === 0) return undefined
  if (id >= strings.length) throw new ArchiveError("字符串引用无效")
  return strings[id]
}

function readNullableUint(reader: ArchiveBufferReader) { return reader.readBoolean() ? reader.readVarUint() : undefined }
function readNullableInt(reader: ArchiveBufferReader) { return reader.readBoolean() ? reader.readVarInt() : undefined }

function readFinalIndex(payload: Uint8Array, blocks: readonly BlockReference[]): FinalSummary {
  const reader = new ArchiveBufferReader(payload)
  const summary = { frameCount: reader.readVarUint(), firstTick: reader.readVarInt(), lastTick: reader.readVarInt(),
    homeGoals: reader.readVarInt(), awayGoals: reader.readVarInt() }
  const count = reader.readVarUint()
  if (count !== blocks.length) throw new ArchiveError("最终索引块数量不匹配")
  for (let index = 0; index < count; index += 1) {
    const startTick = reader.readVarInt()
    const endTick = reader.readVarInt()
    const recordOffset = reader.readVarUint()
    const compressedLength = reader.readVarUint()
    const frameCount = reader.readVarUint()
    const block = blocks[index]
    if (startTick !== block.startTick || endTick !== block.endTick || recordOffset !== block.recordOffset || compressedLength !== block.compressedLength || frameCount !== block.frameCount) {
      throw new ArchiveError("最终索引与数据块头不一致")
    }
  }
  if (!reader.atEnd) throw new ArchiveError("最终索引包含多余字节")
  return summary
}

function readRecordPayload(reader: ArchiveBufferReader, maxLength: number) {
  const length = reader.readUint32()
  const expectedCrc = reader.readUint32()
  if (length > maxLength) throw new ArchiveError("记录长度超限")
  const payload = reader.readBytes(length)
  if (crc32(payload) !== expectedCrc) throw new ArchiveError("记录 CRC 校验失败")
  return payload
}

function validatePitch(width: number, length: number) {
  if (!Number.isFinite(width) || !Number.isFinite(length) || width <= 0 || length <= 0 || width > 1_000 || length > 1_000) {
    throw new ArchiveError("球场尺寸无效")
  }
}

function quantize(value: number, halfExtent: number) {
  if (!Number.isFinite(value)) throw new ArchiveError("坐标不是有限数值")
  return Math.round(Math.min(1, Math.max(0, (value + halfExtent) / (halfExtent * 2))) * 65535)
}

function dequantize(value: number, halfExtent: number) { return value / 65535 * halfExtent * 2 - halfExtent }

function addSafe(left: number, right: number) {
  const value = left + right
  if (!Number.isSafeInteger(value)) throw new ArchiveError("差分结果超出浏览器安全整数范围")
  return value
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = (crc ^ byte) >>> 0
    for (let bit = 0; bit < 8; bit += 1) crc = ((crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1) >>> 0
  }
  return (~crc) >>> 0
}

class ArchiveError extends Error {}
class ArchiveEndOfFileError extends ArchiveError {}

class ArchiveBufferReader {
  readonly bytes: Uint8Array
  private readonly view: DataView
  private readonly decoder = new TextDecoder("utf-8", { fatal: true })
  private readonly floatScratch = new DataView(new ArrayBuffer(4))
  offset = 0

  constructor(bytes: Uint8Array) {
    this.bytes = bytes
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  get atEnd() { return this.offset >= this.bytes.byteLength }
  get length() { return this.bytes.byteLength }

  readByte() { this.ensure(1); return this.view.getUint8(this.offset++) }
  readBoolean() { return this.readByte() !== 0 }
  readUint16() { this.ensure(2); const value = this.view.getUint16(this.offset, true); this.offset += 2; return value }
  readInt32() { this.ensure(4); const value = this.view.getInt32(this.offset, true); this.offset += 4; return value }
  readUint32() { this.ensure(4); const value = this.view.getUint32(this.offset, true); this.offset += 4; return value }
  readFloat32() { this.ensure(4); const value = this.view.getFloat32(this.offset, true); this.offset += 4; return value }
  readFloatXor(previous: number) {
    this.floatScratch.setFloat32(0, previous, true)
    this.floatScratch.setUint32(0, (this.floatScratch.getUint32(0, true) ^ this.readVarUint()) >>> 0, true)
    return this.floatScratch.getFloat32(0, true)
  }
  readInt64() { this.ensure(8); const value = Number(this.view.getBigInt64(this.offset, true)); this.offset += 8; if (!Number.isSafeInteger(value)) throw new ArchiveError("64 位整数超出浏览器安全范围"); return value }
  readUint64() { this.ensure(8); const value = Number(this.view.getBigUint64(this.offset, true)); this.offset += 8; if (!Number.isSafeInteger(value)) throw new ArchiveError("64 位整数超出浏览器安全范围"); return value }
  readBytes(length: number) { this.ensure(length); const value = this.bytes.subarray(this.offset, this.offset + length); this.offset += length; return value }
  readAscii(length: number) { return String.fromCharCode(...this.readBytes(length)) }
  readString() {
    const length = this.readVarUint()
    if (length > 1_048_576) throw new ArchiveError("字符串长度无效")
    try { return this.decoder.decode(this.readBytes(length)) } catch { throw new ArchiveError("字符串不是有效 UTF-8") }
  }
  readVarUintBig() {
    let result = 0n
    for (let index = 0; index < 10; index += 1) {
      const byte = this.readByte()
      if (index === 9 && byte > 1) throw new ArchiveError("VarInt 超出 UInt64 范围")
      result |= BigInt(byte & 0x7f) << BigInt(index * 7)
      if ((byte & 0x80) === 0) return result
    }
    throw new ArchiveError("VarInt 长度无效")
  }
  readVarUint() { const value = Number(this.readVarUintBig()); if (!Number.isSafeInteger(value)) throw new ArchiveError("VarInt 超出浏览器安全范围"); return value }
  readVarInt() {
    const raw = this.readVarUintBig()
    const value = Number((raw >> 1n) ^ -(raw & 1n))
    if (!Number.isSafeInteger(value)) throw new ArchiveError("有符号 VarInt 超出浏览器安全范围")
    return value
  }
  private ensure(length: number) { if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.bytes.byteLength) throw new ArchiveEndOfFileError("存档尾部记录未写完整") }
}
