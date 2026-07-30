import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
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
  onConfirm: (
    delayMs: number,
    sendWhenAgentStops: boolean,
    sendWhenAllProjectSessionsStop: boolean,
  ) => void;
  onToggleCloseAfterDone: () => void;
  sendWhenAllProjectSessionsStopActive?: boolean;
  sendWhenAgentStopsActive?: boolean;
  sessionTitle?: string;
  supportsSendWhenAgentStops?: boolean;
  supportsSendWhenAllProjectSessionsStop?: boolean;
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
 *
 * CDXC:DelayedSend 2026-06-18-11:08:
 * The native child window can become key after React's first focus pass, so
 * retry minutes focus over the first few animation frames/timeouts. Pressing
 * Enter while editing the duration must schedule the timer immediately.
 *
 * CDXC:DelayedSend 2026-06-19-14:24:
 * The duration controls should not include helper copy. When a timer is active,
 * keep Cancel Timer inside the dialog by sharing the bottom cancel row; without
 * an active timer, Cancel remains the only full-width action in that row.
 */
export function DelayedSendModal({
  delayedSendDeadlineAt,
  delayedSendRemainingLabel,
  isOpen,
  onCancel,
  onCancelTimer,
  onConfirm,
  onToggleCloseAfterDone,
  sendWhenAllProjectSessionsStopActive = false,
  sendWhenAgentStopsActive = false,
  sessionTitle,
  supportsSendWhenAgentStops = false,
  supportsSendWhenAllProjectSessionsStop = false,
}: DelayedSendModalProps) {
  const [hours, setHours] = useState("0");
  const [minutes, setMinutes] = useState("5");
  const [sendWhenAgentStops, setSendWhenAgentStops] = useState(sendWhenAgentStopsActive);
  const [sendWhenAllProjectSessionsStop, setSendWhenAllProjectSessionsStop] = useState(
    sendWhenAllProjectSessionsStopActive,
  );
  const hoursInputId = useId();
  const minutesInputId = useId();
  const sendWhenAgentStopsId = useId();
  const sendWhenAllProjectSessionsStopId = useId();
  const minutesInputRef = useRef<HTMLInputElement>(null);
  const focusRetryTimeoutIdsRef = useRef<number[]>([]);
  const focusRetryAnimationFrameIdsRef = useRef<number[]>([]);
  const focusMinutesInput = useCallback(() => {
    const input = minutesInputRef.current;
    if (!input) {
      return;
    }
    input.focus({ preventScroll: true });
    input.select();
  }, []);
  const clearScheduledMinutesFocus = useCallback(() => {
    for (const timeoutId of focusRetryTimeoutIdsRef.current) {
      window.clearTimeout(timeoutId);
    }
    for (const animationFrameId of focusRetryAnimationFrameIdsRef.current) {
      window.cancelAnimationFrame(animationFrameId);
    }
    focusRetryTimeoutIdsRef.current = [];
    focusRetryAnimationFrameIdsRef.current = [];
  }, []);
  const scheduleMinutesFocus = useCallback(() => {
    clearScheduledMinutesFocus();
    focusMinutesInput();
    const firstAnimationFrameId = window.requestAnimationFrame(() => {
      focusMinutesInput();
      const secondAnimationFrameId = window.requestAnimationFrame(focusMinutesInput);
      focusRetryAnimationFrameIdsRef.current.push(secondAnimationFrameId);
    });
    focusRetryAnimationFrameIdsRef.current.push(firstAnimationFrameId);
    for (const delayMs of [25, 75, 150, 300]) {
      const timeoutId = window.setTimeout(focusMinutesInput, delayMs);
      focusRetryTimeoutIdsRef.current.push(timeoutId);
    }
  }, [clearScheduledMinutesFocus, focusMinutesInput]);
  const handleOpenAutoFocus = useCallback(
    (event: { preventDefault: () => void }) => {
      event.preventDefault();
      if (!sendWhenAgentStops && !sendWhenAllProjectSessionsStop) {
        scheduleMinutesFocus();
      }
    },
    [scheduleMinutesFocus, sendWhenAgentStops, sendWhenAllProjectSessionsStop],
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const remainingMs = getRemainingMs(delayedSendDeadlineAt);
    const duration = remainingMs > 0 ? durationPartsFromMs(remainingMs) : undefined;
    setHours(String(duration?.hours ?? 0));
    setMinutes(String(duration?.minutes ?? 5));
    const shouldSendWhenAllProjectSessionsStop =
      supportsSendWhenAllProjectSessionsStop && sendWhenAllProjectSessionsStopActive;
    const shouldSendWhenAgentStops =
      !shouldSendWhenAllProjectSessionsStop &&
      supportsSendWhenAgentStops &&
      sendWhenAgentStopsActive;
    setSendWhenAgentStops(shouldSendWhenAgentStops);
    setSendWhenAllProjectSessionsStop(shouldSendWhenAllProjectSessionsStop);
    /*
     * CDXC:DelayedSend 2026-05-21-12:21:
     * Opening or editing Delayed Send should select the minutes field, not
     * merely place a caret there, so typing immediately replaces the common
     * duration value without requiring Cmd+A or manual deletion.
     */
    if (shouldSendWhenAgentStops || shouldSendWhenAllProjectSessionsStop) {
      clearScheduledMinutesFocus();
    } else {
      scheduleMinutesFocus();
    }
    return () => {
      clearScheduledMinutesFocus();
    };
  }, [
    clearScheduledMinutesFocus,
    delayedSendDeadlineAt,
    isOpen,
    scheduleMinutesFocus,
    sendWhenAllProjectSessionsStopActive,
    sendWhenAgentStopsActive,
    supportsSendWhenAllProjectSessionsStop,
    supportsSendWhenAgentStops,
  ]);

  if (!isOpen) {
    return null;
  }

  const delayMs = getDelayMs(hours, minutes);
  const isValidDelay = delayMs >= MINUTE_MS && delayMs <= MAX_DELAY_MS;
  const hasStatusTrigger = sendWhenAgentStops || sendWhenAllProjectSessionsStop;
  const isValidSchedule = hasStatusTrigger || isValidDelay;
  const hasActiveTimer = Boolean(delayedSendRemainingLabel);
  const trimmedSessionTitle = sessionTitle?.trim();
  const sessionLabel = trimmedSessionTitle
    ? `"${trimmedSessionTitle}" agent session`
    : "this agent session";

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isValidSchedule) {
      return;
    }
    onConfirm(delayMs, sendWhenAgentStops, sendWhenAllProjectSessionsStop);
  };
  const submitFromDurationInput = (event: KeyboardEvent<HTMLInputElement>) => {
    if (
      event.key !== "Enter" ||
      event.nativeEvent.isComposing ||
      hasStatusTrigger ||
      !isValidDelay
    ) {
      return;
    }
    event.preventDefault();
    onConfirm(delayMs, false, false);
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
            <DialogTitle className="text-xl">Delayed Actions</DialogTitle>
            <DialogDescription>
              {sendWhenAllProjectSessionsStop
                ? `Press Enter in ${sessionLabel} after all agents in this project have finished working for 10 seconds.`
                : sendWhenAgentStops
                  ? `Press Enter in ${sessionLabel} after the agent has finished working for 10 seconds.`
                  : `Press Enter in ${sessionLabel} after this delay.`}
              {delayedSendRemainingLabel ? (
                <>
                  <br />
                  {sendWhenAllProjectSessionsStopActive
                    ? "Send when all agents finish working is active."
                    : sendWhenAgentStopsActive
                      ? "Send when agent finishes working is active."
                      : `Current timer sends in ${delayedSendRemainingLabel}.`}
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="delayed-send-field-group">
            <div className="delayed-send-duration-grid">
              <Field data-disabled={hasStatusTrigger || undefined}>
                <FieldLabel htmlFor={hoursInputId}>Hours</FieldLabel>
                <Input
                  aria-label="Hours"
                  disabled={hasStatusTrigger}
                  id={hoursInputId}
                  min={0}
                  onChange={(event) => setHours(event.currentTarget.value)}
                  onKeyDown={submitFromDurationInput}
                  step={1}
                  type="number"
                  value={hours}
                />
              </Field>
              <Field data-disabled={hasStatusTrigger || undefined}>
                <FieldLabel htmlFor={minutesInputId}>Minutes</FieldLabel>
                <Input
                  aria-label="Minutes"
                  autoFocus={!hasStatusTrigger}
                  disabled={hasStatusTrigger}
                  id={minutesInputId}
                  min={0}
                  onChange={(event) => setMinutes(event.currentTarget.value)}
                  onFocus={(event) => event.currentTarget.select()}
                  onKeyDown={submitFromDurationInput}
                  ref={minutesInputRef}
                  step={1}
                  type="number"
                  value={minutes}
                />
              </Field>
            </div>
            {supportsSendWhenAgentStops || supportsSendWhenAllProjectSessionsStop ? (
              <FieldSet className="gap-3">
                <FieldLegend className="sr-only">Send trigger</FieldLegend>
                <FieldGroup data-slot="checkbox-group">
                  {supportsSendWhenAgentStops ? (
                    <Field orientation="horizontal">
                      <Checkbox
                        checked={sendWhenAgentStops}
                        id={sendWhenAgentStopsId}
                        onCheckedChange={(checked) => {
                          setSendWhenAgentStops(checked);
                          if (checked) {
                            setSendWhenAllProjectSessionsStop(false);
                            clearScheduledMinutesFocus();
                          } else {
                            window.requestAnimationFrame(scheduleMinutesFocus);
                          }
                        }}
                      />
                      <FieldLabel htmlFor={sendWhenAgentStopsId}>
                        Send when agent finishes working
                      </FieldLabel>
                    </Field>
                  ) : null}
                  {supportsSendWhenAllProjectSessionsStop ? (
                    <Field orientation="horizontal">
                      <Checkbox
                        checked={sendWhenAllProjectSessionsStop}
                        id={sendWhenAllProjectSessionsStopId}
                        onCheckedChange={(checked) => {
                          setSendWhenAllProjectSessionsStop(checked);
                          if (checked) {
                            setSendWhenAgentStops(false);
                            clearScheduledMinutesFocus();
                          } else {
                            window.requestAnimationFrame(scheduleMinutesFocus);
                          }
                        }}
                      />
                      <FieldLabel htmlFor={sendWhenAllProjectSessionsStopId}>
                        Send when all agents finish working
                      </FieldLabel>
                    </Field>
                  ) : null}
                </FieldGroup>
              </FieldSet>
            ) : null}
          </FieldGroup>
          <FieldSet className="gap-3">
            <FieldLegend>Session actions</FieldLegend>
            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div className="min-w-0">
                <div className="text-sm font-medium">Close After Done</div>
                <div className="text-xs text-muted-foreground">
                  Toggle closing this terminal after it stays Done for 3 minutes.
                </div>
              </div>
              <Button onClick={onToggleCloseAfterDone} type="button" variant="outline">
                Toggle
              </Button>
            </div>
          </FieldSet>
          <DialogFooter className="delayed-send-footer">
            <Button className="delayed-send-action-button" disabled={!isValidSchedule} type="submit">
              {hasStatusTrigger ? "Schedule Send" : "Set Timer"}
            </Button>
            <div
              className="delayed-send-cancel-row"
              data-has-active-timer={hasActiveTimer ? "true" : "false"}
            >
              {hasActiveTimer ? (
                <Button
                  className="delayed-send-action-button"
                  onClick={onCancelTimer}
                  type="button"
                  variant="destructive"
                >
                  Cancel Timer
                </Button>
              ) : null}
              <Button
                className="delayed-send-action-button"
                onClick={onCancel}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
            </div>
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
