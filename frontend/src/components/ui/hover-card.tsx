import { PreviewCard as PreviewCardPrimitive } from "@base-ui/react/preview-card"
import { useState, type ReactNode } from "react"

import { cn } from "@/lib/utils"

function HoverCard({ ...props }: PreviewCardPrimitive.Root.Props) {
  return <PreviewCardPrimitive.Root data-slot="hover-card" {...props} />
}

function HoverCardTrigger({
  delay = 100,
  closeDelay = 100,
  ...props
}: PreviewCardPrimitive.Trigger.Props) {
  return (
    <PreviewCardPrimitive.Trigger
      data-slot="hover-card-trigger"
      delay={delay}
      closeDelay={closeDelay}
      {...props}
    />
  )
}

function HoverCardContent({
  className,
  positionerClassName,
  side = "bottom",
  sideOffset = 4,
  align = "center",
  alignOffset = 4,
  ...props
}: PreviewCardPrimitive.Popup.Props &
  Pick<
    PreviewCardPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  > & {
    positionerClassName?: string
  }) {
  return (
    <PreviewCardPrimitive.Portal data-slot="hover-card-portal">
      <PreviewCardPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className={cn("isolate z-50", positionerClassName)}
      >
        <PreviewCardPrimitive.Popup
          data-slot="hover-card-content"
          className={cn(
            "z-50 w-72 origin-(--transform-origin) rounded-lg bg-foreground p-2.5 text-xs/relaxed text-background shadow-md ring-1 ring-background/15 outline-hidden duration-75 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        />
      </PreviewCardPrimitive.Positioner>
    </PreviewCardPrimitive.Portal>
  )
}

/** A non-button anchor also lets disabled controls expose their hint. */
function HoverCardHint({
  content,
  children,
}: {
  content: ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <HoverCard open={open} onOpenChange={setOpen}>
      <HoverCardTrigger
        render={<span className="inline-flex" />}
        onPointerDownCapture={() => setOpen(false)}
        onKeyDownCapture={(event) => {
          if (event.key === "Enter" || event.key === " ") setOpen(false)
        }}
      >
        {children}
      </HoverCardTrigger>
      <HoverCardContent
        side="bottom"
        sideOffset={6}
        alignOffset={0}
        className="w-auto max-w-72 bg-popover px-2.5 py-1.5 text-xs font-medium text-popover-foreground ring-border"
      >
        {content}
      </HoverCardContent>
    </HoverCard>
  )
}

export { HoverCard, HoverCardTrigger, HoverCardContent, HoverCardHint }
