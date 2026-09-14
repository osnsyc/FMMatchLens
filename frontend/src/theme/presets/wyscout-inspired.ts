import type { ThemePreset } from "@/theme/types"

export const wyscoutInspiredPreset: ThemePreset = {
  id: "wyscout-inspired",
  labelKey: "appearance.presets.wyscout",
  supportedSchemes: ["light"],
  defaultScheme: "light",
  teamColors: {
    mode: "fixed",
    home: "#e05a35",
    away: "#26648c",
  },
  preview: {
    surface: "#ffffff",
    primary: "#e05a35",
    positive: "#16705a",
    negative: "#c63d4f",
  },
}
