import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { useTranslation } from "react-i18next"
import { ArrowDataTransferHorizontalIcon, Pin02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { AnimatePresence, motion } from "framer-motion"

import { Avatar, AvatarBadge, AvatarFallback } from "@/components/ui/avatar"
import { CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { NativeTabs } from "@/components/uitripled/native-tabs-shadcnui"
import {
  Timeline,
  TimelineContent,
  TimelineHeader,
  TimelineIndicator,
  TimelineItem,
  TimelineSeparator,
  TimelineTime,
} from "@/components/reui/timeline"
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

type FormationChangeType = "initial" | "personnel" | "formation" | "role"

type FormationHistoryEntry = {
  id: string
  tick: number
  time: string
  signature: string
  entries: FormationEntry[]
  changes: FormationChangeType[]
}

type FormationHistory = Record<FormationView, FormationHistoryEntry[]>

type FormationPlayback = {
  view: FormationView
  sourceIndex: number
  targetIndex: number
  phase: "previous" | "current"
}

type PinnedFormationEntries = Partial<Record<FormationView, string>>

const formationViews: FormationView[] = ["home-ip", "home-oop", "away-ip", "away-oop"]

const emptyFormationHistory = (): FormationHistory => ({
  "home-ip": [],
  "home-oop": [],
  "away-ip": [],
  "away-oop": [],
})

const lineDepth: Record<FormationLine, number> = {
  gk: 7,
  defence: 24,
  holding: 41,
  midfield: 58,
  attack: 75,
  striker: 92,
}

const playerMotionVariants = {
  initial: { left: "50%", top: "-8%", opacity: 0 },
  exit: (instant: boolean) => ({
    left: "50%",
    top: "108%",
    opacity: 0,
    transition: { duration: instant ? 0 : 0.55 },
  }),
}

export function FormationPitch({ match }: FormationPitchProps) {
  const { t } = useTranslation()
  const [view, setView] = useState<FormationView>("home-ip")
  const { side, inPossession } = formationSelection(view)
  const liveEntries = useMemo(
    () => formationEntries(match.players),
    [match.players],
  )
  const [history, setHistory] = useState<FormationHistory>(emptyFormationHistory)
  const [playback, setPlayback] = useState<FormationPlayback | null>(null)
  const [pinnedEntries, setPinnedEntries] = useState<PinnedFormationEntries>({})
  const [timelineProgressIndex, setTimelineProgressIndex] = useState<number | null>(null)
  const timelineRef = useRef<HTMLDivElement | null>(null)
  const activeTimelineItemRef = useRef<HTMLDivElement | null>(null)
  const matchKeyRef = useRef("")
  const formationSeedKeyRef = useRef("")
  const teamColor = match[side].color ?? (side === "home" ? "#6cabdd" : "#ef0107")
  const matchKey = match.matchId
    ?? `${match.home.clubUid ?? match.home.uid ?? match.home.name}:${match.away.clubUid ?? match.away.uid ?? match.away.name}`
  const formationSnapshots = useMemo(
    () => match.formationSnapshots ?? [],
    [match.formationSnapshots],
  )
  const lastFormationSnapshot = formationSnapshots.at(-1)
  const formationSeedKey = `${matchKey}:${formationSnapshots.length}:${lastFormationSnapshot?.tick ?? -1}`

  useEffect(() => {
    const reset = matchKeyRef.current !== matchKey
    const rehydrate = reset || formationSeedKeyRef.current !== formationSeedKey
    if (reset) {
      setPinnedEntries({})
      setPlayback(null)
    }
    matchKeyRef.current = matchKey
    formationSeedKeyRef.current = formationSeedKey
    setHistory((current) => {
      let next = rehydrate ? emptyFormationHistory() : current
      if (rehydrate) {
        for (const snapshot of formationSnapshots) {
          next = updateFormationHistory(
            next,
            formationEntries(snapshot.players),
            snapshot.tick,
            formatFormationTime(snapshot.minute),
          )
        }
      }
      return updateFormationHistory(
        next,
        liveEntries,
        match.clock.elapsedTick,
        formatFormationTime(match.clock.minute),
      )
    })
  }, [formationSeedKey, formationSnapshots, liveEntries, match.clock.elapsedTick, match.clock.minute, matchKey])

  useEffect(() => {
    if (!playback) return

    const timeout = window.setTimeout(() => {
      if (playback.phase === "current") {
        setTimelineProgressIndex(playback.sourceIndex)
      }
      setPlayback((current) => {
        if (!current) return null
        return {
          ...current,
          phase: current.phase === "previous" ? "current" : "previous",
        }
      })
    }, playback.phase === "previous" ? 800 : 2200)

    return () => window.clearTimeout(timeout)
  }, [playback])

  useEffect(() => {
    if (!playback) return

    const stopPlaybackOutsideTimeline = (event: PointerEvent) => {
      if (timelineRef.current?.contains(event.target as Node)) return
      setPlayback(null)
    }

    document.addEventListener("pointerdown", stopPlaybackOutsideTimeline, true)
    return () => document.removeEventListener("pointerdown", stopPlaybackOutsideTimeline, true)
  }, [playback])

  const viewHistory = history[view]
  const activePlayback = playback?.view === view ? playback : null
  const targetIndex = activePlayback
    ? Math.min(activePlayback.targetIndex, Math.max(0, viewHistory.length - 1))
    : Math.max(0, viewHistory.length - 1)
  const sourceIndex = activePlayback
    ? Math.min(activePlayback.sourceIndex, Math.max(0, targetIndex - 1))
    : targetIndex - 1
  const displayedIndex = activePlayback?.phase === "previous"
    ? Math.max(0, sourceIndex)
    : targetIndex
  const entries = activePlayback?.phase === "previous" && sourceIndex < 0
    ? []
    : viewHistory[displayedIndex]?.entries ?? liveEntries[view]
  const comparisonEntries = activePlayback
    ? activePlayback.phase === "current"
      ? sourceIndex >= 0 ? viewHistory[sourceIndex].entries : []
      : viewHistory[targetIndex]?.entries ?? []
    : displayedIndex > 0
      ? viewHistory[displayedIndex - 1].entries
      : []
  const comparisonPlayerIds = new Set(comparisonEntries.map((entry) => entry.player.id))
  const currentPlayerIds = new Set(entries.map((entry) => entry.player.id))
  const hasOutgoingPlayers = comparisonEntries.some((entry) => !currentPlayerIds.has(entry.player.id))
  const resetsToPrevious = activePlayback?.phase === "previous"
  const pinnedIndex = viewHistory.findIndex((entry) => entry.id === pinnedEntries[view])
  const playbackSourceEntries = sourceIndex >= 0 ? viewHistory[sourceIndex]?.entries ?? [] : []
  const playbackTargetEntries = viewHistory[targetIndex]?.entries ?? []
  const playbackSourcePlayerIds = new Set(playbackSourceEntries.map((entry) => entry.player.id))
  const playbackTargetPlayerIds = new Set(playbackTargetEntries.map((entry) => entry.player.id))
  const playbackHasOutgoingPlayers = playbackSourceEntries.some(
    (entry) => !playbackTargetPlayerIds.has(entry.player.id),
  )
  const playbackHasIncomingPlayers = playbackTargetEntries.some(
    (entry) => !playbackSourcePlayerIds.has(entry.player.id),
  )
  const playbackSourceByPlayer = new Map(
    playbackSourceEntries.map((entry) => [entry.player.id, entry]),
  )
  const playbackHasPositionChanges = playbackTargetEntries.some((entry) => {
    const previous = playbackSourceByPlayer.get(entry.player.id)
    return previous != null
      && (previous.assignment.positionMask !== entry.assignment.positionMask
        || previous.assignment.position !== entry.assignment.position)
  })
  const playbackHasRoleChanges = playbackTargetEntries.some((entry) => {
    const previous = playbackSourceByPlayer.get(entry.player.id)
    return previous != null
      && (previous.assignment.role !== entry.assignment.role
        || previous.assignment.roleAbbreviation !== entry.assignment.roleAbbreviation)
  })
  const playbackTransitionMilliseconds = playbackHasOutgoingPlayers && playbackHasIncomingPlayers
    ? 1300
    : Math.max(
        playbackHasIncomingPlayers ? 700 : 0,
        playbackHasOutgoingPlayers ? 550 : 0,
        playbackHasPositionChanges ? 700 : 0,
        playbackHasRoleChanges ? 180 : 0,
        180,
      )
  const playbackSegmentCount = Math.max(1, targetIndex - sourceIndex)
  const timelineSegmentMilliseconds = playbackTransitionMilliseconds / playbackSegmentCount
  const timelineIndicatorDuration = Math.min(100, timelineSegmentMilliseconds)
  const timelineActiveIndex = activePlayback
    ? activePlayback.phase === "previous"
      ? sourceIndex
      : timelineProgressIndex ?? sourceIndex
    : displayedIndex

  useEffect(() => {
    if (!activePlayback || activePlayback.phase !== "current") return

    const timers: number[] = []
    for (let index = sourceIndex + 1; index <= targetIndex; index += 1) {
      const delay = Math.max(0, index - sourceIndex - 1) * timelineSegmentMilliseconds
      timers.push(window.setTimeout(() => setTimelineProgressIndex(index), delay))
    }

    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [activePlayback, sourceIndex, targetIndex, timelineSegmentMilliseconds])

  useEffect(() => {
    activeTimelineItemRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    })
  }, [displayedIndex, view, viewHistory.length])

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

      <CardContent className="@container/formation flex min-h-0 flex-1 flex-row p-0">
        {viewHistory.length > 1 && (
          <div
            ref={timelineRef}
            className="scrollbar-hidden w-36 max-w-[30%] shrink-0 overflow-y-auto border-r bg-muted/15 py-3 pr-2.5 pl-4 @max-[380px]/formation:hidden"
          >
            <Timeline
              orientation="vertical"
              value={timelineActiveIndex + 1}
              className="min-h-full"
            >
              {viewHistory.map((entry, index) => {
                const description = formationChangeDescription(entry.changes, t)
                const animationSourceIndex = pinnedIndex >= 0 && pinnedIndex < index
                  ? pinnedIndex
                  : index - 1
                return (
                  <TimelineItem
                    key={entry.id}
                    ref={index === displayedIndex ? activeTimelineItemRef : undefined}
                    step={index + 1}
                    className="min-w-0 flex-none gap-0 group-data-[orientation=vertical]/timeline:not-last:pb-3"
                  >
                    <TimelineHeader>
                      <TimelineTime
                        onClick={() => {
                          setTimelineProgressIndex(animationSourceIndex)
                          setPlayback({
                            view,
                            sourceIndex: animationSourceIndex,
                            targetIndex: index,
                            phase: "previous",
                          })
                        }}
                        aria-label={`${entry.time} ${description}`}
                        className={index === displayedIndex ? "mb-0 text-primary" : "mb-0"}
                      >
                        {entry.time}
                      </TimelineTime>
                    </TimelineHeader>
                    <HoverCard>
                      <HoverCardTrigger
                        render={(
                          <TimelineIndicator
                            aria-label={t(index === pinnedIndex
                              ? "formationHistory.unpinStart"
                              : "formationHistory.pinStart")}
                            aria-pressed={index === pinnedIndex}
                            onClick={() => {
                              setPlayback(null)
                              setPinnedEntries((current) => ({
                                ...current,
                                [view]: current[view] === entry.id ? undefined : entry.id,
                              }))
                            }}
                            style={{
                              transitionDuration: `${timelineIndicatorDuration}ms`,
                              transitionDelay: activePlayback?.phase === "current"
                                && index >= sourceIndex
                                && index <= targetIndex
                                ? `${Math.max(0, timelineSegmentMilliseconds - timelineIndicatorDuration)}ms`
                                : "0ms",
                            }}
                            className="border-border group-data-completed/timeline-item:border-primary group-data-active/timeline-item:bg-primary"
                          />
                        )}
                      />
                      <HoverCardContent
                        side="top"
                        sideOffset={6}
                        className="w-auto whitespace-nowrap px-2.5 py-1.5 font-medium"
                      >
                        {t(index === pinnedIndex
                          ? "formationHistory.unpinStart"
                          : "formationHistory.pinStart")}
                      </HoverCardContent>
                    </HoverCard>
                    {index === pinnedIndex && (
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute top-0 -left-4 flex size-3 items-center justify-center text-foreground"
                      >
                        <HugeiconsIcon icon={Pin02Icon} className="size-3" strokeWidth={2} />
                      </span>
                    )}
                    <TimelineSeparator
                      style={{
                        "--timeline-segment-duration": `${resetsToPrevious ? 0 : timelineSegmentMilliseconds}ms`,
                      } as CSSProperties}
                    />
                    <TimelineContent className="truncate whitespace-nowrap text-[10px] leading-3" title={description}>
                      {description}
                    </TimelineContent>
                  </TimelineItem>
                )
              })}
            </Timeline>
          </div>
        )}

        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3">
          <div className="relative aspect-[148/100] h-full max-h-full max-w-full shrink-0 overflow-hidden rounded-md bg-muted">
            <PitchMarkings />
            <div className="pointer-events-none absolute inset-0">
              <AnimatePresence custom={resetsToPrevious}>
              {entries.map(({ player, assignment, x, y }) => {
                const roleNamespace = inPossession
                  ? "inPossessionRoleNames"
                  : "outOfPossessionRoleNames"
                const roleName = t(`${roleNamespace}.${assignment.roleAbbreviation}`, {
                  defaultValue: assignment.role,
                })
                const entersPitch = !comparisonPlayerIds.has(player.id)
                const shouldAnimateEntrance = !resetsToPrevious && entersPitch
                const entryDelay = !resetsToPrevious && entersPitch && hasOutgoingPlayers ? 0.6 : 0
                const movementDuration = resetsToPrevious ? 0 : 0.7
                return (
                  <motion.div
                    key={`formation-${view}-${player.id}`}
                    className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2"
                    custom={resetsToPrevious}
                    variants={playerMotionVariants}
                    initial={shouldAnimateEntrance ? "initial" : false}
                    animate={{ left: `${x}%`, top: `${y}%`, opacity: 1 }}
                    exit="exit"
                    transition={{
                      left: { duration: movementDuration, delay: entryDelay },
                      top: { duration: movementDuration, delay: entryDelay },
                      opacity: { duration: resetsToPrevious ? 0 : 0.25, delay: entryDelay },
                    }}
                  >
                    <HoverCard>
                      <HoverCardTrigger
                        render={<div className="flex max-w-36 flex-col items-center text-center" />}
                      >
                        <Avatar className="size-6 overflow-visible shadow-sm" style={{ backgroundColor: teamColor }}>
                          <AvatarFallback className="bg-transparent text-[10px] font-bold text-white">
                            {player.shirtNumber ?? "?"}
                          </AvatarFallback>
                          {player.status?.subbedOnMinute != null && (
                            <AvatarBadge aria-hidden="true" className="bg-background text-foreground ring-1 ring-background">
                              <HugeiconsIcon icon={ArrowDataTransferHorizontalIcon} strokeWidth={2} />
                            </AvatarBadge>
                          )}
                        </Avatar>
                        <div className="mt-0.5 flex max-w-36 items-center whitespace-nowrap rounded-sm bg-background/90 px-1 py-px text-[9px] font-semibold leading-3 text-foreground shadow-sm">
                          <AnimatePresence mode="wait" initial={false}>
                            <motion.span
                              key={assignment.roleAbbreviation}
                              className="shrink-0"
                              initial={{ opacity: 0, y: 2 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -2 }}
                              transition={{ duration: 0.18 }}
                            >
                              {assignment.roleAbbreviation}
                            </motion.span>
                          </AnimatePresence>
                          <span aria-hidden="true" className="mx-1 h-2.5 w-px shrink-0 bg-border" />
                          <span className="min-w-0 truncate">
                            {playerSurname(player.name)}
                          </span>
                        </div>
                      </HoverCardTrigger>
                      <HoverCardContent
                        side="top"
                        sideOffset={6}
                        className="w-auto max-w-72 whitespace-nowrap px-2.5 py-1.5 font-medium"
                      >
                        {roleName}
                      </HoverCardContent>
                    </HoverCard>
                  </motion.div>
                )
              })}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </CardContent>
    </section>
  )
}

function playerSurname(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return parts.at(-1) ?? name
}

function updateFormationHistory(
  current: FormationHistory,
  liveEntries: Record<FormationView, FormationEntry[]>,
  tick: number,
  time: string,
) {
  let changed = false
  const next = { ...current }

  for (const view of formationViews) {
    const updated = upsertFormationHistory(current[view], liveEntries[view], tick, time)
    if (updated !== current[view]) {
      next[view] = updated
      changed = true
    }
  }

  return changed ? next : current
}

function upsertFormationHistory(
  history: FormationHistoryEntry[],
  entries: FormationEntry[],
  tick: number,
  time: string,
) {
  if (entries.length === 0) return history

  const signature = formationSignature(entries)
  const atTick = history.find((entry) => entry.tick === tick)
  if (atTick?.signature === signature) return history

  const previous = history.findLast((entry) => entry.tick < tick)
  if (!atTick && previous?.signature === signature) return history

  const candidateTick = history.length === 0 ? 0 : tick
  const candidateTime = history.length === 0 ? formatFormationTime(0) : time
  const candidate: FormationHistoryEntry = {
    id: `${candidateTick}:${signature}`,
    tick: candidateTick,
    time: candidateTime,
    signature,
    entries: [...entries],
    changes: [],
  }
  const sorted = [...history.filter((entry) => entry.tick !== tick), candidate]
    .sort((left, right) => left.tick - right.tick)
  const deduplicated = sorted.filter((entry, index) => (
    index === 0 || entry.signature !== sorted[index - 1].signature
  ))

  return deduplicated.map<FormationHistoryEntry>((entry, index) => ({
    ...entry,
    changes: index === 0
      ? ["initial"]
      : formationChanges(deduplicated[index - 1].entries, entry.entries),
  }))
}

function formationSignature(entries: FormationEntry[]) {
  return entries
    .map(({ player, assignment }) => [
      player.id,
      assignment.positionMask,
      assignment.role,
      assignment.roleAbbreviation,
    ].join(":"))
    .sort()
    .join("|")
}

function formationChanges(previous: FormationEntry[], current: FormationEntry[]): FormationChangeType[] {
  const changes = new Set<FormationChangeType>()
  const previousPlayers = new Map(previous.map((entry) => [entry.player.id, entry]))
  const currentPlayers = new Map(current.map((entry) => [entry.player.id, entry]))

  if (
    previousPlayers.size !== currentPlayers.size
    || [...previousPlayers.keys()].some((playerId) => !currentPlayers.has(playerId))
  ) {
    changes.add("personnel")
  }

  for (const [playerId, currentEntry] of currentPlayers) {
    const previousEntry = previousPlayers.get(playerId)
    if (!previousEntry) continue

    if (
      previousEntry.assignment.positionMask !== currentEntry.assignment.positionMask
      || previousEntry.assignment.position !== currentEntry.assignment.position
    ) {
      changes.add("formation")
    }
    if (
      previousEntry.assignment.role !== currentEntry.assignment.role
      || previousEntry.assignment.roleAbbreviation !== currentEntry.assignment.roleAbbreviation
    ) {
      changes.add("role")
    }
  }

  return changes.size > 0 ? [...changes] : ["formation"]
}

function formationChangeDescription(
  changes: FormationChangeType[],
  t: (key: string) => string,
) {
  const priority: FormationChangeType[] = ["initial", "formation", "personnel", "role"]
  return priority
    .filter((change) => changes.includes(change))
    .map((change) => t(`formationHistory.${change}`))
    .join(" · ")
}

function formatFormationTime(minute: number) {
  return `${Math.max(0, minute)}′`
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

function formationEntries(players: MatchPlayer[]) {
  return Object.fromEntries(formationViews.map((view) => {
    const selection = formationSelection(view)
    return [view, layoutTeam(players, selection.side, selection.inPossession)]
  })) as Record<FormationView, FormationEntry[]>
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
  if (["DR", "WBR", "MR", "AMR"].includes(value)) return 10
  if (["DCR", "DMR", "MCR", "AMCR", "STR"].includes(value)) return 36
  if (["DCL", "DML", "MCL", "AMCL", "STL"].includes(value)) return 64
  if (["DL", "WBL", "ML", "AML"].includes(value)) return 90
  return 50
}
