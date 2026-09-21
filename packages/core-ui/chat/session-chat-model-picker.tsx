import { formatSidebarHotkeyLabel } from '@/packages/core-ui/hotkey-label';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { getDefaultSidebarAgentById } from '@/packages/shared/sidebar-agents';
import { AGENT_LOGOS } from '../agent-logos';
import { ModelPickerEffortIcon } from './session-chat-model-picker-effort-icons';
import { ModelPickerIcon } from './session-chat-model-picker-icons';
import {
  modelPickerControlForKey,
  useModelPickerKeyFeedback,
  useModelPickerWheelNavigation,
  type PickerControl,
} from './session-chat-model-picker-input';
import './session-chat-model-picker.css';

export type {
  ModelPickerModel,
  ModelPickerProvider,
  ModelPickerRequest,
  ModelPickerSelection,
} from '@/packages/shared/session-chat-presentation/model-picker';
import {
  modelPickerLayout,
  modelPickerChooseModel,
  modelPickerChooseEffort,
  modelPickerNextEffortIndex,
  modelPickerSupportsSessionScope,
  MODEL_PICKER_DEFAULT_SCOPE_ONLY_REASON,
  type ModelPickerRequest,
  type ModelPickerSelection,
} from '@/packages/shared/session-chat-presentation/model-picker';
import type { SessionChatModelSelectionScope } from '@/packages/shared/session-chat';

/**
 * CDXC:SessionChat 2026-09-05 DECISION:
 * User: match the floating Electric Axis concept inside the actual chat pane.
 * CDXC:SessionChat 2026-09-08 DECISION:
 * User: terminal view also offers this picker in a titlebar-free native window centered on the main window, 1260x910 for Codex and 1260x1050 for Claude, using the Settings hosting pattern.
 * This supersedes the prohibition on native picker windows for terminal view; chat keeps its in-pane hosting.
 * Models run vertically in catalog order (Astra, Sol, Terra, Luna; Fable, Opus (1m), Opus, Sonnet, Haiku), with the selected model at the axis intersection.
 * Keep the concept's rounded tiles, individual model artwork, connecting axes, arrow cues and animated glow, using OpenAI #0069cb and Claude #e85c35.
 * Option+P opens even during a turn and pressing the opening hotkey again cancels; arrows or H/J/K/L preview model and effort, Enter saves, and Escape cancels.
 * Model navigation stops at both ends; axis words are omitted, Sol is a sun, Luna uses the supplied crescent-and-stars artwork, and Sonnet's old quill artwork is replaced.
 * User: hide the effort below the model on wide panes; at 700px or less, show it there and hide the horizontal effort cards.
 * Narrow panes retain clickable effort arrows beside the selected model; trackpad gestures navigate both axes.
 * User: when height is limited, hide the models above and below the selection, just as narrow panes hide the effort rail.
 * The selected model stays centered with clickable up/down arrows; controls stay at the bottom, and idle cards and background stay subtly animated.
 * User: constrained-height model changes use a subtle content fade inside a stationary card.
 * Unsupported efforts stay visible but disabled in the horizontal rail; Max animates gently, Ultra more energetically, with a short glow beneath the effort.
 */
export function SessionChatModelPicker({
  request,
  container,
  onSave,
  onCommit,
  notice,
  onClose,
  cancelRequested = false,
}: {
  request: ModelPickerRequest;
  container: HTMLElement;
  onSave: (selection: ModelPickerSelection, scope: SessionChatModelSelectionScope) => void;
  onCommit?: (selection: ModelPickerSelection, scope: SessionChatModelSelectionScope) => Promise<void>;
  notice?: ReactNode;
  onClose: () => void;
  cancelRequested?: boolean;
}) {
  const [selection, setSelection] = useState<ModelPickerSelection>({ model: request.model, effort: request.effort });
  const [closing, setClosing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [paneSize, setPaneSize] = useState({ width: container.clientWidth, height: container.clientHeight });
  const [controlsHeight, setControlsHeight] = useState(56);
  const { pressed, press, pulse } = useModelPickerKeyFeedback();
  const [popup, setPopup] = useState<HTMLDivElement | null>(null);
  const [pointerRailStart, setPointerRailStart] = useState<number | null>(null);
  const pointerRailTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closingRef = useRef(false);
  const mounted = useRef(true);
  const selectedTile = useRef<HTMLButtonElement>(null);
  const [controls, setControls] = useState<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const modelIndex = request.models.findIndex((model) => model.value === selection.model);
  const model = request.models[modelIndex]!;
  const effortIndex = request.efforts.findIndex((effort) => effort.value === selection.effort);
  const agent = getDefaultSidebarAgentById(request.provider)!;
  const sessionScope = modelPickerSupportsSessionScope(request.provider);
  // Enter saves the agent's default, Shift+Enter applies to this session alone; see modelPickScope.
  const defaultScope: SessionChatModelSelectionScope = 'default';
  const sessionKey: PickerControl = 'EnterAlternate';
  const defaultKey: PickerControl = 'Enter';
  const {
    narrow,
    viewportHeight,
    stageWidth,
    short,
    scale,
    visibleModels,
    firstVisible,
    stageHeight,
    railOffset,
    centerY,
    effortSplit,
  } = modelPickerLayout(request, modelIndex, paneSize, controlsHeight, pointerRailStart);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
      clearTimeout(pointerRailTimer.current);
    };
  }, []);
  useLayoutEffect(() => {
    const size = () => {
      setPaneSize({ width: container.clientWidth, height: container.clientHeight });
      if (controls) setControlsHeight(controls.offsetHeight);
    };
    size();
    const observer = new ResizeObserver(size);
    observer.observe(container);
    if (controls) observer.observe(controls);
    return () => observer.disconnect();
  }, [container, controls]);
  useEffect(() => {
    if (!committing) selectedTile.current?.focus({ preventScroll: true });
  }, [selection.model, selection.effort, committing]);

  const finish = (save: boolean, choice = selection, scope: SessionChatModelSelectionScope = defaultScope) => {
    if (closingRef.current) return;
    closingRef.current = true;
    setCommitting(save);
    const animateClose = () => {
      if (!mounted.current) return;
      setClosing(true);
      timer.current = setTimeout(
        () => (save ? onSave(choice, scope) : onClose()),
        window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 190
      );
    };
    // The terminal host must receive durable acceptance before its native window can close.
    if (save && onCommit) {
      void onCommit(choice, scope).then(animateClose, () => {
        if (!mounted.current) return;
        closingRef.current = false;
        setCommitting(false);
      });
    } else {
      animateClose();
    }
  };
  useEffect(() => {
    if (cancelRequested) finish(false);
  }, [cancelRequested]);
  /**
   * CDXC:SessionChat 2026-09-06 DECISION:
   * User: single-clicking a model or effort card previews it; double-clicking saves that choice and closes the picker.
   * CDXC:SessionChat 2026-09-06 WHY:
   * Briefly hold the model rail after a pointer click so recentering cannot move the card away from the second click.
   */
  const chooseModel = (index: number, save = false, pointer = false) => {
    const choice = modelPickerChooseModel(request, selection, index);
    if (!choice || closingRef.current) return;
    clearTimeout(pointerRailTimer.current);
    setPointerRailStart(pointer ? firstVisible : null);
    if (pointer) pointerRailTimer.current = setTimeout(() => setPointerRailStart(null), 350);
    setSelection(choice);
    if (save) finish(true, choice);
  };
  const chooseEffort = (index: number, save = false) => {
    const choice = modelPickerChooseEffort(request, selection, index);
    if (!choice || closingRef.current) return;
    setSelection(choice);
    if (save) finish(true, choice);
  };
  const moveEffort = (direction: -1 | 1) => {
    const index = modelPickerNextEffortIndex(request, selection, direction);
    if (index !== undefined) chooseEffort(index);
  };
  const canMoveEffort = (direction: -1 | 1) => modelPickerNextEffortIndex(request, selection, direction) !== undefined;
  const navigate = (control: PickerControl) => {
    pulse(control);
    if (control === 'ArrowUp') chooseModel(modelIndex - 1);
    if (control === 'ArrowDown') chooseModel(modelIndex + 1);
    if (control === 'ArrowLeft') moveEffort(-1);
    if (control === 'ArrowRight') moveEffort(1);
    if (control === 'Enter') finish(true);
    if (control === 'EnterAlternate' && sessionScope) finish(true, selection, 'session');
    if (control === 'Escape') finish(false);
  };
  useModelPickerWheelNavigation(popup, navigate);
  const effortX = (index: number) => (index < effortSplit ? index - effortSplit : index - effortSplit + 1) * 142;
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) finish(false);
      }}
    >
      <Dialog.Portal container={container}>
        <Dialog.Backdrop className='ghostex-model-picker-backdrop' data-closing={closing ? '' : undefined} />
        <Dialog.Popup
          ref={setPopup}
          className='ghostex-model-picker'
          initialFocus={selectedTile}
          data-closing={closing ? '' : undefined}
          data-saving={committing ? '' : undefined}
          data-narrow={narrow ? '' : undefined}
          data-compact-controls={paneSize.width < 560 ? '' : undefined}
          style={
            {
              '--picker-accent':
                request.provider === 'codex' ? '#0069cb' : request.provider === 'claude' ? '#e85c35' : '#ffffff',
            } as CSSProperties
          }
          onPointerDown={(event) => {
            if (!(event.target as Element).closest('button')) finish(false);
          }}
          onKeyDownCapture={(event) => {
            const control = modelPickerControlForKey(event.nativeEvent);
            if (!control) return;
            event.preventDefault();
            event.stopPropagation();
            press(event.nativeEvent, control);
            navigate(control);
          }}
        >
          <Dialog.Title className='model-picker-sr-only'>Choose model and effort</Dialog.Title>
          <Dialog.Description className='model-picker-sr-only'>
            Up and down choose a model. Left and right choose effort. Enter saves. Escape cancels.
          </Dialog.Description>
          {notice}
          <div className='model-picker-agent'>
            <span className='model-picker-agent-emblem' aria-hidden='true'>
              <span style={{ maskImage: `url("${AGENT_LOGOS[agent.icon]}")` }} />
            </span>
            <span>{agent.name}</span>
          </div>
          <div className='model-picker-atmosphere' aria-hidden='true'>
            <div className='model-picker-nebula' />
            <div className='model-picker-nebula model-picker-nebula-secondary' />
            {Array.from({ length: 16 }, (_, index) => (
              <i
                key={index}
                style={
                  {
                    '--particle-x': `${(index * 37 + 11) % 100}%`,
                    '--particle-y': `${(index * 23 + 7) % 100}%`,
                    '--drift-delay': `${index * -1.7}s`,
                  } as CSSProperties
                }
              />
            ))}
          </div>
          <div className='model-picker-viewport' style={{ height: viewportHeight }}>
            <div
              className='model-picker-stage'
              style={
                {
                  height: stageHeight,
                  width: stageWidth,
                  transform: `translate(-50%, -50%) scale(${scale})`,
                  '--center-y': `${centerY}px`,
                } as CSSProperties
              }
            >
              {!short && (
                <div
                  className='model-picker-line model-picker-line-vertical'
                  aria-hidden='true'
                  style={{ top: 71 + railOffset, height: (request.models.length - 1) * 142 }}
                />
              )}
              {narrow && (
                <>
                  <button
                    className='model-picker-inline-effort'
                    type='button'
                    aria-label='Decrease effort'
                    disabled={closing || committing || !canMoveEffort(-1)}
                    onClick={() => navigate('ArrowLeft')}
                  >
                    <svg viewBox='0 0 20 20'>
                      <path d='m12 4-6 6 6 6' />
                    </svg>
                  </button>
                  <button
                    className='model-picker-inline-effort model-picker-inline-effort-next'
                    type='button'
                    aria-label='Increase effort'
                    disabled={closing || committing || !canMoveEffort(1)}
                    onClick={() => navigate('ArrowRight')}
                  >
                    <svg viewBox='0 0 20 20'>
                      <path d='m8 4 6 6-6 6' />
                    </svg>
                  </button>
                </>
              )}
              {!narrow && request.efforts.length > 0 && (
                <div
                  className='model-picker-line model-picker-line-horizontal'
                  aria-hidden='true'
                  style={{ width: stageWidth - 180 }}
                />
              )}
              {!short && (
                <button
                  className='model-picker-axis-label model-picker-axis-top'
                  style={{ top: Math.max(4, 71 + railOffset - 78) }}
                  type='button'
                  onClick={() => chooseModel(modelIndex - 1)}
                  disabled={closing || committing || modelIndex === 0}
                  aria-label='Previous model'
                >
                  <i className='model-picker-triangle model-picker-triangle-up' />
                </button>
              )}
              {!short && (
                <button
                  className='model-picker-axis-label model-picker-axis-bottom'
                  style={{
                    top: Math.min(stageHeight - 10, 71 + railOffset + (request.models.length - 1) * 142 + 76),
                    bottom: 'auto',
                  }}
                  type='button'
                  onClick={() => chooseModel(modelIndex + 1)}
                  disabled={closing || committing || modelIndex === request.models.length - 1}
                  aria-label='Next model'
                >
                  <i className='model-picker-triangle model-picker-triangle-down' />
                </button>
              )}
              <button
                className='model-picker-chevron model-picker-chevron-up'
                type='button'
                onClick={() => chooseModel(modelIndex - 1)}
                disabled={closing || committing || modelIndex === 0}
                aria-label='Move up one model'
              >
                <svg viewBox='0 0 20 12'>
                  <path d='m3 9 7-6 7 6' />
                </svg>
              </button>
              <button
                className='model-picker-chevron model-picker-chevron-down'
                type='button'
                onClick={() => chooseModel(modelIndex + 1)}
                disabled={closing || committing || modelIndex === request.models.length - 1}
                aria-label='Move down one model'
              >
                <svg viewBox='0 0 20 12'>
                  <path d='m3 3 7 6 7-6' />
                </svg>
              </button>
              {request.models.map((entry, index) => {
                const offset = index - modelIndex;
                if (short && offset !== 0) return null;
                return (
                  <button
                    key={short ? 'compact-selected-model' : entry.value}
                    ref={offset === 0 ? selectedTile : undefined}
                    type='button'
                    className='model-picker-tile model-picker-model'
                    data-selected={offset === 0 ? '' : undefined}
                    data-compact-model={short ? '' : undefined}
                    aria-pressed={offset === 0}
                    aria-label={`Model ${entry.label}`}
                    disabled={closing || committing}
                    style={
                      {
                        top: short ? centerY : 71 + railOffset,
                        '--tile-x': '0px',
                        '--tile-y': short ? '0px' : `${index * 142}px`,
                        '--idle-delay': short ? '0s' : `${index * -1.3}s`,
                      } as CSSProperties
                    }
                    tabIndex={index >= firstVisible && index < firstVisible + visibleModels ? 0 : -1}
                    onClick={(event) => chooseModel(index, false, event.detail > 0)}
                    onDoubleClick={() => chooseModel(index, true)}
                  >
                    <span className='model-picker-artwork' key={`${entry.value}-artwork`}>
                      <ModelPickerIcon
                        model={entry.value}
                        standard={request.provider !== 'claude' && request.provider !== 'codex'}
                      />
                    </span>
                    <span className='model-picker-model-name' key={`${entry.value}-name`}>
                      {entry.version && <span className='model-picker-model-version'>{entry.version}</span>}
                      {entry.label}
                    </span>
                    {narrow && offset === 0 && request.efforts[effortIndex] && (
                      <span className='model-picker-current-effort' key={selection.effort}>
                        {request.efforts[effortIndex].label}
                      </span>
                    )}
                  </button>
                );
              })}
              {!narrow && request.efforts.length > 0 && (
                <>
                  <button
                    className='model-picker-axis-label model-picker-axis-left'
                    type='button'
                    onClick={() => moveEffort(-1)}
                    disabled={closing || committing || !canMoveEffort(-1)}
                    aria-label='Decrease effort'
                  >
                    <i className='model-picker-triangle model-picker-triangle-left' />
                  </button>
                  <button
                    className='model-picker-axis-label model-picker-axis-right'
                    type='button'
                    onClick={() => moveEffort(1)}
                    disabled={closing || committing || !canMoveEffort(1)}
                    aria-label='Increase effort'
                  >
                    <i className='model-picker-triangle model-picker-triangle-right' />
                  </button>
                  <div
                    hidden={effortIndex < 0}
                    className='model-picker-effort-aura'
                    aria-hidden='true'
                    style={{ '--tile-x': `${effortX(effortIndex)}px` } as CSSProperties}
                  />
                  {request.efforts.map((entry, index) => (
                    <button
                      key={entry.value}
                      type='button'
                      className='model-picker-tile model-picker-effort'
                      data-effort={entry.value}
                      data-unavailable={!model.efforts.some((effort) => effort.value === entry.value) ? '' : undefined}
                      data-selected={index === effortIndex ? '' : undefined}
                      aria-pressed={index === effortIndex}
                      aria-label={`Effort ${entry.label}`}
                      disabled={closing || committing || !model.efforts.some((effort) => effort.value === entry.value)}
                      title={
                        !model.efforts.some((effort) => effort.value === entry.value)
                          ? `${entry.label} is unavailable for ${model.label}`
                          : undefined
                      }
                      style={
                        {
                          '--tile-x': `${effortX(index)}px`,
                          '--tile-y': '0px',
                          '--idle-delay': `${index * -1.1}s`,
                        } as CSSProperties
                      }
                      onClick={() => chooseEffort(index)}
                      onDoubleClick={() => chooseEffort(index, true)}
                    >
                      <ModelPickerEffortIcon effort={entry.value} />
                      <span>{entry.label}</span>
                    </button>
                  ))}
                </>
              )}
              <span className='model-picker-sr-only' role='status' aria-live='polite'>
                {[model.label, request.efforts[effortIndex]?.label].filter(Boolean).join(', ')}
              </span>
            </div>
          </div>
          <footer ref={setControls} className='model-picker-footer'>
            <div className='model-picker-help'>
              <span className='model-picker-open-hint' data-key-pressed={cancelRequested ? '' : undefined}>
                <kbd>{formatSidebarHotkeyLabel('alt+p')}</kbd>
                <span>Close</span>
              </span>
              <span>
                <button
                  type='button'
                  aria-label='Previous model'
                  disabled={closing || committing || modelIndex === 0}
                  data-key-pressed={pressed.has('ArrowUp') ? '' : undefined}
                  onClick={() => chooseModel(modelIndex - 1)}
                >
                  <kbd>↑</kbd>
                </button>
                <button
                  type='button'
                  aria-label='Next model'
                  disabled={closing || committing || modelIndex === request.models.length - 1}
                  data-key-pressed={pressed.has('ArrowDown') ? '' : undefined}
                  onClick={() => chooseModel(modelIndex + 1)}
                >
                  <kbd>↓</kbd>
                </button>
                <span>Model</span>
              </span>
              <span>
                <button
                  type='button'
                  aria-label='Decrease effort'
                  disabled={closing || committing || !canMoveEffort(-1)}
                  data-key-pressed={pressed.has('ArrowLeft') ? '' : undefined}
                  onClick={() => moveEffort(-1)}
                >
                  <kbd>←</kbd>
                </button>
                <button
                  type='button'
                  aria-label='Increase effort'
                  disabled={closing || committing || !canMoveEffort(1)}
                  data-key-pressed={pressed.has('ArrowRight') ? '' : undefined}
                  onClick={() => moveEffort(1)}
                >
                  <kbd>→</kbd>
                </button>
                <span>Effort</span>
              </span>
              <button
                type='button'
                data-key-pressed={pressed.has(sessionKey) ? '' : undefined}
                disabled={closing || committing || !sessionScope}
                title={sessionScope ? undefined : MODEL_PICKER_DEFAULT_SCOPE_ONLY_REASON}
                aria-describedby={sessionScope ? undefined : 'model-picker-scope-reason'}
                onClick={() => finish(true, selection, 'session')}
              >
                <kbd>⇧↵</kbd>
                <span>Use in this session</span>
              </button>
              <button
                type='button'
                data-key-pressed={pressed.has(defaultKey) ? '' : undefined}
                disabled={closing || committing}
                onClick={() => finish(true, selection, 'default')}
              >
                <kbd>↵</kbd>
                <span>Set as default</span>
              </button>
              {sessionScope ? null : (
                <span id='model-picker-scope-reason' className='model-picker-sr-only'>
                  {MODEL_PICKER_DEFAULT_SCOPE_ONLY_REASON}
                </span>
              )}
              <button
                type='button'
                data-key-pressed={pressed.has('Escape') ? '' : undefined}
                disabled={closing || committing}
                onClick={() => finish(false)}
              >
                <kbd>Esc</kbd>
                <span>Cancel</span>
              </button>
            </div>
          </footer>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
