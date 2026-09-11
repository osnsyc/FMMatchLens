import type {
  RealtimeFrame,
  RealtimeMatchMetadata,
  RealtimeMomentumEvent,
  RealtimeMomentumPoint,
} from "@/api/realtimeMatch"
import type { LocalArchiveSummary } from "@/api/localArchive"
import type {
  HeatmapSnapshot,
  MatchEvent,
  MatchMomentumPoint,
  TacticalEventPoint,
  XgTimelinePoint,
} from "@/types/match"

export type StreamRevision<T> = {
  commonLength: number
  tail: readonly T[]
}

export type ReplayStreamRevision = {
  momentumEvents: StreamRevision<RealtimeMomentumEvent>
  momentum: StreamRevision<RealtimeMomentumPoint>
  rollingMomentum: StreamRevision<RealtimeMomentumPoint>
}

/**
 * A frame retained for replay. Cumulative streams are removed and represented
 * once in ReplayArchive.streamRevisions instead.
 */
export type ReplayFrame = RealtimeFrame

export type ReplayArchive = {
  summary: LocalArchiveSummary
  frameCount: number
  ticks: Int32Array
  metadata?: RealtimeMatchMetadata
  metadataTimeline: readonly RealtimeMatchMetadata[]
  frames: readonly ReplayFrame[]
  streamRevisions: readonly ReplayStreamRevision[]
}

export type HistoricalDerivationSnapshot = {
  xgTimeline: XgTimelinePoint[]
  events: MatchEvent[]
  tacticalEvents: TacticalEventPoint[]
  heatmaps: HeatmapSnapshot
  momentum: MatchMomentumPoint[]
  rollingMomentum: MatchMomentumPoint[]
}
