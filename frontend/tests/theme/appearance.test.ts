import { describe, expect, it } from "vitest"

import { createThemeRegistry, getThemePreset } from "../../src/theme/registry"
import { isSchemeLocked, resolveScheme } from "../../src/theme/resolveAppearance"
import {
  APPEARANCE_STORAGE_KEY,
  LEGACY_THEME_STORAGE_KEY,
  loadAppearance,
  parseAppearance,
} from "../../src/theme/storage"
import type { ThemePreset } from "../../src/theme/types"
import { selectTeamDisplayColors, teamColorCacheKey } from "../../src/lib/teamColors"

const fm = getThemePreset("fm")
const opta = getThemePreset("opta-inspired")
const wyscout = getThemePreset("wyscout-inspired")

describe("appearance resolution", () => {
  it.each([
    ["light", "dark", fm, "light"],
    ["dark", "light", fm, "dark"],
    ["system", "light", fm, "light"],
    ["system", "dark", fm, "dark"],
    ["light", "light", opta, "light"],
    ["dark", "light", opta, "dark"],
    ["dark", "dark", wyscout, "light"],
  ] as const)("resolves %s with a %s system", (preference, system, preset, expected) => {
    expect(resolveScheme(preference, system, preset)).toBe(expected)
  })

  it("locks only single-scheme presets without changing the preference", () => {
    const preference = "light" as const
    expect(isSchemeLocked(opta)).toBe(false)
    expect(isSchemeLocked(wyscout)).toBe(true)
    expect(resolveScheme("dark", "dark", wyscout)).toBe("light")
    expect(resolveScheme(preference, "dark", fm)).toBe("light")
  })
})

describe("appearance persistence", () => {
  it("recovers invalid fields independently", () => {
    expect(parseAppearance(JSON.stringify({
      presetId: "missing",
      schemePreference: "light",
      colorVision: "invalid",
      contrast: "high",
    }))).toEqual({
      presetId: "fm",
      schemePreference: "light",
      colorVision: "standard",
      contrast: "high",
    })
  })

  it("recovers malformed JSON", () => {
    expect(parseAppearance("{" ).presetId).toBe("fm")
  })

  it("migrates and removes the legacy key", () => {
    const values = new Map([[LEGACY_THEME_STORAGE_KEY, "light"]])
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => { values.delete(key) },
    } as Storage
    expect(loadAppearance(storage).schemePreference).toBe("light")
    expect(values.has(LEGACY_THEME_STORAGE_KEY)).toBe(false)
    expect(values.has(APPEARANCE_STORAGE_KEY)).toBe(true)
  })
})

describe("theme registry", () => {
  it("registers both inspired presets with their supported schemes", () => {
    expect(getThemePreset("opta-inspired").supportedSchemes).toEqual(["light", "dark"])
    expect(getThemePreset("wyscout-inspired").supportedSchemes).toEqual(["light"])
    expect(getThemePreset("opta-inspired").teamColors).toEqual({
      mode: "fixed",
      home: "#6327c6",
      away: "#dc3a44",
    })
    expect(getThemePreset("wyscout-inspired").teamColors).toEqual({
      mode: "fixed",
      home: "#e05a35",
      away: "#26648c",
    })
  })

  it("rejects duplicate ids", () => {
    const preset: ThemePreset = {
      ...fm,
      preview: { ...fm.preview },
    }
    expect(() => createThemeRegistry([preset, preset])).toThrow(/Duplicate/)
  })
})

describe("team color cache", () => {
  it("uses preset-fixed colors instead of club metadata", () => {
    expect(selectTeamDisplayColors(
      { backgroundColour: 0x112233 },
      { backgroundColour: 0xfefefe },
      {
        presetId: "opta-inspired",
        resolvedScheme: "light",
        colorVision: "standard",
        fixedTeamColors: { home: "#6327c6", away: "#dc3a44" },
      }
    )).toEqual({ home: "#6327c6", away: "#dc3a44" })
  })

  it("keys derived colors by preset, resolved scheme and color vision", () => {
    expect(teamColorCacheKey({
      presetId: "opta-inspired",
      resolvedScheme: "dark",
      colorVision: "colorblind",
    })).toBe("opta-inspired:dark:colorblind")
  })
})
