import { afterEach, describe, expect, it, vi } from "vitest"
import { toBlob } from "html-to-image"
import {
  exportReportPng,
  reportFilename,
  reportReady,
} from "@/features/match-report/exportReport"
import type { MatchSnapshot } from "@/types/match"
import { reportFontEmbedCSS } from "@/features/match-report/reportFonts"
import { goalIconUrl } from "@/lib/goalIcon"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { ReportGoalMarker } from "@/features/match-report/ReportGoalMarker"
import {
  REPORT_WIDTH,
  REPORT_HEIGHT,
} from "@/features/match-report/reportTypes"

it("keeps chart goal markers in SVG with explicit image bounds for PNG export", () => {
  for (const size of [14, 16]) {
    const markup = renderToStaticMarkup(
      createElement(ReportGoalMarker, {
        x: 20,
        y: 30,
        size,
        color: "#abcdef",
        title: "45' Goal",
      })
    )
    expect(markup).not.toContain("foreignObject")
    expect(markup).not.toContain("<button")
    expect(markup).toContain(`<image href="data:image/svg+xml;`)
    expect(markup).toContain(`width="${size - 4}" height="${size - 4}"`)
  }
})

vi.mock("html-to-image", () => ({ toBlob: vi.fn() }))

// Vitest stubs CSS modules in Node. Supply their raw package contents so this
// test exercises the real font URL replacement used by the browser bundle.
const readFontCss = await vi.hoisted(async () => {
  const { readFileSync } = await import("node:fs")
  return (path: string) => readFileSync(`node_modules/${path}`, "utf8")
})
vi.mock("@fontsource-variable/inter?raw", () => ({
  default: readFontCss("@fontsource-variable/inter/index.css"),
}))
vi.mock("@fontsource-variable/big-shoulders-text?raw", () => ({
  default: readFontCss("@fontsource-variable/big-shoulders-text/index.css"),
}))
vi.mock("@fontsource/ibm-plex-mono/latin-400.css?raw", () => ({
  default: readFontCss("@fontsource/ibm-plex-mono/latin-400.css"),
}))
vi.mock("@fontsource/ibm-plex-mono/latin-600.css?raw", () => ({
  default: readFontCss("@fontsource/ibm-plex-mono/latin-600.css"),
}))

function report(state = "ready", charts = 2) {
  return {
    isConnected: true,
    offsetWidth: REPORT_WIDTH,
    offsetHeight: REPORT_HEIGHT,
    querySelectorAll: (selector: string) =>
      selector === "[data-report-heatmap]"
        ? [{ dataset: { reportHeatmap: state } }]
        : selector === "[data-report-chart]"
          ? Array.from({ length: charts }, () => ({
              querySelector: () => ({}),
            }))
          : [],
  } as unknown as HTMLElement
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe("match report export", () => {
  it("cancels a pending preparation when the report closes", async () => {
    const controller = new AbortController()
    vi.stubGlobal("document", { fonts: { ready: new Promise(() => {}) } })
    const exporting = exportReportPng(report(), "report.png", controller.signal)
    controller.abort()
    await expect(exporting).rejects.toMatchObject({ name: "AbortError" })
    expect(toBlob).not.toHaveBeenCalled()
  })

  it("does not download if closed during capture, and cancels further DOM cloning", async () => {
    const controller = new AbortController()
    vi.stubGlobal("document", { fonts: { ready: Promise.resolve() } })
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => callback())
    let finish!: (blob: Blob) => void
    vi.mocked(toBlob).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const exporting = exportReportPng(report(), "report.png", controller.signal)
    await vi.waitFor(() => expect(toBlob).toHaveBeenCalledOnce())
    const options = vi.mocked(toBlob).mock.calls[0][1]!
    expect(options.fetchRequestInit?.signal).toBe(controller.signal)
    controller.abort()
    expect(() => options.filter!({} as HTMLElement)).toThrow()
    const createUrl = vi.spyOn(URL, "createObjectURL")
    finish(new Blob(["png"]))
    await expect(exporting).rejects.toMatchObject({ name: "AbortError" })
    expect(createUrl).not.toHaveBeenCalled()
  })

  it("embeds font faces and goal icons without fetching local files", () => {
    expect(reportFontEmbedCSS).toContain("Inter Variable")
    expect(reportFontEmbedCSS).toContain("Big Shoulders Text Variable")
    expect(reportFontEmbedCSS).toContain("IBM Plex Mono")
    const fontUrls = [...reportFontEmbedCSS.matchAll(/url\("([^"]+)"\)/g)]
    expect(fontUrls.length).toBeGreaterThan(10)
    expect(fontUrls.every(([, url]) => url.startsWith("data:"))).toBe(true)
    expect(reportFontEmbedCSS).not.toContain("./files/")
    expect(reportFontEmbedCSS).toContain('font-family: "ABCSocial"')
    expect(reportFontEmbedCSS).toContain('font-family: "FMUniverse"')
    expect(goalIconUrl).toMatch(/^data:image\/svg\+xml/)
    expect(decodeURIComponent(goalIconUrl)).toContain("<svg")
  })
  it("requires both charts and a captured heatmap, and surfaces capture errors", () => {
    expect(reportReady(report())).toBe(true)
    expect(reportReady(report("loading"))).toBe(false)
    expect(reportReady(report("ready", 1))).toBe(false)
    expect(() => reportReady(report("error"))).toThrow("Heatmap")
  })

  it("never captures an unready report", async () => {
    await expect(
      exportReportPng(report("loading"), "report.png")
    ).rejects.toThrow("not ready")
    expect(toBlob).not.toHaveBeenCalled()
  })

  it("supports reports without a POM heatmap and waits for other report resources", () => {
    const element = report()
    const query = element.querySelectorAll
    let state = "loading"
    element.querySelectorAll = ((selector: string) =>
      selector === "[data-report-heatmap]"
        ? []
        : selector === "[data-report-resource]"
          ? [{ dataset: { reportResource: state } }]
          : query(selector)) as typeof query
    expect(reportReady(element)).toBe(false)
    state = "ready"
    expect(reportReady(element)).toBe(true)
    state = "error"
    expect(() => reportReady(element)).toThrow("Report resource failed")
  })

  it("waits for resources, downloads a 2x PNG, and releases the URL", async () => {
    const click = vi.fn()
    const remove = vi.fn()
    const decode = vi.fn(async () => {})
    const element = report()
    const query = element.querySelectorAll
    element.querySelectorAll = vi.fn((selector: string) =>
      selector === "img" ? [{ decode }] : query(selector)
    ) as typeof query
    vi.stubGlobal("document", {
      fonts: { ready: Promise.resolve() },
      body: { appendChild: vi.fn() },
      createElement: () => ({ click, remove }),
    })
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => callback())
    vi.stubGlobal("window", {
      setTimeout: (callback: () => void) => callback(),
    })
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:report")
    vi.mocked(toBlob).mockResolvedValue(
      new Blob(["png"], { type: "image/png" })
    )
    await exportReportPng(element, "report.png")
    expect(decode).toHaveBeenCalled()
    expect(toBlob).toHaveBeenCalledWith(
      element,
      expect.objectContaining({
        width: 1280,
        height: 840,
        pixelRatio: 2,
        fontEmbedCSS: reportFontEmbedCSS,
      })
    )
    expect(click).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledOnce()
    expect(revoke).toHaveBeenCalledWith("blob:report")
    vi.mocked(toBlob).mockResolvedValue(null)
    await expect(exportReportPng(element, "report.png")).rejects.toThrow(
      "empty Blob"
    )
  })

  it("sanitizes team names and labels the local export date", () => {
    const match = {
      home: { name: "A/B:*" },
      away: { name: 'C"D?' },
    } as MatchSnapshot
    expect(reportFilename(match, new Date(2026, 10, 17))).toBe(
      "FMMatchLens_A_B___vs_C_D__exported-2026-11-17_match-report.png"
    )
  })
})
