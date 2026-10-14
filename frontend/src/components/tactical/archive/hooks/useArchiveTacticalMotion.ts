import { useEffect, useRef } from "react"
import type {
  ReplayMotionSource,
  ReplayMotionStatus,
} from "@/api/replay/replayMotionSource"
import type { PixiTacticalRenderer } from "@/components/tactical/PixiTacticalRenderer"
import { ArchiveMotionSession } from "@/components/tactical/archive/runtime/archiveMotionSession"
import type { MatchPlayer } from "@/types/match"
import type { TacticalMotionFrame } from "@/components/tactical/shared/core/types"

export function useArchiveTacticalMotion(
  renderer: PixiTacticalRenderer | null,
  source: ReplayMotionSource | undefined,
  enabled: boolean,
  players: ReadonlyMap<number, MatchPlayer>,
  onStatus?: (status: ReplayMotionStatus) => void
) {
  const latest = useRef({ players, onStatus })
  const redraw = useRef<(() => void) | undefined>(undefined)
  useEffect(() => {
    latest.current = { players, onStatus }
    redraw.current?.()
  }, [players, onStatus])
  useEffect(() => {
    if (!renderer || !source || !enabled) return
    const session = new ArchiveMotionSession()
    const media = window.matchMedia("(prefers-reduced-motion: reduce)")
    let status: ReplayMotionStatus | undefined
    let previousFrame: TacticalMotionFrame | undefined
    let firstDraw = true
    const render = () => {
      const result = session.sample(
        source.getSnapshot(),
        latest.current.players,
        media.matches
      )
      if (result.frame && result.frame !== previousFrame)
        renderer.renderMotionFrame(result.frame)
      else if (!result.frame && (firstDraw || previousFrame))
        renderer.clearMotion()
      previousFrame = result.frame
      firstDraw = false
      if (result.status !== status) {
        status = result.status
        latest.current.onStatus?.(status)
      }
    }
    const unsubscribe = source.subscribe(render)
    redraw.current = render
    media.addEventListener("change", render)
    render()
    return () => {
      unsubscribe()
      redraw.current = undefined
      media.removeEventListener("change", render)
      session.clear()
      renderer.clearMotion()
    }
  }, [renderer, source, enabled])
}
