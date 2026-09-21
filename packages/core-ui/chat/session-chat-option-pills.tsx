import {
  sessionChatOptionPillValues,
  sessionChatOptionsTitle,
} from '@/packages/shared/session-chat-presentation/option-pills';
import {
  isShiftTabModeCycler,
  isCodexPlanModeToggle,
  optionMenuSections,
  sessionChatOptionRows,
  visibleSessionChatOptions,
  sessionChatOptionsMayResolve,
} from '@/packages/shared/session-chat-presentation/option-menu';
import {
  queueSessionChatOption,
  dispatchSessionChatOption,
} from '@/packages/shared/session-chat-controller/option-dispatch';
import { computeSessionChatOptions } from '@/packages/shared/session-chat-controller/session-options';
import { SessionChatComposerOptionsMenu } from './session-chat-composer-options-menu';
import { modelPickerProvider } from './session-chat-model-picker-request';
import {
  modelPickScope,
  modelPickerSupportsSessionScope,
} from '@/packages/shared/session-chat-presentation/model-picker';
import { modelMenuPick, type ModelMenuContext } from '@/packages/shared/session-chat-controller/model-menu';
import { SessionChatModelMenu, type SessionChatModelMenuExtraRow } from './session-chat-model-menu';
import { QUICK_MODEL_PICKER_ENABLED } from './session-chat-model-picker-platform';
import { resolveContextDetailStatus, type ContextDetailStatus } from './session-chat-context-details-agents';
import type { AccountIconColor } from '@/packages/shared/agent-accounts';
import type { SessionChatPendingModelSelection } from '@/packages/shared/session-chat';
// Composer footer session-option pills (upstream chat spec §1.2-§1.4 port).
// Ghost controls showing the current values only: Model and Effort are menu
// triggers, including Claude's permission mode selector backed by Shift+Tab.
// The category names live in tooltips / accessible labels. Controls
// that type directly into the TUI are disabled during a turn. Model choices
// are always selectable and enter the durable model-selection queue.
//
// Values are local (see session-chat-session-options.ts): a dispatch marks the
// value "dispatched", never "confirmed".
//
// CDXC:Drafts 2026-08-28: the model pill's menu also carries a
// "Switch Agent CLI" submenu while (and only while) the session is a draft —
// the one control here that changes the session itself rather than typing at
// its TUI. The submenu sits above the model section.

import { SessionChatModelPickerLauncher, type ModelPickerActions } from './session-chat-model-picker-launcher';
import { IconBoltFilled, IconChevronDown, IconMap } from '@tabler/icons-react';
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { postAppModalHostMessage } from '../app-modal-host-bridge';
import { AppTooltip } from '../app-tooltip';
import { formatSidebarHotkeyLabel } from '../hotkey-label';
import { useSidebarStore } from '../sidebar-store';
import { normalizeghostexHotkeySettings } from '@/packages/shared/ghostex-hotkeys';
import { createAppToastRequest } from '../../shared/app-toast-contract';
import type {
  SessionChatAvailableAgent,
  SessionChatDetectedOptions,
  SessionChatSendKey,
} from '../../shared/session-chat';
import { Button } from '../../components/ui/button';
import { cn } from '@/packages/components/utils';
import { getDefaultSidebarAgentByIcon, isSidebarAgentIcon } from '../../shared/sidebar-agents';
import { ProjectAgentLauncherIcon } from '../project-agent-launcher-icon';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { truncateAgentModelLabel } from '../../shared/agent-model-catalog';
import { SessionChatContextMeter, resolveSessionChatContextMeterUsage } from './session-chat-context-meter';
import {
  resolveSessionChatContextDetailGroups,
  useSessionChatContextDetailsClock,
  useSessionChatContextDetailsPreferences,
  type SessionChatContextDetailSession,
} from './session-chat-context-details';
import { useAgentModelCatalog } from '../../shared/agent-model-catalog-store';
import type { SessionChatOptionDispatchReceipt } from './session-chat-option-state';
import {
  sessionChatBoundedKeySteps,
  sessionChatCyclicKeySteps,
  sessionChatOptionChoiceSections,
  sessionChatOptionsPillLabel,
  sessionChatOptionTracksValue,
  sessionChatOptionValueLabel,
  sessionChatSessionOptionCatalog,
  type SessionChatDetectedOptionInput,
  type SessionChatOptionChoice,
  type SessionChatOptionDescriptor,
  type SessionChatOptionState,
  type SessionChatSessionOptionCatalog,
} from './session-chat-session-options';

type PillSkeleton = 'model' | 'options' | 'combined' | 'mode';

function showSessionChatOptionFailureToast(title: string, description: string): void {
  const trimmedTitle = title.trim();
  const trimmedDescription = description.trim();
  if (trimmedTitle === '' || window.webkit?.messageHandlers?.ghostexAppModalHost === undefined) {
    return;
  }
  try {
    postAppModalHostMessage(
      createAppToastRequest('error', trimmedTitle, trimmedDescription === '' ? undefined : trimmedDescription),
      'SessionChatOptionPills:toast'
    );
  } catch {
    // Toast-host availability must never gate option dispatch.
  }
}

function optionChoiceLabel(descriptor: SessionChatOptionDescriptor, value?: string): string | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  return (descriptor.choices ?? []).find((choice) => choice.value === value)?.label ?? value;
}

function showOptionDispatchFailure(descriptor: SessionChatOptionDescriptor, value?: string): void {
  const choice = optionChoiceLabel(descriptor, value);
  showSessionChatOptionFailureToast(
    `Could not update ${descriptor.label}`,
    choice
      ? `Ghostex couldn't apply ${choice} to this session.`
      : `Ghostex couldn't send the ${descriptor.label.toLowerCase()} change to the agent.`
  );
}

function pillLoadingText(skeleton: PillSkeleton): string {
  if (skeleton === 'options') {
    return 'Reading options…';
  }
  if (skeleton === 'mode') {
    return 'Reading mode…';
  }
  return 'Reading model…';
}

function showUnconfirmedOptionFailure(): void {
  showSessionChatOptionFailureToast(
    'Could not confirm session options',
    'The agent did not confirm the selection. The controls now reflect the latest detected settings.'
  );
}

export interface SessionChatSessionOptionsController {
  sessionKey?: string;
  catalog: SessionChatSessionOptionCatalog | null;
  state: SessionChatOptionState;
  /** Descriptors of the Options pill for the currently selected model. */
  optionDescriptors: readonly SessionChatOptionDescriptor[];
  beginDispatch: (values: Readonly<Record<string, string>>) => SessionChatOptionDispatchReceipt;
  recordDispatched: (descriptorId: string, value: string) => void;
  /** A command the user typed themselves reconciles the pills (§1.4). */
  reconcileTypedCommand: (text: string) => void;
  /** What gxserver confirmed from the agent transcript or terminal. */
  applyDetected: (detected: SessionChatDetectedOptionInput | null | undefined) => void;
}

/**
 * Owns the local option truth for one session. Lives in the view (not the
 * pills) so the composer's send path can reconcile a hand-typed `/model`.
 */
export function useSessionChatSessionOptions({
  agent,
  draftAgentId,
  sessionKey,
}: {
  agent: string | null | undefined;
  /*
  CDXC:Drafts 2026-08-28:
  The draft's CONCRETE launch agent id (`sessionAgentId`), passed only while the
  session is a draft. `agent` above is the chat family, which a switch between
  two agents of the same family — Claude Code and a project custom agent built
  on Claude — does not change at all.
  */
  draftAgentId?: string | null;
  sessionKey?: string;
}): SessionChatSessionOptionsController {
  const agentModelCatalog = useAgentModelCatalog();
  return computeSessionChatOptions(
    { agent, draftAgentId, sessionKey, agentModelCatalog, onUnconfirmed: showUnconfirmedOptionFailure },
    { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState }
  );
}

export interface SessionChatSessionOptionPillsProps {
  accountIndicator?: string;
  controller: SessionChatSessionOptionsController;
  /** Terminal-only metadata that does not belong in persisted option state. */
  detectedOptions?: SessionChatDetectedOptions | null;
  /** True while the agent is working: immediate TUI controls are disabled. */
  isWorking: boolean;
  /** False when input is held elsewhere. */
  canSend: boolean;
  /** True when the transport can inject raw keystrokes for agent TUI controls. */
  canSendKey: boolean;
  /** True once gxserver has read the screen; settles the separate mode pill. */
  screenProbed: boolean;
  onDispatchCommand: (command: string) => Promise<void>;
  onDispatchKey: (key: SessionChatSendKey, marker: string) => Promise<void>;
  /** Holds the whole composer disabled while a cyclic TUI switch is running. */
  onSwitchingChange?: (switching: boolean) => void;
  /** Agent-picker options flip the pane to the terminal after typing. */
  onSwitchToTerminal?: () => void;
  /**
   * Applies a `model-picker` choice by driving the agent's own picker on the
   * daemon (`/api/selectSessionChatModel`). Absent when the host has no route
   * to it. Hosts with `onQueueModel` use the durable selection route instead.
   */
  onPickModel?: (params: { model: string; effort: string }) => Promise<void>;
  onQueueModel?: (params: {
    model: string;
    effort: string;
    options?: SessionChatPendingModelSelection['options'];
  }) => Promise<SessionChatPendingModelSelection>;
  pendingModelSelection?: SessionChatPendingModelSelection | null;
  /** Opens the context details picker (the pen in the context meter popover). */
  onEditContextDetails?: () => void;
  /** Ghostex's own title, id and draft state for the popover's session row. */
  contextDetailsSession?: SessionChatContextDetailSession;
  contextDetailsStatus?: ContextDetailStatus;
  /*
  CDXC:Drafts 2026-08-28:
  The composer's draft agent switcher. It exists ONLY while the session is a
  draft: `draftAgents` comes from `availableAgents` on the chat read state,
  which the daemon stops sending the moment the draft's first prompt reaches
  the agent. Absent (or empty, or without a switch handler) means the submenu
  is not rendered at all — the agent of a real conversation cannot be changed.
  */
  draftAgents?: readonly SessionChatAvailableAgent[];
  /** The draft's own launch agent id: the row that renders checked. */
  draftAgentId?: string | null;
  /** Runs `/api/switchDraftAgent`; rejections are shown, never swallowed. */
  onSwitchDraftAgent?: (agentId: string) => Promise<void>;
  /**
   * The model picker chose another agent's model in a real conversation: the host opens Handoff with
   * that agent selected. Absent on a host with no such route, where only this agent's models are offered.
   */
  onHandoffToModel?: (target: {
    provider: 'claude' | 'codex' | 'cursor' | 'grok' | 'antigravity';
    model: string;
    effort: string;
  }) => void;
  /** Escape in the model picker hands the keyboard back to the composer. */
  onReturnFocusToComposer?: () => void;
}

/*
CDXC:AgentScreenDetection 2026-08-22:
`skeleton` names which placeholder width to use while the pill has no known
value. The bar replaces only the LABEL — same button, same
chevron, same padding — so resolving a value swaps text in without moving the
composer row. Ordinary controls stay disabled until their current value is known.
The model catalog remains available while loading so a quick-picker selection can be queued.
*/
function PillTrigger({
  ariaLabel,
  className,
  disabled,
  icon,
  iconOnly = false,
  label,
  skeleton,
  allowWhileLoading = false,
  title,
  tooltipWhenDisabled = false,
  trailingIcon,
}: {
  ariaLabel: string;
  className?: string;
  disabled: boolean;
  icon?: ReactNode;
  iconOnly?: boolean;
  label: string;
  skeleton?: PillSkeleton;
  allowWhileLoading?: boolean;
  title: string;
  /**
   * Keeps the tooltip hoverable while the pill is disabled: the disabled
   * button drops its own pointer events, so a wrapper span carries the hover.
   * The model pill uses this so its picker shortcut stays discoverable.
   */
  tooltipWhenDisabled?: boolean;
  trailingIcon?: ReactNode;
}) {
  // A skeleton has no value to name, so the tooltip and the accessible name
  // say what is happening instead of reading out the category word. An
  // icon-only pill (mode) keeps its icon-only shape while loading: its
  // skeleton is the glyph-sized bar, and growing a chevron it will not have
  // when resolved would move the composer row twice.
  const loadingText = skeleton ? pillLoadingText(skeleton) : '';
  const resolvedIconOnly = iconOnly;
  const isDisabled = disabled || (skeleton !== undefined && !allowWhileLoading);
  const trigger = (
    <DropdownMenuTrigger
      render={
        <Button
          aria-label={skeleton ? loadingText : ariaLabel}
          className={cn('ghostex-chat-footer-control max-w-40 rounded-full text-muted-foreground', className)}
          disabled={isDisabled}
          size={resolvedIconOnly ? 'icon-xs' : 'xs'}
          variant='ghost'
        />
      }
    >
      {icon}
      {skeleton ? (
        <span aria-hidden='true' className='ghostex-chat-pill-skeleton' data-pill={skeleton} />
      ) : resolvedIconOnly ? null : (
        <span className='truncate'>{label}</span>
      )}
      {skeleton || resolvedIconOnly ? null : trailingIcon}
      {resolvedIconOnly ? null : <IconChevronDown aria-hidden='true' className='size-3 shrink-0' stroke={2} />}
    </DropdownMenuTrigger>
  );
  /*
   * The wrapper must not depend on the disabled state. A pill flips to its
   * skeleton (and disabled) right after a choice is dispatched, while its menu
   * is still open; toggling the wrapper there remounts the trigger, and the
   * open Base UI menu keeps positioning against the detached node, which lands
   * the popup at the window's top corner. Keep the tree shape stable instead.
   */
  return (
    <AppTooltip content={skeleton ? loadingText : title}>
      {tooltipWhenDisabled ? <span className='inline-flex'>{trigger}</span> : trigger}
    </AppTooltip>
  );
}

/*
The read-only twin of PillTrigger for `terminal-handoff` options: same chip, no
chevron, because there is no menu behind it — the click hands the user to the
terminal. It stays enabled while the agent is working: switching panes types
nothing at the TUI, which is the only reason the dispatching pills go dead.
*/
function PillButton({
  ariaLabel,
  className,
  disabled,
  icon,
  label,
  onClick,
  skeleton,
  title,
  tooltipWhenDisabled = false,
}: {
  ariaLabel: string;
  className?: string;
  disabled: boolean;
  icon?: ReactNode;
  label: string;
  onClick: () => void;
  skeleton?: PillSkeleton;
  title: ReactNode;
  /** See PillTrigger: keeps the tooltip hoverable while disabled. */
  tooltipWhenDisabled?: boolean;
}) {
  const loadingText = skeleton ? pillLoadingText(skeleton) : '';
  const isDisabled = disabled || skeleton !== undefined;
  const button = (
    <Button
      aria-label={skeleton ? loadingText : ariaLabel}
      className={cn('ghostex-chat-footer-control max-w-40 rounded-full text-muted-foreground', className)}
      disabled={isDisabled}
      onClick={onClick}
      size='xs'
      variant='ghost'
    >
      {icon}
      {skeleton ? (
        <span aria-hidden='true' className='ghostex-chat-pill-skeleton' data-pill={skeleton} />
      ) : label ? (
        <span className='truncate'>{label}</span>
      ) : null}
    </Button>
  );
  return (
    <AppTooltip content={skeleton ? loadingText : title}>
      {tooltipWhenDisabled ? <span className='inline-flex'>{button}</span> : button}
    </AppTooltip>
  );
}

/** The Shift+Tab permission-mode cycler: rendered as its own icon pill, never
 *  as a row of the Options menu. */

const CLAUDE_PERMISSION_MODE_ICON_KIND: Readonly<Record<string, 'advance' | 'pause'>> = {
  'accept-edits': 'advance',
  auto: 'advance',
  bypass: 'advance',
  manual: 'pause',
  plan: 'pause',
};

function ClaudePermissionModeIcon({ mode }: { mode: string }) {
  const kind = CLAUDE_PERMISSION_MODE_ICON_KIND[mode];
  if (!kind) {
    return null;
  }

  return (
    <svg
      aria-hidden='true'
      className='ghostex-chat-mode-icon'
      data-icon='inline-start'
      data-mode={mode}
      viewBox='0 0 16 14'
    >
      {kind === 'advance' ? (
        <path d='M1 2.1 6.9 7 1 11.9V2.1Zm7.1 0L14 7l-5.9 4.9V2.1Z' fill='currentColor' />
      ) : (
        <>
          <rect fill='currentColor' height='9.8' rx='0.7' width='3.2' x='2.1' y='2.1' />
          <rect fill='currentColor' height='9.8' rx='0.7' width='3.2' x='9.2' y='2.1' />
        </>
      )}
    </svg>
  );
}

/*
CDXC:Drafts 2026-08-28:
Brand artwork for an "Agents" row. The daemon sends the icon as a plain wire
string, so it is narrowed to the sidebar icon union and then drawn by the same
component, with the same brand colouring, that the model pill already uses.
*/
function DraftAgentIcon({ icon }: { icon: string }) {
  const agent = getDefaultSidebarAgentByIcon(isSidebarAgentIcon(icon) ? icon : undefined);
  return <ProjectAgentLauncherIcon agent={agent ? { ...agent, isDefault: true } : undefined} colorMode='brand' />;
}

const CURSOR_MODEL_SETTINGS_PICKER: SessionChatOptionDescriptor = {
  id: 'cursor-model-settings',
  label: 'Model settings',
  category: 'mode',
  actionLabel: 'Change it in the CLI',
  dispatch: { kind: 'agent-picker', command: '/model' },
};

function FastModeIcon() {
  return <IconBoltFilled aria-hidden='true' className='ghostex-chat-fast-mode-icon size-3 shrink-0' />;
}

/** Codex's Plan mode, shown beside the fast bolt on the options pill. */
function PlanModeIcon() {
  return <IconMap aria-hidden='true' className='ghostex-chat-plan-mode-icon size-3 shrink-0' stroke={2} />;
}

export function SessionChatSessionOptionPills({
  accountIndicator,
  canSend,
  canSendKey,
  contextDetailsSession,
  contextDetailsStatus,
  controller,
  detectedOptions,
  draftAgentId,
  draftAgents,
  isWorking,
  onDispatchCommand,
  onDispatchKey,
  onEditContextDetails,
  onHandoffToModel,
  onPickModel,
  onQueueModel,
  onReturnFocusToComposer,
  pendingModelSelection,
  onSwitchDraftAgent,
  onSwitchingChange,
  onSwitchToTerminal,
  screenProbed,
}: SessionChatSessionOptionPillsProps) {
  const hotkeys = useSidebarStore((store) => store.hud.settings?.hotkeys);
  const modelPickerShortcut = formatSidebarHotkeyLabel(normalizeghostexHotkeySettings(hotkeys).openModelPicker ?? '');
  const modelPickerActions = useRef<ModelPickerActions | null>(null);
  const [dispatchingId, setDispatchingId] = useState<string | null>(null);
  const dispatchingRef = useRef<object | null>(null);
  const contextDetailsAgent = controller.catalog?.modelIcon === 'codex' ? 'codex' : 'claude';
  const contextDetailsPreferences = useSessionChatContextDetailsPreferences(contextDetailsAgent);
  const contextDetailsNow = useSessionChatContextDetailsClock();
  const [switchingAgent, setSwitchingAgent] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const detailStatus = useMemo(
    () => contextDetailsStatus ?? resolveContextDetailStatus(contextDetailsAgent, detectedOptions),
    [contextDetailsStatus, contextDetailsAgent, detectedOptions]
  );
  const contextDetails = useMemo(
    () =>
      detailStatus
        ? resolveSessionChatContextDetailGroups(
            detailStatus,
            contextDetailsPreferences,
            contextDetailsNow,
            'shown',
            contextDetailsSession ?? null,
            contextDetailsAgent
          )
        : undefined,
    [detailStatus, contextDetailsAgent, contextDetailsNow, contextDetailsPreferences, contextDetailsSession]
  );

  const { catalog, optionDescriptors, beginDispatch, state } = controller;
  const queuedControls = catalog?.modelIcon === 'codex' || catalog?.modelIcon === 'claude';
  const quickPicker = modelPickerProvider(catalog?.modelIcon) !== undefined;
  // CDXC:SessionChat 2026-09-06 WHY: The queued selection route replaced direct picking on desktop; checking only onPickModel hid choices even while the quick picker could apply them.
  const canPickModel = onPickModel !== undefined || (onQueueModel !== undefined && quickPicker);
  const visibleOptions = useMemo(
    () => visibleSessionChatOptions(optionDescriptors, { canSendKey, canPickModel, queuedControls }),
    [canSendKey, canPickModel, optionDescriptors, queuedControls]
  );

  const pickerProvider = modelPickerProvider(catalog?.modelIcon);
  /**
   * CDXC:SessionChat 2026-09-18 DECISION:
   * User: when a model choice cannot be applied, say so where it was chosen.
   * A queued selection retries quietly, so only an abandoned one reaches this row; the next choice replaces it.
   */
  const selectionError =
    pendingModelSelection?.state === 'failed' ? (pendingModelSelection.errorMessage ?? null) : null;
  const dispatch = useCallback(
    (descriptor: SessionChatOptionDescriptor, value?: string, secondary = false): void => {
      if (
        queueSessionChatOption(descriptor, value, {
          catalog,
          state,
          queuedControls,
          quickPicker,
          scope: modelPickScope(pickerProvider, secondary),
          picker: modelPickerActions.current,
        })
      )
        return;
      if (dispatchingRef.current !== null || isWorking || !canSend) return;
      const operation = {};
      dispatchingRef.current = operation;
      setDispatchingId(descriptor.id);
      void dispatchSessionChatOption(descriptor, value, {
        catalog,
        state,
        beginDispatch,
        onDispatchCommand,
        onDispatchKey,
        onPickModel,
        onSwitchToTerminal,
        onSwitchingChange,
      })
        .catch(() => showOptionDispatchFailure(descriptor, value))
        .finally(() => {
          if (mountedRef.current && dispatchingRef.current === operation) {
            dispatchingRef.current = null;
            setDispatchingId(null);
          }
        });
    },
    [
      catalog,
      queuedControls,
      quickPicker,
      pickerProvider,
      canSend,
      isWorking,
      beginDispatch,
      onDispatchCommand,
      onDispatchKey,
      onPickModel,
      onSwitchToTerminal,
      onSwitchingChange,
      state,
    ]
  );

  /*
  CDXC:Drafts 2026-08-28:
  Drafts only, and only when this host can actually reach the endpoint: both
  gates have to pass before the section exists, exactly like every other
  daemon-capability + transport-capability pair in the chat surfaces.
  */
  const agentRows = onSwitchDraftAgent && draftAgents && draftAgents.length > 0 ? draftAgents : null;
  const currentDraftAgent = agentRows?.find((row) => row.agentId === draftAgentId) ?? null;

  const switchAgent = (agentId: string): void => {
    if (!onSwitchDraftAgent || agentId === draftAgentId) {
      return;
    }
    setSwitchingAgent(true);
    void onSwitchDraftAgent(agentId)
      .catch((error: unknown) => {
        /*
        The daemon refuses the switch once the draft has been promoted (its
        first prompt reached the agent). Its own sentence is the useful one, so
        it is shown as the toast description rather than replaced by a generic
        failure — and nothing here pretends the switch happened.
        */
        const target = agentRows?.find((row) => row.agentId === agentId);
        const reason = error instanceof Error ? error.message.trim() : '';
        showSessionChatOptionFailureToast(
          'Could not switch agent',
          reason !== ''
            ? reason
            : target
              ? `Ghostex couldn't switch this draft to ${target.name}.`
              : "Ghostex couldn't change which agent CLI this draft uses."
        );
      })
      .finally(() => {
        if (mountedRef.current) {
          setSwitchingAgent(false);
        }
      });
  };

  const disabled = isWorking || !canSend || dispatchingId !== null || switchingAgent;
  /** CDXC:SessionChat 2026-09-08 DECISION: User: effort, Plan mode, Fast mode and Claude permissions stay available while working, just like model selection; undeliverable choices remain queued. */
  const optionsDisabled = quickPicker ? switchingAgent : disabled;

  const agentsSubmenu = agentRows ? (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className='rounded-md'>Switch Agent CLI</DropdownMenuSubTrigger>
      <DropdownMenuSubContent className='ghostex-session-chat-popup w-64 rounded-xl [--radius:0.625rem]'>
        <DropdownMenuRadioGroup
          onValueChange={(value) => {
            if (typeof value === 'string') {
              switchAgent(value);
            }
          }}
          value={draftAgentId ?? ''}
        >
          {agentRows.map((row) => (
            <DropdownMenuRadioItem closeOnClick className='rounded-md' key={row.agentId} value={row.agentId}>
              <DraftAgentIcon icon={row.icon} />
              <span className='truncate'>{row.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  ) : null;

  /** Draft agent switcher above an existing menu body, hence the trailing rule. */
  const agentsSection = agentsSubmenu ? (
    <>
      {agentsSubmenu}
      <DropdownMenuSeparator />
    </>
  ) : null;

  /*
  CDXC:Drafts 2026-08-28:
  A draft whose agent has no option catalog (an unknown family) still needs the
  agent pill, because it is the only way to reach the switcher. It shows the
  draft's own agent instead of a model it cannot name, and its menu is the
  Switch Agent CLI submenu alone. A NON-draft session with no catalog keeps
  rendering nothing at all.
  */
  if (!catalog) {
    if (!agentsSubmenu) {
      return null;
    }
    const agentTitle = currentDraftAgent ? `Agent ${currentDraftAgent.name}` : 'Agent';
    return (
      <>
        <DropdownMenu>
          <PillTrigger
            ariaLabel={agentTitle}
            className='ghostex-chat-model-pill'
            disabled={disabled}
            icon={
              currentDraftAgent ? (
                <span className='ghostex-chat-model-pill-icon' data-icon='inline-start'>
                  <DraftAgentIcon icon={currentDraftAgent.icon} />
                </span>
              ) : undefined
            }
            label={currentDraftAgent?.name ?? 'Agent'}
            title={agentTitle}
          />
          <DropdownMenuContent align='end' className='ghostex-session-chat-popup w-64 rounded-xl [--radius:0.625rem]'>
            {agentsSubmenu}
          </DropdownMenuContent>
        </DropdownMenu>
      </>
    );
  }

  /**
   * CDXC:SessionChat 2026-09-05 DECISION:
   * User: selecting a model or effort, or toggling a mode, closes the selector for every agent, including nested and already-selected rows.
   */
  const menuRows = (descriptor: SessionChatOptionDescriptor): ReactNode => {
    const rows = sessionChatOptionRows(descriptor, state, { canPickModel, queuedControls, canSendKey });
    const current = state[descriptor.id];
    if (rows.kind === 'action' && descriptor.dispatch.kind === 'model-picker' && !canPickModel) {
      return (
        <DropdownMenuItem className='rounded-md whitespace-nowrap' onClick={() => dispatch(descriptor)}>
          {descriptor.actionLabel ?? "Open the CLI's model picker"}
        </DropdownMenuItem>
      );
    }
    /*
    CDXC:AgentScreenDetection 2026-09-05 DECISION:
    User: Fast mode updates optimistically for Codex and Claude; this supersedes waiting for the footer marker before updating the checkbox.
    `/fast` still performs the toggle, and the shared option state reconciles the result.
    */
    if (rows.kind === 'toggle' && descriptor.id === 'fastMode') {
      return (
        <DropdownMenuCheckboxItem
          checked={rows.checked}
          closeOnClick
          className='rounded-md'
          onCheckedChange={(checked) => dispatch(descriptor, checked ? 'on' : 'off')}
        >
          <span className='truncate'>{descriptor.actionLabel ?? descriptor.label}</span>
        </DropdownMenuCheckboxItem>
      );
    }
    /*
    CDXC:AgentScreenDetection 2026-09-05 DECISION:
    User: Plan mode updates optimistically and closes the selector; this supersedes waiting for the footer before updating the check mark.
    `/plan` enters Plan mode and Shift+Tab leaves it, with detection confirming both directions.
    */
    if (rows.kind === 'toggle') {
      return (
        <DropdownMenuCheckboxItem
          checked={rows.checked}
          closeOnClick
          className='rounded-md'
          disabled={rows.disabled}
          onCheckedChange={(checked) =>
            dispatch(
              checked ? descriptor : { ...descriptor, dispatch: { kind: 'key', key: 'shift-tab', marker: '' } },
              checked ? 'plan' : 'default'
            )
          }
        >
          <span className='truncate'>{descriptor.actionLabel ?? descriptor.label}</span>
        </DropdownMenuCheckboxItem>
      );
    }
    const errorRow =
      selectionError && descriptor.id === catalog?.model.id ? (
        <>
          <DropdownMenuLabel className='grid min-w-0 gap-0.5'>
            <span className='truncate'>Not applied</span>
            <span className='text-xs font-normal text-muted-foreground'>{selectionError}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
        </>
      ) : null;
    if (rows.kind === 'choices') {
      const choose = (value: unknown): void => {
        if (typeof value === 'string' && value !== current?.value) {
          dispatch(descriptor, value);
        }
      };
      const radioGroup = (choices: readonly SessionChatOptionChoice[]): ReactNode => (
        <DropdownMenuRadioGroup onValueChange={choose} value={current?.value ?? ''}>
          {choices.map((choice) => (
            <DropdownMenuRadioItem closeOnClick className='rounded-md' key={choice.value} value={choice.value}>
              <span className='grid min-w-0 gap-0.5'>
                <span className='truncate'>{choice.label}</span>
                {choice.description ? (
                  <span className='text-xs font-normal text-muted-foreground'>{choice.description}</span>
                ) : null}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      );
      const sections = rows.sections;
      if (sections.length === 1 && sections[0]?.kind === 'choices') {
        return (
          <>
            {errorRow}
            {radioGroup(sections[0].choices)}
          </>
        );
      }
      /*
      CDXC:AgentProviders 2026-09-05 DECISION:
      User: long model lists nest, so a group from the published catalog is a
      submenu here. The trigger names the selected row when the current model
      is inside it, because a collapsed submenu would otherwise be the only
      place the radio check lives.
      */
      return (
        <>
          {errorRow}
          {sections.map((section) =>
            section.kind === 'choices' ? (
              <Fragment key={section.key}>{radioGroup(section.choices)}</Fragment>
            ) : (
              <DropdownMenuSub key={section.key}>
                <DropdownMenuSubTrigger className='rounded-md'>
                  <span className='grid min-w-0 gap-0.5'>
                    <span className='truncate'>{section.group.label}</span>
                    {section.group.description ? (
                      <span className='text-xs font-normal text-muted-foreground'>{section.group.description}</span>
                    ) : null}
                  </span>
                  {(() => {
                    const selected = section.choices.find((choice) => choice.value === current?.value);
                    return selected ? (
                      <span className='ml-auto truncate text-xs text-muted-foreground'>{selected.label}</span>
                    ) : null;
                  })()}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className='ghostex-session-chat-popup w-64 rounded-xl [--radius:0.625rem]'>
                  {radioGroup(section.choices)}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )
          )}
        </>
      );
    }
    return (
      <DropdownMenuItem className='rounded-md whitespace-nowrap' onClick={() => dispatch(descriptor)}>
        {descriptor.actionLabel ?? descriptor.label}
      </DropdownMenuItem>
    );
  };

  const modelAgent = getDefaultSidebarAgentByIcon(catalog.modelIcon);
  const modelIcon = (
    <span className='ghostex-chat-model-pill-icon' data-icon='inline-start'>
      <ProjectAgentLauncherIcon
        accountIndicator={accountIndicator}
        agent={modelAgent ? { ...modelAgent, isDefault: true } : undefined}
        colorMode='brand'
      />
    </span>
  );
  const pillValues = sessionChatOptionPillValues(catalog, optionDescriptors, state);
  const modelLabel = pillValues.model;
  // Long catalog names ("Gemini 3.7 Flash", "GPT 5.3 Codex Spark") are cut
  // for the pill; the accessible name still carries the whole label.
  const modelPillLabel = pillValues.modelDisplay;
  const isCursor = catalog.modelIcon === 'cursor-cli';
  const isCodex = catalog.modelIcon === 'codex';
  const contextWindow = isCursor ? detectedOptions?.contextWindow?.trim() : undefined;
  const fastMode = state.fastMode?.value === 'on';
  const planMode = isCodex && state.mode?.value === 'plan';
  const terminalStatusLine = detectedOptions?.terminalStatusLine?.trim();
  const contextMeterUsage = resolveSessionChatContextMeterUsage(detectedOptions?.contextUsage, isCodex);
  const hasContextDetails = isCodex || catalog.modelIcon === 'claude';
  const modeButton = visibleOptions.find(isShiftTabModeCycler);
  const menuOptions = modeButton ? visibleOptions.filter((descriptor) => descriptor !== modeButton) : visibleOptions;
  /*
  Claude's catalog withholds model-scoped options (effort) until the model is
  known, so a session that is still loading has no menu options at all — which
  would erase the Options pill exactly when it should be a skeleton. If any
  model in the catalog would grow dispatchable menu options, the pill exists
  during loading too; an agent that can never have one still shows nothing.
  */
  const menuOptionsMayResolve = menuOptions.length > 0 || sessionChatOptionsMayResolve(catalog, canSendKey);
  const modeLabel = pillValues.mode;
  const modeValue = pillValues.modeValue;
  const modeIcon = modeValue ? <ClaudePermissionModeIcon mode={modeValue} /> : null;
  // CDXC:AgentScreenDetection 2026-09-05 WHY:
  // A detected effort remains known even when the host cannot dispatch its picker.
  // Building the label from dispatchable menu rows hid that value behind "Options".
  const optionsLabel = pillValues.options;
  const combinedPickerEffort = menuOptions.find(
    (descriptor) => descriptor.id === 'effort' && descriptor.dispatch.kind === 'agent-picker'
  );
  const usesCombinedAgentPicker = catalog.model.dispatch.kind === 'agent-picker' && combinedPickerEffort !== undefined;
  const modelTitle = modelLabel ? `${catalog.model.label} ${modelLabel}` : catalog.model.label;
  /** CDXC:Tooltips 2026-09-16 DECISION:
   * User: model and effort tooltips show their quick-picker hotkey, and the terminal status line moves to the context circle's tooltip.
   */
  const pickerShortcutSuffix =
    QUICK_MODEL_PICKER_ENABLED && quickPicker && modelPickerShortcut ? ` (${modelPickerShortcut})` : '';
  const modelTooltip = `Model${pickerShortcutSuffix}`;
  const menuSections = optionMenuSections(menuOptions);
  /**
   * CDXC:SessionChat 2026-09-05 DECISION:
   * User: omit "Modes" and its separator from the tooltip, and show Codex Plan as the existing map icon without "Plan" text in the pill.
   * The dropdown keeps its Modes heading and Plan mode row; the tooltip and accessible name still describe the icon.
   */
  const optionsTitle = sessionChatOptionsTitle(menuSections, isCodex && fastMode, planMode);
  const optionsTooltip = sessionChatOptionsTitle(menuSections, isCodex && fastMode, planMode, pickerShortcutSuffix);
  const optionsTrailingIcon =
    (isCodex && fastMode) || planMode ? (
      <>
        {isCodex && fastMode ? <FastModeIcon /> : null}
        {planMode ? <PlanModeIcon /> : null}
      </>
    ) : undefined;
  const modeTitle = modeLabel ?? 'Mode';
  /**
   * CDXC:AgentScreenDetection 2026-09-09 DECISION:
   * User: always show skeletons when the model or options have not been detected, never the generic "Model" or "Options" labels, including when queued controls are enabled.
   * This supersedes settling those pills to category labels after the first screen probe.
   */
  const skeletonFor = (pill: PillSkeleton, value: string | null | undefined): PillSkeleton | undefined =>
    !value && (pill !== 'mode' || !screenProbed) ? pill : undefined;

  const optionsMenuContent = (
    <>
      {menuSections.map((section, index) => (
        <Fragment key={section.label}>
          {index > 0 ? <DropdownMenuSeparator /> : null}
          {/* Base UI's GroupLabel throws outside a Menu.Group context. */}
          <DropdownMenuGroup>
            <DropdownMenuLabel>{section.label}</DropdownMenuLabel>
            {section.description ? (
              <DropdownMenuLabel className='whitespace-normal pt-0'>{section.description}</DropdownMenuLabel>
            ) : null}
            {section.descriptors.map((descriptor) => (
              <Fragment key={descriptor.id}>{menuRows(descriptor)}</Fragment>
            ))}
          </DropdownMenuGroup>
        </Fragment>
      ))}
    </>
  );
  const showOptions =
    menuOptions.length > 0 || (menuOptionsMayResolve && skeletonFor('options', optionsLabel) !== undefined);
  const contextMeter = (inMenu = false) =>
    contextMeterUsage || hasContextDetails ? (
      <SessionChatContextMeter
        inMenu={inMenu}
        statusLine={terminalStatusLine}
        compactDisabled={disabled}
        compactDisabledReason={isWorking ? 'Available once the agent is idle.' : null}
        onCompact={() => {
          void onDispatchCommand('/compact');
        }}
        usage={contextMeterUsage ?? { usedPercentage: null, usedTokens: null, windowSize: null }}
        {...(contextDetails ? { details: contextDetails } : {})}
        {...(contextDetails && onEditContextDetails ? { onEditDetails: onEditContextDetails } : {})}
      />
    ) : null;

  /**
   * CDXC:SessionChat 2026-09-14 DECISION:
   * User: when the context ring and effort would overlap the model, move them into a new section at the very top of More actions.
   * User: effort and context controls open when clicked, not hovered.
   * The existing toolbar actions overflow first; the same measured width budget returns these controls when space opens up.
   */
  const overflowMenu =
    showOptions || contextMeterUsage || hasContextDetails ? (
      <>
        {showOptions ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger
              openOnHover={false}
              disabled={optionsDisabled || skeletonFor('options', optionsLabel) !== undefined}
            >
              {optionsTitle}
              <span className='ml-auto text-xs text-muted-foreground'>{optionsLabel}</span>
              {optionsTrailingIcon}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className='ghostex-session-chat-popup w-60 rounded-xl [--radius:0.625rem]'>
              {optionsMenuContent}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
        {contextMeter(true)}
      </>
    ) : null;

  /*
  Read-only pills (grok): both values come from the statusline gxserver reads,
  and either pill hands the user to the terminal — where the host also raises
  the "set it in the CLI, then come back" toast — instead of opening a menu
  this side cannot honour.
  */
  if (catalog.model.dispatch.kind === 'terminal-handoff') {
    const handoffTitle = (
      descriptor: SessionChatOptionDescriptor | null,
      category: string,
      value: string | null
    ): string =>
      descriptor?.handoffHint ??
      (value ? `${category} ${value}. Change it in the CLI.` : `${category}. Set it in the CLI.`);
    const modelHandoffTitle = handoffTitle(catalog.model, catalog.model.label, modelLabel);
    const optionsHandoffTitle = handoffTitle(
      visibleOptions.length === 1 ? (visibleOptions[0] ?? null) : null,
      visibleOptions.length === 1 ? (visibleOptions[0]?.label ?? 'Options') : 'Options',
      optionsLabel
    );
    return (
      <>
        {/*
        CDXC:Drafts 2026-08-28:
        On a draft the model pill has to open a menu even here, because the
        Switch Agent CLI submenu lives inside it. The handoff itself stays
        below that row, so the read-only pill loses nothing by growing one.
        */}
        {agentsSection ? (
          <DropdownMenu>
            <PillTrigger
              ariaLabel={modelHandoffTitle}
              className='ghostex-chat-model-pill'
              disabled={disabled}
              icon={modelIcon}
              label={modelPillLabel ?? catalog.model.label}
              skeleton={skeletonFor('model', modelLabel)}
              title={modelHandoffTitle}
              tooltipWhenDisabled
            />
            <DropdownMenuContent align='end' className='ghostex-session-chat-popup w-64 rounded-xl [--radius:0.625rem]'>
              {agentsSection}
              <DropdownMenuGroup>
                <DropdownMenuLabel>{catalog.model.label}</DropdownMenuLabel>
                <DropdownMenuItem
                  className='rounded-md'
                  disabled={onSwitchToTerminal === undefined}
                  onClick={() => onSwitchToTerminal?.()}
                >
                  {catalog.model.actionLabel ?? 'Change it in the CLI'}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <PillButton
            ariaLabel={modelHandoffTitle}
            className='ghostex-chat-model-pill'
            disabled={onSwitchToTerminal === undefined}
            icon={modelIcon}
            label={modelPillLabel ?? catalog.model.label}
            onClick={() => onSwitchToTerminal?.()}
            skeleton={skeletonFor('model', modelLabel)}
            title={modelHandoffTitle}
            tooltipWhenDisabled
          />
        )}
        {visibleOptions.length > 0 ? (
          <PillButton
            ariaLabel={optionsHandoffTitle}
            className='ghostex-chat-options-pill'
            disabled={onSwitchToTerminal === undefined}
            label={optionsLabel ?? 'Options'}
            onClick={() => onSwitchToTerminal?.()}
            skeleton={skeletonFor('options', optionsLabel)}
            title={optionsHandoffTitle}
          />
        ) : null}
      </>
    );
  }

  if (usesCombinedAgentPicker) {
    const effortLabel = sessionChatOptionValueLabel(combinedPickerEffort, state);
    const selectedLabel = [modelLabel, effortLabel].filter(Boolean).join(' · ');
    const combinedLabel = [modelPillLabel, effortLabel].filter(Boolean).join(' · ') || 'Model & Effort';
    const combinedTitle = selectedLabel ? `Model & Effort ${selectedLabel}` : 'Model & Effort';

    return (
      <>
        <DropdownMenu>
          <PillTrigger
            ariaLabel={combinedTitle}
            className='ghostex-chat-model-pill'
            disabled={disabled}
            icon={modelIcon}
            label={combinedLabel}
            skeleton={skeletonFor('combined', selectedLabel)}
            title={combinedTitle}
            tooltipWhenDisabled
          />
          <DropdownMenuContent align='start' className='ghostex-session-chat-popup w-60 rounded-xl [--radius:0.625rem]'>
            {agentsSection}
            <DropdownMenuItem className='rounded-md' onClick={() => dispatch(catalog.model)}>
              Select Model &amp; Effort in CLI
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </>
    );
  }

  /**
   * CDXC:SessionChat 2026-09-21 DECISION:
   * User: the model and effort pills merge into one pill that opens one picker, a click saves the agent's default and a right-click applies to this session only.
   * Every agent with a published lineup gets it; the Cursor context pill and the draft's Switch Agent CLI submenu become footer rows of the same card. The mode pill and the context ring stay where they were, and only the ring still moves into More actions when the row runs out of room.
   * SEE-ALSO: packages/shared/session-chat-controller/native-host.ts (`modelMenuPick`, `modelMenuTrait`) applies the same picks for the GPUI chat.
   */
  if (pickerProvider) {
    const menuContext: ModelMenuContext = {
      provider: pickerProvider,
      modelId: catalog.model.id,
      modelDefault: catalog.model.defaultValue,
      modelLabel,
      descriptors: visibleOptions,
      state,
      caps: { canPickModel, queuedControls, canSendKey },
      selectionError,
      disabled: !canPickModel,
    };
    const isDraft = draftAgents !== undefined && draftAgents.length > 0;
    const draftAgentFor = (provider: string) => agentRows?.find((row) => modelPickerProvider(row.icon) === provider);
    // Where the agent tells the two scopes apart, picking the running value again still moves it between them.
    const unchanged = (descriptor: SessionChatOptionDescriptor, value: string) =>
      state[descriptor.id]?.value === value &&
      !(
        (descriptor.id === catalog.model.id || descriptor.id === 'effort') &&
        modelPickerSupportsSessionScope(pickerProvider)
      );
    const extraRows: SessionChatModelMenuExtraRow[] = [];
    if (contextWindow)
      extraRows.push({
        id: 'cursor-context',
        label: 'Context Window',
        valueLabel: contextWindow,
        disabled,
        choices: [{ value: 'cli', label: 'Change it in the CLI', selected: false, isDefault: false }],
        onChoose: () => dispatch(CURSOR_MODEL_SETTINGS_PICKER),
      });
    // Tabs switch a draft to the first agent of a family; this row reaches every agent, custom ones included.
    if (agentRows)
      extraRows.push({
        id: 'draft-agent',
        label: 'Agent CLI',
        valueLabel: currentDraftAgent?.name ?? null,
        disabled: switchingAgent,
        choices: agentRows.map((row) => ({
          value: row.agentId,
          label: row.name,
          selected: row.agentId === draftAgentId,
          isDefault: false,
        })),
        onChoose: (choice) => switchAgent(choice.value),
      });
    const pillTrailingIcon =
      fastMode || planMode ? (
        <>
          {fastMode ? <FastModeIcon /> : null}
          {planMode ? <PlanModeIcon /> : null}
        </>
      ) : undefined;
    return (
      <>
        <SessionChatComposerOptionsMenu>
          {contextMeterUsage || hasContextDetails ? contextMeter(true) : null}
        </SessionChatComposerOptionsMenu>
        <SessionChatModelPickerLauncher
          key={controller.sessionKey}
          actionsRef={modelPickerActions}
          controller={controller}
          onQueueModel={onQueueModel}
          pendingModelSelection={pendingModelSelection}
        />
        <SessionChatModelMenu
          canOfferProvider={(provider) =>
            provider === pickerProvider ||
            (isDraft ? draftAgentFor(provider) !== undefined : onHandoffToModel !== undefined)
          }
          context={menuContext}
          extraRows={extraRows}
          onPickRow={(row, secondary) => {
            const pick = modelMenuPick(row, menuContext);
            if (pick.kind === 'select') {
              if (!unchanged(catalog.model, pick.value)) dispatch(catalog.model, pick.value, secondary);
              return;
            }
            // A draft has no conversation to hand over, so another agent's model switches the draft to that agent.
            if (isDraft) {
              const target = draftAgentFor(pick.provider);
              if (target) switchAgent(target.agentId);
              return;
            }
            onHandoffToModel?.(pick);
          }}
          onPickTrait={(trait, choice, secondary) => {
            const descriptor =
              trait.id === 'context' ? catalog.model : visibleOptions.find((entry) => entry.id === trait.id);
            if (!descriptor || unchanged(descriptor, choice.value)) return;
            dispatch(
              choice.exitPlan ? { ...descriptor, dispatch: { kind: 'key', key: 'shift-tab', marker: '' } } : descriptor,
              choice.value,
              secondary
            );
          }}
          onReturnFocus={onReturnFocusToComposer}
          pill={{
            ariaLabel: [modelTitle, optionsLabel].filter(Boolean).join(' · '),
            disabled: switchingAgent,
            icon: modelIcon,
            loadingText: pillLoadingText('combined'),
            suffixExtra: contextWindow,
            tooltip: `Model and reasoning${pickerShortcutSuffix}`,
            trailingIcon: pillTrailingIcon,
          }}
        />
        {modeButton ? (
          <DropdownMenu>
            <PillTrigger
              ariaLabel={modeTitle}
              className='ghostex-chat-mode-pill ghostex-chat-mode-pill-icon-only'
              disabled={optionsDisabled || (!queuedControls && modeValue === undefined)}
              icon={modeIcon}
              iconOnly
              label={modeLabel ?? modeButton.label}
              skeleton={queuedControls ? undefined : skeletonFor('mode', modeLabel)}
              title={modeTitle}
            />
            <DropdownMenuContent align='end' className='ghostex-session-chat-popup w-60 rounded-xl [--radius:0.625rem]'>
              <DropdownMenuGroup>
                <DropdownMenuLabel>{modeButton.label}</DropdownMenuLabel>
                {modeButton.description ? (
                  <DropdownMenuLabel className='whitespace-normal pt-0'>{modeButton.description}</DropdownMenuLabel>
                ) : null}
                {menuRows(modeButton)}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {contextMeterUsage || hasContextDetails ? (
          <span data-composer-option-overflow='context'>{contextMeter()}</span>
        ) : null}
      </>
    );
  }

  return (
    <>
      <SessionChatComposerOptionsMenu>{overflowMenu}</SessionChatComposerOptionsMenu>
      <SessionChatModelPickerLauncher
        key={controller.sessionKey}
        actionsRef={modelPickerActions}
        controller={controller}
        onQueueModel={onQueueModel}
        pendingModelSelection={pendingModelSelection}
      />
      <DropdownMenu>
        <PillTrigger
          ariaLabel={modelTitle}
          className='ghostex-chat-model-pill'
          disabled={quickPicker ? switchingAgent : disabled}
          allowWhileLoading={quickPicker}
          icon={modelIcon}
          label={modelPillLabel ?? catalog.model.label}
          skeleton={skeletonFor('model', modelLabel)}
          title={modelTooltip}
          tooltipWhenDisabled
        />
        <DropdownMenuContent align='end' className='ghostex-session-chat-popup w-64 rounded-xl [--radius:0.625rem]'>
          {agentsSection}
          {QUICK_MODEL_PICKER_ENABLED && quickPicker && (
            <DropdownMenuItem closeOnClick className='rounded-md' onClick={() => modelPickerActions.current?.open()}>
              Quick picker <span className='ml-auto text-xs text-muted-foreground'>{modelPickerShortcut}</span>
            </DropdownMenuItem>
          )}
          {/* Base UI's GroupLabel throws outside a Menu.Group context. */}
          <DropdownMenuGroup>
            <DropdownMenuLabel>{catalog.model.label}</DropdownMenuLabel>
            {catalog.model.description ? (
              <DropdownMenuLabel className='whitespace-normal pt-0'>{catalog.model.description}</DropdownMenuLabel>
            ) : null}
            {menuRows(catalog.model)}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* The trigger is disabled while its skeleton shows, so the empty menu a
          still-loading pill would open is unreachable. */}
      {showOptions ? (
        <span data-composer-option-overflow='effort'>
          <DropdownMenu>
            <PillTrigger
              ariaLabel={optionsTitle}
              className='ghostex-chat-options-pill'
              disabled={optionsDisabled}
              label={optionsLabel ?? 'Options'}
              skeleton={skeletonFor('options', optionsLabel)}
              title={optionsTooltip}
              trailingIcon={optionsTrailingIcon}
            />
            <DropdownMenuContent align='end' className='ghostex-session-chat-popup w-60 rounded-xl [--radius:0.625rem]'>
              {optionsMenuContent}
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      ) : null}
      {contextWindow ? (
        <DropdownMenu>
          <PillTrigger
            ariaLabel={`Context${fastMode ? ' • Fast enabled' : ''}`}
            className='ghostex-chat-context-pill'
            disabled={disabled}
            label={contextWindow}
            title={`Context${fastMode ? ' • Fast enabled' : ''}`}
            trailingIcon={fastMode ? <FastModeIcon /> : undefined}
          />
          <DropdownMenuContent align='end' className='ghostex-session-chat-popup w-60 rounded-xl [--radius:0.625rem]'>
            <DropdownMenuGroup>
              <DropdownMenuLabel>Model settings</DropdownMenuLabel>
              {menuRows(CURSOR_MODEL_SETTINGS_PICKER)}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {modeButton ? (
        <DropdownMenu>
          <PillTrigger
            ariaLabel={modeTitle}
            className='ghostex-chat-mode-pill ghostex-chat-mode-pill-icon-only'
            disabled={optionsDisabled || (!queuedControls && modeValue === undefined)}
            icon={modeIcon}
            iconOnly
            label={modeLabel ?? modeButton.label}
            skeleton={queuedControls ? undefined : skeletonFor('mode', modeLabel)}
            title={modeTitle}
          />
          <DropdownMenuContent align='end' className='ghostex-session-chat-popup w-60 rounded-xl [--radius:0.625rem]'>
            <DropdownMenuGroup>
              <DropdownMenuLabel>{modeButton.label}</DropdownMenuLabel>
              {modeButton.description ? (
                <DropdownMenuLabel className='whitespace-normal pt-0'>{modeButton.description}</DropdownMenuLabel>
              ) : null}
              {menuRows(modeButton)}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {contextMeterUsage || hasContextDetails ? (
        <span data-composer-option-overflow='context'>{contextMeter()}</span>
      ) : null}
    </>
  );
}
