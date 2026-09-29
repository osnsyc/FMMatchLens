export const exploreTourEventName = "fmmatchlens:explore-tour"
export const exploreTourPromptEventName = "fmmatchlens:explore-tour-prompt"
export const exploreTourTimelineSeekEventName =
  "fmmatchlens:explore-tour-timeline-seek"
export const exploreTourCloseOverlaysEventName =
  "fmmatchlens:explore-tour-close-overlays"
export const exploreTourTacticalMetricsEventName =
  "fmmatchlens:explore-tour-tactical-metrics"

export type ExploreTourInteraction =
  | { id: "timeline-drag-committed" }
  | { id: "formation-view-change"; value: string }
  | { id: "heatmap-range-change"; value: string }
  | { id: "heatmap-phase-change"; value: string }
  | { id: "heatmap-player-select"; playerId: number }
  | { id: "tactical-shot-select"; eventId: string }
  | { id: "tactical-empty-click" }
  | { id: "tactical-filter-change"; value: string }
  | { id: "theme-preset-change"; value: string }

export function emitExploreTourInteraction(detail: ExploreTourInteraction) {
  if (!document.documentElement.hasAttribute("data-explore-tour-active")) return
  window.dispatchEvent(
    new CustomEvent<ExploreTourInteraction>(exploreTourEventName, { detail })
  )
}

export type ExploreTourPrompt = {
  stepId: string
  body?: string
  action?: string
}

export function emitExploreTourPrompt(detail: ExploreTourPrompt) {
  window.dispatchEvent(
    new CustomEvent<ExploreTourPrompt>(exploreTourPromptEventName, { detail })
  )
}
