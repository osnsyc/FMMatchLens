import { useEffect, useRef, useState } from "react"
import type { LiveMotionSource, LiveMotionStatus } from "@/api/liveMotionSource"
import type { PixiTacticalRenderer } from "@/components/tactical/PixiTacticalRenderer"
import {
  LiveMotionSession,
  type MotionPlayerDetails,
} from "@/components/tactical/live/runtime/liveMotionSession"
import type { MatchPlayer } from "@/types/match"

export function useDocumentVisible() {
  const [visible, setVisible] = useState(() => !document.hidden)
  useEffect(() => {
    const update = () => setVisible(!document.hidden)
    document.addEventListener("visibilitychange", update)
    return () => document.removeEventListener("visibilitychange", update)
  }, [])
  return visible
}
export function useLiveTacticalMotion(
  renderer: PixiTacticalRenderer | null,
  source: LiveMotionSource | undefined,
  enabled: boolean,
  players: ReadonlyMap<number, MatchPlayer>,
  onStatus?: (status: LiveMotionStatus) => void
) {
  const details = useRef(new Map<number, MotionPlayerDetails>())
  const notify = useRef(onStatus)
  useEffect(() => {
    notify.current = onStatus
  }, [onStatus])
  useEffect(() => {
    details.current = new Map(
      [...players].slice(0, 64).map(([id, p]) => [
        id,
        {
          shirtNumber: p.shirtNumber ?? p.squadNumber,
          isGoalkeeper:
            (
              p.inPossession?.position ??
              p.outOfPossession?.position ??
              p.position
            )
              ?.trim()
              .toUpperCase() === "GK",
        },
      ])
    )
  }, [players])
  useEffect(() => {
    if (!renderer || !source || !enabled) {
      notify.current?.("suspended")
      return
    }
    const session = new LiveMotionSession()
    const media = window.matchMedia("(prefers-reduced-motion: reduce)")
    let waitingTimer: ReturnType<typeof setTimeout> | undefined
    let disposed = false,
      status: LiveMotionStatus | undefined
    const report = (next: LiveMotionStatus) => {
      if (status !== next) {
        if (
          next === "waiting" ||
          next === "disconnected" ||
          next === "buffering"
        )
          renderer.clearPitchControl()
        status = next
        notify.current?.(next)
      }
    }
    const advance = (now: number) => {
      if (disposed) return false
      const result = session.sample(now, details.current, media.matches)
      if (result.frame) renderer.renderMotionFrame(result.frame)
      report(result.status)
      return result.animate
    }
    const receive = (sample: Parameters<LiveMotionSession["push"]>[0]) => {
      if (
        disposed ||
        source.getStatus() === "ended" ||
        source.getStatus() === "disconnected"
      )
        return
      if (session.push(sample)) {
        clearTimeout(waitingTimer)
        waitingTimer = setTimeout(() => {
          session.reset()
          renderer.scheduler.removeTask("live")
          report("waiting")
        }, 1500)
        if (media.matches) advance(performance.now())
        else renderer.scheduler.setTask("live", advance)
      } else if (session.bufferCount === 0) report("waiting")
    }
    let subscribed = source.getStatus() !== "ended"
    let unsubscribe = subscribed ? source.subscribe(receive) : () => {}
    const changed = (next: LiveMotionStatus) => {
      if (next === "disconnected" || next === "ended") {
        clearTimeout(waitingTimer)
        if (next === "ended") {
          const last = source.getLatest()
          if (last) {
            session.push(last)
            const result = session.sample(
              performance.now(),
              details.current,
              true
            )
            if (result.frame) renderer.renderMotionFrame(result.frame)
          }
          unsubscribe()
          subscribed = false
        }
        session.reset()
        renderer.scheduler.removeTask("live")
        report(next)
      } else if (next === "buffering") {
        clearTimeout(waitingTimer)
        session.reset()
        renderer.clearMotion()
        report("buffering")
        if (!subscribed) {
          unsubscribe = source.subscribe(receive)
          subscribed = true
        }
      }
    }
    const unsubscribeStatus = source.subscribeStatus(changed)
    const preferenceChanged = () => {
      renderer.scheduler.removeTask("live")
      if (!media.matches) renderer.scheduler.setTask("live", advance)
    }
    media.addEventListener("change", preferenceChanged)
    report(
      source.getStatus() === "disconnected"
        ? "disconnected"
        : source.getStatus() === "ended"
          ? "ended"
          : "buffering"
    )
    const seed = source.getLatest()
    if (seed) receive(seed)
    return () => {
      disposed = true
      clearTimeout(waitingTimer)
      unsubscribe()
      unsubscribe = () => {}
      unsubscribeStatus()
      media.removeEventListener("change", preferenceChanged)
      session.dispose()
      renderer.clearMotion()
    }
  }, [renderer, source, enabled])
}
