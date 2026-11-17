/** Resolve a CSS font role into Pixi's ordered family list. */
export function readThemeFont(role: string): string[] {
  const probe = document.createElement("span")
  probe.style.fontFamily = `var(--${role})`
  document.documentElement.appendChild(probe)
  const family = getComputedStyle(probe).fontFamily
  probe.remove()
  return family.split(",").map((part) => part.trim().replace(/^["']|["']$/g, ""))
}

/** Load web fonts before Pixi builds a bitmap atlas from canvas text. */
export async function loadThemeFont(role: string) {
  const families = readThemeFont(role)
  await Promise.allSettled(
    families.map((family) => document.fonts.load(`bold 12px ${JSON.stringify(family)}`))
  )
}
