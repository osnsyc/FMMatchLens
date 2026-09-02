import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { ArrowDataTransferHorizontalIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
  tick?: number
  team: TeamSide
  label: string
  primaryPeople: string[]
  secondaryPeople: string[]
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

    let animationFrame = 0
    let previousTimestamp = performance.now()
    let frameCarry = 0

    const advance = (timestamp: number) => {
      const elapsedMilliseconds = Math.min(250, timestamp - previousTimestamp)
      previousTimestamp = timestamp
      frameCarry += (elapsedMilliseconds * speed) / 250
      const frameStep = Math.floor(frameCarry)

      if (frameStep > 0) {
        frameCarry -= frameStep
        setFrameIndex((current) => {
          const next = Math.min(frames.length - 1, current + frameStep)
          if (next >= frames.length - 1) setPlaying(false)
          return next
        })
      }

      animationFrame = window.requestAnimationFrame(advance)
    }

    animationFrame = window.requestAnimationFrame(advance)
    return () => window.cancelAnimationFrame(animationFrame)
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
  const sliderMax = 100
  const sliderPercent = replaying
    ? replayPercent(frameIndex, frames)
    : liveTimelinePercent(match.clock.elapsedTick, match)
  const sliderValue = sliderPercent
  const sliderLabelOffset = 10 - sliderPercent * 0.2

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

  const sourceOptions = [
    { value: "live", label: t("timeline.liveMatch") },
    ...(localArchive
      ? [{
          value: localArchiveId(localArchive),
          label: `${t("timeline.local")} · ${archiveOptionLabel(localArchive.archive, i18n.language, localArchive.metadata)}`,
        }]
      : []),
    ...archives.map((archive) => ({
      value: archive.matchId,
      label: archiveOptionLabel(archive, i18n.language),
    })),
  ]
  const selectedSourceValue = selectedId || "live"
  const selectedSourceLabel = sourceOptions.find((option) => option.value === selectedSourceValue)?.label
    ?? t("timeline.liveMatch")

  return (
    <TooltipProvider>
      <section className="flex h-full min-h-0 items-center gap-2 overflow-hidden px-4 py-1">
        <div className="flex w-64 shrink-0 flex-col gap-1.5">
          <div className="flex gap-1.5">
            <Select
              value={selectedSourceValue}
              onValueChange={(value) => selectSource(value === "live" || value == null ? "" : value)}
            >
              <SelectTrigger size="default" className="h-8 min-w-0 flex-1" aria-label={t("timeline.sourceLabel")}>
                <SelectValue className="min-w-0 truncate">{selectedSourceLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent align="start" alignItemWithTrigger={false} className="w-80 max-w-[calc(100vw-2rem)]">
                {sourceOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={() => void refresh()}>
              {t("timeline.refresh")}
            </Button>
          </div>

          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            {replaying && !loading && !loadFailed ? (
              <span
                className="flex h-8 min-w-0 flex-1 items-center justify-center rounded-md border border-border/70 bg-muted/35 px-2 tabular-nums shadow-xs"
                aria-label={t("timeline.tickProgress", { current: frameIndex + 1, total: frames.length })}
              >
                <span className="font-semibold text-foreground">{frameIndex + 1}</span>
                <span className="mx-1 text-muted-foreground/55">/</span>
                <span>{frames.length}</span>
                <span className="ml-1.5 text-[9px] font-semibold uppercase tracking-wider text-primary">Tick</span>
              </span>
            ) : (
              <span className={`flex h-8 min-w-0 flex-1 items-center truncate px-1 tabular-nums ${archiveError && !replaying ? "text-destructive" : ""}`}>
                {archiveError && !replaying
                  ? archiveError
                  : replaying
                    ? loading
                      ? t("timeline.loading")
                      : archiveError || t("timeline.archiveReadFailed")
                    : t("timeline.liveClock", { time: `${match.clock.minute}:${String(match.clock.second).padStart(2, "0")}` })}
              </span>
            )}
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
            <Select
              value={String(speed)}
              disabled={!replaying}
              onValueChange={(value) => {
                if (value != null) setSpeed(Number(value))
              }}
            >
              <SelectTrigger size="default" className="h-8 w-16 shrink-0 tabular-nums" aria-label={t("timeline.speed")}>
                <SelectValue>{speed}×</SelectValue>
              </SelectTrigger>
              <SelectContent align="end" alignItemWithTrigger={false} className="w-16 min-w-16">
                {[0.5, 1, 2, 4, 8, 16, 32, 64].map((value) => (
                  <SelectItem key={value} value={String(value)}>{value}×</SelectItem>
                ))}
              </SelectContent>
            </Select>
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

        <div className="relative flex min-w-0 flex-1 flex-col gap-1">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-1/2 z-0 w-px -translate-x-1/2 bg-primary/60"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-1/2 z-0 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-2 ring-card"
          />
          <EventRail events={homeEvents} side="home" color={match.home.color ?? "#6cabdd"} match={match} frames={frames} replaying={replaying} />

          <div className="relative z-1">
            <span
              className="pointer-events-none absolute top-1/2 z-10 -ml-2.5 w-5 -translate-y-1/2 bg-transparent p-0 text-center text-[8px] font-bold leading-none tabular-nums text-foreground"
              style={{
                left: `${Math.max(0, Math.min(100, sliderPercent))}%`,
                marginLeft: `${sliderLabelOffset - 10}px`,
              }}
            >
              {formatTimelineClock(match)}
            </span>
            <Slider
              min={0}
              max={sliderMax}
              step={1}
              value={[sliderValue]}
              disabled={!replaying || loading || frames.length === 0}
              onValueChange={(value) => {
                const next = Array.isArray(value) ? value[0] : value
                if (typeof next === "number" && replaying) {
                  setPlaying(false)
                  setFrameIndex(replayFrameIndex(next, frames))
                }
              }}
              className="[&_[data-slot=slider-track]]:h-2 [&_[data-slot=slider-track]]:rounded-full [&_[data-slot=slider-range]]:bg-primary/80 [&_[data-slot=slider-thumb]]:size-5 [&_[data-slot=slider-thumb]]:rounded-full [&_[data-slot=slider-thumb]]:border-2 [&_[data-slot=slider-thumb]]:bg-background"
            />
          </div>

          <EventRail events={awayEvents} side="away" color={match.away.color ?? "#ef0107"} match={match} frames={frames} replaying={replaying} />
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

function EventRail({
  events,
  side,
  color,
  match,
  frames,
  replaying,
}: {
  events: TimelineEvent[]
  side: TeamSide
  color: string
  match: MatchSnapshot
  frames: RealtimeFrame[]
  replaying: boolean
}) {
  const positionedEvents = layoutEvents(events, (event) => eventTimelinePercent(event, match, frames, replaying))

  return (
    <div className="relative z-20 h-6 min-w-0">
      {positionedEvents.map(({ event, percent, offset }) => (
        <Tooltip key={event.id}>
          <TooltipTrigger
            render={
              <button
                type="button"
                className={`absolute z-20 flex size-5 items-center justify-center rounded-full outline-none transition-transform hover:z-30 hover:scale-110 focus-visible:z-30 focus-visible:ring-2 focus-visible:ring-ring ${side === "home" ? "bottom-0" : "top-0"}`}
                style={{
                  left: `${percent}%`,
                  transform: `translateX(calc(-50% + ${offset}px))`,
                }}
                aria-label={`${event.label} ${event.minute}'`}
              />
            }
          >
            <EventIcon event={event} color={color} />
            {event.occurrences > 1 && (
              <span className="pointer-events-none absolute -right-1.5 -top-0.5 z-30 flex min-w-3.5 items-center justify-center rounded-full bg-foreground px-0.5 text-[8px] font-bold leading-3.5 text-background shadow-sm">
                {event.occurrences}
              </span>
            )}
            <span className={`pointer-events-none absolute left-1/2 -translate-x-1/2 text-[8px] font-semibold leading-none tabular-nums text-muted-foreground ${side === "home" ? "-top-1.5" : "-bottom-1.5"}`}>
              {event.minute}&apos;
            </span>
          </TooltipTrigger>
          <TooltipContent className="w-max max-w-none gap-0 px-2.5 py-2">
            <div className="grid grid-cols-[auto_auto] grid-rows-2 items-center gap-x-4 gap-y-1 whitespace-nowrap">
              <span className="font-semibold tabular-nums text-background">{event.minute}&apos;</span>
              <TimelineEventPeople event={event} row="primary" />
              <span className="text-[10px] font-medium text-background/65">{event.label}</span>
              <TimelineEventPeople event={event} row="secondary" />
            </div>
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
}

function TimelineEventPeople({ event, row }: { event: TimelineEvent; row: "primary" | "secondary" }) {
  const people = row === "primary" ? event.primaryPeople : event.secondaryPeople
  if (people.length === 0) return <span aria-hidden="true" />

  return (
    <span className="flex items-center gap-1.5 font-medium text-background">
      <TimelineDetailIcon event={event} row={row} />
      <span>{people.join(" / ")}</span>
    </span>
  )
}

function TimelineDetailIcon({ event, row }: { event: TimelineEvent; row: "primary" | "secondary" }) {
  if (event.type === "goal") {
    return <img src={row === "primary" ? "./goal.svg" : "./assist.svg"} alt="" aria-hidden="true" className="size-3.5 shrink-0" />
  }

  if (event.type === "substitution") {
    return (
      <HugeiconsIcon
        icon={ArrowDataTransferHorizontalIcon}
        strokeWidth={3}
        aria-hidden="true"
        className={`size-3.5 shrink-0 ${row === "primary" ? "text-emerald-400" : "text-rose-400"}`}
      />
    )
  }

  return (
    <span
      aria-hidden="true"
      className={`size-2.5 shrink-0 rounded-[2px] ${event.type === "red_card" ? "bg-red-500" : "bg-yellow-400"}`}
    />
  )
}

function EventIcon({ event, color }: { event: TimelineEvent; color: string }) {
  if (event.type === "goal") {
    return <img src="./goal.svg" alt="" aria-hidden="true" className="size-4" />
  }

  if (event.type === "substitution") {
    return (
      <HugeiconsIcon
        icon={ArrowDataTransferHorizontalIcon}
        strokeWidth={3}
        aria-hidden="true"
        className="size-4 text-emerald-500 dark:text-emerald-400"
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
      let assistants: string[] = []
      if (event.type === "goal") {
        assistants = match.events
          .filter((candidate) => candidate.type === "assist_candidate" && assistBelongsToGoal(match, candidate, event, team))
          .map((candidate) => match.players.find((entry) => entry.id === candidate.playerId)?.name)
          .filter((name): name is string => Boolean(name))
      }

      return {
        id: event.id,
        type: event.type,
        minute: event.minute,
        tick: event.tick,
        team,
        label: eventLabel,
        primaryPeople: player?.name ? [player.name] : [],
        secondaryPeople: assistants,
        occurrences: 1,
      }
    })
    .filter((event): event is TimelineEvent => event != null)

  const substitutionEvents = buildSubstitutionEvents(match, t)

  const grouped = new Map<string, TimelineEvent>()
  for (const event of [...matchEvents, ...substitutionEvents]) {
    const key = `${event.team}-${event.minute}-${event.type}`
    const existing = grouped.get(key)
    if (existing) {
      existing.occurrences += event.occurrences
      for (const person of event.primaryPeople) {
        if (!existing.primaryPeople.includes(person)) existing.primaryPeople.push(person)
      }
      for (const person of event.secondaryPeople) {
        if (!existing.secondaryPeople.includes(person)) existing.secondaryPeople.push(person)
      }
    } else {
      grouped.set(key, {
        ...event,
        id: key,
        primaryPeople: [...event.primaryPeople],
        secondaryPeople: [...event.secondaryPeople],
      })
    }
  }

  return [...grouped.values()].sort((left, right) => left.minute - right.minute)
}

function eventTimelineMinute(event: TimelineEvent, match: MatchSnapshot) {
  if (event.tick != null) return Math.max(0, event.tick / 240)

  // Player status currently exposes only the display minute. Once the second
  // half begins, Tick includes the first-half stoppage that DisplayTick hides.
  const firstHalfOffset = match.period >= 2
    ? Math.max(0, match.clock.elapsedTick / 240 - (match.clock.minute + match.clock.second / 60))
    : 0
  return event.minute + (event.minute > 45 ? firstHalfOffset : 0)
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
        primaryPeople: on ? [on.player.name] : [],
        secondaryPeople: [off.player.name],
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
          primaryPeople: [on.player.name],
          secondaryPeople: [],
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

function eventTimelinePercent(
  event: TimelineEvent,
  match: MatchSnapshot,
  frames: readonly RealtimeFrame[],
  replaying: boolean,
) {
  if (replaying && event.tick != null && frames.length > 1) {
    return tickToReplayPercent(event.tick, frames)
  }

  const tick = event.tick ?? eventTimelineMinute(event, match) * 240
  if (replaying && frames.length > 1) {
    return tickToReplayPercent(tick, frames)
  }
  return liveTimelinePercent(tick, match)
}

function layoutEvents(events: readonly TimelineEvent[], getPercent: (event: TimelineEvent) => number) {
  const positioned = events
    .map((event) => ({ event, percent: getPercent(event) }))
    .sort((left, right) => left.percent - right.percent)
  const result: Array<{ event: TimelineEvent; percent: number; offset: number }> = []

  // A percentage alone cannot express a fixed pixel gap on a responsive rail.
  // Spread close events around their shared anchor so the 20px icons always
  // retain a visible gap (especially substitutions followed by goals).
  for (let index = 0; index < positioned.length;) {
    let end = index + 1
    while (end < positioned.length && positioned[end].percent - positioned[end - 1].percent <= 2.5) end += 1
    const count = end - index
    const middle = (count - 1) / 2
    for (let cursor = index; cursor < end; cursor += 1) {
      result.push({
        ...positioned[cursor],
        offset: (cursor - index - middle) * 24,
      })
    }
    index = end
  }
  return result
}

function tickToReplayPercent(tick: number, frames: readonly RealtimeFrame[]) {
  const startTick = frames[0].tick
  const endTick = frames.at(-1)?.tick ?? startTick
  return endTick > startTick
    ? Math.max(0, Math.min(100, ((tick - startTick) / (endTick - startTick)) * 100))
    : 0
}

function replayPercent(frameIndex: number, frames: readonly RealtimeFrame[]) {
  const frame = frames[frameIndex]
  return frame ? tickToReplayPercent(frame.tick, frames) : 0
}

function replayFrameIndex(percent: number, frames: readonly RealtimeFrame[]) {
  if (frames.length <= 1) return 0
  const startTick = frames[0].tick
  const endTick = frames.at(-1)?.tick ?? startTick
  const targetTick = startTick + (Math.max(0, Math.min(100, percent)) / 100) * (endTick - startTick)
  let low = 0
  let high = frames.length - 1
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (frames[middle].tick < targetTick) low = middle + 1
    else high = middle
  }
  return low
}

function liveTimelinePercent(tick: number, match: MatchSnapshot) {
  const firstHalfTicks = 45 * 240
  if (match.period < 2) {
    return Math.max(0, Math.min(100, (tick / firstHalfTicks) * 50))
  }

  // Tick keeps first-half stoppage; DisplayTick hides that offset after the
  // interval. This lets us permanently compress the first half to 0..50.
  const displayTick = match.clock.minute * 240 + match.clock.second * 4
  const firstHalfOffset = Math.max(0, match.clock.elapsedTick - displayTick)
  const firstHalfEnd = firstHalfTicks + firstHalfOffset
  if (tick <= firstHalfEnd) {
    return Math.max(0, Math.min(50, (tick / firstHalfEnd) * 50))
  }

  const secondHalfTick = tick - firstHalfEnd
  const currentSecondHalfTicks = Math.max(firstHalfTicks, match.clock.elapsedTick - firstHalfEnd)
  return Math.max(50, Math.min(100, 50 + (secondHalfTick / currentSecondHalfTicks) * 50))
}

function formatTimelineClock(match: MatchSnapshot) {
  const displaySeconds = match.clock.minute * 60 + match.clock.second
  const plannedSeconds = (match.period >= 2 ? 90 : 45) * 60
  if (displaySeconds <= plannedSeconds) return `${match.clock.minute}`
  const extraSeconds = displaySeconds - plannedSeconds
  return `+${Math.floor(extraSeconds / 60)}`
}
