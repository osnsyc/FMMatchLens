import { useEffect, useRef } from "react"

import { PixiHeatmapRenderer } from "@/components/heatmap/PixiHeatmapRenderer"
import {
  DEFAULT_HEATMAP_TONE_MAPPING,
  type HeatmapToneMapping,
} from "@/components/heatmap/heatmapTexture"
import { hexColorToNormalizedRgb } from "@/lib/cssColor"
import type { HeatmapRenderData } from "@/api/heatmap"
import { useTheme } from "@/components/theme-provider"

type PixiHeatmapProps = {
  data: HeatmapRenderData
  width: number
  height: number
  toneMapping?: Partial<HeatmapToneMapping>
}

export function PixiHeatmap({
  data,
  width,
  height,
  toneMapping,
}: PixiHeatmapProps) {
  const { settings, resolvedScheme } = useTheme()
  const hostRef = useRef<HTMLDivElement | null>(null)
  const rendererRef = useRef<PixiHeatmapRenderer | null>(null)
  const dataRef = useRef(data)
  const toneMappingRef = useRef(toneMapping)
  const sizeRef = useRef({ width, height })

  useEffect(() => {
    dataRef.current = data
    toneMappingRef.current = toneMapping
    sizeRef.current = { width, height }
  }, [data, height, toneMapping, width])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false

    void (async () => {
      let renderer: PixiHeatmapRenderer | undefined
      try {
        renderer = await PixiHeatmapRenderer.create(
          host,
          sizeRef.current.width,
          sizeRef.current.height
        )
        if (disposed) {
          renderer.destroy()
          return
        }
        rendererRef.current = renderer
        const latestSize = sizeRef.current
        if (latestSize.width > 0 && latestSize.height > 0) {
          renderer.resize(latestSize.width, latestSize.height)
        }
        renderer.updateLut(readHeatmapStops())
        renderer.updateToneMapping(
          toneMappingRef.current ?? DEFAULT_HEATMAP_TONE_MAPPING
        )
        renderer.update(dataRef.current)
      } catch (error) {
        renderer?.destroy()
        if (rendererRef.current === renderer) rendererRef.current = null
        if (!disposed) {
          console.error("Failed to initialize the Pixi heatmap renderer", error)
        }
      }
    })()

    return () => {
      disposed = true
      rendererRef.current?.destroy()
      rendererRef.current = null
    }
  }, [])

  useEffect(() => {
    rendererRef.current?.update(data)
  }, [data])

  useEffect(() => {
    rendererRef.current?.updateLut(readHeatmapStops())
  }, [resolvedScheme, settings.colorVision, settings.presetId])

  useEffect(() => {
    rendererRef.current?.updateToneMapping(
      toneMapping ?? DEFAULT_HEATMAP_TONE_MAPPING
    )
  }, [toneMapping])

  useEffect(() => {
    if (width > 0 && height > 0) rendererRef.current?.resize(width, height)
  }, [height, width])

  return <div ref={hostRef} className="size-full" />
}

function readHeatmapStops() {
  const style = getComputedStyle(document.documentElement)
  return Array.from({ length: 6 }, (_, index) =>
    cssColorToRgb(
      resolveCssVariables(
        style.getPropertyValue(`--heatmap-stop-${index}`),
        style
      )
    )
  )
}

function resolveCssVariables(color: string, style: CSSStyleDeclaration) {
  let resolved = color.trim()
  for (let depth = 0; depth < 4; depth += 1) {
    const variable = resolved.match(/^var\(\s*(--[\w-]+)\s*\)$/)
    if (!variable) return resolved
    resolved = style.getPropertyValue(variable[1]).trim()
  }
  return resolved
}

function cssColorToRgb(color: string): number[] {
  return hexColorToNormalizedRgb(color) ?? [0, 0, 0]
}
