import {
  autoDetectRenderer,
  BitmapText,
  Container,
  Graphics,
  GraphicsContext,
  type Renderer,
} from "pixi.js"

import {
  buildShotChainRenderPoints,
  deduplicateTrajectoryPoints,
  metricById,
  renderPointForEvent,
  type MarkerVariant,
  type Shape,
  type ShotChain,
  type TacticalRenderPoint,
  type TacticalScene,
} from "@/components/tactical/tacticalScene"
import type { MatchPlayer, TeamSide } from "@/types/match"

export type TacticalAppearance = {
  homeColor: string
  awayColor: string
  showNumbers: boolean
}

export type TacticalHit = {
  point: TacticalRenderPoint
  historical: boolean
}

type ResolvedAppearance = {
  homeColor: number
  awayColor: number
  background: number
  important: number
  contrast: number
  foreground: number
}

type MarkerRecord = {
  point: TacticalRenderPoint
  container: Container
  graphic: Graphics
  label?: BitmapText
  labelColor?: number
  labelFontSize?: number
  labelValue?: string
  geometryKey: string
  historical: boolean
}

const GRID_SIZE = 20
const BASE_MARKER_SIZE = 20
const HIT_DISTANCE_EPSILON = 0.001

/** Persistent, demand-rendered tactical scene with incremental event diffs. */
export class PixiTacticalRenderer {
  private readonly renderer: Renderer
  private readonly stage = new Container()
  private readonly trajectoryLayer = new Container()
  private readonly shotChainLayer = new Container()
  private readonly markerLayer = new Container()
  private readonly selectionLayer = new Container()
  private readonly chainMarkerLayer = new Container()
  private readonly selectionRing = new Graphics()
  private readonly markerByEventId = new Map<string, MarkerRecord>()
  private readonly trajectoryByEventId = new Map<string, Graphics>()
  private readonly chainMarkerByEventId = new Map<string, MarkerRecord>()
  private readonly markerContextByKey = new Map<string, GraphicsContext>()
  private readonly spatialGrid = new Map<number, MarkerRecord[]>()
  private visibleEventIds = new Set<string>()
  private readonly colorProbe: HTMLSpanElement
  private readonly colorCanvasContext: CanvasRenderingContext2D
  private width: number
  private height: number
  private players = new Map<number, MatchPlayer>()
  private appearance: TacticalAppearance
  private resolvedAppearance: ResolvedAppearance
  private selectedShotId: string | null = null
  private shotChains: readonly ShotChain[] = []
  private hoveredEventId: string | null = null
  private chainSignature = ""

  private constructor(
    renderer: Renderer,
    host: HTMLDivElement,
    width: number,
    height: number,
    appearance: TacticalAppearance
  ) {
    this.renderer = renderer
    this.width = width
    this.height = height
    this.appearance = appearance

    this.colorProbe = document.createElement("span")
    this.colorProbe.className = "pointer-events-none absolute size-0 opacity-0"
    this.colorProbe.setAttribute("aria-hidden", "true")
    host.appendChild(this.colorProbe)
    const colorCanvas = document.createElement("canvas")
    colorCanvas.width = 1
    colorCanvas.height = 1
    const context = colorCanvas.getContext("2d", { willReadFrequently: true })
    if (!context) throw new Error("Could not create tactical color resolver")
    this.colorCanvasContext = context
    this.resolvedAppearance = this.resolveAppearance(appearance)

    this.trajectoryLayer.eventMode = "none"
    this.trajectoryLayer.interactiveChildren = false
    this.shotChainLayer.eventMode = "none"
    this.shotChainLayer.interactiveChildren = false
    this.markerLayer.eventMode = "none"
    this.markerLayer.interactiveChildren = false
    this.markerLayer.sortableChildren = true
    this.selectionLayer.eventMode = "none"
    this.selectionLayer.interactiveChildren = false
    this.chainMarkerLayer.sortableChildren = true
    this.selectionLayer.addChild(this.selectionRing, this.chainMarkerLayer)
    this.stage.addChild(
      this.trajectoryLayer,
      this.shotChainLayer,
      this.markerLayer,
      this.selectionLayer
    )
  }

  static async create(
    host: HTMLDivElement,
    width: number,
    height: number,
    appearance: TacticalAppearance
  ) {
    const renderer = await autoDetectRenderer({
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
      backgroundAlpha: 0,
      antialias: true,
      preference: ["webgl"],
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    })
    renderer.canvas.className = "pointer-events-none block size-full"
    renderer.canvas.setAttribute("aria-hidden", "true")
    host.appendChild(renderer.canvas)
    return new PixiTacticalRenderer(renderer, host, width, height, appearance)
  }

  updateEvents(scene: TacticalScene) {
    const nextVisibleIds = new Set<string>()
    for (const point of scene.points) {
      nextVisibleIds.add(point.id)
      const current = this.markerByEventId.get(point.id)
      if (!current) {
        const record = this.createMarker(point, false)
        this.markerByEventId.set(point.id, record)
        this.markerLayer.addChild(record.container)
        this.syncTrajectory(point)
      } else {
        const nextKey = this.markerGeometryKey(point)
        const geometryChanged = current.geometryKey !== nextKey
        const trajectoryChanged = !sameTrajectoryGeometry(current.point, point)
        current.point = point
        current.container.visible = true
        if (geometryChanged) {
          current.geometryKey = nextKey
          current.graphic.context = this.markerContext(point)
        }
        this.positionMarker(current)
        this.updateMarkerLabel(current)
        if (trajectoryChanged) this.syncTrajectory(point)
      }
    }

    this.visibleEventIds = nextVisibleIds

    for (const [id, record] of this.markerByEventId) {
      if (nextVisibleIds.has(id)) continue
      if (scene.sourceEventIds.has(id)) {
        record.container.visible = false
        const trajectory = this.trajectoryByEventId.get(id)
        if (trajectory) trajectory.visible = false
      } else {
        this.destroyMarker(this.markerByEventId, id)
        this.destroyTrajectory(id)
      }
    }

    this.applySelectionVisibility()
    this.drawSelectionRing()
    this.rebuildSpatialGrid()
    this.renderOnce()
  }

  updatePlayers(players: ReadonlyMap<number, MatchPlayer>) {
    const changedPlayerIds = new Set<number>()
    for (const [id, player] of players) {
      if (this.players.get(id)?.shirtNumber !== player.shirtNumber) {
        changedPlayerIds.add(id)
      }
    }
    for (const id of this.players.keys()) {
      if (!players.has(id)) changedPlayerIds.add(id)
    }
    this.players = new Map(players)
    if (changedPlayerIds.size === 0) return
    for (const record of this.allMarkers()) {
      if (changedPlayerIds.has(record.point.playerId))
        this.updateMarkerLabel(record)
    }
    this.renderOnce()
  }

  updateAppearance(appearance: TacticalAppearance) {
    this.appearance = appearance
    this.resolvedAppearance = this.resolveAppearance(appearance)
    const oldContexts = [...this.markerContextByKey.values()]
    this.markerContextByKey.clear()

    for (const record of this.allMarkers()) {
      record.geometryKey = this.markerGeometryKey(record.point)
      record.graphic.context = this.markerContext(record.point)
      this.updateMarkerLabel(record)
    }
    for (const context of oldContexts) context.destroy()
    for (const point of [...this.markerByEventId.values()].map(
      (record) => record.point
    )) {
      if (this.trajectoryByEventId.has(point.id)) this.syncTrajectory(point)
    }
    this.drawSelectionRing()
    this.drawShotChains(this.shotChains)
    this.renderOnce()
  }

  updateSelection(selectedShotId: string | null, chains: readonly ShotChain[]) {
    this.selectedShotId = selectedShotId
    this.shotChains = chains
    const signature = shotChainSignature(chains)
    if (signature !== this.chainSignature) {
      this.chainSignature = signature
      this.syncChainMarkers(buildShotChainRenderPoints(chains))
      this.drawShotChains(chains)
    }
    this.applySelectionVisibility()
    this.drawSelectionRing()
    this.rebuildSpatialGrid()
    this.renderOnce()
  }

  setHovered(eventId: string | null) {
    if (eventId === this.hoveredEventId) return
    const previous = this.findMarker(this.hoveredEventId)
    if (previous) this.setMarkerEmphasis(previous, false)
    this.hoveredEventId = eventId
    const next = this.findMarker(eventId)
    if (next) this.setMarkerEmphasis(next, true)
    this.renderOnce()
  }

  hitTest(localX: number, localY: number): TacticalHit | null {
    if (this.width <= 0 || this.height <= 0) return null
    const normalizedX = (localX / this.width) * 100
    const normalizedY = (localY / this.height) * 100
    const cellX = clamp(
      Math.floor(normalizedX / (100 / GRID_SIZE)),
      0,
      GRID_SIZE - 1
    )
    const cellY = clamp(
      Math.floor(normalizedY / (100 / GRID_SIZE)),
      0,
      GRID_SIZE - 1
    )
    let best: MarkerRecord | undefined
    let bestDistance = Number.POSITIVE_INFINITY

    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        const x = cellX + offsetX
        const y = cellY + offsetY
        if (x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) continue
        for (const record of this.spatialGrid.get(y * GRID_SIZE + x) ?? []) {
          const dx = localX - (record.point.x / 100) * this.width
          const dy = localY - (record.point.y / 100) * this.height
          const distance = Math.hypot(dx, dy)
          const inHitArea = distance <= record.point.size * 0.75
          const closer = distance < bestDistance - HIT_DISTANCE_EPSILON
          const sameDistance =
            Math.abs(distance - bestDistance) <= HIT_DISTANCE_EPSILON
          if (
            inHitArea &&
            (!best ||
              closer ||
              (sameDistance && this.isMarkerPaintedAbove(record, best)))
          ) {
            best = record
            bestDistance = distance
          }
        }
      }
    }
    return best ? { point: best.point, historical: best.historical } : null
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
    for (const record of this.allMarkers()) this.positionMarker(record)
    for (const record of this.markerByEventId.values()) {
      if (this.trajectoryByEventId.has(record.point.id))
        this.syncTrajectory(record.point)
    }
    this.drawShotChains(this.shotChains)
    this.drawSelectionRing()
    this.rebuildSpatialGrid()
    this.renderOnce()
  }

  destroy() {
    for (const context of this.markerContextByKey.values()) context.destroy()
    this.markerContextByKey.clear()
    this.markerByEventId.clear()
    this.trajectoryByEventId.clear()
    this.chainMarkerByEventId.clear()
    this.spatialGrid.clear()
    this.shotChains = []
    this.stage.destroy({ children: true })
    this.renderer.destroy({ removeView: true })
    this.colorProbe.remove()
  }

  private *allMarkers() {
    yield* this.markerByEventId.values()
    yield* this.chainMarkerByEventId.values()
  }

  private createMarker(
    point: TacticalRenderPoint,
    historical: boolean
  ): MarkerRecord {
    const container = new Container()
    const graphic = new Graphics({ context: this.markerContext(point) })
    container.addChild(graphic)
    const record: MarkerRecord = {
      point,
      container,
      graphic,
      geometryKey: this.markerGeometryKey(point),
      historical,
    }
    this.positionMarker(record)
    this.updateMarkerLabel(record)
    return record
  }

  private destroyMarker(map: Map<string, MarkerRecord>, id: string) {
    const record = map.get(id)
    if (!record) return
    record.container.removeFromParent()
    record.container.destroy({ children: true })
    map.delete(id)
  }

  private positionMarker(record: MarkerRecord) {
    record.container.position.set(
      (record.point.x / 100) * this.width,
      (record.point.y / 100) * this.height
    )
    const scale = record.point.size / BASE_MARKER_SIZE
    const emphasized = record.point.id === this.hoveredEventId
    record.container.scale.set(emphasized ? scale * 1.25 : scale)
    record.container.zIndex = emphasized ? 10 : 0
  }

  private setMarkerEmphasis(record: MarkerRecord, emphasized: boolean) {
    const scale = record.point.size / BASE_MARKER_SIZE
    record.container.scale.set(emphasized ? scale * 1.25 : scale)
    record.container.zIndex = emphasized ? 10 : 0
  }

  private updateMarkerLabel(record: MarkerRecord) {
    const shirtNumber = this.players.get(record.point.playerId)?.shirtNumber
    if (
      !this.appearance.showNumbers ||
      shirtNumber == null ||
      record.point.size < 11
    ) {
      if (record.label) {
        record.label.removeFromParent()
        record.label.destroy()
        record.label = undefined
        record.labelColor = undefined
        record.labelFontSize = undefined
        record.labelValue = undefined
      }
      return
    }

    const color = isHollow(record.point.variant)
      ? this.teamColor(record.point.team)
      : this.resolvedAppearance.foreground
    const value = String(shirtNumber)
    const fontSize = (7 * BASE_MARKER_SIZE) / record.point.size
    if (!record.label) {
      record.label = new BitmapText({
        text: value,
        style: {
          fontFamily: "Arial",
          fontSize,
          fontWeight: "bold",
          fill: color,
          align: "center",
        },
      })
      record.label.anchor.set(0.5)
      record.container.addChild(record.label)
    } else {
      if (record.labelValue !== value) record.label.text = value
      if (record.labelColor !== color) record.label.style.fill = color
      if (record.labelFontSize !== fontSize)
        record.label.style.fontSize = fontSize
    }
    record.labelValue = value
    record.labelColor = color
    record.labelFontSize = fontSize
  }

  private markerGeometryKey(point: TacticalRenderPoint) {
    const colors = this.resolvedAppearance
    return [
      point.shape,
      point.variant,
      this.teamColor(point.team),
      colors.background,
      colors.important,
      colors.contrast,
    ].join(":")
  }

  private markerContext(point: TacticalRenderPoint) {
    const key = this.markerGeometryKey(point)
    const cached = this.markerContextByKey.get(key)
    if (cached) return cached
    const context = createMarkerContext(
      point.shape,
      point.variant,
      this.teamColor(point.team),
      this.resolvedAppearance
    )
    this.markerContextByKey.set(key, context)
    return context
  }

  private syncTrajectory(point: TacticalRenderPoint) {
    const shouldDraw = hasVisibleTrajectory(point)
    let graphic = this.trajectoryByEventId.get(point.id)
    if (!shouldDraw) {
      if (graphic) this.destroyTrajectory(point.id)
      return
    }
    if (!graphic) {
      graphic = new Graphics()
      this.trajectoryByEventId.set(point.id, graphic)
      this.trajectoryLayer.addChild(graphic)
    }
    graphic.clear()
    drawEventTrajectory(
      graphic,
      point,
      this.teamColor(point.team),
      this.width,
      this.height,
      false
    )
    graphic.visible =
      this.visibleEventIds.has(point.id) &&
      (this.selectedShotId == null || this.selectedShotId === point.id)
  }

  private destroyTrajectory(id: string) {
    const graphic = this.trajectoryByEventId.get(id)
    if (!graphic) return
    graphic.removeFromParent()
    graphic.destroy()
    this.trajectoryByEventId.delete(id)
  }

  private syncChainMarkers(points: readonly TacticalRenderPoint[]) {
    const nextIds = new Set(points.map((point) => point.id))
    for (const point of points) {
      const current = this.chainMarkerByEventId.get(point.id)
      if (!current) {
        const record = this.createMarker(point, true)
        this.chainMarkerByEventId.set(point.id, record)
        this.chainMarkerLayer.addChild(record.container)
      } else {
        current.point = point
        const nextKey = this.markerGeometryKey(point)
        if (nextKey !== current.geometryKey) {
          current.geometryKey = nextKey
          current.graphic.context = this.markerContext(point)
        }
        this.positionMarker(current)
        this.updateMarkerLabel(current)
      }
    }
    for (const id of [...this.chainMarkerByEventId.keys()]) {
      if (!nextIds.has(id)) this.destroyMarker(this.chainMarkerByEventId, id)
    }
  }

  private applySelectionVisibility() {
    for (const [id, record] of this.markerByEventId) {
      record.container.visible =
        this.visibleEventIds.has(id) &&
        (this.selectedShotId == null || id === this.selectedShotId)
      const trajectory = this.trajectoryByEventId.get(id)
      if (trajectory) trajectory.visible = record.container.visible
    }
    this.chainMarkerLayer.visible = this.selectedShotId != null
    this.shotChainLayer.visible = this.selectedShotId != null
    this.selectionRing.visible = this.selectedShotId != null
  }

  private drawSelectionRing() {
    this.selectionRing.clear()
    if (!this.selectedShotId) return
    const record = this.markerByEventId.get(this.selectedShotId)
    if (!record) return
    const radius = record.point.size * 0.72
    this.selectionRing
      .circle(
        (record.point.x / 100) * this.width,
        (record.point.y / 100) * this.height,
        radius
      )
      .stroke({
        width: 1.5,
        color: this.resolvedAppearance.important,
        alpha: 0.9,
      })
  }

  private drawShotChains(chains: readonly ShotChain[]) {
    this.shotChainLayer.removeChildren().forEach((child) => child.destroy())
    for (const chain of chains) {
      const graphic = new Graphics()
      drawShotChain(
        graphic,
        chain,
        this.teamColor(chain.team),
        this.width,
        this.height
      )
      this.shotChainLayer.addChild(graphic)
    }
  }

  private rebuildSpatialGrid() {
    this.spatialGrid.clear()
    for (const record of this.allMarkers()) {
      if (!record.container.visible) continue
      const cellX = clamp(
        Math.floor(record.point.x / (100 / GRID_SIZE)),
        0,
        GRID_SIZE - 1
      )
      const cellY = clamp(
        Math.floor(record.point.y / (100 / GRID_SIZE)),
        0,
        GRID_SIZE - 1
      )
      const key = cellY * GRID_SIZE + cellX
      const bucket = this.spatialGrid.get(key)
      if (bucket) bucket.push(record)
      else this.spatialGrid.set(key, [record])
    }
  }

  private findMarker(id: string | null) {
    if (!id) return undefined
    return this.chainMarkerByEventId.get(id) ?? this.markerByEventId.get(id)
  }

  private isMarkerPaintedAbove(candidate: MarkerRecord, current: MarkerRecord) {
    // selectionLayer is added after markerLayer, so historical shot-chain
    // markers always paint above regular event markers.
    if (candidate.historical !== current.historical) return candidate.historical
    if (candidate.container.zIndex !== current.container.zIndex) {
      return candidate.container.zIndex > current.container.zIndex
    }
    const layer = candidate.historical
      ? this.chainMarkerLayer
      : this.markerLayer
    return (
      layer.getChildIndex(candidate.container) >
      layer.getChildIndex(current.container)
    )
  }

  private teamColor(team: TeamSide) {
    return team === "home"
      ? this.resolvedAppearance.homeColor
      : this.resolvedAppearance.awayColor
  }

  private resolveAppearance(
    appearance: TacticalAppearance
  ): ResolvedAppearance {
    return {
      homeColor: this.resolveCssColor(appearance.homeColor, 0x4f6fd8),
      awayColor: this.resolveCssColor(appearance.awayColor, 0xdf3f65),
      background: this.resolveCssColor("var(--background)", 0x0a0f1e),
      important: this.resolveCssColor("var(--important-event)", 0xf6c453),
      contrast: this.resolveCssColor("var(--event-contrast)", 0xf4f0ff),
      foreground: this.resolveCssColor(
        "var(--event-marker-foreground)",
        0x0a0f1e
      ),
    }
  }

  private resolveCssColor(value: string, fallback: number) {
    this.colorProbe.style.color = ""
    this.colorProbe.style.color = value
    const computed = getComputedStyle(this.colorProbe).color
    if (!computed) return fallback
    const context = this.colorCanvasContext
    context.clearRect(0, 0, 1, 1)
    context.fillStyle = "#000000"
    context.fillStyle = computed
    context.fillRect(0, 0, 1, 1)
    const [red, green, blue] = context.getImageData(0, 0, 1, 1).data
    return (red << 16) | (green << 8) | blue
  }

  private renderOnce() {
    this.renderer.render({ container: this.stage })
  }
}

function createMarkerContext(
  shape: Shape,
  variant: MarkerVariant,
  teamColor: number,
  appearance: ResolvedAppearance
) {
  const context = new GraphicsContext()
  if (variant === "double") {
    drawShape(context, shape, 1)
    context.stroke({ width: 1.8, color: appearance.important, join: "round" })
    drawShape(context, shape, 0.58)
    context.fill({ color: teamColor })
    context.stroke({ width: 1.2, color: appearance.foreground, join: "round" })
    return context
  }

  const fill = variant !== "outline" && variant !== "dashed"
  const strokeColor =
    variant === "important"
      ? appearance.important
      : variant === "contrast"
        ? appearance.contrast
        : variant === "outline" || variant === "dashed"
          ? teamColor
          : appearance.background
  const strokeWidth =
    variant === "outline"
      ? 2.2
      : variant === "important" ||
          variant === "dashed" ||
          variant === "contrast"
        ? 2
        : 1.2

  if (variant === "dashed") {
    const outline = shapeOutline(shape)
    drawDashedPolyline(context, outline, true, 3, 1.8)
    context.stroke({
      width: strokeWidth,
      color: strokeColor,
      join: "round",
      cap: "round",
    })
    return context
  }
  drawShape(context, shape, 1)
  if (fill) context.fill({ color: teamColor })
  context.stroke({ width: strokeWidth, color: strokeColor, join: "round" })
  return context
}

function drawShape(context: GraphicsContext, shape: Shape, scale: number) {
  const scaled = (value: number) => value * scale
  switch (shape) {
    case "square":
      context.roundRect(
        scaled(-7),
        scaled(-7),
        scaled(14),
        scaled(14),
        scaled(2)
      )
      break
    case "circle":
      context.circle(0, 0, scaled(7))
      break
    default:
      context.poly(
        shapeOutline(shape).map((point) => ({
          x: scaled(point.x),
          y: scaled(point.y),
        })),
        true
      )
  }
}

function shapeOutline(shape: Shape) {
  switch (shape) {
    case "square":
      return [
        { x: -7, y: -7 },
        { x: 7, y: -7 },
        { x: 7, y: 7 },
        { x: -7, y: 7 },
      ]
    case "circle":
      return Array.from({ length: 32 }, (_, index) => {
        const angle = (index / 32) * Math.PI * 2
        return { x: Math.cos(angle) * 7, y: Math.sin(angle) * 7 }
      })
    case "triangle":
      return [
        { x: 0, y: -7.5 },
        { x: 8, y: 7 },
        { x: -8, y: 7 },
      ]
    case "triangle-down":
      return [
        { x: -8, y: -7 },
        { x: 8, y: -7 },
        { x: 0, y: 7.5 },
      ]
    case "pentagon":
      return [
        { x: 0, y: -8 },
        { x: 8, y: -2.2 },
        { x: 5, y: 7 },
        { x: -5, y: 7 },
        { x: -8, y: -2.2 },
      ]
    case "diamond":
      return [
        { x: 0, y: -8 },
        { x: 8, y: 0 },
        { x: 0, y: 8 },
        { x: -8, y: 0 },
      ]
  }
}

function hasVisibleTrajectory(point: TacticalRenderPoint) {
  if (!point.showTrajectory || point.endX == null || point.endY == null)
    return false
  if (!Number.isFinite(point.endX) || !Number.isFinite(point.endY)) return false
  if (
    point.metricId === "dribblesCompleted" &&
    point.trajectoryPoints?.length
  ) {
    const trajectory = deduplicateTrajectoryPoints(point.trajectoryPoints)
    return trajectory
      .slice(1)
      .some(
        (current, index) =>
          Math.hypot(
            current.x - trajectory[index].x,
            current.y - trajectory[index].y
          ) >= 0.01
      )
  }
  const startX = point.trajectoryStartX ?? point.x
  const startY = point.trajectoryStartY ?? point.y
  return Math.hypot(point.endX - startX, point.endY - startY) >= 0.5
}

function drawEventTrajectory(
  graphic: Graphics,
  point: TacticalRenderPoint,
  color: number,
  width: number,
  height: number,
  chain: boolean
) {
  if (point.endX == null || point.endY == null) return
  if (point.metricId === "dribblesCompleted") {
    drawDribble(
      graphic,
      point,
      color,
      width,
      height,
      chain ? 1.25 : 1.5,
      chain ? 0.62 : 0.78,
      chain ? 1.1 : 1.25,
      chain ? 0.52 : 0.58
    )
    return
  }
  const start = toPixels(
    point.trajectoryStartX ?? point.x,
    point.trajectoryStartY ?? point.y,
    width,
    height
  )
  const end = toPixels(point.endX, point.endY, width, height)
  const dashed =
    !chain && (point.variant === "outline" || point.variant === "dashed")
  if (dashed) {
    drawDashedPolyline(graphic, [start, end], false, 3, 2)
  } else {
    graphic.moveTo(start.x, start.y).lineTo(end.x, end.y)
  }
  graphic.stroke({
    width: chain ? 1.25 : 1.5,
    color,
    alpha: chain ? 0.48 : 0.72,
    cap: "round",
  })
  drawArrowHead(graphic, start, end, color, chain ? 0.48 : 0.72, chain ? 4 : 5)
}

function drawDribble(
  graphic: Graphics,
  point: TacticalRenderPoint,
  color: number,
  width: number,
  height: number,
  strokeWidth: number,
  opacity: number,
  connectorWidth: number,
  connectorOpacity: number
) {
  const startX = point.trajectoryStartX ?? point.endX ?? point.x
  const startY = point.trajectoryStartY ?? point.endY ?? point.y
  const normalized = deduplicateTrajectoryPoints(
    point.trajectoryPoints?.length
      ? point.trajectoryPoints
      : [
          { x: startX, y: startY },
          { x: point.endX ?? point.x, y: point.endY ?? point.y },
        ]
  )
  if (normalized.length < 2) return
  const points = normalized.map((value) =>
    toPixels(value.x, value.y, width, height)
  )
  const first = points[0]
  if (point.anchorX != null && point.anchorY != null) {
    const anchor = toPixels(point.anchorX, point.anchorY, width, height)
    if (
      Math.hypot(
        normalized[0].x - point.anchorX,
        normalized[0].y - point.anchorY
      ) >= 0.25
    ) {
      drawDashedPolyline(graphic, [anchor, first], false, 3, 2)
      graphic.stroke({
        width: connectorWidth,
        color,
        alpha: connectorOpacity,
        cap: "round",
      })
    }
  }
  graphic.moveTo(first.x, first.y)
  if (points.length === 2) {
    graphic.lineTo(points[1].x, points[1].y)
  } else {
    for (let index = 0; index < points.length - 1; index += 1) {
      const before = points[Math.max(0, index - 1)]
      const current = points[index]
      const next = points[index + 1]
      const after = points[Math.min(points.length - 1, index + 2)]
      graphic.bezierCurveTo(
        current.x + (next.x - before.x) / 6,
        current.y + (next.y - before.y) / 6,
        next.x - (after.x - current.x) / 6,
        next.y - (after.y - current.y) / 6,
        next.x,
        next.y
      )
    }
  }
  graphic.stroke({
    width: strokeWidth,
    color,
    alpha: opacity,
    cap: "round",
    join: "round",
  })
  drawArrowHead(graphic, points.at(-2)!, points.at(-1)!, color, opacity, 5)
}

function drawShotChain(
  graphic: Graphics,
  chain: ShotChain,
  color: number,
  width: number,
  height: number
) {
  const points = buildShotChainRenderPoints([chain])
  const shot = chain.events.at(-1)
  if (!shot) return
  const metric = metricById.get(shot.metricId)
  const shotMetric = metric ? renderPointForEvent(shot, metric) : undefined
  const allPoints = [...points]
  if (shotMetric) allPoints.push(shotMetric)
  drawRenderPointChain(graphic, allPoints, color, width, height)
}

function drawRenderPointChain(
  graphic: Graphics,
  points: readonly TacticalRenderPoint[],
  color: number,
  width: number,
  height: number
) {
  for (let index = 0; index < points.length - 1; index += 1) {
    const point = points[index]
    if (point.endX != null && point.endY != null) {
      drawEventTrajectory(graphic, point, color, width, height, true)
    }
    const next = points[index + 1]
    const fromX = point.endX ?? point.x
    const fromY = point.endY ?? point.y
    const toX = next.trajectoryStartX ?? next.x
    const toY = next.trajectoryStartY ?? next.y
    if (Math.hypot(toX - fromX, toY - fromY) < 0.5) continue
    const from = toPixels(fromX, fromY, width, height)
    const to = toPixels(toX, toY, width, height)
    drawDashedPolyline(graphic, [from, to], false, 4, 3)
    graphic.stroke({ width: 1.25, color, alpha: 0.58, cap: "round" })
    drawArrowHead(graphic, from, to, color, 0.58, 4)
  }
}

function drawArrowHead(
  graphic: Graphics,
  start: { x: number; y: number },
  end: { x: number; y: number },
  color: number,
  alpha: number,
  size: number
) {
  const angle = Math.atan2(end.y - start.y, end.x - start.x)
  const wing = size * 0.65
  graphic
    .moveTo(end.x, end.y)
    .lineTo(
      end.x - size * Math.cos(angle) + wing * Math.sin(angle),
      end.y - size * Math.sin(angle) - wing * Math.cos(angle)
    )
    .lineTo(
      end.x - size * Math.cos(angle) - wing * Math.sin(angle),
      end.y - size * Math.sin(angle) + wing * Math.cos(angle)
    )
    .closePath()
    .fill({ color, alpha })
}

function drawDashedPolyline(
  target: Graphics | GraphicsContext,
  points: readonly { x: number; y: number }[],
  closed: boolean,
  dashLength: number,
  gapLength: number
) {
  if (points.length < 2) return
  const path = closed ? [...points, points[0]] : points
  let drawing = true
  let remaining = dashLength
  target.moveTo(path[0].x, path[0].y)
  for (let index = 1; index < path.length; index += 1) {
    const from = path[index - 1]
    const to = path[index]
    const length = Math.hypot(to.x - from.x, to.y - from.y)
    if (length === 0) continue
    let travelled = 0
    while (travelled < length) {
      const step = Math.min(remaining, length - travelled)
      travelled += step
      const x = from.x + ((to.x - from.x) * travelled) / length
      const y = from.y + ((to.y - from.y) * travelled) / length
      if (drawing) target.lineTo(x, y)
      else target.moveTo(x, y)
      remaining -= step
      if (remaining <= 0.0001) {
        drawing = !drawing
        remaining = drawing ? dashLength : gapLength
      }
    }
  }
}

function sameTrajectoryGeometry(
  left: TacticalRenderPoint,
  right: TacticalRenderPoint
) {
  return (
    left.metricId === right.metricId &&
    left.variant === right.variant &&
    left.x === right.x &&
    left.y === right.y &&
    left.anchorX === right.anchorX &&
    left.anchorY === right.anchorY &&
    left.trajectoryStartX === right.trajectoryStartX &&
    left.trajectoryStartY === right.trajectoryStartY &&
    left.endX === right.endX &&
    left.endY === right.endY &&
    left.trajectoryPoints === right.trajectoryPoints &&
    left.showTrajectory === right.showTrajectory
  )
}

function shotChainSignature(chains: readonly ShotChain[]) {
  return chains
    .map((chain) =>
      [
        chain.id,
        ...chain.events.flatMap((event) => [
          event.id,
          event.x,
          event.y,
          event.anchorX ?? "",
          event.anchorY ?? "",
          event.trajectoryStartX ?? "",
          event.trajectoryStartY ?? "",
          event.endX ?? "",
          event.endY ?? "",
          ...(event.trajectoryPoints?.flatMap((point) => [point.x, point.y]) ??
            []),
        ]),
      ].join(":")
    )
    .join("|")
}

function isHollow(variant: MarkerVariant) {
  return variant === "outline" || variant === "dashed"
}

function toPixels(x: number, y: number, width: number, height: number) {
  return { x: (x / 100) * width, y: (y / 100) * height }
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
}
