import { useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { FootballPitchIcon } from "@hugeicons/core-free-icons"
import { cn } from "@/lib/utils"
import {
  tacticalIcon,
  type TacticalIconName,
} from "@/components/formation/data/tacticIcons"
import { HugeiconsIcon } from "@hugeicons/react"
import { SquareLock01Icon } from "@hugeicons/core-free-icons"
import { useTranslation } from "react-i18next"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import type { FocusInstruction } from "@/components/formation/focus"

export function TacticalInstructionCard({
  instruction,
}: {
  instruction: FocusInstruction
}) {
  const { t } = useTranslation()
  return (
    <HoverCard>
      <HoverCardTrigger
        render={<div tabIndex={0} />}
        className="formation-focus-instruction"
        data-instruction-state={instruction.state}
        data-locked={instruction.locked || undefined}
        aria-label={t("teamTactics.instructionDescription", {
          group: t(instruction.groupKey),
          value: t(instruction.labelKey),
          state: t(`teamTactics.${instruction.state}`),
        })}
      >
        <span className="formation-focus-instruction-group">
          {t(instruction.groupKey)}
        </span>
        <span className="formation-focus-instruction-visual">
          <TacticalIcon name={instruction.icon} />
          {instruction.locked && (
            <HugeiconsIcon
              className="formation-focus-instruction-lock"
              icon={SquareLock01Icon}
              size={11}
              aria-label={t(`teamTactics.${instruction.state}`)}
            />
          )}
        </span>
        <LevelBar
          count={instruction.level.count}
          selected={instruction.level.selected}
        />
        <span className="formation-focus-instruction-label">
          {t(instruction.labelKey)}
        </span>
      </HoverCardTrigger>
      <HoverCardContent
        side="top"
        sideOffset={8}
        className="tactical-instruction-preview w-96 max-w-[calc(100vw-2rem)] border border-border bg-popover p-3 text-popover-foreground shadow-lg ring-0"
      >
        <div className="flex flex-col items-center gap-1 text-center">
          <span className="font-semibold">{t(instruction.groupKey)}</span>
          {instruction.state !== "defaultInstruction" && (
            <span className="text-[10px] text-muted-foreground">
              {t(`teamTactics.${instruction.state}`)}
            </span>
          )}
        </div>
        <div className="tactical-instruction-choices">
          {instruction.choices.map((choice, index) => (
            <div
              key={choice.id}
              className="tactical-instruction-choice"
              data-selected={index === instruction.level.selected}
            >
              <TacticalIcon name={choice.icon} />
              <span className="font-medium">{t(choice.labelKey)}</span>
              {choice.policy !== undefined && (
                <span className="text-[9px] opacity-70">
                  {t(`teamTactics.policyStates.${choice.policy}`)}
                </span>
              )}
            </div>
          ))}
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}

function LevelBar({ count, selected }: { count: number; selected: number }) {
  const { t } = useTranslation()
  return (
    <span
      className="tactics-level-bar"
      role="img"
      aria-label={
        selected < 0
          ? t("teamTactics.levelUnknown")
          : t("teamTactics.level", { value: selected + 1, count })
      }
    >
      {Array.from({ length: count }, (_, index) => (
        <span key={index} data-selected={selected === index} />
      ))}
    </span>
  )
}

export function InstructionGrid({
  count,
  children,
}: {
  count: number
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width),
        height = Math.round(entry.contentRect.height)
      setSize((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height }
      )
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const grid = instructionGrid(count, size.width, size.height)
  return (
    <div
      ref={ref}
      className="formation-focus-instruction-grid"
      data-compact-instructions
      style={
        size.width > 0 && size.height > 0
          ? {
              gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))`,
            }
          : undefined
      }
    >
      {children}
    </div>
  )
}

/** Fit the actual instruction count; reserve three text/bar rows and give the icon the remaining space. */
function instructionGrid(count: number, width: number, height: number) {
  if (
    count < 1 ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    return { columns: 1, rows: 1 }
  let best = { columns: 1, rows: count }
  let score = -Infinity
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns)
    const cardWidth = (width - (columns - 1) * 4) / columns
    const cardHeight = (height - (rows - 1) * 4) / rows
    const icon = Math.max(0, Math.min(cardWidth - 8, (cardHeight - 34) * 1.7))
    const occupancy = count / (columns * rows)
    const candidate = icon * occupancy * Math.min(1, cardWidth / 48)
    if (candidate > score) {
      best = { columns, rows }
      score = candidate
    }
  }
  return best
}

export function TacticalIcon({
  name,
  className,
}: {
  name?: TacticalIconName | null
  className?: string
}) {
  const [failedUrl, setFailedUrl] = useState<string>()
  const icon = name ? tacticalIcon(name) : undefined
  return (
    <span aria-hidden="true" className={cn("tactics-icon", className)}>
      {icon && failedUrl !== icon.url ? (
        <img
          src={icon.url}
          width={icon.width}
          height={icon.height}
          alt=""
          draggable={false}
          onError={() => setFailedUrl(icon.url)}
        />
      ) : (
        <HugeiconsIcon icon={FootballPitchIcon} size={24} strokeWidth={1.3} />
      )}
    </span>
  )
}
