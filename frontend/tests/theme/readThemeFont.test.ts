import { afterEach, describe, expect, it, vi } from "vitest"
import { loadThemeFont, readThemeFont } from "../../src/theme/readThemeFont"

afterEach(() => vi.unstubAllGlobals())

describe("theme font resolution", () => {
  function setup() {
    const probe = { style: { fontFamily: "" }, remove: vi.fn() }
    const load = vi.fn().mockResolvedValue([])
    vi.stubGlobal("document", {
      createElement: () => probe,
      documentElement: { appendChild: vi.fn() },
      fonts: { load },
    })
    vi.stubGlobal("getComputedStyle", () => ({
      fontFamily: '"Inter Variable", Arial, sans-serif',
    }))
    return { probe, load }
  }

  it("resolves aliases through computed style and removes its probe", () => {
    const { probe } = setup()
    expect(readThemeFont("font-pitch-label")).toEqual(["Inter Variable", "Arial", "sans-serif"])
    expect(probe.style.fontFamily).toBe("var(--font-pitch-label)")
    expect(probe.remove).toHaveBeenCalledOnce()
  })

  it("waits for font loading and tolerates an unavailable family", async () => {
    const { load } = setup()
    load.mockRejectedValueOnce(new Error("Unavailable font"))
    await expect(loadThemeFont("font-pitch-label")).resolves.toBeUndefined()
    expect(load).toHaveBeenCalledWith('bold 12px "Inter Variable"')
    expect(load).toHaveBeenCalledWith('bold 12px "Arial"')
  })
})
