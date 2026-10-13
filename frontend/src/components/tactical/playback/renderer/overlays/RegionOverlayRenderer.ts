import { Container, Graphics } from "pixi.js"

import type { ActivePlaybackOverlay } from "@/components/tactical/playback/core/overlayTimeline"
import type { RegionOverlay } from "@/components/tactical/playback/core/types"
import type { PlaybackOverlayRenderContext } from "@/components/tactical/playback/renderer/PlaybackOverlayRenderer"

export class RegionOverlayRenderer {
  readonly container = new Container()
  private readonly graphics = new Map<string, Graphics>()

  render(
    active: readonly ActivePlaybackOverlay[],
    context: PlaybackOverlayRenderContext
  ) {
    const regions = active.filter(
      (item): item is ActivePlaybackOverlay & { overlay: RegionOverlay } =>
        item.overlay.kind === "region"
    )
    const visible = new Set(regions.map(({ overlay }) => overlay.id))
    for (const item of regions) {
      const { overlay } = item
      let graphic = this.graphics.get(overlay.id)
      if (!graphic) {
        graphic = new Graphics()
        this.graphics.set(overlay.id, graphic)
        this.container.addChild(graphic)
      }
      drawRegion(graphic, overlay, context)
      const pulse = overlay.appearance?.pulse
        ? 0.82 + Math.sin(context.tick * Math.PI) * 0.18
        : 1
      graphic.alpha = item.opacity * pulse
      graphic.visible = true
    }
    this.hideAbsent(visible)
  }

  clear() {
    this.container.removeChildren().forEach((child) => child.destroy())
    this.graphics.clear()
  }

  private hideAbsent(visible: ReadonlySet<string>) {
    for (const [id, graphic] of this.graphics) {
      graphic.visible = visible.has(id)
    }
  }
}

function drawRegion(
  graphic: Graphics,
  overlay: RegionOverlay,
  context: PlaybackOverlayRenderContext
) {
  const color = context.toneColor(overlay.appearance?.tone)
  const geometry = overlay.geometry
  graphic.clear()
  if (geometry.shape === "rectangle") {
    graphic.rect(
      (geometry.x / 100) * context.width,
      (geometry.y / 100) * context.height,
      (geometry.width / 100) * context.width,
      (geometry.height / 100) * context.height
    )
  } else if (geometry.shape === "circle") {
    graphic.circle(
      (geometry.x / 100) * context.width,
      (geometry.y / 100) * context.height,
      (geometry.radius / 100) * Math.min(context.width, context.height)
    )
  } else if (geometry.points.length >= 3) {
    graphic.poly(
      geometry.points.map((point) => ({
        x: (point.x / 100) * context.width,
        y: (point.y / 100) * context.height,
      })),
      true
    )
  }
  graphic
    .fill({ color, alpha: overlay.appearance?.fillOpacity ?? 0.12 })
    .stroke({
      color,
      width: 1.5,
      alpha: overlay.appearance?.strokeOpacity ?? 0.55,
    })
}
