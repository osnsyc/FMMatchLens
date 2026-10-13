import { Container } from "pixi.js"

import { activePlaybackOverlays } from "@/components/tactical/playback/core/overlayTimeline"
import type {
  PlaybackAnchor,
  PlaybackRenderFrame,
  PlaybackText,
  PlaybackTextResolver,
  PlaybackTone,
  TacticalPlayback,
} from "@/components/tactical/playback/core/types"
import { ArrowOverlayRenderer } from "@/components/tactical/playback/renderer/overlays/ArrowOverlayRenderer"
import { LabelOverlayRenderer } from "@/components/tactical/playback/renderer/overlays/LabelOverlayRenderer"
import { MarkerOverlayRenderer } from "@/components/tactical/playback/renderer/overlays/MarkerOverlayRenderer"
import { RegionOverlayRenderer } from "@/components/tactical/playback/renderer/overlays/RegionOverlayRenderer"

export type PlaybackOverlayColors = {
  home: number
  away: number
  foreground: number
  important: number
  negative: number
  neutral: number
  success: number
}

export type PlaybackOverlayRenderContext = {
  width: number
  height: number
  tick: number
  frame: PlaybackRenderFrame
  playback: TacticalPlayback
  colors: PlaybackOverlayColors
  resolveAnchor: (
    anchor: PlaybackAnchor
  ) => { x: number; y: number } | undefined
  resolveText: (text: PlaybackText) => string
  toneColor: (tone?: PlaybackTone) => number
}

export class PlaybackOverlayRenderer {
  readonly container = new Container()
  private readonly regions = new RegionOverlayRenderer()
  private readonly arrows = new ArrowOverlayRenderer()
  private readonly markers = new MarkerOverlayRenderer()
  private readonly labels = new LabelOverlayRenderer()

  constructor() {
    this.container.addChild(
      this.regions.container,
      this.arrows.container,
      this.markers.container,
      this.labels.container
    )
  }

  render(
    playback: TacticalPlayback,
    frame: PlaybackRenderFrame,
    width: number,
    height: number,
    colors: PlaybackOverlayColors,
    textResolver?: PlaybackTextResolver
  ) {
    const active = activePlaybackOverlays(playback.overlays, frame.tick)
    const context: PlaybackOverlayRenderContext = {
      width,
      height,
      tick: frame.tick,
      frame,
      playback,
      colors,
      resolveAnchor: (anchor) => resolveAnchor(anchor, frame, width, height),
      resolveText: textResolver ?? resolveText,
      toneColor: (tone) => toneColor(tone, playback, colors),
    }
    this.regions.render(active, context)
    this.arrows.render(active, context)
    this.markers.render(active, context)
    this.labels.render(active, context)
  }

  clear() {
    this.regions.clear()
    this.arrows.clear()
    this.markers.clear()
    this.labels.clear()
  }

  destroy() {
    this.clear()
    this.container.destroy({ children: true })
  }
}

function resolveAnchor(
  anchor: PlaybackAnchor,
  frame: PlaybackRenderFrame,
  width: number,
  height: number
) {
  const position =
    anchor.target === "position"
      ? anchor
      : anchor.target === "ball"
        ? frame.ball
        : frame.players.find((player) => player.playerId === anchor.playerId)
  return position
    ? { x: (position.x / 100) * width, y: (position.y / 100) * height }
    : undefined
}

function resolveText(text: PlaybackText) {
  let result = text.defaultValue || text.key
  for (const [key, value] of Object.entries(text.values ?? {})) {
    result = result.replaceAll(`{{${key}}}`, String(value))
  }
  return result
}

function toneColor(
  tone: PlaybackTone | undefined,
  playback: TacticalPlayback,
  colors: PlaybackOverlayColors
) {
  switch (tone) {
    case "danger":
      return colors.negative
    case "success":
      return colors.success
    case "important":
      return colors.important
    case "neutral":
      return colors.neutral
    default:
      return playback.team === "home" ? colors.home : colors.away
  }
}
