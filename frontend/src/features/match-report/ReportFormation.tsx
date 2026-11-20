import { useTranslation } from "react-i18next"
import type { CSSProperties } from "react"
import { PlayerMatchStatusRow } from "@/components/PlayerMatchStatus"
import { PitchMarkings } from "@/components/pitch/PitchMarkings"
import { FormationPlayerShirt } from "@/components/formation/FormationFocus"
import { tacticalPitchPoints } from "@/components/formation/formationDecoder"
import { decodeFormation } from "@/components/formation/tactics"
import type { FocusPhase } from "@/components/formation/focus"
import type { MatchKit } from "@/lib/kitRendering"
import { ratingBadgeClass } from "@/lib/ratingPresentation"
import type { MatchPlayer, MatchSnapshot, TeamSide } from "@/types/match"
import { reportLineup } from "./reportLineup"

// The report uses the same vertical pitch, player markers and role labels as
// the dashboard's expanded formation view, without its instruction panels.
export function FormationReportPitch({
  match,
  side,
  phase,
  kits,
}: {
  match: MatchSnapshot
  side: TeamSide
  phase: FocusPhase
  kits?: readonly (MatchKit | undefined)[]
}) {
  const { t } = useTranslation()
  const starters = reportLineup(match, side).starters
  const positioned = starters.filter((player) => player[phase])
  const points = tacticalPitchPoints(
    positioned.map((player) => player[phase]!.positionMask)
  )
  const formation = decodeFormation(
    positioned.map((player) => player[phase]!.positionMask)
  )
  const aspect =
    (match.pitchDimensions?.width ?? 68) /
    (match.pitchDimensions?.length ?? 105)
  return (
    <article
      className="formation-focus-pitch"
      data-phase={phase}
      data-side={side}
      data-report-starting-formation
    >
      <div className="formation-focus-pitch-pane">
        <div className="formation-focus-pitch-area">
          <div
            className="formation-focus-field player-pitch"
            style={{ "--focus-pitch-aspect": aspect } as CSSProperties}
          >
            <div className="formation-focus-caption">
              {t(`teamTactics.${phase}`)}{" "}
              {formation.matched
                ? t(`teamTactics.formationNames.${formation.name}`)
                : t("teamTactics.customFormation")}
            </div>
            <PitchMarkings
              dimensions={match.pitchDimensions}
              orientation="vertical"
              lineClassName="text-[var(--pitch-line)]"
            />
            {positioned.map((player, index) => {
              const point = points[index]
              return (
                point && (
                  <div
                    className="formation-focus-marker"
                    key={player.id}
                    data-player-id={player.id}
                    style={{ left: `${point.x}%`, top: `${point.y}%` }}
                  >
                    <FormationReportPlayer
                      player={player}
                      events={match.events}
                      phase={phase}
                      outfieldKit={kits?.[side === "home" ? 0 : 2]}
                      goalkeeperKit={kits?.[side === "home" ? 1 : 3]}
                    />
                  </div>
                )
              )
            })}
          </div>
        </div>
      </div>
    </article>
  )
}

export function FormationReportPlayer({
  player,
  events,
  phase = "inPossession",
  outfieldKit,
  goalkeeperKit,
  showRating = true,
}: {
  player: MatchPlayer
  events: MatchSnapshot["events"]
  phase?: FocusPhase
  outfieldKit?: MatchKit
  goalkeeperKit?: MatchKit
  showRating?: boolean
}) {
  const assignment = player[phase]
  const goalkeeper =
    (assignment?.positionMask ?? 0) & 1 || player.position === "GK"
  return (
    <>
      <span className="report-formation-player-marker">
        <span className="formation-player-kit">
          <FormationPlayerShirt
            kit={goalkeeper ? goalkeeperKit : outfieldKit}
            number={player.shirtNumber}
            shirtName={player.shirtName}
          />
        </span>
        <span className="report-formation-player-sidebar">
          <PlayerMatchStatusRow player={player} events={events} />
          {showRating && (
            <span
              className={`report-formation-rating ${ratingBadgeClass(player.rating)}`}
            >
              {player.rating?.toFixed(1) ?? "–"}
            </span>
          )}
        </span>
      </span>
      <span className="formation-focus-name">
        <span>{assignment?.roleAbbreviation ?? player.position ?? ""}</span>
        <span className="opacity-40">|</span>
        <span className="truncate">{player.name}</span>
      </span>
    </>
  )
}
