import { useState, type CSSProperties, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  UserIcon,
  FootballPitchIcon,
  TShirtIcon,
} from "@hugeicons/core-free-icons"
import { CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { PitchMarkings } from "@/components/pitch/PitchMarkings"
import { FootAbilityPair } from "@/components/FootAbility"
import { PlayerShirt } from "@/components/PlayerShirt"
import type { MatchKit } from "@/lib/kitRendering"
import { IconHint } from "@/components/ui/icon-hint"
import {
  InstructionGrid,
  TacticalInstructionCard,
  TacticalIcon,
} from "./TacticalInstructions"
import { tacticalPitchPoints } from "./formationDecoder"
import {
  focusPlayerPosition,
  focusFormationPositions,
  focusTeamInstructions,
  focusPlayerInstructions,
  oppositionAgainstPlayer,
  oppositionDimensions,
  oppositionOption,
  type FocusConfiguration,
  type FocusInstruction,
  type FocusPhase,
} from "@/components/formation/focus"
import type {
  MatchPlayer,
  MatchSnapshot,
  PlayerTacticalAssignment,
  TeamSide,
} from "@/types/match"
import { decodeFormation } from "@/components/formation/tactics"
import "./formation-focus.css"

export function FormationFocus({
  match,
  kits,
  fallbackEntries,
}: {
  match: MatchSnapshot
  kits?: readonly (MatchKit | undefined)[]
  fallbackEntries?: Partial<
    Record<
      string,
      readonly { player: MatchPlayer; assignment: PlayerTacticalAssignment }[]
    >
  >
}) {
  const { t } = useTranslation()
  const [side, setSide] = useState<TeamSide>("home")
  const [playerId, setPlayerId] = useState<number | null>(null)
  const team = match.tactics?.[side]
  const config = team?.processing
  const selected =
    playerId === null
      ? undefined
      : match.players.find(
          (p) => p.team === side && (p.id === playerId || p.uid === playerId)
        )
  // Both phases reserve the same cells so every instruction card has the same size.
  const capacity = Math.max(
    1,
    ...(["inPossession", "outOfPossession"] as const).map((phase) => {
      if (!config) return 0
      if (!selected)
        return focusTeamInstructions(config, phase).filter(instructionVisible)
          .length
      const position = focusPlayerPosition(config, phase, selected.id)
      return position
        ? focusPlayerInstructions(position, phase).filter(instructionVisible)
            .length
        : 0
    })
  )
  return (
    <section
      className="formation-focus flex h-full min-h-0 flex-col overflow-hidden"
      data-formation-focus
      data-side={side}
      data-player-mode={!!selected}
    >
      <CardHeader className="shrink-0 grid-cols-[1fr_auto] items-center border-b px-4 py-2">
        <CardTitle className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          {t("panels.formation")}
          {selected && (
            <Button size="xs" variant="ghost" onClick={() => setPlayerId(null)}>
              {t("teamTactics.exitPlayer")}
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <div className="formation-focus-rows">
        <div className="formation-focus-pitches">
          {(
            [
              { teamSide: "home", phase: "inPossession" },
              { teamSide: "home", phase: "outOfPossession" },
              { teamSide: "away", phase: "inPossession" },
              { teamSide: "away", phase: "outOfPossession" },
            ] as const
          ).map(({ teamSide, phase }) => (
            <FocusRow
              key={`${teamSide}-${phase}`}
              mode="pitch"
              phase={phase}
              outfieldKit={kits?.[teamSide === "home" ? 0 : 2]}
              goalkeeperKit={kits?.[teamSide === "home" ? 1 : 3]}
              fallback={fallbackEntries?.[
                `${teamSide}-${phase === "inPossession" ? "ip" : "oop"}`
              ]?.map(({ player, assignment }) => ({
                playerId: player.id,
                position: assignment.position,
                positionMask: assignment.positionMask,
              }))}
              config={match.tactics?.[teamSide].processing ?? null}
              match={match}
              side={teamSide}
              selected={teamSide === side ? selected : undefined}
              onSelect={(id) => {
                setSide(teamSide)
                setPlayerId(id)
              }}
              onClear={() => {
                setSide(teamSide)
                setPlayerId(null)
              }}
            />
          ))}
        </div>
        <div className="formation-focus-commands">
          <TacticalSummary
            config={config ?? null}
            color={match[side].color}
            teamName={match[side].name}
          />
          <div className="formation-focus-command-panes">
            {(["inPossession", "outOfPossession"] as const).map((phase) => (
              <FocusRow
                key={phase}
                capacity={capacity}
                mode="instructions"
                phase={phase}
                config={config ?? null}
                match={match}
                side={side}
                selected={selected}
                onSelect={setPlayerId}
                onClear={() => setPlayerId(null)}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function TacticalSummary({
  config,
  color,
  teamName,
}: {
  config: FocusConfiguration | null
  color?: string
  teamName: string
}) {
  const { t } = useTranslation()
  const style = config
    ? config.style.type === undefined
      ? t("teamTactics.unknown")
      : t(`teamTactics.styles.${config.style.type}`)
    : t("teamTactics.notRead")
  return (
    <section
      className="formation-focus-summary"
      style={
        { "--tactical-team-color": color ?? "var(--primary)" } as CSSProperties
      }
      data-tactical-summary
      aria-label={t("teamTactics.overall")}
    >
      <p className="formation-focus-summary-team" title={teamName}>
        {teamName}
      </p>
      <dl>
        <div>
          <dt>{t("teamTactics.style")}</dt>
          <dd title={style}>{style}</dd>
        </div>
        <div>
          <dt>{t("teamTactics.mentality")}</dt>
          <dd>
            {config
              ? t(`teamTactics.mentalities.${config.mentality.value}`, {
                  defaultValue: t("teamTactics.unknown"),
                })
              : t("teamTactics.notRead")}
          </dd>
        </div>
      </dl>
    </section>
  )
}

// Keep unresolved values available to diagnostics without rendering placeholder cards.
function instructionVisible(instruction: FocusInstruction) {
  return (
    instruction.id !== undefined &&
    instruction.level.selected >= 0 &&
    instruction.rawBit === undefined
  )
}

function FocusRow({
  mode,
  capacity = 1,
  outfieldKit,
  goalkeeperKit,
  fallback,
  phase,
  config,
  match,
  side,
  selected,
  onSelect,
  onClear,
}: {
  mode: "pitch" | "instructions"
  capacity?: number
  outfieldKit?: MatchKit
  goalkeeperKit?: MatchKit
  fallback?: readonly {
    playerId: number
    position: string
    positionMask: number
  }[]
  phase: FocusPhase
  config: FocusConfiguration | null
  match: MatchSnapshot
  side: TeamSide
  selected?: MatchPlayer
  onSelect: (id: number) => void
  onClear: () => void
}) {
  const { t } = useTranslation()
  const data = config?.[phase]
  const positions = focusFormationPositions(match, side, phase, fallback)
  const points = tacticalPitchPoints(positions.map((p) => p.positionMask))
  const formation =
    data?.formation ?? decodeFormation(positions.map((p) => p.positionMask))
  const selectedPosition =
    config && selected
      ? focusPlayerPosition(config, phase, selected.id)
      : undefined
  const personalNote =
    data?.personalOverrides === null
      ? t("teamTactics.personalUnavailable")
      : data?.personalOverrides.some((record) =>
            record.positions.some(
              (position) =>
                position.enabled &&
                position.raw.positionMask === selectedPosition?.raw.positionMask
            )
          )
        ? t("teamTactics.personalUnlinked")
        : undefined
  const players = match.players.filter((p) => p.team === side)
  const aspect =
    (match.pitchDimensions?.width ?? 68) /
    (match.pitchDimensions?.length ?? 105)
  const instructions = (
    mode === "instructions" && config
      ? selected
        ? selectedPosition
          ? focusPlayerInstructions(selectedPosition, phase)
          : []
        : focusTeamInstructions(config, phase)
      : []
  ).filter(instructionVisible)
  const readStatus =
    !config ||
    (selected &&
      (!selectedPosition || selectedPosition.explicit.status === "unavailable"))
      ? "notRead"
      : "none"
  return (
    <article
      className={
        mode === "pitch" ? "formation-focus-pitch" : "formation-focus-command"
      }
      data-phase={phase}
      data-side={side}
    >
      {mode === "pitch" && (
        <div className="formation-focus-pitch-pane">
          <div className="formation-focus-pitch-area" onClick={onClear}>
            <div
              className="formation-focus-field player-pitch"
              style={{ "--focus-pitch-aspect": aspect } as CSSProperties}
            >
              <div
                className="formation-focus-caption"
                title={t("teamTactics.formationDescription", {
                  team: match[side].name,
                  phase: t(`teamTactics.${phase}`),
                  formation: formation.matched
                    ? t(`teamTactics.formationNames.${formation.name}`)
                    : t("teamTactics.customFormation"),
                })}
              >
                <span>
                  {t(`teamTactics.${phase}`)}{" "}
                  {formation.matched
                    ? t(`teamTactics.formationNames.${formation.name}`)
                    : t("teamTactics.customFormation")}
                </span>
              </div>
              <PitchMarkings
                dimensions={match.pitchDimensions}
                orientation="vertical"
                lineClassName="text-border"
              />
              {positions.map((position, index) => {
                const point = points[index]
                if (!point) return null
                const assignedId = position.playerIds[0]
                const player =
                  assignedId === undefined
                    ? undefined
                    : players.find(
                        (p) => p.id === assignedId || p.uid === assignedId
                      )
                const label =
                  player?.name ?? t("teamTactics.slot", { slot: position.slot })
                const role =
                  player?.[phase]?.roleAbbreviation ?? position.position
                const kit =
                  (position.positionMask & 1) !== 0
                    ? goalkeeperKit
                    : outfieldKit
                return (
                  <button
                    type="button"
                    key={position.slot}
                    className="formation-focus-marker"
                    style={{
                      left: `${point.x}%`,
                      top: `${point.y}%`,
                    }}
                    aria-label={t("teamTactics.playerMarker", {
                      phase: t(`teamTactics.${phase}`),
                      player: label,
                      position: position.position,
                    })}
                    aria-pressed={!!player && selected?.id === player.id}
                    disabled={!player}
                    onClick={(event) => {
                      event.stopPropagation()
                      if (player) onSelect(player.id)
                    }}
                  >
                    <FormationPlayerMarker attributes={player?.attributes}>
                      <FormationPlayerShirt
                        kit={kit}
                        number={player?.shirtNumber}
                        shirtName={player?.shirtName}
                      />
                    </FormationPlayerMarker>
                    <span className="formation-focus-name">
                      <span>{role}</span>
                      <span className="opacity-40">|</span>
                      <span className="truncate">{label}</span>
                    </span>
                    <OppositionStrip
                      match={match}
                      side={side}
                      playerId={player?.id}
                    />
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
      {mode === "instructions" && (
        <div
          className="formation-focus-instructions"
          data-instruction-mode={selected ? "player" : "team"}
        >
          {selected && (
            <p className="formation-focus-note" title={personalNote}>
              {personalNote}
            </p>
          )}
          <InstructionGrid count={capacity}>
            {instructions.map((instruction) => (
              <TacticalInstructionCard
                key={instruction.key}
                instruction={instruction}
              />
            ))}
            {!instructions.length && (
              <p className="self-center text-xs text-muted-foreground">
                {t(`teamTactics.${readStatus}`)}
              </p>
            )}
          </InstructionGrid>
        </div>
      )}
    </article>
  )
}

export function FormationPlayerShirt({
  kit,
  number,
  shirtName,
}: {
  kit?: MatchKit
  number?: number
  shirtName?: string
}) {
  const { t } = useTranslation()
  return (
    <span className="formation-focus-shirt">
      {kit ? (
        <PlayerShirt
          kit={kit}
          number={number}
          shirtName={shirtName}
          className="size-7"
          numberClassName="text-[9px]"
        />
      ) : (
        <span
          className="formation-focus-shirt-fallback"
          title={t("teamTactics.kitUnavailable")}
        >
          <HugeiconsIcon icon={TShirtIcon} size={28} />
          <span>{number ?? ""}</span>
        </span>
      )}
    </span>
  )
}

function oppositionRow(
  match: MatchSnapshot,
  side: TeamSide,
  playerId?: number,
  available = true
) {
  return available && playerId !== undefined
    ? oppositionAgainstPlayer(match.tactics, side, playerId)
    : undefined
}

type OppositionRow = ReturnType<typeof oppositionRow>
function OppositionSource({ row }: { row: OppositionRow }) {
  const { t } = useTranslation()
  const source = row?.source ?? "unavailable"
  const label = t("teamTactics.describedValue", {
    label: t("teamTactics.opponentInstructions"),
    value: t(`teamTactics.${source === "unavailable" ? "notRead" : source}`),
  })
  return (
    <IconHint
      className="formation-opposition-source"
      label={label}
      data-opposition-source={source}
    >
      {source === "personal" || source === "position" ? (
        <HugeiconsIcon
          icon={source === "personal" ? UserIcon : FootballPitchIcon}
          data-active="true"
          size={10}
        />
      ) : (
        <span className="formation-opposition-unknown">
          {t(
            source === "default"
              ? "teamTactics.defaultIndicator"
              : "teamTactics.unknownIndicator"
          )}
        </span>
      )}
    </IconHint>
  )
}
function OppositionSetting({
  row,
  dimension,
}: {
  row: OppositionRow
  dimension: (typeof oppositionDimensions)[number]
}) {
  const { t } = useTranslation()
  const option =
    row && row.source !== "unavailable"
      ? oppositionOption(dimension, row[dimension])
      : undefined
  const label = t("teamTactics.describedValue", {
    label: t(`teamTactics.${dimension}`),
    value: option
      ? t(`teamTactics.oiStates.${option.state}`, {
          defaultValue: t("teamTactics.value", { value: option.value }),
        })
      : t("teamTactics.notRead"),
  })
  return (
    <IconHint
      className={`formation-opposition-setting formation-setting-${dimension}`}
      data-opposition-dimension={dimension}
      label={label}
    >
      {option?.icon ? (
        <TacticalIcon name={option.icon} />
      ) : (
        <span className="formation-opposition-unknown">
          {t("teamTactics.unknownIndicator")}
        </span>
      )}
    </IconHint>
  )
}

function FormationPlayerMarker({
  attributes,
  children,
}: {
  attributes?: MatchPlayer["attributes"]
  children: ReactNode
}) {
  return (
    <span className="formation-player-marker formation-player-marker-focus">
      <span className="formation-player-kit">{children}</span>
      <FootAbilityPair attributes={attributes} />
    </span>
  )
}

export function OppositionStrip({
  match,
  side,
  playerId,
  available = true,
  showSource = true,
}: {
  match: MatchSnapshot
  side: TeamSide
  playerId?: number
  available?: boolean
  showSource?: boolean
}) {
  const row = oppositionRow(match, side, playerId, available)
  return (
    <span
      className="formation-opposition-strip"
      data-opposition-source={row?.source ?? "unavailable"}
    >
      {showSource && <OppositionSource row={row} />}
      {oppositionDimensions.map((dimension) => (
        <OppositionSetting key={dimension} row={row} dimension={dimension} />
      ))}
    </span>
  )
}
