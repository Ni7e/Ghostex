import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import {
  computeModelSelectionOutbox,
  modelSelectionUnchanged,
} from '@/packages/shared/session-chat-controller/model-selection';
import { useSidebarStore } from '@/packages/core-ui/sidebar-store';
import {
  normalizeghostexHotkeySettings,
  ghostexHotkeyTextFromKeyboardEvent,
  getghostexHotkeyActionIdForKey,
} from '@/packages/shared/ghostex-hotkeys';
import { useAgentModelCatalog } from '@/packages/shared/agent-model-catalog-store';
import { createModelPickerRequest, modelPickerProvider } from './session-chat-model-picker-request';
import type { SessionChatSessionOptionPillsProps } from './session-chat-option-pills';
import type { SessionChatModelSelectionScope, SessionChatSelectionOptions } from '@/packages/shared/session-chat';
import type { ModelPickerRequest, ModelPickerSelection } from './session-chat-model-picker';
import { QUICK_MODEL_PICKER_ENABLED } from './session-chat-model-picker-platform';

const lifecycle = { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState };

// Keep the build-time condition at the import so esbuild never traverses the mobile picker asset graph.
const SessionChatModelPicker =
  typeof __GHOSTEX_MOBILE_CHAT__ === 'undefined' || !__GHOSTEX_MOBILE_CHAT__
    ? lazy(() => import('./session-chat-model-picker').then((module) => ({ default: module.SessionChatModelPicker })))
    : null;

export interface ModelPickerActions {
  open: () => void;
  select: (
    selection: ModelPickerSelection,
    options?: SessionChatSelectionOptions,
    scope?: SessionChatModelSelectionScope
  ) => void;
  selectOptions: (options: SessionChatSelectionOptions) => void;
}
/**
 * CDXC:SessionChat 2026-09-05 DECISION:
 * User: do not show the model/effort/queued status sentence in the chat box.
 * Opening uses the focused chat pane, not composer focus or current-value detection.
 */
export function SessionChatModelPickerLauncher(
  props: Pick<SessionChatSessionOptionPillsProps, 'controller' | 'onQueueModel' | 'pendingModelSelection'> & {
    actionsRef: RefObject<ModelPickerActions | null>;
  }
) {
  const catalog = useAgentModelCatalog();
  const selection = computeModelSelectionOutbox(
    {
      sessionKey: props.controller.sessionKey,
      pending: props.pendingModelSelection,
      beginDispatch: props.controller.beginDispatch,
      deliver: props.onQueueModel,
    },
    lifecycle
  );
  const { desired } = selection;
  const [request, setRequest] = useState<ModelPickerRequest | null>(null);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const requestRef = useRef<ModelPickerRequest | null>(null);
  const latest = useRef(props);
  const latestSelection = useRef(selection);
  const openedSession = useRef(props.controller.sessionKey);
  latest.current = props;
  latestSelection.current = selection;

  useEffect(() => {
    requestRef.current = null;
    setRequest(null);
  }, [props.controller.sessionKey]);

  useEffect(() => {
    const open = () => {
      if (!QUICK_MODEL_PICKER_ENABLED) return;
      const current = latest.current;
      const provider = modelPickerProvider(current.controller.catalog?.modelIcon);
      if (requestRef.current || !provider) return;
      const pane = anchor.current?.closest<HTMLElement>('.ghostex-session-chat-scope');
      if (!pane) return;
      const desired = latestSelection.current.desired;
      const next = createModelPickerRequest(
        catalog,
        provider,
        desired?.model || current.controller.state.model?.value,
        desired?.effort || current.controller.state.effort?.value
      );
      if (!next) return;
      delete document.documentElement.dataset.ghostexModelPickerRequested;
      openedSession.current = current.controller.sessionKey;
      requestRef.current = next;
      setCancelRequested(false);
      setContainer(pane);
      setRequest(next);
    };
    const toggle = () => {
      if (requestRef.current) {
        delete document.documentElement.dataset.ghostexModelPickerRequested;
        setCancelRequested(true);
      } else {
        open();
      }
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing) return;
      const chord = ghostexHotkeyTextFromKeyboardEvent(event);
      const hotkeys = normalizeghostexHotkeySettings(useSidebarStore.getState().hud.settings?.hotkeys);
      if (!chord || getghostexHotkeyActionIdForKey(hotkeys, chord) !== 'openModelPicker') return;
      if (!requestRef.current) {
        const pane = anchor.current?.closest<HTMLElement>('.ghostex-session-chat-scope');
        if (!pane?.getClientRects().length || pane.closest('[aria-hidden="true"]')) return;
        const focusedPane = document.querySelector('.workspace-pane--focused');
        if (focusedPane && !focusedPane.contains(pane)) return;
        const inputPane = document.activeElement?.closest('.ghostex-session-chat-scope');
        if (!focusedPane && inputPane && inputPane !== pane) return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      toggle();
    };
    props.actionsRef.current = {
      open,
      select: (value, options, scope) => latestSelection.current.select(value, options, scope),
      selectOptions: (options) => latestSelection.current.selectOptions(options),
    };
    if (!QUICK_MODEL_PICKER_ENABLED) {
      return () => {
        props.actionsRef.current = null;
      };
    }
    window.addEventListener('keydown', keydown, true);
    window.addEventListener('ghostex-open-model-picker', toggle);
    if (document.documentElement.dataset.ghostexModelPickerRequested === 'true') open();
    return () => {
      props.actionsRef.current = null;
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('ghostex-open-model-picker', toggle);
    };
  }, [catalog, props.actionsRef, props.controller.catalog?.modelIcon]);

  const save = (selection: ModelPickerSelection, scope: SessionChatModelSelectionScope) => {
    requestRef.current = null;
    setRequest(null);
    if (openedSession.current !== props.controller.sessionKey) return;
    if (
      modelSelectionUnchanged(
        selection,
        desired,
        {
          model: props.controller.state.model?.value,
          effort: props.controller.state.effort?.value,
        },
        request
      )
    )
      return;
    latestSelection.current.select(selection, undefined, scope);
  };
  return (
    <>
      <span ref={anchor} className='model-picker-launcher-anchor' />
      {SessionChatModelPicker && request && container && (
        <Suspense fallback={null}>
          <SessionChatModelPicker
            key={request.requestId}
            request={request}
            container={container}
            cancelRequested={cancelRequested}
            onSave={save}
            onClose={() => {
              requestRef.current = null;
              setRequest(null);
            }}
          />
        </Suspense>
      )}
    </>
  );
}
