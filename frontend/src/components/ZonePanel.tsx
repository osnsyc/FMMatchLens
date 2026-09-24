import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { useTranslation } from "react-i18next"

import {
  combineHeatmapGrids,
  getHeatmap,
  getHeatmapColorScaleBounds,
} from "@/api/heatmap"
import { PixiHeatmap } from "@/components/heatmap/PixiHeatmap"
import { PitchMarkings } from "@/components/pitch/PitchMarkings"
import { PitchPlayerBadge } from "@/components/pitch/PitchPlayerBadge"
import { resolvePitchDimensions } from "@/components/pitch/pitchGeometry"
import {
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { MultiStateButton } from "@/components/ui/multi-state-button"
import type {
  HeatmapGrid,
  HeatmapPhase,
  MatchPlayer,
  MatchSnapshot,
  PositionHeatmapRange,
  TeamSide,
} from "@/types/match"

type ZonePanelProps = {
  match: MatchSnapshot
  isFocusMode: boolean
}

const PITCH_FRAME_GAP = 4
const PITCH_HOST_PADDING = 12
const FOCUSED_PITCH_GAP = 12
const FOCUSED_PHASE_LABEL_HEIGHT = 24
const heatmapPhases: readonly HeatmapPhase[] = [
  "all",
  "inPossession",
  "outOfPossession",
]

type HeatLabel = {
  x: number
  y: number
  sampleCount: number
  player: MatchPlayer
}

type HeatmapView = {
  phase: HeatmapPhase
  grid: HeatmapGrid
  colorScale: {
    maxCellShare: number
    sampleDivisor: number
    lutScale: number
  }
  labels: HeatLabel[]
}

export function ZonePanel({ match, isFocusMode }: ZonePanelProps) {
  const { t } = useTranslation()
  const pitchDimensions = resolvePitchDimensions(match.pitchDimensions)
  const [selectedTeam, setSelectedTeam] = useState<TeamSide>("home")
  const [selectedPlayerByTeam, setSelectedPlayerByTeam] = useState<
    Record<TeamSide, number | null>
  >({ home: null, away: null })
  const [selectedPhase, setSelectedPhase] = useState<HeatmapPhase>("all")
  const [selectedRange, setSelectedRange] =
    useState<PositionHeatmapRange>("full")
  const pitchHostRef = useRef<HTMLDivElement | null>(null)
  const [pitchSize, setPitchSize] = useState({ width: 0, height: 0 })
  const pitchFrameAspect = pitchDimensions.width / pitchDimensions.length
  const innerPitchSize = {
    width: Math.max(0, pitchSize.width - PITCH_FRAME_GAP * pitchFrameAspect * 2),
    height: Math.max(0, pitchSize.height - PITCH_FRAME_GAP * 2),
  }
  const teamColor =
    match[selectedTeam].color ??
    (selectedTeam === "home"
      ? "var(--team-home-fallback)"
      : "var(--team-away-fallback)")

  const teamPlayers = useMemo(
    () => match.players.filter((player) => player.team === selectedTeam),
    [match.players, selectedTeam]
  )
  const selectedPlayer = teamPlayers.find(
    (player) => player.id === selectedPlayerByTeam[selectedTeam]
  )
  const outfieldPlayerIdKeys = getOutfieldPlayerIdKeys(match.players)
  const heatmapViews = useMemo<HeatmapView[]>(() => {
    const phases = isFocusMode ? heatmapPhases : [selectedPhase]
    const forPlayerIds = (playerIdKey: string, phase: HeatmapPhase) =>
      combineHeatmapGrids(
        parsePlayerIdKey(playerIdKey).map((playerId) =>
          getHeatmap(match.heatmaps, {
            scope: { type: "player", playerId },
            phase,
            range: selectedRange,
          })
        )
      )

    return phases.map((phase) => {
      let grid: HeatmapGrid
      let comparableGrids: HeatmapGrid[]

      if (selectedPlayer) {
        grid = getHeatmap(match.heatmaps, {
          scope: { type: "player", playerId: selectedPlayer.id },
          phase,
          range: selectedRange,
        })
        comparableGrids = [grid]
      } else {
        const outfieldHeatmaps = {
          home: forPlayerIds(outfieldPlayerIdKeys.home, phase),
          away: forPlayerIds(outfieldPlayerIdKeys.away, phase),
        }
        grid = outfieldHeatmaps[selectedTeam]
        comparableGrids = [outfieldHeatmaps.home, outfieldHeatmaps.away]
      }

      const bounds = getHeatmapColorScaleBounds(comparableGrids)
      const labels = teamPlayers
        .filter((player) => player.isOnPitch)
        .map((player) => {
          const playerGrid = getHeatmap(match.heatmaps, {
            scope: { type: "player", playerId: player.id },
            phase,
            range: selectedRange,
          })
          return playerGrid.sampleCount > 0
            ? {
                x: playerGrid.averageX,
                y: playerGrid.averageY,
                sampleCount: playerGrid.sampleCount,
                player,
              }
            : null
        })
        .filter((label): label is HeatLabel => label != null)

      return {
        phase,
        grid,
        colorScale: {
          maxCellShare: bounds.rawMaxCellShare,
          sampleDivisor: grid.sampleCount,
          lutScale:
            bounds.blurredP99CellShare > 0
              ? bounds.rawMaxCellShare / bounds.blurredP99CellShare
              : 1,
        },
        labels,
      }
    })
  }, [
    isFocusMode,
    match.heatmaps,
    outfieldPlayerIdKeys.away,
    outfieldPlayerIdKeys.home,
    selectedPlayer,
    selectedPhase,
    selectedRange,
    selectedTeam,
    teamPlayers,
  ])

  useEffect(() => {
    const host = pitchHostRef.current

    if (!host) {
      return
    }

    const updatePitchSize = () => {
      const contentWidth = Math.max(
        0,
        host.clientWidth - PITCH_HOST_PADDING * 2
      )
      const contentHeight = Math.max(
        0,
        host.clientHeight -
          PITCH_HOST_PADDING * 2 -
          (isFocusMode ? FOCUSED_PHASE_LABEL_HEIGHT : 0)
      )
      const availableWidth = isFocusMode
        ? Math.max(0, (contentWidth - FOCUSED_PITCH_GAP * 2) / 3)
        : contentWidth
      const availableHeight = contentHeight
      const pitchRatio = pitchDimensions.width / pitchDimensions.length

      if (availableWidth <= 0 || availableHeight <= 0) {
        return
      }

      const availableRatio = availableWidth / availableHeight

      if (availableRatio > pitchRatio) {
        setPitchSize({
          width: availableHeight * pitchRatio,
          height: availableHeight,
        })
      } else {
        setPitchSize({
          width: availableWidth,
          height: availableWidth / pitchRatio,
        })
      }
    }

    const resizeObserver = new ResizeObserver(updatePitchSize)

    resizeObserver.observe(host)
    updatePitchSize()

    return () => {
      resizeObserver.disconnect()
    }
  }, [isFocusMode, pitchDimensions.length, pitchDimensions.width])

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <CardHeader className="shrink-0 grid-cols-[auto_1fr] items-center gap-2 border-b px-3 py-2">
        <CardTitle className="text-sm font-semibold @max-[230px]/card-header:hidden">
          {t("panels.positionHeatmap")}
        </CardTitle>
        <CardAction className="flex min-w-0 flex-nowrap items-center justify-end gap-1.5">
          <MultiStateButton
            value={selectedRange}
            onValueChange={setSelectedRange}
            variant="outline"
            size="sm"
            className="min-w-14 px-2 text-[11px]"
            aria-label={t("heatmap.range")}
            contextMenuClassName="min-w-32"
            states={
              [
                { value: "full", label: t("heatmapRange.full") },
                { value: "half", label: t("heatmapRange.half") },
                { value: "recent15", label: t("heatmapRange.recent15") },
              ] satisfies Array<{ value: PositionHeatmapRange; label: string }>
            }
          />
          <MultiStateButton
            value={selectedTeam}
            onValueChange={setSelectedTeam}
            variant="outline"
            size="sm"
            className="min-w-12 px-2 text-[11px]"
            aria-label={t("heatmap.team")}
            contextMenuClassName="min-w-28"
            states={
              [
                { value: "home", label: t("common.home") },
                { value: "away", label: t("common.away") },
              ] satisfies Array<{ value: TeamSide; label: string }>
            }
          />
          <MultiStateButton
            value={selectedPhase}
            onValueChange={setSelectedPhase}
            disabled={isFocusMode}
            variant="outline"
            size="sm"
            className="min-w-12 px-2 text-[11px]"
            aria-label={t("heatmap.phase")}
            contextMenuClassName="min-w-40"
            states={
              [
                { value: "all", label: t("heatmap.all") },
                {
                  value: "inPossession",
                  label: t("heatmap.inPossession"),
                  buttonLabel: t("heatmap.ip"),
                },
                {
                  value: "outOfPossession",
                  label: t("heatmap.outOfPossession"),
                  buttonLabel: t("heatmap.oop"),
                },
              ] satisfies Array<{
                value: HeatmapPhase
                label: string
                buttonLabel?: string
              }>
            }
          />
        </CardAction>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 p-0">
        <div
          ref={pitchHostRef}
          className={`${isFocusMode ? "grid grid-cols-3 gap-3" : "flex items-center justify-center"} min-h-0 min-w-0 flex-1 overflow-hidden p-3`}
        >
          {heatmapViews.map((view) => (
            <div
              key={view.phase}
              className="flex min-h-0 min-w-0 flex-col items-center justify-center"
            >
              {isFocusMode && (
                <div className="flex h-6 shrink-0 items-start justify-center text-xs font-semibold text-muted-foreground">
                  {t(`heatmap.${view.phase}`)}
                </div>
              )}
              <div
                className="pitch-frame relative shrink-0 text-[var(--pitch-line)]"
                style={{
                  width: `${pitchSize.width}px`,
                  height: `${pitchSize.height}px`,
                  "--pitch-frame-aspect": pitchFrameAspect,
                } as CSSProperties}
                onClick={() => {
                  setSelectedPlayerByTeam((current) => ({
                    ...current,
                    [selectedTeam]: null,
                  }))
                }}
              >
                <div className="player-pitch relative size-full bg-[var(--heatmap-pitch-surface)]">
                  <div
                    className="pointer-events-none absolute inset-0"
                    aria-hidden="true"
                  >
                    {innerPitchSize.width > 1 && innerPitchSize.height > 1 && (
                      <PixiHeatmap
                        grid={view.grid}
                        width={innerPitchSize.width}
                        height={innerPitchSize.height}
                        colorScale={view.colorScale}
                      />
                    )}
                  </div>

                  <PitchMarkings
                    dimensions={pitchDimensions}
                    orientation="vertical"
                  />

                  <div className="pointer-events-none absolute inset-0">
                    {view.labels.map((label) => (
                      <button
                        type="button"
                        key={`heat-player-${label.player.id}`}
                        className="pointer-events-auto absolute z-10 flex -translate-x-1/2 -translate-y-1/2 cursor-pointer flex-col items-center rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        style={{
                          left: `${label.x}%`,
                          top: `${label.y}%`,
                        }}
                        title={`${label.player.name} · ${t("heatmapRange.samples", { count: label.sampleCount })}`}
                        aria-pressed={selectedPlayer?.id === label.player.id}
                        onClick={(event) => {
                          event.stopPropagation()
                          setSelectedPlayerByTeam((current) => ({
                            ...current,
                            [selectedTeam]: label.player.id,
                          }))
                        }}
                      >
                        <PitchPlayerBadge
                          number={label.player.shirtNumber}
                          numberColor="var(--heatmap-player-number)"
                          className={`border-2 border-background after:hidden transition-transform hover:scale-110 ${
                            selectedPlayer?.id === label.player.id
                              ? "ring-2 ring-ring ring-offset-1 ring-offset-background"
                              : ""
                          }`}
                          style={{ backgroundColor: teamColor }}
                        />
                        <span className="pitch-player-name mt-1 max-w-20 truncate text-[9px] leading-none font-medium whitespace-nowrap text-foreground drop-shadow-sm">
                          {getPlayerSurname(label.player)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </section>
  )
}

function isGoalkeeper(player: MatchPlayer) {
  return (
    [player.inPossession, player.outOfPossession].some((assignment) => {
      if (!assignment) return false
      const basePositionMask = assignment.positionMask & 0x0001ffff
      return (
        basePositionMask === 0x1 ||
        isGoalkeeperCode(assignment.position) ||
        isGoalkeeperCode(assignment.roleAbbreviation) ||
        assignment.role.toUpperCase().includes("GOALKEEPER")
      )
    }) || isGoalkeeperCode(player.position)
  )
}

function isGoalkeeperCode(value?: string) {
  if (!value) return false
  return ["GK", "SK", "LK", "BPGK", "NNGK"].includes(value.trim().toUpperCase())
}

function getPlayerSurname(player: MatchPlayer) {
  const displayName = (player.fullName ?? player.name).trim()
  const parts = displayName.split(/\s+/)
  return parts.at(-1) ?? displayName
}

function getOutfieldPlayerIdKeys(players: readonly MatchPlayer[]) {
  const ids: Record<TeamSide, number[]> = { home: [], away: [] }
  for (const player of players) {
    if (!isGoalkeeper(player)) ids[player.team].push(player.id)
  }
  return {
    home: ids.home.join(","),
    away: ids.away.join(","),
  }
}

function parsePlayerIdKey(key: string) {
  return key === "" ? [] : key.split(",").map(Number)
}
