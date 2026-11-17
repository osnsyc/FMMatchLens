export type Scheme = "light" | "dark"
export type SchemePreference = Scheme | "system"
export type ColorVisionMode = "standard" | "colorblind"
export type ContrastMode = "normal" | "high"

export type AppearanceSettings = {
  presetId: string
  schemePreference: SchemePreference
  colorVision: ColorVisionMode
  contrast: ContrastMode
}

export type ThemePreset = {
  id: string
  labelKey: string
  supportedSchemes: readonly Scheme[]
  defaultScheme: Scheme
  teamColorMode: "source" | "fixed"
}

export type ResolvedVizTokens = {
  presetId: string
  scheme: Scheme
  colorVision: ColorVisionMode
  contrast: ContrastMode
  pitchLabelFont: string
  pitchControlContour: string
  surfacePage: string
  surfacePanel: string
  textPrimary: string
  tacticalPitchSurface: string
  pitchLine: string
  eventImportant: string
  eventContrast: string
  eventMarkerForeground: string
  eventMarkerShadow: string
  eventTrajectory: string
  eventSelected: string
  eventHistorical: string
  homeFallback: string
  awayFallback: string
  heatmapStops: readonly [string, string, string, string, string, string]
}
