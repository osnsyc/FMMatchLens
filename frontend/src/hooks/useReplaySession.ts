import { useCallback, useEffect, useRef, useState } from "react"

import {
  preprocessReplayArchive,
  type ReplayPreprocessInput,
} from "@/api/replay/replayPreprocessor"
import { ReplaySession } from "@/api/replay/replaySession"
import type { ReplayArchive } from "@/api/replay/replayTypes"
import type { MatchSnapshot } from "@/types/match"

export function useReplaySession(
  onSnapshot: (snapshot: MatchSnapshot) => void
) {
  const sessionRef = useRef<ReplaySession | undefined>(undefined)
  const abortRef = useRef<AbortController | undefined>(undefined)
  const generationRef = useRef(0)
  const [preprocessing, setPreprocessing] = useState(false)
  const [progress, setProgress] = useState(0)

  const dispose = useCallback(() => {
    generationRef.current += 1
    abortRef.current?.abort()
    abortRef.current = undefined
    sessionRef.current?.dispose()
    sessionRef.current = undefined
    setPreprocessing(false)
    setProgress(0)
  }, [])

  const activate = useCallback(
    (archive: ReplayArchive) => {
      sessionRef.current?.dispose()
      const session = new ReplaySession(archive)
      sessionRef.current = session
      if (archive.frameCount > 0) onSnapshot(session.advanceTo(0))
      return archive
    },
    [onSnapshot]
  )

  const prepare = useCallback(
    async (input: ReplayPreprocessInput) => {
      const generation = generationRef.current + 1
      generationRef.current = generation
      abortRef.current?.abort()
      sessionRef.current?.dispose()
      sessionRef.current = undefined
      const controller = new AbortController()
      abortRef.current = controller
      setPreprocessing(true)
      setProgress(0)
      try {
        const archive = await preprocessReplayArchive(input, {
          signal: controller.signal,
          onProgress: (value) => {
            if (generationRef.current === generation) setProgress(value)
          },
        })
        if (generationRef.current !== generation || controller.signal.aborted) {
          return undefined
        }
        activate(archive)
        return archive
      } finally {
        if (generationRef.current === generation) {
          setPreprocessing(false)
          setProgress(1)
          abortRef.current = undefined
        }
      }
    },
    [activate]
  )

  const seek = useCallback(
    (index: number) => {
      const session = sessionRef.current
      if (!session) return
      onSnapshot(session.seek(index))
    },
    [onSnapshot]
  )

  const advanceTo = useCallback(
    (index: number) => {
      const session = sessionRef.current
      if (!session) return
      onSnapshot(session.advanceTo(index))
    },
    [onSnapshot]
  )

  useEffect(() => dispose, [dispose])

  return {
    activate,
    prepare,
    seek,
    advanceTo,
    dispose,
    preprocessing,
    progress,
  }
}
