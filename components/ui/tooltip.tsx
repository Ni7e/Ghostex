import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"
import * as React from "react"

import { cn } from "../../lib/utils"
import { tooltipSurfaceStyle } from "./overlay-surface"

function TooltipProvider({
  delayDuration,
  delay = 0,
  ...props
}: TooltipPrimitive.Provider.Props & {
  delayDuration?: number
}) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delay={delayDuration ?? delay}
      {...props}
    />
  )
}

function Tooltip({
  onOpenChange,
  ...props
}: Omit<TooltipPrimitive.Root.Props, "onOpenChange"> & {
  onOpenChange?: (open: boolean) => void
}) {
  return (
    <TooltipPrimitive.Root
      data-slot="tooltip"
      onOpenChange={
        onOpenChange ? (open) => onOpenChange(open) : undefined
      }
      {...props}
    />
  )
}

function TooltipTrigger({
  ...props
}: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  side = "bottom",
  sideOffset = 0,
  align = "center",
  alignOffset = 0,
  collisionPadding,
  children,
  style,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<
    TooltipPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  > & {
    collisionPadding?: number
  }) {
  return (
    <TooltipPrimitive.Portal>
      {/*
       * CDXC:SidebarTooltips 2026-06-30-02:02:
       * macOS sidebar tooltip surfaces must stay outside pointer hit testing.
       * Hover over the label must not keep it shown, wheel events should pass
       * through to underlying scroll containers, and clicks should land on the
       * controls below the tooltip.
       */}
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className="pointer-events-none isolate z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "pointer-events-none z-50 inline-block w-fit origin-(--transform-origin) whitespace-pre-line rounded-none px-3 py-1.5 text-xs [overflow-wrap:anywhere] has-data-[slot=kbd]:pr-1.5 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-none data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          style={{
            ...tooltipSurfaceStyle,
            maxWidth: "min(90vw, var(--available-width, 90vw))",
            zIndex: "var(--ghostex-tooltip-z-index, 1400)",
            ...style,
          }}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
