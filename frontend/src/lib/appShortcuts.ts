export type DashboardFocusPanel =
  "matchStats" | "tactical" | "heatmap" | "formation"

export const playbackToggleEventName = "fmmatchlens:toggle-playback"

export type AppShortcut = {
  id:
    | "zen"
    | "matchStats"
    | "tactical"
    | "heatmap"
    | "formation"
    | "playback"
    | "theme"
    | "fullscreen"
  key: "z" | "m" | "t" | "h" | "f" | " " | "d" | "f11"
  displayKey: string
  labelKey: string
  requiresMatch: boolean
  handled?: boolean
}

export const appShortcuts: readonly AppShortcut[] = [
  {
    id: "zen",
    key: "z",
    displayKey: "Z",
    labelKey: "shortcuts.zen",
    requiresMatch: true,
  },
  {
    id: "matchStats",
    key: "m",
    displayKey: "M",
    labelKey: "shortcuts.matchStats",
    requiresMatch: true,
  },
  {
    id: "tactical",
    key: "t",
    displayKey: "T",
    labelKey: "shortcuts.tactical",
    requiresMatch: true,
  },
  {
    id: "heatmap",
    key: "h",
    displayKey: "H",
    labelKey: "shortcuts.heatmap",
    requiresMatch: true,
  },
  {
    id: "formation",
    key: "f",
    displayKey: "F",
    labelKey: "shortcuts.formation",
    requiresMatch: true,
  },
  {
    id: "theme",
    key: "d",
    displayKey: "D",
    labelKey: "shortcuts.theme",
    requiresMatch: false,
  },
  {
    id: "playback",
    key: " ",
    displayKey: "Space",
    labelKey: "shortcuts.playback",
    requiresMatch: true,
  },
  {
    id: "fullscreen",
    key: "f11",
    displayKey: "F11",
    labelKey: "shortcuts.fullscreen",
    requiresMatch: false,
    handled: false,
  },
]

export function shortcutForKeyboardEvent(event: KeyboardEvent) {
  const key = event.key === "Spacebar" ? " " : event.key.toLowerCase()
  if (
    event.repeat ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    isEditableShortcutTarget(event.target) ||
    (key === " " && isInteractiveShortcutTarget(event.target))
  ) {
    return undefined
  }

  return appShortcuts.find(
    (shortcut) => shortcut.handled !== false && shortcut.key === key
  )
}

function isInteractiveShortcutTarget(target: EventTarget | null) {
  return (
    typeof HTMLElement !== "undefined" &&
    target instanceof HTMLElement &&
    target.closest(
      "button, a[href], summary, [role='button'], [role='checkbox'], [role='combobox'], [role='menuitem'], [role='menuitemcheckbox'], [role='menuitemradio'], [role='option'], [role='radio'], [role='slider'], [role='switch'], [role='tab']"
    ) !== null
  )
}

function isEditableShortcutTarget(target: EventTarget | null) {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) {
    return false
  }
  return (
    target.isContentEditable ||
    target.closest(
      "input, textarea, select, [contenteditable='true'], [role='textbox']"
    ) !== null
  )
}
