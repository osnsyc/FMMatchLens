export type TeamColorSource = {
  backgroundColour?: number
  foregroundColour?: number
  outlineColour?: number
}

export type TeamThemeColors = {
  light: string
  dark: string
}

type ThemeName = keyof TeamThemeColors
type Rgb = { r: number; g: number; b: number }
type Rgba = Rgb & { alpha: number }
type Oklab = { l: number; a: number; b: number }
type Candidate = {
  color: string
  rgb: Rgb
  lab: Oklab
  priority: number
}

type Pair = {
  home: Candidate
  away: Candidate
  deltaE: number
}

const MIN_TEAM_DELTA_E = 0.1
const MIN_GRAPHIC_CONTRAST = 3

let cachedThemeSurfaces: Record<ThemeName, Rgb[]> | undefined

const FALLBACK_HOME = "#6CABDD"
const FALLBACK_AWAY = "#EF0107"

export function selectTeamThemeColors(
  homeSource?: TeamColorSource,
  awaySource?: TeamColorSource
): { home: TeamThemeColors; away: TeamThemeColors } {
  const themeSurfaces = getThemeSurfaces()
  const homeCandidates = candidatesFrom(homeSource, FALLBACK_HOME)
  const awayCandidates = candidatesFrom(awaySource, FALLBACK_AWAY)
  const allPairs = homeCandidates.flatMap((home) =>
    awayCandidates.map((away) => ({
      home,
      away,
      deltaE: oklabDeltaE(home.lab, away.lab),
    }))
  )

  // ΔE is an initial gate. If the source data contains no sufficiently distinct
  // combination, keep the best-separated combinations instead of inventing a
  // color that is not present in the metadata.
  const distinctPairs = allPairs.filter(
    (pair) => pair.deltaE >= MIN_TEAM_DELTA_E
  )
  const candidatePairs =
    distinctPairs.length > 0
      ? distinctPairs
      : keepMostDistinctPairs(allPairs)

  const light = selectPairForTheme(
    candidatePairs,
    themeSurfaces.light
  )
  const dark = selectPairForTheme(candidatePairs, themeSurfaces.dark)

  return {
    home: { light: light.home.color, dark: dark.home.color },
    away: { light: light.away.color, dark: dark.away.color },
  }
}

function candidatesFrom(
  source: TeamColorSource | undefined,
  fallback: string
): Candidate[] {
  const colors = [
    source?.backgroundColour,
    source?.foregroundColour,
    source?.outlineColour,
  ]
    .map(argbToHex)
    .filter((color): color is string => color !== undefined)

  // A Set deliberately removes exact RGB duplicates only. Similar colors remain
  // valid candidates and are handled by ΔE when the two teams are compared.
  const uniqueColors = [...new Set(colors)]
  if (uniqueColors.length === 0) uniqueColors.push(fallback)

  return uniqueColors.map((color, priority) => {
    const rgb = hexToRgb(color)
    return { color, rgb, lab: rgbToOklab(rgb), priority }
  })
}

function selectPairForTheme(pairs: Pair[], surfaces: Rgb[]): Pair {
  const scored = pairs.map((pair) => {
    const homeContrast = minimumSurfaceContrast(pair.home.rgb, surfaces)
    const awayContrast = minimumSurfaceContrast(pair.away.rgb, surfaces)

    return {
      pair,
      homeContrast,
      awayContrast,
      minimumContrast: Math.min(homeContrast, awayContrast),
      totalContrast: homeContrast + awayContrast,
      bothReadable:
        homeContrast >= MIN_GRAPHIC_CONTRAST &&
        awayContrast >= MIN_GRAPHIC_CONTRAST,
    }
  })

  scored.sort((left, right) => {
    // When both colors are readable, preserve the home team's source priority:
    // background, then foreground, then outline.
    if (left.bothReadable !== right.bothReadable) {
      return Number(right.bothReadable) - Number(left.bothReadable)
    }
    if (left.bothReadable && right.bothReadable) {
      const homePriority = left.pair.home.priority - right.pair.home.priority
      if (homePriority !== 0) return homePriority
    }

    const minimumContrast = right.minimumContrast - left.minimumContrast
    if (Math.abs(minimumContrast) > 1e-9) return minimumContrast

    const totalContrast = right.totalContrast - left.totalContrast
    if (Math.abs(totalContrast) > 1e-9) return totalContrast

    const separation = right.pair.deltaE - left.pair.deltaE
    if (Math.abs(separation) > 1e-9) return separation

    const homePriority = left.pair.home.priority - right.pair.home.priority
    if (homePriority !== 0) return homePriority
    return left.pair.away.priority - right.pair.away.priority
  })

  return scored[0].pair
}

function getThemeSurfaces(): Record<ThemeName, Rgb[]> {
  if (cachedThemeSurfaces) return cachedThemeSurfaces

  const canvas = document.createElement("canvas")
  canvas.width = 1
  canvas.height = 1
  const context = canvas.getContext("2d", { willReadFrequently: true })
  if (!context) throw new Error("Unable to read theme colors")

  const readTheme = (theme: ThemeName): Rgb[] => {
    const probe = document.createElement("div")
    probe.className = theme
    probe.style.cssText = [
      "position:fixed",
      "visibility:hidden",
      "pointer-events:none",
      "background-color:var(--background)",
      "color:var(--card)",
    ].join(";")
    document.body.appendChild(probe)

    const computedStyle = getComputedStyle(probe)
    const background = readCssColor(
      context,
      computedStyle.backgroundColor
    )
    const card = compositeColor(
      readCssColor(context, computedStyle.color),
      background
    )
    probe.remove()

    return [background, card]
  }

  cachedThemeSurfaces = {
    light: readTheme("light"),
    dark: readTheme("dark"),
  }
  return cachedThemeSurfaces
}

function readCssColor(
  context: CanvasRenderingContext2D,
  color: string
): Rgba {
  context.clearRect(0, 0, 1, 1)
  context.fillStyle = "rgba(0, 0, 0, 0)"
  context.fillStyle = color
  context.fillRect(0, 0, 1, 1)
  const [r, g, b, alpha] = context.getImageData(0, 0, 1, 1).data
  return { r, g, b, alpha: alpha / 255 }
}

function compositeColor(foreground: Rgba, background: Rgb): Rgb {
  return {
    r: foreground.r * foreground.alpha + background.r * (1 - foreground.alpha),
    g: foreground.g * foreground.alpha + background.g * (1 - foreground.alpha),
    b: foreground.b * foreground.alpha + background.b * (1 - foreground.alpha),
  }
}

function keepMostDistinctPairs(pairs: Pair[]): Pair[] {
  const maximum = Math.max(...pairs.map((pair) => pair.deltaE))
  return pairs.filter((pair) => Math.abs(pair.deltaE - maximum) < 1e-9)
}

function minimumSurfaceContrast(color: Rgb, surfaces: Rgb[]): number {
  return Math.min(...surfaces.map((surface) => contrastRatio(color, surface)))
}

function contrastRatio(left: Rgb, right: Rgb): number {
  const leftLuminance = relativeLuminance(left)
  const rightLuminance = relativeLuminance(right)
  const lighter = Math.max(leftLuminance, rightLuminance)
  const darker = Math.min(leftLuminance, rightLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

function relativeLuminance({ r, g, b }: Rgb): number {
  const linearize = (channel: number) => {
    const value = channel / 255
    return value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4
  }

  return (
    0.2126 * linearize(r) +
    0.7152 * linearize(g) +
    0.0722 * linearize(b)
  )
}

function rgbToOklab({ r, g, b }: Rgb): Oklab {
  const linearize = (channel: number) => {
    const value = channel / 255
    return value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4
  }
  const red = linearize(r)
  const green = linearize(g)
  const blue = linearize(b)
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue)
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue)
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue)

  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  }
}

function oklabDeltaE(left: Oklab, right: Oklab): number {
  return Math.hypot(left.l - right.l, left.a - right.a, left.b - right.b)
}

function argbToHex(argb?: number): string | undefined {
  if (argb == null || !Number.isFinite(argb) || argb === 0) return undefined
  const rgb = (argb >>> 0) & 0x00ffffff
  return `#${rgb.toString(16).padStart(6, "0").toUpperCase()}`
}

function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16)
  return {
    r: (value >>> 16) & 0xff,
    g: (value >>> 8) & 0xff,
    b: value & 0xff,
  }
}
