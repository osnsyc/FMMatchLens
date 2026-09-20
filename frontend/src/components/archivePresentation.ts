import type { ArchiveSummary } from "@/api/archiveTypes"
import type { RealtimeMatchMetadata } from "@/api/realtimeMatch"

export const ARCHIVE_PAGE_SIZE = 5

export type ArchiveResult = "home-win" | "away-win" | "draw"
export type PlayerResult = "win" | "draw" | "loss" | "unknown"

export type ArchivePresentation = {
  date: string
  home: string
  away: string
  homeGoals: number
  awayGoals: number
  result: ArchiveResult
  playerResult: PlayerResult
  competitionUid?: number
  competitionName?: string
  competitionLogoPath?: string
  competitionPrimaryColour?: number
  competitionSecondaryColour?: number
  competitionTertiaryColour?: number
}

export function presentArchive(
  archive: Pick<
    ArchiveSummary,
    | "matchId"
    | "fileName"
    | "matchDate"
    | "homeGoals"
    | "awayGoals"
    | "homeName"
    | "awayName"
    | "playerResult"
    | "competitionUid"
    | "competitionName"
    | "competitionLogoPath"
    | "competitionPrimaryColour"
    | "competitionSecondaryColour"
    | "competitionTertiaryColour"
  >,
  metadata: RealtimeMatchMetadata | undefined,
  locale: string,
  unknownTeam: string,
  unknownDate: string
): ArchivePresentation {
  const fileMetadata = archiveMetadataFromFileName(
    archive.matchId,
    archive.fileName
  )
  const home =
    archive.homeName ?? metadata?.home.name ?? fileMetadata?.home ?? unknownTeam
  const away =
    archive.awayName ?? metadata?.away.name ?? fileMetadata?.away ?? unknownTeam
  const matchDate =
    archive.matchDate ?? metadata?.matchDate ?? fileMetadata?.matchDate
  const result: ArchiveResult =
    archive.homeGoals > archive.awayGoals
      ? "home-win"
      : archive.awayGoals > archive.homeGoals
        ? "away-win"
        : "draw"
  const homeControlled = metadata?.home.manager?.isHumanControlled === true
  const awayControlled = metadata?.away.manager?.isHumanControlled === true
  const controlledSide =
    homeControlled === awayControlled
      ? undefined
      : homeControlled
        ? "home"
        : "away"
  const playerResult: PlayerResult =
    archive.playerResult ??
    (!controlledSide
      ? "unknown"
      : result === "draw"
        ? "draw"
        : (result === "home-win") === (controlledSide === "home")
          ? "win"
          : "loss")

  return {
    date: formatMatchDate(matchDate, locale, unknownDate),
    home,
    away,
    homeGoals: archive.homeGoals,
    awayGoals: archive.awayGoals,
    result,
    playerResult,
    competitionUid: archive.competitionUid ?? metadata?.competition?.uid,
    competitionName: archive.competitionName ?? metadata?.competition?.name,
    competitionLogoPath:
      archive.competitionLogoPath ?? metadata?.competition?.logoPath,
    competitionPrimaryColour:
      archive.competitionPrimaryColour ?? metadata?.competition?.primaryColour,
    competitionSecondaryColour:
      archive.competitionSecondaryColour ?? metadata?.competition?.secondaryColour,
    competitionTertiaryColour:
      archive.competitionTertiaryColour ?? metadata?.competition?.tertiaryColour,
  }
}

function formatMatchDate(
  value: string | undefined,
  locale: string,
  fallback: string
) {
  if (!value) return fallback
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00Z`)
    : new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "UTC",
  }).format(date)
}

function archiveMetadataFromFileName(matchId: string, fileName?: string) {
  if (!fileName) return undefined
  const suffix = ".fmlens"
  if (!fileName.toLowerCase().endsWith(suffix)) return undefined
  const dated = /^(\d{4}-\d{2}-\d{2})-(.+?)-vs-(.+)-\d+-\d+\.fmlens$/i.exec(
    fileName
  )
  if (dated) return { matchDate: dated[1], home: dated[2], away: dated[3] }
  const prefix = `${matchId}-`
  if (!fileName.startsWith(prefix)) return undefined
  const matchup = fileName.slice(prefix.length, -suffix.length)
  const separator = matchup.indexOf("-vs-")
  if (separator <= 0 || separator >= matchup.length - 4) return undefined
  return {
    home: matchup.slice(0, separator),
    away: matchup.slice(separator + 4),
  }
}
