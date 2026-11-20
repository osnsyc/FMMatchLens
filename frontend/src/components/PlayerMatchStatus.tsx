import {
  ArrowDataTransferHorizontalIcon,
  FootballIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"
import { AssistIcon } from "@/components/AssistIcon"
import { goalIconUrl } from "@/lib/goalIcon"
import {
  getPlayerMatchStatuses,
  type PlayerStatus,
  type StatusIcon,
} from "@/lib/playerMatchStatus"
import type { MatchEvent, MatchPlayer } from "@/types/match"

export function StatusGlyph({
  status,
}: {
  status: Pick<PlayerStatus, "icon" | "className">
}) {
  return <EventIcon icon={status.icon} className={status.className} />
}

function EventIcon({
  icon,
  className,
}: {
  icon: StatusIcon
  className?: string
}) {
  if (icon === "yellow-card" || icon === "red-card") {
    return (
      <span
        aria-hidden="true"
        className={`match-card-icon ${
          icon === "red-card"
            ? "match-card-icon--red"
            : "match-card-icon--yellow"
        } ${className ?? ""}`}
      />
    )
  }

  if (icon === "goal") {
    return (
      <img
        src={goalIconUrl}
        alt=""
        aria-hidden="true"
        className={`size-3.5 shrink-0 ${className ?? ""}`}
      />
    )
  }

  if (icon === "own-goal") {
    return (
      <HugeiconsIcon
        icon={FootballIcon}
        stroke="currentColor"
        strokeWidth={1.5}
        aria-hidden="true"
        className={`size-3.5 shrink-0 ${className ?? ""}`}
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
    <AssistIcon
      aria-hidden="true"
      className={`size-3.5 shrink-0 ${className ?? ""}`}
    />
  )
}

export function PlayerMatchStatusRow({
  player,
  events,
}: {
  player: MatchPlayer
  events: readonly MatchEvent[]
}) {
  const { t } = useTranslation()
  const statuses = getPlayerMatchStatuses(player, events, t)
  return (
    <span className="report-player-status-row" data-player-match-status>
      {statuses.map((status) => (
        <span
          key={status.key}
          className="inline-flex items-center"
          title={[
            status.label,
            ...(status.minutes ?? []).map((minute) => `${minute}′`),
          ].join(" ")}
        >
          {Array.from(
            {
              length:
                status.icon === "goal" ||
                status.icon === "own-goal" ||
                status.icon === "assist"
                  ? Math.max(1, status.count ?? 1)
                  : 1,
            },
            (_, index) => (
              <span
                key={index}
                className={index ? "-ml-1.5 inline-flex" : "inline-flex"}
              >
                <StatusGlyph status={status} />
              </span>
            )
          )}
        </span>
      ))}
    </span>
  )
}
