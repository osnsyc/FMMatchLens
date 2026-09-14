import type { ThemePreset } from "@/theme/types"

export const fmPreset: ThemePreset = {
  id: "fm",
  labelKey: "appearance.presets.fm",
  supportedSchemes: ["light", "dark"],
  defaultScheme: "dark",
  preview: {
    surface: "#141426",
    primary: "#af78ff",
    positive: "#34d399",
    negative: "#ff7188",
  },
}
