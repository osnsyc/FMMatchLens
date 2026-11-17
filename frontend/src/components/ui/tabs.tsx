"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"
import { motion, MotionConfig } from "framer-motion"
import { createContext, useContext, useId, useState } from "react"
import { cn } from "@/lib/utils"

const TabsContext = createContext<{
  layoutId: string
  activeValue: unknown
} | null>(null)

function Tabs({
  className,
  orientation = "horizontal",
  value,
  defaultValue,
  onValueChange,
  ...props
}: TabsPrimitive.Root.Props) {
  const layoutId = useId()
  const [internalValue, setInternalValue] = useState(defaultValue ?? 0)
  const activeValue = value === undefined ? internalValue : value

  return (
    <MotionConfig reducedMotion="user">
      <TabsContext.Provider value={{ layoutId, activeValue }}>
        <TabsPrimitive.Root
          data-slot="tabs"
          orientation={orientation}
          value={value}
          defaultValue={defaultValue}
          onValueChange={(nextValue, details) => {
            onValueChange?.(nextValue, details)
            if (!details.isCanceled && value === undefined)
              setInternalValue(nextValue)
          }}
          className={cn(
            "group/tabs flex gap-2 data-horizontal:flex-col",
            className
          )}
          {...props}
        />
      </TabsContext.Provider>
    </MotionConfig>
  )
}

const tabsListVariants = cva(
  "group/tabs-list relative inline-flex w-fit items-center justify-center gap-0.5 rounded-[var(--radius-control)] border border-border/70 bg-muted/35 p-0.5 text-muted-foreground shadow-inner group-data-horizontal/tabs:h-6 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col",
  {
    variants: {
      variant: {
        default: "",
        line: "gap-1 rounded-none border-transparent bg-transparent shadow-none",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  children,
  value,
  ...props
}: TabsPrimitive.Tab.Props) {
  const tabs = useContext(TabsContext)
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      value={value}
      className={cn(
        "relative z-10 inline-flex h-5 flex-1 items-center justify-center gap-1 rounded-[var(--radius-control)] border border-transparent px-2 py-0 text-[10px] leading-none font-medium whitespace-nowrap text-muted-foreground transition-colors group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start group-data-vertical/tabs:py-1 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 data-active:bg-transparent data-active:text-foreground data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3",
        className
      )}
      {...props}
    >
      {tabs && tabs.activeValue === value && (
        <motion.span
          data-slot="tabs-indicator"
          aria-hidden="true"
          layoutId={tabs.layoutId}
          className="pointer-events-none absolute inset-0 z-[-1] rounded-[var(--radius-control)] border border-primary/25 bg-primary/15 shadow-sm"
          transition={{ type: "spring", duration: 0.32, bounce: 0.1 }}
        />
      )}
      {children}
    </TabsPrimitive.Tab>
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-xs/relaxed outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }

export interface NativeTabsProps {
  items: {
    id: string
    label: string
    content: React.ReactNode
  }[]
  defaultValue?: string
  value?: string
  onValueChange?: (value: string) => void
  className?: string
  listClassName?: string
  triggerClassName?: string
  renderContent?: boolean
}

export function NativeTabs({
  items,
  defaultValue,
  value,
  onValueChange,
  className,
  listClassName,
  triggerClassName,
  renderContent = true,
}: NativeTabsProps) {
  const [internalActiveTab, setInternalActiveTab] = useState(
    defaultValue ?? items[0]?.id ?? ""
  )
  const [direction, setDirection] = useState(1)
  const activeTab = value ?? internalActiveTab

  const handleValueChange = (value: string) => {
    const oldIndex = items.findIndex((item) => item.id === activeTab)
    const newIndex = items.findIndex((item) => item.id === value)
    setDirection(newIndex >= oldIndex ? 1 : -1)
    setInternalActiveTab(value)
    onValueChange?.(value)
  }

  if (items.length === 0) return null

  return (
    <Tabs
      value={activeTab}
      onValueChange={handleValueChange}
      className={cn("w-full max-w-md", className)}
    >
      <TabsList className={cn("flex w-full", listClassName)}>
        {items.map((tab) => {
          return (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              className={triggerClassName}
            >
              {tab.label}
            </TabsTrigger>
          )
        })}
      </TabsList>
      {renderContent &&
        items.map((item) => (
          <TabsContent
            key={item.id}
            value={item.id}
            className="mt-2 overflow-hidden rounded-lg border bg-background p-4 shadow-sm"
          >
            <motion.div
              initial={{ opacity: 0, x: direction * 10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            >
              {item.content}
            </motion.div>
          </TabsContent>
        ))}
    </Tabs>
  )
}
