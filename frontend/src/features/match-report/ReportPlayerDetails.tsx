import { useTranslation } from "react-i18next"
import { Card } from "@/components/ui/card"
import {
  PlayerHeatmap,
  PlayerRatingBreakdown,
  SectionTitle,
  MovementAnalysisCard,
  HeaderMetric,
} from "@/components/player-match-details/PlayerMatchDetails"
import {
  usePlayerMatchDetails,
  initials,
  playerMetricTranslationKeys,
  type PlayerMatchDetailsProps,
} from "@/components/player-match-details/usePlayerMatchDetails"
import { ratingBadgeClass } from "@/lib/ratingPresentation"
import { ReportImage } from "./ReportImage"
import { ReportLaurel } from "./ReportLaurel"

export function ReportPlayerDetails(props: PlayerMatchDetailsProps) {
  const { t } = useTranslation()
  const { player, teamColor, heatmaps, pitchDimensions } = props
  const { contribution, playedMinutes, groups, movement, movementReady } =
    usePlayerMatchDetails(props)
  return (
    <Card
      className="report-pom-details"
      data-report-resource={movementReady ? "ready" : "loading"}
    >
      <div className="report-pom-layout">
        <header className="report-pom-identity rounded-md border border-border/70 bg-muted/35 p-2">
          <ReportLaurel />
          <ReportImage
            src={player.portraitUrl}
            alt={player.name}
            className="flex h-16 w-16 items-center justify-center text-lg font-bold"
          >
            <span style={{ color: teamColor }}>{initials(player.name)}</span>
          </ReportImage>
          <div className="report-pom-name min-w-0">
            <h2 className="text-base font-bold break-words">
              {player.fullName ?? player.name}
            </h2>
          </div>
          <div className="report-pom-number-position flex flex-col gap-1 font-semibold text-muted-foreground">
            <span style={{ color: teamColor }}>
              #{player.shirtNumber ?? "-"}
            </span>
            <span>
              {player.position ?? player.inPossession?.position ?? "-"}
            </span>
          </div>
          <dl className="grid gap-2">
            <HeaderMetric
              label={t("playerDetails.minutesPlayed")}
              value={String(playedMinutes) + "'"}
              valueClassName="bg-muted text-foreground"
            />
            <HeaderMetric
              label={t("stats.rating")}
              value={player.rating?.toFixed(1) ?? "-"}
              valueClassName={ratingBadgeClass(player.rating)}
            />
          </dl>
        </header>
        <div className="report-pom-body">
          <div className="report-pom-technical-column">
            {groups.map((group) => (
              <section
                key={group.id}
                className="flex min-h-0 flex-col rounded-md border border-border/70 bg-muted/10 p-2"
                data-report-technical={group.id}
              >
                <SectionTitle title={t(`playerDetails.groups.${group.id}`)} />
                <dl className="report-pom-metrics">
                  {group.items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-2"
                    >
                      <dt className="min-w-0 text-xs text-muted-foreground">
                        {t(playerMetricTranslationKeys[item.id])}
                      </dt>
                      <dd className="shrink-0 text-[13px] font-semibold tabular-nums">
                        {item.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
          <div className="report-pom-analysis-column">
            <section
              className="shrink-0 rounded-md border border-border/70 bg-muted/10 p-2"
              data-report-rating
            >
              {contribution ? (
                <PlayerRatingBreakdown
                  player={player}
                  contribution={contribution}
                />
              ) : (
                <>
                  <SectionTitle title={t("squad.ratingBreakdown.title")} />
                  <p className="py-2 text-center text-xs text-muted-foreground">
                    {t("playerDetails.noRatingBreakdown")}
                  </p>
                </>
              )}
            </section>
            <MovementAnalysisCard
              distanceM={player.stats.distanceM}
              sprints={player.stats.sprints}
              movement={movement}
              reportMode
            />
            <section
              className="flex min-h-0 flex-1 flex-col rounded-md border border-border/70 bg-muted/10 p-2"
              data-report-player-heatmap
            >
              <SectionTitle title={t("playerDetails.heatmap")} />
              <div className="min-h-0 flex-1 overflow-hidden">
                <PlayerHeatmap
                  exportMode
                  player={player}
                  heatmaps={heatmaps}
                  pitchDimensions={pitchDimensions}
                />
              </div>
            </section>
          </div>
        </div>
      </div>
    </Card>
  )
}
