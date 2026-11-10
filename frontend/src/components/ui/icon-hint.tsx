import type { HTMLAttributes } from "react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/** A separate hover target for each small marker, independent of the player role preview. */
export function IconHint({
  label,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span {...props} role="img" aria-label={label} />}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent sideOffset={5} className="max-w-72 text-[11px]">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
