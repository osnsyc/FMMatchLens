import { readFileSync, readdirSync } from "node:fs"
import { extname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const root = new URL("../", import.meta.url)
const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url))
const required = JSON.parse(
  read("src/theme/contract.ts").match(/requiredThemeTokens = (\[[\s\S]*?\]) as const/)[1].replace(/,\s*\]/g, "]")
)
const presets = [
  ["fm/light", "src/styles/themes/fm.css", ':root[data-preset="fm"][data-scheme="light"]'],
  ["fm/dark", "src/styles/themes/fm.css", ':root[data-preset="fm"][data-scheme="dark"]'],
  ["opta-inspired/light", "src/styles/themes/opta-inspired.css", ':root[data-preset="opta-inspired"][data-scheme="light"]'],
  ["opta-inspired/dark", "src/styles/themes/opta-inspired.css", ':root[data-preset="opta-inspired"][data-scheme="dark"]'],
  ["sofascore-inspired/light", "src/styles/themes/sofascore-inspired.css", ':root[data-preset="sofascore-inspired"][data-scheme="light"]'],
  ["sofascore-inspired/dark", "src/styles/themes/sofascore-inspired.css", ':root[data-preset="sofascore-inspired"][data-scheme="dark"]'],
  ["wyscout-inspired", "src/styles/themes/wyscout-inspired.css", ':root[data-preset="wyscout-inspired"]'],
]
const knownPresetIds = new Set(["fm", "opta-inspired", "sofascore-inspired", "wyscout-inspired"])
const failures = []

function read(path) {
  return readFileSync(new URL(path, root), "utf8")
}

function declarations(block) {
  return new Map([...block.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]))
}

function selectorBlock(css, selector) {
  const start = css.indexOf(selector)
  if (start < 0) return ""
  const open = css.indexOf("{", start)
  const close = css.indexOf("\n}", open)
  return css.slice(open + 1, close)
}

function rgb(hex) {
  const match = hex.match(/^#([0-9a-f]{6})$/i)
  if (!match) return null
  const value = Number.parseInt(match[1], 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

function luminance(color) {
  const channels = color.map((value) => {
    const channel = value / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrast(left, right) {
  const values = [luminance(left), luminance(right)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

for (const [name, path, selector] of presets) {
  const css = read(path)
  const values = declarations(selectorBlock(css, selector))
  const preview = declarations(selectorBlock(css, selector.replace(":root", "[data-theme-preview]")))
  for (const token of required) {
    if (!values.has(token)) failures.push(`${name} is missing --${token}`)
  }
  for (const token of ["surface-panel", "action-primary", "status-positive", "status-negative"]) {
    if (!preview.has(token) || preview.get(token) !== values.get(token)) {
      failures.push(`${name} preview must share --${token} with its root theme`)
    }
  }
  for (const token of ["formation-pitch-surface", "heatmap-pitch-surface"]) {
    if (values.get(token)?.toLowerCase() !== "transparent") {
      failures.push(`${name} --${token} must remain transparent`)
    }
  }
  for (const [foreground, background, minimum] of [
    ["text-primary", "surface-page", 4.5],
    ["viz-home-fallback", "surface-page", 3],
    ["viz-away-fallback", "surface-page", 3],
  ]) {
    // Inspired presets intentionally retain their own fixed brand/team colors.
    if (!name.startsWith("fm/") && foreground.startsWith("viz-")) continue
    const left = rgb(values.get(foreground) ?? "")
    const right = rgb(values.get(background) ?? "")
    if (left && right && contrast(left, right) < minimum) {
      failures.push(`${name} ${foreground}/${background} contrast is below ${minimum}:1`)
    }
  }
}

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? files(path) : [path]
  })
}

for (const path of files(sourceRoot)) {
  const normalized = relative(sourceRoot, path).replaceAll("\\", "/")
  const contents = readFileSync(path, "utf8")
  if (normalized !== "styles/themes/fm.css" && /var\(--fm-/.test(contents)) {
    failures.push(`${normalized} references an FM-private token`)
  }
  if ([".ts", ".tsx"].includes(extname(path)) && !normalized.startsWith("theme/presets/")) {
    // Brand defaults and real kit-number fallbacks are intentionally stable.
    const stripped = contents
      .replace(normalized === "components/fmmatchlens-logo/FMMatchLensLogo.tsx" ? /"#7c3aed"/g : /$^/g, '""')
      .replace(normalized === "lib/kitRendering.ts" ? /"#(?:ffffff|111111)"/g : /$^/g, '""')
      .replaceAll('"rgba(0, 0, 0, 0)"', '""')
      .replaceAll('"rgb(0, 0, 0)"', '""')
      .replace(/stroke='#[a-f0-9]+'/gi, "")
    if (/#[0-9a-f]{3,8}\b|\bvec3\s*\(\s*\d/gi.test(stripped)) {
      failures.push(`${normalized} contains a hard-coded color`)
    }
  }
  if (/\b(?:bg|text|border|fill|stroke)-(?:white|black)(?:\/\d+)?\b/.test(contents)) {
    failures.push(`${normalized} contains an unthemed black/white utility`)
  }
  for (const match of contents.matchAll(/data-preset=["']([^"']+)["']/g)) {
    if (!knownPresetIds.has(match[1])) failures.push(`${normalized} uses unknown preset ${match[1]}`)
  }
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"))
  process.exitCode = 1
} else {
  console.log(`Theme contract passed for ${presets.length} preset/scheme definitions.`)
}
