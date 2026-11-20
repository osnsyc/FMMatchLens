import { BitmapText, Container, Graphics } from "pixi.js"
import { calculateTeamHull, createTeamHull } from "../core/convexHull"
import type { TacticalMotionFrame } from "../core/types"

type HullAppearance = {
  home: number
  away: number
  fontFamily: string[]
}

/** Two reusable polygons and labels; no analysis or drawing while disabled. */
export class ConvexHullRenderer {
  readonly container = new Container()
  readonly labels = new Container()
  private readonly teams = (["home", "away"] as const).map((team) => ({
    team,
    state: createTeamHull(),
    graphic: new Graphics(),
    label: new BitmapText({ text: "", style: { fontSize: 10 } }),
  }))
  private frame?: TacticalMotionFrame
  private enabled = false
  private width: number
  private height: number
  private appearance: HullAppearance
  constructor(width: number, height: number, appearance: HullAppearance) {
    this.width = width
    this.height = height
    this.appearance = appearance
    this.container.eventMode = this.labels.eventMode = "none"
    this.container.interactiveChildren = this.labels.interactiveChildren = false
    for (const { team, graphic, label } of this.teams) {
      this.container.addChild(graphic)
      this.labels.addChild(label)
      label.anchor.set(team === "home" ? 1 : 0, 0.5)
    }
    this.updateAppearance(appearance)
    this.container.visible = this.labels.visible = false
  }

  setEnabled(enabled: boolean) {
    if (this.enabled === enabled) return
    this.enabled = enabled
    if (enabled && this.frame) this.renderFrame(this.frame)
    else this.container.visible = this.labels.visible = false
  }

  renderFrame(frame: TacticalMotionFrame) {
    this.frame = frame
    if (!this.enabled) return
    let valid = false
    for (const { team, state, graphic, label } of this.teams) {
      calculateTeamHull(frame, team, state)
      graphic.clear()
      label.visible = false
      const dimensions = frame.pitchDimensions
      if (state.area == null || !dimensions) continue
      valid = true
      if (state.hull.length >= 3 && state.area > 0) {
        for (let i = 0; i < state.hull.length; i++) {
          const point = state.hull[i]
          const x = (point.x / dimensions.length) * this.width
          const y = (point.y / dimensions.width) * this.height
          if (i === 0) graphic.moveTo(x, y)
          else graphic.lineTo(x, y)
        }
        graphic
          .closePath()
          .fill({ color: this.appearance[team], alpha: 0.12 })
          .stroke({ color: this.appearance[team], alpha: 0.7, width: 1 })
      }
      if (state.rearmostPlayer && state.points.length >= 3) {
        const text = String(Math.round(state.area))
        if (label.text !== text) label.text = text
        label.position.set(
          (state.rearmostPlayer.x / 100) * this.width +
            (team === "home" ? -16 : 16),
          (state.rearmostPlayer.y / 100) * this.height
        )
        label.visible = true
      }
    }
    this.container.visible = this.labels.visible = valid
  }

  updateAppearance(appearance: HullAppearance) {
    this.appearance = appearance
    for (const { team, label } of this.teams) {
      label.style.fontFamily = appearance.fontFamily
      label.style.fontWeight = "bold"
      label.style.fill = appearance[team]
    }
    if (this.frame) this.renderFrame(this.frame)
  }

  resize(width: number, height: number) {
    this.width = width
    this.height = height
    if (this.frame) this.renderFrame(this.frame)
  }

  clear() {
    this.frame = undefined
    this.container.visible = this.labels.visible = false
    for (const { state, graphic, label } of this.teams) {
      state.points.length = state.hull.length = 0
      state.rearmostPlayer = undefined
      state.area = null
      graphic.clear()
      label.visible = false
    }
  }

  destroy() {
    this.clear()
    this.container.destroy({ children: true, context: true })
    this.labels.destroy({ children: true })
  }
}
