import type {
  ColorVisionMode,
  ResolvedVizTokens,
  Scheme,
} from "@/theme/types"

export function cssVizTokens(
  presetId: string,
  scheme: Scheme,
  colorVision: ColorVisionMode
): ResolvedVizTokens {
  return {
    presetId,
    scheme,
    colorVision,
    surfacePage: "var(--surface-page)",
    surfacePanel: "var(--surface-panel)",
    textPrimary: "var(--text-primary)",
    tacticalPitchSurface: "var(--tactical-pitch-surface)",
    pitchLine: "var(--pitch-line)",
    eventImportant: "var(--event-important)",
    eventContrast: "var(--event-contrast)",
    eventMarkerForeground: "var(--event-marker-foreground)",
    eventMarkerShadow: "var(--event-marker-shadow)",
    eventTrajectory: "var(--event-trajectory)",
    eventSelected: "var(--event-selected)",
    eventHistorical: "var(--event-historical)",
    homeFallback: "var(--viz-home-fallback)",
    awayFallback: "var(--viz-away-fallback)",
    heatmapStops: [
      "var(--heatmap-stop-0)", "var(--heatmap-stop-1)",
      "var(--heatmap-stop-2)", "var(--heatmap-stop-3)",
      "var(--heatmap-stop-4)", "var(--heatmap-stop-5)",
    ],
  }
}
