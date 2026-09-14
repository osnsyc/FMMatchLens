import type {
  Scheme,
  SchemePreference,
  ThemePreset,
} from "@/theme/types"

export function resolveScheme(
  preference: SchemePreference,
  systemScheme: Scheme,
  preset: ThemePreset
): Scheme {
  const preferred = preference === "system" ? systemScheme : preference
  return preset.supportedSchemes.includes(preferred)
    ? preferred
    : preset.defaultScheme
}

export function isSchemeLocked(preset: ThemePreset) {
  return preset.supportedSchemes.length === 1
}
