import type { TeamSide } from "@/types/match"
export type TacticalMotionPlayer = {
  playerId: number
  team: TeamSide
  shirtNumber?: number
  isGoalkeeper?: boolean
  x: number
  y: number
  /** Unclipped physical position on board axes, with the pitch corner as origin. */
  positionMeters?: { x: number; y: number }
  angleDegrees?: number
  velocityXPerTick: number
  velocityYPerTick: number
  /** Board axes, metres/second; absent when movement cannot be established. */
  velocity?: { x: number; y: number }
}

export type TacticalMotionBall = {
  x: number
  y: number
  positionMeters?: { x: number; y: number }
  zCentimeters: number
}

export type TacticalMotionFrame = {
  tick: number
  pitchDimensions?: { length: number; width: number }
  players: readonly TacticalMotionPlayer[]
  ball?: TacticalMotionBall
}
