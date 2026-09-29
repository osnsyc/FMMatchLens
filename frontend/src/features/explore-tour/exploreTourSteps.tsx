import type { Step } from "react-joyride"
import type { TFunction } from "i18next"

import type {
  ExploreTourSquadStage,
  ExploreTourTacticalStage,
} from "./exploreTourMachine"

export type ExploreTourStepId =
  | "dashboard-overview"
  | "timeline-drag"
  | "squad-hover"
  | "squad-pin-comparison"
  | "player-match-data"
  | "formation-possession"
  | "heatmap-explore"
  | "tactical-explore"
  | "archive-browser"
  | "theme-preset"
  | "zen-mode"
  | "tour-complete"

export type ExploreTourStepData = {
  id: ExploreTourStepId
  interactive: boolean
  action?: string
}

const dynamicTarget = (popup: string, fallback: string) => () =>
  document.querySelector<HTMLElement>(popup) ??
  document.querySelector<HTMLElement>(fallback)

const squadPinTarget = (stage: ExploreTourSquadStage) => () => {
  if (stage === "comparison") {
    return (
      document.querySelector<HTMLElement>("[data-player-comparison-popup]") ??
      document.querySelector<HTMLElement>(
        '[data-tour="squad-panel"][data-side="away"]'
      )
    )
  }
  return document.querySelector<HTMLElement>(
    `[data-tour="squad-panel"][data-side="${stage}"]`
  )
}

const heatmapSpotlight = () =>
  document.querySelector<HTMLElement>('[data-dashboard-focus="heatmap"]') ??
  document.querySelector<HTMLElement>('[data-tour="heatmap-panel"]')

const tacticalTarget = (stage: ExploreTourTacticalStage) => () => {
  const focusedFilter = document.querySelector<HTMLElement>(
    '[data-dashboard-focus="tactical"] [data-tour="tactical-event-filter"]'
  )
  if (focusedFilter) return focusedFilter

  return stage === "pitch"
    ? document.querySelector<HTMLElement>('[data-tour="tactical-pitch"]')
    : document.querySelector<HTMLElement>('[data-tour="tactical-event-filter"]')
}

const tacticalSpotlight = (stage: ExploreTourTacticalStage) => () => {
  const individualModeActive = document.querySelector(
    '[data-dashboard-focus="tactical"] [data-tour="tactical-event-filter"][data-tour-state="individual"]'
  )
  if (stage === "players" || individualModeActive) {
    return document.querySelector<HTMLElement>(
      '[data-tour="squads"][data-tour-tactical-focus="true"]'
    )
  }

  // Resolve focus from the live DOM as well as the React step state. Joyride can
  // replay once with the previous (pitch) step closure while focus mode is
  // committing, but the spotlight must already cover the complete panel.
  return (
    document.querySelector<HTMLElement>(
      '[data-dashboard-focus="tactical"] [data-tour="tactical-panel"]'
    ) ?? document.querySelector<HTMLElement>('[data-tour="tactical-pitch"]')
  )
}

const definitions: Array<
  [ExploreTourStepId, Step["target"], Step["placement"]]
> = [
  ["dashboard-overview", '[data-tour="dashboard"]', "center"],
  ["timeline-drag", '[data-tour="timeline-interaction-region"]', "top"],
  ["squad-hover", '[data-tour="squad-panel"][data-side="home"]', "right-start"],
  [
    "squad-pin-comparison",
    '[data-tour="squad-panel"][data-side="home"]',
    "right",
  ],
  ["player-match-data", '[data-tour="player-data-button"]', "right"],
  ["formation-possession", '[data-tour="formation-panel"]', "left"],
  ["heatmap-explore", '[data-tour="heatmap-panel"]', "left"],
  ["tactical-explore", '[data-tour="tactical-pitch"]', "bottom"],
  [
    "archive-browser",
    dynamicTarget(
      '[data-tour="archive-popover"]',
      '[data-tour="archive-picker"]'
    ),
    "right",
  ],
  [
    "theme-preset",
    dynamicTarget(
      '[data-tour="theme-popover"]',
      '[data-tour="theme-settings"]'
    ),
    "left",
  ],
  ["zen-mode", '[data-tour="dashboard"]', "center"],
  ["tour-complete", '[data-tour="dashboard"]', "center"],
]

export function buildExploreTourSteps(
  t: TFunction,
  squadStage: ExploreTourSquadStage = "home",
  tacticalStage: ExploreTourTacticalStage = "pitch"
): Step[] {
  return definitions.map(([id, target, placement]) => {
    const key = `exploreTour.steps.${id}`
    const action = t(`${key}.action`)
    const resolvedTarget =
      id === "squad-pin-comparison"
        ? squadPinTarget(squadStage)
        : id === "tactical-explore"
          ? tacticalTarget(tacticalStage)
          : target
    const resolvedPlacement =
      id === "squad-pin-comparison"
        ? squadStage === "home"
          ? "right-end"
          : "left"
        : id === "tactical-explore" && tacticalStage !== "pitch"
          ? "bottom-start"
          : placement
    return {
      id,
      target: resolvedTarget,
      placement: resolvedPlacement,
      title: t(`${key}.title`),
      content: t(`${key}.body`),
      skipBeacon: true,
      skipScroll: true,
      isFixed: true,
      spotlightTarget:
        id === "squad-pin-comparison"
          ? resolvedTarget
          : id === "heatmap-explore"
            ? heatmapSpotlight
            : id === "tactical-explore"
              ? tacticalSpotlight(tacticalStage)
              : undefined,
      disableFocusTrap: [
        "heatmap-explore",
        "tactical-explore",
        "zen-mode",
      ].includes(id),
      ...(id === "tactical-explore" && tacticalStage === "players"
        ? { hideOverlay: true }
        : {}),
      ...(id === "squad-pin-comparison" && squadStage === "comparison"
        ? {
            width: 272,
            zIndex: 120,
            floatingOptions: { flipOptions: false },
          }
        : {}),
      data: {
        id,
        interactive: !["dashboard-overview", "tour-complete"].includes(id),
        action: action || undefined,
      } satisfies ExploreTourStepData,
    }
  })
}
