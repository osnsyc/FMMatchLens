import type { ThemePreset } from "@/theme/types"

export const optaInspiredPreset: ThemePreset = {
  id: "opta-inspired",
  labelKey: "appearance.presets.opta",
  supportedSchemes: ["light", "dark"],
  defaultScheme: "dark",
  teamColors: {
    mode: "fixed",
    home: "#6327c6",
    away: "#dc3a44",
  },
  preview: {
    surface: "#1d0a30",
    primary: "#fd4890",
    positive: "#38d6a3",
    negative: "#ff6b7a",
  },
}
