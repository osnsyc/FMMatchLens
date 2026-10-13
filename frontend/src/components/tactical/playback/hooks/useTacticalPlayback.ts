import { useCallback, useEffect, useRef, useState } from "react"

import type { RealtimeFrame } from "@/api/realtimeMatch"
import type { TacticalPlayback } from "@/components/tactical/playback/core/types"

export type LoadTacticalPlaybackFrames = (
  fromTick: number,
  toTick: number,
  signal: AbortSignal
) => Promise<readonly RealtimeFrame[]>

export type TacticalPlaybackRequest = {
  id: string
  fromTick: number
  toTick: number
  build: (frames: readonly RealtimeFrame[]) => TacticalPlayback | null
}

export function useTacticalPlayback(loadFrames: LoadTacticalPlaybackFrames) {
  const [playbackResult, setPlaybackResult] = useState<{
    source: LoadTacticalPlaybackFrames
    playback: TacticalPlayback | null
  } | null>(null)
  const [loadingRequestId, setLoadingRequestId] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const clearPlayback = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setLoadingRequestId(null)
    setPlaybackResult(null)
  }, [])

  const startPlayback = useCallback(
    (request: TacticalPlaybackRequest) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setLoadingRequestId(request.id)
      setPlaybackResult(null)
      void loadFrames(request.fromTick, request.toTick, controller.signal)
        .then((frames) => {
          if (!controller.signal.aborted) {
            setPlaybackResult({
              source: loadFrames,
              playback: request.build(frames),
            })
          }
        })
        .catch((error: unknown) => {
          if (
            !controller.signal.aborted &&
            !(error instanceof DOMException && error.name === "AbortError")
          ) {
            console.error("Unable to load tactical playback frames", error)
          }
        })
        .finally(() => {
          if (abortRef.current === controller) {
            abortRef.current = null
            setLoadingRequestId(null)
          }
        })
    },
    [loadFrames]
  )

  useEffect(() => {
    return () => {
      const controller = abortRef.current
      abortRef.current = null
      controller?.abort()
    }
  }, [loadFrames])

  return {
    playback:
      playbackResult?.source === loadFrames ? playbackResult.playback : null,
    loadingRequestId,
    startPlayback,
    clearPlayback,
  }
}
