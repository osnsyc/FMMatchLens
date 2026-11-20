import {
  ArrowDataTransferHorizontalIcon,
  FootballIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { goalIconUrl } from "@/lib/goalIcon"
import type { TimelineEvent } from "@/lib/matchTimelineEvents"

export function TimelineEventIcon({ event }: { event: TimelineEvent }) {
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
    return (
      <img src={goalIconUrl} alt="" aria-hidden="true" className="size-4" />
    )
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
      className={`match-card-icon ${event.type === "red_card" ? "match-card-icon--red" : "match-card-icon--yellow"}`}
    />
  )
}
