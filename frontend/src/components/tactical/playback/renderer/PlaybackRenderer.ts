import { BitmapText, Container, Graphics, Sprite, type Texture } from "pixi.js"

import {
  interpolatePlaybackBall,
  interpolatePlaybackFrame,
  interpolatePlaybackPlayer,
} from "@/components/tactical/playback/core/interpolation"
import type {
  TacticalPlayback,
  TacticalPlaybackBall,
  TacticalPlaybackPlayer,
  PlaybackTextResolver,
} from "@/components/tactical/playback/core/types"
import {
  PlaybackOverlayRenderer,
  type PlaybackOverlayColors,
} from "@/components/tactical/playback/renderer/PlaybackOverlayRenderer"
import type { TeamSide } from "@/types/match"

type PlaybackMarkerRecord = {
  container: Container
  body: Graphics
  arrow: Graphics
  label: BitmapText
  team: TeamSide
  shirtNumber?: number
  isGoalkeeper?: boolean
}

export type PlaybackRendererAppearance = PlaybackOverlayColors & {
  /** Packed ARGB kit colors from team metadata. */
  homeGoalkeeperColor?: number
  awayGoalkeeperColor?: number
}

const PLAYBACK_TICK_DURATION_MS = 250
const PLAYBACK_MARKER_RADIUS = 10
const PLAYBACK_BALL_SIZE = 12

export class PlaybackRenderer {
  readonly container = new Container()
  private readonly trailLayer = new Container()
  private readonly playerLayer = new Container()
  private readonly ballLayer = new Container()
  private readonly trail = new Graphics()
  private readonly ball: Sprite
  private readonly overlays = new PlaybackOverlayRenderer()
  private readonly markers = new Map<number, PlaybackMarkerRecord>()
  private width: number
  private height: number
  private appearance: PlaybackRendererAppearance
  private textResolver?: PlaybackTextResolver
  private readonly onRender: () => void
  private playback?: TacticalPlayback
  private animationFrame: number | null = null
  private startedAt = 0
  private frameIndex = 0
  private currentProgress = 0
  private readonly reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches

  constructor(
    width: number,
    height: number,
    ballTexture: Texture,
    appearance: PlaybackRendererAppearance,
    textResolver: PlaybackTextResolver | undefined,
    onRender: () => void
  ) {
    this.width = width
    this.height = height
    this.appearance = appearance
    this.textResolver = textResolver
    this.onRender = onRender
    this.trailLayer.addChild(this.trail)
    this.ball = new Sprite(ballTexture)
    this.ball.anchor.set(0.5)
    this.ball.width = PLAYBACK_BALL_SIZE
    this.ball.height = PLAYBACK_BALL_SIZE
    this.ballLayer.addChild(this.ball)
    this.container.addChild(
      this.trailLayer,
      this.playerLayer,
      this.ballLayer,
      this.overlays.container
    )
    this.container.visible = false
  }

  get active() {
    return this.playback != null
  }

  updatePlayback(playback: TacticalPlayback | null) {
    if (samePlayback(this.playback, playback)) return false
    this.cancelAnimation()
    this.clearMarkers()
    this.trail.clear()
    this.overlays.clear()
    this.playback = playback ?? undefined
    this.frameIndex = 0
    this.currentProgress = 0
    this.container.visible = playback != null
    if (!playback) {
      this.onRender()
      return true
    }
    this.startedAt = performance.now()
    if (this.reduceMotion) {
      this.drawFrame(playback.frames.length - 1, 0)
      return true
    }
    this.drawFrame(0, 0)
    this.animationFrame = requestAnimationFrame(this.advance)
    return true
  }

  updateAppearance(appearance: PlaybackRendererAppearance) {
    this.appearance = appearance
    for (const marker of this.markers.values()) this.drawMarker(marker)
    if (this.playback) this.drawFrame(this.frameIndex, this.currentProgress)
  }

  updateTextResolver(textResolver: PlaybackTextResolver) {
    this.textResolver = textResolver
    if (this.playback) this.drawFrame(this.frameIndex, this.currentProgress)
  }

  resize(width: number, height: number) {
    this.width = width
    this.height = height
    if (this.playback) this.drawFrame(this.frameIndex, this.currentProgress)
  }

  destroy() {
    this.cancelAnimation()
    this.clearMarkers()
    this.container.removeChild(this.overlays.container)
    this.overlays.destroy()
    this.container.destroy({ children: true })
    this.playback = undefined
  }

  private readonly advance = (timestamp: number) => {
    this.animationFrame = null
    const playback = this.playback
    if (!playback) return
    const frames = playback.frames
    const firstTick = frames[0].tick
    const lastTick = frames.at(-1)!.tick
    const playbackTick = Math.min(
      lastTick,
      firstTick + (timestamp - this.startedAt) / PLAYBACK_TICK_DURATION_MS
    )
    if (playbackTick >= lastTick) {
      this.drawFrame(frames.length - 1, 0)
      return
    }
    while (
      this.frameIndex < frames.length - 2 &&
      frames[this.frameIndex + 1].tick <= playbackTick
    ) {
      this.frameIndex += 1
    }
    const current = frames[this.frameIndex]
    const next = frames[Math.min(frames.length - 1, this.frameIndex + 1)]
    const progress = clamp(
      (playbackTick - current.tick) / Math.max(1, next.tick - current.tick),
      0,
      1
    )
    this.drawFrame(this.frameIndex, progress)
    if (playbackTick < lastTick) {
      this.animationFrame = requestAnimationFrame(this.advance)
    }
  }

  private drawFrame(frameIndex: number, progress: number) {
    const playback = this.playback
    if (!playback) return
    this.frameIndex = frameIndex
    this.currentProgress = progress
    const frames = playback.frames
    const current = frames[Math.min(frameIndex, frames.length - 1)]
    const next = frames[Math.min(frameIndex + 1, frames.length - 1)]
    const renderFrame = interpolatePlaybackFrame(current, next, progress)
    const visible = new Set<number>()
    for (const player of renderFrame.players) {
      visible.add(player.playerId)
      this.positionMarker(player)
    }
    for (const [playerId, marker] of this.markers) {
      marker.container.visible = visible.has(playerId)
    }
    if (renderFrame.ball) this.positionBall(renderFrame.ball)
    else this.ball.visible = false
    this.drawTrail(frameIndex, progress)
    this.overlays.render(
      playback,
      renderFrame,
      this.width,
      this.height,
      this.appearance,
      this.textResolver
    )
    this.onRender()
  }

  private positionBall(ball: TacticalPlaybackBall) {
    this.ball.visible = true
    this.ball.position.set(
      (ball.x / 100) * this.width,
      (ball.y / 100) * this.height
    )
    const elevationScale = 1 + clamp(ball.zCentimeters, 0, 300) / 900
    this.ball.width = PLAYBACK_BALL_SIZE * elevationScale
    this.ball.height = PLAYBACK_BALL_SIZE * elevationScale
  }

  private positionMarker(player: TacticalPlaybackPlayer) {
    let marker = this.markers.get(player.playerId)
    if (!marker) {
      const container = new Container()
      const body = new Graphics()
      const arrow = new Graphics()
      const label = new BitmapText({
        text: player.shirtNumber == null ? "" : String(player.shirtNumber),
        style: {
          fontFamily: "Arial",
          fontSize: 9,
          fontWeight: "bold",
          fill: this.appearance.foreground,
          align: "center",
        },
      })
      label.anchor.set(0.5)
      container.addChild(body, label, arrow)
      marker = {
        container,
        body,
        arrow,
        label,
        team: player.team,
        shirtNumber: player.shirtNumber,
        isGoalkeeper: player.isGoalkeeper,
      }
      this.markers.set(player.playerId, marker)
      this.playerLayer.addChild(container)
      this.drawMarker(marker)
    } else if (
      marker.team !== player.team ||
      marker.shirtNumber !== player.shirtNumber ||
      marker.isGoalkeeper !== player.isGoalkeeper
    ) {
      marker.team = player.team
      marker.shirtNumber = player.shirtNumber
      marker.isGoalkeeper = player.isGoalkeeper
      marker.label.text =
        player.shirtNumber == null ? "" : String(player.shirtNumber)
      this.drawMarker(marker)
    }
    marker.container.visible = true
    marker.container.position.set(
      (player.x / 100) * this.width,
      (player.y / 100) * this.height
    )
    marker.arrow.visible = player.angleDegrees != null
    if (player.angleDegrees != null) {
      marker.arrow.rotation = (player.angleDegrees * Math.PI) / 180
    }
  }

  private drawMarker(marker: PlaybackMarkerRecord) {
    const fallbackColor =
      marker.team === "home" ? this.appearance.home : this.appearance.away
    const goalkeeperColor = marker.team === "home"
      ? this.appearance.homeGoalkeeperColor
      : this.appearance.awayGoalkeeperColor
    const teamColor = marker.isGoalkeeper &&
      goalkeeperColor != null && Number.isFinite(goalkeeperColor) && goalkeeperColor !== 0
      ? (goalkeeperColor >>> 0) & 0x00ffffff
      : fallbackColor
    const labelColor = this.appearance.foreground
    marker.body
      .clear()
      .circle(0, 0, PLAYBACK_MARKER_RADIUS)
      .fill({ color: teamColor, alpha: 0.96 })
      .stroke({ width: 2.5, color: teamColor, alpha: 1 })
      .circle(0, 0, PLAYBACK_MARKER_RADIUS - 2)
      .stroke({ width: 1.5, color: labelColor, alpha: 0.95 })
    marker.arrow
      .clear()
      .poly(
        [
          { x: 0, y: -PLAYBACK_MARKER_RADIUS - 7 },
          { x: -4, y: -PLAYBACK_MARKER_RADIUS + 1 },
          { x: 4, y: -PLAYBACK_MARKER_RADIUS + 1 },
        ],
        true
      )
      .fill({ color: teamColor, alpha: 1 })
    marker.label.style.fill = labelColor
  }

  private drawTrail(frameIndex: number, progress: number) {
    const playback = this.playback
    if (!playback?.trail) return
    const points: Array<{ x: number; y: number }> = []
    if (playback.trail.target === "player") {
      const playerId = playback.trail.playerId
      for (let index = 0; index <= frameIndex; index += 1) {
        const player = playback.frames[index].players.find(
          (candidate) => candidate.playerId === playerId
        )
        if (player) points.push(player)
      }
      const current = playback.frames[frameIndex].players.find(
        (candidate) => candidate.playerId === playerId
      )
      const nextFrame =
        playback.frames[Math.min(frameIndex + 1, playback.frames.length - 1)]
      const next = nextFrame.players.find(
        (candidate) => candidate.playerId === playerId
      )
      if (current && next && progress > 0) {
        points.push(interpolatePlaybackPlayer(current, next, progress))
      }
    } else {
      for (let index = 0; index <= frameIndex; index += 1) {
        const ball = playback.frames[index].ball
        if (ball) points.push(ball)
      }
      const current = playback.frames[frameIndex].ball
      const next =
        playback.frames[Math.min(frameIndex + 1, playback.frames.length - 1)]
          .ball ?? current
      if (current && next && progress > 0) {
        points.push(interpolatePlaybackBall(current, next, progress))
      }
    }
    this.trail.clear()
    if (points.length < 2) return
    const pixelPoints = points.map((point) => ({
      x: (point.x / 100) * this.width,
      y: (point.y / 100) * this.height,
    }))
    const teamColor =
      playback.team === "home" ? this.appearance.home : this.appearance.away
    drawSmoothPath(this.trail, pixelPoints)
    this.trail.stroke({
      width: 3,
      color: teamColor,
      alpha: 0.12,
      cap: "round",
      join: "round",
    })
    drawSmoothPath(this.trail, pixelPoints)
    this.trail.stroke({
      width: 1.5,
      color: teamColor,
      alpha: 0.68,
      cap: "round",
      join: "round",
    })
  }

  private clearMarkers() {
    this.playerLayer
      .removeChildren()
      .forEach((child) => child.destroy({ children: true }))
    this.markers.clear()
  }

  private cancelAnimation() {
    if (this.animationFrame != null) cancelAnimationFrame(this.animationFrame)
    this.animationFrame = null
  }
}

function drawSmoothPath(
  target: Graphics,
  points: readonly { x: number; y: number }[]
) {
  if (points.length < 2) return
  target.moveTo(points[0].x, points[0].y)
  if (points.length === 2) {
    target.lineTo(points[1].x, points[1].y)
    return
  }
  for (let index = 1; index < points.length - 1; index += 1) {
    const control = points[index]
    const next = points[index + 1]
    target.quadraticCurveTo(
      control.x,
      control.y,
      (control.x + next.x) / 2,
      (control.y + next.y) / 2
    )
  }
  const last = points.at(-1)!
  target.lineTo(last.x, last.y)
}

function samePlayback(
  current: TacticalPlayback | undefined,
  next: TacticalPlayback | null
) {
  if (!current || !next) return current == null && next == null
  if (current.id !== next.id || current.frames.length !== next.frames.length)
    return false
  return (
    current.frames[0]?.tick === next.frames[0]?.tick &&
    current.frames.at(-1)?.tick === next.frames.at(-1)?.tick
  )
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
