import type { LiveMotionSource, LiveMotionStatus } from "@/api/liveMotionSource"
import type {
  ReplayMotionSource,
  ReplayMotionStatus,
} from "@/api/replay/replayMotionSource"
import { useArchiveTacticalMotion } from "@/components/tactical/archive/hooks/useArchiveTacticalMotion"
import {
  useDocumentVisible,
  useLiveTacticalMotion,
} from "@/components/tactical/live/hooks/useLiveTacticalMotion"
import { useEffect, useRef, useState } from "react"

import {
  PixiTacticalRenderer,
  TACTICAL_EVENT_OVERSCAN_PX,
  type TacticalAppearance,
  type TacticalHit,
} from "@/components/tactical/PixiTacticalRenderer"
import type {
  ShotChain,
  TacticalScene,
} from "@/components/tactical/tacticalScene"
import type { MatchPlayer } from "@/types/match"
import type {
  PlaybackTextResolver,
  TacticalPlayback,
} from "@/components/tactical/playback/core/types"

type PixiTacticalProps = {
  pitchControlEnabled?: boolean
  liveMode?: boolean
  isPanelActive?: boolean
  liveMotionSource?: LiveMotionSource
  replayMotionSource?: ReplayMotionSource
  onLiveStatus?: (status: LiveMotionStatus | ReplayMotionStatus) => void
  scene: TacticalScene
  players: ReadonlyMap<number, MatchPlayer>
  appearance: TacticalAppearance
  selectedShotId: string | null
  shotChains: readonly ShotChain[]
  playback: TacticalPlayback | null
  playbackTextResolver: PlaybackTextResolver
  onHover: (hit: TacticalHit | null, clientX: number, clientY: number) => void
  onPointClick: (hit: TacticalHit) => void
  onEmptyClick: () => void
}

export function PixiTactical({
  pitchControlEnabled = false,
  liveMode = false,
  isPanelActive = true,
  liveMotionSource,
  replayMotionSource,
  onLiveStatus,
  scene,
  players,
  appearance,
  selectedShotId,
  shotChains,
  playback,
  playbackTextResolver,
  onHover,
  onPointClick,
  onEmptyClick,
}: PixiTacticalProps) {
  const visible = useDocumentVisible()
  const active = isPanelActive && visible
  const [renderer, setRenderer] = useState<PixiTacticalRenderer | null>(null)
  useLiveTacticalMotion(
    renderer,
    liveMotionSource,
    liveMode && active && !playback && !replayMotionSource,
    players,
    onLiveStatus
  )
  useArchiveTacticalMotion(
    renderer,
    replayMotionSource,
    liveMode && active && !playback,
    players,
    onLiveStatus
  )
  useEffect(() => {
    renderer?.setPitchControlEnabled(pitchControlEnabled)
  }, [renderer, pitchControlEnabled])
  const hostRef = useRef<HTMLDivElement | null>(null)
  const rendererRef = useRef<PixiTacticalRenderer | null>(null)
  const latestRef = useRef({
    liveMode,
    active,
    scene,
    players,
    appearance,
    selectedShotId,
    shotChains,
    playback,
    playbackTextResolver,
    onHover,
    onPointClick,
    onEmptyClick,
  })

  useEffect(() => {
    latestRef.current = {
      liveMode,
      active,
      scene,
      players,
      appearance,
      selectedShotId,
      shotChains,
      playback,
      playbackTextResolver,
      onHover,
      onPointClick,
      onEmptyClick,
    }
  }, [
    liveMode,
    active,
    appearance,
    playback,
    playbackTextResolver,
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
    const fieldWidth = Math.max(
      1,
      bounds.width - TACTICAL_EVENT_OVERSCAN_PX * 2
    )
    const fieldHeight = Math.max(
      1,
      bounds.height - TACTICAL_EVENT_OVERSCAN_PX * 2
    )

    void (async () => {
      let renderer: PixiTacticalRenderer | undefined
      try {
        renderer = await PixiTacticalRenderer.create(
          host,
          fieldWidth,
          fieldHeight,
          latestRef.current.appearance,
          latestRef.current.playbackTextResolver
        )
        if (disposed) {
          renderer.destroy()
          return
        }
        rendererRef.current = renderer
        renderer.setPanelActive(latestRef.current.active)
        renderer.setLiveMode(latestRef.current.liveMode)
        setRenderer(renderer)
        renderer.updatePlayers(latestRef.current.players)
        renderer.updateEvents(latestRef.current.scene)
        renderer.updateSelection(
          latestRef.current.selectedShotId,
          latestRef.current.shotChains
        )
        if (latestRef.current.active)
          renderer.updatePlayback(latestRef.current.playback)
      } catch (error) {
        renderer?.destroy()
        if (rendererRef.current === renderer) rendererRef.current = null
        if (!disposed) {
          setRenderer(null)
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
        Math.max(1, entry.contentRect.width - TACTICAL_EVENT_OVERSCAN_PX * 2),
        Math.max(1, entry.contentRect.height - TACTICAL_EVENT_OVERSCAN_PX * 2)
      )
    })
    resizeObserver.observe(host)

    return () => {
      disposed = true
      resizeObserver.disconnect()
      rendererRef.current?.destroy()
      rendererRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!liveMode && active) rendererRef.current?.updateEvents(scene)
  }, [scene, liveMode, active])

  useEffect(() => {
    rendererRef.current?.updatePlayers(players)
  }, [players])

  useEffect(() => {
    rendererRef.current?.updateAppearance(appearance)
  }, [appearance])

  useEffect(() => {
    rendererRef.current?.updateSelection(selectedShotId, shotChains)
  }, [selectedShotId, shotChains])

  useEffect(() => {
    if (active) rendererRef.current?.updatePlayback(playback)
  }, [playback, active])

  useEffect(() => {
    rendererRef.current?.updatePlaybackTextResolver(playbackTextResolver)
  }, [playbackTextResolver])

  useEffect(() => {
    renderer?.setPanelActive(active)
    renderer?.setLiveMode(liveMode)
    if (!liveMode && active) renderer?.updateEvents(latestRef.current.scene)
  }, [renderer, active, liveMode])

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
      className="absolute z-10 cursor-default"
      style={{ inset: -TACTICAL_EVENT_OVERSCAN_PX }}
      role="img"
      aria-label="Tactical event map"
      onPointerMove={(event) => {
        const hit = hitAtPointer(event)
        rendererRef.current?.setHovered(hit?.point.id ?? null)
        const bounds = event.currentTarget.getBoundingClientRect()
        latestRef.current.onHover(
          hit,
          hit
            ? bounds.left +
                TACTICAL_EVENT_OVERSCAN_PX +
                (hit.point.x / 100) *
                  (bounds.width - TACTICAL_EVENT_OVERSCAN_PX * 2)
            : event.clientX,
          hit
            ? bounds.top +
                TACTICAL_EVENT_OVERSCAN_PX +
                (hit.point.y / 100) *
                  (bounds.height - TACTICAL_EVENT_OVERSCAN_PX * 2)
            : event.clientY
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
