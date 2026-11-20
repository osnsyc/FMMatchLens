import { afterEach, describe, expect, it, vi } from "vitest"
import type { ReactElement } from "react"
import type { HeatmapRenderData } from "@/api/heatmap"
import type { MatchSnapshot } from "@/types/match"

// Drive effect setup/cleanup explicitly, including async work finishing after
// unmount. No DOM renderer or GPU is needed to test resource ownership.
const hooks = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  host: { dataset: {} as Record<string, string>, replaceChildren: vi.fn() },
  setState: vi.fn(),
  refs: [] as unknown[],
}))
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useRef: (value: unknown) => ({
    current: hooks.refs.length
      ? hooks.refs.shift()
      : value === null
        ? hooks.host
        : value,
  }),
  useEffect: (effect: () => void | (() => void)) => hooks.effects.push(effect),
  useState: (value: unknown) => [value, hooks.setState],
}))
vi.mock("@/components/theme-provider", () => ({
  useTheme: () => ({ settings: {}, resolvedScheme: "dark" }),
}))
vi.mock("@/components/heatmap/PixiHeatmapRenderer", () => ({
  PixiHeatmapRenderer: { create: vi.fn() },
}))
vi.mock("@/features/match-report/MatchReport", () => ({
  MatchReport: () => null,
}))
vi.mock("@/features/match-report/exportReport", () => ({
  reportReady: () => true,
  reportFilename: () => "report.png",
  exportReportPng: vi.fn(),
}))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import { PixiHeatmap } from "@/components/heatmap/PixiHeatmap"
import { PixiHeatmapRenderer } from "@/components/heatmap/PixiHeatmapRenderer"
import { ReportImage } from "@/features/match-report/ReportImage"
import { MatchReportDialog } from "@/features/match-report/MatchReportDialog"
import { exportReportPng } from "@/features/match-report/exportReport"

afterEach(() => {
  hooks.effects.length = 0
  hooks.refs.length = 0
  hooks.host.dataset = {}
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function mountHeatmap() {
  const props = {
    data: {} as HeatmapRenderData,
    width: 20,
    height: 30,
    exportMode: true,
  }
  const element = PixiHeatmap(props) as ReactElement<typeof props>
  ;(element.type as (props: typeof element.props) => unknown)(element.props)
  return hooks.effects.at(-1)!() as () => void
}

function renderer() {
  return {
    updateLut: vi.fn(),
    updateToneMapping: vi.fn(),
    update: vi.fn(),
    capturePngDataUrl: vi.fn(),
    destroy: vi.fn(),
  }
}

function stubStyle() {
  vi.stubGlobal("document", { documentElement: {} })
  vi.stubGlobal("getComputedStyle", () => ({
    getPropertyValue: () => "#ffffff",
  }))
}

describe("report resource lifetime", () => {
  it("disconnects observers, cancels export, and clears preparation timeout when the dialog unmounts", async () => {
    vi.useFakeTimers()
    vi.stubGlobal("window", globalThis)
    const disconnect = vi.fn()
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect = disconnect
      }
    )
    vi.stubGlobal(
      "MutationObserver",
      class {
        observe() {}
        disconnect = disconnect
      }
    )
    const host = {
      clientWidth: 1280,
      clientHeight: 840,
      querySelector: () => ({}),
    }
    hooks.refs.push(host, host, false, null, false)
    const match = {} as MatchSnapshot
    const dialog = MatchReportDialog({ match, onClose: vi.fn() })
    // The popup's second child is the preview. Drive that component's effects.
    const portal = dialog.props.children as ReactElement<{
      children: ReactElement[]
    }>
    const popup = portal.props.children[1] as ReactElement<{
      children: ReactElement[]
    }>
    const preview = popup.props.children[1] as ReactElement<{
      match: MatchSnapshot
    }>
    const tree = (
      preview.type as (
        props: typeof preview.props
      ) => ReactElement<{ children: ReactElement[] }>
    )(preview.props)
    const cleanups = hooks.effects
      .map((effect) => effect())
      .filter((cleanup) => typeof cleanup === "function")
    expect(vi.getTimerCount()).toBe(1)
    const footer = tree.props.children[1] as ReactElement<{
      children: ReactElement[]
    }>
    const save = footer.props.children[1] as ReactElement<{
      onClick: () => void
    }>
    let finish!: () => void
    vi.mocked(exportReportPng).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    save.props.onClick()
    const signal = vi.mocked(exportReportPng).mock.calls[0][2]!
    expect(signal.aborted).toBe(false)
    cleanups.forEach((cleanup) => cleanup())
    expect(signal.aborted).toBe(true)
    expect(disconnect).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
    const stateUpdates = hooks.setState.mock.calls.length
    finish()
    await Promise.resolve()
    await Promise.resolve()
    expect(hooks.setState).toHaveBeenCalledTimes(stateUpdates)
  })

  it("destroys a renderer that finishes initialization after close", async () => {
    const gpu = renderer()
    let finish!: (value: unknown) => void
    vi.mocked(PixiHeatmapRenderer.create).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve as (value: unknown) => void
        })
    )
    const close = mountHeatmap()
    close()
    finish(gpu)
    await vi.waitFor(() => expect(gpu.destroy).toHaveBeenCalledOnce())
    expect(gpu.capturePngDataUrl).not.toHaveBeenCalled()
    expect(hooks.host.replaceChildren).toHaveBeenLastCalledWith()
  })

  it("releases GPU resources immediately when closed during capture", async () => {
    stubStyle()
    const gpu = renderer()
    let finish!: (url: string) => void
    gpu.capturePngDataUrl.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    vi.mocked(PixiHeatmapRenderer.create).mockResolvedValueOnce(
      gpu as unknown as PixiHeatmapRenderer
    )
    const image = vi.fn()
    vi.stubGlobal("Image", image)
    const close = mountHeatmap()
    await vi.waitFor(() => expect(gpu.capturePngDataUrl).toHaveBeenCalledOnce())
    close()
    expect(gpu.destroy).toHaveBeenCalledOnce()
    finish("data:image/png;base64,test")
    await Promise.resolve()
    await Promise.resolve()
    expect(image).not.toHaveBeenCalled()
    expect(gpu.destroy).toHaveBeenCalledOnce()
  })

  it("releases the GPU before decoding the captured image and clears the image on close", async () => {
    stubStyle()
    const gpu = renderer()
    gpu.capturePngDataUrl.mockResolvedValueOnce("data:image/png;base64,test")
    vi.mocked(PixiHeatmapRenderer.create).mockResolvedValueOnce(
      gpu as unknown as PixiHeatmapRenderer
    )
    const decoded = {
      src: "",
      decode: vi.fn(() => new Promise(() => {})),
      removeAttribute: vi.fn(),
    }
    vi.stubGlobal(
      "Image",
      class {
        constructor() {
          return decoded
        }
      }
    )
    const close = mountHeatmap()
    await vi.waitFor(() => expect(decoded.decode).toHaveBeenCalledOnce())
    expect(gpu.destroy).toHaveBeenCalledOnce()
    close()
    expect(decoded.removeAttribute).toHaveBeenCalledWith("src")
    expect(hooks.host.replaceChildren).toHaveBeenLastCalledWith()
  })

  it("aborts image requests and clears their timeout without a late state update", async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    let reject!: (error: unknown) => void
    vi.stubGlobal("window", globalThis)
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, options) => {
        signal = options.signal
        return new Promise((_resolve, rejectRequest) => {
          reject = rejectRequest
        })
      })
    )
    ReportImage({
      src: "https://example.com/image.png",
      alt: "",
      className: "",
      children: null,
    })
    const close = hooks.effects.at(-1)!() as () => void
    expect(signal?.aborted).toBe(false)
    expect(vi.getTimerCount()).toBe(1)
    close()
    expect(signal?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    reject(new DOMException("Aborted", "AbortError"))
    await Promise.resolve()
    await Promise.resolve()
    expect(hooks.setState).not.toHaveBeenCalled()
  })
})
