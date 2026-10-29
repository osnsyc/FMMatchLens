import { afterEach, describe, expect, it, vi } from "vitest"

import {
  parseChoice,
  parseMetricSelection,
  readPreference,
  writePreference,
} from "../src/lib/preferences"

afterEach(() => vi.unstubAllGlobals())

describe("panel preferences", () => {
  const parseMode = (value: unknown) => parseChoice(value, ["events", "liveMotion"], "events")

  it("restores saved preferences with independent keys", () => {
    const data = new Map<string, string>()
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
    })
    writePreference("tactical.mode", "liveMotion")
    writePreference("momentum.mode", "bars")
    expect(readPreference("tactical.mode", "events", parseMode)).toBe("liveMotion")
    expect(readPreference("momentum.mode", "line", (value) =>
      parseChoice(value, ["line", "bars", "eventMap"], "line"))).toBe("bars")
    expect(readPreference("missing", "events", parseMode)).toBe("events")
  })

  it.each(["{", "null", '"removed-mode"', "42", "{}"])(
    "uses the default for invalid stored mode %s",
    (raw) => {
      vi.stubGlobal("localStorage", { getItem: () => raw })
      expect(readPreference("tactical.mode", "events", parseMode)).toBe("events")
    },
  )

  it("continues when storage access or writes are blocked", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("blocked") },
      setItem: () => { throw new Error("quota exceeded") },
    })
    expect(readPreference("tactical.mode", "events", parseMode)).toBe("events")
    expect(() => writePreference("tactical.mode", "liveMotion")).not.toThrow()
  })

  it("continues when localStorage itself is unavailable", () => {
    vi.stubGlobal("localStorage", undefined)
    expect(readPreference("tactical.mode", "events", parseMode)).toBe("events")
    expect(() => writePreference("tactical.mode", "liveMotion")).not.toThrow()
  })

  it("preserves unchecked metrics, defaults new or invalid metrics, and drops removed metrics", () => {
    expect(parseMetricSelection({ goals: false, shots: "false", removed: true }, {
      goals: true,
      shots: true,
      newMetric: false,
    })).toEqual({ goals: false, shots: true, newMetric: false })
    expect(parseMetricSelection(null, { goals: true })).toEqual({ goals: true })
    expect(parseMetricSelection([], { goals: true })).toEqual({ goals: true })
  })
})
