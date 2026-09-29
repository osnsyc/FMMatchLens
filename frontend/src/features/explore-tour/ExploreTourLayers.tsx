import { useEffect, useState } from "react"

import type { ExploreTourStepId } from "./exploreTourSteps"
import type { ExploreTourTacticalStage } from "./exploreTourMachine"
import {
  findVisibleElements,
  measureCuePositions,
  measureViewportRegions,
  roundedRectPath,
  sameViewportRegions,
  type ExploreTourViewportRegions,
} from "./exploreTourDom"

export type ExploreTourCueSpec = {
  selector?: string
  selectors?: string[]
  targetIndex?: number
  anchor?: "center" | "right"
  offsetX?: number
  offsetY?: number
}

export function useExploreTourLayers({
  active,
  currentId,
  cueSpec,
  tacticalStage,
}: {
  active: boolean
  currentId?: ExploreTourStepId
  cueSpec?: ExploreTourCueSpec
  tacticalStage: ExploreTourTacticalStage
}) {
  const [cuePositions, setCuePositions] = useState<
    Array<{ x: number; y: number }>
  >([])
  const [multiSpotlight, setMultiSpotlight] =
    useState<ExploreTourViewportRegions>()

  useEffect(() => {
    if (!active || !cueSpec) {
      const frame = window.requestAnimationFrame(() => setCuePositions([]))
      return () => window.cancelAnimationFrame(frame)
    }
    const selectors =
      cueSpec.selectors ?? (cueSpec.selector ? [cueSpec.selector] : [])
    const targets = findVisibleElements(selectors, cueSpec.targetIndex)
    if (targets.length === 0) {
      const frame = window.requestAnimationFrame(() => setCuePositions([]))
      return () => window.cancelAnimationFrame(frame)
    }
    const update = () => {
      setCuePositions(measureCuePositions(targets, cueSpec))
    }
    update()
    const observer = new ResizeObserver(update)
    targets.forEach((target) => observer.observe(target))
    window.addEventListener("resize", update)
    window.addEventListener("scroll", update, true)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", update)
      window.removeEventListener("scroll", update, true)
    }
  }, [active, cueSpec, currentId])

  useEffect(() => {
    if (
      !active ||
      currentId !== "tactical-explore" ||
      tacticalStage !== "players"
    ) {
      const frame = window.requestAnimationFrame(() =>
        setMultiSpotlight(undefined)
      )
      return () => window.cancelAnimationFrame(frame)
    }

    let frame = 0
    const update = () => {
      const spotlightSelectors = [
        '[data-tour="squad-panel"][data-side="home"]',
        '[data-tour="dashboard-main"]',
        '[data-tour="squad-panel"][data-side="away"]',
      ]
      const next = measureViewportRegions(spotlightSelectors, 8)
      setMultiSpotlight((current) =>
        sameViewportRegions(current, next) ? current : next
      )
      frame = window.requestAnimationFrame(update)
    }
    frame = window.requestAnimationFrame(update)
    return () => window.cancelAnimationFrame(frame)
  }, [active, currentId, tacticalStage])

  const cueLayer = cuePositions.map((position, index) => (
    <span
      key={`${position.x}-${position.y}-${index}`}
      aria-hidden="true"
      className="pointer-events-none fixed z-[150] size-4 -translate-x-1/2 -translate-y-1/2"
      style={{ left: position.x, top: position.y }}
    >
      <span className="absolute inset-0 animate-ping rounded-full bg-primary/70 motion-reduce:animate-none" />
      <span className="absolute inset-1 rounded-full bg-primary shadow-[0_0_0_2px_var(--background)]" />
    </span>
  ))

  const spotlightLayer =
    multiSpotlight && multiSpotlight.rects.length === 3 ? (
      <svg
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-40"
        width={multiSpotlight.viewportWidth}
        height={multiSpotlight.viewportHeight}
        viewBox={`0 0 ${multiSpotlight.viewportWidth} ${multiSpotlight.viewportHeight}`}
      >
        <path
          d={[
            `M 0 0 H ${multiSpotlight.viewportWidth} V ${multiSpotlight.viewportHeight} H 0 Z`,
            ...multiSpotlight.rects.map((rect) => roundedRectPath(rect, 10)),
          ].join(" ")}
          fill="rgba(0, 0, 0, 0.82)"
          fillRule="evenodd"
          className="pointer-events-auto"
        />
      </svg>
    ) : null

  return { cueLayer, spotlightLayer }
}
