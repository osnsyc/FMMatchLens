const storagePrefix = "fmmatchlens.preferences.v1."

export function readPreference<T>(
  key: string,
  fallback: T,
  parse: (value: unknown) => T,
): T {
  try {
    const raw = localStorage.getItem(storagePrefix + key)
    return raw === null ? fallback : parse(JSON.parse(raw))
  } catch {
    return fallback
  }
}

export function writePreference<T>(key: string, value: T): void {
  try {
    localStorage.setItem(storagePrefix + key, JSON.stringify(value))
  } catch {
    // Keep the current UI usable when browser storage is unavailable.
  }
}

export function parseChoice<T extends string>(
  value: unknown,
  choices: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && choices.includes(value as T)
    ? value as T
    : fallback
}

export function parseMetricSelection(
  value: unknown,
  defaults: Record<string, boolean>,
): Record<string, boolean> {
  const saved = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  return Object.fromEntries(Object.entries(defaults).map(([id, fallback]) => [
    id,
    typeof saved[id] === "boolean" ? saved[id] : fallback,
  ]))
}
