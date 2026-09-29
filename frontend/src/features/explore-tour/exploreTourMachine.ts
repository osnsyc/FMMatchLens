export type ExploreTourSquadStage = "home" | "away" | "comparison"
export type ExploreTourTacticalStage = "pitch" | "focused" | "players"

export type ExploreTourMachineState = {
  squadHoverReady: boolean
  drawerOpened: boolean
  formationPhase: "possession" | "pin" | "time"
  heatmapPhase: "range" | "possession" | "player" | "focus" | "restore"
  archiveOpened: boolean
  themeOpened: boolean
  tacticalPhase: "shot" | "chain" | "focus" | "filter" | "players"
}

export type ExploreTourMachineAction =
  | { type: "squad-hover-ready" }
  | { type: "drawer-opened" }
  | { type: "formation-view-changed" }
  | { type: "formation-pin-selected" }
  | { type: "heatmap-range-selected" }
  | { type: "heatmap-phase-selected" }
  | { type: "heatmap-player-selected" }
  | { type: "heatmap-focused" }
  | { type: "archive-opened" }
  | { type: "theme-opened" }
  | { type: "tactical-shot-selected" }
  | { type: "tactical-chain-closed" }
  | { type: "tactical-focused" }
  | { type: "tactical-focus-failed" }
  | { type: "tactical-individual-selected" }

export function createExploreTourMachineState(): ExploreTourMachineState {
  return {
    squadHoverReady: false,
    drawerOpened: false,
    formationPhase: "possession",
    heatmapPhase: "range",
    archiveOpened: false,
    themeOpened: false,
    tacticalPhase: "shot",
  }
}

export function reduceExploreTourMachine(
  state: ExploreTourMachineState,
  action: ExploreTourMachineAction
): ExploreTourMachineState {
  switch (action.type) {
    case "squad-hover-ready":
      return state.squadHoverReady ? state : { ...state, squadHoverReady: true }
    case "drawer-opened":
      return state.drawerOpened ? state : { ...state, drawerOpened: true }
    case "formation-view-changed":
      return state.formationPhase === "possession"
        ? { ...state, formationPhase: "pin" }
        : state
    case "formation-pin-selected":
      return state.formationPhase === "pin"
        ? { ...state, formationPhase: "time" }
        : state
    case "heatmap-range-selected":
      return state.heatmapPhase === "range"
        ? { ...state, heatmapPhase: "possession" }
        : state
    case "heatmap-phase-selected":
      return state.heatmapPhase === "possession"
        ? { ...state, heatmapPhase: "player" }
        : state
    case "heatmap-player-selected":
      return state.heatmapPhase === "player"
        ? { ...state, heatmapPhase: "focus" }
        : state
    case "heatmap-focused":
      return state.heatmapPhase === "focus"
        ? { ...state, heatmapPhase: "restore" }
        : state
    case "archive-opened":
      return state.archiveOpened ? state : { ...state, archiveOpened: true }
    case "theme-opened":
      return state.themeOpened ? state : { ...state, themeOpened: true }
    case "tactical-shot-selected":
      return state.tacticalPhase === "shot"
        ? { ...state, tacticalPhase: "chain" }
        : state
    case "tactical-chain-closed":
      return state.tacticalPhase === "chain"
        ? { ...state, tacticalPhase: "focus" }
        : state
    case "tactical-focused":
      return state.tacticalPhase === "focus"
        ? { ...state, tacticalPhase: "filter" }
        : state
    case "tactical-focus-failed":
      return state.tacticalPhase === "filter"
        ? { ...state, tacticalPhase: "focus" }
        : state
    case "tactical-individual-selected":
      return state.tacticalPhase === "filter"
        ? { ...state, tacticalPhase: "players" }
        : state
  }
}
