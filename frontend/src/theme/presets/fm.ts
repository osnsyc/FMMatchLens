import type { ThemePreset } from "@/theme/types"

export const fmPreset: ThemePreset = {
  id: "fm",
  labelKey: "appearance.presets.fm",
  supportedSchemes: ["light", "dark"],
  defaultScheme: "dark",
  teamColorMode: "source",
}
