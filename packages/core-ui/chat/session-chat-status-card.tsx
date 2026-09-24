/*
CDXC:SessionChat 2026-09-16 DECISION:
User: one shell for every card above the composer and for the status cards in the transcript, so future refactors touch one component.
The shell owns the panel, header, footer, tones, close and chevron; a card supplies its lead glyph, title, body and actions and keeps its own state. The look itself is documented in session-chat-status-card.css.
*/

import { IconChevronRight, IconX } from '@tabler/icons-react';
import {
  useId,
  type ComponentType,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
  useRef,
} from 'react';
import { cn } from '@/packages/components/utils';
import { SessionChatDisclosureBody } from './session-chat-disclosure-body';
import { useSessionChatHeightTransition } from './session-chat-height-transition';

export type SessionChatStatusCardSeverity = 'info' | 'warning' | 'error';

type IconComponent = ComponentType<{ className?: string; stroke?: number; 'aria-hidden'?: boolean | 'true' }>;

export interface SessionChatStatusCardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  ref?: Ref<HTMLDivElement>;
  /** Leading glyph in a one-line box: `SessionChatStatusCardLead` or `SessionChatStatusCardDot`. */
  lead?: ReactNode;
  title: ReactNode;
  /** Muted text after the title, e.g. "3 running". */
  meta?: ReactNode;
  /** Extra header content between the title and the close/chevron. Interactive pieces must stop propagation. */
  trailing?: ReactNode;
  onClose?: () => void;
  closeLabel?: string;
  /** With `onOpenChange`, the whole header toggles the body and shows a chevron. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Hover text for the header toggle. */
  toggleTitle?: { open: string; closed: string };
  /**
   * For a card whose body stays visible but swaps a preview for the full
   * content (a picker): the header is clickable and reports `headerExpanded`,
   * without folding the body. Pair with `SessionChatStatusCardChevron` in `trailing`.
   */
  onHeaderActivate?: () => void;
  headerExpanded?: boolean;
  severity?: SessionChatStatusCardSeverity;
  /** The saved-draft size: 0.75rem text, tight padding. */
  compact?: boolean;
  /** Actions band under the panel. Use `SessionChatStatusCardActions` for the right-aligned group. */
  footer?: ReactNode;
  /** A value whose change eases the body between its old and new height (a preview swapping for the full text, rows folding). */
  bodyTransitionKey?: unknown;
  bodyClassName?: string;
  children?: ReactNode;
}

export function SessionChatStatusCard({
  ref,
  lead,
  title,
  meta,
  trailing,
  onClose,
  closeLabel = 'Dismiss',
  open,
  onOpenChange,
  toggleTitle,
  onHeaderActivate,
  headerExpanded,
  severity,
  compact = false,
  footer,
  bodyClassName,
  bodyTransitionKey,
  className,
  children,
  ...rest
}: SessionChatStatusCardProps) {
  const bodyId = useId();
  const plainBodyRef = useRef<HTMLDivElement>(null);
  useSessionChatHeightTransition(plainBodyRef, bodyTransitionKey);
  const collapsible = open !== undefined && onOpenChange !== undefined;
  const clickable = collapsible || onHeaderActivate !== undefined;
  const activate = (): void => {
    if (collapsible) {
      onOpenChange?.(!open);
    } else {
      onHeaderActivate?.();
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) {
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate();
    }
  };
  return (
    <div
      className={cn('ghostex-chat-prompt-card ghostex-chat-status-card-shell', className)}
      data-compact={compact ? 'true' : undefined}
      data-severity={severity}
      ref={ref}
      {...rest}
    >
      <div className='ghostex-chat-status-card-panel'>
        <div
          aria-controls={collapsible && open ? bodyId : undefined}
          aria-expanded={collapsible ? open : onHeaderActivate ? headerExpanded : undefined}
          className={cn('ghostex-chat-status-card-header-row', clickable && 'ghostex-chat-status-card-header')}
          data-header-only={!collapsible && clickable ? 'true' : undefined}
          onClick={clickable ? activate : undefined}
          onKeyDown={clickable ? onKeyDown : undefined}
          role={clickable ? 'button' : undefined}
          tabIndex={clickable ? 0 : undefined}
          title={collapsible && toggleTitle ? (open ? toggleTitle.open : toggleTitle.closed) : undefined}
        >
          {lead}
          <span className='ghostex-chat-status-card-heading'>
            {title}
            {meta !== undefined && meta !== null && meta !== '' ? (
              <span className='ghostex-chat-status-card-meta'>{meta}</span>
            ) : null}
          </span>
          {trailing}
          {onClose ? <SessionChatStatusCardClose label={closeLabel} onClick={onClose} /> : null}
          {collapsible ? (
            <span aria-hidden='true' className='ghostex-chat-status-card-lead'>
              <IconChevronRight className={cn('ghostex-chat-disclosure-chevron', open && 'is-open')} />
            </span>
          ) : null}
        </div>
        {children === undefined || children === null || children === false ? null : collapsible ? (
          <SessionChatDisclosureBody
            className={bodyClassName}
            id={bodyId}
            open={open}
            transitionKey={bodyTransitionKey}
          >
            {children}
          </SessionChatDisclosureBody>
        ) : (
          <div className={cn('ghostex-chat-status-card-body', bodyClassName)} ref={plainBodyRef}>
            {children}
          </div>
        )}
      </div>
      {footer === undefined || footer === null || footer === false ? null : (
        <div className='ghostex-chat-status-card-footer'>{footer}</div>
      )}
    </div>
  );
}

/** An icon in the header's one-line box. */
export function SessionChatStatusCardLead({ icon: Icon, className }: { icon: IconComponent; className?: string }) {
  return (
    <span aria-hidden='true' className={cn('ghostex-chat-status-card-lead', className)}>
      <Icon aria-hidden='true' stroke={1.8} />
    </span>
  );
}

/** The blinking dot: only for something that is working right now. */
export function SessionChatStatusCardDot({ active = true }: { active?: boolean }) {
  return (
    <span aria-hidden='true' className='ghostex-chat-status-card-lead'>
      <span className='ghostex-chat-status-card-dot' data-active={active ? 'true' : 'false'} />
    </span>
  );
}

function stopHeaderToggle(event: MouseEvent<HTMLButtonElement>): void {
  event.stopPropagation();
}

/** The circled X. */
export function SessionChatStatusCardClose({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <span className='ghostex-chat-status-card-lead'>
      <button
        aria-label={label}
        className='ghostex-chat-status-card-close'
        disabled={disabled}
        onClick={(event) => {
          stopHeaderToggle(event);
          onClick();
        }}
        type='button'
      >
        <IconX aria-hidden='true' stroke={2} />
      </button>
    </span>
  );
}

/**
 * A chevron for cards that stay open but swap a preview for the full content
 * (the goal, a received message, a picker), where the shell's own toggle would
 * hide the body instead.
 */
export function SessionChatStatusCardChevron({
  expanded,
  label,
  onClick,
}: {
  expanded: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <span className='ghostex-chat-status-card-lead'>
      <button
        aria-expanded={expanded}
        aria-label={label}
        className='ghostex-chat-status-card-chevron'
        onClick={(event) => {
          stopHeaderToggle(event);
          onClick();
        }}
        title={label}
        type='button'
      >
        <IconChevronRight aria-hidden='true' className={cn('ghostex-chat-disclosure-chevron', expanded && 'is-open')} />
      </button>
    </span>
  );
}

/** Right-aligned action group inside the footer; anything before it stays left. */
export function SessionChatStatusCardActions({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('ghostex-chat-status-card-actions', className)}>{children}</div>;
}

/** A body row with a right-aligned annotation, e.g. the tool name or question counter. */
export function SessionChatStatusCardRow({ annotation, children }: { annotation?: ReactNode; children: ReactNode }) {
  return (
    <div className='ghostex-chat-status-card-row'>
      {children}
      {annotation ? <span className='ghostex-chat-status-card-annotation'>{annotation}</span> : null}
    </div>
  );
}
