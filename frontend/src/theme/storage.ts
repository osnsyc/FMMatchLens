import { DEFAULT_PRESET_ID, isPresetId } from "@/theme/registry"
import type {
  AppearanceSettings,
  ColorVisionMode,
  ContrastMode,
  SchemePreference,
} from "@/theme/types"

export const APPEARANCE_STORAGE_KEY = "fmmatchlens.appearance.v1"
export const LEGACY_THEME_STORAGE_KEY = "theme"

export const defaultAppearance: AppearanceSettings = {
  presetId: DEFAULT_PRESET_ID,
  schemePreference: "dark",
  colorVision: "standard",
  contrast: "normal",
}

const schemes: readonly SchemePreference[] = ["system", "light", "dark"]
const colorVisionModes: readonly ColorVisionMode[] = ["standard", "colorblind"]
const contrastModes: readonly ContrastMode[] = ["normal", "high"]

function oneOf<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === "string" && values.includes(value as T)
    ? (value as T)
    : fallback
}

export function sanitizeAppearance(value: unknown): AppearanceSettings {
  const candidate = value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {}
  return {
    presetId: isPresetId(candidate.presetId)
      ? candidate.presetId
      : defaultAppearance.presetId,
    schemePreference: oneOf(
      candidate.schemePreference,
      schemes,
      defaultAppearance.schemePreference
    ),
    colorVision: oneOf(
      candidate.colorVision,
      colorVisionModes,
      defaultAppearance.colorVision
    ),
    contrast: oneOf(
      candidate.contrast,
      contrastModes,
      defaultAppearance.contrast
    ),
  }
}

export function serializeAppearance(settings: AppearanceSettings) {
  return JSON.stringify({ version: 1, ...settings })
}

export function parseAppearance(raw: string | null): AppearanceSettings {
  if (!raw) return defaultAppearance
  try {
    return sanitizeAppearance(JSON.parse(raw))
  } catch {
    return defaultAppearance
  }
}

export function loadAppearance(storage: Storage): AppearanceSettings {
  const current = storage.getItem(APPEARANCE_STORAGE_KEY)
  if (current !== null) return parseAppearance(current)

  const legacy = storage.getItem(LEGACY_THEME_STORAGE_KEY)
  const migrated = sanitizeAppearance({
    ...defaultAppearance,
    schemePreference: schemes.includes(legacy as SchemePreference)
      ? legacy
      : defaultAppearance.schemePreference,
  })
  if (legacy !== null) {
    storage.setItem(APPEARANCE_STORAGE_KEY, serializeAppearance(migrated))
    storage.removeItem(LEGACY_THEME_STORAGE_KEY)
  }
  return migrated
}
