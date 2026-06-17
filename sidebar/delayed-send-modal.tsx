import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const MAX_DELAY_MS = 2_147_483_647;
const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;

export type DelayedSendModalProps = {
  delayedSendDeadlineAt?: string;
  delayedSendRemainingLabel?: string;
  isOpen: boolean;
  onCancel: () => void;
  onCancelTimer?: () => void;
  onConfirm: (delayMs: number) => void;
  sessionTitle?: string;
};

/**
 * CDXC:DelayedSend 2026-05-11-11:56
 * Terminal pins need a clock action that lets the user stage command text now
 * and submit it later. Keep the modal duration-only: the terminal already owns
 * the prompt text, and native will press Enter when the timer expires.
 *
 * CDXC:DelayedSend 2026-05-17-03:14
 * Reopening Delayed Send for an active timer must show the current remaining
 * countdown, prefill the duration controls from that remaining time, and allow
 * cancellation so users can verify or change the pending Enter keypress.
 *
 * CDXC:DelayedSend 2026-06-16-17:57:
 * Users should configure delayed-send timers only in whole hours and minutes.
 * Round active remaining deadlines up to the next whole minute when prefilling
 * so editing an existing timer cannot silently shorten a sub-minute remainder
 * and seconds never reappear as an input.
 *
 * CDXC:DelayedSend 2026-06-17-17:01:
 * The minutes field is the primary edit target now that seconds are gone.
 * Focus and select it through the dialog's open focus path and the native
 * WebView frame settle pass so opening the timer is immediately type-to-replace.
 */
export function DelayedSendModal({
  delayedSendDeadlineAt,
  delayedSendRemainingLabel,
  isOpen,
  onCancel,
  onCancelTimer,
  onConfirm,
  sessionTitle,
}: DelayedSendModalProps) {
  const [hours, setHours] = useState("0");
  const [minutes, setMinutes] = useState("5");
  const hoursInputId = useId();
  const minutesInputId = useId();
  const minutesInputRef = useRef<HTMLInputElement>(null);
  const focusMinutesInput = useCallback(() => {
    minutesInputRef.current?.focus();
    minutesInputRef.current?.select();
  }, []);
  const handleOpenAutoFocus = useCallback(
    (event: { preventDefault: () => void }) => {
      event.preventDefault();
      focusMinutesInput();
    },
    [focusMinutesInput],
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const remainingMs = getRemainingMs(delayedSendDeadlineAt);
    const duration = remainingMs > 0 ? durationPartsFromMs(remainingMs) : undefined;
    setHours(String(duration?.hours ?? 0));
    setMinutes(String(duration?.minutes ?? 5));
    const animationFrame = window.requestAnimationFrame(() => {
      /*
       * CDXC:DelayedSend 2026-05-21-12:21:
       * Opening or editing Delayed Send should select the minutes field, not
       * merely place a caret there, so typing immediately replaces the common
       * duration value without requiring Cmd+A or manual deletion.
       */
      focusMinutesInput();
    });
    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [delayedSendDeadlineAt, focusMinutesInput, isOpen]);

  if (!isOpen) {
    return null;
  }

  const delayMs = getDelayMs(hours, minutes);
  const isValidDelay = delayMs >= MINUTE_MS && delayMs <= MAX_DELAY_MS;
  const hasActiveTimer = Boolean(delayedSendRemainingLabel);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isValidDelay) {
      return;
    }
    onConfirm(delayMs);
  };

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onCancel();
        }
      }}
      open={isOpen}
    >
      <DialogContent
        className="command-config-modal-shadcn delayed-send-modal-shadcn font-sans"
        onOpenAutoFocus={handleOpenAutoFocus}
        showCloseButton={false}
      >
        <form className="delayed-send-form" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle className="text-xl">Delayed Send</DialogTitle>
            <DialogDescription>
              Press Enter in {sessionTitle?.trim() || "this terminal"} after this delay.
              {delayedSendRemainingLabel ? (
                <>
                  <br />
                  Current timer sends in {delayedSendRemainingLabel}.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="delayed-send-field-group">
            <div className="delayed-send-duration-grid">
              <Field>
                <FieldLabel htmlFor={hoursInputId}>Hours</FieldLabel>
                <Input
                  aria-label="Hours"
                  id={hoursInputId}
                  min={0}
                  onChange={(event) => setHours(event.currentTarget.value)}
                  step={1}
                  type="number"
                  value={hours}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={minutesInputId}>Minutes</FieldLabel>
                <Input
                  aria-label="Minutes"
                  autoFocus
                  id={minutesInputId}
                  min={0}
                  onChange={(event) => setMinutes(event.currentTarget.value)}
                  onFocus={(event) => event.currentTarget.select()}
                  ref={minutesInputRef}
                  step={1}
                  type="number"
                  value={minutes}
                />
              </Field>
            </div>
            <FieldDescription>Enter a delay between 1 minute and 24 days.</FieldDescription>
          </FieldGroup>
          <DialogFooter>
            {hasActiveTimer ? (
              <Button onClick={onCancelTimer} type="button" variant="destructive">
                Cancel Timer
              </Button>
            ) : null}
            <Button onClick={onCancel} type="button" variant="outline">
              Cancel
            </Button>
            <Button disabled={!isValidDelay} type="submit">
              Set Timer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function getDelayMs(hours: string, minutes: string): number {
  return parseDurationPart(hours) * HOUR_MS + parseDurationPart(minutes) * MINUTE_MS;
}

function parseDurationPart(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    return Number.NaN;
  }
  return parsed;
}

function getRemainingMs(deadlineAt: string | undefined): number {
  if (!deadlineAt) {
    return 0;
  }
  const deadlineMs = Date.parse(deadlineAt);
  if (!Number.isFinite(deadlineMs)) {
    return 0;
  }
  return Math.max(0, deadlineMs - Date.now());
}

function durationPartsFromMs(delayMs: number): { hours: number; minutes: number } {
  const totalMinutes = Math.max(1, Math.ceil(delayMs / MINUTE_MS));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return { hours, minutes };
}
