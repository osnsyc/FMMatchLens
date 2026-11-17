/** Resolve a theme length through CSS layout, including rem, var() and calc(). */
export function readThemeLength(role: string, fallback: number): number {
  const root = document.documentElement
  const value = getComputedStyle(root).getPropertyValue(`--${role}`).trim()
  if (!value || !CSS.supports("width", value)) return fallback

  const probe = document.createElement("span")
  probe.style.cssText = "position:fixed;display:block;visibility:hidden;pointer-events:none;padding:0;border:0"
  probe.style.width = value
  root.appendChild(probe)
  try {
    const pixels = Number.parseFloat(getComputedStyle(probe).width)
    return Number.isFinite(pixels) && pixels >= 0 ? pixels : fallback
  } finally {
    probe.remove()
  }
}
