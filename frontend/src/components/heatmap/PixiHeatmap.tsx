import { useEffect, useRef } from "react"

import {
  PixiHeatmapRenderer,
  type HeatmapColorScale,
} from "@/components/heatmap/PixiHeatmapRenderer"
import type { HeatmapGrid } from "@/types/match"

type PixiHeatmapProps = {
  grid: HeatmapGrid
  width: number
  height: number
  colorScale?: HeatmapColorScale
}

export function PixiHeatmap({
  grid,
  width,
  height,
  colorScale,
}: PixiHeatmapProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const rendererRef = useRef<PixiHeatmapRenderer | null>(null)
  const gridRef = useRef(grid)
  const colorScaleRef = useRef(colorScale)
  const sizeRef = useRef({ width, height })

  useEffect(() => {
    gridRef.current = grid
    colorScaleRef.current = colorScale
    sizeRef.current = { width, height }
  }, [colorScale, grid, height, width])

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
        renderer.update(gridRef.current, colorScaleRef.current)
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
    rendererRef.current?.update(grid, colorScale)
  }, [colorScale, grid])

  useEffect(() => {
    if (width > 0 && height > 0) rendererRef.current?.resize(width, height)
  }, [height, width])

  return <div ref={hostRef} className="size-full" />
}
