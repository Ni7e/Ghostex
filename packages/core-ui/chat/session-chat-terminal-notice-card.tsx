import {
  COLLAPSED_CHOICE_COUNT,
  collapsedChoiceLabel,
} from '@/packages/shared/session-chat-presentation/notice-choices';
import {
  dismissedNoticeState,
  isNoticeDismissed,
  readStoredDismissedNotice,
  sessionChatTerminalNoticeDismissKey,
  writeStoredDismissedNotice,
  type DismissedNotice,
} from '@/packages/shared/session-chat-controller/notice-state';
export {
  sessionChatTerminalNoticeDismissKey,
  NOTICE_REDISPLAY_COOLDOWN_MS,
} from '@/packages/shared/session-chat-controller/notice-state';
import { formatSidebarHotkeyLabel } from '@/packages/core-ui/hotkey-label';
/*
CDXC:AgentScreenDetection 2026-08-19:
Banner for state the agent paints only on its TERMINAL SCREEN — an expired
login, a workspace-trust dialog, a usage-limit banner, a stream error, the CLI
having exited — plus the send watchdog's report that a message could not be
proven delivered. A transcript projection can never show any of it, so gxserver
classifies the screen capture it already reads for the option pills and hands
the result over as `terminalNotice`.

It wears the interactive card's visual language (shell / panel / action row)
tinted by severity, and sits directly above that card in the composer stack.
The `kind` is an OPEN set: an unknown kind from a newer daemon still renders
as title + detail + actions. Account recovery is offered only for known account notices.

Dismissal is local and per-detection: hiding a notice remembers `kind` +
`detectedAt`, so the same detection stays hidden while a NEW one (a fresh
`detectedAt`) shows again. The server keeps re-sending an unresolved notice, so
a dismissal is a "I know, hide it" — never a resolution.

CDXC:AgentScreenDetection 2026-08-28: the dismissed key is persisted per
session in localStorage (same per-session shape as the verbose pill), because
switching to the terminal and back can remount — or fully reload — this view,
and a dismissal that only lived in component state made the same detection pop
right back up. Only the latest dismissed key per session is kept.

CDXC:SessionChat 2026-08-21:
A notice that carries `choices` is not just news, it is an ANSWERABLE picker the
agent CLI painted on screen (Claude Code's resume-usage chooser). Those rows
render with the same component the AskUserQuestion card uses, and the pick goes
back through answerSessionChatPrompt's `terminalChoice` lane — which re-reads
the live screen, so the row the user sees marked as the CLI's default here is
never what drives the keystrokes.

A picker is not dismissable: hiding it would leave sending blocked with
nothing on screen explaining why, since the CLI cannot accept the draft until
it is answered. The composer stays editable. "Open terminal" stays as the escape hatch.

CDXC:AgentScreenDetection 2026-09-03:
User decision: expanding terminal output starts at the newest text. (Until 2026-09-16 the Terminal action shared the output toggle's row; it now lives in the footer band with every other action, per the shared card decision below.)
User decision (2026-09-03, superseded 2026-09-16): the cards used to carry no severity icon. Since 2026-09-16 every card leads with an icon (info circle, warning triangle, red alert circle by severity) on the shared status card, and an error keeps its red border.

CDXC:AgentScreenDetection 2026-09-03:
User decision: a dismissed notice must stay dismissed until it makes sense to show it again.
The exact `detectedAt` key alone was not enough: a screen banner (Claude Code's usage-limit line) that misses one probe comes back with a fresh `detectedAt`, and the card the user had just closed reappeared every few seconds.
gxserver now keeps the timestamp across short gaps, and this side remembers the dismissed notice's identity (`kind` + `title`) with the dismissal time: the same screen-state words re-detected within `NOTICE_REDISPLAY_COOLDOWN_MS` stay hidden, a different notice shows at once, and the same words after the cooldown are treated as a new event.
Watchdog notices (`deliveryFailed`, an undelivered-send verdict) are exempt from the cooldown because each one reports a distinct lost message.

CDXC:SessionChat 2026-09-04 DECISION:
User: a picker card first shows collapsed and compact, with only its first two options side by side (the " (recommended)" suffix dropped), and clicking the title expands it to the full card (detail, every option, terminal output). The chevron sits in the header's trailing slot.
CDXC:SessionChat 2026-09-16 DECISION: User: notices are the shared status card. Actions sit right-aligned in the footer band with a keyed action on the left; the 2026-09-07 20px padding rule is superseded by the card's shared padding.
User: no "Selected in terminal" badge on any picker row, in any state.
User: picking an option is optimistic: the card disappears at once while the answer is sent in the background; it only comes back, with its failure line, when the daemon proves the answer did not land.
*/

import {
  IconAlertCircle,
  IconAlertTriangle,
  IconChevronRight,
  IconInfoCircle,
  IconSwitchHorizontal,
  IconTerminal2,
} from '@tabler/icons-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { GxserverAnswerSessionChatPromptParams, SessionChatTerminalNotice } from '../../shared/session-chat';
import { cn } from '@/packages/components/utils';
import { detectghostexHotkeyPlatform } from '@/packages/shared/ghostex-hotkeys';
import { sessionChatKeyboardPopupOpen } from './session-chat-caret-navigation';
import { Button } from '../../components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '../../components/ui/dropdown-menu';
import { SessionChatChoiceRows } from './session-chat-choice-rows';
import {
  SessionChatStatusCard,
  SessionChatStatusCardActions,
  SessionChatStatusCardChevron,
  SessionChatStatusCardLead,
} from './session-chat-status-card';
import { SessionChatTerminalDialogCard } from './session-chat-terminal-dialog';

const SEND_FAILED_NOTICE = "Couldn't deliver those keys. Switch to Terminal View to act there.";
const READ_ONLY_HINT = 'Input is held by another device.';
const CHOICE_FAILED_NOTICE = "Couldn't send your choice. Please try again.";
export interface SessionChatTerminalNoticeCardProps {
  notice: SessionChatTerminalNotice | null;
  /**
   * Stable identity of the session this card belongs to, keying the persisted
   * dismissal. Without it a dismissal lives only as long as the mount.
   */
  sessionKey?: string;
  /** False while another device holds input: `sendKeys` actions go read-only. */
  canSend: boolean;
  /**
   * Writes an action's raw bytes verbatim through answerSessionChatPrompt's
   * approval lane — the same path the interactive card's Allow/Deny uses.
   */
  onSendKeys: (send: string) => Promise<void>;
  onFocusSession?: (target: { projectId: string; sessionId: string }) => Promise<void>;
  /**
   * Answers an on-screen picker by row index. Rejects when the picker has left
   * the screen, which the card reports rather than swallowing: the alternative
   * is a card that looks answered while the CLI still waits.
   */
  onAnswerChoice?: (choiceIndex: number) => Promise<void>;
  onAnswerDialog?: (params: Omit<GxserverAnswerSessionChatPromptParams, 'projectId' | 'sessionId'>) => Promise<void>;
  /** Host switch-back; `switchToTerminal` actions hide when the host has none. */
  onSwitchToTerminal?: () => void;
  renderAccountMenu?: (close: () => void) => ReactNode;
  /**
   * Formatted effective shortcut for the host's Terminal/Chat view switch,
   * shown beside `switchToTerminal` actions so the card teaches the chord.
   */
  switchToTerminalShortcut?: string;
  /** Whether keyboard shortcut hints are rendered in the notice card. */
  showShortcutLabels?: boolean;
  /**
   * Reports whether this card is on screen. The parent stacks the card above
   * the composer and needs to know it is there — the new-session welcome is a
   * centered overlay that would otherwise paint straight through it — and the
   * per-detection dismissal that decides it lives only in here.
   */
  onVisibleChange?: (visible: boolean) => void;
}

/** An action this build knows how to run, with its payload already proven. */
type RenderableNoticeAction =
  | { id: string; label: string; kind: 'switchToTerminal' }
  | { id: string; label: string; kind: 'sendKeys'; send: string }
  | { id: string; label: string; kind: 'recoverCodexConversation' };

export function SessionChatTerminalNoticeCard({
  canSend,
  notice,
  onAnswerChoice,
  onAnswerDialog,
  onSendKeys,
  onFocusSession,
  onSwitchToTerminal,
  onVisibleChange,
  renderAccountMenu,
  sessionKey,
  showShortcutLabels = true,
  switchToTerminalShortcut,
}: SessionChatTerminalNoticeCardProps) {
  const [dismissed, setDismissed] = useState<DismissedNotice | null>(() => readStoredDismissedNotice(sessionKey));
  // The card can outlive a session switch when the host reuses the mount.
  useLayoutEffect(() => {
    setDismissed(readStoredDismissedNotice(sessionKey));
  }, [sessionKey]);
  const [tailOpen, setTailOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const [choiceError, setChoiceError] = useState<string | null>(null);
  const [pickedChoice, setPickedChoice] = useState<number | null>(null);
  // Optimistic answer: the notice key whose picker was answered from here and
  // is hidden while the daemon confirms. Cleared only by a failed answer or a
  // new detection.
  const [answeredKey, setAnsweredKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const sendingRef = useRef(false);
  const screenTailRef = useRef<HTMLPreElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const isMac = detectghostexHotkeyPlatform() === 'mac';
  const primaryShortcutLabel = formatSidebarHotkeyLabel('cmd+enter');

  const noticeKey = sessionChatTerminalNoticeDismissKey(notice);
  const dismiss = (): void => {
    if (notice === null || noticeKey === null) {
      return;
    }
    const next = dismissedNoticeState(notice);
    writeStoredDismissedNotice(sessionKey, next);
    setDismissed(next);
  };

  // Every fresh detection starts clean: tail collapsed, no stale send state.
  // The dismissal is deliberately NOT reset here — it holds the identity of
  // the notice the user hid, and only a different identity outlives it.
  useLayoutEffect(() => {
    sendingRef.current = false;
    setSending(false);
    setSendFailed(false);
    setChoiceError(null);
    setPickedChoice(null);
    setAnsweredKey(null);
    setExpanded(false);
    setTailOpen(false);
  }, [noticeKey]);

  useLayoutEffect(() => {
    if (tailOpen && screenTailRef.current) {
      screenTailRef.current.scrollTop = screenTailRef.current.scrollHeight;
    }
  }, [notice?.screenTail, tailOpen]);

  const visible =
    notice !== null && noticeKey !== null && noticeKey !== answeredKey && !isNoticeDismissed(notice, dismissed);

  useEffect(() => {
    onVisibleChange?.(visible);
    return () => onVisibleChange?.(false);
  }, [onVisibleChange, visible]);

  // A picker the daemon proved is answerable from here. Rows without labels are
  // dropped: an unlabelled row is a keystroke with no name, which is exactly
  // the blind confirm this feature exists to stop.
  const choices = (notice?.choices ?? []).filter((choice) => choice.label.trim().length > 0);
  const answerable = choices.length > 0 && onAnswerChoice !== undefined;
  /** CDXC:SessionChat 2026-09-07 DECISION: User: the rate-limit picker already has clickable options, so omit its redundant Previous/Next/Confirm/Cancel controls and terminal footer. */
  const rateLimitPicker =
    answerable && choices.some((choice) => /^Wait here, then continue automatically\b/i.test(choice.label.trim()));

  const answerChoice = (choiceIndex: number): void => {
    if (sendingRef.current || !canSend || !onAnswerChoice) {
      return;
    }
    sendingRef.current = true;
    setSending(true);
    setChoiceError(null);
    setPickedChoice(choiceIndex);
    // Optimistic: the card leaves the screen now; the keystrokes land in the background.
    setAnsweredKey(noticeKey);
    void onAnswerChoice(choiceIndex)
      .catch((error: unknown) => {
        // Keep the server's reason: an open dialog and a stale dialog need
        // different guidance even though both reject the answer.
        setChoiceError(error instanceof Error ? error.message : CHOICE_FAILED_NOTICE);
        setPickedChoice(null);
        setAnsweredKey(null);
      })
      .finally(() => {
        sendingRef.current = false;
        setSending(false);
      });
  };

  const answerChoiceRef = useRef(answerChoice);
  answerChoiceRef.current = answerChoice;
  const keyboardAnswerable = visible && answerable && canSend && !sending && pickedChoice === null;
  const primaryChoiceIndex = choices[0]?.index;
  const secondaryChoiceIndex = choices[1]?.index;

  const firstSendAction =
    !answerable && notice
      ? (notice.actions ?? []).find(
          (action) =>
            (action.kind === 'sendKeys' && action.send !== undefined) ||
            (action.kind === 'recoverCodexConversation' && notice.conversationLock && onAnswerDialog)
        )
      : undefined;

  const runNoticeAction = (action: { kind: string; send?: string }): void => {
    if (sendingRef.current || !canSend) {
      return;
    }
    if (
      action.kind === 'recoverCodexConversation'
        ? !notice?.conversationLock || !onAnswerDialog
        : action.send === undefined
    )
      return;
    sendingRef.current = true;
    setSending(true);
    setSendFailed(false);
    setChoiceError(null);
    const request =
      action.kind === 'recoverCodexConversation' && notice?.conversationLock && onAnswerDialog
        ? onAnswerDialog({ kind: 'recoverCodexConversation', conversationLock: notice.conversationLock })
        : onSendKeys(action.send!);
    void request
      .catch((error: unknown) => {
        if (action.kind === 'recoverCodexConversation') {
          setChoiceError(error instanceof Error ? error.message : 'Could not recover the conversation. Please retry.');
          return;
        }
        // The keystrokes never reached the TUI: say so instead of pretending
        // the notice was handled.
        setSendFailed(true);
      })
      .finally(() => {
        sendingRef.current = false;
        setSending(false);
      });
  };

  const runNoticeActionRef = useRef(runNoticeAction);
  runNoticeActionRef.current = runNoticeAction;
  const keyboardInputAction =
    visible &&
    firstSendAction !== undefined &&
    canSend &&
    !(notice?.dialog && notice.dialog.rows.length === 0 && onAnswerDialog);

  /**
   * CDXC:SessionChat 2026-09-07 DECISION:
   * User: Command+Enter picks the left action and Escape picks the second action while the chat draft stays editable. Numeric keys remain available for typing.
   * Windows and Linux use Control+Enter for the primary action. Capture within the focused chat before the composer can submit or interrupt; open popups keep their keyboard ownership.
   */
  useEffect(() => {
    if (!keyboardAnswerable && !keyboardInputAction) return;
    const root = cardRef.current?.closest<HTMLElement>('.ghostex-session-chat-scope');
    if (!root) return;
    const handler = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.repeat || event.isComposing || event.altKey || event.shiftKey) return;
      const primary =
        event.key === 'Enter' && (isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey);
      const secondary = event.key === 'Escape' && !event.metaKey && !event.ctrlKey;
      if (!primary && !secondary) return;
      if (!(event.target instanceof Element) || event.target.closest('.ghostex-session-chat-scope') !== root) return;
      if (sessionChatKeyboardPopupOpen(root) || root.querySelector('.ghostex-chat-composer-picker')) return;
      const choiceIndex = primary ? primaryChoiceIndex : secondaryChoiceIndex;
      if (keyboardAnswerable && choiceIndex !== undefined) {
        event.preventDefault();
        event.stopPropagation();
        answerChoiceRef.current(choiceIndex);
      } else if (primary && keyboardInputAction && firstSendAction !== undefined) {
        event.preventDefault();
        event.stopPropagation();
        runNoticeActionRef.current(firstSendAction);
      }
    };
    root.ownerDocument.addEventListener('keydown', handler, true);
    return () => root.ownerDocument.removeEventListener('keydown', handler, true);
  }, [
    firstSendAction,
    isMac,
    keyboardAnswerable,
    keyboardInputAction,
    primaryChoiceIndex,
    secondaryChoiceIndex,
    noticeKey,
  ]);

  if (!visible || !notice) {
    return null;
  }
  if (notice.dialog && notice.dialog.rows.length === 0 && onAnswerDialog) {
    return (
      <SessionChatTerminalDialogCard
        key={notice.dialog.title}
        dialog={notice.dialog}
        canSend={canSend}
        onAnswer={onAnswerDialog}
        ref={cardRef}
        severity={notice.severity}
      />
    );
  }

  // Actions are normalized here so the render below never has to re-prove that
  // a `sendKeys` action carries bytes. An action kind this build does not know
  // is DROPPED rather than guessed at — the title/detail still stand on their
  // own, and a button whose behaviour we cannot name would lie about what it
  // does.
  const actions: RenderableNoticeAction[] = [];
  for (const action of notice.actions ?? []) {
    if (action.kind === 'switchToTerminal') {
      if (onSwitchToTerminal) {
        actions.push({ id: action.id, kind: 'switchToTerminal', label: action.label });
      }
    } else if (action.kind === 'recoverCodexConversation' && notice.conversationLock && onAnswerDialog) {
      actions.push({ id: action.id, kind: action.kind, label: action.label });
    } else if (action.kind === 'sendKeys' && action.send !== undefined) {
      // A `sendKeys` action without bytes has nothing to write; an inert button
      // would claim an ability the notice never carried.
      actions.push({
        id: action.id,
        kind: 'sendKeys',
        label: action.label,
        send: action.send,
      });
    }
  }

  const inputActions = actions.filter(
    (action): action is Exclude<RenderableNoticeAction, { kind: 'switchToTerminal' }> =>
      action.kind !== 'switchToTerminal'
  );
  const switchToTerminalActions = actions.filter(
    (action): action is Extract<RenderableNoticeAction, { kind: 'switchToTerminal' }> =>
      action.kind === 'switchToTerminal'
  );
  // A picker starts collapsed: title, its first rows, and an expand control.
  // Everything else (detail prose, remaining rows, terminal output) waits
  // behind the expand button so the card takes as little of the composer
  // stack as an answer needs.
  const collapsed = answerable && !expanded;
  const choiceOptions = choices.map((choice) => ({
    label: collapsed ? collapsedChoiceLabel(notice.dialog?.rows[choice.index]?.label ?? choice.label) : choice.label,
  }));
  const toggleExpanded = (): void => setExpanded((value) => !value);
  const accountMenu =
    renderAccountMenu && (notice.kind === 'loginExpired' || notice.kind === 'usageLimit') ? (
      <NoticeAccountMenu key={sessionKey} renderMenu={renderAccountMenu} />
    ) : null;
  const severityIcon =
    notice.severity === 'error' ? IconAlertCircle : notice.severity === 'warning' ? IconAlertTriangle : IconInfoCircle;
  const terminalButtons = switchToTerminalActions.map((action) => (
    <Button key={action.id} onClick={onSwitchToTerminal} size='sm' variant='outline'>
      <IconTerminal2 aria-hidden='true' stroke={2} />
      {action.label}
      {showShortcutLabels && switchToTerminalShortcut ? (
        <kbd className='ghostex-chat-card-hint [--chat-card-hint-base:0.625rem] ml-0.5 flex h-4 shrink-0 items-center rounded border border-border/60 bg-background/50 px-1 text-[10px] font-medium text-muted-foreground'>
          {switchToTerminalShortcut}
        </kbd>
      ) : null}
    </Button>
  ));
  const otherSession = notice.conversationLock?.sessions[0];
  const otherSessionButton =
    otherSession && onFocusSession ? (
      <Button
        size='sm'
        variant='outline'
        disabled={sending}
        onClick={() => {
          void onFocusSession(otherSession).catch((error: unknown) => {
            setChoiceError(error instanceof Error ? error.message : 'Could not open the other session.');
          });
        }}
      >
        Go to other session
      </Button>
    ) : null;
  const escapeHatch = accountMenu || switchToTerminalActions.length > 0 || otherSessionButton;
  const footer =
    !collapsed && (inputActions.length > 0 || escapeHatch) ? (
      <>
        {inputActions.map((action, inputIndex) => (
          <Button
            disabled={!canSend || sending}
            key={action.id}
            onClick={() => runNoticeAction(action)}
            size='sm'
            variant='outline'
            {...(canSend ? {} : { title: READ_ONLY_HINT })}
          >
            {sending && action.kind === 'recoverCodexConversation' ? 'Continuing…' : action.label}
            {showShortcutLabels && inputIndex === 0 && keyboardInputAction ? (
              <kbd className='ghostex-chat-card-hint [--chat-card-hint-base:0.625rem] ml-0.5 flex h-4 min-w-4 shrink-0 items-center justify-center rounded border border-border/60 bg-background/50 px-1 text-[10px] font-medium text-muted-foreground tabular-nums'>
                {primaryShortcutLabel}
              </kbd>
            ) : null}
          </Button>
        ))}
        {escapeHatch ? (
          <SessionChatStatusCardActions>
            {accountMenu}
            {otherSessionButton}
            {terminalButtons}
          </SessionChatStatusCardActions>
        ) : null}
      </>
    ) : undefined;
  return (
    <SessionChatStatusCard
      className='ghostex-chat-terminal-notice'
      data-kind={notice.kind}
      data-severity={notice.severity}
      footer={footer}
      lead={
        <SessionChatStatusCardLead
          className={notice.severity === 'error' ? 'text-destructive' : undefined}
          icon={severityIcon}
        />
      }
      ref={cardRef}
      role='status'
      severity={notice.severity}
      title={notice.title}
      {...(answerable
        ? {
            headerExpanded: expanded,
            onHeaderActivate: toggleExpanded,
            trailing: (
              <SessionChatStatusCardChevron
                expanded={expanded}
                label={expanded ? 'Show less' : 'Show all options'}
                onClick={toggleExpanded}
              />
            ),
          }
        : { onClose: dismiss })}
    >
      {notice.detail && !collapsed ? (
        <p className='whitespace-pre-line break-words text-muted-foreground'>{notice.detail}</p>
      ) : null}
      {answerable ? (
        <div>
          <SessionChatChoiceRows
            dense={collapsed}
            onSelect={(index) => answerChoice(choices[index].index)}
            options={collapsed ? choiceOptions.slice(0, COLLAPSED_CHOICE_COUNT) : choiceOptions}
            // The rows lock while an answer is in flight; the card itself
            // is hidden optimistically, so this only matters for the
            // instant before the hide and for a failed answer.
            readOnly={!canSend || sending || pickedChoice !== null}
            selected={pickedChoice === null ? [] : [choices.findIndex((choice) => choice.index === pickedChoice)]}
            showShortcuts={showShortcutLabels}
            shortcutLabels={[primaryShortcutLabel, 'Esc']}
          />
          {!canSend ? (
            /* CDXC:SessionChat 2026-09-07 DECISION: User: the input-ownership sentence is a smaller secondary hint beneath the picker actions. */
            <p className='ghostex-chat-card-hint [--chat-card-hint-base:0.625rem] mt-2 font-normal leading-snug text-[#b4b8bf]'>
              {READ_ONLY_HINT}
            </p>
          ) : null}
        </div>
      ) : null}
      {notice.dialog && onAnswerDialog && !collapsed && !rateLimitPicker ? (
        <SessionChatTerminalDialogCard
          dialog={notice.dialog}
          canSend={canSend && !sending && pickedChoice === null}
          onAnswer={onAnswerDialog}
          controlsOnly
        />
      ) : null}
      {notice.screenTail && !collapsed ? (
        <div>
          <div className='flex min-w-0 flex-wrap items-center gap-2'>
            <Button
              className='ghostex-chat-card-action group/tail'
              size='sm'
              variant='outline'
              // The sidebar's legacy bare-button base paints a 1px app border
              // on every unnamed button; naming the slot opts this row out.
              data-slot='session-chat-notice-tail-toggle'
              onClick={() => setTailOpen((value) => !value)}
              type='button'
            >
              {tailOpen ? 'Hide terminal output' : 'Show terminal output'}
              {/* Control tier, like every other expander in the chat. */}
              <IconChevronRight
                aria-hidden='true'
                className={cn('ghostex-chat-disclosure-chevron', tailOpen && 'is-open')}
              />
            </Button>
          </div>
          {tailOpen ? (
            <div className='ghostex-chat-notice-tail mt-2 min-w-0 rounded-lg border border-border/65 bg-background/70 p-3'>
              <pre
                className='max-h-40 min-w-0 overflow-auto font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]'
                ref={screenTailRef}
              >
                {notice.screenTail}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
      {sendFailed ? <p className='text-[11px] leading-snug text-destructive/80'>{SEND_FAILED_NOTICE}</p> : null}
      {choiceError ? (
        <p role='alert' className='text-[11px] leading-snug text-destructive/80'>
          {choiceError}
        </p>
      ) : null}
    </SessionChatStatusCard>
  );
}

/** CDXC:AgentProviders 2026-09-13 DECISION: User approved restricting Switch account to relevant notices after it appeared on a queued reply. Only sign-in and usage-limit notices offer the existing account picker beside Open terminal, superseding the September 12 rule for all terminal notices. */
function NoticeAccountMenu({ renderMenu }: { renderMenu: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger render={<Button size='sm' variant='outline' />}>
        <IconSwitchHorizontal aria-hidden='true' stroke={2} />
        Switch account
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='ghostex-session-chat-popup gx-account-submenu' side='top'>
        {renderMenu(() => setOpen(false))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
