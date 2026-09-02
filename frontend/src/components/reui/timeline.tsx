import { createContext, useCallback, useContext, useState } from "react"
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"

import { cn } from "@/lib/utils"

// Types
type TimelineContextValue = {
  activeStep: number
  setActiveStep: (step: number) => void
}

// Context
const TimelineContext = createContext<TimelineContextValue | undefined>(
  undefined
)

const useTimeline = () => {
  const context = useContext(TimelineContext)
  if (!context) {
    throw new Error("useTimeline must be used within a Timeline")
  }
  return context
}

// Components
interface TimelineProps extends useRender.ComponentProps<"div"> {
  defaultValue?: number
  value?: number
  onValueChange?: (value: number) => void
  orientation?: "horizontal" | "vertical"
}

function Timeline({
  defaultValue = 1,
  value,
  onValueChange,
  orientation = "vertical",
  className,
  render,
  children,
  ...props
}: TimelineProps) {
  const [activeStep, setInternalStep] = useState(defaultValue)

  const setActiveStep = useCallback(
    (step: number) => {
      if (value === undefined) {
        setInternalStep(step)
      }
      onValueChange?.(step)
    },
    [value, onValueChange]
  )

  const currentStep = value ?? activeStep

  const defaultProps = {
    className: cn(
      "group/timeline flex data-[orientation=horizontal]:w-full data-[orientation=horizontal]:flex-row data-[orientation=vertical]:flex-col",
      className
    ),
    "data-orientation": orientation,
    "data-slot": "timeline",
    children,
  }

  return (
    <TimelineContext.Provider
      value={{ activeStep: currentStep, setActiveStep }}
    >
      {useRender({
        defaultTagName: "div",
        render,
        props: mergeProps<"div">(defaultProps, props),
      })}
    </TimelineContext.Provider>
  )
}

// TimelineContent
function TimelineContent({
  className,
  render,
  children,
  ...props
}: useRender.ComponentProps<"div">) {
  const defaultProps = {
    className: cn("text-muted-foreground text-sm", className),
    "data-slot": "timeline-content",
    children,
  }

  return useRender({
    defaultTagName: "div",
    render,
    props: mergeProps<"div">(defaultProps, props),
  })
}

// TimelineTime
type TimelineTimeProps = useRender.ComponentProps<"button">

function TimelineTime({
  className,
  render,
  children,
  ...props
}: TimelineTimeProps) {
  const defaultProps = {
    className: cn(
      "mb-1 block cursor-pointer rounded-sm font-medium text-muted-foreground text-xs outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 group-data-[orientation=vertical]/timeline:max-sm:h-4",
      className
    ),
    "data-slot": "timeline-time",
    type: "button" as const,
    children,
  }

  return useRender({
    defaultTagName: "button",
    render,
    props: mergeProps<"button">(defaultProps, props),
  })
}

// TimelineHeader
function TimelineHeader({
  className,
  render,
  children,
  ...props
}: useRender.ComponentProps<"div">) {
  const defaultProps = {
    className: cn(className),
    "data-slot": "timeline-header",
    children,
  }

  return useRender({
    defaultTagName: "div",
    render,
    props: mergeProps<"div">(defaultProps, props),
  })
}

// TimelineIndicator
type TimelineIndicatorProps = useRender.ComponentProps<"button">

function TimelineIndicator({
  className,
  children,
  render,
  ...props
}: TimelineIndicatorProps) {
  const defaultProps = {
    className: cn(
      "group-data-[orientation=horizontal]/timeline:-top-6 group-data-[orientation=horizontal]/timeline:-translate-y-1/2 group-data-[orientation=vertical]/timeline:-left-6 group-data-[orientation=vertical]/timeline:-translate-x-1/2 absolute size-3 cursor-pointer rounded-full border-2 border-primary/20 outline-none transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-ring/50 group-data-[orientation=vertical]/timeline:top-0 group-data-[orientation=horizontal]/timeline:left-0 group-data-completed/timeline-item:border-primary",
      className
    ),
    "data-slot": "timeline-indicator",
    type: "button" as const,
    children,
  }

  return useRender({
    defaultTagName: "button",
    render,
    props: mergeProps<"button">(defaultProps, props),
  })
}

// TimelineItem
interface TimelineItemProps extends useRender.ComponentProps<"div"> {
  step: number
}

function TimelineItem({
  step,
  className,
  render,
  children,
  ...props
}: TimelineItemProps) {
  const { activeStep } = useTimeline()

  const defaultProps = {
    className: cn(
      "group/timeline-item relative flex flex-1 flex-col gap-0.5 group-data-[orientation=vertical]/timeline:ms-8 group-data-[orientation=horizontal]/timeline:mt-8 group-data-[orientation=horizontal]/timeline:not-last:pe-8 group-data-[orientation=vertical]/timeline:not-last:pb-6",
      className
    ),
    "data-active": step === activeStep || undefined,
    "data-completed": step <= activeStep || undefined,
    "data-connector-completed": step < activeStep || undefined,
    "data-slot": "timeline-item",
    children,
  }

  return useRender({
    defaultTagName: "div",
    render,
    props: mergeProps<"div">(defaultProps, props),
  })
}

// TimelineSeparator
function TimelineSeparator({
  className,
  render,
  children,
  ...props
}: useRender.ComponentProps<"div">) {
  const defaultProps = {
    "aria-hidden": true,
    className: cn(
      "group-data-[orientation=horizontal]/timeline:-top-6 group-data-[orientation=horizontal]/timeline:-translate-y-1/2 group-data-[orientation=vertical]/timeline:-left-6 group-data-[orientation=vertical]/timeline:-translate-x-1/2 absolute self-start overflow-hidden bg-primary/10 after:absolute after:inset-0 after:origin-top after:scale-y-0 after:bg-primary after:transition-transform after:[transition-duration:var(--timeline-segment-duration,700ms)] after:content-[''] group-data-[connector-completed=true]/timeline-item:after:scale-y-100 group-last/timeline-item:hidden group-data-[orientation=horizontal]/timeline:h-0.5 group-data-[orientation=vertical]/timeline:h-[calc(100%-0.875rem)] group-data-[orientation=horizontal]/timeline:w-[calc(100%-0.875rem)] group-data-[orientation=vertical]/timeline:w-0.5 group-data-[orientation=horizontal]/timeline:translate-x-3.5 group-data-[orientation=vertical]/timeline:translate-y-3.5",
      className
    ),
    "data-slot": "timeline-separator",
    children,
  }

  return useRender({
    defaultTagName: "div",
    render,
    props: mergeProps<"div">(defaultProps, props),
  })
}

// TimelineTitle
function TimelineTitle({
  className,
  render,
  children,
  ...props
}: useRender.ComponentProps<"h3">) {
  const defaultProps = {
    className: cn("font-medium text-sm", className),
    "data-slot": "timeline-title",
    children,
  }

  return useRender({
    defaultTagName: "h3",
    render,
    props: mergeProps<"h3">(defaultProps, props),
  })
}

export {
  Timeline,
  TimelineContent,
  TimelineTime,
  TimelineHeader,
  TimelineIndicator,
  TimelineItem,
  TimelineSeparator,
  TimelineTitle,
}
