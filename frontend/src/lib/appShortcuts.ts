export type DashboardFocusPanel =
  "matchStats" | "tactical" | "heatmap" | "formation"

export const playbackToggleEventName = "fmmatchlens:toggle-playback"

export type AppShortcut = {
  id:
    | "zen"
    | "matchStats"
    | "tactical"
    | "heatmap"
    | "mapMode"
    | "formation"
    | "playback"
    | "theme"
    | "fullscreen"
  key: "z" | "m" | "t" | "h" | "f" | " " | "d" | "f11"
  displayKey: string
  labelKey: string
  requiresMatch: boolean
  altKey?: boolean
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
    id: "mapMode",
    key: "h",
    displayKey: "Alt+H",
    labelKey: "shortcuts.mapMode",
    requiresMatch: true,
    altKey: true,
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

export type ShortcutBindings = Partial<Record<AppShortcut["id"], string>>

export function keyboardBinding(
  event: Pick<
    KeyboardEvent,
    "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
  >
) {
  const key =
    event.key === " " || event.key === "Spacebar"
      ? "Space"
      : event.key.length === 1
        ? event.key.toUpperCase()
        : event.key
  return [
    event.ctrlKey && "Ctrl",
    event.metaKey && "Meta",
    event.altKey && "Alt",
    event.shiftKey && "Shift",
    key,
  ]
    .filter(Boolean)
    .join("+")
}

export function bindingError(
  binding: string,
  id: AppShortcut["id"],
  bindings: ShortcutBindings
) {
  if (!binding) return undefined
  const key = binding.replace(
    /^(?:Ctrl\+)?(?:Meta\+)?(?:Alt\+)?(?:Shift\+)?/,
    ""
  )
  if (!(
    (key.length === 1 && key === key.toUpperCase() && key.trim() !== "") ||
    /^(?:Space|Enter|Arrow(?:Up|Down|Left|Right)|Home|End|PageUp|PageDown|Insert|F(?:[1-9]|1[0-2]))$/.test(
      key
    )
  ))
    return "reserved"
  if (
    /^(?:Ctrl|Meta)\+|^Alt\+(?:F4|Space|ArrowLeft|ArrowRight)$|(?:^|\+)(?:F1|F3|F5|F6|F7|F10|F11|F12|Escape|Tab|Dead|Unidentified)$/.test(
      binding
    )
  )
    return "reserved"
  return appShortcuts.find(
    (item) =>
      item.id !== id && (bindings[item.id] ?? item.displayKey) === binding
  )?.id
}

export function shortcutForKeyboardEvent(
  event: KeyboardEvent,
  bindings: ShortcutBindings = {}
) {
  const key = event.key === "Spacebar" ? " " : event.key.toLowerCase()
  if (
    event.repeat ||
    event.defaultPrevented ||
    (typeof document !== "undefined" &&
      document.querySelector("[data-app-settings-dialog]")) ||
    isEditableShortcutTarget(event.target) ||
    ([
      " ",
      "enter",
      "arrowup",
      "arrowdown",
      "arrowleft",
      "arrowright",
      "home",
      "end",
    ].includes(key) &&
      isInteractiveShortcutTarget(event.target))
  ) {
    return undefined
  }

  return appShortcuts.find(
    (shortcut) =>
      shortcut.handled !== false &&
      (bindings[shortcut.id] !== undefined
        ? bindings[shortcut.id] !== "" &&
          bindings[shortcut.id] === keyboardBinding(event)
        : !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey &&
          shortcut.key === key &&
          Boolean(shortcut.altKey) === event.altKey)
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
