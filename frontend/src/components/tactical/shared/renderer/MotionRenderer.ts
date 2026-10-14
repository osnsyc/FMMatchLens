import { BitmapText, Container, Graphics, Sprite, type Texture } from "pixi.js"
import type {
  TacticalMotionBall,
  TacticalMotionFrame,
  TacticalMotionPlayer,
} from "@/components/tactical/shared/core/types"
import type { TeamSide } from "@/types/match"
export type MotionRendererAppearance = {
  home: number
  away: number
  foreground: number
  homeGoalkeeperColor?: number
  awayGoalkeeperColor?: number
}
const MOTION_MARKER_RADIUS = 10
const MOTION_BALL_SIZE = 12
type MotionMarkerRecord = {
  container: Container
  body: Graphics
  arrow: Graphics
  label: BitmapText
  team: TeamSide
  shirtNumber?: number
  isGoalkeeper?: boolean
}

export class MotionRenderer {
  readonly container = new Container()
  private readonly playerLayer = new Container()
  private readonly ball: Sprite
  private readonly markers = new Map<number, MotionMarkerRecord>()
  private frame?: TacticalMotionFrame
  private width: number
  private height: number
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
  }
  renderFrame(frame: TacticalMotionFrame) {
    this.frame = frame
    const visible = new Set<number>()
    for (const player of frame.players.slice(0, 64)) {
      visible.add(player.playerId)
      this.positionMarker(player)
    }
    for (const [id, marker] of this.markers) {
      if (!visible.has(id)) {
        marker.container.destroy({ children: true, context: true })
        this.markers.delete(id)
      }
    }
    if (frame.ball) this.positionBall(frame.ball)
    else this.ball.visible = false
  }
  resize(width: number, height: number) {
    this.width = width
    this.height = height
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
    this.ball.width = MOTION_BALL_SIZE * elevationScale
    this.ball.height = MOTION_BALL_SIZE * elevationScale
  }

  private positionMarker(player: TacticalMotionPlayer) {
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

  private drawMarker(marker: MotionMarkerRecord) {
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
    marker.body
      .clear()
      .circle(0, 0, MOTION_MARKER_RADIUS)
      .fill({ color: teamColor, alpha: 0.96 })
      .stroke({ width: 2.5, color: teamColor, alpha: 1 })
      .circle(0, 0, MOTION_MARKER_RADIUS - 2)
      .stroke({ width: 1.5, color: labelColor, alpha: 0.95 })
    marker.arrow
      .clear()
      .poly(
        [
          { x: 0, y: -MOTION_MARKER_RADIUS - 7 },
          { x: -4, y: -MOTION_MARKER_RADIUS + 1 },
          { x: 4, y: -MOTION_MARKER_RADIUS + 1 },
        ],
        true
      )
      .fill({ color: teamColor, alpha: 1 })
    marker.label.style.fill = labelColor
  }

  private clearMarkers() {
    // These marker graphics own their contexts; the shared ball texture lives
    // outside this layer and must survive clearing or replacing the players.
    this.playerLayer
      .removeChildren()
      .forEach((child) => child.destroy({ children: true, context: true }))
    this.markers.clear()
  }
}
function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
