import { cn } from '@/packages/components/utils';
import {
  IconAlarm,
  IconAlarmOff,
  IconArchive,
  IconArchiveOff,
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconClockCancel,
  IconClockX,
  IconLoader2,
  IconMoon,
  IconNote,
  IconPencil,
  IconPin,
  IconPinnedOff,
  IconPlayerPlay,
  IconTag,
  IconTerminal2,
  IconWorld,
  IconX,
} from '@tabler/icons-react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { TOOLTIP_MOTION_CLASS_NAME } from '../components/ui/tooltip-config';
import { type SessionCardHoverAction } from '../shared/session-card-hover-actions';
import { type SidebarSessionItem } from '../shared/session-grid-contract';
import { AGENT_LOGOS, COLORED_AGENT_LOGOS } from './agent-logos';
import {
  AppTooltip,
  areSidebarTooltipsSuppressed,
  SIDEBAR_TOOLTIP_DISMISS_EVENT,
  SIDEBAR_TOOLTIP_SUPPRESSION_CHANGED_EVENT,
  TooltipProvider,
} from './app-tooltip';
import { formatRelativeTime } from './relative-time';
import {
  getDelayedSendTooltipText,
  getSessionCardTimerTrailingLabel,
  getSessionCardTitleTooltip,
  shouldShowTerminalSessionIcon,
} from './session-card-presentation';
import { getEffectiveSessionTag, SessionTagIcon, type SidebarSessionTag } from './session-tag-ui';
import { useSidebarTooltipDelayMs } from './tooltip-delay';
import { useRelativeTimeTick } from './use-relative-time-tick';
export {
  buildSessionTitleTooltip,
  formatSessionHeadingText,
  getSessionCardTitleTooltip,
  getSessionTitleTooltipOptions,
  getSessionTooltipSecondaryText,
  shouldShowTerminalSessionIcon,
} from './session-card-presentation';

const SESSION_TOOLTIP_VIEWPORT_MARGIN_PX = 8;
const SESSION_TOOLTIP_TRIGGER_OFFSET_PX = 8;

let activeOverflowTooltipId: symbol | undefined;
let activeOverflowTooltipClose: (() => void) | undefined;

/** A hover button: a configured action, or the chevron that reveals/hides the other actions. */
export type SessionCardHoverButton = SessionCardHoverAction | 'expand' | 'collapse';

export type SessionCardHoverActionState = {
  isCloseAfterDoneArmed: boolean;
  isParked: boolean;
  isPinned: boolean;
  isSleeping: boolean;
  isSnoozed: boolean;
};

export type SessionCardContentProps = {
  aliasHeadingRef?: RefObject<HTMLDivElement | null>;
  hideHeaderAgentIcon?: boolean;
  /** Hover buttons to draw in the trailing title slot, in display order; empty means none. */
  hoverActions?: readonly SessionCardHoverButton[];
  hoverActionState?: SessionCardHoverActionState;
  onDelayedSendClick?: () => void;
  onHoverAction?: (action: SessionCardHoverButton, event: ReactMouseEvent<HTMLButtonElement>) => void;
  session: SidebarSessionItem;
  showDebugSessionNumbers: boolean;
  showLastActiveTime?: boolean;
  showLastInteractionTime?: boolean;
  trailingPrefix?: ReactNode;
  trailingSuffix?: ReactNode;
};

export function SessionCardContent({
  aliasHeadingRef,
  hideHeaderAgentIcon = false,
  hoverActions = NO_HOVER_ACTIONS,
  hoverActionState = INACTIVE_HOVER_ACTION_STATE,
  onDelayedSendClick,
  onHoverAction,
  session,
  showDebugSessionNumbers,
  showLastActiveTime = true,
  showLastInteractionTime = false,
  trailingPrefix,
  trailingSuffix,
}: SessionCardContentProps) {
  const isGeneratingFirstPromptTitle = session.isGeneratingFirstPromptTitle === true;
  const { headingText } = getSessionCardTitleTooltip({
    session,
    showDebugSessionNumbers,
  });
  const displayedHeadingText = isGeneratingFirstPromptTitle ? 'Generating title...' : headingText;
  const hasLiveTimerDeadline = Boolean(session.delayedSendDeadlineAt || session.closeAfterDoneDeadlineAt);
  /**
   * CDXC:SessionStatus 2026-09-13 DECISION:
   * User: hide Last Active while the question dot is shown so they do not overlap, including when the session is not working.
   */
  const canShowLastActiveTime = showLastActiveTime && (session.pendingQuestionCount ?? 0) === 0;
  /*
  CDXC:DelayedSend 2026-08-31:
  gxserver persists Delayed Send and publishes an absolute deadline, but its
  accompanying remaining label is only a snapshot from the last presentation
  update. Tick deadline-backed labels from the client clock so the sidebar
  continues counting between daemon events. The deadline remains authoritative;
  this interval changes display text only and does not own or fire the timer.
  */
  const relativeTimeTick = useRelativeTimeTick(
    hasLiveTimerDeadline || (canShowLastActiveTime && Boolean(session.lastInteractionAt)),
    1_000,
    hasLiveTimerDeadline ? undefined : session.lastInteractionAt
  );
  const timerTrailingLabel = getSessionCardTimerTrailingLabel(session, relativeTimeTick);
  const hasLastInteractionTime =
    timerTrailingLabel === undefined && canShowLastActiveTime && Boolean(session.lastInteractionAt);
  const showHeaderLoadingSpinner = session.isReloading === true || isGeneratingFirstPromptTitle;
  const showTerminalSessionIcon = !hideHeaderAgentIcon && shouldShowTerminalSessionIcon(session);
  const shouldAllowFullWidthTitle =
    timerTrailingLabel === undefined && !showLastActiveTime && !showLastInteractionTime && !trailingPrefix;
  /**
   * CDXC:DelayedSend 2026-05-30-08:33:
   * Active Delayed Send timers should show exactly one sidebar clock, in the
   * leading session identity slot. Do not promote the timer into the
   * right-side header agent slot; that duplicates the clock beside Last Active
   * and makes the row look like two separate timers.
   */
  const hasHeaderAgentIcon =
    !hideHeaderAgentIcon &&
    timerTrailingLabel === undefined &&
    !shouldAllowFullWidthTitle &&
    (Boolean(session.agentIcon) || showTerminalSessionIcon || showHeaderLoadingSpinner);
  /*
  CDXC:SessionStatus 2026-06-07-06:27:
  Session-card Last Active labels must keep aging from the client clock after the row is rendered. Pass the relative-time tick into the formatter so React Compiler cannot cache the first label, such as a newly created session's 0s, until gxserver publishes an unrelated row update.
  */
  const lastInteractionLabel =
    hasLastInteractionTime && session.lastInteractionAt
      ? formatRelativeTime(session.lastInteractionAt, {
          allowJustNow: false,
          nowMs: relativeTimeTick,
        }).value
      : undefined;
  /**
   * CDXC:SessionStatus 2026-06-16-01:48:
   * Delayed Send and Close After Done countdowns use the same trailing slot as
   * Last Active. Timer labels must stay visible even when Last Active is hidden;
   * Close After Done shows 03:00 while armed and switches to the live native
   * countdown after the session is actually Done/non-working.
   */
  const trailingTimeLabel = timerTrailingLabel ?? lastInteractionLabel;
  /**
   * CDXC:Sessions 2026-04-28-05:18
   * Active session cards keep the icon slot as the default display and reveal
   * Last Active only on hover. Previous-session rows can request time as their
   * fixed trailing detail.
   *
   * CDXC:Sessions 2026-05-07-14:57
   * Agentless terminal sessions use the terminal glyph as the default icon
   * slot, so new plain terminals have visible card identity before detection
   * assigns a real agent icon.
   *
   * CDXC:Sessions 2026-05-08-11:01
   * Last Active uses one fixed visual color in session cards. Elapsed time can
   * change the text label, but must not recolor the timestamp by age.
   *
   * CDXC:Sessions 2026-05-15-08:57
   * Users can hide active session-card Last Active timestamps from Settings.
   * Gate only this timestamp label; trailing prefixes such as project metadata
   * and separate project-header git diff stats remain outside this visibility
   * control.
   *
   * CDXC:Sessions 2026-05-15-09:22
   * When Last Active is hidden for active session cards, the title owns the
   * full card width. Do not keep the header agent icon's trailing column in
   * that mode; the leading floating icon still carries session identity.
   */
  const defaultTrailingDisplay = timerTrailingLabel || (showLastInteractionTime && trailingTimeLabel) ? 'time' : 'icon';
  const shouldKeepLoadingIconVisible = showHeaderLoadingSpinner && hasHeaderAgentIcon;
  const hoverTrailingDisplay = shouldKeepLoadingIconVisible
    ? 'icon'
    : defaultTrailingDisplay === 'icon'
      ? trailingTimeLabel
        ? 'time'
        : 'icon'
      : hasHeaderAgentIcon
        ? 'icon'
        : 'time';
  /**
   * CDXC:Sessions 2026-05-09-16:55
   * Session rows expose close as hover chrome for project and chat cards. The
   * button renders in the header layer so it can outrank Last Active and agent
   * indicators without reserving a permanent title slot.
   *
   * CDXC:Sessions 2026-05-09-18:09
   * Close belongs in the same trailing slot as Last Active and header icons so
   * it aligns to the established right-side title affordance and can hide those
   * competing indicators as a single hover state.
   */
  const canShowHoverActions = hoverActions.length > 0 && Boolean(onHoverAction);
  const hasSessionHeadTrailing =
    Boolean(trailingPrefix) ||
    Boolean(trailingSuffix) ||
    Boolean(trailingTimeLabel) ||
    hasHeaderAgentIcon ||
    canShowHoverActions;

  return (
    <div
      className='session-head'
      data-title-full-width={String(shouldAllowFullWidthTitle)}
      style={
        canShowHoverActions
          ? ({ '--session-card-hover-action-count': hoverActions.length } as CSSProperties)
          : undefined
      }
    >
      {/**
       * CDXC:Sessions 2026-05-09-17:44
       * Previous Sessions rows use this shared sidebar title row but must not
       * show the agent icon in the trailing slot. Their trailing slot is
       * reserved for Last Active, matching the confirmed modal layout.
       */}
      <div className='session-alias-heading' ref={aliasHeadingRef}>
        {displayedHeadingText}
      </div>
      {hasSessionHeadTrailing ? (
        <div
          className='session-head-trailing'
          data-default-trailing-display={defaultTrailingDisplay}
          data-hover-trailing-display={hoverTrailingDisplay}
          data-timer-trailing={String(timerTrailingLabel !== undefined)}
        >
          {trailingPrefix}
          {trailingTimeLabel ? <div className='session-last-interaction-time'>{trailingTimeLabel}</div> : null}
          {hasHeaderAgentIcon ? (
            <SessionHeaderAgentIcon
              agentIcon={session.agentIcon}
              faviconDataUrl={session.faviconDataUrl}
              isDraft={session.isDraft === true}
              isGeneratingFirstPromptTitle={session.isGeneratingFirstPromptTitle}
              isReloading={session.isReloading}
              sessionPersistenceName={session.sessionPersistenceName}
              sessionPersistenceProvider={session.sessionPersistenceProvider}
              showTerminalIcon={showTerminalSessionIcon}
            />
          ) : null}
          {canShowHoverActions ? (
            <div className='session-card-hover-actions'>
              {hoverActions.map((action) => {
                const { icon, label } = describeSessionCardHoverAction(action, hoverActionState);
                return (
                  <SessionCardButtonTooltip content={label} key={action}>
                    <button
                      aria-label={`${label} session`}
                      className='session-card-hover-action'
                      data-hover-action={action}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onHoverAction?.(action, event);
                      }}
                      type='button'
                    >
                      {icon}
                    </button>
                  </SessionCardButtonTooltip>
                );
              })}
            </div>
          ) : null}
          {trailingSuffix}
        </div>
      ) : null}
    </div>
  );
}

/**
 * CDXC:Tooltips 2026-09-15 DECISION:
 * User: the small buttons inside a session card must not show their tooltip instantly; they wait as long as the card's own title tooltip does.
 * Each button gets its own single-member delay group with no grouping timeout, because in the sidebar-wide group the next button's label opens instantly once any tooltip in the sidebar is showing.
 */
function SessionCardButtonTooltip({ children, content }: { children: ReactElement; content: ReactNode }) {
  const sidebarItemTooltipDelayMs = useSidebarTooltipDelayMs();
  return (
    <TooltipProvider delay={sidebarItemTooltipDelayMs} timeout={0}>
      <AppTooltip content={content}>{children}</AppTooltip>
    </TooltipProvider>
  );
}

const NO_HOVER_ACTIONS: readonly SessionCardHoverButton[] = [];
const INACTIVE_HOVER_ACTION_STATE: SessionCardHoverActionState = {
  isCloseAfterDoneArmed: false,
  isParked: false,
  isPinned: false,
  isSleeping: false,
  isSnoozed: false,
};

/**
 * CDXC:Sessions 2026-09-12 DECISION:
 * User: hover buttons are icons only; the tooltip names the action. A button on a pinned, parked or snoozed row shows the reverse action (Unpin, Unpark, Unsnooze) so one slot toggles the state.
 */
function describeSessionCardHoverAction(
  action: SessionCardHoverButton,
  state: SessionCardHoverActionState
): { icon: ReactNode; label: string } {
  const iconProps = { 'aria-hidden': true, size: 14, stroke: 1.8 } as const;
  switch (action) {
    case 'expand':
      return { icon: <IconChevronLeft {...iconProps} />, label: 'More actions' };
    case 'collapse':
      return { icon: <IconChevronRight {...iconProps} />, label: 'Fewer actions' };
    case 'rename':
      return { icon: <IconPencil {...iconProps} />, label: 'Rename' };
    case 'tag':
      return { icon: <IconTag {...iconProps} />, label: 'Tag' };
    case 'note':
      return { icon: <IconNote {...iconProps} />, label: 'Note' };
    case 'sleep':
      return state.isSleeping
        ? { icon: <IconPlayerPlay {...iconProps} />, label: 'Wake' }
        : { icon: <IconMoon {...iconProps} />, label: 'Sleep' };
    case 'closeAfterDone':
      return state.isCloseAfterDoneArmed
        ? { icon: <IconClockCancel {...iconProps} />, label: 'Cancel Close After Done' }
        : { icon: <IconClockX {...iconProps} />, label: 'Close After Done' };
    case 'pin':
      return state.isPinned
        ? { icon: <IconPinnedOff {...iconProps} />, label: 'Unpin' }
        : { icon: <IconPin {...iconProps} />, label: 'Pin' };
    case 'snooze':
      return state.isSnoozed
        ? { icon: <IconAlarmOff {...iconProps} />, label: 'Unsnooze' }
        : { icon: <IconAlarm {...iconProps} />, label: 'Snooze' };
    case 'park':
      return state.isParked
        ? { icon: <IconArchiveOff {...iconProps} />, label: 'Unpark' }
        : { icon: <IconArchive {...iconProps} />, label: 'Park' };
    case 'close':
      return { icon: <IconX {...iconProps} />, label: 'Close' };
  }
}

type SessionAgentIconProps = {
  agentIcon: SidebarSessionItem['agentIcon'];
  closeAfterDone?: boolean;
  closeAfterDoneDeadlineAt?: string;
  closeAfterDoneRemainingLabel?: string;
  delayedSendDeadlineAt?: string;
  delayedSendRemainingLabel?: string;
  faviconDataUrl?: string;
  /**
   * CDXC:SessionNotes 2026-08-24:
   * Whether this session carries a free-text note. Rendered as a small white
   * dot beside the leading icon — a decoration on the slot, never in place of
   * whatever owns it.
   */
  hasSessionNote?: boolean;
  /**
   * CDXC:Drafts 2026-09-04 DECISION:
   * User: the chat composer holds unsent text for this session. Rendered as a
   * white dot over the leading icon's top-right corner, chat box only (the
   * terminal's own input line is not tracked).
   */
  hasComposerDraft?: boolean;
  isFavorite?: boolean;
  isPinned?: boolean;
  sessionTag?: SidebarSessionTag;
  /**
   * CDXC:Drafts 2026-08-28:
   * The session has not received its first prompt yet, so the pencil REPLACES
   * the agent logo in the leading slot: the row is something the user is still
   * writing, not a running conversation with that agent. The draft's agent is
   * still switchable until the first Send, which is the other reason its logo
   * would be a promise the row cannot keep.
   */
  isDraft?: boolean;
  isGeneratingFirstPromptTitle?: boolean;
  isReloading?: boolean;
  /**
   * CDXC:SessionChat 2026-08-21:
   * How many Ghostex-owned chat prompts are waiting for this session. Rendered
   * as a decoration over the leading icon, never in place of it.
   */
  queuedPromptCount?: number;
  /**
   * CDXC:SessionChat 2026-08-21-b:
   * How many of those rows failed to deliver. Non-zero paints the badge red.
   */
  queuedPromptFailedCount?: number;
  sessionPersistenceName?: string;
  sessionPersistenceProvider?: SidebarSessionItem['sessionPersistenceProvider'];
  showTerminalIcon?: boolean;
};

type SessionAgentLogoStyle = CSSProperties & {
  '--session-agent-logo': string;
  '--session-agent-logo-colored': string;
};

type SessionAgentIconDecorationProps = SessionAgentIconProps & {
  className: string;
  loadingClassName: string;
  tablerClassName: string;
};

function SessionAgentIconDecoration({
  agentIcon,
  className,
  faviconDataUrl,
  isDraft = false,
  isGeneratingFirstPromptTitle = false,
  isReloading = false,
  loadingClassName,
  showTerminalIcon = false,
  tablerClassName,
}: SessionAgentIconDecorationProps) {
  if (isReloading || isGeneratingFirstPromptTitle) {
    return <IconLoader2 aria-hidden='true' className={loadingClassName} size={14} stroke={1.8} />;
  }

  /*
  CDXC:Drafts 2026-08-28:
  The pencil takes the slot from the agent logo for a session with no first
  prompt yet. It sits below the loading branch (a spinner is a live transition
  and still wins) and above every identity branch, because "this is unsent" is
  the fact the row is reporting — the agent name behind it can still change.
  Browser sessions are never drafts, so the browser branch below is unreachable
  for them either way.
  */
  if (isDraft && agentIcon !== 'browser') {
    return <IconPencil aria-hidden='true' className={tablerClassName} data-agent-icon='draft' size={14} stroke={1.8} />;
  }

  if (agentIcon === 'browser') {
    if (faviconDataUrl) {
      /**
       * CDXC:Browser 2026-05-03-11:28
       * Browser-pane cards identify the loaded tab with the page favicon when
       * available. Keep a Tabler world glyph as the fallback so cards still
       * have a stable browser affordance before favicon discovery or for pages
       * without icons.
       *
       * CDXC:Icons 2026-05-07-19:44
       * Browser affordances in the sidebar use the Tabler world glyph so
       * browser sessions share the same globe cue as browser groups.
       */
      return (
        <img
          alt=''
          aria-hidden='true'
          className={tablerClassName}
          data-agent-icon='browser'
          data-icon-variant='favicon'
          src={faviconDataUrl}
        />
      );
    }
    return (
      <IconWorld aria-hidden='true' className={tablerClassName} data-agent-icon='browser' size={14} stroke={1.8} />
    );
  }

  if (showTerminalIcon && !agentIcon) {
    /**
     * CDXC:Sessions 2026-05-07-14:57
     * Plain terminal sessions still need a visible card identity before an
     * agent is detected. Render the Tabler terminal glyph as a white
     * non-agent icon instead of leaving the Agent Icon slot blank.
     */
    return (
      <IconTerminal2 aria-hidden='true' className={tablerClassName} data-agent-icon='terminal' size={14} stroke={1.8} />
    );
  }

  if (!agentIcon) {
    return null;
  }

  const agentLogoStyle: SessionAgentLogoStyle = {
    /*
     * CDXC:Icons 2026-06-29-23:58:
     * Session cards need both render assets at the element boundary: masks for
     * monochrome mode and image backgrounds for the colored Settings toggle.
     * Favorite state must not feed this style, so favorite rows keep the same
     * agent logo colors as non-favorite rows.
     */
    '--session-agent-logo': `url("${AGENT_LOGOS[agentIcon]}")`,
    '--session-agent-logo-colored': `url("${COLORED_AGENT_LOGOS[agentIcon]}")`,
  };

  return <span aria-hidden='true' className={className} data-agent-icon={agentIcon} style={agentLogoStyle} />;
}

export function SessionFloatingAgentIcon({
  agentIcon,
  closeAfterDone,
  closeAfterDoneDeadlineAt,
  closeAfterDoneRemainingLabel,
  delayedSendDeadlineAt,
  delayedSendRemainingLabel,
  faviconDataUrl,
  hasComposerDraft = false,
  hasSessionNote = false,
  isDraft = false,
  isFavorite = false,
  isPinned = false,
  onCloseAfterDoneClick,
  onDelayedSendClick,
  onPinnedClick,
  queuedPromptCount,
  queuedPromptFailedCount,
  sessionTag,
  sessionPersistenceName,
  sessionPersistenceProvider,
  showTerminalIcon = false,
}: SessionAgentIconProps & {
  onCloseAfterDoneClick?: () => void;
  onDelayedSendClick?: () => void;
  onPinnedClick?: (pinned: boolean) => void;
}) {
  const effectiveSessionTag = getEffectiveSessionTag({ isFavorite, sessionTag });
  /*
  CDXC:SessionChat 2026-08-21:
  The queued-prompt badge is a decoration on the leading icon slot, not a
  competitor for it: whatever owns the slot (agent logo, Delayed Send clock,
  Close After Done clock) keeps rendering underneath. It is a SIBLING of that
  icon, never a wrapper around it, and it carries its own anchor element in the
  timer branches, which do not render the shared one. Wrapping the icon would
  create a second flow box in the row — the exact mistake that once pushed the
  Delayed Send clock above the session card.
  */
  const queuedPromptBadge = (
    <SessionQueuedPromptBadge count={queuedPromptCount} failedCount={queuedPromptFailedCount} />
  );
  /*
  CDXC:SessionNotes 2026-08-24:
  The note dot follows the queued-prompt badge's ownership rule exactly: an
  absolutely positioned SIBLING of whatever owns the leading slot, rendered in
  every branch so a session that is mid Delayed Send or Close After Done does
  not appear to have lost its note.
  */
  const sessionNoteDot = hasSessionNote ? <span aria-hidden='true' className='session-note-dot' /> : null;
  /*
  CDXC:Drafts 2026-09-04 DECISION:
  User picked the "stacked pile" for a session that has BOTH queued prompts and
  composer text: the yellow count badge keeps its place and the light-blue draft dot
  peeks out from behind it, offset toward the top-right, instead of hiding one
  signal, moving the dot to another corner, or recolouring the badge. Alone, the
  dot sits centred on the badge's own spot so a draft becoming a queued row
  swaps in place. Same ownership rule as the badge and the note dot: an
  absolutely positioned SIBLING of the leading icon, rendered in every branch,
  never a wrapper. `data-stacked` mirrors the badge's own "renders at count >= 1"
  rule so the CSS never has to know the count.
  */
  const hasQueuedPromptBadge =
    typeof queuedPromptCount === 'number' && Number.isFinite(queuedPromptCount) && queuedPromptCount >= 1;
  const composerDraftDot = hasComposerDraft ? (
    <span
      aria-hidden='true'
      className='session-composer-draft-dot'
      data-stacked={hasQueuedPromptBadge ? 'true' : undefined}
    />
  ) : null;
  const hasActiveDelayedSend = Boolean(delayedSendRemainingLabel || delayedSendDeadlineAt);
  const hasActiveCloseAfterDone = Boolean(closeAfterDone || closeAfterDoneRemainingLabel || closeAfterDoneDeadlineAt);
  const isCloseAfterDoneCountingDown = Boolean(closeAfterDoneRemainingLabel || closeAfterDoneDeadlineAt);

  if (hasActiveDelayedSend) {
    /*
    CDXC:DelayedSend 2026-06-06-05:29:
    An active Delayed Send timer always owns the leading session icon slot, even when the session is tagged, pinned, or has a visible agent icon. The deadline alone is enough to show the yellow clock so a missing countdown label cannot hide the active timer state.
    */
    return (
      <>
        <span aria-hidden='true' className='session-floating-icon-anchor' />
        <DelayedSendSidebarIcon
          className='session-floating-agent-tabler-icon session-delayed-send-agent-icon'
          onClick={onDelayedSendClick}
          remainingLabel={delayedSendRemainingLabel}
        />
        {sessionNoteDot}
        {composerDraftDot}
        {queuedPromptBadge}
      </>
    );
  }

  if (hasActiveCloseAfterDone) {
    /*
    CDXC:Sessions 2026-06-15-21:00:
    Close After Done uses Delayed Send's leading clock affordance with a pastel
    red color. Keep it below Delayed Send in precedence so a pending Enter key
    remains the dominant active timer, then fade the red clock only while the
    session is Done and the close countdown is active.
    */
    return (
      <>
        <span aria-hidden='true' className='session-floating-icon-anchor' />
        <CloseAfterDoneSidebarIcon
          className={`session-floating-agent-tabler-icon session-close-after-done-agent-icon${
            isCloseAfterDoneCountingDown ? ' session-close-after-done-agent-icon-countdown' : ''
          }`}
          onClick={onCloseAfterDoneClick}
          remainingLabel={closeAfterDoneRemainingLabel}
        />
        {sessionNoteDot}
        {composerDraftDot}
        {queuedPromptBadge}
      </>
    );
  }

  return (
    <>
      <span aria-hidden='true' className='session-floating-icon-anchor' />
      {onPinnedClick ? <SessionPinnedFloatingButton isPinned={isPinned} onPinnedClick={onPinnedClick} /> : null}
      {effectiveSessionTag ? <SessionTagSidebarIcon sessionTag={effectiveSessionTag} /> : null}
      <SessionAgentIconDecoration
        agentIcon={agentIcon}
        className='session-floating-agent-icon'
        faviconDataUrl={faviconDataUrl}
        isDraft={isDraft}
        isFavorite={isFavorite}
        loadingClassName='session-floating-reloading-icon'
        showTerminalIcon={showTerminalIcon}
        tablerClassName='session-floating-agent-tabler-icon'
      />
      <SessionPersistenceProviderBadge
        sessionPersistenceName={sessionPersistenceName}
        sessionPersistenceProvider={sessionPersistenceProvider}
        slot='floating'
      />
      {sessionNoteDot}
      {composerDraftDot}
      {queuedPromptBadge}
    </>
  );
}

/*
CDXC:SessionChat 2026-08-21:
An absolutely positioned, pointer-transparent circle carrying the number of
prompts waiting for this session. It renders nothing at all below one, so a
drained queue leaves no empty dot behind, and counts above 99 collapse to "99+"
rather than widening the badge into the session title.
*/
const SESSION_QUEUED_PROMPT_BADGE_MAX_COUNT = 99;

function SessionQueuedPromptBadge({ count, failedCount }: { count?: number; failedCount?: number }) {
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 1) {
    return null;
  }

  const roundedCount = Math.floor(count);
  /*
  CDXC:SessionChat 2026-08-21-b:
  A row that failed to deliver holds the whole queue until the user retries or
  deletes it, so the badge switches from the yellow "waiting" colour to the
  sidebar's own error red. The colour is the ONLY thing that changes: the box is
  driven entirely by `--session-queued-prompt-badge-*`, so a red badge and a
  yellow badge of the same digit count are the same geometry and cannot reflow
  the icon slot.
  */
  const hasFailed = typeof failedCount === 'number' && Number.isFinite(failedCount) && failedCount > 0;

  return (
    <span
      aria-hidden='true'
      className='session-queued-prompt-badge'
      data-queued-prompt-count={String(roundedCount)}
      data-queued-prompt-failed={hasFailed ? 'true' : undefined}
    >
      {roundedCount > SESSION_QUEUED_PROMPT_BADGE_MAX_COUNT
        ? `${SESSION_QUEUED_PROMPT_BADGE_MAX_COUNT}+`
        : String(roundedCount)}
    </span>
  );
}

function SessionPinnedFloatingButton({
  isPinned,
  onPinnedClick,
}: {
  isPinned: boolean;
  onPinnedClick: (pinned: boolean) => void;
}) {
  const pointerGestureRef = useRef<{ didMove: boolean; pointerId: number; startX: number; startY: number } | undefined>(
    undefined
  );

  return (
    <button
      aria-label={isPinned ? 'Unpin session' : 'Pin session'}
      aria-pressed={isPinned}
      className='session-pinned-floating-button'
      data-pinned={String(isPinned)}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (pointerGestureRef.current?.didMove === true) {
          pointerGestureRef.current = undefined;
          return;
        }
        pointerGestureRef.current = undefined;
        onPinnedClick(!isPinned);
      }}
      onPointerCancel={() => {
        pointerGestureRef.current = undefined;
      }}
      onPointerDown={(event) => {
        /*
         * CDXC:Sessions 2026-06-30-11:33:
         * Clicking the pin icon toggles pin state, but pressing and moving it is a pinned-session reorder gesture. Track pointer travel at the button boundary so a completed drag cannot also fire the button click and unpin the session.
         */
        pointerGestureRef.current = {
          didMove: false,
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
        };
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Pointer capture can fail if the browser has already ended this pointer stream.
        }
      }}
      onPointerMove={(event) => {
        const gesture = pointerGestureRef.current;
        if (!gesture || gesture.pointerId !== event.pointerId || gesture.didMove) {
          return;
        }

        const distanceX = Math.abs(event.clientX - gesture.startX);
        const distanceY = Math.abs(event.clientY - gesture.startY);
        gesture.didMove = distanceX > 3 || distanceY > 3;
      }}
      tabIndex={isPinned ? 0 : -1}
      type='button'
    >
      <IconPin aria-hidden='true' size={15} stroke={1.9} />
    </button>
  );
}

function SessionTagSidebarIcon({ sessionTag }: { sessionTag: SidebarSessionTag }) {
  /**
   * CDXC:Sessions 2026-06-05-12:30:
   * A tagged session shows its tag glyph in the same leading identity slot used
   * by agent icons. Delayed Send owns higher precedence; otherwise the tag is
   * visible at rest and hover/focus can reveal the hidden agent identity.
   */
  return (
    <SessionTagIcon
      className='session-floating-agent-tabler-icon session-tag-agent-icon'
      fillFavorite
      size={15}
      stroke={1.9}
      tag={sessionTag}
    />
  );
}

function SessionHeaderAgentIcon({
  agentIcon,
  faviconDataUrl,
  isDraft = false,
  isGeneratingFirstPromptTitle = false,
  isReloading = false,
  sessionPersistenceName,
  sessionPersistenceProvider,
  showTerminalIcon = false,
}: SessionAgentIconProps) {
  return (
    <>
      <SessionAgentIconDecoration
        agentIcon={agentIcon}
        className='session-header-agent-icon'
        faviconDataUrl={faviconDataUrl}
        isDraft={isDraft}
        isGeneratingFirstPromptTitle={isGeneratingFirstPromptTitle}
        isReloading={isReloading}
        loadingClassName='session-header-reloading-icon'
        showTerminalIcon={showTerminalIcon}
        tablerClassName='session-header-agent-tabler-icon'
      />
      <SessionPersistenceProviderBadge
        sessionPersistenceName={sessionPersistenceName}
        sessionPersistenceProvider={sessionPersistenceProvider}
        slot='header'
      />
    </>
  );
}

function CloseAfterDoneSidebarIcon({
  className,
  onClick,
  remainingLabel,
}: {
  className: string;
  onClick?: () => void;
  remainingLabel?: string;
}) {
  const tooltip = remainingLabel ? `Close After Done in ${remainingLabel}` : 'Close After Done armed';
  return (
    <SessionCardButtonTooltip content={tooltip}>
      <button
        aria-label={tooltip}
        className={className}
        onClick={(event) => {
          event.stopPropagation();
          onClick?.();
        }}
        type='button'
      >
        <IconClock aria-hidden='true' size={16} stroke={1.9} />
      </button>
    </SessionCardButtonTooltip>
  );
}

function DelayedSendSidebarIcon({
  className,
  onClick,
  remainingLabel,
}: {
  className: string;
  onClick?: () => void;
  remainingLabel?: string;
}) {
  /**
   * CDXC:DelayedSend 2026-05-17-03:14
   * CDXC:DelayedSend 2026-05-21-12:21
   * Active Delayed Send timers replace the sidebar agent icon in the same DOM
   * slot and dimensions as the normal agent glyph, and reopen the modal so
   * users can change or cancel the pending Enter keypress. The Delayed Send
   * reason already lives on the session-row tooltip, so this clock must not
   * grow its own hover tooltip. Render the clock element directly in the
   * leading agent-icon slot; a wrapper would become a separate flow box and can
   * push the clock above the session card.
   */
  const ariaLabel = getDelayedSendTooltipText(remainingLabel);
  return (
    <button
      aria-label={ariaLabel}
      className={className}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      type='button'
    >
      <IconClock aria-hidden='true' size={16} stroke={1.9} />
    </button>
  );
}

function SessionPersistenceProviderBadge({
  sessionPersistenceName,
  sessionPersistenceProvider,
  slot,
}: {
  sessionPersistenceName?: string;
  sessionPersistenceProvider?: SidebarSessionItem['sessionPersistenceProvider'];
  slot: 'floating' | 'header';
}) {
  /**
   * CDXC:Workarea 2026-05-15-15:32:
   * Persistence-backed sessions should keep the agent icon clean; do not render
   * tmux/zmx/zellij provider letters over floating or header icons even when
   * provider metadata is stored for attach commands and tooltips.
   */
  void sessionPersistenceName;
  void sessionPersistenceProvider;
  void slot;
  return null;
}

type OverflowTooltipTextProps = {
  children: ReactElement;
  delayMs?: number;
  textRef?: RefObject<HTMLDivElement | null>;
  text: string;
  tooltip?: string;
  tooltipWhen?: 'always' | 'overflow';
};

type SessionTooltipPosition = {
  left: number;
  top: number;
  width: number;
};

type SessionTooltipOpenReason = 'hover' | 'focus';

/**
 * CDXC:Tooltips 2026-09-15 DECISION:
 * User: a control inside a session card that owns its own tooltip (the hover action strip, the timer icons) shows only its own label; the card's title tooltip must not appear next to it.
 * Every shared tooltip trigger carries this slot attribute, so the card tells "over a nested tooltip owner" apart from "over the card body" without each control registering itself.
 */
const NESTED_TOOLTIP_OWNER_SELECTOR = '[data-slot="tooltip-trigger"]';

function findNestedTooltipOwner(rootElement: Element, target: EventTarget | null): Element | undefined {
  const targetNode = target instanceof Node ? target : undefined;
  const targetElement = targetNode instanceof Element ? targetNode : (targetNode?.parentElement ?? undefined);
  if (!targetElement || !rootElement.contains(targetElement)) {
    return undefined;
  }

  const owner = targetElement.closest(NESTED_TOOLTIP_OWNER_SELECTOR);
  if (!owner || owner === rootElement || !rootElement.contains(owner)) {
    return undefined;
  }

  return owner;
}

/**
 * CDXC:Tooltips 2026-09-15 WHY:
 * The AppKit observer writes this flag and then runs the dismiss script, and both reach the renderer on a different channel than mouse input.
 * A fast exit from the sidebar could therefore be dismissed before the mousemove that entered the row started the open timer, which left the title tooltip open over a terminal pane with the pointer long gone.
 * Hover opens re-check the flag when the timer fires so they never land while the pointer is outside the sidebar; focus opens ignore it so keyboard navigation keeps working with the mouse parked elsewhere.
 */
function isNativePointerOutsideSidebar(): boolean {
  return typeof document !== 'undefined' && document.body?.dataset.nativePointerInside === 'false';
}

export function OverflowTooltipText({
  children,
  delayMs,
  text,
  textRef,
  tooltip,
  tooltipWhen = 'overflow',
}: OverflowTooltipTextProps) {
  const configuredDelayMs = useSidebarTooltipDelayMs();
  const effectiveDelayMs = delayMs ?? configuredDelayMs;
  const [isOpen, setIsOpen] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState<SessionTooltipPosition>();
  const isOpenRef = useRef(false);
  const openReasonRef = useRef<SessionTooltipOpenReason | undefined>(undefined);
  const openTimeoutIdRef = useRef<number | undefined>(undefined);
  const pointerInsideRef = useRef(false);
  const pointerOverNestedOwnerRef = useRef(false);
  const suppressedUntilPointerLeaveRef = useRef(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const tooltipPopupRef = useRef<HTMLDivElement>(null);
  const tooltipIdRef = useRef(Symbol('overflowTooltip'));
  const tooltipContent = tooltip ?? text;
  const latestRef = useRef({ effectiveDelayMs, textRef, tooltipContent, tooltipWhen });
  latestRef.current = { effectiveDelayMs, textRef, tooltipContent, tooltipWhen };

  const clearOpenTimeout = () => {
    if (openTimeoutIdRef.current === undefined) {
      return;
    }

    window.clearTimeout(openTimeoutIdRef.current);
    openTimeoutIdRef.current = undefined;
  };

  const closeTooltip = () => {
    clearOpenTimeout();
    openReasonRef.current = undefined;
    if (activeOverflowTooltipId === tooltipIdRef.current) {
      activeOverflowTooltipId = undefined;
      activeOverflowTooltipClose = undefined;
    }
    isOpenRef.current = false;
    setIsOpen(false);
    setTooltipPosition(undefined);
  };

  const hasOverflow = () => {
    const element = latestRef.current.textRef?.current;
    if (!element) {
      return false;
    }

    if (element.scrollWidth > element.clientWidth) {
      return true;
    }

    return element.scrollHeight > element.clientHeight;
  };

  const requestOpen = (reason: SessionTooltipOpenReason) => {
    if (isOpenRef.current || openTimeoutIdRef.current !== undefined) {
      return;
    }
    if (areSidebarTooltipsSuppressed()) {
      return;
    }
    if (reason === 'hover' && suppressedUntilPointerLeaveRef.current) {
      return;
    }
    const { effectiveDelayMs: openDelayMs, tooltipContent: content, tooltipWhen: openWhen } = latestRef.current;
    const shouldOpen = openWhen === 'always' ? Boolean(content) : hasOverflow();
    if (!shouldOpen) {
      return;
    }

    openReasonRef.current = reason;
    openTimeoutIdRef.current = window.setTimeout(() => {
      openTimeoutIdRef.current = undefined;
      if (areSidebarTooltipsSuppressed()) {
        openReasonRef.current = undefined;
        return;
      }
      if (
        reason === 'hover' &&
        (!pointerInsideRef.current ||
          pointerOverNestedOwnerRef.current ||
          suppressedUntilPointerLeaveRef.current ||
          isNativePointerOutsideSidebar())
      ) {
        openReasonRef.current = undefined;
        return;
      }
      if (activeOverflowTooltipId !== tooltipIdRef.current) {
        activeOverflowTooltipClose?.();
      }

      activeOverflowTooltipId = tooltipIdRef.current;
      activeOverflowTooltipClose = closeTooltip;
      isOpenRef.current = true;
      setIsOpen(true);
    }, openDelayMs);
  };

  /*
   * CDXC:Tooltips 2026-09-15 WHY:
   * The open and close signals are native DOM listeners on the shell, not React handlers cloned onto the child, for two reasons.
   * React's synthetic enter/leave and focus events follow the React tree, so a portaled context menu or tag submenu rendered by the card counted as "still inside" and the title tooltip stayed open (or opened late) over the menu.
   * A DOM mouseleave also never fires when the pointer moves from the title onto a nested button, so the hover strip's own label appeared next to the still-open title tooltip; mouseover, which bubbles, reports every such crossing.
   * A pointer press closes the tooltip and keeps it closed until the pointer leaves the card: clicking a row hands focus to the terminal while the pointer rests on the row, and the tooltip used to sit there until the next mouse movement out of the sidebar.
   */
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) {
      return undefined;
    }

    const resetPointerState = () => {
      pointerInsideRef.current = false;
      pointerOverNestedOwnerRef.current = false;
      suppressedUntilPointerLeaveRef.current = false;
    };
    const handleMouseOver = (event: MouseEvent) => {
      const wasInside = pointerInsideRef.current;
      const wasOverNestedOwner = pointerOverNestedOwnerRef.current;
      const isOverNestedOwner = findNestedTooltipOwner(shell, event.target) !== undefined;
      pointerInsideRef.current = true;
      pointerOverNestedOwnerRef.current = isOverNestedOwner;
      if (isOverNestedOwner) {
        if (!wasOverNestedOwner) {
          closeTooltip();
        }
        return;
      }
      if (!wasInside || wasOverNestedOwner) {
        requestOpen('hover');
      }
    };
    const handleMouseLeave = () => {
      resetPointerState();
      closeTooltip();
    };
    const handlePointerDown = () => {
      suppressedUntilPointerLeaveRef.current = true;
      closeTooltip();
    };
    const handleFocusIn = (event: FocusEvent) => {
      if (pointerInsideRef.current || findNestedTooltipOwner(shell, event.target)) {
        return;
      }
      requestOpen('focus');
    };
    const handleFocusOut = (event: FocusEvent) => {
      if (openReasonRef.current !== 'focus') {
        return;
      }
      if (event.relatedTarget instanceof Node && shell.contains(event.relatedTarget)) {
        return;
      }
      closeTooltip();
    };
    const handleSidebarTooltipDismiss = () => {
      resetPointerState();
      closeTooltip();
    };
    const handleSidebarTooltipSuppressionChanged = () => {
      if (areSidebarTooltipsSuppressed()) {
        closeTooltip();
      }
    };

    shell.addEventListener('mouseover', handleMouseOver);
    shell.addEventListener('mouseleave', handleMouseLeave);
    shell.addEventListener('pointerdown', handlePointerDown);
    shell.addEventListener('focusin', handleFocusIn);
    shell.addEventListener('focusout', handleFocusOut);
    window.addEventListener(SIDEBAR_TOOLTIP_DISMISS_EVENT, handleSidebarTooltipDismiss);
    window.addEventListener(SIDEBAR_TOOLTIP_SUPPRESSION_CHANGED_EVENT, handleSidebarTooltipSuppressionChanged);
    return () => {
      shell.removeEventListener('mouseover', handleMouseOver);
      shell.removeEventListener('mouseleave', handleMouseLeave);
      shell.removeEventListener('pointerdown', handlePointerDown);
      shell.removeEventListener('focusin', handleFocusIn);
      shell.removeEventListener('focusout', handleFocusOut);
      window.removeEventListener(SIDEBAR_TOOLTIP_DISMISS_EVENT, handleSidebarTooltipDismiss);
      window.removeEventListener(SIDEBAR_TOOLTIP_SUPPRESSION_CHANGED_EVENT, handleSidebarTooltipSuppressionChanged);
      clearOpenTimeout();
      if (activeOverflowTooltipId === tooltipIdRef.current) {
        activeOverflowTooltipId = undefined;
        activeOverflowTooltipClose = undefined;
      }
    };
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const getTriggerElement = () => textRef?.current ?? shellRef.current;

    const updateTooltipPosition = () => {
      const triggerElement = getTriggerElement();
      const tooltipElement = tooltipPopupRef.current;
      if (!triggerElement || !tooltipElement) {
        return;
      }

      const ownerElement = shellRef.current?.firstElementChild ?? shellRef.current ?? triggerElement;
      const triggerBounds = ownerElement.getBoundingClientRect();
      const tooltipBounds = tooltipElement.getBoundingClientRect();
      const left = triggerBounds.left;
      const width = triggerBounds.width;
      const belowTop = triggerBounds.bottom + SESSION_TOOLTIP_TRIGGER_OFFSET_PX;
      const preferredTop = belowTop;
      const top = Math.max(
        SESSION_TOOLTIP_VIEWPORT_MARGIN_PX,
        Math.min(preferredTop, window.innerHeight - SESSION_TOOLTIP_VIEWPORT_MARGIN_PX - tooltipBounds.height)
      );

      setTooltipPosition((previousPosition) => {
        if (previousPosition?.left === left && previousPosition.top === top && previousPosition.width === width) {
          return previousPosition;
        }

        return { left, top, width };
      });
    };

    updateTooltipPosition();
    window.addEventListener('resize', updateTooltipPosition);
    window.addEventListener('scroll', updateTooltipPosition, true);

    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(updateTooltipPosition);
    const triggerElement = getTriggerElement();
    if (triggerElement) {
      resizeObserver?.observe(triggerElement);
    }
    if (tooltipPopupRef.current) {
      resizeObserver?.observe(tooltipPopupRef.current);
    }

    return () => {
      window.removeEventListener('resize', updateTooltipPosition);
      window.removeEventListener('scroll', updateTooltipPosition, true);
      resizeObserver?.disconnect();
    };
  }, [isOpen, textRef, tooltipContent]);

  /*
   * CDXC:Tooltips 2026-05-20-11:05:
   * Session-card title tooltips must render below the row without overlapping
   * the trigger. Portaled Radix tooltips mis-anchor in the native sidebar
   * webview, so keep the label local to the card with a below-positioned popup.
   *
   * CDXC:Tooltips 2026-05-25-07:16:
   * Local session-card tooltips must also close on the shared sidebar dismiss
   * event because app switching and fast exits can skip the trigger mouseleave
   * event that normally clears this local open state.
   *
   * CDXC:Tooltips 2026-05-26-22:29:
   * Session title tooltips should keep metadata and provider/session id rows at
   * the shared tooltip font while the first title row matches the visible
   * session-card title (15.55px / weight 300), so overflow text reads as the
   * same label rather than a smaller bold caption.
   *
   * CDXC:Tooltips 2026-05-28-04:33:
   * Quick-session hover tooltips must paint above surrounding Projects content.
   * Keep the custom native-sidebar positioning behavior, but portal the
   * rendered tooltip to the document body and place it from the trigger rect so
   * section overflow and row stacking contexts cannot cover it.
   *
   * CDXC:Tooltips 2026-05-30-06:36:
   * Sidebar tooltips should open below their trigger for a consistent scan path
   * across action buttons and session rows. Preserve viewport clamping, but do
   * not choose an above-trigger position just because the lower half is tighter.
   *
   * CDXC:Tooltips 2026-07-24:
   * Session tooltips belong to the rendered session surface, not its inset
   * wrapper or title text. Align the popup's left edge with the direct child
   * trigger while retaining viewport clamping for unusually narrow windows.
   *
   * CDXC:Tooltips 2026-07-26:
   * The session tooltip border box must match the session button's measured
   * width as well as its left edge. Use the raw trigger rectangle for both
   * values so nested project sessions and edge-clipped rows are clipped by the
   * viewport identically.
   */
  return (
    <div className='session-local-tooltip-shell' ref={shellRef}>
      {children}
      {isOpen && tooltipContent
        ? createPortal(
            <div
              className={cn('session-local-tooltip-popup', TOOLTIP_MOTION_CLASS_NAME)}
              data-side='bottom'
              data-state='delayed-open'
              ref={tooltipPopupRef}
              role='tooltip'
              style={
                {
                  '--session-local-tooltip-left': tooltipPosition ? `${tooltipPosition.left}px` : '0px',
                  '--session-local-tooltip-top': tooltipPosition ? `${tooltipPosition.top}px` : '0px',
                  '--session-local-tooltip-width': tooltipPosition ? `${tooltipPosition.width}px` : 'max-content',
                } as CSSProperties
              }
            >
              {renderSessionLocalTooltipContent(tooltipContent)}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

function renderSessionLocalTooltipContent(content: string): ReactNode {
  const lines = content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return content;
  }

  return lines.map((line, index) => (
    <span
      className={index === 0 ? 'session-local-tooltip-title' : 'session-local-tooltip-meta'}
      key={`${index}-${line}`}
    >
      {line}
    </span>
  ));
}
