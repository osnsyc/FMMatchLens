import { afterEach, describe, expect, it, vi } from "vitest"

import { appShortcuts, shortcutForKeyboardEvent } from "@/lib/appShortcuts"

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
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("assigns a unique key to every action", () => {
    const keys = appShortcuts.map((shortcut) => shortcut.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("matches shortcuts without depending on key casing", () => {
    expect(shortcutForKeyboardEvent(keyboardEvent("T"))?.id).toBe("tactical")
    expect(shortcutForKeyboardEvent(keyboardEvent("d"))?.id).toBe("theme")
    expect(shortcutForKeyboardEvent(keyboardEvent(" "))?.id).toBe("playback")
    expect(shortcutForKeyboardEvent(keyboardEvent("Spacebar"))?.id).toBe(
      "playback"
    )
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
