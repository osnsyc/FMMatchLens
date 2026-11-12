import { useSyncExternalStore } from "react"
import { readPreference, writePreference } from "@/lib/preferences"
import {
  appShortcuts,
  bindingError,
  type ShortcutBindings,
} from "@/lib/appShortcuts"

export const toolbarItems = [
  "tour",
  "fullscreen",
  "shortcuts",
  "appearance",
  "language",
] as const
export type ToolbarItem = (typeof toolbarItems)[number]
export type AppSettings = {
  toolbar: Record<ToolbarItem, boolean>
  shortcuts: ShortcutBindings
}
export const defaultAppSettings: AppSettings = {
  toolbar: {
    tour: true,
    fullscreen: true,
    shortcuts: true,
    appearance: true,
    language: false,
  },
  shortcuts: {},
}
let cache: AppSettings | undefined
const listeners = new Set<() => void>()
export function parseAppSettings(value: unknown): AppSettings {
  const saved = value as Partial<AppSettings> | null
  return {
    toolbar: Object.fromEntries(
      toolbarItems.map((id) => [
        id,
        typeof saved?.toolbar?.[id] === "boolean"
          ? saved.toolbar[id]
          : defaultAppSettings.toolbar[id],
      ])
    ) as AppSettings["toolbar"],
    shortcuts: sanitizeBindings(
      Object.fromEntries(
        appShortcuts
          .filter(
            (item) =>
              item.handled !== false &&
              typeof saved?.shortcuts?.[item.id] === "string"
          )
          .map((item) => [item.id, saved!.shortcuts![item.id]])
      )
    ),
  }
}

function sanitizeBindings(bindings: ShortcutBindings): ShortcutBindings {
  const result: ShortcutBindings = {}
  for (const item of appShortcuts) {
    const binding = bindings[item.id]
    if (
      binding !== undefined &&
      bindingError(binding, item.id, bindings) !== "reserved"
    )
      result[item.id] = binding
  }
  const used = new Set<string>()
  for (const item of appShortcuts) {
    const binding = result[item.id] ?? item.displayKey
    if (!binding) continue
    if (used.has(binding)) result[item.id] = ""
    else used.add(binding)
  }
  return result
}

function snapshot(): AppSettings {
  if (!cache)
    cache = readPreference("settings", defaultAppSettings, parseAppSettings)
  return cache
}
function subscribe(listener: () => void) {
  listeners.add(listener)
  const sync = (event: StorageEvent) => {
    if (
      event.key !== null &&
      event.key !== "fmmatchlens.preferences.v1.settings"
    )
      return
    cache = undefined
    listener()
  }
  window.addEventListener("storage", sync)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", sync)
  }
}
export function useAppSettings() {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
export function updateAppSettings(next: AppSettings) {
  cache = next
  writePreference("settings", next)
  listeners.forEach((listener) => listener())
}
