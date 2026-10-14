import { Container, Graphics, Sprite, Texture } from "pixi.js"
import { calculatePitchControl } from "../core/pitchControl"
import type { TacticalMotionFrame } from "../core/types"
import { pitchControlContours } from "./pitchControlContours"
import { rasterizePitchControl } from "./pitchControlRaster"

/** A small, bilinearly scaled texture keeps the overlay inexpensive to render. */
export class PitchControlRenderer {
  readonly container = new Container()
  private canvas?: HTMLCanvasElement
  private texture?: Texture
  private readonly heatmap = new Sprite()
  private readonly contour = new Graphics()
  private frame?: TacticalMotionFrame
  private enabled = false
  private width: number
  private height: number
  private home: number
  private away: number
  constructor(width: number, height: number, home: number, away: number) {
    this.width = width
    this.height = height
    this.home = home
    this.away = away
    this.container.eventMode = "none"
    this.container.interactiveChildren = false
    this.container.addChild(this.heatmap, this.contour)
    this.container.visible = false
  }
  setEnabled(enabled: boolean) {
    this.enabled = enabled
    if (enabled && this.frame) this.renderFrame(this.frame)
    else this.container.visible = false
  }
  renderFrame(frame: TacticalMotionFrame) {
    this.frame = frame
    if (!this.enabled) return
    const grid = calculatePitchControl(frame)
    this.container.visible = grid != null
    if (!grid) return
    const raster = rasterizePitchControl(grid, this.home, this.away)
    const canvas = (this.canvas ??= document.createElement("canvas"))
    canvas.width = raster.width
    canvas.height = raster.height
    const context = canvas.getContext("2d")
    if (!context) {
      this.container.visible = false
      return
    }
    const image = context.createImageData(raster.width, raster.height)
    image.data.set(raster.pixels)
    context.putImageData(image, 0, 0)
    if (!this.texture) {
      this.texture = Texture.from(canvas)
      this.heatmap.texture = this.texture
    }
    this.texture.source.update()
    // Place texel centres at grid nodes, clipping the half-texel border.
    this.heatmap.position.set(
      -this.width / (raster.width - 1) / 2,
      -this.height / (raster.height - 1) / 2
    )
    this.heatmap.width = (this.width * raster.width) / (raster.width - 1)
    this.heatmap.height = (this.height * raster.height) / (raster.height - 1)
    this.contour.clear()
    for (const { from, to } of pitchControlContours(grid)) {
      this.contour
        .moveTo(from.x * this.width, from.y * this.height)
        .lineTo(to.x * this.width, to.y * this.height)
    }
    this.contour.stroke({ color: 0xffffff, alpha: 0.18, width: 1 })
    this.drawMask()
  }
  private readonly clip = new Graphics()
  private drawMask() {
    if (!this.clip.parent) {
      this.container.addChild(this.clip)
      this.heatmap.mask = this.clip
    }
    this.clip.clear().rect(0, 0, this.width, this.height).fill(0xffffff)
  }
  updateAppearance(home: number, away: number) {
    this.home = home
    this.away = away
    if (this.frame) this.renderFrame(this.frame)
  }
  resize(width: number, height: number) {
    this.width = width
    this.height = height
    if (this.frame) this.renderFrame(this.frame)
  }
  clear() {
    this.frame = undefined
    this.container.visible = false
  }
  destroy() {
    this.clear()
    this.container.destroy({ children: true, context: true })
    this.texture?.destroy(true)
  }
}
