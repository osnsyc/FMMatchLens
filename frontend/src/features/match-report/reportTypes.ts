import type { RealtimeFrame } from "@/api/realtimeMatch"
import type { PlayerMovementAnalysis } from "@/api/playerMovement"

export type MatchReportContext = {
  movementFrames: readonly RealtimeFrame[]
  pomMovement?: PlayerMovementAnalysis
}

// Logical pixels; the PNG export renders at 2x.
export const REPORT_WIDTH = 1280
export const REPORT_HEIGHT = 840
export const REPORT_LAYOUT_WIDTH = 2280
