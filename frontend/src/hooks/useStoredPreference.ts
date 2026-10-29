import { useEffect, useState } from "react"

import { parseChoice, readPreference, writePreference } from "@/lib/preferences"

// Keys identify a fixed preference for the lifetime of the component.
export function useStoredPreference<T>(
  key: string,
  fallback: T,
  parse: (value: unknown) => T,
) {
  const [value, setValue] = useState<T>(() => readPreference(key, fallback, parse))

  useEffect(() => {
    writePreference(key, value)
  }, [key, value])

  return [value, setValue] as const
}

export function useStoredChoice<T extends string>(
  key: string,
  fallback: T,
  choices: readonly T[],
) {
  return useStoredPreference(key, fallback, (value) => parseChoice(value, choices, fallback))
}
