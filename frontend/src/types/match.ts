export type TeamSide = "home" | "away"

export const playerPositionLabels = [
  "GK",
  "SW",
  "DL",
  "DC",
  "DR",
  "DM",
  "ML",
  "MC",
  "MR",
  "AML",
  "AMC",
  "AMR",
  "ST",
  "WBL",
  "WBR",
] as const
export type PlayerPosition = (typeof playerPositionLabels)[number]
export type PlayerPositionFamiliarities = Partial<
  Record<PlayerPosition, number>
>

export type MatchEventType =
  "goal" | "own_goal" | "assist_candidate" | "yellow_card" | "red_card"

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

export type PositionHeatmapRange = "full" | "half" | "recent15"
export type HeatmapPhase = "all" | "inPossession" | "outOfPossession"
export type HeatmapScope =
  { type: "team"; team: TeamSide } | { type: "player"; playerId: number }
export type HeatmapRange =
  | PositionHeatmapRange
  | {
      type: "custom"
      fromTick: number
      toTick: number
    }
export type HeatmapQuery = {
  scope: HeatmapScope
  phase: HeatmapPhase
  range: HeatmapRange
}
export type HeatmapGrid = {
  width: 40
  height: 60
  density: Float32Array
  sampleCount: number
  averageX: number
  averageY: number
}
export type HeatmapSnapshot = {
  /**
   * Query-keyed live view. The map itself is read-only, but grid objects are
   * reused and updated by HeatmapDerivations to avoid per-frame allocations.
   * Use getHeatmap() rather than retaining individual grid references.
   */
  grids: ReadonlyMap<string, HeatmapGrid>
  revision: number
}

export type TacticalEventMetricId =
  | "goals"
  | "shotsOnTarget"
  | "shotsOffTarget"
  | "hitWoodwork"
  | "blockedShots"
  | "passesCompleted"
  | "passesIncomplete"
  | "keyPasses"
  | "crossesCompleted"
  | "crossesIncomplete"
  | "fouled"
  | "foulsCommitted"
  | "tacklesWon"
  | "tacklesLost"
  | "aerialsWon"
  | "aerialsLost"
  | "interceptions"
  | "clearances"
  | "defensiveBlocks"
  | "dribblesCompleted"
  | "possessionGained"
  | "possessionLost"
  | "touches"
  | "offsides"
  | "goalkeeperSavesHeld"
  | "goalkeeperSavesParried"

export type TacticalEventPoint = {
  id: string
  metricId: TacticalEventMetricId
  metricIds?: TacticalEventMetricId[]
  playerId: number
  receiverPlayerId?: number
  team: TeamSide
  tick: number
  displayTick: number
  minute: number
  x: number
  y: number
  anchorX?: number
  anchorY?: number
  trajectoryStartX?: number
  trajectoryStartY?: number
  trajectoryPoints?: Array<{ x: number; y: number }>
  endX?: number
  endY?: number
  nativeEventType: number
  flags: number
  sequenceIndex?: number
}

export type PlayerStats = {
  goals: number
  assists: number
  penalties?: number
  ownGoals?: number
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
  savesHeld?: number
  savesParried?: number
  savesTipped?: number
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
  dateOfBirth?: string
  nationUid?: number
  bodyType?: number
  guideValueGbp?: number
  internationalApps?: number
  internationalGoals?: number
  youthApps?: number
  youthGoals?: number
}

export type PlayerAttributes = {
  technical: Record<string, number>
  mental: Record<string, number>
  physical: Record<string, number>
  goalkeeping: Record<string, number>
  traits?: string
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
  age?: number
  isStarter: boolean
  isOnPitch: boolean
  coordinate?: {
    rawX: number
    rawY: number
    displayX: number
    displayY: number
  }
  status?: {
    penalties?: number
    ownGoals?: number
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

export type FormationSnapshot = {
  tick: number
  minute: number
  players: MatchPlayer[]
}

export type MatchManager = {
  uid?: number
  firstName?: string
  secondName?: string
  isHumanControlled: boolean
}

export type TeamThemeColors = {
  light: string
  dark: string
}

export type MatchSnapshot = {
  matchId?: string
  /** Actual venue dimensions in metres when available. */
  pitchDimensions?: {
    length: number
    width: number
  }
  clock: {
    minute: number
    second: number
    elapsedMinute: number
    elapsedSecond: number
    elapsedTick: number
  }
  period: number
  score: { home: number; away: number }
  home: {
    uid?: number
    clubUid?: number
    name: string
    color?: string
    colorSource?: import("@/lib/teamColors").TeamColorSource
    themeColors?: TeamThemeColors
    logoPath?: string
    logoUrl?: string
    manager?: MatchManager
    formation?: string
    stats: TeamStats
  }
  away: {
    uid?: number
    clubUid?: number
    name: string
    color?: string
    colorSource?: import("@/lib/teamColors").TeamColorSource
    themeColors?: TeamThemeColors
    logoPath?: string
    logoUrl?: string
    manager?: MatchManager
    formation?: string
    stats: TeamStats
  }
  players: MatchPlayer[]
  events: MatchEvent[]
  xgTimeline: XgTimelinePoint[]
  heatmaps: HeatmapSnapshot
  tacticalEvents: TacticalEventPoint[]
  momentum: MatchMomentumPoint[]
  rollingMomentum: MatchMomentumPoint[]
  formationSnapshots?: FormationSnapshot[]
}
