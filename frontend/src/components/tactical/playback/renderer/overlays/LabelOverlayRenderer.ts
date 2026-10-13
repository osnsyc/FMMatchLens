import { BitmapText, Container, Graphics } from "pixi.js"

import type { ActivePlaybackOverlay } from "@/components/tactical/playback/core/overlayTimeline"
import type { LabelOverlay } from "@/components/tactical/playback/core/types"
import type { PlaybackOverlayRenderContext } from "@/components/tactical/playback/renderer/PlaybackOverlayRenderer"

type LabelRecord = {
  container: Container
  background: Graphics
  text: BitmapText
  value: string
}

export class LabelOverlayRenderer {
  readonly container = new Container()
  private readonly labels = new Map<string, LabelRecord>()

  render(
    active: readonly ActivePlaybackOverlay[],
    context: PlaybackOverlayRenderContext
  ) {
    const labels = active.filter(
      (item): item is ActivePlaybackOverlay & { overlay: LabelOverlay } =>
        item.overlay.kind === "label"
    )
    const visible = new Set<string>()
    for (const item of labels) {
      const position = context.resolveAnchor(item.overlay.anchor)
      if (!position) continue
      visible.add(item.overlay.id)
      const record = this.recordFor(item.overlay.id, context)
      const title = context.resolveText(item.overlay.title)
      const detail = item.overlay.detail
        ? context.resolveText(item.overlay.detail)
        : undefined
      const value = detail ? `${title}\n${detail}` : title
      if (record.value !== value) {
        record.value = value
        record.text.text = value
      }
      const color = context.toneColor(item.overlay.appearance?.tone)
      const paddingX = item.overlay.variant === "event" ? 8 : 6
      const paddingY = item.overlay.variant === "event" ? 5 : 4
      const width = Math.max(28, record.text.width + paddingX * 2)
      const height = record.text.height + paddingY * 2
      record.background
        .clear()
        .roundRect(-width / 2, -height / 2, width, height, 5)
        .fill({ color: context.colors.neutral, alpha: 0.9 })
        .stroke({ color, width: item.overlay.variant === "event" ? 2 : 1.25 })
      record.text.style.fill = context.colors.foreground
      record.container.position.set(
        position.x + (item.overlay.offset?.x ?? 0),
        position.y + (item.overlay.offset?.y ?? -28)
      )
      record.container.alpha = item.opacity
      record.container.scale.set(item.scale)
      record.container.visible = true
    }
    for (const [id, record] of this.labels) {
      record.container.visible = visible.has(id)
    }
  }

  clear() {
    this.container
      .removeChildren()
      .forEach((child) => child.destroy({ children: true }))
    this.labels.clear()
  }

  private recordFor(
    id: string,
    context: PlaybackOverlayRenderContext
  ): LabelRecord {
    const existing = this.labels.get(id)
    if (existing) return existing
    const container = new Container()
    const background = new Graphics()
    const text = new BitmapText({
      text: "",
      style: {
        fontFamily: "Arial",
        fontSize: 10,
        fontWeight: "bold",
        fill: context.colors.foreground,
        align: "center",
      },
    })
    text.anchor.set(0.5)
    container.addChild(background, text)
    this.container.addChild(container)
    const record = { container, background, text, value: "" }
    this.labels.set(id, record)
    return record
  }
}
