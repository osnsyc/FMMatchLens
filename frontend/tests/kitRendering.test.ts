import { describe, expect, it } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { MatchKitSymbols, PlayerShirt } from "@/components/PlayerShirt"
import { describeKit, kitColourMatrix } from "@/lib/kitRendering"

// Evaluate the generated SVG matrix on known samples. SVG clamps each output
// channel independently; alpha must stay unchanged even on transparent pixels.
function recolourKitPixels(pixels: Uint8ClampedArray, colours: readonly [number, number, number]) {
  const matrix = kitColourMatrix(colours)
  const result = new Uint8ClampedArray(pixels.length)
  for (let index = 0; index < pixels.length; index += 4) {
    for (let row = 0; row < 4; row++) {
      result[index + row] = matrix[row * 5 + 4] * 255
        + [0, 1, 2, 3].reduce((sum, col) => sum + pixels[index + col] * matrix[row * 5 + col], 0)
    }
  }
  return result
}

const source = {
  shirtStyle: 10, shirtBackType: 0,
  shirtNumberColor: 0xff112233, shirtNumberOutlineColor: 0xff445566,
  goalkeeperShirtNumberColor: 0xff778899, goalkeeperShirtNumberOutlineColor: 0x80aabbcc,
  shirtBackgroundColor: 0xffaabbcc, shirtForegroundColor: 0xff123456, shirtOutlineColor: 0xff778899,
  goalkeeperShirtStyle: 55, goalkeeperShirtBackType: 1,
  goalkeeperShirtBackgroundColor: 0xff102030, goalkeeperShirtForegroundColor: 0xff405060, goalkeeperShirtOutlineColor: 0xff708090,
}

describe("2D kit back selection", () => {
  it("fits complete long shirt names inside the centred arc", () => {
    const kit = { ...describeKit(source, false)!, id: "name-test" }
    for (const shirtName of ["ALEXANDER-ARNOLD", "施魏因施泰格·穆勒", "VERY LONG PLAYER SHIRT NAME"]) {
      const html = renderToStaticMarkup(createElement(PlayerShirt, { kit, shirtName }))
      const width = Number(html.match(/textLength="([^"]+)"/)?.[1])
      // The curve spans x=20..44 and is longer than that 24-unit chord.
      expect(width).toBeGreaterThan(0)
      expect(width).toBeLessThanOrEqual(24)
      expect(html).toContain(`startOffset="50%">${shirtName}</textPath>`)
    }
  })
  it("uses sampled number fill and stroke on the actual number overlay", () => {
    for (const goalkeeper of [false, true]) {
      const kit = { ...describeKit(source, goalkeeper)!, id: "number-test" }
      const html = renderToStaticMarkup(createElement(PlayerShirt, { kit, number: 7 }))
      expect(html).toContain(`color:${kit.numberColor}`)
      expect(html).toContain(`-webkit-text-stroke:0.6px ${kit.numberOutlineColor}`)
      expect(html).toContain(">7</span>")
    }
  })
  it("preserves black, zero and alpha and only falls back for missing/invalid number colours", () => {
    expect(describeKit({ ...source, shirtNumberColor: 0xff000000, shirtNumberOutlineColor: 0 }, false))
      .toMatchObject({ numberColor: "#000000ff", numberOutlineColor: "#00000000" })
    expect(describeKit({ ...source, shirtNumberColor: undefined, shirtNumberOutlineColor: Number.NaN }, false))
      .toMatchObject({ numberColor: "#ffffff", numberOutlineColor: "#111111" })
  })
  it("keeps outfield and goalkeeper palettes and preset families distinct", () => {
    expect(describeKit(source, false)).toEqual({ resource: "kits/o/s10.webp", colours: [0xffaabbcc, 0xff123456, 0xff778899], numberColor: "#112233ff", numberOutlineColor: "#445566ff" })
    expect(describeKit(source, true)).toEqual({ resource: "kits/g/s55.webp", squareResource: "kits/square.webp", colours: [0xff102030, 0xff405060, 0xff708090], numberColor: "#778899ff", numberOutlineColor: "#aabbcc80" })
  })
  it("shares one green panel across all square presets and both shirt families", () => {
    for (const goalkeeper of [false, true]) {
      const ordinary = describeKit({ ...source, shirtBackType: 0, goalkeeperShirtBackType: 0 }, goalkeeper)!
      const square = describeKit({ ...source, shirtBackType: 1, goalkeeperShirtBackType: 1 }, goalkeeper)!
      expect(square.resource).toBe(ordinary.resource)
      expect(square.squareResource).toBe("kits/square.webp")
      expect(ordinary.squareResource).toBeUndefined()
      const plain = describeKit({ ...source, shirtBackType: 2, goalkeeperShirtBackType: 2 }, goalkeeper)!
      expect(plain.squareResource).toBeUndefined()
      const html = renderToStaticMarkup(createElement(MatchKitSymbols, { kits: [{ ...square, id: "square-test" }] }))
      const filterGroup = html.indexOf('<g filter="url(#square-test-colour)">')
      const base = html.indexOf(square.resource)
      const panel = html.indexOf(square.squareResource!)
      expect(filterGroup).toBeGreaterThan(-1)
      expect(base).toBeGreaterThan(filterGroup)
      expect(panel).toBeGreaterThan(base)
      expect(html.match(/<image /g)).toHaveLength(2)
    }
  })
  it("resolves plain backs to same_1 even when the original style lacks a 2D asset", () => {
    expect(describeKit({ ...source, shirtStyle: 58, shirtBackType: 2 }, false)?.resource).toBe("kits/o/s1.webp")
  })
  it("does not invent kit styles for old archives, missing colours, or unsupported presets", () => {
    expect(describeKit({ iconBackgroundColor: 0xffaabbcc }, false)).toBeUndefined()
    expect(describeKit({ ...source, shirtForegroundColor: undefined }, false)).toBeUndefined()
    expect(describeKit({ ...source, shirtBackType: 3 }, false)).toBeUndefined()
    expect(describeKit({ ...source, goalkeeperShirtStyle: 56 }, true)).toBeUndefined()
    expect(describeKit({ ...source, shirtStyle: Number.NaN }, false)).toBeUndefined()
  })
})

describe("game shader colour equation", () => {
  it("replaces each mask channel with the matching colour and preserves alpha", () => {
    const mask = new Uint8ClampedArray([255, 0, 0, 128, 0, 255, 0, 255, 0, 0, 255, 0])
    expect([...recolourKitPixels(mask, [0xffaabbcc, 0xff123456, 0xff778899])]).toEqual([
      170, 187, 204, 128, 18, 52, 86, 255, 119, 136, 153, 0,
    ])
    expect(mask[0]).toBe(255)
  })
  it("adds coefficients without normalising them, clamps overflow, and supports black", () => {
    const mask = new Uint8ClampedArray([255, 255, 255, 81, 127, 127, 0, 190])
    expect([...recolourKitPixels(mask, [0xffffffff, 0xffffffff, 0xff000000])]).toEqual([
      255, 255, 255, 81, 254, 254, 254, 190,
    ])
  })
})
