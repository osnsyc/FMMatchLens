import { useTranslation } from "react-i18next"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { BrandIcon } from "@/components/BrandIcon"
import { changeLanguage, type SupportedLanguage } from "@/i18n"
import type { MatchSnapshot } from "@/types/match"
import { ThemeToggle } from "@/components/ThemeToggle"

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()
}

export function ScoreHeader({ match }: { match: MatchSnapshot }) {
  const { t, i18n } = useTranslation()
  const currentLanguage: SupportedLanguage = i18n.language === "en" ? "en" : "zh-CN"
  const homeColor = match.home.color ?? "#6cabdd"
  const awayColor = match.away.color ?? "#ef0107"

  const handleLanguageChange = (value: string | null) => {
    if (value === "en" || value === "zh-CN") {
      void changeLanguage(value)
      document.documentElement.lang = value
    }
  }

  return (
    <TooltipProvider>
    <header className="grid h-full min-h-12 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 px-4 py-1.5 text-card-foreground">
      <div className="flex min-w-0 items-center gap-2.5 justify-self-start">
        <BrandIcon className="size-9 shrink-0 text-primary" />
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="font-fm-universe truncate text-lg tracking-tight">FMMatchLens</span>
          <span className="shrink-0 text-[9px] font-medium tabular-nums text-muted-foreground">
            v{__APP_VERSION__}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-center gap-3" aria-label="match score">
        <TeamName name={match.home.name} uid={match.home.uid} color={homeColor} align="right" />
        {match.home.logoUrl ? (
          <img src={match.home.logoUrl} alt={match.home.name} className="size-12 shrink-0 object-contain" />
        ) : (
          <span className="flex size-12 shrink-0 items-center justify-center text-sm font-semibold" style={{ color: homeColor }}>{initials(match.home.name)}</span>
        )}
        <div className="flex min-w-24 flex-col items-center justify-center">
          <div className="text-2xl font-bold leading-none tabular-nums tracking-tight">
            {match.score.home}<span className="mx-1 text-muted-foreground">-</span>{match.score.away}
          </div>
          <div className="mt-1 text-[10px] font-medium tabular-nums text-muted-foreground">
            {formatMatchClock(match)}
          </div>
        </div>
        {match.away.logoUrl ? (
          <img src={match.away.logoUrl} alt={match.away.name} className="size-12 shrink-0 object-contain" />
        ) : (
          <span className="flex size-12 shrink-0 items-center justify-center text-sm font-semibold" style={{ color: awayColor }}>{initials(match.away.name)}</span>
        )}
        <TeamName name={match.away.name} uid={match.away.uid} color={awayColor} align="left" />
      </div>

      <div className="flex min-w-0 items-center justify-end gap-3 justify-self-end">
        <ThemeToggle />
        <div className="flex items-center gap-2">
          <Select value={currentLanguage} onValueChange={handleLanguageChange}>
            <SelectTrigger size="sm" className="h-8 w-20" aria-label={t("common.language")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="zh-CN">{t("common.chinese")}</SelectItem>
              <SelectItem value="en">{t("common.english")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </header>
    </TooltipProvider>
  )
}

function formatMatchClock(match: MatchSnapshot) {
  const displaySeconds = match.clock.minute * 60 + match.clock.second
  const plannedSeconds = (match.period >= 2 ? 90 : 45) * 60
  if (displaySeconds <= plannedSeconds) {
    return `${match.clock.minute}:${String(match.clock.second).padStart(2, "0")}`
  }

  const extraSeconds = displaySeconds - plannedSeconds
  const extraMinutes = Math.floor(extraSeconds / 60)
  const extraRemainder = extraSeconds % 60
  return `${plannedSeconds / 60}(+${extraMinutes}:${String(extraRemainder).padStart(2, "0")})`
}

function TeamName({ name, uid, color, align }: { name: string; uid?: number; color: string; align: "left" | "right" }) {
  const label = (
    <span className="font-fm-universe block truncate text-base leading-10" style={{ color }} title={name}>{name}</span>
  )

  return (
    <div className={`hidden w-32 min-w-0 sm:block ${align === "right" ? "text-right" : "text-left"}`}>
      {uid == null ? label : (
        <Tooltip>
          <TooltipTrigger render={label} />
          <TooltipContent>UID {uid}</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
