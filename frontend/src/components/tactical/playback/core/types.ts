import type { TeamSide } from "@/types/match"

export type TacticalPlaybackPlayer = {
  playerId: number
  team: TeamSide
  shirtNumber?: number
  x: number
  y: number
  angleDegrees?: number
  velocityXPerTick: number
  velocityYPerTick: number
}

export type TacticalPlaybackBall = {
  x: number
  y: number
  zCentimeters: number
}

export type TacticalPlaybackFrame = {
  tick: number
  players: readonly TacticalPlaybackPlayer[]
  ball?: TacticalPlaybackBall
}

export type PlaybackRange = {
  startTick: number
  endTick: number
}

export type PlaybackTrail =
  { target: "ball" } | { target: "player"; playerId: number }

export type PlaybackTone =
  "team" | "danger" | "success" | "neutral" | "important"

export type PlaybackText = {
  key: string
  defaultValue: string
  values?: Readonly<Record<string, string | number>>
}

export type PlaybackTextResolver = (text: PlaybackText) => string

export type PlaybackOverlayTiming = {
  fromTick: number
  toTick?: number
  enter?: "instant" | "fade" | "scale"
  exit?: "instant" | "fade"
  transitionTicks?: number
}

export type PlaybackAnchor =
  | { target: "player"; playerId: number }
  | { target: "ball" }
  | { target: "position"; x: number; y: number }

type PlaybackOverlayBase = {
  id: string
  timing: PlaybackOverlayTiming
}

export type RegionOverlay = PlaybackOverlayBase & {
  kind: "region"
  geometry:
    | {
        shape: "rectangle"
        x: number
        y: number
        width: number
        height: number
      }
    | { shape: "circle"; x: number; y: number; radius: number }
    | { shape: "polygon"; points: readonly { x: number; y: number }[] }
  appearance?: {
    tone?: PlaybackTone
    fillOpacity?: number
    strokeOpacity?: number
    pulse?: boolean
  }
}

export type LabelOverlay = PlaybackOverlayBase & {
  kind: "label"
  variant: "entity" | "event"
  anchor: PlaybackAnchor
  title: PlaybackText
  detail?: PlaybackText
  offset?: { x: number; y: number }
  appearance?: { tone?: PlaybackTone }
}

export type MarkerOverlay = PlaybackOverlayBase & {
  kind: "marker"
  anchor: PlaybackAnchor
  shape?: "circle" | "ring" | "diamond"
  size?: number
  appearance?: {
    tone?: PlaybackTone
    pulse?: boolean
  }
}

export type ArrowOverlay = PlaybackOverlayBase & {
  kind: "arrow"
  from: PlaybackAnchor
  to: PlaybackAnchor
  appearance?: {
    tone?: PlaybackTone
    dashed?: boolean
    width?: number
  }
}

export type PlaybackOverlay =
  RegionOverlay | LabelOverlay | MarkerOverlay | ArrowOverlay

export type TacticalPlayback = {
  id: string
  team: TeamSide
  range: PlaybackRange
  frames: readonly TacticalPlaybackFrame[]
  trail?: PlaybackTrail
  overlays: readonly PlaybackOverlay[]
}

export type DribblePlayback = TacticalPlayback & {
  dribblerPlayerId: number
}

export type PlaybackRenderFrame = {
  tick: number
  players: readonly TacticalPlaybackPlayer[]
  ball?: TacticalPlaybackBall
}
