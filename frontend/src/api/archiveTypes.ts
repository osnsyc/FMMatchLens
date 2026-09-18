export type ArchiveSummary = {
  matchId: string
  fileName?: string
  startedUnixMilliseconds: number
  ended: boolean
  frameCount: number
  firstTick: number
  lastTick: number
  homeName?: string
  awayName?: string
  matchDate?: string
  homeGoals: number
  awayGoals: number
  homeManagerIsHumanControlled?: boolean
  awayManagerIsHumanControlled?: boolean
  playerResult?: "win" | "draw" | "loss"
  fileSizeBytes: number
}

export type ArchivePage = {
  items: ArchiveSummary[]
  page: number
  pageSize: number
  totalCount: number
  pageCount: number
}
