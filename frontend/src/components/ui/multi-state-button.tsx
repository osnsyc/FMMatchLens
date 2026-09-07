"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"

type ButtonClickEvent = Parameters<
  NonNullable<React.ComponentProps<typeof Button>["onClick"]>
>[0]

export interface MultiStateButtonOption<T extends string = string> {
  /**
   * Unique value for this state.
   */
  value: T

  /**
   * Content displayed by the button and context menu.
   */
  label: React.ReactNode

  /** Optional compact button content. The context menu still uses `label`. */
  buttonLabel?: React.ReactNode

  /**
   * Optional state icon.
   */
  icon?: React.ReactNode

  /**
   * Whether this state is disabled.
   *
   * - Disabled states are skipped when cycling.
   * - Disabled states cannot be selected from the context menu.
   */
  disabled?: boolean
}

export type MultiStateButtonProps<T extends string = string> = Omit<
  React.ComponentProps<typeof Button>,
  "value" | "onChange" | "children"
> & {
  /**
   * Available states in left-click cycle order.
   */
  states: MultiStateButtonOption<T>[]

  /**
   * Currently selected state.
   */
  value: T

  /**
   * Called when the selected state changes.
   */
  onValueChange: (value: T) => void

  /**
   * Whether to display the state icon.
   *
   * @default true
   */
  showIcon?: boolean

  /**
   * Whether to display the state label.
   *
   * @default true
   */
  showLabel?: boolean

  /**
   * Context menu alignment.
   *
   * @default "start"
   */
  contextMenuAlign?: "start" | "center" | "end"

  /**
   * Class name used to control the context menu width.
   *
   * @default "min-w-40"
   */
  contextMenuClassName?: string
}

/**
 * MultiStateButton
 *
 * A button that switches between multiple states:
 *
 * - Left click: cycle through the `states` array.
 * - Right click: select a state directly from the context menu.
 *
 * Example:
 *
 * <MultiStateButton
 *   value={mode}
 *   onValueChange={setMode}
 *   states={[
 *     { value: "all", label: "All" },
 *     { value: "success", label: "Successful" },
 *     { value: "failed", label: "Failed" },
 *   ]}
 * />
 */
export function MultiStateButton<T extends string = string>({
  states,
  value,
  onValueChange,
  showIcon = true,
  showLabel = true,
  contextMenuAlign = "start",
  contextMenuClassName = "min-w-40",
  disabled,
  onClick,
  ...buttonProps
}: MultiStateButtonProps<T>) {
  const currentState = React.useMemo(
    () => states.find((state) => state.value === value),
    [states, value]
  )

  const cycleState = React.useCallback(() => {
    if (disabled || states.length === 0) {
      return
    }

    const enabledStates = states.filter((state) => !state.disabled)

    if (enabledStates.length <= 1) {
      return
    }

    const currentIndex = enabledStates.findIndex(
      (state) => state.value === value
    )

    // Fall back to the first enabled state when the current value is invalid.
    if (currentIndex === -1) {
      onValueChange(enabledStates[0].value)
      return
    }

    const nextIndex = (currentIndex + 1) % enabledStates.length
    onValueChange(enabledStates[nextIndex].value)
  }, [disabled, states, value, onValueChange])

  const handleClick = React.useCallback(
    (event: ButtonClickEvent) => {
      onClick?.(event)

      // Respect an external onClick handler that prevents the default action.
      if (event.defaultPrevented) {
        return
      }

      cycleState()
    },
    [onClick, cycleState]
  )

  if (states.length === 0) {
    return null
  }

  const buttonContent = (
    <>
      {showIcon && currentState?.icon}
      {showLabel && (
        <span className="truncate">
          {currentState?.buttonLabel ?? currentState?.label ?? String(value)}
        </span>
      )}
    </>
  )

  return (
    <ContextMenu disabled={disabled}>
      <ContextMenuTrigger
        render={
          <Button
            {...buttonProps}
            type={buttonProps.type ?? "button"}
            disabled={disabled}
            onClick={handleClick}
            aria-label={
              buttonProps["aria-label"] ??
              (typeof currentState?.label === "string"
                ? currentState.label
                : undefined)
            }
          />
        }
      >
        {buttonContent}
      </ContextMenuTrigger>

      <ContextMenuContent
        align={contextMenuAlign}
        className={contextMenuClassName}
      >
        <ContextMenuRadioGroup
          value={value}
          onValueChange={(nextValue) => {
            const nextState = states.find((state) => state.value === nextValue)

            if (!nextState || nextState.disabled) {
              return
            }

            onValueChange(nextState.value)
          }}
        >
          {states.map((state) => (
            <ContextMenuRadioItem
              key={state.value}
              value={state.value}
              disabled={state.disabled}
              closeOnClick={false}
            >
              {state.icon && (
                <span className="mr-2 flex size-4 shrink-0 items-center justify-center">
                  {state.icon}
                </span>
              )}

              <span>{state.label}</span>
            </ContextMenuRadioItem>
          ))}
        </ContextMenuRadioGroup>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export default MultiStateButton
