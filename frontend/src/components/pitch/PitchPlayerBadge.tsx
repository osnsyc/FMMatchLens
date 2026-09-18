import type { ComponentProps, ReactNode } from "react"

import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
} from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

type PitchPlayerBadgeProps = Omit<
  ComponentProps<typeof Avatar>,
  "children"
> & {
  number?: ReactNode
  fallback?: ReactNode
  numberColor?: string
  fallbackClassName?: string
  badge?: ReactNode
  badgeClassName?: string
}

/**
 * Avatar-backed shirt-number marker whose size is controlled by its nearest
 * `.player-pitch` size container.
 */
export function PitchPlayerBadge({
  number,
  fallback = "?",
  numberColor,
  className,
  fallbackClassName,
  badge,
  badgeClassName,
  ...props
}: PitchPlayerBadgeProps) {
  return (
    <Avatar
      className={cn(
        "pitch-player-badge overflow-visible shadow-sm",
        className
      )}
      {...props}
    >
      <AvatarFallback
        className={cn(
          "pitch-player-badge-fallback bg-transparent font-bold",
          fallbackClassName
        )}
        style={{ color: numberColor }}
      >
        {number ?? fallback}
      </AvatarFallback>
      {badge != null && (
        <AvatarBadge aria-hidden="true" className={badgeClassName}>
          {badge}
        </AvatarBadge>
      )}
    </Avatar>
  )
}
