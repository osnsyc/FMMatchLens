import { autoDetectRenderer, Container, Sprite, type Renderer } from "pixi.js"

import {
  createDensityTexture,
  createHeatmapLutFilter,
  type DensityTexture,
  type HeatmapToneMapping,
} from "@/components/heatmap/heatmapTexture"
import {
  type HeatmapRenderData,
  HEATMAP_GRID_HEIGHT,
  HEATMAP_GRID_WIDTH,
} from "@/api/heatmap"

const GRID_WIDTH = HEATMAP_GRID_WIDTH
const GRID_HEIGHT = HEATMAP_GRID_HEIGHT
const CELL_COUNT = GRID_WIDTH * GRID_HEIGHT

/**
 * Persistent, demand-rendered GPU heatmap:
 * Grid-space Gaussian blur and normalization -> float texture -> LUT mapping.
 * Resizing changes only interpolation, never smoothing or the color scale.
 *
 * This intentionally owns a bare Renderer instead of a Pixi Application:
 * Application always installs TickerPlugin, even when autoStart is disabled.
 */
export class PixiHeatmapRenderer {
  private readonly densityTexture: DensityTexture
  private readonly densitySprite: Sprite
  private readonly lutFilter = createHeatmapLutFilter()
  private width: number
  private height: number
  private readonly renderer: Renderer
  private readonly stage: Container

  private constructor(
    renderer: Renderer,
    stage: Container,
    width: number,
    height: number
  ) {
    this.renderer = renderer
    this.stage = stage
    this.width = width
    this.height = height
    this.densityTexture = createDensityTexture(GRID_WIDTH, GRID_HEIGHT)
    this.densitySprite = new Sprite(this.densityTexture.texture)
    this.densitySprite.filters = [this.lutFilter]
    this.resizeSprite()
    this.stage.addChild(this.densitySprite)
  }

  static async create(host: HTMLDivElement, width: number, height: number) {
    const renderer = await autoDetectRenderer({
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
      backgroundAlpha: 0,
      antialias: false,
      preference: ["webgl"],
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    })
    const stage = new Container()
    renderer.canvas.className = "block size-full"
    renderer.canvas.setAttribute("aria-hidden", "true")
    host.appendChild(renderer.canvas)
    return new PixiHeatmapRenderer(renderer, stage, width, height)
  }

  update({ density }: HeatmapRenderData) {
    const data = this.densityTexture.data

    for (let index = 0; index < CELL_COUNT; index += 1) {
      const value = density[index] ?? 0
      const offset = index * 4
      data[offset] = value
      data[offset + 1] = value
      data[offset + 2] = value
      data[offset + 3] = 1
    }

    this.densityTexture.source.update()
    this.renderOnce()
  }

  updateLut(stops: readonly number[][]) {
    this.lutFilter.setStops(stops)
    this.renderOnce()
  }

  updateToneMapping(toneMapping: Partial<HeatmapToneMapping>) {
    this.lutFilter.setToneMapping(toneMapping)
    this.renderOnce()
  }

  resize(width: number, height: number) {
    const nextWidth = Math.max(1, Math.round(width))
    const nextHeight = Math.max(1, Math.round(height))
    if (
      nextWidth === Math.round(this.width) &&
      nextHeight === Math.round(this.height)
    )
      return

    this.width = width
    this.height = height
    this.renderer.resize(nextWidth, nextHeight)
    this.resizeSprite()
    this.renderOnce()
  }

  clear() {
    this.densityTexture.data.fill(0)
    this.densityTexture.source.update()
    this.renderOnce()
  }

  destroy() {
    this.stage.removeChild(this.densitySprite)
    this.densitySprite.filters = null
    this.densitySprite.destroy()
    this.lutFilter.destroy()
    this.densityTexture.texture.destroy(true)
    this.stage.destroy({ children: true })
    this.renderer.destroy({ removeView: true })
  }

  private resizeSprite() {
    this.densitySprite.width = Math.max(1, this.width)
    this.densitySprite.height = Math.max(1, this.height)
    this.densitySprite.filterArea = this.renderer.screen
  }

  private renderOnce() {
    this.renderer.render({ container: this.stage })
  }
}
