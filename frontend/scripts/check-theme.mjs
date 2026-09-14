import { readFileSync, readdirSync } from "node:fs"
import { extname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const root = new URL("../", import.meta.url)
const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url))
const required = [
  "surface-page", "surface-panel", "surface-panel-muted", "surface-popover", "surface-input", "surface-overlay",
  "text-primary", "text-secondary", "text-muted", "text-inverse",
  "border-subtle", "border-default", "border-strong", "border-focus",
  "action-primary", "action-primary-hover", "action-on-primary", "action-selected", "action-selected-text",
  "status-positive", "status-negative", "status-warning", "status-info",
  "viz-home-fallback", "viz-away-fallback", "viz-series-1", "viz-series-2", "viz-series-3", "viz-series-4", "viz-series-5", "viz-grid", "viz-axis",
  "formation-pitch-surface", "formation-player-number", "heatmap-pitch-surface", "heatmap-player-number", "tactical-pitch-surface", "pitch-line", "pitch-zone", "pitch-label",
  "event-important", "event-contrast", "event-marker-foreground", "event-marker-shadow", "event-trajectory", "event-selected", "event-historical",
  "heatmap-stop-0", "heatmap-stop-1", "heatmap-stop-2", "heatmap-stop-3", "heatmap-stop-4", "heatmap-stop-5",
  "effect-highlight", "effect-shadow", "effect-panel-glow", "effect-card-glow", "gradient-page", "gradient-control-active",
]
const presets = [
  ["fm/light", "src/styles/themes/fm.css", ':root[data-preset="fm"][data-scheme="light"]'],
  ["fm/dark", "src/styles/themes/fm.css", ':root[data-preset="fm"][data-scheme="dark"]'],
  ["opta-inspired/light", "src/styles/themes/opta-inspired.css", ':root[data-preset="opta-inspired"][data-scheme="light"]'],
  ["opta-inspired/dark", "src/styles/themes/opta-inspired.css", ':root[data-preset="opta-inspired"][data-scheme="dark"]'],
  ["wyscout-inspired", "src/styles/themes/wyscout-inspired.css", ':root[data-preset="wyscout-inspired"]'],
]
const knownPresetIds = new Set(["fm", "opta-inspired", "wyscout-inspired"])
const fixedTeamColors = new Map([
  ["opta-inspired/light", { home: "#6327c6", away: "#dc3a44" }],
  ["opta-inspired/dark", { home: "#6327c6", away: "#dc3a44" }],
  ["wyscout-inspired", { home: "#e05a35", away: "#26648c" }],
])
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
  const values = declarations(selectorBlock(read(path), selector))
  const fixedColors = fixedTeamColors.get(name)
  for (const token of required) {
    if (!values.has(token)) failures.push(`${name} is missing --${token}`)
  }
  for (const token of ["formation-pitch-surface", "heatmap-pitch-surface"]) {
    if (values.get(token)?.toLowerCase() !== "transparent") {
      failures.push(`${name} --${token} must remain transparent`)
    }
  }
  if (fixedColors) {
    for (const [side, expected] of Object.entries(fixedColors)) {
      const token = `viz-${side}-fallback`
      if (values.get(token)?.toLowerCase() !== expected) {
        failures.push(`${name} ${token} must remain fixed at ${expected}`)
      }
    }
  }
  for (const [foreground, background, minimum] of [
    ["text-primary", "surface-page", 4.5],
    ["viz-home-fallback", "surface-page", 3],
    ["viz-away-fallback", "surface-page", 3],
  ]) {
    if (fixedColors && foreground.startsWith("viz-")) continue
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
    const stripped = contents
      .replaceAll('"rgba(0, 0, 0, 0)"', '""')
      .replaceAll('"rgb(0, 0, 0)"', '""')
      .replace(/stroke='#[a-f0-9]+'/gi, "")
    if (/#[0-9a-f]{3,8}\b|\bvec3\s*\(\s*\d/gi.test(stripped)) {
      failures.push(`${normalized} contains a hard-coded color`)
    }
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
