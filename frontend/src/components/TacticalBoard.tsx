import { useStoredChoice, useStoredPreference } from "@/hooks/useStoredPreference"
import { parseMetricSelection } from "@/lib/preferences"
import type { LiveMotionSource, LiveMotionStatus } from "@/api/liveMotionSource"
import type {
  ReplayMotionSource,
  ReplayMotionStatus,
} from "@/api/replay/replayMotionSource"
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import { Clock01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MultiStateButton } from "@/components/ui/multi-state-button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarGroup,
  MenubarItem,
  MenubarLabel,
  MenubarMenu,
  MenubarSeparator,
  MenubarTrigger,
} from "@/components/ui/menubar"
import { PixiTactical } from "@/components/tactical/PixiTactical"
import {
  TACTICAL_EVENT_OVERSCAN_PX,
  type TacticalHit,
} from "@/components/tactical/PixiTacticalRenderer"
import { PitchGoals } from "@/components/pitch/PitchGoals"
import { PitchMarkings } from "@/components/pitch/PitchMarkings"
import {
  emitExploreTourInteraction,
  exploreTourTacticalMetricsEventName,
} from "@/features/explore-tour/exploreTourEvents"
import { resolvePitchDimensions } from "@/components/pitch/pitchGeometry"
import { samePlayerLabels } from "@/lib/matchRenderEquality"
import {
  buildShotChains,
  buildTacticalScene,
  groups,
  initialSelectedMetrics,
  metricById,
  metrics,
  type DataMetric,
  type MarkerDecoration,
  type MarkerVariant,
  type Shape,
  type ShotChain,
  type TacticalRenderPoint,
} from "@/components/tactical/tacticalScene"
import type {
  MatchPlayer,
  MatchSnapshot,
  TacticalEventFilterMode,
} from "@/types/match"
import { useTheme } from "@/components/theme-provider"
import { cssVizTokens } from "@/theme/vizTokens"
import type { RealtimeFrame } from "@/api/realtimeMatch"
import {
  buildDribblePlayback,
  DRIBBLE_PLAYBACK_SEARCH_RADIUS_TICKS,
} from "@/components/tactical/playback/builders/dribblePlayback"
import {
  buildShotChainPlayback,
  isShotChainPlaybackTrigger,
  SHOT_CHAIN_PLAYBACK_PADDING_TICKS,
  shotChainPlaybackTickRange,
} from "@/components/tactical/playback/builders/shotChainPlayback"
import { useTacticalPlayback } from "@/components/tactical/playback/hooks/useTacticalPlayback"
import type { PlaybackText } from "@/components/tactical/playback/core/types"

type TacticalBoardProps = {
  liveMotionSource?: LiveMotionSource
  replayMotionSource?: ReplayMotionSource
  isLiveSource?: boolean
  isPanelActive?: boolean
  match: MatchSnapshot
  loadTickFrames: (
    fromTick: number,
    toTick: number,
    signal: AbortSignal
  ) => Promise<readonly RealtimeFrame[]>
  isFocusMode: boolean
  eventFilterMode: TacticalEventFilterMode
  selectedPlayerIds: ReadonlySet<number>
  onEventFilterModeChange: (mode: TacticalEventFilterMode) => void
}

type HoveredTacticalPoint = {
  point: TacticalRenderPoint
  clientX: number
  clientY: number
}

const emptyShotChains: readonly ShotChain[] = []

export const TacticalBoard = memo(function TacticalBoard({
  liveMotionSource,
  replayMotionSource,
  isLiveSource = false,
  isPanelActive = true,
  match,
  loadTickFrames,
  isFocusMode,
  eventFilterMode,
  selectedPlayerIds,
  onEventFilterModeChange,
}: TacticalBoardProps) {
  const { t } = useTranslation()
  const pitchDimensions = resolvePitchDimensions(match.pitchDimensions)
  const pitchStyle = {
    "--pitch-aspect-ratio": pitchDimensions.length / pitchDimensions.width,
    "--pitch-frame-gap": `${TACTICAL_EVENT_OVERSCAN_PX}px`,
  } as CSSProperties
  const { settings, resolvedScheme } = useTheme()
  const [mode, setMode] = useStoredChoice<"events" | "liveMotion">(
    "tactical.mode",
    "events",
    ["events", "liveMotion"],
  )
  const [liveStatus, setLiveStatus] = useState<
    LiveMotionStatus | ReplayMotionStatus
  >("buffering")
  const motionAvailable = isLiveSource || replayMotionSource != null
  const liveMode = mode === "liveMotion" && motionAvailable
  const [pitchControlEnabled, setPitchControlEnabled] = useState(false)
  const [showNumbers, setShowNumbers] = useState(true)
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null)
  const [selectedMetrics, setSelectedMetrics] = useStoredPreference(
    "tactical.metrics",
    initialSelectedMetrics,
    (value) => parseMetricSelection(value, initialSelectedMetrics),
  )
  const [hovered, setHovered] = useState<HoveredTacticalPoint | null>(null)
  const {
    playback: tacticalPlayback,
    startPlayback,
    clearPlayback,
  } = useTacticalPlayback(loadTickFrames)

  useEffect(() => {
    const selectTourMetricGroup = (event: Event) => {
      const group = (event as CustomEvent<{ group: "shots" | "distribution" }>)
        .detail.group
      setSelectedMetrics(
        Object.fromEntries(
          metrics.map((metric) => [metric.id, metric.group === group])
        )
      )
      setSelectedShotId(null)
      clearPlayback()
    }
    window.addEventListener(
      exploreTourTacticalMetricsEventName,
      selectTourMetricGroup
    )
    return () =>
      window.removeEventListener(
        exploreTourTacticalMetricsEventName,
        selectTourMetricGroup
      )
  }, [clearPlayback, setSelectedMetrics])

  useEffect(() => {
    if (!isPanelActive || liveMode) clearPlayback()
  }, [isPanelActive, liveMode, clearPlayback])

  const groupLabel = (group: (typeof groups)[number]) =>
    t(`dataMap.groups.${group.id}`, { defaultValue: group.label })
  const metricLabel = (metric: DataMetric) =>
    t(`dataMap.events.${metric.id}`, { defaultValue: metric.label })
  const resolvePlaybackText = useCallback(
    (text: PlaybackText) =>
      t(text.key, { defaultValue: text.defaultValue, ...text.values }),
    [t]
  )

  const selectedMetricList = useMemo(
    () => metrics.filter((metric) => selectedMetrics[metric.id]),
    [selectedMetrics]
  )
  const selectedMetricGroups = useMemo(
    () =>
      groups
        .map((group) => ({
          group,
          metrics: selectedMetricList.filter(
            (metric) => metric.group === group.id
          ),
        }))
        .filter(({ metrics: groupMetrics }) => groupMetrics.length > 0),
    [selectedMetricList]
  )
  const filteredTacticalEvents = useMemo(() => {
    if (liveMode || !isPanelActive) return []
    if (eventFilterMode === "all") return match.tacticalEvents
    if (eventFilterMode === "individual") {
      return match.tacticalEvents.filter((event) =>
        selectedPlayerIds.has(event.playerId)
      )
    }
    return match.tacticalEvents.filter(
      (event) => event.team === eventFilterMode
    )
  }, [
    eventFilterMode,
    match.tacticalEvents,
    selectedPlayerIds,
    liveMode,
    isPanelActive,
  ])
  const scene = useMemo(
    () =>
      buildTacticalScene(
        liveMode || !isPanelActive ? [] : filteredTacticalEvents,
        selectedMetrics
      ),
    [filteredTacticalEvents, selectedMetrics, liveMode, isPanelActive]
  )
  const playerById = useMemo(
    () => new Map(match.players.map((player) => [player.id, player])),
    [match.players]
  )
  const activeSelectedShotId = useMemo(
    () =>
      selectedShotId != null &&
      scene.points.some((point) => point.id === selectedShotId)
        ? selectedShotId
        : null,
    [scene, selectedShotId]
  )
  const visibleShotChains = useMemo(
    () =>
      activeSelectedShotId == null
        ? emptyShotChains
        : buildShotChains(filteredTacticalEvents, selectedMetrics).filter(
            (chain) => chain.shotEventId === activeSelectedShotId
          ),
    [activeSelectedShotId, filteredTacticalEvents, selectedMetrics]
  )
  const selectDribble = useCallback(
    (point: { id: string; tick: number }) => {
      const event = filteredTacticalEvents.find(
        (candidate) =>
          candidate.id === point.id &&
          candidate.metricId === "dribblesCompleted"
      )
      if (!event) return
      startPlayback({
        id: event.id,
        fromTick: Math.max(
          0,
          event.tick - DRIBBLE_PLAYBACK_SEARCH_RADIUS_TICKS
        ),
        toTick: event.tick + DRIBBLE_PLAYBACK_SEARCH_RADIUS_TICKS,
        build: (frames) => buildDribblePlayback(event, frames, playerById),
      })
    },
    [filteredTacticalEvents, playerById, startPlayback]
  )
  const selectShotChain = useCallback(
    (chain: ShotChain) => {
      const range = shotChainPlaybackTickRange(chain)
      startPlayback({
        id: chain.id,
        fromTick: Math.max(
          0,
          range.startTick - SHOT_CHAIN_PLAYBACK_PADDING_TICKS
        ),
        toTick: range.endTick + SHOT_CHAIN_PLAYBACK_PADDING_TICKS,
        build: (frames) => buildShotChainPlayback(chain, frames, playerById),
      })
    },
    [playerById, startPlayback]
  )
  const appearance = useMemo(
    () => ({
      homeColor: match.home.color ?? "var(--team-home-fallback)",
      awayColor: match.away.color ?? "var(--team-away-fallback)",
      homeGoalkeeperColor: match.home.colorSource?.shirtBackgroundColorGK,
      awayGoalkeeperColor: match.away.colorSource?.shirtBackgroundColorGK,
      showNumbers,
      tokens: cssVizTokens(
        settings.presetId,
        resolvedScheme,
        settings.colorVision
      ),
    }),
    [
      match.away.color,
      match.away.colorSource?.shirtBackgroundColorGK,
      match.home.color,
      match.home.colorSource?.shirtBackgroundColorGK,
      resolvedScheme,
      settings.colorVision,
      settings.presetId,
      showNumbers,
    ]
  )

  const toggleMetric = (metric: DataMetric) => {
    setSelectedMetrics((current) => ({
      ...current,
      [metric.id]: !current[metric.id],
    }))
  }
  const setGroupSelected = (groupMetrics: DataMetric[], selected: boolean) => {
    setSelectedMetrics((current) => ({
      ...current,
      ...Object.fromEntries(
        groupMetrics.map((metric) => [metric.id, selected])
      ),
    }))
  }
  const invertGroup = (groupMetrics: DataMetric[]) => {
    setSelectedMetrics((current) => ({
      ...current,
      ...Object.fromEntries(
        groupMetrics.map((metric) => [metric.id, !current[metric.id]])
      ),
    }))
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <CardHeader className="flex shrink-0 flex-row items-center gap-3 border-b px-4 py-2">
        <CardTitle className="shrink-0 text-sm font-semibold @max-[420px]/card-header:hidden">
          {t("panels.dataMap")}
        </CardTitle>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-auto rounded px-2 py-1 text-[10px] active:translate-y-px"
          disabled={!motionAvailable}
          aria-pressed={liveMode}
          onClick={() => {
            clearPlayback()
            setSelectedShotId(null)
            setHovered(null)
            setMode(liveMode ? "events" : "liveMotion")
          }}
        >
          {t(
            liveMode
              ? "dataMap.liveMotion.backToEvents"
              : "dataMap.liveMotion.enable"
          )}
        </Button>
        {liveMode && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-pressed={pitchControlEnabled}
            className={`h-auto rounded px-2 py-1 text-[10px] active:translate-y-px ${pitchControlEnabled ? "border-primary bg-primary/15 text-primary" : ""}`}
            onClick={() => setPitchControlEnabled((current) => !current)}
          >
            {t("dataMap.pitchControl.label")}
          </Button>
        )}
        {liveMode && (
          <div className="flex shrink-0 items-center gap-2">
            <span role="status" className="text-[10px] text-muted-foreground">
              {t(`dataMap.liveMotion.status.${liveStatus}`)}
            </span>
            <Badge variant="outline" className="px-1.5 py-0 text-[9px]">
              {t("timeline.experimentalBadge")}
            </Badge>
          </div>
        )}
        {isFocusMode && !liveMode && (
          <MultiStateButton
            data-tour="tactical-event-filter"
            data-tour-state={eventFilterMode}
            value={eventFilterMode}
            onValueChange={(value) => {
              onEventFilterModeChange(value)
              emitExploreTourInteraction({
                id: "tactical-filter-change",
                value,
              })
            }}
            variant="outline"
            size="sm"
            className="min-w-14 px-2 text-[10px]"
            aria-label={t("dataMap.eventFilter")}
            contextMenuClassName="min-w-28"
            states={(["all", "home", "away", "individual"] as const).map(
              (value) => ({
                value,
                label: t(`dataMap.filters.${value}`),
              })
            )}
          />
        )}

        {!liveMode && (
          <Menubar className="ml-auto h-6 min-w-0 flex-1">
            {groups.map((group) => {
              const groupMetrics = metrics.filter(
                (metric) => metric.group === group.id
              )
              const enabledCount = groupMetrics.filter(
                (metric) => selectedMetrics[metric.id]
              ).length
              return (
                <MenubarMenu key={group.id}>
                  <MenubarTrigger className="h-5 min-w-0 flex-1 justify-center gap-1 px-1.5 text-[10px]">
                    <MarkerGlyph
                      shape={group.shape}
                      variant="solid"
                      color="var(--primary)"
                      size={15}
                    />
                    <span className="truncate">{groupLabel(group)}</span>
                    <span className="text-[9px] text-muted-foreground tabular-nums">
                      {enabledCount}/{groupMetrics.length}
                    </span>
                  </MenubarTrigger>
                  <MenubarContent className="z-[100] min-w-52">
                    <MenubarGroup>
                      <MenubarLabel>{groupLabel(group)}</MenubarLabel>
                      <MenubarSeparator />
                      <MenubarItem
                        onClick={() =>
                          setGroupSelected(
                            groupMetrics,
                            enabledCount !== groupMetrics.length
                          )
                        }
                      >
                        {enabledCount === groupMetrics.length
                          ? t("dataMap.clearAll")
                          : t("dataMap.selectAll")}
                      </MenubarItem>
                      <MenubarItem onClick={() => invertGroup(groupMetrics)}>
                        {t("dataMap.invertGroup")}
                      </MenubarItem>
                      <MenubarSeparator />
                      {groupMetrics.map((metric) => (
                        <MenubarCheckboxItem
                          key={metric.id}
                          checked={selectedMetrics[metric.id]}
                          onCheckedChange={() => toggleMetric(metric)}
                        >
                          <MarkerGlyph
                            shape={metric.shape}
                            variant={metric.variant}
                            decoration={metric.decoration}
                            color="var(--primary)"
                            size={16}
                          />
                          <span>{metricLabel(metric)}</span>
                        </MenubarCheckboxItem>
                      ))}
                    </MenubarGroup>
                  </MenubarContent>
                </MenubarMenu>
              )
            })}
          </Menubar>
        )}

        {!liveMode && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 px-1.5 text-[10px]"
                />
              }
            >
              {t("dataMap.displaySettings")}
              <span className="ml-1 text-[9px] text-primary tabular-nums">
                {Number(showNumbers)}
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="z-[100] min-w-36">
              <DropdownMenuCheckboxItem
                checked={showNumbers}
                onCheckedChange={(checked) => setShowNumbers(checked === true)}
              >
                {t("dataMap.showNumbers")}
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col p-0">
        <div className="flex min-h-0 min-w-0 flex-1 items-stretch gap-2 overflow-hidden p-3">
          {!liveMode && (
            <aside className="w-28 shrink-0 overflow-y-auto py-1">
              {selectedMetricGroups.length > 0 ? (
                <ul className="space-y-2.5">
                  {selectedMetricGroups.map(
                    ({ group, metrics: groupMetrics }) => (
                      <li key={`legend-group-${group.id}`}>
                        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-foreground/90">
                          <MarkerGlyph
                            shape={group.shape}
                            variant="solid"
                            color="var(--primary)"
                            size={15}
                          />
                          <span className="min-w-0 truncate leading-4">
                            {groupLabel(group)}
                          </span>
                        </div>
                        <ul className="mt-1 ml-[7px] space-y-1 border-l border-border/70 pl-2">
                          {groupMetrics.map((metric) => (
                            <li
                              key={`legend-${metric.id}`}
                              className="flex items-center gap-1.5 text-[9px] text-muted-foreground"
                            >
                              <MarkerGlyph
                                shape={metric.shape}
                                variant={metric.variant}
                                decoration={metric.decoration}
                                color="var(--primary)"
                                size={13}
                              />
                              <span className="min-w-0 leading-tight">
                                {metricLabel(metric)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </li>
                    )
                  )}
                </ul>
              ) : (
                <span className="text-[9px] text-muted-foreground">
                  {t("dataMap.noSelection")}
                </span>
              )}
            </aside>
          )}

          <div
            data-tour="tactical-pitch"
            className="tactical-pitch-viewport flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden"
          >
            <div
              className="tactical-pitch pitch-frame relative shrink-0 text-[var(--pitch-line)]"
              style={pitchStyle}
            >
              <div className="relative size-full bg-[var(--tactical-pitch-surface)]">
                <div className="pointer-events-none absolute inset-0 bg-primary/[0.025]" />
                <PitchMarkings dimensions={pitchDimensions} />
                <PitchGoals dimensions={pitchDimensions} />

                <PixiTactical
                  liveMode={liveMode}
                  pitchControlEnabled={pitchControlEnabled}
                  liveMotionSource={liveMotionSource}
                  replayMotionSource={replayMotionSource}
                  isPanelActive={isPanelActive}
                  onLiveStatus={setLiveStatus}
                  scene={scene}
                  players={playerById}
                  appearance={appearance}
                  selectedShotId={activeSelectedShotId}
                  shotChains={visibleShotChains}
                  playback={tacticalPlayback}
                  playbackTextResolver={resolvePlaybackText}
                  onHover={(hit, clientX, clientY) => {
                    setHovered((current) => {
                      if (!hit) return null
                      if (
                        current?.point.id === hit.point.id &&
                        current.clientX === clientX &&
                        current.clientY === clientY
                      )
                        return current
                      return { point: hit.point, clientX, clientY }
                    })
                  }}
                  onPointClick={(hit: TacticalHit) => {
                    if (hit.historical) {
                      const chain = visibleShotChains.find((candidate) =>
                        isShotChainPlaybackTrigger(candidate, hit.point.id)
                      )
                      if (chain) {
                        selectShotChain(chain)
                        emitExploreTourInteraction({
                          id: "tactical-shot-chain-playback",
                          chainId: chain.id,
                        })
                      }
                      return
                    }
                    if (hit.point.metricId === "dribblesCompleted") {
                      setSelectedShotId(null)
                      selectDribble(hit.point)
                      return
                    }
                    if (hit.point.group === "shots") {
                      clearPlayback()
                      setSelectedShotId(hit.point.id)
                      emitExploreTourInteraction({
                        id: "tactical-shot-select",
                        eventId: hit.point.id,
                      })
                    }
                  }}
                  onEmptyClick={() => {
                    setSelectedShotId(null)
                    clearPlayback()
                    emitExploreTourInteraction({ id: "tactical-empty-click" })
                  }}
                />

                {!liveMode &&
                  (selectedMetricList.length === 0 ||
                    scene.points.length === 0) && (
                    <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
                      <div className="rounded-md border bg-background/90 px-3 py-2 text-xs text-muted-foreground shadow-sm backdrop-blur-sm">
                        {selectedMetricList.length === 0
                          ? t("dataMap.noMetrics")
                          : eventFilterMode === "individual" &&
                              selectedPlayerIds.size === 0
                            ? t("dataMap.selectPlayers")
                            : t("dataMap.noData")}
                      </div>
                    </div>
                  )}
              </div>
            </div>
          </div>
        </div>
      </CardContent>

      {hovered && (
        <TacticalPointTooltip
          hovered={hovered}
          players={playerById}
          homeColor={appearance.homeColor}
          awayColor={appearance.awayColor}
          unknownPlayer={t("dataMap.unknownPlayer")}
          metricLabel={metricLabel}
        />
      )}
    </section>
  )
}, sameTacticalBoardProps)

function sameTacticalBoardProps(
  previous: TacticalBoardProps,
  next: TacticalBoardProps
) {
  const left = previous.match
  const right = next.match
  return (
    left.tacticalEvents === right.tacticalEvents &&
    previous.loadTickFrames === next.loadTickFrames &&
    previous.isFocusMode === next.isFocusMode &&
    previous.eventFilterMode === next.eventFilterMode &&
    previous.selectedPlayerIds === next.selectedPlayerIds &&
    previous.onEventFilterModeChange === next.onEventFilterModeChange &&
    left.pitchDimensions?.length === right.pitchDimensions?.length &&
    left.pitchDimensions?.width === right.pitchDimensions?.width &&
    left.home.color === right.home.color &&
    left.away.color === right.away.color &&
    samePlayerLabels(left.players, right.players)
  )
}

function TacticalPointTooltip({
  hovered,
  players,
  homeColor,
  awayColor,
  unknownPlayer,
  metricLabel,
}: {
  hovered: HoveredTacticalPoint
  players: ReadonlyMap<number, MatchPlayer>
  homeColor: string
  awayColor: string
  unknownPlayer: string
  metricLabel: (metric: DataMetric) => string
}) {
  const { t } = useTranslation()
  const { point, clientX, clientY } = hovered
  const player = players.get(point.playerId)
  const receiver =
    point.receiverPlayerId == null
      ? undefined
      : players.get(point.receiverPlayerId)
  const metric = metricById.get(point.metricId)
  if (!metric) return null
  const color = point.team === "home" ? homeColor : awayColor
  const counterpartPlayer = point.counterpart
    ? players.get(point.counterpart.playerId)
    : undefined
  const counterpartMetric = point.counterpart
    ? metricById.get(point.counterpart.metricId)
    : undefined
  const counterpartColor =
    point.counterpart?.team === "home" ? homeColor : awayColor
  const tooltipX =
    window.innerWidth < 208
      ? window.innerWidth / 2
      : Math.min(Math.max(clientX, 104), window.innerWidth - 104)
  const placeBelow = clientY < 128
  const playerName = player?.name ?? unknownPlayer
  const receiverName = receiver?.name ?? unknownPlayer
  const counterpartName = counterpartPlayer
    ? counterpartPlayer.name
    : unknownPlayer
  const hasReceiver = point.receiverPlayerId != null
  const hasAssociations = Boolean(
    hasReceiver || (point.counterpart && counterpartMetric)
  )

  return createPortal(
    <div
      role="tooltip"
      className={`pointer-events-none fixed z-[100] w-fit max-w-48 min-w-40 -translate-x-1/2 overflow-hidden rounded-lg border bg-popover/95 text-popover-foreground shadow-xl backdrop-blur-sm ${placeBelow ? "translate-y-2.5" : "-translate-y-[calc(100%+10px)]"}`}
      style={{ left: tooltipX, top: clientY, borderColor: color }}
    >
      <div className="flex items-center gap-2 px-2.5 py-2">
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-[10px] font-extrabold tabular-nums shadow-sm"
          style={{
            backgroundColor: color,
            color: "var(--event-marker-foreground)",
          }}
        >
          {player?.shirtNumber ?? "-"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] leading-4 font-semibold">
            {metricLabel(metric)}
          </div>
          <div className="truncate text-[10px] leading-4 text-muted-foreground">
            {playerName}
          </div>
        </div>
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground tabular-nums">
          <HugeiconsIcon
            icon={Clock01Icon}
            strokeWidth={2}
            className="size-3"
          />
          {formatMatchTick(point.displayTick)}
        </span>
      </div>

      {hasAssociations && (
        <div className="border-t border-border/60 bg-muted/30 px-2 py-1">
          {hasReceiver && (
            <TacticalAssociationRow
              player={receiver}
              playerName={receiverName}
              color={color}
              eventName={metricLabel(metric)}
            />
          )}
          {point.counterpart && counterpartMetric && (
            <TacticalAssociationRow
              player={counterpartPlayer}
              playerName={counterpartName}
              color={counterpartColor}
              eventName={metricLabel(counterpartMetric)}
            />
          )}
        </div>
      )}

      {point.annotations && point.annotations.length > 0 && (
        <div className="flex flex-wrap gap-1 border-t border-border/60 px-2.5 py-1.5">
          {point.annotations.map((annotation) => (
            <span
              key={annotation}
              className="rounded-sm bg-muted px-1.5 py-0.5 text-[9px] leading-3.5 font-medium text-muted-foreground"
            >
              {t(`dataMap.annotations.${annotation}`)}
            </span>
          ))}
        </div>
      )}
    </div>,
    document.body
  )
}

function TacticalAssociationRow({
  player,
  playerName,
  color,
  eventName,
}: {
  player?: MatchPlayer
  playerName: string
  color: string
  eventName: string
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 py-0.5 text-[9px] leading-4">
      <span
        className="flex size-[18px] shrink-0 items-center justify-center rounded text-[8px] font-extrabold tabular-nums"
        style={{
          backgroundColor: color,
          color: "var(--event-marker-foreground)",
        }}
      >
        {player?.shirtNumber ?? "-"}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium">{playerName}</span>
      <span className="max-w-20 shrink-0 truncate text-muted-foreground">
        {eventName}
      </span>
    </div>
  )
}

function formatMatchTick(tick: number) {
  const seconds = Math.floor(Math.max(0, tick) / 4)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

function MarkerGlyph({
  shape,
  variant,
  decoration,
  color,
  size,
}: {
  shape: Shape
  variant: MarkerVariant
  decoration?: MarkerDecoration
  color: string
  size: number
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      aria-hidden="true"
      className="shrink-0 overflow-visible"
    >
      <ShapeElement shape={shape} {...markerStyle(variant, color)} />
      {decoration && (
        <MarkerDecorationElement decoration={decoration} color={color} />
      )}
    </svg>
  )
}

function markerStyle(variant: MarkerVariant, color: string) {
  switch (variant) {
    case "solid":
      return { fill: color, stroke: color, strokeWidth: 1.2 }
    case "outline":
      return { fill: "transparent", stroke: color, strokeWidth: 2.2 }
    case "important":
      return { fill: color, stroke: "var(--important-event)", strokeWidth: 2 }
    case "important-solid":
      return {
        fill: "var(--important-event)",
        stroke: "var(--important-event)",
        strokeWidth: 2,
      }
    case "negative-solid":
      return {
        fill: "var(--status-negative)",
        stroke: "var(--status-negative)",
        strokeWidth: 2,
      }
    default:
      return { fill: color, stroke: "var(--background)", strokeWidth: 1 }
  }
}

function MarkerDecorationElement({
  decoration,
  color,
}: {
  decoration: MarkerDecoration
  color: string
}) {
  const coordinates = {
    top: { x1: 6, y1: 0, x2: 14, y2: 0 },
    bottom: { x1: 6, y1: 20, x2: 14, y2: 20 },
    left: { x1: 0, y1: 6, x2: 0, y2: 14 },
    right: { x1: 20, y1: 6, x2: 20, y2: 14 },
  }[decoration]
  return (
    <line
      {...coordinates}
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      vectorEffect="non-scaling-stroke"
    />
  )
}

function ShapeElement({
  shape,
  fill,
  stroke,
  strokeWidth,
  strokeDasharray,
}: {
  shape: Shape
  fill: string
  stroke: string
  strokeWidth: number
  strokeDasharray?: string
}) {
  const common = {
    fill,
    stroke,
    strokeWidth,
    strokeDasharray,
    strokeLinejoin: "round" as const,
    vectorEffect: "non-scaling-stroke" as const,
  }
  switch (shape) {
    case "square":
      return <rect x="3" y="3" width="14" height="14" rx="2" {...common} />
    case "circle":
      return <circle cx="10" cy="10" r="7" {...common} />
    case "triangle":
      return <polygon points="10,2.5 18,17 2,17" {...common} />
    case "triangle-down":
      return <polygon points="2,3 18,3 10,17.5" {...common} />
    case "pentagon":
      return <polygon points="10,2 18,7.8 15,17 5,17 2,7.8" {...common} />
    case "diamond":
      return <polygon points="10,2 18,10 10,18 2,10" {...common} />
  }
}
