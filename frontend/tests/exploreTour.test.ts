import { describe, expect, it, vi } from "vitest"
import type { TFunction } from "i18next"

import { buildExploreTourSteps } from "../src/features/explore-tour/exploreTourSteps"
import { ExploreTourTaskScope } from "../src/features/explore-tour/exploreTourDom"
import {
  createExploreTourMachineState,
  reduceExploreTourMachine,
} from "../src/features/explore-tour/exploreTourMachine"

describe("explore tour steps", () => {
  const translate = ((key: string) => key) as TFunction

  it("keeps the refined 12-step order and stable targets", () => {
    const steps = buildExploreTourSteps(translate)

    expect(steps).toHaveLength(12)
    expect(steps.map((step) => step.id)).toEqual([
      "dashboard-overview",
      "timeline-drag",
      "squad-hover",
      "squad-pin-comparison",
      "player-match-data",
      "formation-possession",
      "heatmap-explore",
      "tactical-explore",
      "archive-browser",
      "theme-preset",
      "zen-mode",
      "tour-complete",
    ])
    expect(
      steps.every((step) => ["string", "function"].includes(typeof step.target))
    ).toBe(true)
  })

  it("provides localized copy without changing step identity", () => {
    const english = buildExploreTourSteps(
      ((key: string) => `en:${key}`) as TFunction
    )
    const chinese = buildExploreTourSteps(
      ((key: string) => `zh:${key}`) as TFunction
    )

    expect(chinese.map((step) => step.id)).toEqual(
      english.map((step) => step.id)
    )
    expect(chinese[0].title).not.toBe(english[0].title)
  })

  it("spotlights only the complete tactical board in tactical focus mode", () => {
    const tacticalPanel = {} as HTMLElement
    const squadsRow = {} as HTMLElement
    vi.stubGlobal("document", {
      querySelector: (selector: string) => {
        if (selector.includes('[data-tour-state="individual"]')) return null
        return selector.includes('[data-tour="tactical-panel"]')
          ? tacticalPanel
          : squadsRow
      },
    })
    const steps = buildExploreTourSteps(translate, "home", "focused")
    const tacticalStep = steps.find((step) => step.id === "tactical-explore")

    expect(typeof tacticalStep?.spotlightTarget).toBe("function")
    expect((tacticalStep?.spotlightTarget as () => Element | null)()).toBe(
      tacticalPanel
    )
    expect((tacticalStep?.spotlightTarget as () => Element | null)()).not.toBe(
      squadsRow
    )

    const stalePitchSteps = buildExploreTourSteps(translate, "home", "pitch")
    const stalePitchStep = stalePitchSteps.find(
      (step) => step.id === "tactical-explore"
    )
    expect((stalePitchStep?.spotlightTarget as () => Element | null)()).toBe(
      tacticalPanel
    )
    vi.unstubAllGlobals()
  })

  it("uses live tactical focus state for the tooltip target", () => {
    const focusedFilter = {} as HTMLElement
    const pitch = {} as HTMLElement
    vi.stubGlobal("document", {
      querySelector: (selector: string) =>
        selector.includes(
          '[data-dashboard-focus="tactical"] [data-tour="tactical-event-filter"]'
        )
          ? focusedFilter
          : pitch,
    })

    const steps = buildExploreTourSteps(translate, "home", "pitch")
    const tacticalStep = steps.find((step) => step.id === "tactical-explore")

    expect(typeof tacticalStep?.target).toBe("function")
    expect((tacticalStep?.target as () => Element | null)()).toBe(focusedFilter)
    vi.unstubAllGlobals()
  })

  it("spotlights both squad columns when live individual mode is active", () => {
    const squadsRow = {} as HTMLElement
    const individualFilter = {} as HTMLElement
    vi.stubGlobal("document", {
      querySelector: (selector: string) => {
        if (selector.includes('[data-tour-state="individual"]'))
          return individualFilter
        if (selector.includes('[data-tour="squads"]')) return squadsRow
        return null
      },
    })

    const steps = buildExploreTourSteps(translate, "home", "focused")
    const tacticalStep = steps.find((step) => step.id === "tactical-explore")

    expect((tacticalStep?.spotlightTarget as () => Element | null)()).toBe(
      squadsRow
    )
    vi.unstubAllGlobals()
  })

  it("keeps the comparison tooltip compact and fixed to the popup's left", () => {
    const comparisonStep = buildExploreTourSteps(translate, "comparison").find(
      (step) => step.id === "squad-pin-comparison"
    )

    expect(comparisonStep?.placement).toBe("left")
    expect(comparisonStep?.width).toBe(272)
    expect(comparisonStep?.floatingOptions?.flipOptions).toBe(false)
  })

  it("visibly separates the squad hover and comparison tooltip positions", () => {
    const steps = buildExploreTourSteps(translate)
    const hoverStep = steps.find((step) => step.id === "squad-hover")
    const comparisonStep = steps.find(
      (step) => step.id === "squad-pin-comparison"
    )

    expect(hoverStep?.placement).toBe("right-start")
    expect(comparisonStep?.placement).toBe("right-end")
  })

  it("uses the interactive multi-region overlay in tactical player mode", () => {
    const tacticalStep = buildExploreTourSteps(
      translate,
      "home",
      "players"
    ).find((step) => step.id === "tactical-explore")

    expect(tacticalStep?.hideOverlay).toBe(true)
  })
})

describe("explore tour lifecycle", () => {
  it("only accepts valid phase transitions", () => {
    const initial = createExploreTourMachineState()
    const ignored = reduceExploreTourMachine(initial, {
      type: "tactical-individual-selected",
    })
    const focused = reduceExploreTourMachine(initial, {
      type: "tactical-shot-selected",
    })

    expect(ignored).toBe(initial)
    expect(focused.tacticalPhase).toBe("chain")
  })

  it("cancels pending timers and animation frames as one task scope", () => {
    const timerCallback = vi.fn()
    const frameCallback = vi.fn()
    const clearTimeout = vi.fn()
    const cancelAnimationFrame = vi.fn()
    let pendingTimer: (() => void) | undefined
    let pendingFrame: (() => void) | undefined

    vi.stubGlobal("window", {
      setTimeout: (callback: () => void) => {
        pendingTimer = callback
        return 11
      },
      clearTimeout,
      requestAnimationFrame: (callback: () => void) => {
        pendingFrame = callback
        return 22
      },
      cancelAnimationFrame,
    })

    const scope = new ExploreTourTaskScope()
    scope.schedule(timerCallback, 100)
    scope.nextFrame(frameCallback)
    scope.cancelAll()
    pendingTimer?.()
    pendingFrame?.()

    expect(clearTimeout).toHaveBeenCalledWith(11)
    expect(cancelAnimationFrame).toHaveBeenCalledWith(22)
    expect(timerCallback).not.toHaveBeenCalled()
    expect(frameCallback).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
