import type { ThemePreset } from "@/theme/types"

export const sofascoreInspiredPreset: ThemePreset = {
  id: "sofascore-inspired",
  labelKey: "appearance.presets.sofascore",
  supportedSchemes: ["light", "dark"],
  defaultScheme: "light",
  teamColors: {
    mode: "fixed",
    home: "#0bb32a",
    away: "#374df5",
    dark: { home: "#0bb32a", away: "#8794f9" },
  },
  preview: {
    surface: "#edf1f6",
    primary: "#374df5",
    positive: "#15b168",
    negative: "#c7361f",
  },
}
