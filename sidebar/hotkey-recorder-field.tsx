import { useEffect, useState } from "react";
import { IconX } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ghostexHotkeyTextFromKeyboardEvent,
  normalizeHotkeyText,
} from "../shared/ghostex-hotkeys";
import { formatSidebarHotkeyLabel } from "./hotkey-label";

export type HotkeyRecorderFieldProps = {
  ariaInvalid?: boolean;
  className?: string;
  hotkey: string;
  id?: string;
  onChange: (hotkey: string) => void;
};

export function HotkeyRecorderField({
  ariaInvalid = false,
  className,
  hotkey,
  id,
  onChange,
}: HotkeyRecorderFieldProps) {
  const [isRecording, setIsRecording] = useState(false);
  const normalizedHotkey = normalizeHotkeyText(hotkey);
  const label = isRecording
    ? "Press Shortcut"
    : formatSidebarHotkeyLabel(normalizedHotkey);

  useEffect(() => {
    if (!isRecording) {
      return;
    }
    const recordPhysicalHotkey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "Escape") {
        setIsRecording(false);
        return;
      }
      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey
      ) {
        setIsRecording(false);
        onChange("");
        return;
      }
      const recordedHotkey = ghostexHotkeyTextFromKeyboardEvent(event);
      if (!recordedHotkey) {
        return;
      }
      /**
       * CDXC:Hotkeys 2026-07-30:
       * Record the physical key (`KeyboardEvent.code`) rather than the
       * Option-modified character (`KeyboardEvent.key`). For example, macOS
       * reports Option+S as `ß`; GPUI dispatches the physical S key, so storing
       * the produced character made the shortcut impossible to run.
       */
      setIsRecording(false);
      onChange(recordedHotkey);
    };
    document.addEventListener("keydown", recordPhysicalHotkey, { capture: true });
    return () => document.removeEventListener("keydown", recordPhysicalHotkey, { capture: true });
  }, [isRecording, onChange]);

  return (
    <div
      data-hotkey-recorder="true"
      data-recording={isRecording ? "true" : undefined}
      className="group/hotkey-recorder relative w-full"
    >
      <Button
        aria-invalid={ariaInvalid}
        className={cn("h-10 w-full justify-start px-3 pr-9 font-mono text-sm", className)}
        id={id}
        onClick={() => {
          setIsRecording((recording) => !recording);
        }}
        type="button"
        variant="outline"
      >
        {label || "Unassigned"}
      </Button>
      {normalizedHotkey ? (
        <Button
          aria-label="Remove hotkey"
          className="pointer-events-none absolute top-1/2 right-1.5 z-10 size-7 -translate-y-1/2 rounded-none border border-border bg-background/95 p-0 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:bg-muted hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/hotkey-recorder:pointer-events-auto group-hover/hotkey-recorder:opacity-100"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setIsRecording(false);
            onChange("");
          }}
          size="icon-xs"
          title="Remove hotkey"
          type="button"
          variant="outline"
        >
          {/* CDXC:Hotkeys 2026-05-11-09:06
              The remove affordance is a real button inside the hotkey field,
              revealed only when that field is hovered or focused so hotkey rows
              stay quiet until the user targets a specific binding. */}
          <IconX aria-hidden="true" className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}
