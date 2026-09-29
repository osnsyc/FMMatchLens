import { useEffect, useRef, useState } from "react"
import type { TooltipRenderProps } from "react-joyride"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Kbd } from "@/components/ui/kbd"
import { cn } from "@/lib/utils"
import type { ExploreTourStepData } from "./exploreTourSteps"
import {
  exploreTourPromptEventName,
  type ExploreTourPrompt,
} from "./exploreTourEvents"

const shortcutByStep: Partial<Record<ExploreTourStepData["id"], string>> = {
  "zen-mode": "Z",
}

export function ExploreTourTooltip({
  backProps,
  closeProps,
  index,
  isLastStep,
  primaryProps,
  size,
  step,
  tooltipProps,
}: TooltipRenderProps) {
  const { t } = useTranslation()
  const data = step.data as ExploreTourStepData
  const shortcut = shortcutByStep[data.id]
  const [storedPrompt, setPrompt] = useState<ExploreTourPrompt>()
  const [attention, setAttention] = useState(false)
  const attentionTimerRef = useRef<number | undefined>(undefined)
  const prompt = storedPrompt?.stepId === data.id ? storedPrompt : undefined

  useEffect(() => {
    const updatePrompt = (event: Event) => {
      const next = (event as CustomEvent<ExploreTourPrompt>).detail
      if (next.stepId !== data.id) return
      setPrompt(next)
      setAttention(true)
      window.clearTimeout(attentionTimerRef.current)
      attentionTimerRef.current = window.setTimeout(() => setAttention(false), 180)
    }
    window.addEventListener(exploreTourPromptEventName, updatePrompt)
    return () => {
      window.clearTimeout(attentionTimerRef.current)
      window.removeEventListener(exploreTourPromptEventName, updatePrompt)
    }
  }, [data.id])

  const body = prompt?.body ?? step.content
  const action = prompt?.action ?? data.action

  return (
    <Card
      {...tooltipProps}
      data-tour-tooltip
      className={cn(
        "max-h-[calc(100dvh-1.5rem)] w-[min(20rem,calc(100vw-1.5rem))] gap-0 overflow-hidden rounded-xl border border-border bg-popover py-0 text-popover-foreground shadow-2xl transition-transform duration-150 ease-out",
        attention && "translate-x-1"
      )}
    >
      <CardHeader className="flex grid-cols-none grid-rows-none items-center justify-between gap-3 border-b border-border/70 px-3.5 py-2.5">
        <h2 className="text-sm font-semibold">{step.title}</h2>
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{index + 1} / {size}</span>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3.5 py-2.5 text-xs leading-relaxed">
        <div>{body}</div>
        {action && (
          <div className="flex items-center gap-2 rounded-md bg-primary/10 px-2.5 py-2 font-medium text-foreground">
            {shortcut && <Kbd>{shortcut}</Kbd>}
            <span>{action}</span>
          </div>
        )}
      </CardContent>
      <CardFooter className="gap-2 border-t border-border/70 px-3 py-2.5">
        <Button size="sm" variant="ghost" {...closeProps}>{t("exploreTour.controls.exit")}</Button>
        <span className="flex-1" />
        {index > 0 && <Button size="sm" variant="ghost" {...backProps}>{t("exploreTour.controls.back")}</Button>}
        <Button size="sm" {...primaryProps}>
          {isLastStep
            ? t("exploreTour.controls.close")
            : data.interactive
              ? t("exploreTour.controls.next")
              : t("exploreTour.controls.start")}
        </Button>
      </CardFooter>
    </Card>
  )
}
