import type { RealtimeFrame, RealtimeMatchMetadata } from "@/api/realtimeMatch"
import { parseArchiveFile } from "@/api/archiveParser"
import type { RatingWeightConfiguration } from "@/lib/ratingCalculator"

export type LocalArchiveSummary = {
  matchId: string
  fileName: string
  startedUnixMilliseconds: number
  endedUnixMilliseconds?: number
  ended: boolean
  frameCount: number
  firstTick: number
  lastTick: number
  matchDate?: string
  homeGoals: number
  awayGoals: number
  fileSizeBytes: number
}

export type ParsedLocalArchive = {
  archive: LocalArchiveSummary
  metadata?: RealtimeMatchMetadata
  metadataTimeline: RealtimeMatchMetadata[]
  frames: RealtimeFrame[]
  ratingConfiguration?: RatingWeightConfiguration
}

export function parseLocalArchive(buffer: ArrayBuffer, fileName: string): Promise<ParsedLocalArchive> {
  return parseArchiveFile(buffer, fileName)
}
