import { ModelPickerKeyFeedback } from '@/packages/shared/session-chat-presentation/model-picker-feedback';
import { useEffect, useRef, useState } from 'react';

export {
  modelPickerControlForKey,
  type PickerDirection,
  type PickerControl,
} from '@/packages/shared/session-chat-presentation/model-picker-input';
import {
  ModelPickerWheelNavigation,
  type PickerDirection,
  type PickerControl,
} from '@/packages/shared/session-chat-presentation/model-picker-input';

export function useModelPickerKeyFeedback() {
  const [pressed, setPressed] = useState<ReadonlySet<PickerControl>>(() => new Set());
  const [feedback] = useState(() => new ModelPickerKeyFeedback(setPressed));
  useEffect(() => {
    const release = (event: KeyboardEvent) => feedback.release(event.code || event.key);
    const blur = () => feedback.blur();
    window.addEventListener('keyup', release, true);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keyup', release, true);
      window.removeEventListener('blur', blur);
      feedback.dispose();
    };
  }, [feedback]);
  return {
    pressed,
    pulse: (control: PickerControl) => feedback.pulse(control),
    press: (event: KeyboardEvent, control: PickerControl) => feedback.press(event.code || event.key, control),
  };
}

/**
 * CDXC:SessionChat 2026-09-06 DECISION:
 * User: continuously scroll between models vertically and efforts horizontally, without having to stop scrolling between choices.
 * User: slow scrolling by 30%; both the distance threshold and step interval are divided by 0.7.
 * This replaces the one-choice-per-gesture lock; the short step interval limits speed without waiting for silence.
 */
export function useModelPickerWheelNavigation(
  element: HTMLElement | null,
  navigate: (direction: PickerDirection) => void
) {
  const latest = useRef(navigate);
  latest.current = navigate;

  useEffect(() => {
    if (!element) return;
    const navigation = new ModelPickerWheelNavigation();
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
      const direction = navigation.update({
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        height: element.clientHeight,
        now: performance.now(),
      });
      if (direction) latest.current(direction);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [element]);
}
