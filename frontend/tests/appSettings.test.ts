import { afterEach, describe, expect, it, vi } from "vitest"
import { appShortcuts } from "@/lib/appShortcuts"
import {
  defaultAppSettings,
  parseAppSettings,
  updateAppSettings,
} from "@/lib/appSettings"

afterEach(() => vi.unstubAllGlobals())

describe("app settings", () => {
  it.each([
    null,
    undefined,
    42,
    [],
    {},
    { toolbar: { language: "true" }, shortcuts: { tactical: 4 } },
  ])("defaults missing or malformed settings: %j", (value) => {
    expect(parseAppSettings(value)).toEqual(defaultAppSettings)
  })

  it("defaults only the language toolbar control to hidden", () => {
    expect(defaultAppSettings.toolbar).toEqual({
      tour: true,
      fullscreen: true,
      shortcuts: true,
      appearance: true,
      language: false,
    })
  })

  it("preserves disabled controls, cleared bindings and valid key swaps", () => {
    const saved = parseAppSettings({
      toolbar: { tour: false },
      shortcuts: {
        tactical: "H",
        heatmap: "T",
        zen: "",
        fullscreen: "Q",
        removed: "X",
      },
    })
    expect(saved.toolbar.tour).toBe(false)
    expect(saved.shortcuts).toEqual({ tactical: "H", heatmap: "T", zen: "" })
  })

  it("discards invalid stored combinations and resolves ambiguous bindings", () => {
    const saved = parseAppSettings({
      shortcuts: {
        tactical: "Alt+Space",
        heatmap: "Shift+Tab",
        theme: "unknown",
        zen: "K",
        matchStats: "K",
        formation: "F11",
      },
    })
    expect(saved.shortcuts).toEqual({ zen: "K", matchStats: "" })
    const effective = appShortcuts
      .map((item) => saved.shortcuts[item.id] ?? item.displayKey)
      .filter(Boolean)
    expect(new Set(effective).size).toBe(effective.length)
  })

  it("persists changes and keeps updates usable when storage is blocked", () => {
    const setItem = vi.fn()
    vi.stubGlobal("localStorage", { setItem })
    updateAppSettings(defaultAppSettings)
    expect(setItem).toHaveBeenCalledWith(
      "fmmatchlens.preferences.v1.settings",
      JSON.stringify(defaultAppSettings)
    )
    vi.stubGlobal("localStorage", {
      setItem: () => {
        throw new Error("blocked")
      },
    })
    expect(() => updateAppSettings(defaultAppSettings)).not.toThrow()
  })
})
