import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  combineHeatmapGrids,
  getHeatmap,
  getHeatmapColorScaleBounds,
} from "@/api/heatmap"
import { PixiHeatmap } from "@/components/heatmap/PixiHeatmap"
import {
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { MultiStateButton } from "@/components/ui/multi-state-button"
import type {
  HeatmapPhase,
  MatchPlayer,
  MatchSnapshot,
  PositionHeatmapRange,
  TeamSide,
} from "@/types/match"

type ZonePanelProps = {
  match: MatchSnapshot
}

type HeatLabel = {
  x: number
  y: number
  sampleCount: number
  player: MatchPlayer
}

export function ZonePanel({ match }: ZonePanelProps) {
  const { t } = useTranslation()
  const [selectedTeam, setSelectedTeam] = useState<TeamSide>("home")
  const [selectedPlayerByTeam, setSelectedPlayerByTeam] = useState<
    Record<TeamSide, number | null>
  >({ home: null, away: null })
  const [selectedPhase, setSelectedPhase] = useState<HeatmapPhase>("all")
  const [selectedRange, setSelectedRange] =
    useState<PositionHeatmapRange>("full")
  const pitchHostRef = useRef<HTMLDivElement | null>(null)
  const [pitchSize, setPitchSize] = useState({ width: 0, height: 0 })
  const teamColor =
    match[selectedTeam].color ??
    (selectedTeam === "home" ? "#6cabdd" : "#ef0107")

  const teamPlayers = useMemo(
    () => match.players.filter((player) => player.team === selectedTeam),
    [match.players, selectedTeam]
  )
  const selectedPlayer = teamPlayers.find(
    (player) => player.id === selectedPlayerByTeam[selectedTeam]
  )
  const outfieldHeatmaps = useMemo(() => {
    const forTeam = (team: TeamSide) =>
      combineHeatmapGrids(
        match.players
          .filter((player) => player.team === team && !isGoalkeeper(player))
          .map((player) =>
            getHeatmap(match.heatmaps, {
              scope: { type: "player", playerId: player.id },
              phase: selectedPhase,
              range: selectedRange,
            })
          )
      )
    return {
      home: forTeam("home"),
      away: forTeam("away"),
    }
  }, [match.heatmaps, match.players, selectedPhase, selectedRange])
  const heatmapGrid = selectedPlayer
    ? getHeatmap(match.heatmaps, {
        scope: { type: "player", playerId: selectedPlayer.id },
        phase: selectedPhase,
        range: selectedRange,
      })
    : outfieldHeatmaps[selectedTeam]
  const heatmapColorScale = useMemo(() => {
    const bounds = getHeatmapColorScaleBounds(
      selectedPlayer
        ? [heatmapGrid]
        : [outfieldHeatmaps.home, outfieldHeatmaps.away]
    )
    return {
      maxCellShare: bounds.rawMaxCellShare,
      sampleDivisor: heatmapGrid.sampleCount,
      lutScale:
        bounds.blurredMaxCellShare > 0
          ? bounds.rawMaxCellShare / bounds.blurredMaxCellShare
          : 1,
    }
  }, [
    heatmapGrid,
    outfieldHeatmaps.away,
    outfieldHeatmaps.home,
    selectedPlayer,
  ])

  const heatLabels = useMemo<HeatLabel[]>(
    () =>
      teamPlayers
        .filter((player) => player.isOnPitch)
        .map((player) => {
          const grid = getHeatmap(match.heatmaps, {
            scope: { type: "player", playerId: player.id },
            phase: selectedPhase,
            range: selectedRange,
          })
          return grid.sampleCount > 0
            ? {
                x: grid.averageX,
                y: grid.averageY,
                sampleCount: grid.sampleCount,
                player,
              }
            : null
        })
        .filter((label): label is HeatLabel => label != null),
    [match.heatmaps, selectedPhase, selectedRange, teamPlayers]
  )

  useEffect(() => {
    const host = pitchHostRef.current

    if (!host) {
      return
    }

    const updatePitchSize = () => {
      const availableWidth = host.clientWidth
      const availableHeight = host.clientHeight
      const pitchRatio = 100 / 148

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
  }, [])

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <CardHeader className="shrink-0 grid-cols-[auto_1fr] items-center gap-2 border-b px-3 py-2">
        <CardTitle className="text-sm font-semibold">
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
          className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3"
        >
          <div
            className="relative shrink-0 overflow-hidden rounded-md bg-muted"
            style={{
              width: `${pitchSize.width}px`,
              height: `${pitchSize.height}px`,
            }}
            onClick={() => {
              setSelectedPlayerByTeam((current) => ({
                ...current,
                [selectedTeam]: null,
              }))
            }}
          >
            <div
              className="pointer-events-none absolute inset-0"
              aria-hidden="true"
            >
              {pitchSize.width > 1 && pitchSize.height > 1 && (
                <PixiHeatmap
                  grid={heatmapGrid}
                  width={pitchSize.width}
                  height={pitchSize.height}
                  colorScale={heatmapColorScale}
                />
              )}
            </div>

            <svg
              className="pointer-events-none absolute inset-0 size-full"
              viewBox="0 0 100 148"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <rect
                x="1"
                y="1"
                width="98"
                height="146"
                rx="2"
                fill="none"
                stroke="currentColor"
                strokeWidth="0.8"
                className="text-foreground/40"
              />
              <line
                x1="1"
                y1="74"
                x2="99"
                y2="74"
                stroke="currentColor"
                strokeWidth="0.6"
                className="text-foreground/35"
              />
              <circle
                cx="50"
                cy="74"
                r="10"
                fill="none"
                stroke="currentColor"
                strokeWidth="0.6"
                className="text-foreground/35"
              />
              <circle
                cx="50"
                cy="74"
                r="0.8"
                fill="currentColor"
                className="text-foreground/40"
              />
              <rect
                x="30"
                y="1"
                width="40"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="0.6"
                className="text-foreground/35"
              />
              <rect
                x="30"
                y="129"
                width="40"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="0.6"
                className="text-foreground/35"
              />
              <rect
                x="39"
                y="1"
                width="22"
                height="7"
                fill="none"
                stroke="currentColor"
                strokeWidth="0.6"
                className="text-foreground/35"
              />
              <rect
                x="39"
                y="140"
                width="22"
                height="7"
                fill="none"
                stroke="currentColor"
                strokeWidth="0.6"
                className="text-foreground/35"
              />
              <path
                d="M38 19a15 15 0 0 0 24 0"
                fill="none"
                stroke="currentColor"
                strokeWidth="0.6"
                className="text-foreground/35"
              />
              <path
                d="M38 129a15 15 0 0 1 24 0"
                fill="none"
                stroke="currentColor"
                strokeWidth="0.6"
                className="text-foreground/35"
              />
            </svg>

            <div className="pointer-events-none absolute inset-0">
              {heatLabels.map((label) => (
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
                  <span
                    className={`flex size-7 items-center justify-center rounded-full border-2 border-background text-xs font-bold text-background shadow-sm transition-transform hover:scale-110 ${
                      selectedPlayer?.id === label.player.id
                        ? "ring-2 ring-ring ring-offset-1 ring-offset-background"
                        : ""
                    }`}
                    style={{ backgroundColor: teamColor }}
                  >
                    {label.player.shirtNumber ?? "?"}
                  </span>
                  <span className="mt-1 max-w-20 truncate text-[9px] leading-none font-medium whitespace-nowrap text-foreground drop-shadow-sm">
                    {getPlayerSurname(label.player)}
                  </span>
                </button>
              ))}
            </div>
          </div>
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
