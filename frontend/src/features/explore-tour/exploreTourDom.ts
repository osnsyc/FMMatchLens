export class ExploreTourTaskScope {
  private controller = new AbortController()
  private readonly timeouts = new Set<number>()
  private readonly animationFrames = new Set<number>()

  get signal() {
    return this.controller.signal
  }

  schedule(callback: () => void, delay = 0) {
    const signal = this.signal
    const id = window.setTimeout(() => {
      this.timeouts.delete(id)
      if (!signal.aborted) callback()
    }, delay)
    this.timeouts.add(id)
    return id
  }

  nextFrame(callback: () => void) {
    const signal = this.signal
    const id = window.requestAnimationFrame(() => {
      this.animationFrames.delete(id)
      if (!signal.aborted) callback()
    })
    this.animationFrames.add(id)
    return id
  }

  cancelAll() {
    this.controller.abort()
    this.timeouts.forEach((id) => window.clearTimeout(id))
    this.animationFrames.forEach((id) => window.cancelAnimationFrame(id))
    this.timeouts.clear()
    this.animationFrames.clear()
    this.controller = new AbortController()
  }
}

export type ExploreTourRect = {
  left: number
  top: number
  width: number
  height: number
}

export type ExploreTourViewportRegions = {
  viewportWidth: number
  viewportHeight: number
  rects: ExploreTourRect[]
}

export function findVisibleElements(selectors: string[], targetIndex = 0) {
  return selectors.flatMap((selector) => {
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>(selector)
    )
    const visibleCandidates = candidates.filter((element) => {
      const rect = element.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    })
    const target = visibleCandidates[targetIndex]
    return target ? [target] : []
  })
}

export function measureCuePositions(
  targets: HTMLElement[],
  options: {
    anchor?: "center" | "right"
    offsetX?: number
    offsetY?: number
  }
) {
  return targets.map((target) => {
    const rect = target.getBoundingClientRect()
    const baseX =
      options.anchor === "right" ? rect.right : rect.left + rect.width / 2
    return {
      x: Math.min(
        window.innerWidth - 12,
        Math.max(12, baseX + (options.offsetX ?? 0))
      ),
      y: Math.min(
        window.innerHeight - 12,
        Math.max(12, rect.top + rect.height / 2 + (options.offsetY ?? 0))
      ),
    }
  })
}

export function measureViewportRegions(selectors: string[], padding: number) {
  const rects = selectors.flatMap((selector) => {
    const element = document.querySelector<HTMLElement>(selector)
    if (!element) return []
    const rect = element.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return []
    const left = Math.max(0, rect.left - padding)
    const top = Math.max(0, rect.top - padding)
    const right = Math.min(window.innerWidth, rect.right + padding)
    const bottom = Math.min(window.innerHeight, rect.bottom + padding)
    return [{ left, top, width: right - left, height: bottom - top }]
  })
  return {
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    rects,
  } satisfies ExploreTourViewportRegions
}

export function sameViewportRegions(
  current: ExploreTourViewportRegions | undefined,
  next: ExploreTourViewportRegions
) {
  if (
    !current ||
    current.viewportWidth !== next.viewportWidth ||
    current.viewportHeight !== next.viewportHeight ||
    current.rects.length !== next.rects.length
  )
    return false

  return current.rects.every((rect, index) => {
    const candidate = next.rects[index]
    return (
      Math.abs(rect.left - candidate.left) < 0.25 &&
      Math.abs(rect.top - candidate.top) < 0.25 &&
      Math.abs(rect.width - candidate.width) < 0.25 &&
      Math.abs(rect.height - candidate.height) < 0.25
    )
  })
}

export function roundedRectPath(rect: ExploreTourRect, radius: number) {
  const left = rect.left
  const top = rect.top
  const right = left + rect.width
  const bottom = top + rect.height
  const resolvedRadius = Math.min(radius, rect.width / 2, rect.height / 2)

  return [
    `M ${left + resolvedRadius} ${top}`,
    `H ${right - resolvedRadius}`,
    `A ${resolvedRadius} ${resolvedRadius} 0 0 1 ${right} ${top + resolvedRadius}`,
    `V ${bottom - resolvedRadius}`,
    `A ${resolvedRadius} ${resolvedRadius} 0 0 1 ${right - resolvedRadius} ${bottom}`,
    `H ${left + resolvedRadius}`,
    `A ${resolvedRadius} ${resolvedRadius} 0 0 1 ${left} ${bottom - resolvedRadius}`,
    `V ${top + resolvedRadius}`,
    `A ${resolvedRadius} ${resolvedRadius} 0 0 1 ${left + resolvedRadius} ${top}`,
    "Z",
  ].join(" ")
}

export function targetMatches(target: EventTarget | null, selector: string) {
  return target instanceof Element && target.closest(selector) !== null
}

export function setArchivePopoverDisabled(disabled: boolean) {
  const popover = document.querySelector<HTMLElement>(
    '[data-tour="archive-popover"]'
  )
  if (!popover) return
  popover.inert = disabled
  if (disabled) popover.setAttribute("aria-disabled", "true")
  else popover.removeAttribute("aria-disabled")
}

export function clearExploreTourDomState() {
  setArchivePopoverDisabled(false)
  document.documentElement.removeAttribute("data-explore-tour-active")
  document.documentElement.removeAttribute("data-explore-tour-step")
}

export function waitForStableElementRect(
  selector: string,
  taskScope: ExploreTourTaskScope,
  maxFrames = 90
) {
  const signal = taskScope.signal
  return new Promise<HTMLElement | null>((resolve) => {
    let previousRect: DOMRect | undefined
    let stableFrames = 0
    let elapsedFrames = 0
    let settled = false

    const finish = (element: HTMLElement | null) => {
      if (settled) return
      settled = true
      signal.removeEventListener("abort", onAbort)
      resolve(element)
    }
    const onAbort = () => finish(null)

    const measure = () => {
      if (signal.aborted) {
        finish(null)
        return
      }
      const element = document.querySelector<HTMLElement>(selector)
      elapsedFrames += 1
      if (!element) {
        if (elapsedFrames >= maxFrames) finish(null)
        else taskScope.nextFrame(measure)
        return
      }

      const rect = element.getBoundingClientRect()
      const isStable =
        previousRect != null &&
        Math.abs(rect.x - previousRect.x) < 0.25 &&
        Math.abs(rect.y - previousRect.y) < 0.25 &&
        Math.abs(rect.width - previousRect.width) < 0.25 &&
        Math.abs(rect.height - previousRect.height) < 0.25
      stableFrames = isStable ? stableFrames + 1 : 0
      previousRect = rect

      if (stableFrames >= 3 || elapsedFrames >= maxFrames) finish(element)
      else taskScope.nextFrame(measure)
    }

    signal.addEventListener("abort", onAbort, { once: true })
    taskScope.nextFrame(measure)
  })
}
