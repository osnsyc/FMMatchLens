import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import * as h337 from "heatmap.js"

import { CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { NativeTabs } from "@/components/uitripled/native-tabs-shadcnui"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { MatchPlayer, MatchSnapshot, PositionHeatmapRange, TeamSide } from "@/types/match"

type ZonePanelProps = {
  match: MatchSnapshot
}

type HeatPoint = {
  x: number
  y: number
  weight: number
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
  const [selectedRange, setSelectedRange] = useState<PositionHeatmapRange>("full")
  const pitchHostRef = useRef<HTMLDivElement | null>(null)
  const pitchSurfaceRef = useRef<HTMLDivElement | null>(null)
  const heatmapHostRef = useRef<HTMLDivElement | null>(null)
  const [pitchSize, setPitchSize] = useState({ width: 0, height: 0 })
  const teamColor = match[selectedTeam].color ?? (selectedTeam === "home" ? "#6cabdd" : "#ef0107")

  const activePlayerIds = useMemo(
    () => new Set(
      match.players
        .filter((player) => player.team === selectedTeam && player.isOnPitch)
        .map((player) => player.id)
    ),
    [match.players, selectedTeam]
  )

  const selectedHeatmaps = useMemo(
    () => match.positionHeatmaps.map((heatmap) => ({
      ...heatmap,
      ...heatmap.ranges[selectedRange],
    })),
    [match.positionHeatmaps, selectedRange]
  )

  const heatPoints = useMemo<HeatPoint[]>(
    () => selectedHeatmaps
      .filter((heatmap) => heatmap.team === selectedTeam && activePlayerIds.has(heatmap.playerId))
      .flatMap((heatmap) => heatmap.points),
    [activePlayerIds, selectedHeatmaps, selectedTeam]
  )

  const heatLabels = useMemo<HeatLabel[]>(
    () => selectedHeatmaps
      .filter((heatmap) => heatmap.team === selectedTeam && activePlayerIds.has(heatmap.playerId) && heatmap.sampleCount > 0)
      .map((heatmap) => {
        const player = match.players.find((entry) => entry.id === heatmap.playerId)
        return player
          ? {
              x: heatmap.averageX,
              y: heatmap.averageY,
              sampleCount: heatmap.sampleCount,
              player,
            }
          : null
      })
      .filter((label): label is HeatLabel => label != null),
    [activePlayerIds, match.players, selectedHeatmaps, selectedTeam]
  )

  useEffect(() => {
    const host = heatmapHostRef.current

    if (!host || pitchSize.width <= 1 || pitchSize.height <= 1) return

    host.replaceChildren()
    const radius = Math.max(12, Math.round(Math.min(pitchSize.width, pitchSize.height) * 0.11))
    const heatmap = h337.create({
      container: host,
      radius,
      blur: 0.88,
      minOpacity: 0.08,
      maxOpacity: 0.82,
      gradient: {
        0.15: "#2457ff",
        0.35: "#16c8ff",
        0.55: "#35e66f",
        0.75: "#ffe14a",
        0.9: "#ff8a2a",
        1: "#ff2f45",
      },
    })

    const max = Math.max(1, ...heatPoints.map((point) => point.weight))
    heatmap.setData({
      min: 0,
      max,
      data: heatPoints.map((point) => ({
        x: Math.round((point.x / 100) * pitchSize.width),
        y: Math.round((point.y / 100) * pitchSize.height),
        value: point.weight,
      })),
    })

    return () => {
      host.replaceChildren()
    }
  }, [heatPoints, pitchSize])

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
      <CardHeader className="shrink-0 grid-cols-[1fr_auto] items-center border-b px-3 py-2">
        <CardTitle className="text-sm font-semibold">{t("panels.positionHeatmap")}</CardTitle>
        <CardAction className="flex items-center gap-2">
          <Select value={selectedRange} onValueChange={(value) => setSelectedRange(value as PositionHeatmapRange)}>
            <SelectTrigger size="sm" className="h-7 w-auto min-w-20 max-w-28 px-2 text-[11px]" aria-label={t("panels.positionHeatmap")}>
              <SelectValue>{t(`heatmapRange.${selectedRange}`)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="full">{t("heatmapRange.full")}</SelectItem>
              <SelectItem value="half">{t("heatmapRange.half")}</SelectItem>
              <SelectItem value="recent15">{t("heatmapRange.recent15")}</SelectItem>
            </SelectContent>
          </Select>
          <NativeTabs
            value={selectedTeam}
            onValueChange={(value) => setSelectedTeam(value as TeamSide)}
            renderContent={false}
            className="w-32 max-w-none"
            listClassName="h-6"
            triggerClassName="h-5 px-1.5 text-[10px]"
            items={[
              { id: "home", label: t("common.home"), content: null },
              { id: "away", label: t("common.away"), content: null },
            ]}
          />
        </CardAction>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 p-0">
        <div ref={pitchHostRef} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3">
          <div
            ref={pitchSurfaceRef}
            className="relative shrink-0 overflow-hidden rounded-md bg-muted"
            style={{
              width: `${pitchSize.width}px`,
              height: `${pitchSize.height}px`,
            }}
          >
            <div className="pointer-events-none absolute inset-0" aria-hidden="true">
              <div ref={heatmapHostRef} className="size-full" />
            </div>

            <svg className="pointer-events-none absolute inset-0 size-full" viewBox="0 0 100 148" preserveAspectRatio="none" aria-hidden="true">
              <rect x="1" y="1" width="98" height="146" rx="2" fill="none" stroke="currentColor" strokeWidth="0.8" className="text-foreground/40" />
              <line x1="1" y1="74" x2="99" y2="74" stroke="currentColor" strokeWidth="0.6" className="text-foreground/35" />
              <circle cx="50" cy="74" r="10" fill="none" stroke="currentColor" strokeWidth="0.6" className="text-foreground/35" />
              <circle cx="50" cy="74" r="0.8" fill="currentColor" className="text-foreground/40" />
              <rect x="30" y="1" width="40" height="18" fill="none" stroke="currentColor" strokeWidth="0.6" className="text-foreground/35" />
              <rect x="30" y="129" width="40" height="18" fill="none" stroke="currentColor" strokeWidth="0.6" className="text-foreground/35" />
              <rect x="39" y="1" width="22" height="7" fill="none" stroke="currentColor" strokeWidth="0.6" className="text-foreground/35" />
              <rect x="39" y="140" width="22" height="7" fill="none" stroke="currentColor" strokeWidth="0.6" className="text-foreground/35" />
              <path d="M38 19a15 15 0 0 0 24 0" fill="none" stroke="currentColor" strokeWidth="0.6" className="text-foreground/35" />
              <path d="M38 129a15 15 0 0 1 24 0" fill="none" stroke="currentColor" strokeWidth="0.6" className="text-foreground/35" />
            </svg>

            <div className="pointer-events-none absolute inset-0">
              {heatLabels.map((label) => (
                <span
                  key={`heat-player-${label.player.id}`}
                  className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
                  style={{
                    left: `${label.x}%`,
                    top: `${label.y}%`,
                  }}
                  title={`${label.player.name} · ${t("heatmapRange.samples", { count: label.sampleCount })}`}
                >
                  <span className="flex flex-col items-center">
                    <span
                      className="flex size-7 items-center justify-center rounded-full border-2 border-background text-xs font-bold text-white shadow-sm"
                      style={{ backgroundColor: teamColor }}
                    >
                      {label.player.shirtNumber ?? "?"}
                    </span>
                    <span className="mt-1 max-w-20 truncate whitespace-nowrap rounded-sm bg-background/85 px-1 py-0.5 text-[9px] font-medium leading-none text-foreground shadow-sm backdrop-blur-sm">
                      {label.player.name}
                    </span>
                  </span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </section>
  )
}
