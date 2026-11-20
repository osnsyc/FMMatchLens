import { useTranslation } from "react-i18next"
import { Card } from "@/components/ui/card"
import { FormationReportPlayer } from "./ReportFormation"
import type { MatchKit } from "@/lib/kitRendering"
import type { MatchSnapshot, TeamSide } from "@/types/match"
import { reportLineup, substitutePlayed } from "./reportLineup"

export function ReportSubstitutes({
  match,
  side,
  kits,
}: {
  match: MatchSnapshot
  side: TeamSide
  kits: readonly (MatchKit | undefined)[]
}) {
  const { t } = useTranslation()
  const substitutes = reportLineup(match, side).substitutes
  return (
    <Card
      className="report-substitutes"
      aria-label={t("report.substitutes", { team: match[side].name })}
      data-report-substitutes={side}
    >
      {substitutes.map((player) => (
        <div
          key={player.id}
          className="report-substitute-player"
          data-player-id={player.id}
          data-played={substitutePlayed(player)}
        >
          <FormationReportPlayer
            player={player}
            showRating={substitutePlayed(player)}
            events={match.events}
            outfieldKit={kits[side === "home" ? 0 : 2]}
            goalkeeperKit={kits[side === "home" ? 1 : 3]}
          />
        </div>
      ))}
    </Card>
  )
}
