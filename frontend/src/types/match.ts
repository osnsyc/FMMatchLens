export type TeamSide = "home" | "away"

export const playerPositionLabels = ["GK", "SW", "DL", "DC", "DR", "DM", "ML", "MC", "MR", "AML", "AMC", "AMR", "ST", "WBL", "WBR"] as const
export type PlayerPosition = (typeof playerPositionLabels)[number]
export type PlayerPositionFamiliarities = Partial<Record<PlayerPosition, number>>

export type MatchEventType =
  | "goal"
  | "assist_candidate"
  | "yellow_card"
  | "red_card"

export type MatchEvent = {
  id: string
  type: MatchEventType
  minute: number
  tick?: number
  team?: TeamSide
  playerId?: number
}

export type XgTimelinePoint = {
  minute: number
  home: number
  away: number
}

export type MatchMomentumPoint = {
  value: number
  timeTicks: number
  minute: number
  homeWeight: number
  awayWeight: number
}

export type PlayerHeatmapPoint = {
  x: number
  y: number
  weight: number
}

export type PositionHeatmapRange = "full" | "half" | "recent15"

export type PlayerPositionHeatmapSlice = {
  sampleCount: number
  averageX: number
  averageY: number
  points: PlayerHeatmapPoint[]
}

export type PlayerPositionHeatmap = PlayerPositionHeatmapSlice & {
  playerId: number
  team: TeamSide
  ranges: Record<PositionHeatmapRange, PlayerPositionHeatmapSlice>
}

export type TacticalEventMetricId =
  | "goals"
  | "shotsOnTarget"
  | "shotsOffTarget"
  | "hitWoodwork"
  | "blockedShots"
  | "passesCompleted"
  | "passesIncomplete"
  | "crossesCompleted"
  | "crossesIncomplete"
  | "fouled"
  | "foulsCommitted"
  | "tacklesWon"
  | "tacklesLost"
  | "aerialsWon"
  | "aerialsLost"
  | "interceptions"
  | "dribblesCompleted"
  | "touches"

export type TacticalEventPoint = {
  id: string
  metricId: TacticalEventMetricId
  playerId: number
  receiverPlayerId?: number
  team: TeamSide
  tick: number
  displayTick: number
  minute: number
  x: number
  y: number
  nativeEventType: number
  flags: number
}

export type PlayerStats = {
  goals: number
  assists: number
  xg?: number
  xa?: number
  shots?: number
  shotsOnTarget?: number
  blockedShots?: number
  clearCutChances?: number
  hitWoodwork?: number
  dribbles?: number
  fouls?: number
  fouled?: number
  crosses?: number
  crossesCompleted?: number
  passes?: number
  passesCompleted?: number
  keyPasses?: number
  tacklesAttempted?: number
  tacklesWon?: number
  keyTackles?: number
  aerials?: number
  aerialsWon?: number
  interceptions?: number
  throwIns?: number
  corners?: number
  defensiveFreeKicks?: number
  attackingFreeKicks?: number
  clearances?: number
  shotsFaced?: number
  distanceM?: number
  overallPhysicalCondition?: number
  matchSharpness?: number
}

export type PlayerProfile = {
  weeklyWage?: number
  heightCm?: number
  condition?: number
  morale?: number
  currentAbility?: number
  potentialAbility?: number
  currentReputation?: number
}

export type PlayerAttributes = {
  technical: Record<string, number>
  mental: Record<string, number>
  physical: Record<string, number>
  goalkeeping: Record<string, number>
}

export type TeamStats = {
  goals: number
  xg: number
  possessionTime: number
  shots: number
  shotsOnTarget: number
  shotsOffTarget: number
  blockedShots: number
  clearCutChances: number
  hitWoodwork: number
  passes: number
  passesCompleted: number
  progressivePasses: number
  finalThirdPasses: number
  keyPasses: number
  crosses: number
  crossesCompleted: number
  dribbles: number
  assists: number
  xa: number
  corners: number
  offsides: number
  tacklesAttempted: number
  tacklesWon: number
  keyTackles: number
  interceptions: number
  clearances: number
  aerials: number
  aerialsWon: number
  fouls: number
  fouled: number
  yellowCards: number
  redCards: number
  defensiveFreeKicks: number
  attackingFreeKicks: number
  throwIns: number
}

export type MatchPlayer = {
  id: number
  uid?: number
  name: string
  fullName?: string
  portraitPath?: string
  portraitUrl?: string
  team: TeamSide
  shirtNumber?: number
  position?: string
  positionFamiliarities?: PlayerPositionFamiliarities
  inPossession?: PlayerTacticalAssignment
  outOfPossession?: PlayerTacticalAssignment
  rating?: number
  isStarter: boolean
  isOnPitch: boolean
  coordinate?: {
    rawX: number
    rawY: number
    displayX: number
    displayY: number
  }
  status?: {
    yellowCards?: number
    redCards?: number
    subbedOnMinute?: number
    subbedOffMinute?: number
  }
  profile?: PlayerProfile
  attributes?: PlayerAttributes
  stats: PlayerStats
}

export type PlayerTacticalAssignment = {
  positionMask: number
  position: string
  roleDuty: string
  role: string
  roleAbbreviation: string
  duty?: string
}

export type MatchSnapshot = {
  clock: { minute: number; second: number; elapsedMinute: number; elapsedSecond: number; elapsedTick: number }
  period: number
  score: { home: number; away: number }
  home: { uid?: number; clubUid?: number; name: string; color?: string; logoPath?: string; logoUrl?: string; formation?: string; stats: TeamStats }
  away: { uid?: number; clubUid?: number; name: string; color?: string; logoPath?: string; logoUrl?: string; formation?: string; stats: TeamStats }
  players: MatchPlayer[]
  events: MatchEvent[]
  xgTimeline: XgTimelinePoint[]
  positionHeatmaps: PlayerPositionHeatmap[]
  tacticalEvents: TacticalEventPoint[]
  momentum: MatchMomentumPoint[]
  rollingMomentum: MatchMomentumPoint[]
}
