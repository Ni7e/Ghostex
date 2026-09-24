import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { computeModelSelectionOutbox } from '@/packages/shared/session-chat-controller/model-selection';
import type { SessionChatSessionOptionPillsProps } from './session-chat-option-pills';
import type { SessionChatModelSelectionScope, SessionChatSelectionOptions } from '@/packages/shared/session-chat';
import type { ModelPickerSelection } from '@/packages/shared/session-chat-presentation/model-picker';

const lifecycle = { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState };

export interface ModelSelectionActions {
  select: (
    selection: ModelPickerSelection,
    options?: SessionChatSelectionOptions,
    scope?: SessionChatModelSelectionScope
  ) => void;
  selectOptions: (options: SessionChatSelectionOptions) => void;
  /** The model and level a queued pick is still delivering, if any. */
  desired: () => (ModelPickerSelection & { scope?: SessionChatModelSelectionScope }) | null | undefined;
}

/**
 * The chat's model selection queue: a pick that cannot be delivered now waits in the outbox and retries.
 * It renders nothing; the model pop-up and the option pills reach it through `actionsRef`.
 * SEE-ALSO: packages/shared/session-chat-controller/model-selection.ts, which the GPUI chat's host uses the same way.
 */
export function SessionChatModelSelectionOutbox(
  props: Pick<SessionChatSessionOptionPillsProps, 'controller' | 'onQueueModel' | 'pendingModelSelection'> & {
    actionsRef: RefObject<ModelSelectionActions | null>;
  }
) {
  const selection = computeModelSelectionOutbox(
    {
      sessionKey: props.controller.sessionKey,
      pending: props.pendingModelSelection,
      beginDispatch: props.controller.beginDispatch,
      deliver: props.onQueueModel,
    },
    lifecycle
  );
  const latest = useRef(selection);
  latest.current = selection;
  const { actionsRef } = props;
  useEffect(() => {
    actionsRef.current = {
      select: (value, options, scope) => latest.current.select(value, options, scope),
      selectOptions: (options) => latest.current.selectOptions(options),
      desired: () => latest.current.desired,
    };
    return () => {
      actionsRef.current = null;
    };
  }, [actionsRef]);
  return null;
}
