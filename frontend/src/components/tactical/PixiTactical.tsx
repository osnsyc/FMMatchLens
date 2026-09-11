import { useEffect, useRef } from "react"

import {
  PixiTacticalRenderer,
  type TacticalAppearance,
  type TacticalHit,
} from "@/components/tactical/PixiTacticalRenderer"
import type {
  ShotChain,
  TacticalScene,
} from "@/components/tactical/tacticalScene"
import type { MatchPlayer } from "@/types/match"

type PixiTacticalProps = {
  scene: TacticalScene
  players: ReadonlyMap<number, MatchPlayer>
  appearance: TacticalAppearance
  selectedShotId: string | null
  shotChains: readonly ShotChain[]
  onHover: (hit: TacticalHit | null, clientX: number, clientY: number) => void
  onPointClick: (hit: TacticalHit) => void
  onEmptyClick: () => void
}

export function PixiTactical({
  scene,
  players,
  appearance,
  selectedShotId,
  shotChains,
  onHover,
  onPointClick,
  onEmptyClick,
}: PixiTacticalProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const rendererRef = useRef<PixiTacticalRenderer | null>(null)
  const latestRef = useRef({
    scene,
    players,
    appearance,
    selectedShotId,
    shotChains,
    onHover,
    onPointClick,
    onEmptyClick,
  })

  useEffect(() => {
    latestRef.current = {
      scene,
      players,
      appearance,
      selectedShotId,
      shotChains,
      onHover,
      onPointClick,
      onEmptyClick,
    }
  }, [
    appearance,
    onEmptyClick,
    onHover,
    onPointClick,
    players,
    scene,
    selectedShotId,
    shotChains,
  ])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    const bounds = host.getBoundingClientRect()

    void (async () => {
      let renderer: PixiTacticalRenderer | undefined
      try {
        renderer = await PixiTacticalRenderer.create(
          host,
          bounds.width,
          bounds.height,
          latestRef.current.appearance
        )
        if (disposed) {
          renderer.destroy()
          return
        }
        rendererRef.current = renderer
        renderer.updatePlayers(latestRef.current.players)
        renderer.updateEvents(latestRef.current.scene)
        renderer.updateSelection(
          latestRef.current.selectedShotId,
          latestRef.current.shotChains
        )
      } catch (error) {
        renderer?.destroy()
        if (rendererRef.current === renderer) rendererRef.current = null
        if (!disposed) {
          console.error(
            "Failed to initialize the Pixi tactical renderer",
            error
          )
        }
      }
    })()

    const resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) return
      rendererRef.current?.resize(
        entry.contentRect.width,
        entry.contentRect.height
      )
    })
    resizeObserver.observe(host)

    const themeObserver = new MutationObserver(() => {
      rendererRef.current?.updateAppearance(latestRef.current.appearance)
    })
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    })

    return () => {
      disposed = true
      resizeObserver.disconnect()
      themeObserver.disconnect()
      rendererRef.current?.destroy()
      rendererRef.current = null
    }
  }, [])

  useEffect(() => {
    rendererRef.current?.updateEvents(scene)
  }, [scene])

  useEffect(() => {
    rendererRef.current?.updatePlayers(players)
  }, [players])

  useEffect(() => {
    rendererRef.current?.updateAppearance(appearance)
  }, [appearance])

  useEffect(() => {
    rendererRef.current?.updateSelection(selectedShotId, shotChains)
  }, [selectedShotId, shotChains])

  const hitAtPointer = (
    event: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>
  ) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return (
      rendererRef.current?.hitTest(
        event.clientX - bounds.left,
        event.clientY - bounds.top
      ) ?? null
    )
  }

  return (
    <div
      ref={hostRef}
      className="absolute inset-0 z-10 cursor-default"
      role="img"
      aria-label="Tactical event map"
      onPointerMove={(event) => {
        const hit = hitAtPointer(event)
        rendererRef.current?.setHovered(hit?.point.id ?? null)
        const bounds = event.currentTarget.getBoundingClientRect()
        latestRef.current.onHover(
          hit,
          hit
            ? bounds.left + (hit.point.x / 100) * bounds.width
            : event.clientX,
          hit ? bounds.top + (hit.point.y / 100) * bounds.height : event.clientY
        )
      }}
      onPointerLeave={() => {
        rendererRef.current?.setHovered(null)
        latestRef.current.onHover(null, 0, 0)
      }}
      onClick={(event) => {
        const hit = hitAtPointer(event)
        if (hit) latestRef.current.onPointClick(hit)
        else latestRef.current.onEmptyClick()
      }}
    />
  )
}
