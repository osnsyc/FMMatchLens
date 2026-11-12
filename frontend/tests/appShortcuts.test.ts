import { afterEach, describe, expect, it, vi } from "vitest"

import {
  appShortcuts,
  bindingError,
  keyboardBinding,
  shortcutForKeyboardEvent,
} from "@/lib/appShortcuts"

function keyboardEvent(key: string, overrides: Partial<KeyboardEvent> = {}) {
  return {
    key,
    repeat: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    target: null,
    ...overrides,
  } as KeyboardEvent
}

describe("app shortcuts", () => {
  it.each([
    "Alt+Space",
    "Shift+Tab",
    "Alt+Shift+Tab",
    "Dead",
    "Unidentified",
    "Control",
    "unknown",
    "Shift+Ctrl+R",
  ])("rejects unavailable or invalid binding %s", (binding) => {
    expect(bindingError(binding, "tactical", {})).toBe("reserved")
  })

  it("preserves button activation and arrow navigation with custom bindings", () => {
    class ButtonElement {
      isContentEditable = false
      closest(selector: string) {
        return selector.includes("button,") ? this : null
      }
    }
    vi.stubGlobal("HTMLElement", ButtonElement)
    const target = new ButtonElement() as unknown as EventTarget
    expect(
      shortcutForKeyboardEvent(keyboardEvent("Enter", { target }), {
        tactical: "Enter",
      })
    ).toBeUndefined()
    expect(
      shortcutForKeyboardEvent(keyboardEvent("ArrowDown", { target }), {
        tactical: "ArrowDown",
      })
    ).toBeUndefined()
    expect(
      shortcutForKeyboardEvent(keyboardEvent("Enter"), { tactical: "Enter" })
        ?.id
    ).toBe("tactical")
  })
  it("applies custom combinations and clears bindings without retaining defaults", () => {
    const bindings = { tactical: "Shift+K", heatmap: "" }
    expect(
      shortcutForKeyboardEvent(keyboardEvent("K", { shiftKey: true }), bindings)
        ?.id
    ).toBe("tactical")
    expect(
      shortcutForKeyboardEvent(keyboardEvent("t"), bindings)
    ).toBeUndefined()
    expect(
      shortcutForKeyboardEvent(keyboardEvent("h"), bindings)
    ).toBeUndefined()
    expect(
      shortcutForKeyboardEvent(keyboardEvent("h", { altKey: true }), bindings)
        ?.id
    ).toBe("mapMode")
    expect(
      shortcutForKeyboardEvent(keyboardEvent("T", { shiftKey: true }), {
        heatmap: "Shift+T",
      })?.id
    ).toBe("heatmap")
  })

  it("checks conflicts against defaults and custom bindings before save or reset", () => {
    expect(bindingError("H", "tactical", {})).toBe("heatmap")
    expect(bindingError("T", "tactical", { heatmap: "T" })).toBe("heatmap")
    expect(bindingError("H", "tactical", { heatmap: "" })).toBeUndefined()
    expect(bindingError("", "tactical", {})).toBeUndefined()
    expect(bindingError("Ctrl+R", "tactical", {})).toBe("reserved")
    expect(bindingError("F11", "tactical", {})).toBe("reserved")
  })

  it("normalizes recording and ignores events already consumed by overlays", () => {
    expect(keyboardBinding(keyboardEvent(" ", { altKey: true }))).toBe(
      "Alt+Space"
    )
    expect(
      shortcutForKeyboardEvent(keyboardEvent("t", { defaultPrevented: true }))
    ).toBeUndefined()
    vi.stubGlobal("document", { querySelector: () => ({}) })
    expect(shortcutForKeyboardEvent(keyboardEvent("t"))).toBeUndefined()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("assigns a unique key to every action", () => {
    const keys = appShortcuts.map(
      (shortcut) => `${shortcut.altKey ? "alt+" : ""}${shortcut.key}`
    )
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("matches shortcuts without depending on key casing", () => {
    expect(shortcutForKeyboardEvent(keyboardEvent("T"))?.id).toBe("tactical")
    expect(shortcutForKeyboardEvent(keyboardEvent("d"))?.id).toBe("theme")
    expect(shortcutForKeyboardEvent(keyboardEvent(" "))?.id).toBe("playback")
    expect(shortcutForKeyboardEvent(keyboardEvent("Spacebar"))?.id).toBe(
      "playback"
    )
    expect(
      shortcutForKeyboardEvent(keyboardEvent("h", { altKey: true }))?.id
    ).toBe("mapMode")
  })

  it("documents browser-native shortcuts without intercepting them", () => {
    expect(
      appShortcuts.find((shortcut) => shortcut.id === "fullscreen")
    ).toBeDefined()
    expect(shortcutForKeyboardEvent(keyboardEvent("F11"))).toBeUndefined()
  })

  it.each(["option", "menuitemradio"])(
    "does not handle Space on an interactive %s",
    (role) => {
      class InteractiveElement {
        isContentEditable = false

        closest(selector: string) {
          return selector.includes(`[role='${role}']`) ? this : null
        }
      }

      vi.stubGlobal("HTMLElement", InteractiveElement)
      const target = new InteractiveElement() as unknown as EventTarget

      expect(
        shortcutForKeyboardEvent(keyboardEvent(" ", { target }))
      ).toBeUndefined()
    }
  )

  it("ignores repeats and modified shortcuts", () => {
    expect(
      shortcutForKeyboardEvent(keyboardEvent("t", { repeat: true }))
    ).toBeUndefined()
    expect(
      shortcutForKeyboardEvent(keyboardEvent("t", { ctrlKey: true }))
    ).toBeUndefined()
    expect(
      shortcutForKeyboardEvent(keyboardEvent("t", { metaKey: true }))
    ).toBeUndefined()
    expect(
      shortcutForKeyboardEvent(keyboardEvent("t", { altKey: true }))
    ).toBeUndefined()
  })
})
