import { memo, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { ArrowDataTransferHorizontalIcon, SidebarLeft01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { NativeTabs } from "@/components/uitripled/native-tabs-shadcnui"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type {
  MatchEvent,
  MatchPlayer,
  PlayerPositionFamiliarities,
  PlayerStats,
  TeamSide,
} from "@/types/match"
import { playerPositionLabels } from "@/types/match"
import { shortPlayerName } from "@/lib/player-name"

type SquadPanelProps = {
  title: string
  teamUid?: number
  side: TeamSide
  players: MatchPlayer[]
  allPlayers?: MatchPlayer[]
  events: MatchEvent[]
  teamColor?: string
}

type StatusIcon =
  | "goal"
  | "assist"
  | "sub-on"
  | "sub-off"

type PlayerStatus = {
  key: string
  label: string
  marker: string
  icon?: StatusIcon
  minutes?: number[]
  count?: number
  className?: string
}

let openPlayerProfileCount = 0

function setPlayerProfileBackdrop(open: boolean) {
  openPlayerProfileCount = Math.max(0, openPlayerProfileCount + (open ? 1 : -1))
  document.body.classList.toggle("player-profile-open", openPlayerProfileCount > 0)
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
}

function squadRole(player: MatchPlayer) {
  if (!player.isStarter) {
    return familiarPosition(player)
  }

  return player.inPossession?.roleAbbreviation ?? "-"
}

function familiarPosition(player: MatchPlayer) {
  return formatPositionFamiliarities(player.positionFamiliarities) ?? player.position ?? "-"
}

function formatPositionFamiliarities(familiarities?: PlayerPositionFamiliarities) {
  if (!familiarities) return undefined

  const positions = new Set(
    playerPositionLabels.filter((position) => (familiarities[position] ?? 0) >= 15)
  )
  if (positions.size === 0) return undefined

  const parts: string[] = []
  if (positions.has("GK")) parts.push("GK")
  if (positions.has("SW")) parts.push("SW")

  const defenderSides = positionSides(positions, "DR", "DL", "DC")
  const wingBackSides = positionSides(positions, "WBR", "WBL")
  if (defenderSides.size > 0 && setsEqual(defenderSides, wingBackSides)) {
    parts.push(`D/WB(${formatPositionSides(defenderSides)})`)
  } else {
    addWidePosition(parts, "D", defenderSides)
    addWidePosition(parts, "WB", wingBackSides)
  }

  const midfieldSides = positionSides(positions, "MR", "ML", "MC")
  if (positions.has("DM") && setsEqual(midfieldSides, new Set(["C"]))) {
    parts.push("DM/MC")
    midfieldSides.clear()
  } else if (positions.has("DM")) {
    parts.push("DM")
  }

  addWidePosition(parts, "M", midfieldSides)
  addWidePosition(parts, "AM", positionSides(positions, "AMR", "AML", "AMC"))
  if (positions.has("ST")) parts.push("ST")
  return parts.join(",")
}

function positionSides(
  positions: ReadonlySet<string>,
  right: string,
  left: string,
  centre?: string
) {
  const sides = new Set<string>()
  if (positions.has(right)) sides.add("R")
  if (positions.has(left)) sides.add("L")
  if (centre && positions.has(centre)) sides.add("C")
  return sides
}

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  return left.size === right.size && [...left].every((value) => right.has(value))
}

function addWidePosition(parts: string[], line: string, sides: ReadonlySet<string>) {
  if (sides.size > 0) parts.push(`${line}(${formatPositionSides(sides)})`)
}

function formatPositionSides(sides: ReadonlySet<string>) {
  return ["R", "L", "C"].filter((side) => sides.has(side)).join("")
}

function PositionTicker({ text }: { text: string }) {
  const viewportRef = useRef<HTMLSpanElement | null>(null)
  const trackRef = useRef<HTMLSpanElement | null>(null)
  const [overflow, setOverflow] = useState(0)

  useEffect(() => {
    const viewport = viewportRef.current
    const track = trackRef.current
    if (!viewport || !track) return

    const measure = () => setOverflow(Math.max(0, track.scrollWidth - viewport.clientWidth))
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    observer.observe(track)
    measure()
    return () => observer.disconnect()
  }, [text])

  return (
    <span
      ref={viewportRef}
      className="squad-position-ticker relative block h-2.5 w-full min-w-0 overflow-hidden"
      data-overflow={overflow > 0 ? "true" : "false"}
      style={{ "--squad-position-overflow": `${overflow}px` } as React.CSSProperties}
    >
      <span
        ref={trackRef}
        className="squad-position-ticker-track absolute left-0 top-0 block w-max text-[8px] font-medium uppercase leading-2.5 tracking-wide text-muted-foreground"
      >
        {text}
      </span>
    </span>
  )
}

function ratingClass(
  rating?: number
) {
  if (rating == null) {
    return "text-muted-foreground"
  }

  if (rating >= 7.5) {
    return "text-emerald-500 dark:text-emerald-400"
  }

  if (rating < 6.5) {
    return "text-destructive"
  }

  return "text-foreground"
}

export function SquadPanel({
  title,
  teamUid,
  side,
  players,
  allPlayers = players,
  events,
  teamColor,
}: SquadPanelProps) {
  const { t } = useTranslation()
  const panelRef = useRef<HTMLElement | null>(null)
  const [isStatsDrawerOpen, setIsStatsDrawerOpen] = useState(false)
  const [drawerRect, setDrawerRect] = useState<DOMRect | null>(null)

  const openStatsDrawer = () => {
    const panel = panelRef.current
    if (!panel) return
    setDrawerRect(panel.getBoundingClientRect())
    window.requestAnimationFrame(() => setIsStatsDrawerOpen(true))
  }

  useEffect(() => {
    const panel = panelRef.current
    if (!isStatsDrawerOpen || !panel) return

    const updateRect = () => setDrawerRect(panel.getBoundingClientRect())
    const resizeObserver = new ResizeObserver(updateRect)
    resizeObserver.observe(panel)
    window.addEventListener("resize", updateRect)
    window.addEventListener("scroll", updateRect, true)
    updateRect()

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener("resize", updateRect)
      window.removeEventListener("scroll", updateRect, true)
    }
  }, [isStatsDrawerOpen])

  const starters = useMemo(
    () =>
      players.filter(
        (player) =>
          player.isStarter
      ),
    [players]
  )

  const substitutes = useMemo(
    () =>
      players.filter(
        (player) =>
          !player.isStarter
      ),
    [players]
  )

  const orderedPlayers = useMemo(
    () => [...starters, ...substitutes],
    [starters, substitutes]
  )

  const resolvedTeamColor =
    teamColor ?? "#af78ff"

  const minutesFor = (
    player: MatchPlayer,
    type: MatchEvent["type"]
  ) =>
    events
      .filter(
        (event) =>
        event.playerId === player.id &&
        event.type === type
      )
      .map((event) => event.minute)

  const statusesFor = (
    player: MatchPlayer
  ) => {
    const statuses: PlayerStatus[] = []

    if (
      player.status
        ?.yellowCards
    ) {
      statuses.push({
        key: "yellow",
        label: t(
          "squad.yellowCard"
        ),
        marker: "",
        className:
          "size-2.5 rounded-[1px] bg-yellow-400",
        minutes: minutesFor(
          player,
          "yellow_card"
        ),
        count:
          player.status
            .yellowCards,
      })
    }

    if (
      player.status
        ?.redCards
    ) {
      statuses.push({
        key: "red",
        label: t(
          "squad.redCard"
        ),
        marker: "",
        className:
          "size-2.5 rounded-[1px] bg-red-500",
        minutes: minutesFor(
          player,
          "red_card"
        ),
        count:
          player.status
            .redCards,
      })
    }

    if (
      player.status
        ?.subbedOnMinute
    ) {
      statuses.push({
        key: "on",
        label: t(
          "squad.subbedOn"
        ),
        marker: "",
        icon: "sub-on",
        className:
          "text-emerald-500 dark:text-emerald-400",
        minutes: [player.status.subbedOnMinute],
      })
    }

    if (
      player.status
        ?.subbedOffMinute
    ) {
      statuses.push({
        key: "off",
        label: t(
          "squad.subbedOff"
        ),
        marker: "",
        icon: "sub-off",
        className:
          "text-destructive",
        minutes: [player.status.subbedOffMinute],
      })
    }

    if (
      player.stats.goals
    ) {
      statuses.push({
        key: "goal",
        label: t(
          "squad.goal"
        ),
        marker: "",
        icon: "goal",
        className:
          "text-foreground",
        minutes: minutesFor(
          player,
          "goal"
        ),
        count:
          player.stats.goals,
      })
    }

    if (
      player.stats.assists
    ) {
      statuses.push({
        key: "assist",
        label: t(
          "squad.assist"
        ),
        marker: "",
        icon: "assist",
        className:
          "text-primary",
        minutes: minutesFor(
          player,
          "assist_candidate"
        ),
        count:
          player.stats.assists,
      })
    }

    return statuses
  }

  const renderPlayer = (
    player: MatchPlayer
  ) => {
    const statuses =
      statusesFor(player)
    const displayName = shortPlayerName(player.name)
    const positionLabel = squadRole(player)
    const showsFamiliarPosition = !player.isStarter
    const positionDescription = showsFamiliarPosition
      ? positionLabel
      : player.inPossession
        ? t(`inPossessionRoleNames.${player.inPossession.roleAbbreviation}`, {
            defaultValue: player.inPossession.role,
          })
        : positionLabel

    return (
      <li
        key={player.id}
        className={`
          group relative grid min-w-0
          grid-cols-[1.75rem_1.5rem_minmax(3.5rem,1fr)_minmax(0,3.25rem)_2.25rem]
          items-center gap-1 whitespace-nowrap rounded-md
          px-1.5 py-1.5
          transition-colors
          hover:bg-muted/45
          sm:grid-cols-[2rem_1.75rem_minmax(4.5rem,1fr)_minmax(0,4rem)_2.5rem]
          sm:gap-1.5 sm:px-2
          ${
            !player.isOnPitch
              ? "opacity-50"
              : ""
          }
        `}
      >
        {/* subtle team-color hover marker */}
        <span
          aria-hidden="true"
          className="
            pointer-events-none absolute
            bottom-1.5 left-0 top-1.5
            w-[2px] rounded-full
            opacity-0
            transition-opacity
            group-hover:opacity-100
          "
          style={{
            backgroundColor:
              resolvedTeamColor,
            boxShadow: `0 0 8px ${resolvedTeamColor}66`,
          }}
        />

        {/* Avatar */}
        <PlayerProfileHover player={player} side={side} teamColor={resolvedTeamColor} panelRef={panelRef}>
        <div className="flex size-7 shrink-0 items-center justify-center sm:size-8">
          <Avatar
            className="
              size-6
              ring-1 ring-border
              transition-all
              group-hover:ring-2
              sm:size-7
            "
            style={
              {
                "--tw-ring-color":
                  resolvedTeamColor,
              } as React.CSSProperties
            }
          >
            {player.portraitUrl && (
              <AvatarImage
                src={player.portraitUrl}
                alt={player.name}
                className="object-cover"
              />
            )}
            <AvatarFallback
              className="
                bg-muted/75
                text-[10px]
                font-semibold
                text-foreground
              "
            >
              {initials(
                player.name
              )}
            </AvatarFallback>
          </Avatar>
        </div>
        </PlayerProfileHover>

        {/* Shirt number + position */}
        <HoverCard>
          <HoverCardTrigger
            render={<div className="flex min-w-0 flex-col items-center justify-center overflow-hidden text-center" />}
          >
            <span
              className="flex h-[18px] items-center text-[14px] font-bold leading-[18px] tabular-nums"
              style={{
                color: resolvedTeamColor,
                textShadow: `0 0 8px ${resolvedTeamColor}30`,
              }}
            >
              {player.shirtNumber ?? "-"}
            </span>
            <PositionTicker text={positionLabel} />
          </HoverCardTrigger>
          <HoverCardContent
            side="top"
            sideOffset={6}
            className="w-auto max-w-72 whitespace-nowrap px-2.5 py-1.5 font-medium"
          >
            {positionDescription}
          </HoverCardContent>
        </HoverCard>

        {/* Player name */}
        <HoverCard>
          <HoverCardTrigger
            render={
              <span className="min-w-0 truncate text-sm font-medium text-foreground/90 transition-colors group-hover:text-foreground" />
            }
          >
            <span className="block truncate leading-7">{displayName}</span>
          </HoverCardTrigger>
          <HoverCardContent
            side="top"
            sideOffset={6}
            className="w-auto max-w-72 whitespace-nowrap px-2.5 py-1.5 font-medium"
          >
            {player.fullName ?? player.name}
          </HoverCardContent>
        </HoverCard>

        {/* Match status */}
        <PlayerStatusStrip statuses={statuses} />

        {/* Rating */}
        <span
          className={`
            col-start-5
            flex h-6 w-9 shrink-0
            items-center justify-center
            justify-self-end
            rounded-md
            bg-muted/35
            text-sm font-semibold
            tabular-nums
            sm:w-10
            ${ratingClass(
              player.rating
            )}
          `}
        >
          {player.rating?.toFixed(
            1
          ) ?? "-"}
        </span>
      </li>
    )
  }

  return (
    <TooltipProvider>
      <>
      <section
        ref={panelRef}
        className="flex h-full min-h-0 min-w-0 flex-col"
        data-side={side}
      >
        {/* Team header */}
        <div
          className="
            font-heading
            relative flex shrink-0
            items-center justify-center
            overflow-hidden
            border-b
            px-3 py-3
            sm:px-4 sm:py-4
          "
        >
          {/* team-color background atmosphere */}
          <div
            aria-hidden="true"
            className="
              pointer-events-none
              absolute inset-0
              opacity-[0.08]
            "
            style={{
              background: `linear-gradient(
                90deg,
                transparent 0%,
                ${resolvedTeamColor} 50%,
                transparent 100%
              )`,
            }}
          />

          {/* bottom highlight */}
          <div
            aria-hidden="true"
            className="
              pointer-events-none
              absolute bottom-0 left-1/2
              h-px w-1/3
              -translate-x-1/2
            "
            style={{
              background: `linear-gradient(
                90deg,
                transparent,
                ${resolvedTeamColor},
                transparent
              )`,
              boxShadow: `0 0 8px ${resolvedTeamColor}55`,
            }}
          />

          <div className="relative z-10 min-w-0 max-w-full text-center">
            {teamUid == null ? (
              <h2 className="truncate text-sm font-semibold leading-7 tracking-[0.01em]" style={{ color: resolvedTeamColor, textShadow: `0 0 12px ${resolvedTeamColor}28` }}>{title}</h2>
            ) : (
              <Tooltip>
                <TooltipTrigger render={<h2 className="truncate text-sm font-semibold leading-7 tracking-[0.01em]" style={{ color: resolvedTeamColor, textShadow: `0 0 12px ${resolvedTeamColor}28` }} />}>{title}</TooltipTrigger>
                <TooltipContent>UID {teamUid}</TooltipContent>
              </Tooltip>
            )}
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={`absolute z-20 size-7 border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary ${side === "home" ? "right-2" : "left-2"}`}
            aria-label={t("playerData.openTeam", { team: title })}
            title={t("playerData.open")}
            aria-expanded={isStatsDrawerOpen}
            onClick={openStatsDrawer}
          >
            <HugeiconsIcon icon={SidebarLeft01Icon} strokeWidth={1.8} primaryColor="currentColor" className="size-4 text-primary" />
          </Button>
        </div>

        <ScrollArea className="scrollbar-hidden min-h-0 min-w-0 flex-1">
          <ol className="flex min-w-0 flex-col p-1.5">
            {starters.map(
              renderPlayer
            )}

            {/* Substitutes separator */}
            <li className="relative my-3 flex min-w-0 items-center px-1">
              <Separator className="opacity-60" />

              <span
                className="
                  absolute left-1/2
                  -translate-x-1/2
                  whitespace-nowrap
                  bg-card
                  px-2.5
                  text-[9px]
                  font-semibold
                  uppercase
                  tracking-[0.14em]
                  text-muted-foreground
                "
              >
                {t(
                  "squad.substitutes"
                )}
              </span>
            </li>

            {substitutes.map(
              renderPlayer
            )}
          </ol>
        </ScrollArea>
      </section>
      {drawerRect && (
        <TeamStatsDrawer
          open={isStatsDrawerOpen}
          title={title}
          players={orderedPlayers}
          allPlayers={allPlayers}
          side={side}
          teamColor={resolvedTeamColor}
          rect={drawerRect}
          onClose={() => setIsStatsDrawerOpen(false)}
        />
      )}
      </>
    </TooltipProvider>
  )
}

const PlayerProfileHover = memo(function PlayerProfileHover({
  player,
  side,
  teamColor,
  panelRef,
  children,
}: {
  player: MatchPlayer
  side: TeamSide
  teamColor: string
  panelRef: React.RefObject<HTMLElement | null>
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  const [sideOffset, setSideOffset] = useState(8)
  const [open, setOpen] = useState(false)
  const isGoalkeeper = (player.positionFamiliarities?.GK ?? 0) >= 15 || player.position === "GK"
  const attributeColumns = player.attributes
    ? buildAttributeColumns(isGoalkeeper)
    : []

  useEffect(() => {
    if (!open) return
    setPlayerProfileBackdrop(true)
    return () => setPlayerProfileBackdrop(false)
  }, [open])

  const updateOffset = (trigger: HTMLElement) => {
    const panel = panelRef.current?.getBoundingClientRect()
    const anchor = trigger.getBoundingClientRect()
    if (!panel) return
    setSideOffset(side === "home" ? Math.max(8, panel.right - anchor.right + 8) : Math.max(8, anchor.left - panel.left + 8))
  }

  return (
    <Tooltip onOpenChange={setOpen}>
      <TooltipTrigger
        render={<div onPointerEnter={(event) => updateOffset(event.currentTarget)} />}
      >
        {children}
      </TooltipTrigger>
      {open && <TooltipContent
        side={side === "home" ? "right" : "left"}
        sideOffset={sideOffset}
        align="start"
        alignOffset={-8}
        showArrow={false}
        data-player-profile-popup
        className="max-w-none bg-transparent p-0 text-card-foreground shadow-none"
      >
        <Card className="w-[38rem] max-w-[min(38rem,calc(100vw-2rem))] gap-0 border border-border/80 py-0 shadow-2xl">
          <CardHeader className="grid grid-cols-[7rem_minmax(0,1fr)] gap-0 overflow-hidden border-b bg-muted/35 p-0">
            <Avatar className="row-span-2 h-full w-full rounded-none after:hidden">
              {player.portraitUrl && <AvatarImage src={player.portraitUrl} alt={player.name} className="rounded-none object-cover" />}
              <AvatarFallback className="rounded-none bg-transparent text-lg font-bold" style={{ color: teamColor }}>{initials(player.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 self-center p-3 pb-1">
              <CardTitle className="truncate text-lg font-bold">{player.name}</CardTitle>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <span className="font-semibold" style={{ color: teamColor }}>#{player.shirtNumber ?? "-"}</span>
                <span>{familiarPosition(player)}</span>
                {player.uid != null && <span>UID {player.uid}</span>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 self-end p-3 pt-0 text-[11px]">
              <ProfileFact label={t("playerProfile.weeklyWage")} value={formatWage(player.profile?.weeklyWage)} />
              <ProfileFact label={t("playerProfile.height")} value={player.profile?.heightCm ? `${player.profile.heightCm} cm` : "-"} />
              <ProfileFact label={t("playerProfile.overallPhysicalCondition")} value={formatProfileLevel(player.stats.overallPhysicalCondition)} />
              <ProfileFact label={t("playerProfile.matchSharpness")} value={formatProfileLevel(player.stats.matchSharpness)} />
            </div>
          </CardHeader>

          <CardContent className="grid grid-cols-3 gap-x-6 p-3">
            {attributeColumns.length > 0 ? attributeColumns.map((column, columnIndex) => (
              <section key={column.title} className="flex min-w-0 flex-col">
                <h3 className="mb-1.5 border-b pb-1 text-xs font-bold uppercase tracking-wide" style={{ color: teamColor }}>
                  {t(`playerProfile.attributeGroups.${column.title}`)}
                </h3>
                <div className="space-y-0.5">
                  {column.names
                    .map((name) => ({ name, value: displayAttributeValue(findAttributeValue(player.attributes!, name)) }))
                    .filter(({ value }) => value > 0)
                    .map(({ name, value }) => (
                        <div key={name} className="flex items-center justify-between gap-2 leading-5">
                          <span className="truncate text-[11px] text-muted-foreground">
                            {t(`playerProfile.attributes.${name}`, { defaultValue: name })}
                          </span>
                          <span className={`w-5 text-right text-xs font-bold tabular-nums ${attributeValueClass(value)}`}>{value}</span>
                        </div>
                      ))}
                </div>
                {columnIndex === 2 && player.attributes && (
                  <PlayerAttributeRadar
                    attributes={player.attributes}
                    isGoalkeeper={isGoalkeeper}
                    color={teamColor}
                  />
                )}
              </section>
            )) : (
              <div className="col-span-3 py-8 text-center text-muted-foreground">
                {t("playerProfile.noAttributes")}
              </div>
            )}
          </CardContent>
        </Card>
      </TooltipContent>}
    </Tooltip>
  )
}, (previous, next) =>
  previous.side === next.side &&
  previous.teamColor === next.teamColor &&
  previous.panelRef === next.panelRef &&
  previous.player.uid === next.player.uid &&
  previous.player.name === next.player.name &&
  previous.player.shirtNumber === next.player.shirtNumber &&
  previous.player.position === next.player.position &&
  previous.player.inPossession === next.player.inPossession &&
  previous.player.portraitUrl === next.player.portraitUrl &&
  previous.player.profile === next.player.profile &&
  previous.player.attributes === next.player.attributes &&
  previous.player.stats.overallPhysicalCondition === next.player.stats.overallPhysicalCondition &&
  previous.player.stats.matchSharpness === next.player.stats.matchSharpness
)

function ProfileFact({ label, value }: { label: string; value: string }) {
  return <div className="flex min-w-0 justify-between gap-2"><span className="text-muted-foreground">{label}</span><span className="truncate font-medium tabular-nums">{value}</span></div>
}

function formatWage(value?: number) {
  return value && value > 0 ? `£${Math.round(value).toLocaleString()}/w` : "-"
}

function formatProfileLevel(value?: number) {
  if (!value || value <= 0) return "-"
  const percentage = value > 100 ? value / 100 : value <= 20 ? value * 5 : value
  return `${Math.round(Math.min(100, percentage))}%`
}

function attributeValueClass(value: number) {
  if (value >= 16) return "text-emerald-500 dark:text-emerald-400"
  if (value >= 11) return "text-yellow-500 dark:text-yellow-400"
  if (value >= 6) return "text-foreground"
  return "text-muted-foreground/65"
}

function displayAttributeValue(rawValue: number) {
  if (!Number.isFinite(rawValue) || rawValue <= 0) return 0
  return Math.min(20, Math.max(1, Math.round(rawValue / 5)))
}

type AttributeColumn = {
  title: "goalkeeping" | "technical" | "mental" | "physical"
  names: string[]
}

const outfieldTechnicalOrder = [
  "Passing", "Crossing", "Marking", "Technique", "Dribbling", "Tackling", "Finishing", "First Touch", "Heading", "Long Shots",
  "Penalty Taking", "Corners", "Long Throws", "Free Kicks",
]

const goalkeeperOrder = [
  "Rushing Out", "Passing", "Kicking", "Reflexes", "Command Of Area", "Punching", "Handling", "Throwing", "First Touch",
  "One On Ones", "Eccentricity", "Communication", "Aerial Reach",
]

const mentalOrder = [
  "Flair", "Positioning", "Work Rate", "Concentration", "Decisions", "Leadership", "Aggression", "Vision", "Teamwork",
  "Off The Ball", "Determination", "Bravery", "Anticipation", "Composure",
]

const physicalOrder = [
  "Acceleration", "Jumping Reach", "Agility", "Stamina", "Balance", "Strength", "Pace", "Natural Fitness",
]

function buildAttributeColumns(isGoalkeeper: boolean): AttributeColumn[] {
  return [
    {
      title: isGoalkeeper ? "goalkeeping" : "technical",
      names: isGoalkeeper ? goalkeeperOrder : outfieldTechnicalOrder,
    },
    { title: "mental", names: mentalOrder },
    { title: "physical", names: physicalOrder },
  ]
}

function findAttributeValue(attributes: NonNullable<MatchPlayer["attributes"]>, name: string) {
  return attributes.technical[name] ?? attributes.mental[name] ?? attributes.physical[name] ?? attributes.goalkeeping[name] ?? 0
}

type RadarAxis = { label: string; value: number }

function PlayerAttributeRadar({
  attributes,
  isGoalkeeper,
  color,
}: {
  attributes: NonNullable<MatchPlayer["attributes"]>
  isGoalkeeper: boolean
  color: string
}) {
  const { t } = useTranslation()
  const axes = buildRadarAxes(attributes, isGoalkeeper)
  const centerX = 105
  const centerY = 91
  const radius = 55
  const labelRadius = 76
  const point = (index: number, distance: number) => {
    const angle = -Math.PI / 2 + index * Math.PI / 4
    return {
      x: centerX + Math.cos(angle) * distance,
      y: centerY + Math.sin(angle) * distance,
    }
  }
  const polygon = (distance: number) => axes
    .map((_, index) => point(index, distance))
    .map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ")
  const valuePolygon = axes
    .map((axis, index) => point(index, radius * Math.min(20, Math.max(0, axis.value)) / 20))
    .map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ")

  return (
    <div className="mt-auto border-t pt-2">
      <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {t("playerProfile.attributeAnalysis")}
      </div>
      <svg
        viewBox="0 0 210 182"
        className="mx-auto block w-full max-w-[13rem] overflow-visible"
        role="img"
        aria-label={t("playerProfile.radarLabel")}
      >
        {[0.25, 0.5, 0.75, 1].map((level) => (
          <polygon
            key={level}
            points={polygon(radius * level)}
            fill="none"
            className="stroke-border"
            strokeWidth={level === 1 ? 1.1 : 0.65}
          />
        ))}
        {axes.map((axis, index) => {
          const edge = point(index, radius)
          const label = point(index, labelRadius)
          const horizontal = Math.cos(-Math.PI / 2 + index * Math.PI / 4)
          return (
            <g key={axis.label}>
              <line x1={centerX} y1={centerY} x2={edge.x} y2={edge.y} className="stroke-border" strokeWidth="0.65" />
              <text
                x={label.x}
                y={label.y}
                textAnchor={horizontal > 0.25 ? "start" : horizontal < -0.25 ? "end" : "middle"}
                dominantBaseline="middle"
                className="fill-muted-foreground text-[8px] font-medium"
              >
                <tspan x={label.x} dy="-3">{t(`playerProfile.radarAxes.${axis.label}`)}</tspan>
                <tspan x={label.x} dy="9" className="font-bold" style={{ fill: color }}>{Math.round(axis.value)}</tspan>
              </text>
            </g>
          )
        })}
        <polygon points={valuePolygon} fill={color} fillOpacity="0.2" stroke={color} strokeWidth="2" strokeLinejoin="round" />
        {axes.map((axis, index) => {
          const vertex = point(index, radius * Math.min(20, Math.max(0, axis.value)) / 20)
          return <circle key={axis.label} cx={vertex.x} cy={vertex.y} r="2" fill={color} />
        })}
      </svg>
    </div>
  )
}

function buildRadarAxes(
  attributes: NonNullable<MatchPlayer["attributes"]>,
  isGoalkeeper: boolean,
): RadarAxis[] {
  const score = (parts: Array<[string, number]>) => parts.reduce(
    (total, [name, weight]) => total + displayAttributeValue(findAttributeValue(attributes, name)) * weight,
    0,
  ) / parts.reduce((total, [, weight]) => total + weight, 0)

  const shared = {
    physical: score([["Strength", 1], ["Stamina", 1], ["Balance", 1], ["Agility", 1]]),
    speed: score([["Acceleration", 1], ["Pace", 1]]),
    mental: score([
      ["Determination", 1], ["Decisions", 1], ["Anticipation", 1],
      ["Teamwork", 1], ["Bravery", 1], ["Concentration", 1],
    ]),
  }

  if (isGoalkeeper) {
    return [
      { label: "shotStopping", value: score([["Reflexes", 1], ["One On Ones", 1]]) },
      { label: "physical", value: shared.physical },
      { label: "speed", value: shared.speed },
      { label: "mental", value: shared.mental },
      { label: "communication", value: score([["Communication", 1], ["Command Of Area", 1]]) },
      { label: "eccentricity", value: score([["Eccentricity", 1]]) },
      { label: "aerial", value: score([["Aerial Reach", 1], ["Handling", 1]]) },
      { label: "distribution", value: score([["Kicking", 1], ["Throwing", 1]]) },
    ]
  }

  return [
    { label: "defending", value: score([["Tackling", 0.5], ["Marking", 0.25], ["Positioning", 0.25]]) },
    { label: "physical", value: shared.physical },
    { label: "speed", value: shared.speed },
    { label: "vision", value: score([["Passing", 0.34], ["Vision", 0.33], ["Flair", 0.33]]) },
    { label: "attacking", value: score([["Finishing", 0.34], ["Off The Ball", 0.33], ["Composure", 0.33]]) },
    { label: "technique", value: score([["Technique", 0.34], ["First Touch", 0.33], ["Dribbling", 0.33]]) },
    { label: "aerial", value: score([["Heading", 0.5], ["Jumping Reach", 0.5]]) },
    { label: "mental", value: shared.mental },
  ]
}

type StatGroupId = "key" | "passing" | "attack" | "defence" | "goalkeeping" | "other"
type SortDirection = "asc" | "desc"
type PlayerSort =
  | { kind: "initial" }
  | { kind: "number"; direction: SortDirection }
  | { kind: "metric"; metricId: string; direction: SortDirection }

type PlayerMetric = {
  id: string
  value: (player: MatchPlayer) => number | undefined
  format?: (value: number) => string
}

const statValue = (key: keyof PlayerStats) => (player: MatchPlayer) => player.stats[key]
const integer = (value: number) => Math.round(value).toString()
const decimal = (precision: number) => (value: number) => value.toFixed(precision)
const percent = (value: number) => `${value.toFixed(1)}%`
const ratio = (completed: keyof PlayerStats, attempted: keyof PlayerStats) => (player: MatchPlayer) => {
  const total = Number(player.stats[attempted] ?? 0)
  return total > 0 ? Number(player.stats[completed] ?? 0) / total * 100 : 0
}

const playerStatGroups: Array<{ id: StatGroupId; fields: PlayerMetric[] }> = [
  {
    id: "key",
    fields: [
      { id: "distance", value: (player) => Number(player.stats.distanceM ?? 0) / 1000, format: (value) => `${value.toFixed(2)} km` },
      { id: "passes", value: statValue("passes"), format: integer },
      { id: "passAccuracy", value: ratio("passesCompleted", "passes"), format: percent },
      { id: "xg", value: statValue("xg"), format: decimal(2) },
      { id: "goals", value: statValue("goals"), format: integer },
      { id: "xa", value: statValue("xa"), format: decimal(2) },
      { id: "assists", value: statValue("assists"), format: integer },
      { id: "rating", value: (player) => player.rating, format: decimal(2) },
    ],
  },
  {
    id: "passing",
    fields: [
      { id: "passes", value: statValue("passes"), format: integer },
      { id: "passesCompleted", value: statValue("passesCompleted"), format: integer },
      { id: "passAccuracy", value: ratio("passesCompleted", "passes"), format: percent },
      { id: "keyPasses", value: statValue("keyPasses"), format: integer },
      { id: "crosses", value: statValue("crosses"), format: integer },
      { id: "crossesCompleted", value: statValue("crossesCompleted"), format: integer },
      { id: "crossAccuracy", value: ratio("crossesCompleted", "crosses"), format: percent },
    ],
  },
  {
    id: "attack",
    fields: [
      { id: "goals", value: statValue("goals"), format: integer },
      { id: "assists", value: statValue("assists"), format: integer },
      { id: "xg", value: statValue("xg"), format: decimal(2) },
      { id: "xa", value: statValue("xa"), format: decimal(2) },
      { id: "shots", value: statValue("shots"), format: integer },
      { id: "shotsOnTarget", value: statValue("shotsOnTarget"), format: integer },
      { id: "blockedShots", value: statValue("blockedShots"), format: integer },
      { id: "clearCutChances", value: statValue("clearCutChances"), format: integer },
      { id: "hitWoodwork", value: statValue("hitWoodwork"), format: integer },
      { id: "dribbles", value: statValue("dribbles"), format: integer },
    ],
  },
  {
    id: "defence",
    fields: [
      { id: "tacklesAttempted", value: statValue("tacklesAttempted"), format: integer },
      { id: "tacklesWon", value: statValue("tacklesWon"), format: integer },
      { id: "tackleAccuracy", value: ratio("tacklesWon", "tacklesAttempted"), format: percent },
      { id: "keyTackles", value: statValue("keyTackles"), format: integer },
      { id: "interceptions", value: statValue("interceptions"), format: integer },
      { id: "clearances", value: statValue("clearances"), format: integer },
      { id: "aerials", value: statValue("aerials"), format: integer },
      { id: "aerialsWon", value: statValue("aerialsWon"), format: integer },
      { id: "aerialAccuracy", value: ratio("aerialsWon", "aerials"), format: percent },
    ],
  },
  {
    id: "goalkeeping",
    fields: [
      { id: "shotsFaced", value: statValue("shotsFaced"), format: integer },
    ],
  },
  {
    id: "other",
    fields: [
      { id: "distance", value: (player) => Number(player.stats.distanceM ?? 0) / 1000, format: (value) => `${value.toFixed(2)} km` },
      { id: "fouls", value: statValue("fouls"), format: integer },
      { id: "fouled", value: statValue("fouled"), format: integer },
      { id: "corners", value: statValue("corners"), format: integer },
      { id: "throwIns", value: statValue("throwIns"), format: integer },
      { id: "defensiveFreeKicks", value: statValue("defensiveFreeKicks"), format: integer },
      { id: "attackingFreeKicks", value: statValue("attackingFreeKicks"), format: integer },
    ],
  },
]

const playerMetricTranslationKeys: Record<string, string> = {
  distance: "stats.distance",
  passes: "stats.passes",
  passesCompleted: "stats.completedPasses",
  passAccuracy: "stats.passAccuracy",
  xg: "stats.xg",
  goals: "stats.goals",
  xa: "stats.xa",
  assists: "stats.assists",
  rating: "stats.rating",
  keyPasses: "stats.keyPasses",
  crosses: "stats.crosses",
  crossesCompleted: "stats.crossesCompleted",
  crossAccuracy: "stats.crossAccuracy",
  shots: "stats.shots",
  shotsOnTarget: "stats.shotsOnTarget",
  blockedShots: "stats.blockedShots",
  clearCutChances: "stats.clearCutChances",
  hitWoodwork: "stats.hitWoodwork",
  dribbles: "stats.dribbles",
  tacklesAttempted: "stats.tacklesAttempted",
  tacklesWon: "stats.tacklesWon",
  tackleAccuracy: "stats.tackleSuccess",
  keyTackles: "stats.keyTackles",
  interceptions: "stats.interceptions",
  clearances: "stats.clearances",
  aerials: "stats.aerials",
  aerialsWon: "stats.aerialsWon",
  aerialAccuracy: "stats.aerialSuccess",
  shotsFaced: "stats.shotsFaced",
  fouls: "stats.fouls",
  fouled: "stats.fouled",
  corners: "stats.corners",
  throwIns: "stats.throwIns",
  defensiveFreeKicks: "stats.defensiveFreeKicks",
  attackingFreeKicks: "stats.attackingFreeKicks",
}

function TeamStatsDrawer({
  open,
  title,
  players,
  allPlayers,
  side,
  teamColor,
  rect,
  onClose,
}: {
  open: boolean
  title: string
  players: MatchPlayer[]
  allPlayers: MatchPlayer[]
  side: TeamSide
  teamColor: string
  rect: DOMRect
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [activeGroup, setActiveGroup] = useState<StatGroupId>("key")
  const [sort, setSort] = useState<PlayerSort>({ kind: "initial" })
  const width = window.innerWidth / 2
  const group = playerStatGroups.find((item) => item.id === activeGroup) ?? playerStatGroups[0]
  const sortMetric = sort.kind === "metric"
    ? group.fields.find((field) => field.id === sort.metricId)
    : undefined
  const sortedPlayers = useMemo(() => {
    if (sort.kind === "initial") return players
    const direction = sort.direction === "desc" ? -1 : 1
    return players
      .map((player, index) => ({ player, index }))
      .sort((left, right) => {
        const leftValue = sort.kind === "number"
          ? left.player.shirtNumber
          : sortMetric?.value(left.player)
        const rightValue = sort.kind === "number"
          ? right.player.shirtNumber
          : sortMetric?.value(right.player)
        if (leftValue == null && rightValue == null) return left.index - right.index
        if (leftValue == null) return 1
        if (rightValue == null) return -1
        return leftValue === rightValue ? left.index - right.index : (leftValue - rightValue) * direction
      })
      .map(({ player }) => player)
  }, [players, sort, sortMetric])

  const selectGroup = (value: string | number) => {
    const nextGroup = playerStatGroups.find((item) => item.id === value)
    if (!nextGroup) return
    setActiveGroup(nextGroup.id)
    setSort({ kind: "initial" })
  }

  const toggleSort = (metricId: string) => {
    setSort((current) => current.kind === "metric" && current.metricId === metricId
      ? { kind: "metric", metricId, direction: current.direction === "desc" ? "asc" : "desc" }
      : { kind: "metric", metricId, direction: "desc" })
  }

  const toggleNumberSort = () => {
    setSort((current) => current.kind === "number"
      ? { kind: "number", direction: current.direction === "asc" ? "desc" : "asc" }
      : { kind: "number", direction: "asc" })
  }

  return (
    <Drawer
      open={open}
      onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}
      swipeDirection={side === "home" ? "left" : "right"}
    >
      <DrawerContent
        className="scrollbar-hidden !bottom-auto !m-0 gap-0 overflow-hidden !rounded-lg border-0 bg-card py-0 text-card-foreground shadow-none ring-1 ring-foreground/10 [--drawer-inset:0px]"
        style={{
          top: rect.top,
          width,
          height: rect.height,
          maxWidth: "50vw",
          "--drawer-content-width": `${width}px`,
        } as React.CSSProperties}
      >
        <DrawerHeader className="relative flex-row items-center gap-3 border-b px-4 py-3">
          <div className="min-w-0 flex-1">
            <DrawerTitle className="truncate text-base font-semibold" style={{ color: teamColor }}>{title}</DrawerTitle>
            <DrawerDescription className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
              <span>{t("playerData.summary", { count: players.length })}</span>
              <span className="inline-flex items-center gap-1"><span className="size-1.5 rounded-full bg-emerald-500" />{t("playerData.teamBest")}</span>
              <span className="inline-flex items-center gap-1"><span className="size-1.5 rounded-full bg-amber-400" />{t("playerData.matchBest")}</span>
            </DrawerDescription>
          </div>
          <DrawerClose render={<Button type="button" variant="ghost" size="icon" className="size-8" aria-label={t("common.close")} />}>
            <span className="text-lg leading-none">×</span>
          </DrawerClose>
        </DrawerHeader>

        <div className="scrollbar-hidden shrink-0 overflow-x-auto border-b px-3 py-2">
          <NativeTabs
            items={playerStatGroups.map((item) => ({ id: item.id, label: t(`playerData.groups.${item.id}`), content: null }))}
            renderContent={false}
          value={activeGroup}
          onValueChange={selectGroup}
            className="w-max max-w-none"
            listClassName="h-6 w-max min-w-full"
            triggerClassName="h-5 px-2 py-0 text-[10px]"
          />
        </div>

        <div className="scrollbar-hidden min-h-0 flex-1 overflow-auto">
          <PlayerStatsTable
            players={sortedPlayers}
            allPlayers={allPlayers}
            fields={group.fields}
            sort={sort}
            teamColor={teamColor}
            onResetSort={() => setSort({ kind: "initial" })}
            onNumberSort={toggleNumberSort}
            onMetricSort={toggleSort}
          />
        </div>
      </DrawerContent>
    </Drawer>
  )
}

function PlayerStatsTable({
  players,
  allPlayers,
  fields,
  sort,
  teamColor,
  onResetSort,
  onNumberSort,
  onMetricSort,
}: {
  players: MatchPlayer[]
  allPlayers: MatchPlayer[]
  fields: PlayerMetric[]
  sort: PlayerSort
  teamColor: string
  onResetSort: () => void
  onNumberSort: () => void
  onMetricSort: (metricId: string) => void
}) {
  const { t } = useTranslation()
  const maxima = useMemo(() => {
    const team = new Map<string, number>()
    const match = new Map<string, number>()
    for (const field of fields) {
      team.set(field.id, maxMetricValue(players, field))
      match.set(field.id, maxMetricValue(allPlayers, field))
    }
    return { team, match }
  }, [allPlayers, fields, players])

  return (
    <table className="w-full min-w-max border-separate border-spacing-0 text-xs">
      <thead className="sticky top-0 z-30 bg-card shadow-sm">
        <tr>
          <th className="sticky left-0 z-40 w-11 border-b border-r bg-card p-0 text-center">
            <SortHeaderButton
              label={t("common.number")}
              active={sort.kind === "number"}
              direction={sort.kind === "number" ? sort.direction : undefined}
              onClick={onNumberSort}
            />
          </th>
          <th className="sticky left-11 z-40 w-32 border-b border-r bg-card p-0 text-left">
            <SortHeaderButton label={t("common.player")} active={sort.kind === "initial"} align="left" onClick={onResetSort} />
          </th>
          <th className="w-12 border-b border-r bg-card px-1.5 py-2 text-center">{t("common.position")}</th>
          <th className="w-14 border-b border-r bg-card px-1.5 py-2 text-center">{t("common.status")}</th>
          {fields.map((field) => {
            const active = sort.kind === "metric" && sort.metricId === field.id
            return (
              <th key={field.id} className="min-w-16 whitespace-nowrap border-b border-r bg-card p-0 text-center">
                <SortHeaderButton
                  label={t(playerMetricTranslationKeys[field.id])}
                  active={active}
                  direction={active ? sort.direction : undefined}
                  onClick={() => onMetricSort(field.id)}
                />
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody>
        {players.map((player) => (
          <tr key={player.id} className={!player.isOnPitch ? "text-muted-foreground" : ""}>
            <td className="sticky left-0 z-20 border-b border-r bg-card px-1.5 py-2 text-center font-bold tabular-nums" style={{ color: teamColor }}>
              {player.shirtNumber ?? "-"}
            </td>
            <td className="sticky left-11 z-20 max-w-32 border-b border-r bg-card px-2 py-2 font-medium">
              <HoverCard>
                <HoverCardTrigger render={<div className="truncate leading-6" />}>
                  {shortPlayerName(player.name)}
                </HoverCardTrigger>
                <HoverCardContent
                  side="top"
                  sideOffset={6}
                  className="w-auto max-w-72 whitespace-nowrap px-2.5 py-1.5 font-medium"
                >
                  {player.fullName ?? player.name}
                </HoverCardContent>
              </HoverCard>
            </td>
            <td className="border-b border-r px-1.5 py-2 text-center">{squadRole(player)}</td>
            <td className="whitespace-nowrap border-b border-r px-1.5 py-2 text-center">
              {player.isOnPitch ? t("playerData.onPitch") : player.isStarter ? t("playerData.subbedOff") : t("playerData.substitute")}
            </td>
            {fields.map((field) => {
              const value = field.value(player)
              const highlight = metricHighlightClass(
                value,
                maxima.team.get(field.id),
                maxima.match.get(field.id),
              )
              return (
                <td key={field.id} className={`border-b border-r px-1.5 py-2 text-center font-medium tabular-nums ${highlight}`}>
                  {value == null ? "-" : (field.format ?? integer)(value)}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function maxMetricValue(players: MatchPlayer[], field: PlayerMetric) {
  let maximum = 0
  for (const player of players) {
    const value = field.value(player)
    if (value != null && Number.isFinite(value) && value > maximum) maximum = value
  }
  return maximum
}

function metricHighlightClass(value: number | undefined, teamMaximum?: number, matchMaximum?: number) {
  if (value == null || value <= 0) return ""
  if (matchMaximum != null && value === matchMaximum) {
    return "bg-amber-400/15 text-amber-600 dark:text-amber-300"
  }
  if (teamMaximum != null && value === teamMaximum) {
    return "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"
  }
  return ""
}

function SortHeaderButton({
  label,
  active,
  direction,
  align = "center",
  onClick,
}: {
  label: string
  active: boolean
  direction?: SortDirection
  align?: "left" | "center"
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`flex w-full items-center gap-1 px-2 py-2 font-medium transition-colors hover:bg-muted/60 hover:text-foreground ${align === "left" ? "justify-start" : "justify-center"} ${active ? "text-foreground" : "text-muted-foreground"}`}
      onClick={onClick}
    >
      {label}
      <span className={`text-[9px] ${active ? "opacity-100" : "opacity-25"}`} aria-hidden="true">
        {direction === "asc" ? "▲" : direction === "desc" ? "▼" : "↕"}
      </span>
    </button>
  )
}

function StatusGlyph({
  status,
}: {
  status: {
    marker: string
    icon?: StatusIcon
    className?: string
  }
}) {
  if (status.icon) {
    return (
      <EventIcon
        icon={
          status.icon
        }
        className={
          status.className
        }
      />
    )
  }

  return (
    <span
      className={`inline-block shrink-0 ${status.className ?? ""}`}
    >
      {status.marker}
    </span>
  )
}

function PlayerStatusStrip({ statuses }: { statuses: PlayerStatus[] }) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [overflow, setOverflow] = useState(0)

  useEffect(() => {
    const viewport = viewportRef.current
    const track = trackRef.current
    if (!viewport || !track) return

    const measure = () => setOverflow(Math.max(0, track.scrollWidth - viewport.clientWidth))
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    observer.observe(track)
    measure()
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={viewportRef}
      className="squad-status-strip relative col-start-4 h-5 min-w-0 overflow-hidden"
      data-overflow={overflow > 0 ? "true" : "false"}
      style={{ "--squad-status-overflow": `${overflow}px` } as React.CSSProperties}
    >
      <div ref={trackRef} className="squad-status-strip-track absolute right-0 top-0 flex h-5 w-max items-center justify-end pr-0.5">
        {statuses.map((status, statusIndex) => (
          <HoverCard key={status.key}>
            <HoverCardTrigger
              render={
                <button
                  type="button"
                  className={`relative flex h-5 min-w-4 shrink-0 items-center justify-center outline-none transition-transform hover:z-10 hover:scale-110 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring ${statusIndex === 0 ? "" : "-ml-1.5"}`}
                  aria-label={status.label}
                />
              }
            >
              <span className="flex h-5 items-center justify-center">
                {Array.from({
                  length: status.icon === "goal" || status.icon === "assist"
                    ? Math.max(1, status.count ?? 1)
                    : 1,
                }).map((_, index) => (
                  <span key={index} className={`flex size-4 items-center justify-center ${index === 0 ? "" : "-ml-1.5"}`}>
                    <StatusGlyph status={status} />
                  </span>
                ))}
              </span>
            </HoverCardTrigger>
            <HoverCardContent
              side="top"
              sideOffset={6}
              className="w-auto max-w-72 whitespace-nowrap px-2.5 py-1.5 font-medium"
            >
              {status.label}
              {status.minutes?.length
                ? ` ${status.minutes.map((minute) => `${minute}'`).join("、")}`
                : ""}
            </HoverCardContent>
          </HoverCard>
        ))}
      </div>
    </div>
  )
}

function EventIcon({
  icon,
  className,
}: {
  icon: StatusIcon
  className?: string
}) {
  if (icon === "goal") {
    return (
      <img
        src="./goal.svg"
        alt=""
        aria-hidden="true"
        className={`size-3.5 shrink-0 ${
          className ?? ""
        }`}
      />
    )
  }

  if (icon !== "assist") {
    return (
      <HugeiconsIcon
        icon={ArrowDataTransferHorizontalIcon}
        strokeWidth={3}
        aria-hidden="true"
        className={`size-3.5 shrink-0 ${icon === "sub-off" ? "rotate-180" : ""} ${className ?? ""}`}
      />
    )
  }

  return (
    <span
      aria-hidden="true"
      className={`
        inline-block size-3.5 shrink-0
        bg-current
        [mask-position:center]
        [mask-repeat:no-repeat]
        [mask-size:contain]
        ${className ?? ""}
      `}
      style={{
        WebkitMaskImage: "url(./assist.svg)",
        maskImage: "url(./assist.svg)",
      }}
    />
  )
}
