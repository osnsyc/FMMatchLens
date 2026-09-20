import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  ArrowDataTransferHorizontalIcon,
  FootballIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import type { ArchivePage, ArchiveSummary } from "@/api/archiveTypes"
import type { RealtimeFrame, RealtimeMatchMetadata } from "@/api/realtimeMatch"
import { parseLocalArchive } from "@/api/localArchive"
import type { ReplayArchive } from "@/api/replay/replayTypes"
import { useReplaySession } from "@/hooks/useReplaySession"
import { AssistIcon } from "@/components/AssistIcon"
import { ArchivePicker } from "@/components/ArchivePicker"
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
import type { MatchEventType, MatchSnapshot, TeamSide } from "@/types/match"

const apiBase = `http://127.0.0.1:${__API_PORT__}`
const pageSize = 2_400

type ArchiveSlice = {
  archive: ArchiveSummary
  metadata?: RealtimeMatchMetadata
  metadataTimeline?: RealtimeMatchMetadata[]
  frames: readonly RealtimeFrame[]
}

type MatchTimelineProps = {
  match: MatchSnapshot
  initialLocalArchive?: ReplayArchive
  localConnectionEnabled: boolean
  onReplayFrame: (snapshot: MatchSnapshot) => void
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

export function MatchTimeline({
  match,
  initialLocalArchive,
  localConnectionEnabled,
  onReplayFrame,
  onLive,
}: MatchTimelineProps) {
  const { t, i18n } = useTranslation()
  const [archives, setArchives] = useState<ArchiveSummary[]>([])
  const [archivePage, setArchivePage] = useState({
    page: 0,
    pageSize: 5,
    totalCount: 0,
    pageCount: 1,
  })
  const [selectedId, setSelectedId] = useState(
    initialLocalArchive ? localArchiveId(initialLocalArchive) : ""
  )
  const [frames, setFrames] = useState<readonly RealtimeFrame[]>(
    initialLocalArchive?.frames ?? []
  )
  const [frameIndex, setFrameIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [pendingSourceId, setPendingSourceId] = useState<string>()
  const [selectedArchive, setSelectedArchive] = useState<ArchiveSummary>()
  const [selectedArchivePage, setSelectedArchivePage] = useState(0)
  const [localArchive, setLocalArchive] = useState<ReplayArchive | undefined>(
    initialLocalArchive
  )
  const [archiveError, setArchiveError] = useState("")
  const [draftSliderPercent, setDraftSliderPercent] = useState<number>()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const archivePageRequestRef = useRef(0)
  const localArchiveRequestRef = useRef(0)
  const sliderRafRef = useRef(0)
  const pendingSliderRef = useRef<number | undefined>(undefined)
  const {
    activate: activateReplay,
    prepare: prepareReplay,
    advanceTo: advanceReplayTo,
    dispose: disposeReplay,
    preprocessing,
    progress: preprocessingProgress,
  } = useReplaySession(onReplayFrame, localConnectionEnabled)

  const refresh = useCallback(
    async (requestedPage = 0) => {
      if (!localConnectionEnabled) return
      const requestId = ++archivePageRequestRef.current
      setRefreshing(true)
      try {
        const response = await fetch(
          `${apiBase}/api/archives?page=${requestedPage}&pageSize=5`
        )
        if (!response.ok) throw new Error("archive list failed")
        const result = (await response.json()) as ArchivePage
        if (requestId !== archivePageRequestRef.current) return
        const summaries = result.items
        setArchivePage({
          page: result.page,
          pageSize: result.pageSize,
          totalCount: result.totalCount,
          pageCount: result.pageCount,
        })
        setArchives(summaries)

        void Promise.all([
          fetch(`${apiBase}/api/match/status`),
          fetch(`${apiBase}/api/match/meta`),
        ])
          .then(async ([statusResponse, metadataResponse]) => {
            if (!statusResponse.ok || !metadataResponse.ok) return
            const status = (await statusResponse.json()) as { matchId?: string }
            const activeMetadata =
              (await metadataResponse.json()) as RealtimeMatchMetadata | null
            if (requestId !== archivePageRequestRef.current) return
            setArchives(
              summaries.map((archive) =>
                archive.matchId === status.matchId && activeMetadata
                  ? {
                      ...archive,
                      homeName: activeMetadata.home.name,
                      awayName: activeMetadata.away.name,
                      matchDate: activeMetadata.matchDate,
                    }
                  : archive
              )
            )
          })
          .catch(() => {
            // Archive summaries remain usable without active-match enrichment.
          })
      } catch {
        // Keep the last successful list and the active replay available.
      } finally {
        if (requestId === archivePageRequestRef.current) setRefreshing(false)
      }
    },
    [localConnectionEnabled]
  )

  useEffect(() => {
    if (!localConnectionEnabled) return
    const timer = window.setTimeout(() => void refresh(0), 0)
    return () => window.clearTimeout(timer)
  }, [localConnectionEnabled, refresh])

  useEffect(() => {
    if (!initialLocalArchive) return
    activateReplay(initialLocalArchive)
  }, [activateReplay, initialLocalArchive])

  useEffect(
    () => () => {
      if (sliderRafRef.current)
        window.cancelAnimationFrame(sliderRafRef.current)
    },
    []
  )

  useEffect(() => {
    if (
      !localConnectionEnabled ||
      !pendingSourceId ||
      pendingSourceId.startsWith("local:")
    )
      return

    let cancelled = false
    const targetId = pendingSourceId

    const load = async () => {
      const loaded: RealtimeFrame[] = []
      let loadedMetadata: RealtimeMatchMetadata | undefined
      let loadedMetadataTimeline: RealtimeMatchMetadata[] = []
      let loadedSummary: ArchiveSummary | undefined
      let fromTick = 0

      try {
        while (!cancelled) {
          const url = `${apiBase}/api/archives/${encodeURIComponent(targetId)}/frames?fromTick=${fromTick}&stride=1&limit=${pageSize}`
          const response = await fetch(url)
          if (!response.ok) throw new Error("archive read failed")
          const page = (await response.json()) as ArchiveSlice
          loadedSummary = page.archive
          loadedMetadata ??= page.metadata
          if (
            loadedMetadataTimeline.length === 0 &&
            page.metadataTimeline?.length
          ) {
            loadedMetadataTimeline = page.metadataTimeline
          }
          if (page.frames.length === 0) break

          loaded.push(...page.frames)
          const lastTick = page.frames.at(-1)?.tick ?? fromTick
          if (
            lastTick >= page.archive.lastTick ||
            page.frames.length < pageSize
          )
            break
          fromTick = lastTick + 1
        }

        if (!cancelled) {
          if (!loadedSummary) throw new Error("archive has no summary")
          const prepared = await prepareReplay({
            summary: {
              ...loadedSummary,
              fileName:
                loadedSummary.fileName ?? `${loadedSummary.matchId}.fmlens`,
            },
            metadata: loadedMetadata,
            metadataTimeline: loadedMetadataTimeline,
            frames: loaded,
          })
          if (!cancelled && prepared) {
            activateReplay(prepared)
            setFrames(prepared.frames)
            setFrameIndex(0)
            setSelectedArchive(loadedSummary)
            setSelectedId(targetId)
            setPendingSourceId(undefined)
            setArchiveError("")
          }
        }
      } catch {
        if (!cancelled) {
          setPendingSourceId(undefined)
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
  }, [
    activateReplay,
    localConnectionEnabled,
    pendingSourceId,
    prepareReplay,
    t,
  ])

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
    if (selectedId && frames[frameIndex]) advanceReplayTo(frameIndex)
  }, [advanceReplayTo, frameIndex, frames, selectedId])

  const events = useTimelineEvents(
    match,
    t,
    i18n.resolvedLanguage ?? i18n.language
  )
  const homeEvents = useMemo(
    () => events.filter((event) => event.team === "home"),
    [events]
  )
  const awayEvents = useMemo(
    () => events.filter((event) => event.team === "away"),
    [events]
  )
  const replaying = selectedId !== ""
  const busy = loading || preprocessing
  const sliderMax = 100
  const committedSliderPercent = replaying
    ? replayPercent(frameIndex, frames)
    : liveTimelinePercent(match.clock.elapsedTick, match)
  const sliderPercent = draftSliderPercent ?? committedSliderPercent
  const sliderValue = sliderPercent
  const sliderLabelOffset = 10 - sliderPercent * 0.2

  const queueSliderSeek = (percent: number) => {
    setPlaying(false)
    setDraftSliderPercent(percent)
    pendingSliderRef.current = percent
    if (sliderRafRef.current) return
    sliderRafRef.current = window.requestAnimationFrame(() => {
      sliderRafRef.current = 0
      const pending = pendingSliderRef.current
      if (pending == null) return
      setFrameIndex(replayFrameIndex(pending, frames))
    })
  }

  const commitSliderSeek = (percent: number) => {
    if (sliderRafRef.current) window.cancelAnimationFrame(sliderRafRef.current)
    sliderRafRef.current = 0
    pendingSliderRef.current = undefined
    setDraftSliderPercent(undefined)
    setFrameIndex(replayFrameIndex(percent, frames))
  }

  const selectSource = (matchId: string) => {
    localArchiveRequestRef.current += 1
    if (localArchive && matchId === localArchiveId(localArchive)) {
      setFrames(localArchive.frames)
      activateReplay(localArchive)
      setFrameIndex(0)
      setPlaying(false)
      setLoading(false)
      setPendingSourceId(undefined)
      setArchiveError("")
      setSelectedArchive(undefined)
      setSelectedId(matchId)
      return
    }

    setPlaying(false)
    setArchiveError("")
    if (matchId === "") {
      setPendingSourceId(undefined)
      setLoading(false)
      setSelectedId("")
      setSelectedArchive(undefined)
      disposeReplay()
      onLive()
      return
    }

    if (matchId === selectedId) return
    setSelectedArchivePage(archivePage.page)
    setLoading(true)
    setPendingSourceId(matchId)
  }

  const openLocalArchive = async (file: File) => {
    const requestId = ++localArchiveRequestRef.current
    setPlaying(false)
    setLoading(true)
    setPendingSourceId("local:pending")
    setArchiveError("")

    try {
      if (!file.name.toLowerCase().endsWith(".fmlens"))
        throw new Error(t("timeline.chooseArchive"))
      const parsed = await parseLocalArchive(
        await file.arrayBuffer(),
        file.name
      )
      if (requestId !== localArchiveRequestRef.current) return
      const prepared = await prepareReplay({
        summary: parsed.archive,
        metadata: parsed.metadata,
        metadataTimeline: parsed.metadataTimeline,
        frames: parsed.frames,
      })
      if (!prepared || requestId !== localArchiveRequestRef.current) return
      activateReplay(prepared)
      setLocalArchive(prepared)
      setFrames(prepared.frames)
      setFrameIndex(0)
      setSelectedArchive(undefined)
      setSelectedId(localArchiveId(prepared))
    } catch (error) {
      if (requestId !== localArchiveRequestRef.current) return
      setArchiveError(
        error instanceof Error
          ? error.message
          : t("timeline.localArchiveReadFailed")
      )
    } finally {
      if (requestId === localArchiveRequestRef.current) {
        setPendingSourceId(undefined)
        setLoading(false)
      }
    }
  }

  return (
    <TooltipProvider>
      <section className="flex h-full min-h-0 items-center gap-2 overflow-hidden px-4 py-1">
        <div className="flex w-64 shrink-0 flex-col gap-1.5">
          <ArchivePicker
            archives={archives}
            page={archivePage.page}
            pageCount={archivePage.pageCount}
            totalCount={archivePage.totalCount}
            selectedId={selectedId}
            selectedArchive={selectedArchive}
            selectedArchivePage={selectedArchivePage}
            localArchive={localArchive}
            liveMinute={match.clock.minute}
            liveSecond={match.clock.second}
            busy={busy}
            refreshing={refreshing}
            archiveError={archiveError}
            locale={i18n.resolvedLanguage ?? i18n.language}
            onSelectLive={() => selectSource("")}
            onSelectArchive={selectSource}
            onSelectLocalArchive={() => {
              if (localArchive) selectSource(localArchiveId(localArchive))
            }}
            onOpenLocalFile={() => fileInputRef.current?.click()}
            onDropLocalFile={(file) => void openLocalArchive(file)}
            onRefresh={() => void refresh(archivePage.page)}
            onPageChange={(page) => void refresh(page)}
          />

          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            {replaying && !busy ? (
              <span
                className="flex h-8 min-w-0 flex-1 items-center justify-center rounded-md border border-border/70 bg-muted/35 px-2 tabular-nums shadow-xs"
                aria-label={t("timeline.tickProgress", {
                  current: frameIndex + 1,
                  total: frames.length,
                })}
              >
                <span className="font-semibold text-foreground">
                  {frameIndex + 1}
                </span>
                <span className="mx-1 text-muted-foreground/55">/</span>
                <span>{frames.length}</span>
                <span className="ml-1.5 text-[9px] font-semibold tracking-wider text-primary uppercase">
                  Tick
                </span>
              </span>
            ) : (
              <span
                className={`flex h-8 min-w-0 flex-1 items-center truncate px-1 tabular-nums ${archiveError && !replaying ? "text-destructive" : ""}`}
              >
                {archiveError && !replaying
                  ? archiveError
                  : replaying
                    ? busy
                      ? `${t("timeline.loading")}${preprocessing ? ` ${Math.round(preprocessingProgress * 100)}%` : ""}`
                      : archiveError || t("timeline.archiveReadFailed")
                    : t("timeline.liveClock", {
                        time: `${match.clock.minute}:${String(match.clock.second).padStart(2, "0")}`,
                      })}
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
              <SelectTrigger
                size="default"
                className="h-8 w-16 shrink-0 tabular-nums"
                aria-label={t("timeline.speed")}
              >
                <SelectValue>{speed}×</SelectValue>
              </SelectTrigger>
              <SelectContent
                align="end"
                alignItemWithTrigger={false}
                className="w-16 min-w-16"
              >
                {[0.5, 1, 2, 4, 8, 16, 32, 64].map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {value}×
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex w-14 shrink-0 items-center justify-center">
          <Button
            type="button"
            variant={replaying ? "default" : "outline"}
            size="icon"
            className="size-11 shrink-0 rounded-full shadow-md shadow-primary/25 transition-transform hover:scale-105"
            disabled={!replaying || busy || frames.length === 0}
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
            className="pointer-events-none absolute top-1/2 left-1/2 z-0 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-2 ring-card"
          />
          <EventRail
            events={homeEvents}
            side="home"
            color={match.home.color ?? "var(--team-home-fallback)"}
            match={match}
            frames={frames}
            replaying={replaying}
          />

          <div className="relative z-1">
            <span
              className="pointer-events-none absolute top-1/2 z-10 -ml-2.5 w-5 -translate-y-1/2 bg-transparent p-0 text-center text-[8px] leading-none font-bold text-foreground tabular-nums"
              style={{
                left: `${Math.max(0, Math.min(100, sliderPercent))}%`,
                marginLeft: `${sliderLabelOffset - 10}px`,
              }}
            >
              {draftSliderPercent == null
                ? formatTimelineClock(match)
                : formatReplayClock(draftSliderPercent, frames)}
            </span>
            <Slider
              min={0}
              max={sliderMax}
              step={1}
              value={[sliderValue]}
              disabled={!replaying || busy || frames.length === 0}
              onValueChange={(value) => {
                const next = Array.isArray(value) ? value[0] : value
                if (typeof next === "number" && replaying) {
                  queueSliderSeek(next)
                }
              }}
              onValueCommitted={(value) => {
                const next = Array.isArray(value) ? value[0] : value
                if (typeof next === "number" && replaying)
                  commitSliderSeek(next)
              }}
              className="[&_[data-slot=slider-range]]:bg-primary/80 [&_[data-slot=slider-thumb]]:size-5 [&_[data-slot=slider-thumb]]:rounded-full [&_[data-slot=slider-thumb]]:border-2 [&_[data-slot=slider-thumb]]:bg-background [&_[data-slot=slider-track]]:h-2 [&_[data-slot=slider-track]]:rounded-full"
            />
          </div>

          <EventRail
            events={awayEvents}
            side="away"
            color={match.away.color ?? "var(--team-away-fallback)"}
            match={match}
            frames={frames}
            replaying={replaying}
          />
        </div>
      </section>
    </TooltipProvider>
  )
}

function localArchiveId(archive: ReplayArchive) {
  return `local:${archive.summary.matchId}:${archive.summary.fileName}`
}

function useTimelineEvents(
  match: MatchSnapshot,
  t: (key: string) => string,
  language: string
) {
  const key = `${language}|${match.events
    .map(
      (event) =>
        `${event.id}:${event.type}:${event.minute}:${event.tick ?? ""}:${event.team ?? ""}:${event.playerId ?? ""}`
    )
    .join("|")}|${match.players
    .map(
      (player) =>
        `${player.id}:${player.name}:${player.team}:${player.status?.subbedOnMinute ?? ""}:${player.status?.subbedOffMinute ?? ""}`
    )
    .join("|")}`
  // The key is a compact view-model revision: ratings and coordinates are
  // intentionally excluded so ordinary replay frames do not rebuild rails.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => buildTimelineEvents(match, t), [key, t])
}

const EventRail = memo(
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
    frames: readonly RealtimeFrame[]
    replaying: boolean
  }) {
    const positionedEvents = layoutEvents(events, (event) =>
      eventTimelinePercent(event, match, frames, replaying)
    )

    return (
      <div className="relative z-20 h-6 min-w-0">
        {positionedEvents.map(({ event, percent, offset }) => (
          <Tooltip key={event.id}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className={`absolute z-20 flex size-5 items-center justify-center rounded-full transition-transform outline-none hover:z-30 hover:scale-110 focus-visible:z-30 focus-visible:ring-2 focus-visible:ring-ring ${side === "home" ? "bottom-0" : "top-0"}`}
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
                <span className="pointer-events-none absolute -top-0.5 -right-1.5 z-30 flex min-w-3.5 items-center justify-center rounded-full bg-foreground px-0.5 text-[8px] leading-3.5 font-bold text-background shadow-sm">
                  {event.occurrences}
                </span>
              )}
              <span
                className={`pointer-events-none absolute left-1/2 -translate-x-1/2 text-[8px] leading-none font-semibold text-muted-foreground tabular-nums ${side === "home" ? "-top-1.5" : "-bottom-1.5"}`}
              >
                {event.minute}&apos;
              </span>
            </TooltipTrigger>
            <TooltipContent className="w-max max-w-none gap-0 px-2.5 py-2">
              <div className="grid grid-cols-[auto_auto] grid-rows-2 items-center gap-x-4 gap-y-1 whitespace-nowrap">
                <span className="font-semibold text-background tabular-nums">
                  {event.minute}&apos;
                </span>
                <TimelineEventPeople event={event} row="primary" />
                <span className="text-[10px] font-medium text-background/65">
                  {event.label}
                </span>
                <TimelineEventPeople event={event} row="secondary" />
              </div>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    )
  },
  (previous, next) => {
    if (
      previous.events !== next.events ||
      previous.side !== next.side ||
      previous.color !== next.color ||
      previous.frames !== next.frames ||
      previous.replaying !== next.replaying
    ) {
      return false
    }
    if (next.replaying) {
      return (
        replayFirstHalfOffset(previous.match) ===
        replayFirstHalfOffset(next.match)
      )
    }
    return (
      previous.match.period === next.match.period &&
      previous.match.clock.elapsedTick === next.match.clock.elapsedTick
    )
  }
)

function TimelineEventPeople({
  event,
  row,
}: {
  event: TimelineEvent
  row: "primary" | "secondary"
}) {
  const people = row === "primary" ? event.primaryPeople : event.secondaryPeople
  if (people.length === 0) return <span aria-hidden="true" />

  return (
    <span className="flex items-center gap-1.5 font-medium text-background">
      <TimelineDetailIcon event={event} row={row} />
      <span>{people.join(" / ")}</span>
    </span>
  )
}

function TimelineDetailIcon({
  event,
  row,
}: {
  event: TimelineEvent
  row: "primary" | "secondary"
}) {
  if (event.type === "own_goal") {
    return (
      <HugeiconsIcon
        icon={FootballIcon}
        stroke="currentColor"
        strokeWidth={1.5}
        aria-hidden="true"
        className="size-3.5 shrink-0 text-status-negative"
      />
    )
  }

  if (event.type === "goal") {
    return row === "primary" ? (
      <img
        src="./goal.svg"
        alt=""
        aria-hidden="true"
        className="size-3.5 shrink-0"
      />
    ) : (
      <AssistIcon aria-hidden="true" className="size-3.5 shrink-0" />
    )
  }

  if (event.type === "substitution") {
    return (
      <HugeiconsIcon
        icon={ArrowDataTransferHorizontalIcon}
        strokeWidth={3}
        aria-hidden="true"
        className={`size-3.5 shrink-0 ${row === "primary" ? "text-status-positive" : "text-status-negative"}`}
      />
    )
  }

  return (
    <span
      aria-hidden="true"
      className={`size-2.5 shrink-0 rounded-[2px] ${event.type === "red_card" ? "bg-status-negative" : "bg-status-warning"}`}
    />
  )
}

function EventIcon({ event, color }: { event: TimelineEvent; color: string }) {
  if (event.type === "own_goal") {
    return (
      <HugeiconsIcon
        icon={FootballIcon}
        stroke="currentColor"
        strokeWidth={1.5}
        aria-hidden="true"
        className="size-3.5 shrink-0 text-status-negative"
      />
    )
  }

  if (event.type === "goal") {
    return <img src="./goal.svg" alt="" aria-hidden="true" className="size-4" />
  }

  if (event.type === "substitution") {
    return (
      <HugeiconsIcon
        icon={ArrowDataTransferHorizontalIcon}
        strokeWidth={3}
        aria-hidden="true"
        className="size-4 text-status-positive"
      />
    )
  }

  return (
    <span
      aria-hidden="true"
      className={`block rounded-[2px] ${event.type === "red_card" ? "size-3 bg-status-negative" : "size-3 bg-status-warning"}`}
      style={{ boxShadow: `0 0 0 1px ${color}` }}
    />
  )
}

function PlayIcon() {
  return (
    <span
      aria-hidden="true"
      className="ml-1 block size-0 border-y-[8px] border-l-[13px] border-y-transparent border-l-current"
    />
  )
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
  const playerById = new Map(match.players.map((player) => [player.id, player]))
  const goals = match.events
    .filter((event) => event.type === "goal")
    .map((event) => ({
      event,
      team: event.team ?? playerById.get(event.playerId ?? -1)?.team,
    }))
  const assistantsByGoal = new Map<string, string[]>()
  for (const assist of match.events) {
    if (assist.type !== "assist_candidate") continue
    const team = assist.team ?? playerById.get(assist.playerId ?? -1)?.team
    let closest: (typeof goals)[number] | undefined
    let closestDistance = Number.POSITIVE_INFINITY
    for (const goal of goals) {
      const distance = Math.abs(goal.event.minute - assist.minute)
      if (goal.team === team && distance <= 2 && distance < closestDistance) {
        closest = goal
        closestDistance = distance
      }
    }
    const assistant = playerById.get(assist.playerId ?? -1)?.name
    if (!closest || !assistant) continue
    const names = assistantsByGoal.get(closest.event.id) ?? []
    names.push(assistant)
    assistantsByGoal.set(closest.event.id, names)
  }

  const matchEvents = match.events
    .filter(
      (event) =>
        event.type === "goal" ||
        event.type === "own_goal" ||
        event.type === "yellow_card" ||
        event.type === "red_card"
    )
    .map((event): TimelineEvent | null => {
      const player = playerById.get(event.playerId ?? -1)
      const team = event.team ?? player?.team
      if (!team) return null

      const eventLabel = labelForEvent(event.type, t)
      return {
        id: event.id,
        type: event.type,
        minute: event.minute,
        tick: event.tick,
        team,
        label: eventLabel,
        primaryPeople: player?.name ? [player.name] : [],
        secondaryPeople:
          event.type === "goal" ? (assistantsByGoal.get(event.id) ?? []) : [],
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
        if (!existing.primaryPeople.includes(person))
          existing.primaryPeople.push(person)
      }
      for (const person of event.secondaryPeople) {
        if (!existing.secondaryPeople.includes(person))
          existing.secondaryPeople.push(person)
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
  const firstHalfOffset = replayFirstHalfOffset(match)
  return event.minute + (event.minute > 45 ? firstHalfOffset : 0)
}

function replayFirstHalfOffset(match: MatchSnapshot) {
  return match.period >= 2
    ? Math.max(
        0,
        match.clock.elapsedTick / 240 -
          (match.clock.minute + match.clock.second / 60)
      )
    : 0
}

function buildSubstitutionEvents(
  match: MatchSnapshot,
  t: (key: string) => string
): TimelineEvent[] {
  const result: TimelineEvent[] = []

  for (const team of ["home", "away"] as const) {
    const entering = match.players
      .filter(
        (player) =>
          player.team === team && player.status?.subbedOnMinute != null
      )
      .map((player) => ({ player, minute: player.status!.subbedOnMinute! }))
      .sort((left, right) => left.minute - right.minute)
    const leaving = match.players
      .filter(
        (player) =>
          player.team === team && player.status?.subbedOffMinute != null
      )
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
    case "goal":
      return t("squad.goal")
    case "own_goal":
      return t("squad.ownGoal")
    case "yellow_card":
      return t("squad.yellowCard")
    case "red_card":
      return t("squad.redCard")
    default:
      return type
  }
}

function eventTimelinePercent(
  event: TimelineEvent,
  match: MatchSnapshot,
  frames: readonly RealtimeFrame[],
  replaying: boolean
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

function layoutEvents(
  events: readonly TimelineEvent[],
  getPercent: (event: TimelineEvent) => number
) {
  const positioned = events
    .map((event) => ({ event, percent: getPercent(event) }))
    .sort((left, right) => left.percent - right.percent)
  const result: Array<{
    event: TimelineEvent
    percent: number
    offset: number
  }> = []

  // A percentage alone cannot express a fixed pixel gap on a responsive rail.
  // Spread close events around their shared anchor so the 20px icons always
  // retain a visible gap (especially substitutions followed by goals).
  for (let index = 0; index < positioned.length;) {
    let end = index + 1
    while (
      end < positioned.length &&
      positioned[end].percent - positioned[end - 1].percent <= 2.5
    )
      end += 1
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
    ? Math.max(
        0,
        Math.min(100, ((tick - startTick) / (endTick - startTick)) * 100)
      )
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
  const targetTick =
    startTick +
    (Math.max(0, Math.min(100, percent)) / 100) * (endTick - startTick)
  let low = 0
  let high = frames.length - 1
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (frames[middle].tick < targetTick) low = middle + 1
    else high = middle
  }
  if (low === 0) return 0
  return targetTick - frames[low - 1].tick <= frames[low].tick - targetTick
    ? low - 1
    : low
}

function formatReplayClock(percent: number, frames: readonly RealtimeFrame[]) {
  const frame = frames[replayFrameIndex(percent, frames)]
  if (!frame) return "0"
  const tick = Number.isFinite(frame.displayTick)
    ? frame.displayTick
    : frame.tick
  const displaySeconds = Math.floor(Math.max(0, tick) / 4)
  const minute = Math.floor(displaySeconds / 60)
  const plannedSeconds = frame.period <= 1 ? 45 * 60 : 90 * 60
  return displaySeconds <= plannedSeconds
    ? `${minute}`
    : `+${Math.floor((displaySeconds - plannedSeconds) / 60)}`
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
  const currentSecondHalfTicks = Math.max(
    firstHalfTicks,
    match.clock.elapsedTick - firstHalfEnd
  )
  return Math.max(
    50,
    Math.min(100, 50 + (secondHalfTick / currentSecondHalfTicks) * 50)
  )
}

function formatTimelineClock(match: MatchSnapshot) {
  const displaySeconds = match.clock.minute * 60 + match.clock.second
  const plannedSeconds = (match.period >= 2 ? 90 : 45) * 60
  if (displaySeconds <= plannedSeconds) return `${match.clock.minute}`
  const extraSeconds = displaySeconds - plannedSeconds
  return `+${Math.floor(extraSeconds / 60)}`
}
