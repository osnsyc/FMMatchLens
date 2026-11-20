import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { motion } from "framer-motion"
import { useTranslation } from "react-i18next"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Card } from "@/components/ui/card"
import { setPlayerProfileBackdrop } from "@/lib/playerProfileBackdrop"
import { ratingBadgeClass } from "@/lib/ratingPresentation"
import type { TeamSide } from "@/types/match"
import {
  PlayerHeatmap,
  PlayerRatingBreakdown,
  SectionTitle,
  MovementAnalysisCard,
  HeaderMetric,
} from "./player-match-details/PlayerMatchDetails"
import {
  usePlayerMatchDetails,
  initials,
  playerMetricTranslationKeys,
  type PlayerMatchDetailsProps,
} from "./player-match-details/usePlayerMatchDetails"

type PlayerMatchDetailsPopupProps = PlayerMatchDetailsProps & {
  side: TeamSide
  panelElement: HTMLElement
  anchorElement: HTMLElement
  pinned: boolean
  onPointerEnter?: () => void
  onPointerLeave?: () => void
  onClose: () => void
}

export function PlayerMatchDetailsPopup({
  player,
  side,
  teamColor,
  panelElement,
  anchorElement,
  pinned,
  matchMinute,
  matchTick,
  movementFrames,
  movementAnalysis,
  heatmaps,
  pitchDimensions,
  onPointerEnter,
  onPointerLeave,
  onClose,
}: PlayerMatchDetailsPopupProps) {
  const { t } = useTranslation()
  const popupRef = useRef<HTMLDivElement | null>(null)
  const [panelRect, setPanelRect] = useState(() =>
    panelElement.getBoundingClientRect()
  )
  const [anchorRect, setAnchorRect] = useState(() =>
    anchorElement.getBoundingClientRect()
  )
  const [popupHeight, setPopupHeight] = useState(0)

  useLayoutEffect(() => {
    setPlayerProfileBackdrop(true)
    return () => setPlayerProfileBackdrop(false)
  }, [])

  useLayoutEffect(() => {
    const updateRect = () => {
      setPanelRect(panelElement.getBoundingClientRect())
      setAnchorRect(anchorElement.getBoundingClientRect())
    }
    const observer = new ResizeObserver(updateRect)
    observer.observe(panelElement)
    observer.observe(anchorElement)
    window.addEventListener("resize", updateRect)
    window.addEventListener("scroll", updateRect, true)
    updateRect()
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", updateRect)
      window.removeEventListener("scroll", updateRect, true)
    }
  }, [anchorElement, panelElement])

  useLayoutEffect(() => {
    const popup = popupRef.current
    if (!popup) return
    const updateHeight = () => setPopupHeight(popup.offsetHeight)
    const observer = new ResizeObserver(updateHeight)
    observer.observe(popup)
    updateHeight()
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node) || popupRef.current?.contains(target))
        return
      if (
        target instanceof Element &&
        target.closest("[data-player-details-trigger]")
      )
        return
      onClose()
    }
    document.addEventListener("keydown", handleKeyDown)
    document.addEventListener("pointerdown", handlePointerDown)
    return () => {
      document.removeEventListener("keydown", handleKeyDown)
      document.removeEventListener("pointerdown", handlePointerDown)
    }
  }, [onClose])

  const viewportGap = 8
  const availableWidth =
    side === "home"
      ? window.innerWidth - panelRect.right - viewportGap * 2
      : panelRect.left - viewportGap * 2
  const width = Math.max(500, Math.min(560, availableWidth))
  const desiredTop = anchorRect.top - 8
  const top = Math.max(
    viewportGap,
    Math.min(desiredTop, window.innerHeight - popupHeight - viewportGap)
  )
  const maxHeight = Math.max(240, window.innerHeight - viewportGap * 2)
  const horizontalStyle =
    side === "home"
      ? { left: panelRect.right + viewportGap }
      : { right: window.innerWidth - panelRect.left + viewportGap }

  return createPortal(
    <motion.div
      ref={popupRef}
      role="dialog"
      aria-modal={pinned || undefined}
      aria-label={t("playerDetails.title", { player: player.name })}
      data-player-details-popup
      data-pinned={pinned || undefined}
      className="fixed z-60 overflow-y-auto"
      initial={{ opacity: 0, scale: 0.96, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, y: -4 }}
      transition={{ duration: 0.1, ease: [0.2, 0, 0, 1] }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      style={{
        ...horizontalStyle,
        top,
        width,
        maxWidth: `calc(100vw - ${panelRect.width + viewportGap * 3}px)`,
        maxHeight,
        transformOrigin: side === "home" ? "left top" : "right top",
      }}
    >
      <PlayerMatchDetailsCard
        player={player}
        teamColor={teamColor}
        matchMinute={matchMinute}
        matchTick={matchTick}
        movementFrames={movementFrames}
        movementAnalysis={movementAnalysis}
        heatmaps={heatmaps}
        pitchDimensions={pitchDimensions}
      />
    </motion.div>,
    document.body
  )
}

function PlayerMatchDetailsCard(props: PlayerMatchDetailsProps) {
  const { t } = useTranslation()
  const { player, teamColor, heatmaps, pitchDimensions } = props
  const { contribution, playedMinutes, groups, movement } =
    usePlayerMatchDetails(props)

  return (
    <Card className="relative min-h-0 w-full gap-0 overflow-hidden border border-border/80 bg-card p-2.5 text-card-foreground shadow-2xl">
      <div className="relative min-h-0 w-full">
        <div
          className="absolute inset-y-0 left-0 grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-2"
          style={{ width: 240 }}
        >
          <header className="relative grid min-h-0 grid-cols-[4rem_minmax(0,1fr)] overflow-hidden rounded-md border border-border/70 bg-muted/35">
            <Avatar className="h-full min-h-16 w-16 rounded-none after:hidden">
              {player.portraitUrl && (
                <AvatarImage
                  src={player.portraitUrl}
                  alt={player.name}
                  className="rounded-none object-cover"
                />
              )}
              <AvatarFallback
                className="rounded-none bg-transparent text-lg font-bold"
                style={{ color: teamColor }}
              >
                {initials(player.name)}
              </AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-col justify-center px-3 py-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <h2
                  className="min-w-0 truncate text-sm font-bold"
                  title={player.fullName ?? player.name}
                >
                  {player.fullName ?? player.name}
                </h2>
                <span
                  className="shrink-0 text-[11px] font-bold"
                  style={{ color: teamColor }}
                >
                  #{player.shirtNumber ?? "-"}
                </span>
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
                  {player.position ?? player.inPossession?.position ?? "-"}
                </span>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-2">
                <HeaderMetric
                  label={t("playerDetails.minutesPlayed")}
                  value={`${playedMinutes}'`}
                  valueClassName="bg-muted text-foreground"
                />
                <HeaderMetric
                  label={t("stats.rating")}
                  value={player.rating?.toFixed(1) ?? "-"}
                  valueClassName={ratingBadgeClass(player.rating)}
                />
              </dl>
            </div>
          </header>

          <div className="grid min-h-0 grid-rows-3 gap-2">
            {groups.map((group) => (
              <section
                key={group.id}
                className="flex min-h-0 flex-col overflow-hidden rounded-md border border-border/70 bg-muted/10 p-2"
              >
                <SectionTitle title={t(`playerDetails.groups.${group.id}`)} />
                <dl className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto overscroll-contain">
                  {group.items.map((item) => (
                    <div
                      key={item.id}
                      className="flex min-h-5 items-center justify-between gap-2 py-0.5"
                    >
                      <dt
                        className="min-w-0 truncate text-[10px] text-muted-foreground"
                        title={t(playerMetricTranslationKeys[item.id])}
                      >
                        {t(playerMetricTranslationKeys[item.id])}
                      </dt>
                      <dd className="shrink-0 text-[11px] font-semibold tabular-nums">
                        {item.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </div>

        <div
          className="flex min-h-0 flex-col gap-2"
          style={{ marginLeft: 248 }}
        >
          <section className="shrink-0 rounded-md border border-border/70 bg-muted/10 p-2">
            {contribution ? (
              <PlayerRatingBreakdown
                player={player}
                contribution={contribution}
              />
            ) : (
              <div className="flex min-h-20 items-center justify-center rounded border border-dashed p-3 text-center text-xs text-muted-foreground">
                {t("playerDetails.noRatingBreakdown")}
              </div>
            )}
          </section>

          <MovementAnalysisCard
            distanceM={player.stats.distanceM}
            sprints={player.stats.sprints}
            movement={movement}
          />

          <section className="flex min-h-0 shrink-0 flex-col overflow-hidden rounded-md border border-border/70 bg-muted/10 p-2">
            <SectionTitle title={t("playerDetails.heatmap")} />
            <div className="min-h-0 overflow-hidden">
              <PlayerHeatmap
                player={player}
                heatmaps={heatmaps}
                pitchDimensions={pitchDimensions}
              />
            </div>
          </section>
        </div>
      </div>
    </Card>
  )
}
