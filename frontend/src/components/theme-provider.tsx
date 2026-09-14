/* eslint-disable react-refresh/only-export-components */
import * as React from "react"

import { getThemePreset } from "@/theme/registry"
import { isSchemeLocked, resolveScheme } from "@/theme/resolveAppearance"
import {
  APPEARANCE_STORAGE_KEY,
  defaultAppearance,
  loadAppearance,
  parseAppearance,
  serializeAppearance,
} from "@/theme/storage"
import type {
  AppearanceSettings,
  ColorVisionMode,
  ContrastMode,
  Scheme,
  SchemePreference,
  ThemePreset,
} from "@/theme/types"

type ThemeProviderProps = {
  children: React.ReactNode
  disableTransitionOnChange?: boolean
}

export type AppearanceContextValue = {
  settings: AppearanceSettings
  preset: ThemePreset
  resolvedScheme: Scheme
  schemeLocked: boolean
  schemeLockReason?: string
  setPreset: (id: string) => void
  setSchemePreference: (value: SchemePreference) => void
  setColorVision: (value: ColorVisionMode) => void
  setContrast: (value: ContrastMode) => void
  resetAppearance: () => void
  theme: SchemePreference
  resolvedTheme: Scheme
  setTheme: (value: SchemePreference) => void
}

const COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)"
const ThemeProviderContext = React.createContext<AppearanceContextValue | undefined>(undefined)

function getSystemScheme(): Scheme {
  return window.matchMedia(COLOR_SCHEME_QUERY).matches ? "dark" : "light"
}

function disableTransitionsTemporarily() {
  const style = document.createElement("style")
  style.textContent = "*,*::before,*::after{-webkit-transition:none!important;transition:none!important}"
  document.head.appendChild(style)
  return () => {
    window.getComputedStyle(document.body)
    requestAnimationFrame(() => requestAnimationFrame(() => style.remove()))
  }
}

function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && (
    target.isContentEditable ||
    target.closest("input, textarea, select, [contenteditable='true']") !== null
  )
}

function applyRootAppearance(settings: AppearanceSettings, scheme: Scheme) {
  const root = document.documentElement
  root.dataset.preset = settings.presetId
  root.dataset.scheme = scheme
  root.dataset.colorVision = settings.colorVision
  root.dataset.contrast = settings.contrast
  root.classList.remove("light", "dark")
  root.classList.add(scheme)
  root.style.colorScheme = scheme
  const themeColor = getComputedStyle(root).getPropertyValue("--surface-page").trim()
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (meta && themeColor) meta.content = themeColor
}

export function ThemeProvider({
  children,
  disableTransitionOnChange = true,
  ...props
}: ThemeProviderProps) {
  const [settings, setSettings] = React.useState<AppearanceSettings>(() =>
    loadAppearance(localStorage)
  )
  const settingsRef = React.useRef(settings)
  const [systemScheme, setSystemScheme] = React.useState<Scheme>(getSystemScheme)
  const preset = getThemePreset(settings.presetId)
  const resolvedScheme = resolveScheme(settings.schemePreference, systemScheme, preset)
  const schemeLocked = isSchemeLocked(preset)

  const updateSettings = React.useCallback(
    (update: (current: AppearanceSettings) => AppearanceSettings) => {
      const next = update(settingsRef.current)
      settingsRef.current = next
      applyRootAppearance(
        next,
        resolveScheme(next.schemePreference, getSystemScheme(), getThemePreset(next.presetId))
      )
      localStorage.setItem(APPEARANCE_STORAGE_KEY, serializeAppearance(next))
      setSettings(next)
    },
    []
  )

  const setPreset = React.useCallback((id: string) => {
    updateSettings((current) => ({ ...current, presetId: getThemePreset(id).id }))
  }, [updateSettings])
  const setSchemePreference = React.useCallback((schemePreference: SchemePreference) => {
    updateSettings((current) => ({ ...current, schemePreference }))
  }, [updateSettings])
  const setColorVision = React.useCallback((colorVision: ColorVisionMode) => {
    updateSettings((current) => ({ ...current, colorVision }))
  }, [updateSettings])
  const setContrast = React.useCallback((contrast: ContrastMode) => {
    updateSettings((current) => ({ ...current, contrast }))
  }, [updateSettings])
  const resetAppearance = React.useCallback(() => {
    updateSettings(() => defaultAppearance)
  }, [updateSettings])

  React.useLayoutEffect(() => {
    const restore = disableTransitionOnChange ? disableTransitionsTemporarily() : undefined
    applyRootAppearance(settings, resolvedScheme)
    restore?.()
  }, [disableTransitionOnChange, resolvedScheme, settings])

  React.useEffect(() => {
    const mediaQuery = window.matchMedia(COLOR_SCHEME_QUERY)
    const handleChange = () => {
      const next = mediaQuery.matches ? "dark" : "light"
      const current = settingsRef.current
      applyRootAppearance(
        current,
        resolveScheme(current.schemePreference, next, getThemePreset(current.presetId))
      )
      setSystemScheme(next)
    }
    mediaQuery.addEventListener("change", handleChange)
    return () => mediaQuery.removeEventListener("change", handleChange)
  }, [])

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.repeat || event.metaKey || event.ctrlKey || event.altKey ||
        isEditableTarget(event.target) || event.key.toLowerCase() !== "d"
      ) return
      const current = settingsRef.current
      const currentPreset = getThemePreset(current.presetId)
      if (isSchemeLocked(currentPreset)) return
      const currentResolved = resolveScheme(current.schemePreference, getSystemScheme(), currentPreset)
      updateSettings(() => ({
          ...current,
          schemePreference: currentResolved === "dark" ? "light" : "dark",
      }))
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [updateSettings])

  React.useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.storageArea === localStorage && event.key === APPEARANCE_STORAGE_KEY) {
        const next = parseAppearance(event.newValue)
        settingsRef.current = next
        applyRootAppearance(
          next,
          resolveScheme(next.schemePreference, getSystemScheme(), getThemePreset(next.presetId))
        )
        setSettings(next)
      }
    }
    window.addEventListener("storage", handleStorageChange)
    return () => window.removeEventListener("storage", handleStorageChange)
  }, [])

  const value = React.useMemo<AppearanceContextValue>(() => ({
    settings,
    preset,
    resolvedScheme,
    schemeLocked,
    schemeLockReason: schemeLocked
      ? `appearance.schemeLocked.${preset.defaultScheme}`
      : undefined,
    setPreset,
    setSchemePreference,
    setColorVision,
    setContrast,
    resetAppearance,
    theme: settings.schemePreference,
    resolvedTheme: resolvedScheme,
    setTheme: setSchemePreference,
  }), [
    preset, resetAppearance, resolvedScheme, schemeLocked, setColorVision,
    setContrast, setPreset, setSchemePreference, settings,
  ])

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}

export function useTheme() {
  const context = React.useContext(ThemeProviderContext)
  if (!context) throw new Error("useTheme must be used within a ThemeProvider")
  return context
}
