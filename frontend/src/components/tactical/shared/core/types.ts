import type { TeamSide } from "@/types/match"
export type TacticalMotionPlayer = {
  playerId: number
  team: TeamSide
  shirtNumber?: number
  isGoalkeeper?: boolean
  x: number
  y: number
  angleDegrees?: number
  velocityXPerTick: number
  velocityYPerTick: number
}

export type TacticalMotionBall = {
  x: number
  y: number
  zCentimeters: number
}

export type TacticalMotionFrame = {
  tick: number
  players: readonly TacticalMotionPlayer[]
  ball?: TacticalMotionBall
}
