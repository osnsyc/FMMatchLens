import { useTranslation } from "react-i18next"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { BrandIcon } from "@/components/BrandIcon"
import { ScoreboardToolbar } from "@/components/ScoreboardToolbar"
import type { MatchManager, MatchSnapshot } from "@/types/match"
import type { MatchReportContext } from "@/features/match-report/reportTypes"
import { ReportImage } from "@/features/match-report/ReportImage"

const noop = () => {}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
}

export function ScoreHeader({
  match,
  onStartExploreTour = noop,
  showExploreTourHint = false,
  exploreTourActive = false,
  reportMode = false,
  getReportContext,
}: {
  match: MatchSnapshot
  onStartExploreTour?: () => void
  showExploreTourHint?: boolean
  exploreTourActive?: boolean
  reportMode?: boolean
  getReportContext?: () => MatchReportContext
}) {
  const { t } = useTranslation()
  const homeColor = match.home.color ?? "var(--team-home-fallback)"
  const awayColor = match.away.color ?? "var(--team-away-fallback)"

  return (
    <TooltipProvider>
      <header
        data-report-banner={reportMode ? "" : undefined}
        style={reportMode ? { whiteSpace: "nowrap" } : undefined}
        className="grid h-full min-h-12 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 px-4 py-1.5 text-card-foreground"
      >
        <div className="flex min-w-0 items-center gap-2.5 justify-self-start">
          <BrandIcon className={`${reportMode ? "size-14" : "size-9"} shrink-0 text-primary`} />
          <div
            style={reportMode ? { minWidth: "max-content", transform: "translateY(3px)" } : undefined}
            className="flex min-w-0 flex-col items-start"
          >
            {reportMode && (
              <span className="text-sm leading-none text-muted-foreground">
                {t("report.poweredBy")}
              </span>
            )}
            <div className="flex min-w-0 items-baseline gap-1.5">
              <span
                className="font-scoreboard truncate text-lg tracking-tight"
                style={{
                  fontWeight: "var(--font-brand-weight)",
                  minWidth: reportMode ? "max-content" : undefined,
                  fontSize: reportMode ? 28 : undefined,
                  lineHeight: reportMode ? "34px" : undefined,
                }}
              >
                FMMatchLens
              </span>
              {!reportMode && <span className="shrink-0 text-[9px] font-medium text-muted-foreground tabular-nums">
                v{__APP_VERSION__}
              </span>}
            </div>
          </div>
        </div>

        <div
          className="flex items-center justify-center gap-3"
          aria-label={t("report.score")}
        >
          <TeamName
            reportMode={reportMode}
            name={match.home.name}
            uid={match.home.uid}
            manager={match.home.manager}
            color={homeColor}
            align="right"
          />
          {reportMode ? (
            <ReportImage
              src={match.home.logoUrl}
              alt={match.home.name}
              className="size-20 shrink-0 text-2xl font-semibold"
            >
              <span style={{ color: homeColor }}>
                {initials(match.home.name)}
              </span>
            </ReportImage>
          ) : match.home.logoUrl ? (
            <img
              src={match.home.logoUrl}
              alt={match.home.name}
              className="size-12 shrink-0 object-contain"
            />
          ) : (
            <span
              className="flex size-12 shrink-0 items-center justify-center text-sm font-semibold"
              style={{ color: homeColor }}
            >
              {initials(match.home.name)}
            </span>
          )}
          <div className="flex min-w-24 flex-col items-center justify-center">
            <div className={`${reportMode ? "text-[54px]" : "text-2xl"} leading-none font-bold tracking-tight tabular-nums`}>
              {match.score.home}
              <span className="mx-1 text-muted-foreground">-</span>
              {match.score.away}
            </div>
            {!reportMode && <div className="mt-1 text-[10px] font-medium text-muted-foreground tabular-nums">
              {formatMatchClock(match)}
            </div>}
          </div>
          {reportMode ? (
            <ReportImage
              src={match.away.logoUrl}
              alt={match.away.name}
              className="size-20 shrink-0 text-2xl font-semibold"
            >
              <span style={{ color: awayColor }}>
                {initials(match.away.name)}
              </span>
            </ReportImage>
          ) : match.away.logoUrl ? (
            <img
              src={match.away.logoUrl}
              alt={match.away.name}
              className="size-12 shrink-0 object-contain"
            />
          ) : (
            <span
              className="flex size-12 shrink-0 items-center justify-center text-sm font-semibold"
              style={{ color: awayColor }}
            >
              {initials(match.away.name)}
            </span>
          )}
          <TeamName
            reportMode={reportMode}
            name={match.away.name}
            uid={match.away.uid}
            manager={match.away.manager}
            color={awayColor}
            align="left"
          />
        </div>

        {reportMode && match.competition && (
          <div className="flex min-w-0 items-center justify-self-end gap-3 text-right" data-report-competition>
            <span className="max-w-80 text-xl font-bold leading-tight">{match.competition.name}</span>
            <ReportImage src={match.competition.logoUrl} alt={match.competition.name ?? t("report.competition")} className="size-16 shrink-0 text-xl font-bold">
              {initials(match.competition.name ?? "")}
            </ReportImage>
          </div>
        )}

        {!reportMode && (
          <ScoreboardToolbar
            match={match}
            getReportContext={getReportContext}
            onStartExploreTour={onStartExploreTour}
            showExploreTourHint={showExploreTourHint}
            exploreTourActive={exploreTourActive}
          />
        )}
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

function TeamName({
  reportMode = false,
  name,
  uid,
  manager,
  color,
  align,
}: {
  reportMode?: boolean
  name: string
  uid?: number
  manager?: MatchManager
  color: string
  align: "left" | "right"
}) {
  const { t } = useTranslation()
  const label = (
    <span
      className={`font-scoreboard block w-full truncate ${reportMode ? "text-[30px] leading-10" : "text-base leading-10"} font-bold`}
      style={{ color, textAlign: align }}
      title={name}
    >
      {name}
    </span>
  )
  const managerName =
    [manager?.firstName, manager?.secondName].filter(Boolean).join(" ") ||
    t("report.unknown")

  return (
    <div
      className={`${reportMode ? "w-64" : "w-20 sm:w-32"} min-w-0 ${align === "right" ? "text-right" : "text-left"}`}
    >
      {uid == null && !manager ? (
        label
      ) : (
        <Tooltip>
          <TooltipTrigger render={label} />
          <TooltipContent>
            <div className="space-y-0.5 text-xs">
              {uid != null && <div>{t("report.teamUid")}: {uid}</div>}
              {manager && <div>{t("report.manager")}: {managerName}</div>}
              {manager?.uid != null && <div>{t("report.managerUid")}: {manager.uid}</div>}
              {manager && (
                <div>{t("report.control")}: {manager.isHumanControlled ? t("report.human") : t("report.ai")}</div>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
