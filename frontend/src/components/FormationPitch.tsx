import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import { CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { NativeTabs } from "@/components/uitripled/native-tabs-shadcnui"
import { shortPlayerName } from "@/lib/player-name"
import type { MatchPlayer, MatchSnapshot, PlayerTacticalAssignment, TeamSide } from "@/types/match"

type FormationPitchProps = { match: MatchSnapshot }
type FormationView = "home-ip" | "home-oop" | "away-ip" | "away-oop"
type FormationLine = "gk" | "defence" | "holding" | "midfield" | "attack" | "striker"

type FormationEntry = {
  player: MatchPlayer
  assignment: PlayerTacticalAssignment
  x: number
  y: number
}

const lineDepth: Record<FormationLine, number> = {
  gk: 7,
  defence: 23,
  holding: 37,
  midfield: 51,
  attack: 67,
  striker: 83,
}

export function FormationPitch({ match }: FormationPitchProps) {
  const { t } = useTranslation()
  const [view, setView] = useState<FormationView>("home-ip")
  const { side, inPossession } = formationSelection(view)
  const entries = useMemo(
    () => layoutTeam(match.players, side, inPossession),
    [match.players, side, inPossession],
  )
  const teamColor = match[side].color ?? (side === "home" ? "#6cabdd" : "#ef0107")

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <CardHeader className="shrink-0 grid-cols-[1fr_auto] items-center border-b px-4 py-2">
        <CardTitle className="text-sm font-semibold">{t("panels.formation")}</CardTitle>
        <CardAction>
          <NativeTabs
            value={view}
            onValueChange={(value) => setView(value as FormationView)}
            renderContent={false}
            className="w-64 max-w-none"
            listClassName="h-6"
            triggerClassName="h-5 px-1.5 text-[9px]"
            items={[
              { id: "home-ip", label: t("formationView.homeInPossession"), content: null },
              { id: "home-oop", label: t("formationView.homeOutOfPossession"), content: null },
              { id: "away-ip", label: t("formationView.awayInPossession"), content: null },
              { id: "away-oop", label: t("formationView.awayOutOfPossession"), content: null },
            ]}
          />
        </CardAction>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col p-0">
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3">
          <div className="relative aspect-[148/100] h-full max-h-full max-w-full shrink-0 overflow-hidden rounded-md bg-muted">
            <PitchMarkings />
            <div className="pointer-events-none absolute inset-0">
              {entries.map(({ player, assignment, x, y }) => {
                const roleNamespace = inPossession
                  ? "inPossessionRoleNames"
                  : "outOfPossessionRoleNames"
                const roleName = t(`${roleNamespace}.${assignment.roleAbbreviation}`, {
                  defaultValue: assignment.role,
                })
                const roleLabel = [roleName, assignment.duty].filter(Boolean).join(" · ")
                return (
                  <div
                    key={`formation-${view}-${player.id}`}
                    className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2"
                    style={{ left: `${x}%`, top: `${y}%` }}
                  >
                    <HoverCard>
                      <HoverCardTrigger
                        render={<div className="flex max-w-32 flex-col items-center text-center" />}
                      >
                        <div
                          className="flex size-7 items-center justify-center rounded-full border-2 border-background text-xs font-bold text-white shadow-sm"
                          style={{ backgroundColor: teamColor }}
                        >
                          {player.shirtNumber ?? "?"}
                        </div>
                        <span className="mt-0.5 max-w-32 truncate whitespace-nowrap rounded-sm bg-background/90 px-1 text-[9px] font-semibold leading-3 text-foreground shadow-sm">
                          {assignment.roleAbbreviation} · {shortPlayerName(player.name)}
                        </span>
                      </HoverCardTrigger>
                      <HoverCardContent
                        side="top"
                        sideOffset={6}
                        className="w-auto max-w-72 whitespace-nowrap px-2.5 py-1.5 font-medium"
                      >
                        {roleLabel}
                      </HoverCardContent>
                    </HoverCard>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </CardContent>
    </section>
  )
}

function PitchMarkings() {
  return (
    <svg className="absolute inset-0 size-full" viewBox="0 0 148 100" preserveAspectRatio="none" aria-hidden="true">
      <rect x="1" y="1" width="146" height="98" rx="2" fill="none" stroke="currentColor" strokeWidth="0.8" className="text-border" />
      <line x1="74" y1="1" x2="74" y2="99" stroke="currentColor" strokeWidth="0.6" className="text-border" />
      <circle cx="74" cy="50" r="10" fill="none" stroke="currentColor" strokeWidth="0.6" className="text-border" />
      <circle cx="74" cy="50" r="0.8" fill="currentColor" className="text-border" />
      <rect x="1" y="30" width="18" height="40" fill="none" stroke="currentColor" strokeWidth="0.6" className="text-border" />
      <rect x="129" y="30" width="18" height="40" fill="none" stroke="currentColor" strokeWidth="0.6" className="text-border" />
      <rect x="1" y="39" width="7" height="22" fill="none" stroke="currentColor" strokeWidth="0.6" className="text-border" />
      <rect x="140" y="39" width="7" height="22" fill="none" stroke="currentColor" strokeWidth="0.6" className="text-border" />
      <path d="M19 38a15 15 0 0 1 0 24" fill="none" stroke="currentColor" strokeWidth="0.6" className="text-border" />
      <path d="M129 38a15 15 0 0 0 0 24" fill="none" stroke="currentColor" strokeWidth="0.6" className="text-border" />
    </svg>
  )
}

function formationSelection(view: FormationView): { side: TeamSide; inPossession: boolean } {
  return {
    side: view.startsWith("home") ? "home" : "away",
    inPossession: view.endsWith("-ip"),
  }
}

function layoutTeam(players: MatchPlayer[], side: TeamSide, inPossession: boolean): FormationEntry[] {
  const teamPlayers = players.filter((player) => player.team === side)
  const onPitch = teamPlayers.filter((player) => player.isOnPitch)
  const assignmentFor = (player: MatchPlayer) =>
    inPossession ? player.inPossession : player.outOfPossession
  const occupiedPositions = new Set(
    onPitch.flatMap((player) => {
      const assignment = assignmentFor(player)
      return assignment ? [assignment.positionMask] : []
    }),
  )
  const vacatedAssignments = teamPlayers
    .filter((player) => !player.isOnPitch && player.status?.subbedOffMinute != null)
    .flatMap((player) => {
      const assignment = assignmentFor(player)
      return assignment && !occupiedPositions.has(assignment.positionMask)
        ? [{ assignment, minute: player.status!.subbedOffMinute! }]
        : []
    })

  return onPitch
    .map((player) => {
      const current = assignmentFor(player)
      if (current) return { player, assignment: current }

      const substitutionMinute = player.status?.subbedOnMinute
      const matchingIndex = vacatedAssignments.findIndex(
        ({ minute }) => substitutionMinute != null && minute === substitutionMinute,
      )
      const fallback = vacatedAssignments.splice(matchingIndex >= 0 ? matchingIndex : 0, 1)[0]
      return fallback ? { player, assignment: fallback.assignment } : null
    })
    .filter((entry): entry is { player: MatchPlayer; assignment: PlayerTacticalAssignment } => entry != null)
    .map(({ player, assignment }) => {
      const depth = lineDepth[lineForPosition(assignment.position)]
      const lane = laneForPosition(assignment.position)
      return {
        player,
        assignment,
        x: side === "home" ? depth : 100 - depth,
        y: side === "home" ? 100 - lane : lane,
      }
    })
}

function lineForPosition(position: string): FormationLine {
  const value = position.toUpperCase()
  if (value === "GK") return "gk"
  if (value.startsWith("ST")) return "striker"
  if (value.startsWith("AM")) return "attack"
  if (value.startsWith("DM")) return "holding"
  if (value.startsWith("M")) return "midfield"
  return "defence"
}

function laneForPosition(position: string) {
  const value = position.toUpperCase()
  if (["DR", "WBR", "MR", "AMR"].includes(value)) return 14
  if (["DCR", "DMR", "MCR", "AMCR", "STR"].includes(value)) return 36
  if (["DCL", "DML", "MCL", "AMCL", "STL"].includes(value)) return 64
  if (["DL", "WBL", "ML", "AML"].includes(value)) return 86
  return 50
}
