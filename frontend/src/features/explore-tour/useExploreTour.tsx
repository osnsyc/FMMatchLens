import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ACTIONS,
  EVENTS,
  STATUS,
  useJoyride,
  type EventData,
} from "react-joyride"
import { useTranslation } from "react-i18next"

import type { DashboardFocusPanel } from "@/lib/appShortcuts"
import {
  emitExploreTourPrompt,
  exploreTourCloseOverlaysEventName,
  exploreTourEventName,
  exploreTourTacticalMetricsEventName,
  exploreTourTimelineSeekEventName,
  type ExploreTourInteraction,
  type ExploreTourPrompt,
} from "./exploreTourEvents"
import {
  buildExploreTourSteps,
  type ExploreTourStepData,
  type ExploreTourStepId,
} from "./exploreTourSteps"
import { ExploreTourTooltip } from "./ExploreTourTooltip"
import {
  createExploreTourMachineState,
  reduceExploreTourMachine,
  type ExploreTourMachineAction,
  type ExploreTourSquadStage,
  type ExploreTourTacticalStage,
} from "./exploreTourMachine"
import {
  clearExploreTourDomState,
  ExploreTourTaskScope,
  setArchivePopoverDisabled,
  targetMatches,
  waitForStableElementRect,
} from "./exploreTourDom"
import {
  useExploreTourLayers,
  type ExploreTourCueSpec,
} from "./ExploreTourLayers"

type ExploreTourAdapter = {
  setFocusedPanel: (panel: DashboardFocusPanel | null) => void
  setChromeHidden: (hidden: boolean) => void
  clearPinnedPlayers: () => void
}

const actionSteps = new Set<ExploreTourStepId>([
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
])

const cueSpecs: Partial<Record<ExploreTourStepId, ExploreTourCueSpec>> = {
  "formation-possession": {
    selector: '[data-tour="formation-tabs"]',
    anchor: "right",
    offsetX: -4,
  },
  "heatmap-explore": {
    selector: '[data-tour="heatmap-range"]',
    anchor: "right",
    offsetX: -4,
  },
}

export function useExploreTour(adapter: ExploreTourAdapter) {
  const { t } = useTranslation()
  const [showHint, setShowHint] = useState(__EXPLORE_TOUR_HINT_ENABLED__)
  const [cueOverride, setCueOverride] = useState<{
    stepId: ExploreTourStepId
    spec: ExploreTourCueSpec
  }>()
  const [squadStage, setSquadStage] = useState<ExploreTourSquadStage>("home")
  const [tacticalStage, setTacticalStage] =
    useState<ExploreTourTacticalStage>("pitch")
  const steps = useMemo(
    () => buildExploreTourSteps(t, squadStage, tacticalStage),
    [squadStage, t, tacticalStage]
  )
  const machineRef = useRef(createExploreTourMachineState())
  const advancingRef = useRef(false)
  const [taskScope] = useState(() => new ExploreTourTaskScope())

  const transitionMachine = useCallback((action: ExploreTourMachineAction) => {
    const previous = machineRef.current
    const next = reduceExploreTourMachine(previous, action)
    machineRef.current = next
    return next !== previous
  }, [])

  const closeOverlays = useCallback(() => {
    window.dispatchEvent(new Event(exploreTourCloseOverlaysEventName))
  }, [])

  const cleanup = useCallback(() => {
    taskScope.cancelAll()
    advancingRef.current = false
    machineRef.current = createExploreTourMachineState()
    adapter.setFocusedPanel(null)
    adapter.setChromeHidden(false)
    closeOverlays()
    setCueOverride(undefined)
    setSquadStage("home")
    setTacticalStage("pitch")
    clearExploreTourDomState()
  }, [adapter, closeOverlays, taskScope])

  const handleEvent = useCallback(
    (data: EventData) => {
      if (data.type === EVENTS.TOUR_START) {
        document.documentElement.setAttribute(
          "data-explore-tour-active",
          "true"
        )
      }
      if (data.type === EVENTS.STEP_AFTER && data.action !== ACTIONS.REPLAY) {
        const finished = (data.step.data as ExploreTourStepData | undefined)?.id
        if (finished === "timeline-drag" && data.action === ACTIONS.NEXT) {
          window.dispatchEvent(
            new CustomEvent(exploreTourTimelineSeekEventName, {
              detail: { minute: 80 },
            })
          )
        }
        if (finished === "squad-pin-comparison") {
          adapter.clearPinnedPlayers()
          closeOverlays()
          setSquadStage("home")
        }
        if (
          ["player-match-data", "archive-browser", "theme-preset"].includes(
            finished ?? ""
          )
        )
          closeOverlays()
        if (finished === "archive-browser") setArchivePopoverDisabled(false)
        if (finished === "tactical-explore") {
          adapter.setFocusedPanel(null)
          setTacticalStage("pitch")
        }
        if (finished === "zen-mode") adapter.setChromeHidden(false)
      }
      if (data.type === EVENTS.TOUR_END) {
        setShowHint(false)
        cleanup()
      }
    },
    [adapter, cleanup, closeOverlays]
  )

  const { controls, state, Tour } = useJoyride({
    steps,
    continuous: true,
    scrollToFirstStep: false,
    tooltipComponent: ExploreTourTooltip,
    onEvent: handleEvent,
    locale: {
      back: t("exploreTour.controls.back"),
      close: t("exploreTour.controls.exit"),
      next: t("exploreTour.controls.next"),
      skip: t("exploreTour.controls.next"),
    },
    options: {
      backgroundColor: "var(--popover)",
      textColor: "var(--popover-foreground)",
      arrowColor: "var(--popover)",
      primaryColor: "var(--primary)",
      overlayColor: "rgba(0, 0, 0, 0.82)",
      spotlightPadding: 8,
      spotlightRadius: 10,
      zIndex: 40,
      overlayClickAction: false,
      dismissKeyAction: false,
      closeButtonAction: "skip",
      blockTargetInteraction: false,
      showProgress: true,
      skipBeacon: true,
      skipScroll: true,
      targetWaitTimeout: 1800,
    },
    floatingOptions: {
      strategy: "fixed",
      autoUpdate: { animationFrame: true },
      flipOptions: { padding: 12 },
      shiftOptions: { padding: 12, crossAxis: true },
    },
  })

  const active =
    state.status === STATUS.RUNNING || state.status === STATUS.WAITING
  const currentData = steps[state.index]?.data as
    ExploreTourStepData | undefined
  const currentId = currentData?.id
  const cueSpec =
    cueOverride && cueOverride.stepId === currentId
      ? cueOverride.spec
      : currentId
        ? cueSpecs[currentId]
        : undefined

  const advance = useCallback(
    (delay = 120) => {
      if (advancingRef.current) return
      advancingRef.current = true
      taskScope.schedule(() => {
        controls.next()
        advancingRef.current = false
      }, delay)
    },
    [controls, taskScope]
  )

  const updatePrompt = useCallback(
    (prompt: Omit<ExploreTourPrompt, "stepId">, delay = 0) => {
      if (!currentId) return
      taskScope.schedule(
        () => emitExploreTourPrompt({ stepId: currentId, ...prompt }),
        delay
      )
    },
    [currentId, taskScope]
  )

  const replayWithPrompt = useCallback(
    (prompt: Omit<ExploreTourPrompt, "stepId">) => {
      controls.replay()
      updatePrompt(prompt, 100)
    },
    [controls, updatePrompt]
  )

  useEffect(() => {
    taskScope.cancelAll()
    advancingRef.current = false
    machineRef.current = createExploreTourMachineState()
    if (!active || !currentId) return
    taskScope.nextFrame(() => {
      setCueOverride(undefined)
      if (currentId === "squad-pin-comparison") setSquadStage("home")
      if (currentId === "tactical-explore") setTacticalStage("pitch")
    })
    return () => {
      taskScope.cancelAll()
      advancingRef.current = false
    }
  }, [active, currentId, taskScope])

  useEffect(
    () => () => {
      taskScope.cancelAll()
      advancingRef.current = false
      clearExploreTourDomState()
    },
    [taskScope]
  )

  useEffect(() => {
    if (!active || !currentId) return
    document.documentElement.dataset.exploreTourStep = currentId
    return () => {
      if (document.documentElement.dataset.exploreTourStep === currentId) {
        document.documentElement.removeAttribute("data-explore-tour-step")
      }
    }
  }, [active, currentId])

  const { cueLayer, spotlightLayer } = useExploreTourLayers({
    active,
    currentId,
    cueSpec,
    tacticalStage,
  })

  useEffect(() => {
    if (!active || !currentId || !actionSteps.has(currentId)) return
    const matches = targetMatches

    const advanceWhenDrawerCloses = (remainingChecks = 12) => {
      taskScope.schedule(() => {
        const drawer = document.querySelector(
          '[data-tour="player-data-drawer"]'
        )
        if (!drawer || drawer.getAttribute("data-state") === "closed") {
          advance(250)
          return
        }
        if (remainingChecks > 0) advanceWhenDrawerCloses(remainingChecks - 1)
      }, 100)
    }

    const onPointerOver = (event: PointerEvent) => {
      if (
        currentId === "squad-hover" &&
        !machineRef.current.squadHoverReady &&
        matches(event.target, "[data-player-profile-pin]") &&
        transitionMachine({ type: "squad-hover-ready" })
      ) {
        taskScope.schedule(() => {
          if (!document.querySelector("[data-player-profile-popup]")) return
          updatePrompt({
            action: t("exploreTour.prompts.squadHoverReady.action"),
          })
        }, 250)
      }
    }

    const onPointerDown = (event: PointerEvent) => {
      if (
        currentId === "player-match-data" &&
        machineRef.current.drawerOpened &&
        !matches(event.target, "[data-tour-tooltip]")
      ) {
        advanceWhenDrawerCloses()
      }
      if (
        currentId === "archive-browser" &&
        machineRef.current.archiveOpened &&
        !matches(event.target, '[data-tour="archive-popover"]') &&
        !matches(event.target, '[data-tour="archive-picker"]') &&
        !matches(event.target, "[data-tour-tooltip]")
      ) {
        taskScope.schedule(() => {
          const picker = document.querySelector('[data-tour="archive-picker"]')
          if (picker?.getAttribute("data-tour-state") === "closed") advance()
        }, 180)
      }
    }

    const onClick = (event: MouseEvent) => {
      if (
        currentId === "squad-pin-comparison" &&
        matches(event.target, "[data-player-profile-pin]")
      ) {
        const panel =
          event.target instanceof Element
            ? event.target.closest<HTMLElement>('[data-tour="squad-panel"]')
            : null
        const side = panel?.dataset.side === "away" ? "away" : "home"
        taskScope.schedule(() => {
          if (document.querySelector("[data-player-comparison-popup]")) {
            setCueOverride(undefined)
            setSquadStage("comparison")
            taskScope.nextFrame(() => {
              replayWithPrompt({
                body: t("exploreTour.prompts.squadComparisonReady.body"),
                action: t("exploreTour.prompts.squadComparisonReady.action"),
              })
            })
            return
          }
          const nextSide = side === "home" ? "away" : "home"
          setSquadStage(nextSide)
          setCueOverride({
            stepId: currentId,
            spec: {
              selector: `[data-tour="squad-panel"][data-side="${nextSide}"] [data-player-profile-pin]`,
            },
          })
          taskScope.nextFrame(() => {
            controls.replay()
            updatePrompt(
              {
                action:
                  side === "home"
                    ? t("exploreTour.prompts.selectAwayPlayer.action")
                    : t("exploreTour.prompts.selectHomePlayer.action"),
              },
              100
            )
          })
        }, 140)
      }

      if (
        currentId === "player-match-data" &&
        matches(event.target, '[data-tour="player-data-button"]')
      ) {
        transitionMachine({ type: "drawer-opened" })
        taskScope.schedule(() => {
          if (!document.querySelector('[data-tour="player-data-drawer"]'))
            return
          updatePrompt({
            action: t("exploreTour.prompts.playerDataClose.action"),
          })
        }, 160)
      }

      if (
        currentId === "formation-possession" &&
        machineRef.current.formationPhase === "time" &&
        matches(
          event.target,
          '[data-tour="formation-history-time"][data-tour-latest="true"]'
        )
      ) {
        advance(2800)
      }

      if (
        currentId === "tactical-explore" &&
        machineRef.current.tacticalPhase === "players" &&
        matches(event.target, '[data-tour="squad-player"]')
      ) {
        taskScope.schedule(() => {
          if (!document.querySelector('[data-tactical-selected="true"]')) return
          updatePrompt({
            body: t("exploreTour.prompts.tacticalPlayersReady.body"),
            action: t("exploreTour.prompts.tacticalPlayersReady.action"),
          })
        }, 100)
      }

      if (
        currentId === "archive-browser" &&
        matches(event.target, '[data-tour="archive-picker"]')
      ) {
        if (!transitionMachine({ type: "archive-opened" })) return
        taskScope.schedule(() => {
          if (!document.querySelector('[data-tour="archive-popover"]')) return
          setArchivePopoverDisabled(true)
          replayWithPrompt({
            action: t("exploreTour.prompts.archiveOpen.action"),
          })
        }, 160)
      }

      if (
        currentId === "theme-preset" &&
        matches(event.target, '[data-tour="theme-settings"]') &&
        transitionMachine({ type: "theme-opened" })
      ) {
        taskScope.schedule(() => {
          if (!document.querySelector('[data-tour="theme-popover"]')) return
          setCueOverride({
            stepId: currentId,
            spec: {
              selector: '[data-tour="theme-preset-option"]',
              targetIndex: 1,
            },
          })
          replayWithPrompt({
            action: t("exploreTour.prompts.themeOpen.action"),
          })
        }, 160)
      }
    }

    const onKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      if (
        currentId === "player-match-data" &&
        machineRef.current.drawerOpened &&
        key === "escape"
      ) {
        advanceWhenDrawerCloses()
      }
      taskScope.schedule(() => {
        if (currentId === "heatmap-explore" && key === "h") {
          const focused = Boolean(
            document.querySelector('[data-dashboard-focus="heatmap"]')
          )
          if (
            machineRef.current.heatmapPhase === "focus" &&
            focused &&
            transitionMachine({ type: "heatmap-focused" })
          ) {
            setCueOverride({ stepId: currentId, spec: { selectors: [] } })
            replayWithPrompt({
              body: t("exploreTour.prompts.heatmapFocused.body"),
              action: t("exploreTour.prompts.heatmapFocused.action"),
            })
          } else if (machineRef.current.heatmapPhase === "restore" && !focused)
            advance(450)
        }

        if (currentId === "tactical-explore" && key === "t") {
          const focused = Boolean(
            document.querySelector('[data-dashboard-focus="tactical"]')
          )
          if (
            machineRef.current.tacticalPhase === "focus" &&
            focused &&
            transitionMachine({ type: "tactical-focused" })
          ) {
            window.dispatchEvent(
              new CustomEvent(exploreTourTacticalMetricsEventName, {
                detail: { group: "distribution" },
              })
            )
            setCueOverride({
              stepId: currentId,
              spec: {
                selector: '[data-tour="tactical-event-filter"]',
                anchor: "right",
                offsetX: -4,
              },
            })
            const signal = taskScope.signal
            void waitForStableElementRect(
              '[data-dashboard-focus="tactical"] [data-tour="tactical-panel"]',
              taskScope
            ).then((focusRegion) => {
              if (signal.aborted) return
              if (!focusRegion) {
                transitionMachine({ type: "tactical-focus-failed" })
                return
              }
              if (machineRef.current.tacticalPhase !== "filter") return
              setTacticalStage("focused")
              taskScope.nextFrame(() => {
                taskScope.nextFrame(() => {
                  replayWithPrompt({
                    body: t("exploreTour.prompts.tacticalFocused.body"),
                    action: t("exploreTour.prompts.tacticalFocused.action"),
                  })
                })
              })
            })
          } else if (machineRef.current.tacticalPhase === "players" && !focused)
            advance(450)
        }

        if (
          currentId === "zen-mode" &&
          key === "z" &&
          document.querySelector('[data-chrome-hidden="true"]')
        )
          advance(2400)
      }, 90)
    }

    const onTourInteraction = (event: Event) => {
      const detail = (event as CustomEvent<ExploreTourInteraction>).detail

      if (
        currentId === "timeline-drag" &&
        detail.id === "timeline-drag-committed"
      ) {
        advance(700)
      }
      if (
        currentId === "formation-possession" &&
        detail.id === "formation-view-change" &&
        transitionMachine({ type: "formation-view-changed" })
      ) {
        setCueOverride({
          stepId: currentId,
          spec: { selector: '[data-tour="formation-history-pin"]' },
        })
        updatePrompt({ action: t("exploreTour.prompts.formationPin.action") })
      }

      if (
        currentId === "heatmap-explore" &&
        detail.id === "heatmap-range-change" &&
        detail.value === "recent15" &&
        transitionMachine({ type: "heatmap-range-selected" })
      ) {
        setCueOverride({
          stepId: currentId,
          spec: {
            selector: '[data-tour="heatmap-phase"]',
            anchor: "right",
            offsetX: -4,
          },
        })
        updatePrompt({
          action: t("exploreTour.prompts.heatmapPossession.action"),
        })
      }
      if (
        currentId === "heatmap-explore" &&
        detail.id === "heatmap-phase-change" &&
        detail.value !== "all" &&
        transitionMachine({ type: "heatmap-phase-selected" })
      ) {
        setCueOverride({
          stepId: currentId,
          spec: { selector: '[data-tour="heatmap-player"]' },
        })
        updatePrompt({ action: t("exploreTour.prompts.heatmapPlayer.action") })
      }
      if (
        currentId === "heatmap-explore" &&
        detail.id === "heatmap-player-select" &&
        transitionMachine({ type: "heatmap-player-selected" })
      ) {
        setCueOverride({ stepId: currentId, spec: { selectors: [] } })
        updatePrompt({
          action: t("exploreTour.prompts.heatmapEnterFocus.action"),
        })
      }

      if (
        currentId === "tactical-explore" &&
        detail.id === "tactical-shot-select" &&
        transitionMachine({ type: "tactical-shot-selected" })
      ) {
        updatePrompt({
          body: t("exploreTour.prompts.shotChainOpen.body"),
          action: t("exploreTour.prompts.shotChainOpen.action"),
        })
      }
      if (
        currentId === "tactical-explore" &&
        detail.id === "tactical-empty-click" &&
        transitionMachine({ type: "tactical-chain-closed" })
      ) {
        updatePrompt({
          body: t("exploreTour.prompts.tacticalFocus.body"),
          action: t("exploreTour.prompts.tacticalFocus.action"),
        })
      }

      if (
        currentId === "tactical-explore" &&
        detail.id === "tactical-filter-change" &&
        detail.value === "individual" &&
        transitionMachine({ type: "tactical-individual-selected" })
      ) {
        setTacticalStage("players")
        setCueOverride({
          stepId: currentId,
          spec: {
            selectors: [
              '[data-tour="squad-panel"][data-side="home"] [data-tour="squad-player"]',
              '[data-tour="squad-panel"][data-side="away"] [data-tour="squad-player"]',
            ],
          },
        })
        taskScope.nextFrame(() => {
          replayWithPrompt({
            body: t("exploreTour.prompts.individualMode.body"),
            action: t("exploreTour.prompts.individualMode.action"),
          })
        })
      }

      if (currentId === "theme-preset" && detail.id === "theme-preset-change") {
        setCueOverride(undefined)
        advance(650)
      }
    }

    const onFormationClick = (event: MouseEvent) => {
      if (currentId !== "formation-possession") return
      if (!matches(event.target, '[data-tour="formation-history-pin"]')) return
      if (!transitionMachine({ type: "formation-pin-selected" })) return
      setCueOverride({
        stepId: currentId,
        spec: {
          selector:
            '[data-tour="formation-history-time"][data-tour-latest="true"]',
          anchor: "right",
          offsetX: -4,
        },
      })
      updatePrompt(
        {
          body: t("exploreTour.prompts.formationPinned.body"),
          action: t("exploreTour.prompts.formationPinned.action"),
        },
        100
      )
    }

    document.addEventListener("pointerover", onPointerOver, true)
    document.addEventListener("pointerdown", onPointerDown, true)
    document.addEventListener("click", onClick, true)
    document.addEventListener("click", onFormationClick, true)
    window.addEventListener("keyup", onKeyUp)
    window.addEventListener(exploreTourEventName, onTourInteraction)
    return () => {
      document.removeEventListener("pointerover", onPointerOver, true)
      document.removeEventListener("pointerdown", onPointerDown, true)
      document.removeEventListener("click", onClick, true)
      document.removeEventListener("click", onFormationClick, true)
      window.removeEventListener("keyup", onKeyUp)
      window.removeEventListener(exploreTourEventName, onTourInteraction)
    }
  }, [
    active,
    advance,
    controls,
    currentId,
    replayWithPrompt,
    t,
    taskScope,
    transitionMachine,
    updatePrompt,
  ])

  useEffect(() => {
    if (!active || !currentId) return
    if (
      [
        "dashboard-overview",
        "formation-possession",
        "tactical-explore",
        "archive-browser",
      ].includes(currentId)
    ) {
      adapter.setFocusedPanel(null)
    }
    if (currentId === "formation-possession") adapter.clearPinnedPlayers()
    if (currentId === "tactical-explore") {
      window.dispatchEvent(
        new CustomEvent(exploreTourTacticalMetricsEventName, {
          detail: { group: "shots" },
        })
      )
    }
    if (currentId !== "zen-mode") adapter.setChromeHidden(false)
  }, [active, adapter, currentId])

  const start = useCallback(() => {
    setShowHint(false)
    taskScope.cancelAll()
    advancingRef.current = false
    machineRef.current = createExploreTourMachineState()
    adapter.setFocusedPanel(null)
    adapter.setChromeHidden(false)
    controls.reset(true)
  }, [adapter, controls, taskScope])

  return { Tour, cueLayer, spotlightLayer, active, showHint, start }
}
