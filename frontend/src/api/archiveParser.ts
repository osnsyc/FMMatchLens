import type {
  RealtimeFrame,
  ArchiveRatingInputs,
  RealtimeMatchMetadata,
  RealtimeMomentumEvent,
  RealtimeMomentumPoint,
  RealtimePlayer,
  RealtimePlayerMetadata,
  RealtimeTeam,
  RealtimeTeamMetadata,
} from "@/api/realtimeMatch"
import type { ParsedLocalArchive } from "@/api/localArchive"
import type { PlayerAttributes, PlayerPositionFamiliarities, PlayerProfile, PlayerSeasonDetailedStats, PlayerSeasonStats, PlayerSeasonStatsSlot, PlayerTacticalAssignment, TeamSide } from "@/types/match"
import { playerPositionLabels } from "@/types/match"
import {
  deriveRatingClassification,
  observedRatingWeightConfiguration,
  type RatingClassificationState,
} from "@/lib/ratingCalculator"

const magic = "FMLENS2\0"
const archiveStructureMajor = 2
const firstSupportedStructureMinor = 1
const archiveStructureMinor = 8
const legacy21FramePayloadMarker = 1
const legacy21BlockStructure = 1
const metadataRecord = 1
const chunkRecord = 2
const finalIndexRecord = 3
const endRecord = 4
const metadataDeltaRecord = 5
const ratingModelMetadataRecord = 7
const blockMagic = 0x324b4c42
const maxRecordBytes = 4 * 1024 * 1024
const maxChunkBytes = 16 * 1024 * 1024
const legacyTeamFields = (1n << 23n) - 1n
const allTeamFields = (1n << 25n) - 1n
const legacyPlayerFields = (1n << 39n) - 1n
const version27PlayerFields = (1n << 42n) - 1n
const allPlayerFields = (1n << 43n) - 1n
const compactPlayerFields = allPlayerFields & ~(1n << 36n)
const version27CompactPlayerFields = version27PlayerFields & ~(1n << 36n)

type ArchiveHeader = {
  structureMajor: number
  structureMinor: number
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
  let ratingModelMetadata: RatingModelMetadata | undefined

  while (!reader.atEnd) {
    const recordStart = reader.offset
    try {
      const recordType = reader.readByte()
      if (recordType === metadataRecord) {
        const decoded = readMetadata(readRecordPayload(reader, maxRecordBytes), header)
        if (decoded.revision <= metadataRevision) throw new ArchiveError("Metadata revision numbers are not strictly increasing")
        metadataRevision = decoded.revision
        metadata = metadata
          ? {
              ...decoded.metadata,
              home: { ...decoded.metadata.home, manager: decoded.metadata.home.manager ?? metadata.home.manager },
              away: { ...decoded.metadata.away, manager: decoded.metadata.away.manager ?? metadata.away.manager },
            }
          : decoded.metadata
        metadataTimeline.push(metadata)
      } else if (recordType === metadataDeltaRecord) {
        if (!metadata) throw new ArchiveError("Metadata delta is missing a complete baseline")
        const decoded = readMetadataDelta(readRecordPayload(reader, maxRecordBytes), header, metadata)
        if (decoded.revision <= metadataRevision) throw new ArchiveError("Metadata revision numbers are not strictly increasing")
        metadataRevision = decoded.revision
        metadata = decoded.metadata
        metadataTimeline.push(decoded.metadata)
      } else if (recordType === chunkRecord) {
        blocks.push(readBlock(reader, recordStart, header.structureMinor))
      } else if (recordType === ratingModelMetadataRecord) {
        if (ratingModelMetadata != null) throw new ArchiveError("Rating model metadata is duplicated")
        ratingModelMetadata = readRatingModelMetadata(new ArchiveBufferReader(readRecordPayload(reader, 32)))
      } else if (recordType === finalIndexRecord) {
        finalSummary = readFinalIndex(readRecordPayload(reader, maxRecordBytes), blocks)
      } else if (recordType === endRecord) {
        const payload = readRecordPayload(reader, 64)
        if (payload.byteLength !== 8) throw new ArchiveError("Invalid end record length")
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
  const ratingClassificationBySlot = new Map<number, RatingClassificationState>()
  let blockError: unknown
  for (const block of blocks) {
    try {
      const payload = await decompressBlock(block)
      frames.push(...readFrames(
        payload, header.matchId, block.frameCount, block.startTick, block.endTick,
        header.structureMinor, ratingModelMetadata, ratingClassificationBySlot,
      ))
    } catch (error) {
      blockError = error
      break
    }
  }
  if (frames.length === 0) {
    if (blockError instanceof Error) throw new Error(`Archive has no recoverable complete match frames: ${blockError.message}`)
    throw new Error("Archive contains no complete match frames")
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
      matchDate: metadata?.matchDate,
      homeGoals: recovered ? last.home.goals : finalSummary?.homeGoals ?? last.home.goals,
      awayGoals: recovered ? last.away.goals : finalSummary?.awayGoals ?? last.away.goals,
      fileSizeBytes: buffer.byteLength,
    },
    metadata,
    metadataTimeline,
    frames,
    ratingConfiguration: observedRatingWeightConfiguration,
  }
}

function readHeader(reader: ArchiveBufferReader): ArchiveHeader {
  if (reader.readAscii(magic.length) !== magic) throw new ArchiveError("Not a valid FMMatchLens archive")
  const major = reader.readUint16()
  const minor = reader.readUint16()
  const headerLength = reader.readUint32()
  if (major !== archiveStructureMajor || minor < firstSupportedStructureMinor || minor > archiveStructureMinor) {
    throw new ArchiveError(`Unsupported archive structure ${major}.${minor}`)
  }
  if (headerLength < 36 || headerLength > 64 * 1024 || headerLength > reader.length) throw new ArchiveError("Invalid file header length")
  const headerBytes = reader.bytes.subarray(0, headerLength)
  const expectedCrc = new DataView(headerBytes.buffer, headerBytes.byteOffset, headerBytes.byteLength).getUint32(headerLength - 4, true)
  if (crc32(headerBytes.subarray(0, headerLength - 4)) !== expectedCrc) throw new ArchiveError("File header CRC check failed")
  const headerReader = new ArchiveBufferReader(headerBytes)
  headerReader.offset = 16
  headerReader.readUint64()
  const matchId = headerReader.readString()
  const startedUnixMilliseconds = headerReader.readInt64()
  const coordinateEncoding = headerReader.readByte()
  headerReader.readUint16()
  const compression = headerReader.readByte()
  if (headerReader.offset > headerLength - 4) throw new ArchiveError("File header fields extend past the CRC boundary")
  if (coordinateEncoding !== 1) throw new ArchiveError(`Unsupported coordinate encoding ${coordinateEncoding}`)
  if (compression > 1) throw new ArchiveError(`Unsupported compression algorithm ${compression}`)
  reader.offset = headerLength
  return { structureMajor: major, structureMinor: minor, matchId, startedUnixMilliseconds, headerLength }
}

function readBlock(reader: ArchiveBufferReader, recordStart: number, structureMinor: number): BlockReference {
  const legacy21 = structureMinor === 1
  const headerTailLength = legacy21 ? 29 : 28
  const headerTail = reader.readBytes(headerTailLength)
  const expectedHeaderCrc = reader.readUint32()
  const completeHeader = reader.bytes.subarray(recordStart, recordStart + headerTailLength + 1)
  if (crc32(completeHeader) !== expectedHeaderCrc) throw new ArchiveError("Block header CRC check failed")
  const header = new ArchiveBufferReader(headerTail)
  if (header.readUint32() !== blockMagic) throw new ArchiveError("Invalid block identifier")
  if (legacy21 && header.readByte() !== legacy21BlockStructure) throw new ArchiveError("Invalid 2.1 block structure marker")
  const compression = header.readUint16()
  const startTick = header.readInt32()
  const endTick = header.readInt32()
  const frameCount = header.readUint16()
  const uncompressedLength = header.readUint32()
  const compressedLength = header.readUint32()
  const payloadCrc = header.readUint32()
  if (compression > 1) throw new ArchiveError(`Unsupported block compression algorithm ${compression}`)
  if (frameCount === 0 || endTick < startTick) throw new ArchiveError("Invalid block tick range")
  if (uncompressedLength === 0 || uncompressedLength > maxChunkBytes || compressedLength === 0 || compressedLength > maxChunkBytes) {
    throw new ArchiveError("Invalid block length")
  }
  const payload = reader.readBytes(compressedLength)
  return { recordOffset: recordStart, startTick, endTick, frameCount, uncompressedLength, compressedLength, payloadCrc, compression, payload }
}

async function decompressBlock(block: BlockReference) {
  let payload: Uint8Array
  if (block.compression === 0) {
    payload = block.payload
  } else {
    if (typeof DecompressionStream === "undefined") throw new ArchiveError("This browser does not support Deflate decompression")
    try {
      const input = new Blob([block.payload.slice().buffer]).stream()
      const output = input.pipeThrough(new DecompressionStream("deflate"))
      const streamReader = output.getReader()
      payload = new Uint8Array(block.uncompressedLength)
      let offset = 0
      while (true) {
        const chunk = await streamReader.read()
        if (chunk.done) break
        if (offset + chunk.value.byteLength > payload.byteLength) throw new ArchiveError("Decompressed block exceeds the declared length")
        payload.set(chunk.value, offset)
        offset += chunk.value.byteLength
      }
      if (offset !== payload.byteLength) throw new ArchiveError("Decompressed block length mismatch")
    } catch (error) {
      throw new ArchiveError(`Block decompression failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (payload.byteLength !== block.uncompressedLength) throw new ArchiveError("Decompressed block length mismatch")
  if (crc32(payload) !== block.payloadCrc) throw new ArchiveError("Block payload CRC check failed")
  return payload
}

function readFrames(
  payload: Uint8Array,
  matchId: string,
  frameCount: number,
  startTick: number,
  endTick: number,
  structureMinor: number,
  ratingModelMetadata: RatingModelMetadata | undefined,
  ratingClassificationBySlot: Map<number, RatingClassificationState>,
) {
  const reader = new ArchiveBufferReader(payload)
  const supportedTeamFields = structureMinor >= 6 ? allTeamFields : legacyTeamFields
  const supportedPlayerFields = structureMinor >= 8
    ? compactPlayerFields
    : structureMinor >= 7
      ? version27CompactPlayerFields
      : structureMinor >= 6
        ? version27PlayerFields
        : legacyPlayerFields
  if (structureMinor === 1 && reader.readByte() !== legacy21FramePayloadMarker) {
    throw new ArchiveError("Invalid 2.1 frame payload marker")
  }
  const frames: RealtimeFrame[] = []
  let previous: RealtimeFrame | undefined
  const previousRatingPlayers = new Map<number, RatingWirePlayerState>()
  let previousRatingMatch: RatingWireMatchState | undefined
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const flags = reader.readByte()
    if ((flags & ~(structureMinor >= 7 ? 31 : 3)) !== 0) throw new ArchiveError("Invalid frame change flags")
    const rosterReset = (flags & 1) !== 0
    const pitchChanged = (flags & 2) !== 0
    if (!previous && (!rosterReset || !pitchChanged)) throw new ArchiveError("Block is missing a self-contained keyframe")
    const sequence = addSafe(previous?.sequence ?? 0, reader.readVarInt())
    const tick = addSafe(previous?.tick ?? 0, reader.readVarInt())
    const displayTick = addSafe(previous?.displayTick ?? 0, reader.readVarInt())
    const capturedUnixMilliseconds = addSafe(previous?.capturedUnixMilliseconds ?? 0, reader.readVarInt())
    const period = addSafe(previous?.period ?? 0, reader.readVarInt())
    const possessionRaw = reader.readByte()
    const possessionTeam: TeamSide | undefined = possessionRaw === 1 ? "home" : possessionRaw === 2 ? "away" : undefined
    if (possessionRaw > 2) throw new ArchiveError("Invalid frame possession team")
    const holderSlotValue = reader.readVarUint()
    const ballXCentimeters = structureMinor >= 7
      ? readBallDelta(reader, previous?.ballXCentimeters ?? 0, (flags & 4) !== 0) : 0
    const ballYCentimeters = structureMinor >= 7
      ? readBallDelta(reader, previous?.ballYCentimeters ?? 0, (flags & 8) !== 0) : 0
    const ballZCentimeters = structureMinor >= 7
      ? readBallDelta(reader, previous?.ballZCentimeters ?? 0, (flags & 16) !== 0) : 0
    let halfPitchWidth = previous?.halfPitchWidth ?? 0
    let halfPitchLength = previous?.halfPitchLength ?? 0
    if (pitchChanged) {
      halfPitchWidth = reader.readFloat32()
      halfPitchLength = reader.readFloat32()
      validatePitch(halfPitchWidth, halfPitchLength)
    }
    const home = readTeamDelta(reader, previous?.home, supportedTeamFields)
    const away = readTeamDelta(reader, previous?.away, supportedTeamFields)
    let players: RealtimePlayer[]
    if (rosterReset) {
      const count = reader.readVarUint()
      if (count > 255) throw new ArchiveError("Player count exceeds the limit")
      players = Array.from(
        { length: count },
        () => readFullPlayer(reader, halfPitchWidth, halfPitchLength, supportedPlayerFields, structureMinor >= 7),
      )
      if (new Set(players.map((player) => player.slot)).size !== players.length) throw new ArchiveError("Keyframe contains duplicate slots")
    } else {
      players = previous!.players.map((prior) => {
        const qx = (structureMinor >= 7 ? Math.round(prior.x * 100) : quantize(prior.x, halfPitchWidth)) + reader.readVarInt()
        const qy = (structureMinor >= 7 ? Math.round(prior.y * 100) : quantize(prior.y, halfPitchLength)) + reader.readVarInt()
        if (structureMinor >= 7
          ? qx < -32768 || qx > 32767 || qy < -32768 || qy > 32767
          : qx < 0 || qx > 65535 || qy < 0 || qy > 65535) throw new ArchiveError("Coordinate delta is out of range")
        const playerFlags = structureMinor >= 7 ? reader.readByte() : 1
        if ((playerFlags & ~15) !== 0) throw new ArchiveError("Invalid player change flags")
        const speedCentimetersPerSecond = structureMinor >= 7
          ? (prior.speedCentimetersPerSecond ?? 0) + ((playerFlags & 4) !== 0 ? reader.readVarInt() : 0)
          : undefined
        let angleDegrees = prior.angleDegrees
        if (structureMinor >= 7 && (playerFlags & 8) !== 0) {
          const delta = reader.readVarInt()
          if (delta < -181 || delta > 180) throw new ArchiveError("Direction delta is out of range")
          const encodedAngle = ((prior.angleDegrees ?? 361) + delta + 362) % 362
          angleDegrees = encodedAngle === 361 ? undefined : encodedAngle
        }
        if (structureMinor >= 7 && (
          speedCentimetersPerSecond! < 0 ||
          speedCentimetersPerSecond! > 65535
        )) {
          throw new ArchiveError("Player movement data is outside its quantized range")
        }
        const mask = (playerFlags & 1) !== 0 ? reader.readVarUintBig() : 0n
        if ((mask & ~supportedPlayerFields) !== 0n) throw new ArchiveError("Player state contains unknown fields")
        const player = readPlayerFields(reader, {
          ...prior,
          x: structureMinor >= 7 ? qx / 100 : dequantize(qx, halfPitchWidth),
          y: structureMinor >= 7 ? qy / 100 : dequantize(qy, halfPitchLength),
          speedCentimetersPerSecond,
          angleDegrees,
        }, mask)
        if (structureMinor >= 7 && (playerFlags & 2) !== 0) {
          player.distanceM = readDistanceDelta(reader, prior.distanceM ?? 0)
        }
        return player
      })
    }
    const holderSlot = holderSlotValue - 1
    const holder = holderSlotValue > 0 ? players.find((player) => player.slot === holderSlot) : undefined
    if (holderSlotValue > 0 && !holder) throw new ArchiveError("Invalid ball holder slot")
    const ballHolderPlayerId = holder?.playerId
    players = players.map((player) => ({ ...player, isBallHolder: player.slot === holderSlot }))
    const momentumEvents = readTail(reader, previous?.momentumEvents, (value) => readEvent(value, structureMinor))
    const momentum = readTail(reader, previous?.momentum, readMomentum)
    const rollingMomentum = readTail(reader, previous?.rollingMomentum, readMomentum)
    if (structureMinor >= 8) previousRatingMatch = readRatingResearch(
      reader, players, ratingModelMetadata,
      previousRatingPlayers, previous?.players, previousRatingMatch, ratingClassificationBySlot,
    )
    const frame: RealtimeFrame = {
      sequence, matchId, tick, displayTick, period, capturedUnixMilliseconds, possessionTeam, ballHolderPlayerId,
      ballXCentimeters, ballYCentimeters, ballZCentimeters,
      halfPitchWidth, halfPitchLength, momentumEvents, momentum, rollingMomentum, home, away, players,
      ratingModel: previousRatingMatch && ratingModelMetadata ? {
        ...previousRatingMatch,
        ...ratingModelMetadata,
      } : undefined,
    }
    frames.push(frame)
    previous = frame
  }
  if (!reader.atEnd) throw new ArchiveError("Block contains trailing bytes")
  if (frames[0].tick !== startTick || frames.at(-1)!.tick !== endTick) throw new ArchiveError("Block tick range mismatch")
  return frames
}

type RatingModelMetadata = {
  activeBaseline: number
  homeBackgroundInput: number
  awayBackgroundInput: number
}

type RatingWireMatchState = {
  ratingBaseCondition: number
  matchPhase: number
  eventRewardBranch: number
}

type RatingWirePlayerState = {
  packedStats: Uint8Array
  internalW25: number
  internalW24: number
  specialW2C: number
  specialW2D: number
  specialW2E: number
  specialW2F: number
  specialW30: number
  specialW31: number
  internalScore: number
  inPossessionRoleDuty: bigint
  outOfPossessionRoleDuty: bigint
  specialConditionA: number
  specialConditionB: number
  teamAEventCounterCandidate: number
  teamBEventCounterCandidate: number
  teamAEventAdjustmentCandidate: number
  teamBEventAdjustmentCandidate: number
  totalEligibleDuration: number
  ratingEvents: Uint8Array[]
}

function readRatingResearch(
  reader: ArchiveBufferReader,
  players: RealtimePlayer[],
  modelMetadata: RatingModelMetadata | undefined,
  previousPlayers: Map<number, RatingWirePlayerState>,
  previousFramePlayers: RealtimePlayer[] | undefined,
  previousMatch: RatingWireMatchState | undefined,
  classificationBySlot: Map<number, RatingClassificationState>,
) {
  if (!reader.readBoolean()) {
    previousPlayers.clear()
    return undefined
  }
  if (!modelMetadata) throw new ArchiveError("Rating research data has no archive-level rating model metadata")
  const matchMask = reader.readVarUintBig()
  if ((matchMask >> 3n) !== 0n) throw new ArchiveError("Rating match mask contains unknown fields")
  if (!previousMatch && matchMask !== 0x7n) throw new ArchiveError("Rating match chunk keyframe is incomplete")
  const match: RatingWireMatchState = {
    ratingBaseCondition: readXorUint(0, previousMatch?.ratingBaseCondition ?? 0),
    matchPhase: readByte(1, previousMatch?.matchPhase ?? 0),
    eventRewardBranch: readByte(2, previousMatch?.eventRewardBranch ?? 0),
  }
  for (let index = 0; index < players.length; index += 1) {
    const prior = previousFramePlayers?.[index]?.slot === players[index].slot
      ? previousPlayers.get(players[index].slot)
      : undefined
    const mask = reader.readVarUintBig()
    const supportedMask = ((1n << 23n) - 1n) & ~((1n << 10n) | (1n << 12n) | (1n << 17n))
    if ((mask & ~supportedMask) !== 0n) throw new ArchiveError("Rating player mask contains unknown fields")
    if (!prior && mask !== supportedMask) throw new ArchiveError("Rating player chunk keyframe is incomplete")
    const changed = (bit: number) => (mask & (1n << BigInt(bit))) !== 0n
    const readPlayerInt = (bit: number, oldValue: number) => changed(bit) ? addSafe(oldValue, reader.readVarInt()) : oldValue
    const readPlayerByte = (bit: number, oldValue: number) => changed(bit) ? reader.readByte() : oldValue
    const readPlayerSByte = (bit: number, oldValue: number) => changed(bit) ? reader.readSByte() : oldValue
    const readPlayerXorBig = (bit: number, oldValue: bigint) => changed(bit) ? oldValue ^ reader.readVarUintBig() : oldValue
    const packedStats = changed(0) ? readRatingStatsDelta(reader, prior?.packedStats) : prior!.packedStats
    const state: RatingWirePlayerState = {
      packedStats,
      internalW25: readPlayerInt(1, prior?.internalW25 ?? 0),
      internalW24: readPlayerInt(2, prior?.internalW24 ?? 0),
      specialW2C: readPlayerSByte(3, prior?.specialW2C ?? 0),
      specialW2D: readPlayerSByte(4, prior?.specialW2D ?? 0),
      specialW2E: readPlayerSByte(5, prior?.specialW2E ?? 0),
      specialW2F: readPlayerByte(6, prior?.specialW2F ?? 0),
      specialW30: readPlayerByte(7, prior?.specialW30 ?? 0),
      specialW31: readPlayerByte(8, prior?.specialW31 ?? 0),
      internalScore: readPlayerInt(9, prior?.internalScore ?? 0),
      inPossessionRoleDuty: readPlayerXorBig(11, prior?.inPossessionRoleDuty ?? 0n),
      outOfPossessionRoleDuty: readPlayerXorBig(13, prior?.outOfPossessionRoleDuty ?? 0n),
      specialConditionA: readPlayerSByte(14, prior?.specialConditionA ?? 0),
      specialConditionB: readPlayerSByte(15, prior?.specialConditionB ?? 0),
      totalEligibleDuration: readPlayerInt(16, prior?.totalEligibleDuration ?? 0),
      ratingEvents: [],
      teamAEventCounterCandidate: 0,
      teamBEventCounterCandidate: 0,
      teamAEventAdjustmentCandidate: 0,
      teamBEventAdjustmentCandidate: 0,
    }
    state.ratingEvents = changed(18) ? readRawRecordTail(reader, prior?.ratingEvents, 16) : prior!.ratingEvents
    state.teamAEventCounterCandidate = readPlayerByte(19, prior?.teamAEventCounterCandidate ?? 0)
    state.teamBEventCounterCandidate = readPlayerByte(20, prior?.teamBEventCounterCandidate ?? 0)
    state.teamAEventAdjustmentCandidate = readPlayerByte(21, prior?.teamAEventAdjustmentCandidate ?? 0)
    state.teamBEventAdjustmentCandidate = readPlayerByte(22, prior?.teamBEventAdjustmentCandidate ?? 0)
    previousPlayers.set(players[index].slot, state)
    const classification = deriveRatingClassification(
      classificationBySlot.get(players[index].slot),
      state.totalEligibleDuration,
      state.inPossessionRoleDuty,
      state.outOfPossessionRoleDuty,
    )
    classificationBySlot.set(players[index].slot, classification)
    const archiveRatingInputs: ArchiveRatingInputs = {
      statsPacked: state.packedStats,
      internalW25: state.internalW25, internalW24: state.internalW24,
      specialW2C: state.specialW2C, specialW2D: state.specialW2D, specialW2E: state.specialW2E,
      specialW2F: state.specialW2F, specialW30: state.specialW30, specialW31: state.specialW31,
      internalScore: state.internalScore,
      specialConditionA: state.specialConditionA, specialConditionB: state.specialConditionB,
      inPossessionRoleDuty: state.inPossessionRoleDuty,
      outOfPossessionRoleDuty: state.outOfPossessionRoleDuty,
      totalEligibleDuration: state.totalEligibleDuration,
      classificationDurations: classification.classificationDurations,
      qualityFlags: classification.qualityFlags,
      ratingEvents: state.ratingEvents,
    }
    players[index].archiveRatingInputs = archiveRatingInputs
  }
  return match

  function readByte(bit: number, oldValue: number) { return (matchMask & (1n << BigInt(bit))) === 0n ? oldValue : reader.readByte() }
  function readXorUint(bit: number, oldValue: number) { return (matchMask & (1n << BigInt(bit))) === 0n ? oldValue : (oldValue ^ reader.readVarUint()) >>> 0 }
}

function readRatingModelMetadata(reader: ArchiveBufferReader): RatingModelMetadata {
  const activeBaseline = reader.readVarInt()
  const homeBackgroundInput = reader.readFloat32()
  const awayBackgroundInput = reader.readFloat32()
  if (activeBaseline < 0 || activeBaseline > 10_000) throw new ArchiveError("Rating active baseline is invalid")
  if (!Number.isFinite(homeBackgroundInput) || !Number.isFinite(awayBackgroundInput)) {
    throw new ArchiveError("Rating background input is invalid")
  }
  if (!reader.atEnd) throw new ArchiveError("Rating model metadata contains trailing bytes")
  return { activeBaseline, homeBackgroundInput, awayBackgroundInput }
}

function readRatingStatsDelta(reader: ArchiveBufferReader, previous?: Uint8Array) {
  const result = previous?.slice() ?? new Uint8Array(34)
  const changed = reader.readVarUintBig()
  if ((changed >> 34n) !== 0n) throw new ArchiveError("Rating stats delta contains unknown bits")
  for (let index = 0; index < result.length; index += 1) {
    if ((changed & (1n << BigInt(index))) !== 0n) result[index] ^= reader.readByte()
  }
  return result
}

function readRawRecordTail(reader: ArchiveBufferReader, previous: Uint8Array[] | undefined, recordSize: number) {
  const prior = previous ?? []
  const common = reader.readVarUint()
  const tail = reader.readVarUint()
  if (common > prior.length || common + tail > 4_096) throw new ArchiveError("Rating research record count exceeds the wire limit")
  return [...prior.slice(0, common), ...Array.from({ length: tail }, () => reader.readBytes(recordSize))]
}


function readTeamDelta(reader: ArchiveBufferReader, previous: RealtimeTeam | undefined, supportedTeamFields: bigint): RealtimeTeam {
  const mask = reader.readVarUintBig()
  if ((mask & ~supportedTeamFields) !== 0n) throw new ArchiveError("Team state contains unknown fields")
  const prior: RealtimeTeam = previous ?? {
    goals: 0, xg: 0, possessionTime: 0, shots: 0, shotsOnTarget: 0, firstHalfShots: 0, secondHalfShots: 0,
    shotsOffTarget: 0, blockedShots: 0,
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
    firstHalfShots: integer(23, prior.firstHalfShots), secondHalfShots: integer(24, prior.secondHalfShots),
  }
}

function readFullPlayer(
  reader: ArchiveBufferReader,
  halfWidth: number,
  halfLength: number,
  playerFields: bigint,
  compactEncoding: boolean,
): RealtimePlayer {
  const slot = reader.readVarUint()
  const playerId = reader.readVarInt()
  const teamRaw = reader.readByte()
  if (teamRaw > 1) throw new ArchiveError("Invalid player team")
  const x = compactEncoding ? reader.readInt16() / 100 : dequantize(reader.readUint16(), halfWidth)
  const y = compactEncoding ? reader.readInt16() / 100 : dequantize(reader.readUint16(), halfLength)
  const speedCentimetersPerSecond = compactEncoding ? reader.readVarUint() : undefined
  const encodedAngle = compactEncoding ? reader.readVarUint() : 361
  if ((speedCentimetersPerSecond ?? 0) > 65535 || encodedAngle > 361) throw new ArchiveError("Player movement is outside its quantized range")
  const angleDegrees = encodedAngle === 361 ? undefined : encodedAngle
  const seed = {
    slot, playerId, team: teamRaw === 1 ? "away" : "home", isBallHolder: false,
    x, y, speedCentimetersPerSecond, angleDegrees, rating: 0,
    isSubstitute: false, isOnPitch: false, subbedOnMinute: 0, subbedOffMinute: 0, penalties: 0, ownGoals: 0,
    goals: 0, assists: 0, shotsFaced: 0, savesHeld: 0, savesParried: 0, savesTipped: 0,
  } satisfies RealtimePlayer
  const player = readPlayerFields(reader, seed, playerFields)
  if (compactEncoding) player.distanceM = readDistanceDelta(reader, 0)
  return player
}

function readPlayerFields(reader: ArchiveBufferReader, prior: RealtimePlayer, mask: bigint): RealtimePlayer {
  const result = { ...prior }
  const has = (bit: number) => (mask & (1n << BigInt(bit))) !== 0n
  if (has(0)) result.rating = reader.readFloatXor(result.rating)
  if (has(1)) result.isSubstitute = reader.readBoolean()
  if (has(2)) result.isOnPitch = reader.readBoolean()
  const integerFields: Array<[number, keyof RealtimePlayer]> = [
    [3, "subbedOnMinute"], [4, "subbedOffMinute"], [5, "penalties"], [6, "ownGoals"], [7, "goals"], [8, "assists"],
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
    [37, "overallPhysicalCondition"], [38, "matchSharpness"],
    [39, "savesHeld"], [40, "savesParried"], [41, "savesTipped"],
    [42, "progressivePasses"],
  ]
  for (const [bit, field] of statFields) {
    // Legacy bit 36 precedes condition/sharpness and keeper fields on the wire.
    if (bit === 37 && has(36)) result.distanceM = reader.readFloatXor(result.distanceM ?? 0)
    if (has(bit)) Object.assign(result, { [field]: reader.readVarInt() })
  }
  return result
}

function readDistanceDelta(reader: ArchiveBufferReader, prior: number) {
  const distance = addSafe(prior, reader.readVarInt())
  if (distance < 0 || distance > 16_777_216) throw new ArchiveError("Player cumulative distance is out of range")
  return distance
}

function readBallDelta(reader: ArchiveBufferReader, prior: number, changed: boolean) {
  const value = changed ? addSafe(prior, reader.readVarInt()) : prior
  if (value < -2147483648 || value > 2147483647) throw new ArchiveError("Ball coordinate is out of range")
  return value
}

function readTail<T>(reader: ArchiveBufferReader, previous: readonly T[] | undefined, read: (reader: ArchiveBufferReader) => T): T[] {
  const prior = previous ?? []
  const common = reader.readVarUint()
  const tail = reader.readVarUint()
  if (common > prior.length || common + tail > 65_536) throw new ArchiveError("Invalid delta stream count")
  const result = prior.slice(0, common) as T[]
  for (let index = 0; index < tail; index += 1) result.push(read(reader))
  return result
}

function readEvent(reader: ArchiveBufferReader, structureMinor: number): RealtimeMomentumEvent {
  const eventIndex = reader.readVarInt()
  const tick = reader.readVarInt()
  const lateralPosition = reader.readFloat32()
  const longitudinalPosition = reader.readFloat32()
  const teamRaw = reader.readByte()
  if (teamRaw > 1) throw new ArchiveError("Invalid event team")
  const result: RealtimeMomentumEvent = {
    eventIndex, tick, lateralPosition, longitudinalPosition, team: teamRaw === 1 ? "away" : "home",
    playerSlot: reader.readVarInt(), playerId: reader.readVarInt(), receiverPlayerSlot: reader.readVarInt(),
    receiverPlayerId: reader.readVarInt(), eventType: reader.readVarInt(), flags: reader.readVarInt(),
    sequenceIndex: 0, completionTick: 0,
  }
  if (structureMinor >= 2) {
    result.sequenceIndex = reader.readVarInt()
    result.completionTick = reader.readVarInt()
    const pointCount = reader.readVarUint()
    if (pointCount > 4) throw new ArchiveError("Invalid event trajectory point count")
    result.trajectoryPoints = Array.from({ length: pointCount }, () => ({
      lateralPosition: reader.readFloat32(),
      longitudinalPosition: reader.readFloat32(),
    }))
    if (pointCount > 0) {
      const start = result.trajectoryPoints[0]
      const end = result.trajectoryPoints[pointCount - 1]
      result.trajectoryStartLateralPosition = start.lateralPosition
      result.trajectoryStartLongitudinalPosition = start.longitudinalPosition
      result.trajectoryEndLateralPosition = end.lateralPosition
      result.trajectoryEndLongitudinalPosition = end.longitudinalPosition
    }
  }
  return result
}

function readMomentum(reader: ArchiveBufferReader): RealtimeMomentumPoint {
  return { value: reader.readFloat32(), timeTicks: reader.readVarInt(), homeWeight: reader.readVarInt(), awayWeight: reader.readVarInt() }
}

function readMetadata(payload: Uint8Array, header: ArchiveHeader) {
  const reader = new ArchiveBufferReader(payload)
  const revision = reader.readVarUint()
  const capturedTick = reader.readVarInt()
  const stringCount = reader.readVarUint()
  if (stringCount > 16_384) throw new ArchiveError("Metadata string table exceeds the limit")
  const strings: Array<string | undefined> = [undefined]
  for (let index = 0; index < stringCount; index += 1) strings.push(reader.readString())
  let home = readTeamMetadata(reader, strings, header.structureMinor)
  let away = readTeamMetadata(reader, strings, header.structureMinor)
  const playerCount = reader.readVarUint()
  if (playerCount > 255) throw new ArchiveError("Metadata player count exceeds the limit")
  const players = Array.from({ length: playerCount }, () => readPlayerMetadata(reader, strings, header.structureMinor))
  if (new Set(players.map((player) => player.slot)).size !== players.length) throw new ArchiveError("Metadata contains duplicate slots")
  const playerUids = players.flatMap((player) => player.uid == null ? [] : [player.uid])
  if (new Set(playerUids).size !== playerUids.length) throw new ArchiveError("Metadata contains duplicate player UIDs")
  let matchDate: string | undefined
  let halfPitchWidth: number | undefined
  let halfPitchLength: number | undefined
  let competition: RealtimeMatchMetadata["competition"]
  if (!reader.atEnd) {
    const extensionFlags = reader.readByte()
    const allowedExtensionFlags = header.structureMinor >= 6 ? 0x0f : header.structureMinor >= 5 ? 0x07 : 0x03
    if (extensionFlags === 0 || (extensionFlags & ~allowedExtensionFlags) !== 0) throw new ArchiveError("Metadata contains unknown extension fields")
    if ((extensionFlags & 0x01) !== 0) matchDate = reader.readString()
    if ((extensionFlags & 0x02) !== 0) {
      home = { ...home, manager: readManagerMetadata(reader, strings) }
      away = { ...away, manager: readManagerMetadata(reader, strings) }
    }
    if ((extensionFlags & 0x04) !== 0) {
      halfPitchWidth = readPitchHalf(reader)
      halfPitchLength = readPitchHalf(reader)
    }
    if ((extensionFlags & 0x08) !== 0) competition = readCompetitionMetadata(reader, strings)
  }
  if (!reader.atEnd) throw new ArchiveError("Metadata contains trailing bytes")
  const metadata: RealtimeMatchMetadata = {
    matchId: header.matchId,
    startedUnixMilliseconds: header.startedUnixMilliseconds,
    capturedTick,
    matchDate,
    halfPitchWidth,
    halfPitchLength,
    competition,
    home,
    away,
    players,
  }
  return { revision, metadata }
}

function readMetadataDelta(payload: Uint8Array, header: ArchiveHeader, previous: RealtimeMatchMetadata) {
  const reader = new ArchiveBufferReader(payload)
  const revision = reader.readVarUint()
  const capturedTick = reader.readVarInt()
  const stringCount = reader.readVarUint()
  if (stringCount > 16_384) throw new ArchiveError("Metadata string table exceeds the limit")
  const strings: Array<string | undefined> = [undefined]
  for (let index = 0; index < stringCount; index += 1) strings.push(reader.readString())

  const teamFlags = reader.readByte()
  if ((teamFlags & ~0x03) !== 0) throw new ArchiveError("Metadata delta contains unknown team fields")
  const home = (teamFlags & 0x01) !== 0
    ? { ...readTeamMetadata(reader, strings, header.structureMinor), manager: previous.home.manager }
    : previous.home
  const away = (teamFlags & 0x02) !== 0
    ? { ...readTeamMetadata(reader, strings, header.structureMinor), manager: previous.away.manager }
    : previous.away
  const players = [...previous.players]
  const deltaCount = reader.readVarUint()
  if (deltaCount > 255) throw new ArchiveError("Metadata delta player count exceeds the limit")
  for (let index = 0; index < deltaCount; index += 1) {
    const flags = reader.readByte()
    if (flags === 0 || (flags & ~0x07) !== 0 || ((flags & 0x01) !== 0 && flags !== 0x01)) {
      throw new ArchiveError("Metadata delta contains invalid player fields")
    }
    if ((flags & 0x01) !== 0) {
      const player = readPlayerMetadata(reader, strings, header.structureMinor)
      if (players.some((existing) => existing.slot === player.slot)) throw new ArchiveError("Metadata delta adds a duplicate player slot")
      if (player.uid != null && players.some((existing) => existing.uid === player.uid)) throw new ArchiveError("Metadata delta adds a duplicate player UID")
      players.push(player)
      continue
    }

    const playerId = reader.readVarInt()
    const playerIndexes = players.flatMap((player, playerIndex) => player.playerId === playerId ? [playerIndex] : [])
    if (playerIndexes.length === 0) throw new ArchiveError("Metadata delta references an unknown player")
    if (playerIndexes.length > 1) throw new ArchiveError("Metadata delta references an ambiguous legacy player ID")
    const playerIndex = playerIndexes[0]
    const existing = players[playerIndex]
    players[playerIndex] = {
      ...existing,
      inPossession: (flags & 0x02) !== 0 ? readAssignment(reader, strings) : existing.inPossession,
      outOfPossession: (flags & 0x04) !== 0 ? readAssignment(reader, strings) : existing.outOfPossession,
    }
  }
  players.sort((left, right) => left.slot - right.slot)
  if (new Set(players.map((player) => player.slot)).size !== players.length) throw new ArchiveError("Metadata delta results in duplicate slots")
  let halfPitchWidth = previous.halfPitchWidth
  let halfPitchLength = previous.halfPitchLength
  let competition = previous.competition
  if (header.structureMinor >= 5) {
    const extensionFlags = reader.readByte()
    const allowedExtensionFlags = header.structureMinor >= 6 ? 0x03 : 0x01
    if ((extensionFlags & ~allowedExtensionFlags) !== 0) throw new ArchiveError("Metadata delta contains unknown extension fields")
    if ((extensionFlags & 0x01) !== 0) {
      halfPitchWidth = readPitchHalf(reader)
      halfPitchLength = readPitchHalf(reader)
    }
    if ((extensionFlags & 0x02) !== 0) competition = readCompetitionMetadata(reader, strings)
  }
  if (!reader.atEnd) throw new ArchiveError("Metadata delta contains trailing bytes")
  const metadata: RealtimeMatchMetadata = {
    matchId: header.matchId,
    startedUnixMilliseconds: header.startedUnixMilliseconds,
    capturedTick,
    matchDate: previous.matchDate,
    halfPitchWidth,
    halfPitchLength,
    competition,
    home,
    away,
    players,
  }
  return { revision, metadata }
}

function readPitchHalf(reader: ArchiveBufferReader) {
  const value = reader.readFloat32()
  if (!Number.isFinite(value) || value <= 0) throw new ArchiveError("Metadata contains invalid pitch dimensions")
  return value
}

function readTeamMetadata(reader: ArchiveBufferReader, strings: Array<string | undefined>, structureMinor: number): RealtimeTeamMetadata {
  return {
    uid: readNullableUint(reader), clubUid: readNullableUint(reader), name: readStringId(reader, strings) ?? "",
    backgroundColour: readNullableUint(reader), foregroundColour: readNullableUint(reader), outlineColour: readNullableUint(reader),
    logoPath: readStringId(reader, strings),
    shirtNumberColor: structureMinor >= 7 ? readNullableUint(reader) : undefined,
    shirtBackgroundColor: structureMinor >= 7 ? readNullableUint(reader) : undefined,
    shirtBackgroundColorGK: structureMinor >= 7 ? readNullableUint(reader) : undefined,
  }
}

function readCompetitionMetadata(reader: ArchiveBufferReader, strings: Array<string | undefined>) {
  return {
    uid: readNullableUint(reader),
    name: readStringId(reader, strings),
    logoPath: readStringId(reader, strings),
    primaryColour: readNullableUint(reader),
    secondaryColour: readNullableUint(reader),
    tertiaryColour: readNullableUint(reader),
  }
}

function readManagerMetadata(reader: ArchiveBufferReader, strings: Array<string | undefined>) {
  if (!reader.readBoolean()) return undefined
  return {
    uid: readNullableUint(reader),
    firstName: readStringId(reader, strings),
    secondName: readStringId(reader, strings),
    isHumanControlled: reader.readBoolean(),
  }
}

function readPlayerMetadata(
  reader: ArchiveBufferReader,
  strings: Array<string | undefined>,
  structureMinor: number,
): RealtimePlayerMetadata {
  const slot = reader.readVarUint()
  const playerId = reader.readVarInt()
  const uid = readNullableUint(reader)
  const teamRaw = reader.readByte()
  if (teamRaw > 1) throw new ArchiveError("Invalid metadata team value")
  const legacyOrShirtNumber = readNullableInt(reader)
  const shirtNumber = legacyOrShirtNumber
  const squadNumber = structureMinor >= 7
    ? readNullableInt(reader)
    : legacyOrShirtNumber
  const position = readStringId(reader, strings)
  const positionFamiliarities = readPositionFamiliarities(reader)
  const inPossession = readAssignment(reader, strings)
  const outOfPossession = readAssignment(reader, strings)
  const firstName = readStringId(reader, strings)
  const secondName = readStringId(reader, strings)
  const commonName = readStringId(reader, strings)
  const displayName = readStringId(reader, strings) ?? `Player ${playerId}`
  const shirtName = structureMinor >= 7
    ? readStringId(reader, strings)
    : commonName ?? displayName
  const portraitPath = readStringId(reader, strings)
  const profile = readProfile(reader, structureMinor)
  const attributes = readAttributes(reader, strings, structureMinor)
  return { slot, playerId, uid, team: teamRaw === 1 ? "away" : "home", shirtNumber, squadNumber, shirtName, position, positionFamiliarities, inPossession, outOfPossession,
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

function readProfile(reader: ArchiveBufferReader, structureMinor: number): PlayerProfile | undefined {
  if (!reader.readBoolean()) return undefined
  const profile: PlayerProfile = { weeklyWage: readNullableInt(reader), heightCm: readNullableInt(reader), condition: readNullableInt(reader),
    morale: readNullableInt(reader), currentAbility: readNullableInt(reader), potentialAbility: readNullableInt(reader), currentReputation: readNullableInt(reader) }
  if (structureMinor >= 4) {
    profile.dateOfBirth = reader.readString() || undefined
    profile.nationUid = readNullableUint(reader)
    profile.bodyType = readNullableInt(reader)
    profile.guideValueGbp = readNullableUint(reader)
    profile.internationalApps = readNullableInt(reader)
    profile.internationalGoals = readNullableInt(reader)
    profile.youthApps = readNullableInt(reader)
    profile.youthGoals = readNullableInt(reader)
  }
  if (structureMinor >= 7) {
    profile.matchSharpness = readNullableInt(reader)
    profile.seasonStats = readSeasonStats(reader)
  }
  return profile
}

function readSeasonStats(reader: ArchiveBufferReader): PlayerSeasonStats | undefined {
  if (!reader.readBoolean()) return undefined
  return {
    friendly: readSeasonStatsSlot(reader),
    league: readSeasonStatsSlot(reader),
    cup: readSeasonStatsSlot(reader),
    otherCompetition: readSeasonStatsSlot(reader),
    international: readSeasonStatsSlot(reader),
    clubTotal: readSeasonStatsSlot(reader),
    unknown: readSeasonStatsSlot(reader),
    internationalTotal: readSeasonStatsSlot(reader),
  }
}

function readSeasonStatsSlot(reader: ArchiveBufferReader): PlayerSeasonStatsSlot | undefined {
  if (!reader.readBoolean()) return undefined
  return {
    ratingSumTimes10: readNullableInt(reader),
    minutes: readNullableInt(reader),
    starts: readNullableInt(reader),
    substituteAppearances: readNullableInt(reader),
    appearances: readNullableInt(reader),
    goals: readNullableInt(reader),
    assists: readNullableInt(reader),
    goalsConceded: readNullableInt(reader),
    penaltyAttempts: readNullableInt(reader),
    penaltiesScored: readNullableInt(reader),
    playerOfMatchAwards: readNullableInt(reader),
    redCards: readNullableInt(reader),
    yellowCards: readNullableInt(reader),
    cleanSheets: readNullableInt(reader),
    detailed: readSeasonDetailedStats(reader),
  }
}

function readSeasonDetailedStats(reader: ArchiveBufferReader): PlayerSeasonDetailedStats | undefined {
  if (!reader.readBoolean()) return undefined
  return {
    teamGoals: readNullableInt(reader),
    teamGoalsConceded: readNullableInt(reader),
    wins: readNullableInt(reader),
    losses: readNullableInt(reader),
    passesAttempted: readNullableInt(reader),
    passesCompleted: readNullableInt(reader),
    tacklesAttempted: readNullableInt(reader),
    tacklesWon: readNullableInt(reader),
    headersAttempted: readNullableInt(reader),
    headersWon: readNullableInt(reader),
    dribbles: readNullableInt(reader),
    fouls: readNullableInt(reader),
    fouled: readNullableInt(reader),
    shots: readNullableInt(reader),
    shotsOnTarget: readNullableInt(reader),
    errorsLeadingToGoal: readNullableInt(reader),
    distanceKmTimes10: readNullableInt(reader),
    offsides: readNullableInt(reader),
    openPlayCrossesCompleted: readNullableInt(reader),
    keyPasses: readNullableInt(reader),
    keyTackles: readNullableInt(reader),
    interceptions: readNullableInt(reader),
    chancesCreated: readNullableInt(reader),
    blocks: readNullableInt(reader),
    possessionLost: readNullableInt(reader),
    possessionWon: readNullableInt(reader),
    expectedGoalsTimes100: readNullableInt(reader),
    expectedAssistsTimes100: readNullableInt(reader),
    clearances: readNullableInt(reader),
    goalsOutsideBox: readNullableInt(reader),
    openPlayCrossesAttempted: readNullableInt(reader),
    shotsOutsideBox: readNullableInt(reader),
    goalsPreventedTimes100: readNullableInt(reader),
    sprints: readNullableInt(reader),
    progressivePasses: readNullableInt(reader),
    pressesAttempted: readNullableInt(reader),
    pressesWon: readNullableInt(reader),
    openPlayKeyPasses: readNullableInt(reader),
    nonPenaltyExpectedGoalsTimes100: readNullableInt(reader),
    crossesAttempted: readNullableInt(reader),
    crossesCompleted: readNullableInt(reader),
    headersLost: readNullableInt(reader),
  }
}

function readAttributes(
  reader: ArchiveBufferReader,
  strings: Array<string | undefined>,
  structureMinor: number,
): PlayerAttributes | undefined {
  if (!reader.readBoolean()) return undefined
  const technical = readAttributeGroup(reader, strings)
  const mental = readAttributeGroup(reader, strings)
  const physical = readAttributeGroup(reader, strings)
  const goalkeeping = readAttributeGroup(reader, strings)
  const traits = structureMinor >= 6 ? reader.readUint64Hex() : undefined
  return { technical, mental, physical, goalkeeping, traits }
}

function readAttributeGroup(reader: ArchiveBufferReader, strings: Array<string | undefined>) {
  const count = reader.readVarUint()
  if (count > 1_024) throw new ArchiveError("Attribute group exceeds the limit")
  const result: Record<string, number> = {}
  for (let index = 0; index < count; index += 1) {
    const name = readStringId(reader, strings)
    if (!name) throw new ArchiveError("Invalid attribute name reference")
    result[name] = reader.readVarInt()
  }
  return result
}

function readStringId(reader: ArchiveBufferReader, strings: Array<string | undefined>) {
  const id = reader.readVarUint()
  if (id === 0) return undefined
  if (id >= strings.length) throw new ArchiveError("Invalid string reference")
  return strings[id]
}

function readNullableUint(reader: ArchiveBufferReader) { return reader.readBoolean() ? reader.readVarUint() : undefined }
function readNullableInt(reader: ArchiveBufferReader) { return reader.readBoolean() ? reader.readVarInt() : undefined }

function readFinalIndex(payload: Uint8Array, blocks: readonly BlockReference[]): FinalSummary {
  const reader = new ArchiveBufferReader(payload)
  const summary = { frameCount: reader.readVarUint(), firstTick: reader.readVarInt(), lastTick: reader.readVarInt(),
    homeGoals: reader.readVarInt(), awayGoals: reader.readVarInt() }
  const count = reader.readVarUint()
  if (count !== blocks.length) throw new ArchiveError("Final index block count mismatch")
  for (let index = 0; index < count; index += 1) {
    const startTick = reader.readVarInt()
    const endTick = reader.readVarInt()
    const recordOffset = reader.readVarUint()
    const compressedLength = reader.readVarUint()
    const frameCount = reader.readVarUint()
    const block = blocks[index]
    if (startTick !== block.startTick || endTick !== block.endTick || recordOffset !== block.recordOffset || compressedLength !== block.compressedLength || frameCount !== block.frameCount) {
      throw new ArchiveError("Final index does not match block headers")
    }
  }
  if (!reader.atEnd) throw new ArchiveError("Final index contains trailing bytes")
  return summary
}

function readRecordPayload(reader: ArchiveBufferReader, maxLength: number) {
  const length = reader.readUint32()
  const expectedCrc = reader.readUint32()
  if (length > maxLength) throw new ArchiveError("Record length exceeds the limit")
  const payload = reader.readBytes(length)
  if (crc32(payload) !== expectedCrc) throw new ArchiveError("Record CRC check failed")
  return payload
}

function validatePitch(width: number, length: number) {
  if (!Number.isFinite(width) || !Number.isFinite(length) || width <= 0 || length <= 0 || width > 1_000 || length > 1_000) {
    throw new ArchiveError("Invalid pitch dimensions")
  }
}

function quantize(value: number, halfExtent: number) {
  if (!Number.isFinite(value)) throw new ArchiveError("Coordinate is not finite")
  return Math.round(Math.min(1, Math.max(0, (value + halfExtent) / (halfExtent * 2))) * 65535)
}

function dequantize(value: number, halfExtent: number) { return value / 65535 * halfExtent * 2 - halfExtent }

function addSafe(left: number, right: number) {
  const value = left + right
  if (!Number.isSafeInteger(value)) throw new ArchiveError("Delta result exceeds the browser safe integer range")
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
  readSByte() { this.ensure(1); return this.view.getInt8(this.offset++) }
  readBoolean() { return this.readByte() !== 0 }
  readInt16() { this.ensure(2); const value = this.view.getInt16(this.offset, true); this.offset += 2; return value }
  readUint16() { this.ensure(2); const value = this.view.getUint16(this.offset, true); this.offset += 2; return value }
  readInt32() { this.ensure(4); const value = this.view.getInt32(this.offset, true); this.offset += 4; return value }
  readUint32() { this.ensure(4); const value = this.view.getUint32(this.offset, true); this.offset += 4; return value }
  readFloat32() { this.ensure(4); const value = this.view.getFloat32(this.offset, true); this.offset += 4; return value }
  readFloatXor(previous: number) {
    this.floatScratch.setFloat32(0, previous, true)
    this.floatScratch.setUint32(0, (this.floatScratch.getUint32(0, true) ^ this.readVarUint()) >>> 0, true)
    return this.floatScratch.getFloat32(0, true)
  }
  readInt64() { this.ensure(8); const value = Number(this.view.getBigInt64(this.offset, true)); this.offset += 8; if (!Number.isSafeInteger(value)) throw new ArchiveError("64-bit integer exceeds the browser safe integer range"); return value }
  readUint64() { this.ensure(8); const value = Number(this.view.getBigUint64(this.offset, true)); this.offset += 8; if (!Number.isSafeInteger(value)) throw new ArchiveError("64-bit integer exceeds the browser safe integer range"); return value }
  readUint64Hex() { this.ensure(8); const value = this.view.getBigUint64(this.offset, true); this.offset += 8; return value.toString(16).toUpperCase().padStart(16, "0") }
  readBytes(length: number) { this.ensure(length); const value = this.bytes.subarray(this.offset, this.offset + length); this.offset += length; return value }
  readAscii(length: number) { return String.fromCharCode(...this.readBytes(length)) }
  readString() {
    const length = this.readVarUint()
    if (length > 1_048_576) throw new ArchiveError("Invalid string length")
    try { return this.decoder.decode(this.readBytes(length)) } catch { throw new ArchiveError("String is not valid UTF-8") }
  }
  readVarUintBig() {
    let result = 0n
    for (let index = 0; index < 10; index += 1) {
      const byte = this.readByte()
      if (index === 9 && byte > 1) throw new ArchiveError("VarInt exceeds the UInt64 range")
      result |= BigInt(byte & 0x7f) << BigInt(index * 7)
      if ((byte & 0x80) === 0) return result
    }
    throw new ArchiveError("Invalid VarInt length")
  }
  readVarUint() { const value = Number(this.readVarUintBig()); if (!Number.isSafeInteger(value)) throw new ArchiveError("VarInt exceeds the browser safe integer range"); return value }
  readVarInt() {
    const raw = this.readVarUintBig()
    const value = Number((raw >> 1n) ^ -(raw & 1n))
    if (!Number.isSafeInteger(value)) throw new ArchiveError("Signed VarInt exceeds the browser safe integer range")
    return value
  }
  private ensure(length: number) { if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.bytes.byteLength) throw new ArchiveEndOfFileError("Archive ends with an incomplete record") }
}
