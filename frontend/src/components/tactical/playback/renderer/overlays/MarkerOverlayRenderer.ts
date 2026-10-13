import { Container, Graphics } from "pixi.js"

import type { ActivePlaybackOverlay } from "@/components/tactical/playback/core/overlayTimeline"
import type { MarkerOverlay } from "@/components/tactical/playback/core/types"
import type { PlaybackOverlayRenderContext } from "@/components/tactical/playback/renderer/PlaybackOverlayRenderer"

export class MarkerOverlayRenderer {
  readonly container = new Container()
  private readonly graphics = new Map<string, Graphics>()

  render(
    active: readonly ActivePlaybackOverlay[],
    context: PlaybackOverlayRenderContext
  ) {
    const markers = active.filter(
      (item): item is ActivePlaybackOverlay & { overlay: MarkerOverlay } =>
        item.overlay.kind === "marker"
    )
    const visible = new Set<string>()
    for (const item of markers) {
      const position = context.resolveAnchor(item.overlay.anchor)
      if (!position) continue
      visible.add(item.overlay.id)
      let graphic = this.graphics.get(item.overlay.id)
      if (!graphic) {
        graphic = new Graphics()
        this.graphics.set(item.overlay.id, graphic)
        this.container.addChild(graphic)
      }
      const size = item.overlay.size ?? 15
      const color = context.toneColor(item.overlay.appearance?.tone)
      graphic.clear()
      if (item.overlay.shape === "diamond") {
        graphic.poly(
          [
            { x: 0, y: -size },
            { x: size, y: 0 },
            { x: 0, y: size },
            { x: -size, y: 0 },
          ],
          true
        )
      } else {
        graphic.circle(0, 0, size)
      }
      if (item.overlay.shape === "circle") {
        graphic.fill({ color, alpha: 0.24 }).stroke({ color, width: 2 })
      } else {
        graphic.stroke({ color, width: 2.5, alpha: 0.9 })
      }
      graphic.position.set(position.x, position.y)
      graphic.alpha = item.opacity
      const pulse = item.overlay.appearance?.pulse
        ? 1 + Math.sin(context.tick * Math.PI) * 0.08
        : 1
      graphic.scale.set(item.scale * pulse)
      graphic.visible = true
    }
    for (const [id, graphic] of this.graphics) {
      graphic.visible = visible.has(id)
    }
  }

  clear() {
    this.container.removeChildren().forEach((child) => child.destroy())
    this.graphics.clear()
  }
}
