import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  ArrowShrinkIcon,
  CommandIcon,
  BinocularsIcon,
  FullScreenIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { ThemeToggle } from "@/components/ThemeToggle"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { changeLanguage, type SupportedLanguage } from "@/i18n"
import { appShortcuts } from "@/lib/appShortcuts"

export function ScoreboardToolbar({
  onStartExploreTour,
  showExploreTourHint,
  exploreTourActive,
}: {
  onStartExploreTour: () => void
  showExploreTourHint: boolean
  exploreTourActive: boolean
}) {
  const { t, i18n } = useTranslation()
  const currentLanguage: SupportedLanguage =
    i18n.language === "en" ? "en" : "zh-CN"
  const [isFullscreen, setIsFullscreen] = useState(
    () => document.fullscreenElement != null
  )

  useEffect(() => {
    const syncFullscreenState = () => {
      setIsFullscreen(document.fullscreenElement != null)
    }
    document.addEventListener("fullscreenchange", syncFullscreenState)
    return () =>
      document.removeEventListener("fullscreenchange", syncFullscreenState)
  }, [])

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
        return
      }
      await document.documentElement.requestFullscreen()
    } catch {
      // The browser can reject fullscreen requests outside a trusted gesture.
    }
  }

  const handleLanguageChange = (value: string | null) => {
    if (value === "en" || value === "zh-CN") {
      void changeLanguage(value)
      document.documentElement.lang = value
    }
  }

  return (
    <div className="flex min-w-0 items-center justify-end gap-2 justify-self-end">
      <Button
        type="button"
        variant={exploreTourActive ? "default" : "outline"}
        size="icon"
        className="relative size-8 active:translate-y-px"
        aria-label={t("exploreTour.start")}
        title={t("exploreTour.start")}
        aria-pressed={exploreTourActive}
        onClick={onStartExploreTour}
      >
        <HugeiconsIcon icon={BinocularsIcon} strokeWidth={1.7} />
        {showExploreTourHint && !exploreTourActive && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -right-1 -top-1 flex size-3"
          >
            <span className="absolute inset-0 animate-ping rounded-full bg-primary/70 motion-reduce:animate-none" />
            <span className="relative m-auto size-2 rounded-full bg-primary ring-2 ring-background" />
          </span>
        )}
      </Button>

      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-8 active:translate-y-px"
        disabled={!document.fullscreenEnabled}
        aria-label={
          isFullscreen
            ? t("shortcuts.exitFullscreen")
            : t("shortcuts.enterFullscreen")
        }
        title={
          isFullscreen
            ? t("shortcuts.exitFullscreen")
            : t("shortcuts.enterFullscreen")
        }
        onClick={() => void toggleFullscreen()}
      >
        <HugeiconsIcon
          icon={isFullscreen ? ArrowShrinkIcon : FullScreenIcon}
          strokeWidth={1.6}
        />
      </Button>

      <Popover>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8 active:translate-y-px"
              aria-label={t("shortcuts.open")}
              title={t("shortcuts.open")}
            />
          }
        >
          <HugeiconsIcon icon={CommandIcon} strokeWidth={1.5} />
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={8} className="w-52 gap-2 p-3">
          <PopoverHeader>
            <PopoverTitle>{t("shortcuts.title")}</PopoverTitle>
          </PopoverHeader>
          <ul className="space-y-1">
            {appShortcuts.map((shortcut) => (
              <li
                key={shortcut.id}
                className="flex items-center justify-between gap-4 py-1"
              >
                <span className="text-[11px] text-foreground/85">
                  {t(shortcut.labelKey)}
                </span>
                <Kbd className="shrink-0">{shortcut.displayKey}</Kbd>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>

      <ThemeToggle />

      <Select value={currentLanguage} onValueChange={handleLanguageChange}>
        <SelectTrigger
          size="sm"
          className="h-8 w-20 transition-transform active:translate-y-px"
          aria-label={t("common.language")}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="zh-CN">{t("common.chinese")}</SelectItem>
          <SelectItem value="en">{t("common.english")}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
