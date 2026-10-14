import {
  MotionRenderer,
  type MotionRendererAppearance,
} from "@/components/tactical/shared/renderer/MotionRenderer"
import type { TacticalRenderScheduler } from "@/components/tactical/shared/runtime/tacticalRenderScheduler"
import { Container, Graphics, type Texture } from "pixi.js"

import {
  interpolateMotionBall,
  interpolateMotionFrame,
  interpolateMotionPlayer,
} from "@/components/tactical/shared/core/interpolation"
import type {
  TacticalPlayback,
  PlaybackTextResolver,
} from "@/components/tactical/playback/core/types"
import {
  PlaybackOverlayRenderer,
  type PlaybackOverlayColors,
} from "@/components/tactical/playback/renderer/PlaybackOverlayRenderer"

export type PlaybackRendererAppearance = PlaybackOverlayColors &
  MotionRendererAppearance

const PLAYBACK_TICK_DURATION_MS = 250

export class PlaybackRenderer {
  readonly container = new Container()
  readonly trailLayer = new Container()
  private readonly motion: MotionRenderer
  private readonly ownsMotion: boolean
  private readonly trail = new Graphics()
  private readonly overlays = new PlaybackOverlayRenderer()
  private width: number
  private height: number
  private appearance: PlaybackRendererAppearance
  private textResolver?: PlaybackTextResolver
  private readonly scheduler?: TacticalRenderScheduler
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
    onRender: () => void,
    scheduler?: TacticalRenderScheduler,
    motion?: MotionRenderer
  ) {
    this.scheduler = scheduler
    this.width = width
    this.height = height
    this.appearance = appearance
    this.textResolver = textResolver
    this.onRender = onRender
    this.trailLayer.addChild(this.trail)
    this.ownsMotion = !motion
    this.motion =
      motion ?? new MotionRenderer(width, height, ballTexture, appearance)
    if (this.ownsMotion)
      this.container.addChild(this.trailLayer, this.motion.container)
    this.container.addChild(this.overlays.container)
    this.container.visible = false
    this.trailLayer.visible = false
  }

  get active() {
    return this.playback != null
  }

  updatePlayback(playback: TacticalPlayback | null) {
    if (samePlayback(this.playback, playback)) return false
    this.cancelAnimation()
    this.motion.clear()
    this.trail.clear()
    this.overlays.clear()
    this.playback = playback ?? undefined
    this.frameIndex = 0
    this.currentProgress = 0
    this.container.visible = playback != null
    this.trailLayer.visible = playback != null
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
    this.scheduleAdvance()
    return true
  }

  updateAppearance(appearance: PlaybackRendererAppearance) {
    this.appearance = appearance
    if (this.ownsMotion) this.motion.updateAppearance(appearance)
    if (this.playback) this.drawFrame(this.frameIndex, this.currentProgress)
  }

  updateTextResolver(textResolver: PlaybackTextResolver) {
    this.textResolver = textResolver
    if (this.playback) this.drawFrame(this.frameIndex, this.currentProgress)
  }

  resize(width: number, height: number) {
    this.width = width
    this.height = height
    if (this.ownsMotion) this.motion.resize(width, height)
    if (this.playback) this.drawFrame(this.frameIndex, this.currentProgress)
  }

  destroy() {
    this.cancelAnimation()
    if (this.ownsMotion) this.motion.clear()
    this.container.removeChild(this.overlays.container)
    this.overlays.destroy()
    if (this.ownsMotion) {
      this.container.removeChild(this.motion.container)
      this.motion.destroy()
    }
    if (!this.ownsMotion) this.trailLayer.destroy({ children: true })
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
      this.scheduleAdvance()
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
    const renderFrame = interpolateMotionFrame(current, next, progress)
    this.motion.renderFrame(renderFrame)
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
        points.push(interpolateMotionPlayer(current, next, progress))
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
        points.push(interpolateMotionBall(current, next, progress))
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

  private scheduleAdvance() {
    if (this.scheduler)
      this.scheduler.setTask("playback", (now) => {
        this.advance(now)
        return (
          this.playback != null &&
          this.frameIndex < this.playback.frames.length - 1
        )
      })
    else this.animationFrame = requestAnimationFrame(this.advance)
  }
  private cancelAnimation() {
    this.scheduler?.removeTask("playback")
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
