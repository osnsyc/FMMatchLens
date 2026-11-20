import { createContext, useContext, useEffect, useState } from "react"

import { parseChoice, readPreference, writePreference } from "@/lib/preferences"

// Static reports use defaults without reading or writing dashboard preferences.
export const StoredPreferenceContext = createContext(true)

// Keys identify a fixed preference for the lifetime of the component.
export function useStoredPreference<T>(
  key: string,
  fallback: T,
  parse: (value: unknown) => T
) {
  const persistent = useContext(StoredPreferenceContext)
  const [value, setValue] = useState<T>(() =>
    persistent ? readPreference(key, fallback, parse) : fallback
  )

  useEffect(() => {
    if (persistent) writePreference(key, value)
  }, [key, persistent, value])

  return [value, setValue] as const
}

export function useStoredChoice<T extends string>(
  key: string,
  fallback: T,
  choices: readonly T[]
) {
  return useStoredPreference(key, fallback, (value) =>
    parseChoice(value, choices, fallback)
  )
}
