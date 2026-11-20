import {
  BitmapText,
  Container,
  Graphics,
  GraphicsContext,
  Sprite,
  type Texture,
} from "pixi.js"
import type {
  TacticalMotionBall,
  TacticalMotionFrame,
  TacticalMotionPlayer,
} from "@/components/tactical/shared/core/types"
import type { TeamSide } from "@/types/match"
export type MotionRendererAppearance = {
  home: number
  away: number
  fontFamily?: string[]
  foreground: number
  homeGoalkeeperColor?: number
  awayGoalkeeperColor?: number
}
const MOTION_MARKER_RADIUS = 10
const MOTION_MARKER_DIAMETER_HEIGHT_RATIO = 1 / 20
const MOTION_MARKER_MIN_DIAMETER = 14
const MOTION_MARKER_MAX_DIAMETER = 18
// Preserve the original 12:20 ball-to-player diameter ratio.
const MOTION_BALL_PLAYER_DIAMETER_RATIO = 12 / 20
type MotionMarkerGeometry = {
  key: string
  body: GraphicsContext
  arrow: GraphicsContext
  users: number
}
type MotionMarkerRecord = {
  container: Container
  body: Graphics
  arrow: Graphics
  label: BitmapText
  geometry: MotionMarkerGeometry
  team: TeamSide
  shirtNumber?: number
  isGoalkeeper?: boolean
}

export class MotionRenderer {
  readonly container = new Container()
  private readonly playerLayer = new Container()
  private readonly ball: Sprite
  private readonly markers = new Map<number, MotionMarkerRecord>()
  private readonly geometries = new Map<string, MotionMarkerGeometry>()
  private readonly visiblePlayers = new Set<number>()
  private frame?: TacticalMotionFrame
  private width: number
  private height: number
  private markerScale = 1
  private ballBaseSize = 0
  private appearance: MotionRendererAppearance
  constructor(
    width: number,
    height: number,
    ballTexture: Texture,
    appearance: MotionRendererAppearance
  ) {
    this.width = width
    this.height = height
    this.appearance = appearance
    this.ball = new Sprite(ballTexture)
    this.ball.anchor.set(0.5)
    this.container.addChild(this.playerLayer, this.ball)
    this.updateSizes()
  }
  renderFrame(frame: TacticalMotionFrame) {
    this.frame = frame
    const visible = this.visiblePlayers
    visible.clear()
    for (let index = 0; index < Math.min(frame.players.length, 64); index++) {
      const player = frame.players[index]
      visible.add(player.playerId)
      this.positionMarker(player)
    }
    for (const [id, marker] of this.markers) {
      if (!visible.has(id)) {
        this.destroyMarker(marker)
        this.markers.delete(id)
      }
    }
    if (frame.ball) this.positionBall(frame.ball)
    else this.ball.visible = false
  }
  resize(width: number, height: number) {
    this.width = width
    this.height = height
    this.updateSizes()
    if (this.frame) this.renderFrame(this.frame)
  }
  updateAppearance(appearance: MotionRendererAppearance) {
    this.appearance = appearance
    for (const marker of this.markers.values()) this.drawMarker(marker)
  }
  clear() {
    this.frame = undefined
    this.clearMarkers()
    this.ball.visible = false
  }
  destroy() {
    this.clear()
    this.container.destroy({ children: true })
  }
  private positionBall(ball: TacticalMotionBall) {
    this.ball.visible = true
    this.ball.position.set(
      (ball.x / 100) * this.width,
      (ball.y / 100) * this.height
    )
    const elevationScale = 1 + clamp(ball.zCentimeters, 0, 300) / 900
    const size = this.ballBaseSize * elevationScale
    this.ball.width = size
    this.ball.height = size
  }

  private positionMarker(player: TacticalMotionPlayer) {
    let marker = this.markers.get(player.playerId)
    if (!marker) {
      const container = new Container()
      container.scale.set(this.markerScale)
      const geometry = this.markerGeometry(player)
      geometry.users++
      const body = new Graphics({ context: geometry.body })
      const arrow = new Graphics({ context: geometry.arrow })
      const label = new BitmapText({
        text: player.shirtNumber == null ? "" : String(player.shirtNumber),
        style: {
          fontFamily: this.appearance.fontFamily ?? ["sans-serif"],
          fontSize: 9,
          fontWeight: "bold",
          fill: this.appearance.foreground,
          align: "center",
        },
      })
      label.anchor.set(0.5)
      // Draw the arrow behind the body so its base cannot cover the inner ring.
      container.addChild(arrow, body, label)
      marker = {
        container,
        body,
        arrow,
        label,
        geometry,
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

  private drawMarker(marker: MotionMarkerRecord) {
    const geometry = this.markerGeometry(marker)
    if (marker.geometry !== geometry) {
      geometry.users++
      marker.body.context = geometry.body
      marker.arrow.context = geometry.arrow
      this.releaseGeometry(marker.geometry)
      marker.geometry = geometry
    }
    marker.label.style.fontFamily = this.appearance.fontFamily ?? ["sans-serif"]
    marker.label.style.fill = this.appearance.foreground
  }

  private markerGeometry(
    marker: Pick<MotionMarkerRecord, "team" | "isGoalkeeper">
  ) {
    const fallbackColor =
      marker.team === "home" ? this.appearance.home : this.appearance.away
    const goalkeeperColor =
      marker.team === "home"
        ? this.appearance.homeGoalkeeperColor
        : this.appearance.awayGoalkeeperColor
    const teamColor =
      marker.isGoalkeeper &&
      goalkeeperColor != null &&
      Number.isFinite(goalkeeperColor) &&
      goalkeeperColor !== 0
        ? (goalkeeperColor >>> 0) & 0x00ffffff
        : fallbackColor
    const labelColor = this.appearance.foreground
    const key = `${teamColor}:${labelColor}`
    const cached = this.geometries.get(key)
    if (cached) return cached
    const body = new GraphicsContext()
    body
      .circle(0, 0, MOTION_MARKER_RADIUS)
      .fill({ color: teamColor, alpha: 0.96 })
      .stroke({ width: 1.5, color: teamColor, alpha: 1 })
      .circle(0, 0, MOTION_MARKER_RADIUS - 2)
      .stroke({ width: 1.5, color: labelColor, alpha: 0.95 })
    const arrow = new GraphicsContext()
    arrow
      .poly(
        [
          { x: 0, y: -MOTION_MARKER_RADIUS - 4 },
          { x: -4, y: -MOTION_MARKER_RADIUS + 1 },
          { x: 4, y: -MOTION_MARKER_RADIUS + 1 },
        ],
        true
      )
      .fill({ color: teamColor, alpha: 1 })
    const geometry = { key, body, arrow, users: 0 }
    this.geometries.set(key, geometry)
    return geometry
  }

  private updateSizes() {
    // Recompute only at initialization and resize, keeping sizing out of the
    // frame loop. Bound the diameter for both normal and focus views.
    const diameter = clamp(
      this.height * MOTION_MARKER_DIAMETER_HEIGHT_RATIO,
      MOTION_MARKER_MIN_DIAMETER,
      MOTION_MARKER_MAX_DIAMETER
    )
    this.markerScale = diameter / (MOTION_MARKER_RADIUS * 2)
    this.ballBaseSize = diameter * MOTION_BALL_PLAYER_DIAMETER_RATIO
    for (const marker of this.markers.values()) {
      marker.container.scale.set(this.markerScale)
    }
  }

  private clearMarkers() {
    for (const marker of this.markers.values()) this.destroyMarker(marker)
    this.markers.clear()
    this.visiblePlayers.clear()
  }

  private destroyMarker(marker: MotionMarkerRecord) {
    marker.container.destroy({ children: true })
    this.releaseGeometry(marker.geometry)
  }

  private releaseGeometry(geometry: MotionMarkerGeometry) {
    if (--geometry.users !== 0) return
    geometry.body.destroy()
    geometry.arrow.destroy()
    this.geometries.delete(geometry.key)
  }
}
function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
