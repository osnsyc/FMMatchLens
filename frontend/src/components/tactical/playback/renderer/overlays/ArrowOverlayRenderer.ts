import { Container, Graphics } from "pixi.js"

import type { ActivePlaybackOverlay } from "@/components/tactical/playback/core/overlayTimeline"
import type { ArrowOverlay } from "@/components/tactical/playback/core/types"
import type { PlaybackOverlayRenderContext } from "@/components/tactical/playback/renderer/PlaybackOverlayRenderer"

export class ArrowOverlayRenderer {
  readonly container = new Container()
  private readonly graphics = new Map<string, Graphics>()

  render(
    active: readonly ActivePlaybackOverlay[],
    context: PlaybackOverlayRenderContext
  ) {
    const arrows = active.filter(
      (item): item is ActivePlaybackOverlay & { overlay: ArrowOverlay } =>
        item.overlay.kind === "arrow"
    )
    const visible = new Set<string>()
    for (const item of arrows) {
      const from = context.resolveAnchor(item.overlay.from)
      const to = context.resolveAnchor(item.overlay.to)
      if (!from || !to) continue
      visible.add(item.overlay.id)
      let graphic = this.graphics.get(item.overlay.id)
      if (!graphic) {
        graphic = new Graphics()
        this.graphics.set(item.overlay.id, graphic)
        this.container.addChild(graphic)
      }
      drawArrow(graphic, item.overlay, from, to, context)
      graphic.alpha = item.opacity
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

function drawArrow(
  graphic: Graphics,
  overlay: ArrowOverlay,
  from: { x: number; y: number },
  to: { x: number; y: number },
  context: PlaybackOverlayRenderContext
) {
  graphic.clear()
  const color = context.toneColor(overlay.appearance?.tone)
  const width = overlay.appearance?.width ?? 2
  if (overlay.appearance?.dashed) drawDashedLine(graphic, from, to, 6, 4)
  else graphic.moveTo(from.x, from.y).lineTo(to.x, to.y)
  graphic.stroke({ color, width, alpha: 0.85, cap: "round" })

  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  const arrowLength = 10
  const wing = Math.PI / 7
  graphic
    .moveTo(to.x, to.y)
    .lineTo(
      to.x - Math.cos(angle - wing) * arrowLength,
      to.y - Math.sin(angle - wing) * arrowLength
    )
    .moveTo(to.x, to.y)
    .lineTo(
      to.x - Math.cos(angle + wing) * arrowLength,
      to.y - Math.sin(angle + wing) * arrowLength
    )
    .stroke({ color, width, alpha: 0.95, cap: "round" })
}

function drawDashedLine(
  graphic: Graphics,
  from: { x: number; y: number },
  to: { x: number; y: number },
  dash: number,
  gap: number
) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y)
  if (distance === 0) return
  const dx = (to.x - from.x) / distance
  const dy = (to.y - from.y) / distance
  for (let offset = 0; offset < distance; offset += dash + gap) {
    const end = Math.min(distance, offset + dash)
    graphic
      .moveTo(from.x + dx * offset, from.y + dy * offset)
      .lineTo(from.x + dx * end, from.y + dy * end)
  }
}
