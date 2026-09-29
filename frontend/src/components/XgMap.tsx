import { memo, useMemo, type CSSProperties } from "react"
import { useTranslation } from "react-i18next"

import { PitchMarkings } from "@/components/pitch/PitchMarkings"
import { resolvePitchDimensions } from "@/components/pitch/pitchGeometry"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { shortPlayerName } from "@/lib/player-name"
import { samePlayerLabels } from "@/lib/matchRenderEquality"
import type { MatchSnapshot } from "@/types/match"

type XgMapProps = {
  match: MatchSnapshot
  homeColor: string
  awayColor: string
}

export const XgMap = memo(function XgMap({
  match,
  homeColor,
  awayColor,
}: XgMapProps) {
  const { t } = useTranslation()
  const dimensions = resolvePitchDimensions(match.pitchDimensions)
  const players = useMemo(
    () => new Map(match.players.map((player) => [player.id, player])),
    [match.players]
  )
  const shots = useMemo(
    () =>
      [...match.xgShots].sort(
        (left, right) => right.xg - left.xg || left.tick - right.tick
      ),
    [match.xgShots]
  )

  return (
    <div className="xg-map-viewport relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-2">
      <div
        className="xg-map-pitch pitch-frame relative shrink-0 text-[var(--pitch-line)]"
        style={
          {
            "--xg-pitch-aspect": dimensions.length / dimensions.width,
          } as CSSProperties
        }
      >
        <div className="relative size-full overflow-hidden bg-[var(--tactical-pitch-surface)]">
          <PitchMarkings dimensions={dimensions} />

          {shots.map((shot) => {
            const color = shot.team === "home" ? homeColor : awayColor
            const player =
              shot.playerId == null ? undefined : players.get(shot.playerId)
            const playerName = player
              ? shortPlayerName(player.name)
              : t("dataMap.unknownPlayer")
            const time = formatDisplayTick(shot.displayTick)
            const result = t(`dataMap.events.${shot.metricId}`)
            const annotationLabels = (shot.annotations ?? []).map(
              (annotation) => t(`dataMap.annotations.${annotation}`)
            )
            const ariaLabel = [
              shot.team === "home" ? match.home.name : match.away.name,
              playerName,
              time,
              `${t("xg.shotXg")} ${shot.xg.toFixed(2)}`,
              result,
              ...annotationLabels,
            ].join(" · ")
            const diameter = xgRadius(shot.xg) * 2

            return (
              <HoverCard key={shot.id}>
                <HoverCardTrigger
                  render={
                    <button
                      type="button"
                      aria-label={ariaLabel}
                      className="xg-map-hit-target"
                      style={{ left: `${shot.x}%`, top: `${shot.y}%` }}
                    />
                  }
                >
                  <span
                    aria-hidden="true"
                    className="xg-map-dot"
                    style={{
                      width: diameter,
                      height: diameter,
                      borderColor: color,
                      backgroundColor:
                        shot.metricId === "goals" ? color : "transparent",
                    }}
                  />
                </HoverCardTrigger>
                <HoverCardContent
                  side="top"
                  sideOffset={5}
                  className="w-fit min-w-44 max-w-56 overflow-hidden rounded-lg border bg-popover/95 p-0 text-popover-foreground shadow-xl backdrop-blur-sm"
                  style={{ borderColor: color }}
                >
                  <div className="flex items-center gap-2 px-2.5 py-2">
                    <span
                      className="flex h-7 min-w-12 shrink-0 items-center justify-center rounded-md px-1.5 text-[10px] font-extrabold tabular-nums"
                      style={{
                        backgroundColor: color,
                        color: "var(--event-marker-foreground)",
                      }}
                    >
                      {shot.xg.toFixed(2)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11px] leading-4 font-semibold">
                        {playerName}
                      </div>
                      <div className="truncate text-[10px] leading-4 text-muted-foreground">
                        {[result, ...annotationLabels].join(" · ")}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground tabular-nums">
                      {time}
                    </span>
                  </div>
                </HoverCardContent>
              </HoverCard>
            )
          })}

          {shots.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs font-medium text-muted-foreground">
              {t("xg.noShots")}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}, sameXgMapProps)

function xgRadius(xg: number) {
  const normalized = Math.min(1, Math.max(0, xg))
  return Math.min(14, Math.max(3, 14 * Math.sqrt(normalized)))
}

function formatDisplayTick(displayTick: number) {
  const seconds = Math.floor(Math.max(0, displayTick) / 4)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

function sameXgMapProps(previous: XgMapProps, next: XgMapProps) {
  return (
    previous.match.xgShots === next.match.xgShots &&
    previous.homeColor === next.homeColor &&
    previous.awayColor === next.awayColor &&
    previous.match.home.name === next.match.home.name &&
    previous.match.away.name === next.match.away.name &&
    previous.match.pitchDimensions?.length ===
      next.match.pitchDimensions?.length &&
    previous.match.pitchDimensions?.width ===
      next.match.pitchDimensions?.width &&
    samePlayerLabels(previous.match.players, next.match.players)
  )
}
