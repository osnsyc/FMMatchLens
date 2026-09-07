import {
  autoDetectRenderer,
  BlurFilter,
  Container,
  Sprite,
  type Renderer,
} from "pixi.js"

import {
  createDensityTexture,
  createHeatmapLutFilter,
  type DensityTexture,
} from "@/components/heatmap/heatmapTexture"
import type { HeatmapGrid } from "@/types/match"

const GRID_WIDTH = 20
const GRID_HEIGHT = 30
const CELL_COUNT = GRID_WIDTH * GRID_HEIGHT
const FILTER_RESOLUTION = 0.5

export type HeatmapColorScale = {
  maxCellShare: number
  sampleDivisor: number
  lutScale: number
}

/**
 * Persistent, demand-rendered GPU heatmap:
 * float density texture -> separable Gaussian blur -> LUT color mapping.
 *
 * This intentionally owns a bare Renderer instead of a Pixi Application:
 * Application always installs TickerPlugin, even when autoStart is disabled.
 */
export class PixiHeatmapRenderer {
  private readonly densityTexture: DensityTexture
  private readonly densitySprite: Sprite
  private readonly blurFilter: BlurFilter
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
    this.blurFilter = new BlurFilter({
      strength: this.blurStrength(),
      quality: 1,
      kernelSize: 7,
      resolution: FILTER_RESOLUTION,
    })
    this.blurFilter.repeatEdgePixels = true
    this.densitySprite.filters = [this.blurFilter, this.lutFilter]
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

  update(grid: HeatmapGrid, colorScale?: HeatmapColorScale) {
    let localMax = 0
    if (!colorScale) {
      for (const density of grid.density) localMax = Math.max(localMax, density)
    }
    const max = colorScale?.maxCellShare ?? localMax
    const divisor = colorScale?.sampleDivisor ?? 1
    const data = this.densityTexture.data

    for (let index = 0; index < CELL_COUNT; index += 1) {
      const density = grid.density[index] ?? 0
      const value =
        max > 0 && divisor > 0
          ? Math.max(0, Math.min(1, density / divisor / max))
          : 0
      const offset = index * 4
      data[offset] = value
      data[offset + 1] = value
      data[offset + 2] = value
      data[offset + 3] = 1
    }

    this.lutFilter.scale = colorScale?.lutScale ?? 1
    this.densityTexture.source.update()
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
    this.blurFilter.strength = this.blurStrength()
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
    this.blurFilter.destroy()
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

  private blurStrength() {
    return Math.max(8, Math.min(this.width, this.height) * 0.055)
  }

  private renderOnce() {
    this.renderer.render({ container: this.stage })
  }
}
