import { fmPreset } from "@/theme/presets/fm"
import { optaInspiredPreset } from "@/theme/presets/opta-inspired"
import { wyscoutInspiredPreset } from "@/theme/presets/wyscout-inspired"
import type { ThemePreset } from "@/theme/types"

export const DEFAULT_PRESET_ID = "fm"

export function createThemeRegistry(presets: readonly ThemePreset[]) {
  const registry = new Map<string, ThemePreset>()
  for (const preset of presets) {
    if (registry.has(preset.id)) {
      throw new Error(`Duplicate theme preset id: ${preset.id}`)
    }
    if (!preset.supportedSchemes.includes(preset.defaultScheme)) {
      throw new Error(`Theme preset ${preset.id} has an unsupported default scheme`)
    }
    registry.set(preset.id, preset)
  }
  return registry
}

export const themeRegistry = createThemeRegistry([
  fmPreset,
  optaInspiredPreset,
  wyscoutInspiredPreset,
])

export const themePresets = [...themeRegistry.values()]

export function getThemePreset(id: string): ThemePreset {
  return themeRegistry.get(id) ?? themeRegistry.get(DEFAULT_PRESET_ID)!
}

export function isPresetId(id: unknown): id is string {
  return typeof id === "string" && themeRegistry.has(id)
}
