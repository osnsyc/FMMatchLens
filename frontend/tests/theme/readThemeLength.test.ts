import { afterEach, describe, expect, it, vi } from "vitest"
import { readThemeLength } from "../../src/theme/readThemeLength"

afterEach(() => vi.unstubAllGlobals())

describe("theme length resolution", () => {
  function setup(value: string, pixels: string, supported = true) {
    const root = { appendChild: vi.fn() }
    const probe = { style: { cssText: "", width: "" }, remove: vi.fn() }
    vi.stubGlobal("document", { documentElement: root, createElement: () => probe })
    vi.stubGlobal("CSS", { supports: () => supported })
    vi.stubGlobal("getComputedStyle", (element: unknown) => element === root
      ? { getPropertyValue: () => value } : { width: pixels })
    return { root, probe }
  }

  it.each([["0.125rem", "2px", 2], ["calc(1.5px * 2)", "3px", 3], ["0px", "0px", 0]] as const)(
    "uses the browser's computed size for %s", (value, pixels, expected) => {
      const { probe } = setup(value, pixels)
      expect(readThemeLength("pitch-control-contour-width", 1)).toBe(expected)
      expect(probe.style.width).toBe(value)
      expect(probe.remove).toHaveBeenCalledOnce()
    }
  )

  it("falls back for missing, invalid and non-finite lengths", () => {
    setup("", "auto")
    expect(readThemeLength("missing", 1)).toBe(1)
    setup("red", "auto", false)
    expect(readThemeLength("invalid", 1)).toBe(1)
    const { probe } = setup("1px", "auto")
    expect(readThemeLength("invalid-layout", 1)).toBe(1)
    expect(probe.remove).toHaveBeenCalledOnce()
  })
})
