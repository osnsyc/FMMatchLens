"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { motion, MotionConfig } from "framer-motion";
import { useId, useState } from "react";

interface NativeTabsProps {
  items: {
    id: string;
    label: string;
    content: React.ReactNode;
  }[];
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  className?: string;
  listClassName?: string;
  triggerClassName?: string;
  renderContent?: boolean;
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
  const pillLayoutId = useId();
  const [internalActiveTab, setInternalActiveTab] = useState(defaultValue || items[0].id);
  const [direction, setDirection] = useState(1);
  const activeTab = value ?? internalActiveTab;

  const handleValueChange = (value: string) => {
    const oldIndex = items.findIndex((item) => item.id === activeTab);
    const newIndex = items.findIndex((item) => item.id === value);
    setDirection(newIndex >= oldIndex ? 1 : -1);
    setInternalActiveTab(value);
    onValueChange?.(value);
  };

  return (
    <MotionConfig reducedMotion="user">
      <Tabs
        value={activeTab}
        onValueChange={handleValueChange}
        className={cn("w-full max-w-md", className)}
      >
        <TabsList className={cn("relative flex h-6 w-full items-center gap-0.5 rounded-md border border-border/70 bg-muted/35 p-0.5 shadow-inner", listClassName)}>
          {items.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className={cn("relative z-10 h-5 flex-1 rounded-[5px] px-2 py-0 text-[10px] font-medium leading-none transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-active:bg-transparent data-active:text-foreground data-active:shadow-none", triggerClassName)}
              >
                {isActive && (
                  <motion.div
                    layoutId={pillLayoutId}
                    className="absolute inset-0 z-[-1] rounded-[5px] border border-primary/25 bg-primary/15 shadow-sm"
                    transition={{ type: "spring", duration: 0.32, bounce: 0.1 }}
                  />
                )}
                {tab.label}
              </TabsTrigger>
            );
          })}
        </TabsList>
        {renderContent && items.map((item) => (
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
    </MotionConfig>
  );
}
