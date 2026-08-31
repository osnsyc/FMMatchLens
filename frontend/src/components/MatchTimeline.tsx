import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  buildMatchEvents,
  buildMomentumTimeline,
  buildRollingMomentumTimeline,
  buildPositionHeatmaps,
  buildTacticalEvents,
  buildXgTimeline,
  type RealtimeFrame,
  type RealtimeMatchMetadata,
} from "@/api/realtimeMatch"
import { parseLocalArchive, type ParsedLocalArchive } from "@/api/localArchive"
import { metadataAtTick } from "@/api/archiveMetadata"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { MatchEventType, MatchMomentumPoint, MatchSnapshot, PlayerPositionHeatmap, TacticalEventPoint, TeamSide, XgTimelinePoint } from "@/types/match"

const apiBase = `http://127.0.0.1:${__API_PORT__}`
const pageSize = 2_400

type ArchiveSummary = {
  matchId: string
  fileName?: string
  startedUnixMilliseconds: number
  ended: boolean
  frameCount: number
  firstTick: number
  lastTick: number
  homeName?: string
  awayName?: string
  homeGoals: number
  awayGoals: number
  fileSizeBytes: number
}

type ArchiveSlice = {
  archive: ArchiveSummary
  metadata?: RealtimeMatchMetadata
  metadataTimeline?: RealtimeMatchMetadata[]
  frames: RealtimeFrame[]
}

type MatchTimelineProps = {
  match: MatchSnapshot
  initialLocalArchive?: ParsedLocalArchive
  onReplayFrame: (
    frame: RealtimeFrame,
    metadata: RealtimeMatchMetadata | undefined,
    xgTimeline: XgTimelinePoint[],
    events: MatchSnapshot["events"],
    positionHeatmaps: PlayerPositionHeatmap[],
    tacticalEvents: TacticalEventPoint[],
    momentum: MatchMomentumPoint[],
    rollingMomentum: MatchMomentumPoint[],
  ) => void
  onLive: () => void
}

type TimelineEventKind = MatchEventType | "substitution"

type TimelineEvent = {
  id: string
  type: TimelineEventKind
  minute: number
  team: TeamSide
  label: string
  details: string[]
  occurrences: number
}

export function MatchTimeline({ match, initialLocalArchive, onReplayFrame, onLive }: MatchTimelineProps) {
  const { t, i18n } = useTranslation()
  const [archives, setArchives] = useState<ArchiveSummary[]>([])
  const [selectedId, setSelectedId] = useState(
    initialLocalArchive ? localArchiveId(initialLocalArchive) : "",
  )
  const [frames, setFrames] = useState<RealtimeFrame[]>(initialLocalArchive?.frames ?? [])
  const [frameIndex, setFrameIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [loading, setLoading] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [metadata, setMetadata] = useState<RealtimeMatchMetadata | undefined>(initialLocalArchive?.metadata)
  const [metadataTimeline, setMetadataTimeline] = useState<RealtimeMatchMetadata[]>(initialLocalArchive?.metadataTimeline ?? [])
  const [localArchive, setLocalArchive] = useState<ParsedLocalArchive | undefined>(initialLocalArchive)
  const [archiveError, setArchiveError] = useState("")
  const [draggingArchive, setDraggingArchive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`${apiBase}/api/archives`)
      if (!response.ok) throw new Error("archive list failed")
      const summaries = (await response.json()) as ArchiveSummary[]

      try {
        const [statusResponse, metadataResponse] = await Promise.all([
          fetch(`${apiBase}/api/match/status`),
          fetch(`${apiBase}/api/match/meta`),
        ])
        if (!statusResponse.ok || !metadataResponse.ok) throw new Error("active match metadata failed")
        const status = (await statusResponse.json()) as { matchId?: string }
        const activeMetadata = (await metadataResponse.json()) as RealtimeMatchMetadata | null
        setArchives(summaries.map((archive) => archive.matchId === status.matchId && activeMetadata
          ? { ...archive, homeName: activeMetadata.home.name, awayName: activeMetadata.away.name }
          : archive))
      } catch {
        setArchives(summaries)
      }
    } catch {
      setArchives([])
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(timer)
  }, [refresh])

  useEffect(() => {
    if (!selectedId || selectedId.startsWith("local:")) return

    let cancelled = false

    const load = async () => {
      const loaded: RealtimeFrame[] = []
      let loadedMetadata: RealtimeMatchMetadata | undefined
      let loadedMetadataTimeline: RealtimeMatchMetadata[] = []
      let fromTick = 0

      try {
        while (!cancelled) {
          const url = `${apiBase}/api/archives/${encodeURIComponent(selectedId)}/frames?fromTick=${fromTick}&stride=1&limit=${pageSize}`
          const response = await fetch(url)
          if (!response.ok) throw new Error("archive read failed")
          const page = (await response.json()) as ArchiveSlice
          loadedMetadata ??= page.metadata
          if (loadedMetadataTimeline.length === 0 && page.metadataTimeline?.length) {
            loadedMetadataTimeline = page.metadataTimeline
          }
          if (page.frames.length === 0) break

          loaded.push(...page.frames)
          const lastTick = page.frames.at(-1)?.tick ?? fromTick
          if (lastTick >= page.archive.lastTick || page.frames.length < pageSize) break
          fromTick = lastTick + 1
        }

        if (!cancelled) {
          setFrames(loaded)
          setMetadata(loadedMetadata)
          setMetadataTimeline(loadedMetadataTimeline)
          setFrameIndex(0)
        }
      } catch {
        if (!cancelled) {
          setFrames([])
          setMetadataTimeline([])
          setLoadFailed(true)
          setArchiveError(t("timeline.serverArchiveReadFailed"))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [selectedId, t])

  useEffect(() => {
    if (!playing || frames.length === 0) return

    const timer = window.setInterval(() => {
      setFrameIndex((current) => {
        if (current >= frames.length - 1) {
          setPlaying(false)
          return current
        }
        return current + 1
      })
    }, Math.max(16, 250 / speed))

    return () => window.clearInterval(timer)
  }, [playing, speed, frames.length])

  useEffect(() => {
    const frame = frames[frameIndex]
    if (selectedId && frame) {
      const frameMetadata = metadataAtTick(metadataTimeline, frame.tick)
        ?? metadataTimeline[0]
        ?? metadata
      onReplayFrame(
        frame,
        frameMetadata,
        buildXgTimeline(frames, frameIndex),
        buildMatchEvents(frames, frameIndex),
        buildPositionHeatmaps(frames, frameIndex),
        buildTacticalEvents(frames, frameIndex),
        buildMomentumTimeline(frames, frameIndex),
        buildRollingMomentumTimeline(frames, frameIndex),
      )
    }
  }, [selectedId, frameIndex, frames, metadata, metadataTimeline, onReplayFrame])

  const events = useMemo(() => buildTimelineEvents(match, t), [match, t])
  const homeEvents = events.filter((event) => event.team === "home")
  const awayEvents = events.filter((event) => event.team === "away")
  const replaying = selectedId !== ""
  const sliderMax = replaying ? Math.max(1, frames.length - 1) : Math.max(90, match.clock.minute)
  const sliderValue = replaying ? Math.min(frameIndex, sliderMax) : match.clock.minute
  const sliderPercent = sliderMax > 0 ? (sliderValue / sliderMax) * 100 : 0

  const selectSource = (matchId: string) => {
    if (localArchive && matchId === localArchiveId(localArchive)) {
      setFrames(localArchive.frames)
      setMetadata(localArchive.metadata)
      setMetadataTimeline(localArchive.metadataTimeline)
      setFrameIndex(0)
      setPlaying(false)
      setLoading(false)
      setLoadFailed(false)
      setArchiveError("")
      setSelectedId(matchId)
      onLive()
      return
    }

    setFrames([])
    setMetadata(undefined)
    setMetadataTimeline([])
    setFrameIndex(0)
    setPlaying(false)
    setLoading(matchId !== "")
    setLoadFailed(false)
    setArchiveError("")
    setSelectedId(matchId)
    onLive()
  }

  const openLocalArchive = async (file: File) => {
    setDraggingArchive(false)
    setPlaying(false)
    setLoading(true)
    setLoadFailed(false)
    setArchiveError("")
    onLive()

    try {
      if (!file.name.toLowerCase().endsWith(".fmlens")) throw new Error(t("timeline.chooseArchive"))
      const parsed = await parseLocalArchive(await file.arrayBuffer(), file.name)
      setLocalArchive(parsed)
      setFrames(parsed.frames)
      setMetadata(parsed.metadata)
      setMetadataTimeline(parsed.metadataTimeline)
      setFrameIndex(0)
      setSelectedId(localArchiveId(parsed))
    } catch (error) {
      setFrames([])
      setMetadata(undefined)
      setMetadataTimeline([])
      setSelectedId("")
      setLoadFailed(true)
      setArchiveError(error instanceof Error ? error.message : t("timeline.localArchiveReadFailed"))
    } finally {
      setLoading(false)
    }
  }

  return (
    <TooltipProvider>
      <section className="flex h-full min-h-0 items-center gap-2 overflow-hidden px-4 py-1">
        <div className="flex w-80 shrink-0 flex-col gap-1.5">
          <div className="flex gap-1.5">
            <select
              className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-xs"
              value={selectedId}
              onChange={(event) => selectSource(event.target.value)}
              aria-label={t("timeline.sourceLabel")}
            >
              <option value="">{t("timeline.liveMatch")}</option>
              {localArchive && (
                <option value={localArchiveId(localArchive)}>
                  {t("timeline.local")} · {archiveOptionLabel(localArchive.archive, i18n.language, localArchive.metadata)}
                </option>
              )}
              {archives.map((archive) => (
                <option key={archive.matchId} value={archive.matchId}>
                  {archiveOptionLabel(archive, i18n.language)}
                </option>
              ))}
            </select>
            <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={() => void refresh()}>
              {t("timeline.refresh")}
            </Button>
          </div>

          <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`min-w-0 flex-1 truncate tabular-nums ${archiveError && !replaying ? "text-destructive" : ""}`}>
              {archiveError && !replaying
                ? archiveError
                : replaying
                  ? loading
                    ? t("timeline.loading")
                    : loadFailed
                      ? archiveError || t("timeline.archiveReadFailed")
                      : t("timeline.tickProgress", { current: frameIndex + 1, total: frames.length })
                  : t("timeline.liveClock", { time: `${match.clock.minute}:${String(match.clock.second).padStart(2, "0")}` })}
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".fmlens,application/octet-stream"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void openLocalArchive(file)
                event.target.value = ""
              }}
            />
            <select
              className="h-8 shrink-0 rounded-md border bg-background px-1.5 text-xs"
              value={speed}
              disabled={!replaying}
              aria-label={t("timeline.speed")}
              onChange={(event) => setSpeed(Number(event.target.value))}
            >
              {[0.5, 1, 2, 4, 8, 16].map((value) => (
                <option key={value} value={value}>{value}×</option>
              ))}
            </select>
            <div
              className={`flex h-8 shrink-0 items-center rounded-md border border-dashed px-1 transition-colors ${draggingArchive ? "border-primary bg-primary/10" : "border-border bg-background/50"}`}
              onDragEnter={(event) => {
                event.preventDefault()
                setDraggingArchive(true)
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingArchive(false)
              }}
              onDrop={(event) => {
                event.preventDefault()
                const file = event.dataTransfer.files[0]
                if (file) void openLocalArchive(file)
                else setDraggingArchive(false)
              }}
              title={t("timeline.openArchiveHint")}
            >
              <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-[10px]" onClick={() => fileInputRef.current?.click()}>
                {t("timeline.openArchive")}
              </Button>
            </div>
          </div>
        </div>

        <div className="flex w-14 shrink-0 items-center justify-center">
          <Button
            type="button"
            variant={replaying ? "default" : "outline"}
            size="icon"
            className="size-11 shrink-0 rounded-full shadow-md shadow-primary/25 transition-transform hover:scale-105"
            disabled={!replaying || loading || frames.length === 0}
            aria-label={playing ? t("timeline.pause") : t("timeline.play")}
            onClick={() => setPlaying((current) => !current)}
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </Button>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <EventRail events={homeEvents} side="home" color={match.home.color ?? "#6cabdd"} />

          <div className="relative px-2">
            <span
              className="pointer-events-none absolute -top-0.5 z-10 -translate-x-1/2 rounded-sm bg-card px-1 text-[10px] font-semibold leading-none tabular-nums text-foreground shadow-[0_0_0_1px_hsl(var(--border))]"
              style={{ left: `${Math.max(0, Math.min(100, sliderPercent))}%` }}
            >
              {match.clock.minute}&apos;
            </span>
            <Slider
              min={0}
              max={sliderMax}
              step={1}
              value={[sliderValue]}
              disabled={!replaying || loading || frames.length === 0}
              onValueChange={(value) => {
                const next = Array.isArray(value) ? value[0] : value
                if (typeof next === "number") {
                  setPlaying(false)
                  setFrameIndex(next)
                }
              }}
              className="[&_[data-slot=slider-track]]:h-2 [&_[data-slot=slider-track]]:rounded-full [&_[data-slot=slider-range]]:bg-primary/80 [&_[data-slot=slider-thumb]]:size-4 [&_[data-slot=slider-thumb]]:rounded-full [&_[data-slot=slider-thumb]]:border-2 [&_[data-slot=slider-thumb]]:bg-background"
            />
          </div>

          <EventRail events={awayEvents} side="away" color={match.away.color ?? "#ef0107"} />
        </div>
      </section>
    </TooltipProvider>
  )
}

function archiveOptionLabel(
  archive: Pick<ArchiveSummary, "matchId" | "fileName" | "startedUnixMilliseconds" | "homeGoals" | "awayGoals" | "homeName" | "awayName" | "fileSizeBytes">,
  language: string,
  metadata?: RealtimeMatchMetadata,
) {
  const fileNames = archiveTeamNamesFromFileName(archive.matchId, archive.fileName)
  const homeName = archive.homeName ?? metadata?.home.name ?? fileNames?.home
  const awayName = archive.awayName ?? metadata?.away.name ?? fileNames?.away
  const matchup = homeName && awayName ? `${homeName} vs ${awayName} · ` : ""
  const size = Number.isFinite(archive.fileSizeBytes) ? ` · ${(archive.fileSizeBytes / 1024 / 1024).toFixed(1)} MiB` : ""
  return `${matchup}${new Date(archive.startedUnixMilliseconds).toLocaleString(language)} · ${archive.homeGoals}-${archive.awayGoals}${size}`
}

function archiveTeamNamesFromFileName(matchId: string, fileName?: string) {
  if (!fileName) return undefined
  const prefix = `${matchId}-`
  const suffix = ".fmlens"
  if (!fileName.startsWith(prefix) || !fileName.toLowerCase().endsWith(suffix)) return undefined
  const matchup = fileName.slice(prefix.length, -suffix.length)
  const separator = matchup.indexOf("-vs-")
  if (separator <= 0 || separator >= matchup.length - 4) return undefined
  return {
    home: matchup.slice(0, separator),
    away: matchup.slice(separator + 4),
  }
}

function localArchiveId(archive: ParsedLocalArchive) {
  return `local:${archive.archive.matchId}:${archive.archive.fileName}`
}

function EventRail({ events, side, color }: { events: TimelineEvent[]; side: TeamSide; color: string }) {
  return (
    <div className="relative h-6 min-w-0">
      {events.map((event) => (
        <Tooltip key={event.id}>
          <TooltipTrigger
            render={
              <button
                type="button"
                className={`absolute flex size-5 -translate-x-1/2 items-center justify-center rounded-full outline-none transition-transform hover:z-20 hover:scale-110 focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-ring ${side === "home" ? "bottom-0" : "top-0"}`}
                style={{ left: `${minuteToPercent(event.minute)}%` }}
                aria-label={`${event.label} ${event.minute}'`}
              />
            }
          >
            <EventIcon event={event} color={color} />
            {event.type !== "substitution" && event.occurrences > 1 && (
              <span className="pointer-events-none absolute -right-1.5 -top-1.5 flex min-w-3.5 items-center justify-center rounded-full bg-foreground px-0.5 text-[8px] font-bold leading-3.5 text-background">
                {event.occurrences}
              </span>
            )}
            <span className={`pointer-events-none absolute left-1/2 -translate-x-1/2 text-[8px] font-semibold leading-none tabular-nums text-muted-foreground ${side === "home" ? "-top-1.5" : "-bottom-1.5"}`}>
              {event.minute}&apos;
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-72">
            <div className="font-medium">{event.minute}&apos; · {event.label}</div>
            {event.details.map((detail, index) => (
              <div key={`${detail}-${index}`} className="text-xs opacity-90">{detail}</div>
            ))}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
}

function EventIcon({ event, color }: { event: TimelineEvent; color: string }) {
  if (event.type === "goal") {
    return <img src="./goal.svg" alt="" aria-hidden="true" className="size-4" />
  }

  if (event.type === "substitution") {
    return (
      <span
        aria-hidden="true"
        className="size-4 bg-current text-emerald-500 [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain] dark:text-emerald-400"
        style={{ WebkitMaskImage: "url(./change.svg)", maskImage: "url(./change.svg)" }}
      />
    )
  }

  return (
    <span
      aria-hidden="true"
      className={`block rounded-[2px] ${event.type === "red_card" ? "size-3 bg-red-500" : "size-3 bg-yellow-400"}`}
      style={{ boxShadow: `0 0 0 1px ${color}` }}
    />
  )
}

function PlayIcon() {
  return <span aria-hidden="true" className="ml-1 block size-0 border-y-[8px] border-l-[13px] border-y-transparent border-l-current" />
}

function PauseIcon() {
  return (
    <span aria-hidden="true" className="flex items-center gap-0.5">
      <span className="h-4.5 w-1.5 rounded-sm bg-current" />
      <span className="h-4.5 w-1.5 rounded-sm bg-current" />
    </span>
  )
}

function buildTimelineEvents(match: MatchSnapshot, t: (key: string) => string) {
  const matchEvents = match.events
    .filter((event) => event.type === "goal" || event.type === "yellow_card" || event.type === "red_card")
    .map((event): TimelineEvent | null => {
      const player = match.players.find((entry) => entry.id === event.playerId)
      const team = event.team ?? player?.team
      if (!team) return null

      const eventLabel = labelForEvent(event.type, t)
      const details = player?.name ? [`${eventLabel} · ${player.name}`] : [eventLabel]
      if (event.type === "goal") {
        const assistants = match.events
          .filter((candidate) => candidate.type === "assist_candidate" && assistBelongsToGoal(match, candidate, event, team))
          .map((candidate) => match.players.find((entry) => entry.id === candidate.playerId)?.name)
          .filter((name): name is string => Boolean(name))
        details.push(...assistants.map((name) => `${t("squad.assist")} · ${name}`))
      }

      return {
        id: event.id,
        type: event.type,
        minute: event.minute,
        team,
        label: eventLabel,
        details,
        occurrences: 1,
      }
    })
    .filter((event): event is TimelineEvent => event != null)

  const substitutionEvents = buildSubstitutionEvents(match, t)

  const grouped = new Map<string, TimelineEvent>()
  for (const event of matchEvents) {
    const key = `${event.team}-${event.minute}-${event.type}`
    const existing = grouped.get(key)
    if (existing) {
      existing.occurrences += event.occurrences
      for (const detail of event.details) {
        if (!existing.details.includes(detail)) existing.details.push(detail)
      }
    } else {
      grouped.set(key, { ...event, id: key, details: [...event.details] })
    }
  }

  return [...grouped.values(), ...substitutionEvents].sort((left, right) => left.minute - right.minute)
}

function assistBelongsToGoal(
  match: MatchSnapshot,
  assist: MatchSnapshot["events"][number],
  goal: MatchSnapshot["events"][number],
  team: TeamSide,
) {
  const assistTeam = assist.team ?? match.players.find((player) => player.id === assist.playerId)?.team
  if (assistTeam !== team) return false

  const closestGoal = match.events
    .filter((candidate) => {
      if (candidate.type !== "goal") return false
      const candidateTeam = candidate.team ?? match.players.find((player) => player.id === candidate.playerId)?.team
      return candidateTeam === team && Math.abs(candidate.minute - assist.minute) <= 2
    })
    .sort((left, right) => Math.abs(left.minute - assist.minute) - Math.abs(right.minute - assist.minute))[0]

  return closestGoal?.id === goal.id
}

function buildSubstitutionEvents(match: MatchSnapshot, t: (key: string) => string): TimelineEvent[] {
  const result: TimelineEvent[] = []

  for (const team of ["home", "away"] as const) {
    const entering = match.players
      .filter((player) => player.team === team && player.status?.subbedOnMinute != null)
      .map((player) => ({ player, minute: player.status!.subbedOnMinute! }))
      .sort((left, right) => left.minute - right.minute)
    const leaving = match.players
      .filter((player) => player.team === team && player.status?.subbedOffMinute != null)
      .map((player) => ({ player, minute: player.status!.subbedOffMinute! }))
      .sort((left, right) => left.minute - right.minute)
    const usedEntering = new Set<number>()

    for (const off of leaving) {
      let pairedIndex = -1
      let smallestGap = Number.POSITIVE_INFINITY
      entering.forEach((on, index) => {
        const gap = Math.abs(on.minute - off.minute)
        if (!usedEntering.has(index) && gap <= 2 && gap < smallestGap) {
          pairedIndex = index
          smallestGap = gap
        }
      })

      const on = pairedIndex >= 0 ? entering[pairedIndex] : undefined
      if (pairedIndex >= 0) usedEntering.add(pairedIndex)
      result.push({
        id: `sub-${team}-${off.player.id}-${on?.player.id ?? "none"}`,
        type: "substitution",
        minute: Math.min(off.minute, on?.minute ?? off.minute),
        team,
        label: t("timeline.substitution"),
        occurrences: 1,
        details: [
          `${t("squad.subbedOff")} · ${off.player.name}`,
          ...(on ? [`${t("squad.subbedOn")} · ${on.player.name}`] : []),
        ],
      })
    }

    entering.forEach((on, index) => {
      if (!usedEntering.has(index)) {
        result.push({
          id: `sub-${team}-none-${on.player.id}`,
          type: "substitution",
          minute: on.minute,
          team,
        label: t("timeline.substitution"),
        occurrences: 1,
        details: [`${t("squad.subbedOn")} · ${on.player.name}`],
        })
      }
    })
  }

  return result
}

function labelForEvent(type: MatchEventType, t: (key: string) => string) {
  switch (type) {
    case "goal": return t("squad.goal")
    case "yellow_card": return t("squad.yellowCard")
    case "red_card": return t("squad.redCard")
    default: return type
  }
}

function minuteToPercent(minute: number) {
  return Math.max(0, Math.min(100, (minute / 90) * 100))
}
