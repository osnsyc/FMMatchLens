import type { RealtimeFrame, RealtimeMatchMetadata } from "@/api/realtimeMatch"
import { parseArchiveFile } from "@/api/archiveParser"

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

export function parseLocalArchive(buffer: ArrayBuffer, fileName: string): Promise<ParsedLocalArchive> {
  return parseArchiveFile(buffer, fileName)
}
