import { afterEach, describe, expect, it, vi } from "vitest"
import { PixiHeatmapRenderer } from "@/components/heatmap/PixiHeatmapRenderer"

afterEach(() => vi.unstubAllGlobals())

describe("report heatmap PNG export", () => {
  it("exports translucent edges without darkening RGB a second time, at 2x", async () => {
    vi.stubGlobal("window", { devicePixelRatio: 1 })
    const image = { data: new Uint8ClampedArray(12) }
    const putImageData = vi.fn()
    vi.stubGlobal("document", {
      createElement: () => ({
        getContext: () => ({ createImageData: () => image, putImageData }),
        toDataURL: () => "data:image/png;base64,heatmap",
      }),
    })
    const gpu = {
      screen: {},
      extract: {
        pixels: vi.fn(() => ({
          pixels: new Uint8ClampedArray([
            24, 24, 24, 24, 60, 30, 15, 128, 0, 0, 0, 0,
          ]),
          width: 3,
          height: 1,
        })),
      },
    }
    const renderer = Object.assign(
      Object.create(PixiHeatmapRenderer.prototype),
      {
        renderer: gpu,
        stage: {},
        renderOnce: vi.fn(),
      }
    ) as PixiHeatmapRenderer
    await expect(renderer.capturePngDataUrl()).resolves.toBe(
      "data:image/png;base64,heatmap"
    )
    expect(gpu.extract.pixels).toHaveBeenCalledWith(
      expect.objectContaining({
        resolution: 2,
        frame: gpu.screen,
      })
    )
    expect([...image.data]).toEqual([
      255, 255, 255, 24, 120, 60, 30, 128, 0, 0, 0, 0,
    ])
    expect(putImageData).toHaveBeenCalledWith(image, 0, 0)
    vi.mocked(gpu.extract.pixels).mockImplementationOnce(() => {
      throw new Error("GPU unavailable")
    })
    await expect(renderer.capturePngDataUrl()).rejects.toThrow(
      "GPU unavailable"
    )
  })
})
