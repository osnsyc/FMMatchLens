import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { selectTeamDisplayColors, selectTeamThemeColors } from "../../src/lib/teamColors"

beforeEach(() => {
  const context = {
    fillStyle: "#000000",
    clearRect() {},
    fillRect() {},
    getImageData() {
      const value = Number.parseInt(this.fillStyle.slice(1), 16)
      return { data: [value >>> 16, (value >>> 8) & 255, value & 255, 255] }
    },
  }
  vi.stubGlobal("document", {
    documentElement: {},
    body: { appendChild() {} },
    createElement: (tag: string) => tag === "canvas"
      ? { getContext: () => context }
      : { style: {}, remove() {} },
  })
  vi.stubGlobal("getComputedStyle", () => ({
    backgroundColor: "#FFFFFF",
    color: "#FFFFFF",
    getPropertyValue: (name: string) => name.includes("fallback") ? "#880000" : "#FFFFFF",
  }))
})

afterEach(() => vi.unstubAllGlobals())

const appearance = { presetId: "fm", resolvedScheme: "light", colorVision: "standard" } as const
const away = { backgroundColour: 0xff000088 }

describe("shirt background team colors", () => {
  it("prefers readable shirt background over club colors in both selection paths", () => {
    const home = { shirtBackgroundColor: 0xffbb0000, backgroundColour: 0xff000000 }
    expect(selectTeamDisplayColors(home, away, appearance).home).toBe("#BB0000")
    expect(selectTeamThemeColors(home, away).home).toEqual({ light: "#BB0000", dark: "#BB0000" })
  })

  it("invalidates cached display colors when only the shirt background changes", () => {
    const source = { shirtBackgroundColor: 0xffaa0000, backgroundColour: 0xff000000 }
    expect(selectTeamDisplayColors(source, away, appearance).home).toBe("#AA0000")
    expect(selectTeamDisplayColors({ ...source, shirtBackgroundColor: 0xff008800 }, away, appearance).home).toBe("#008800")
  })

  it("falls back when shirt background is missing or invalid and excludes spare colors", () => {
    for (const shirtBackgroundColor of [undefined, 0, Number.NaN]) {
      expect(selectTeamDisplayColors({
        shirtBackgroundColor,
        backgroundColour: 0xff990000,
        shirtNumberColor: 0xff000000,
        shirtBackgroundColorGK: 0xff004400,
      }, away, appearance).home).toBe("#990000")
    }
  })

  it("retains readability and team separation constraints", () => {
    expect(selectTeamDisplayColors({ shirtBackgroundColor: 0xffffffff, backgroundColour: 0xff990000 }, away, appearance).home).toBe("#990000")
    expect(selectTeamDisplayColors({ shirtBackgroundColor: 0xff000088, backgroundColour: 0xff990000 }, away, appearance).home).toBe("#990000")
  })
})
