import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import {
  ContrastIcon,
  PaletteIcon,
  Sun03Icon,
  EyeIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { themePresets } from "@/theme/registry"
import type {
  ColorVisionMode,
  ContrastMode,
  SchemePreference,
} from "@/theme/types"

export function ThemeToggle() {
  const { t } = useTranslation()
  const {
    settings,
    resolvedScheme,
    schemeLocked,
    setPreset,
    setSchemePreference,
    setColorVision,
    setContrast,
    resetAppearance,
  } = useTheme()
  const toggleScheme = () => {
    if (schemeLocked) return
    setSchemePreference(resolvedScheme === "dark" ? "light" : "dark")
  }
  const currentSchemeLabel = t(`appearance.scheme.${resolvedScheme}`)

  return (
    <div className="inline-flex items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-8"
        disabled={schemeLocked}
        onClick={toggleScheme}
        aria-label={`${t("appearance.scheme.label")}: ${currentSchemeLabel}`}
      >
        {resolvedScheme === "dark" ? <MoonIcon /> : <SunIcon />}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8"
              aria-label={t("appearance.open")}
              title={t("appearance.open")}
            />
          }
        >
          <HugeiconsIcon icon={PaletteIcon} strokeWidth={1.8} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="z-[110] w-80 p-2">
          <div className="px-1.5 py-1 text-xs font-semibold text-foreground">
            {t("appearance.title")}
          </div>
          <DropdownMenuGroup aria-label={t("appearance.preset")}>
            <DropdownMenuLabel>{t("appearance.preset")}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={settings.presetId}
              onValueChange={setPreset}
            >
              {themePresets.map((candidate) => (
                <DropdownMenuRadioItem
                  key={candidate.id}
                  value={candidate.id}
                  closeOnClick={false}
                  className="mb-1 min-h-14 items-start border border-transparent py-2 focus:border-border"
                >
                  <span
                    className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border"
                    style={{ background: candidate.preview.surface }}
                    aria-hidden="true"
                  >
                    <span
                      className="size-3 rounded-full"
                      style={{ background: candidate.preview.primary }}
                    />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold">
                      {t(candidate.labelKey)}
                    </span>
                    <span className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                      <span
                        className="size-2 rounded-full"
                        style={{ background: candidate.preview.positive }}
                      />
                      <span
                        className="size-2 rounded-full"
                        style={{ background: candidate.preview.negative }}
                      />
                      {candidate.supportedSchemes
                        .map((scheme) => t(`appearance.scheme.${scheme}`))
                        .join(" / ")}
                      {settings.presetId === candidate.id && (
                        <span aria-hidden="true">✓</span>
                      )}
                    </span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <ChoiceGroup
            icon={<HugeiconsIcon icon={Sun03Icon} strokeWidth={2} />}
            label={t("appearance.scheme.label")}
            value={settings.schemePreference}
            values={["system", "light", "dark"]}
            translationPrefix="appearance.scheme"
            disabled={schemeLocked}
            onChange={(value) => setSchemePreference(value as SchemePreference)}
          />
          <DropdownMenuSeparator />
          <ChoiceGroup
            icon={<HugeiconsIcon icon={EyeIcon} strokeWidth={2} />}
            label={t("appearance.colorVision.label")}
            value={settings.colorVision}
            values={["standard", "colorblind"]}
            translationPrefix="appearance.colorVision"
            onChange={(value) => setColorVision(value as ColorVisionMode)}
          />
          <DropdownMenuSeparator />
          <ChoiceGroup
            icon={<HugeiconsIcon icon={ContrastIcon} strokeWidth={2} />}
            label={t("appearance.contrast.label")}
            value={settings.contrast}
            values={["normal", "high"]}
            translationPrefix="appearance.contrast"
            onChange={(value) => setContrast(value as ContrastMode)}
          />
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={resetAppearance}
            className="justify-center py-1.5"
          >
            {t("appearance.reset")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function ChoiceGroup({
  icon,
  label,
  value,
  values,
  translationPrefix,
  disabled = false,
  onChange,
}: {
  icon: ReactNode
  label: string
  value: string
  values: readonly string[]
  translationPrefix: string
  disabled?: boolean
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()
  return (
    <DropdownMenuGroup aria-label={label}>
      <DropdownMenuLabel className="flex items-center gap-1.5 [&_svg]:size-3.5">
        {icon}
        {label}
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
        {values.map((option) => (
          <DropdownMenuRadioItem
            key={option}
            value={option}
            disabled={disabled}
            closeOnClick={false}
          >
            {t(`${translationPrefix}.${option}`)}
            {option === "high" && (
              <span className="ml-auto text-[9px] text-muted-foreground">
                {t("appearance.experimental")}
              </span>
            )}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuGroup>
  )
}

function SunIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M20.5 15.2A8.5 8.5 0 0 1 8.8 3.5 8.5 8.5 0 1 0 20.5 15.2Z" />
    </svg>
  )
}
