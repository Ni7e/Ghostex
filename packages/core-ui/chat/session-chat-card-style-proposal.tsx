/*
Story-only mockups: every card above the composer rebuilt in the family 1
"status card" style, so the whole set can be judged on one board before any
production component changes. They reuse the real shared pieces (the
edge-to-edge header hover, the animated disclosure body, the chevron, the
buttons) and only fake the content. Nothing here is imported by product code.
*/

import { useState, type ReactNode } from 'react';
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconChevronRight,
  IconCircleCheckFilled,
  IconFileText,
  IconHelpCircle,
  IconInfoCircle,
  IconListCheck,
  IconLoader2,
  IconPuzzle,
  IconShieldCheck,
  IconTerminal2,
  IconX,
} from '@tabler/icons-react';
import { Button } from '@/packages/components/ui/button';
import { cn } from '@/packages/components/utils';
import { SessionChatDisclosureBody } from './session-chat-disclosure-body';

type Tone = 'working' | 'idle' | 'info' | 'warning' | 'error';

/** The knobs the options story exposes; the proposal board uses the defaults. */
export interface ProposedLook {
  /** `dot`: dot + regular title. `plain`: no dot, medium title. `dot-medium`: dot + medium title. */
  header?: 'dot' | 'plain' | 'dot-medium';
  /** Bare glyph, or the circled X the question card uses today. */
  dismiss?: 'plain' | 'circle';
  /** Question card colours (card fill, muted panel, footer band) or the status card's muted fill. */
  colors?: 'card' | 'muted';
  /** Today's question card padding (1.25rem/1rem) instead of the status card's 1rem/0.75rem. */
  roomy?: boolean;
  /** One-line bar at the saved-draft notice's size: 0.75rem text, 0.3125rem/0.625rem padding. */
  compact?: boolean;
}

const DEFAULT_LOOK: Required<ProposedLook> = {
  header: 'dot-medium',
  dismiss: 'circle',
  colors: 'card',
  roomy: false,
  compact: false,
};

/*
CDXC:SessionChat 2026-09-16 DECISION:
User: the cards above the composer use two tones, a panel for the header and body and a band for the actions, both a bit lighter and greyer than the page in dark mode and a bit darker in light mode.
Mixing the foreground into the background gives that in both themes from one formula.
*/
export const PROPOSED_PANEL_BACKGROUND =
  'color-mix(in srgb, var(--foreground) var(--proposed-panel-mix, 7%), var(--background))';
export const PROPOSED_FOOTER_BACKGROUND =
  'color-mix(in srgb, var(--foreground) var(--proposed-footer-mix, 3.5%), var(--background))';

/**
 * Light mode needs a lighter hand: the same mix that lifts a dark page reads
 * as mud on a white one. Stories that show the proposal include this once.
 */
export const PROPOSED_TONES_CSS = `
  [data-chat-theme='light'] {
    --proposed-panel-mix: 3%;
    --proposed-footer-mix: 1.5%;
  }
`;

const DOT_TONES: Record<Tone, string> = {
  working: 'bg-primary animate-pulse',
  idle: 'bg-muted-foreground/60',
  info: 'bg-primary',
  warning: 'bg-foreground/70',
  error: 'bg-destructive',
};

function Dot({ tone }: { tone: Tone }) {
  return (
    <span aria-hidden='true' className='flex h-[1lh] shrink-0 items-center'>
      <span className={cn('size-1.5 rounded-full', DOT_TONES[tone])} />
    </span>
  );
}

function Lead({ children }: { children: ReactNode }) {
  return (
    <span aria-hidden='true' className='flex h-[1lh] shrink-0 items-center text-muted-foreground'>
      {children}
    </span>
  );
}

/** Notices lead with a severity glyph; only working status keeps the blinking dot. */
function ToneIcon({ tone }: { tone: Tone }) {
  const className = 'size-3.5';
  return (
    <Lead>
      {tone === 'error' ? (
        <IconAlertCircle className={cn(className, 'text-destructive')} stroke={1.8} />
      ) : tone === 'warning' ? (
        <IconAlertTriangle className={className} stroke={1.8} />
      ) : (
        <IconInfoCircle className={className} stroke={1.8} />
      )}
    </Lead>
  );
}

function IconButton({
  label,
  children,
  circle = false,
  onClick,
}: {
  label: string;
  children: ReactNode;
  circle?: boolean;
  onClick?: () => void;
}) {
  return (
    <span className='flex h-[1lh] shrink-0 items-center'>
      <button
        aria-label={label}
        className={cn(
          'flex shrink-0 items-center justify-center text-muted-foreground hover:text-foreground',
          circle && 'size-6 rounded-full border border-border/65 bg-background/40 hover:bg-background/70'
        )}
        // The chat scope gives every button a pill border; a bare glyph in the
        // header should have none. Inline because this file is story-only.
        style={circle ? undefined : { background: 'transparent', border: 0, borderRadius: 0, padding: 0 }}
        onClick={(event) => {
          event.stopPropagation();
          onClick?.();
        }}
        type='button'
      >
        {children}
      </button>
    </span>
  );
}

/**
 * The family 1 shell and header, with an optional collapsible body and an
 * optional footer band. The default look takes its colours from the question
 * card: card fill with an input border, a muted panel for the header and body,
 * and the bare card surface under a hairline for the actions.
 */
export function ProposedStatusCard({
  lead,
  title,
  meta,
  dismiss,
  trailing,
  collapsible = false,
  defaultOpen = true,
  severity,
  footer,
  look: lookOverride,
  children,
}: {
  lead?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  dismiss?: () => void;
  trailing?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  severity?: 'error';
  footer?: ReactNode;
  look?: ProposedLook;
  children?: ReactNode;
}) {
  const look = { ...DEFAULT_LOOK, ...lookOverride };
  const [open, setOpen] = useState(defaultOpen);
  const expandable = collapsible && children !== undefined;
  const cardColors = look.colors === 'card';
  // CDXC:SessionChat 2026-09-16 DECISION: User: a card whose border carries a colour (an error notice) is one tone, not two; the coloured frame is the emphasis, and a second band under it looks busy.
  const singleTone = severity !== undefined;
  const padding = look.compact ? 'px-2.5 py-[0.3125rem]' : look.roomy ? 'px-5 py-4' : 'px-4 py-3';
  const body = children !== undefined || (!cardColors && footer !== undefined);
  return (
    <div
      className={cn(
        'ghostex-chat-prompt-card grid min-w-0 overflow-hidden rounded-xl border',
        look.compact ? 'text-xs' : 'text-sm',
        !cardColors && 'bg-muted/20',
        severity === 'error' ? 'border-destructive/40' : cardColors ? 'border-input' : 'border-border/65'
      )}
      data-proposed-card
      style={{
        ...(cardColors ? { background: singleTone ? PROPOSED_PANEL_BACKGROUND : PROPOSED_FOOTER_BACKGROUND } : {}),
        // The prompt-card class pins 0.875rem; a compact bar is the saved-draft size.
        ...(look.compact ? { fontSize: '0.75rem' } : {}),
      }}
    >
      <div
        className={cn('grid min-w-0', padding)}
        style={cardColors ? { background: PROPOSED_PANEL_BACKGROUND } : undefined}
      >
        <div
          aria-expanded={expandable ? open : undefined}
          className={cn(
            'flex min-w-0 items-start gap-2 text-left outline-none',
            // A compact bar has nothing to expand, so it skips the edge-to-edge
            // hover header and its 1rem/0.75rem negative margins.
            look.compact ? 'leading-normal' : 'ghostex-chat-status-card-header leading-relaxed',
            look.roomy && 'ghostex-chat-status-card-header-roomy',
            expandable && 'cursor-pointer'
          )}
          data-expandable={expandable ? 'true' : undefined}
          onClick={() => expandable && setOpen((value) => !value)}
          role={expandable ? 'button' : undefined}
          tabIndex={expandable ? 0 : undefined}
        >
          {look.header === 'plain' ? null : lead}
          <span
            className={cn(
              'min-w-0 flex-1 whitespace-pre-wrap break-words',
              look.header === 'dot' ? 'text-foreground/90' : 'font-medium text-foreground'
            )}
          >
            {title}
            {meta ? <span className='ml-2 font-normal text-muted-foreground tabular-nums'>{meta}</span> : null}
          </span>
          {trailing}
          {dismiss ? (
            <IconButton circle={look.dismiss === 'circle'} label='Dismiss' onClick={dismiss}>
              <IconX className='size-3.5' stroke={2} />
            </IconButton>
          ) : null}
          {expandable ? (
            <span aria-hidden='true' className='flex h-[1lh] shrink-0 items-center'>
              <IconChevronRight
                className={cn('ghostex-chat-disclosure-chevron size-3.5 text-muted-foreground', open && 'is-open')}
              />
            </span>
          ) : null}
        </div>
        {body ? (
          <SessionChatDisclosureBody open={expandable ? open : true}>
            <div className='grid min-w-0 gap-3'>
              {children}
              {!cardColors && footer !== undefined ? (
                <div className='flex min-w-0 flex-wrap items-center gap-2'>{footer}</div>
              ) : null}
            </div>
          </SessionChatDisclosureBody>
        ) : null}
      </div>
      {cardColors && footer !== undefined ? (
        <div
          className={cn(
            'flex min-w-0 flex-wrap items-center gap-2 border-t border-border/65 py-2.5',
            look.roomy ? 'px-5' : 'px-4'
          )}
        >
          {footer}
        </div>
      ) : null}
    </div>
  );
}

/* --- Family 2 ------------------------------------------------------------- */

export function ProposedTasks({ look, rowSize = 'sm' }: { look?: ProposedLook; rowSize?: 'sm' | 'lg' }) {
  const [showCompleted, setShowCompleted] = useState(false);
  const rowClass = rowSize === 'lg' ? 'text-base leading-6' : 'text-sm leading-[1.375rem]';
  return (
    <ProposedStatusCard
      look={look}
      lead={
        <Lead>
          <IconListCheck className='size-3.5' stroke={1.8} />
        </Lead>
      }
      title='Tasks'
      meta='2 of 4 done'
      trailing={
        <span aria-hidden='true' className='flex h-[1lh] shrink-0 items-center'>
          <span className='h-1 w-14 overflow-hidden rounded-full bg-foreground/10'>
            <span className='block h-full w-1/2 rounded-full bg-primary' />
          </span>
        </span>
      }
      collapsible
    >
      <ul className={cn('grid gap-1', rowClass)}>
        <li className='flex items-center gap-2 text-foreground'>
          <IconLoader2 className='size-3.5 shrink-0 animate-spin text-primary' stroke={2} />
          Review the gallery
        </li>
        <li className='flex items-center gap-2 text-muted-foreground'>
          <span className='size-3.5 shrink-0 rounded-full border border-muted-foreground/50' />
          Unify the styles
          <span className='text-xs text-muted-foreground/80'>waits for #2</span>
        </li>
        <li className='flex items-center gap-2 text-muted-foreground line-through decoration-muted-foreground/60'>
          <IconCircleCheckFilled className='size-3.5 shrink-0 text-muted-foreground' />
          Inventory card layouts
        </li>
        {showCompleted ? (
          <li className='flex items-center gap-2 text-muted-foreground line-through decoration-muted-foreground/60'>
            <IconCircleCheckFilled className='size-3.5 shrink-0 text-muted-foreground' />
            Collect examples
          </li>
        ) : null}
      </ul>
      {/* The fold is a line of text under a hairline, not a button: it reads
          as part of the list and expands the rows in place. */}
      <div className='border-t border-border/50 pt-2'>
        <button
          aria-expanded={showCompleted}
          className='text-xs text-muted-foreground hover:text-foreground'
          onClick={() => setShowCompleted((value) => !value)}
          style={{ background: 'transparent', border: 0, borderRadius: 0, padding: 0 }}
          type='button'
        >
          {showCompleted ? 'Show less tasks' : '1 more task'}
        </button>
      </div>
    </ProposedStatusCard>
  );
}

export function ProposedExtensionPanel({ look, onClose }: { look?: ProposedLook; onClose?: () => void }) {
  return (
    <ProposedStatusCard
      look={look}
      lead={
        <Lead>
          <IconPuzzle className='size-3.5' stroke={1.8} />
        </Lead>
      }
      title='Session Scratchpad'
      dismiss={onClose}
      collapsible
    >
      <div className='flex h-24 items-center justify-center rounded-lg border border-border/65 bg-background/60 text-xs text-muted-foreground'>
        Extension content
      </div>
    </ProposedStatusCard>
  );
}

/* --- Family 3 ------------------------------------------------------------- */

function Actions({ children }: { children: ReactNode }) {
  return <div className='ml-auto flex flex-wrap items-center justify-end gap-2'>{children}</div>;
}

function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className='ml-0.5 flex h-4 shrink-0 items-center rounded border border-border/60 bg-background/50 px-1 font-mono text-[10px] font-medium text-muted-foreground'>
      {children}
    </kbd>
  );
}

export function ProposedNotice({
  title,
  detail,
  tone,
  dismiss,
  footer,
  look,
  children,
}: {
  title: string;
  detail?: string;
  tone: Tone;
  dismiss?: () => void;
  footer?: ReactNode;
  look?: ProposedLook;
  children?: ReactNode;
}) {
  return (
    <ProposedStatusCard
      lead={<ToneIcon tone={tone} />}
      title={title}
      severity={tone === 'error' ? 'error' : undefined}
      dismiss={dismiss}
      footer={footer}
      look={look}
    >
      {detail ? <p className='text-muted-foreground'>{detail}</p> : null}
      {children}
    </ProposedStatusCard>
  );
}

export function ProposedComposerNotReady({ look }: { look?: ProposedLook }) {
  return (
    <ProposedNotice
      look={look}
      title='Message not sent. Your draft was restored.'
      detail='The agent is waiting for setup to finish.'
      tone='error'
      footer={
        <Actions>
          <Button size='sm' variant='outline' type='button'>
            <IconChevronRight stroke={1.8} />
            Show terminal
          </Button>
          <Button size='sm' variant='outline' type='button'>
            <IconTerminal2 stroke={1.8} />
            Open Terminal
          </Button>
        </Actions>
      }
    />
  );
}

export function ProposedDeliveryNotice({ dismiss, look }: { dismiss?: () => void; look?: ProposedLook }) {
  return (
    <ProposedNotice
      look={look}
      title='Input is queued in the terminal'
      detail='The agent has not consumed the queued input yet.'
      tone='info'
      dismiss={dismiss}
      footer={
        <Actions>
          <Button size='sm' variant='outline' type='button'>
            <IconTerminal2 stroke={1.8} />
            Open terminal
          </Button>
        </Actions>
      }
    />
  );
}

export function ProposedDetectedNotice({ dismiss, look }: { dismiss?: () => void; look?: ProposedLook }) {
  return (
    <ProposedNotice
      look={look}
      title='Claude Code is waiting to continue'
      detail='The usage limit has reset and Claude Code is waiting for a keypress before it resumes.'
      tone='warning'
      dismiss={dismiss}
      footer={
        <>
          <Button size='sm' variant='outline' type='button'>
            Continue now
            <Key>⌘ Enter</Key>
          </Button>
          <Actions>
            <Button size='sm' variant='outline' type='button'>
              <IconTerminal2 stroke={1.8} />
              Open terminal
            </Button>
          </Actions>
        </>
      }
    />
  );
}

export function ProposedTerminalMenu({ look }: { look?: ProposedLook }) {
  return (
    <ProposedStatusCard
      lead={
        <Lead>
          <IconTerminal2 className='size-3.5' stroke={1.8} />
        </Lead>
      }
      title='Usage-limit continuation'
      collapsible
      look={look}
    >
      <div className='grid gap-2 sm:grid-cols-2'>
        <Button
          className='h-auto justify-between whitespace-normal py-2 text-left'
          size='sm'
          variant='outline'
          type='button'
        >
          Stop and wait for limit to reset
          <Key>⌘ Enter</Key>
        </Button>
        <Button
          className='h-auto justify-between whitespace-normal py-2 text-left'
          size='sm'
          variant='outline'
          type='button'
        >
          Continue automatically shortly
          <Key>Esc</Key>
        </Button>
      </div>
    </ProposedStatusCard>
  );
}

/* --- Family 4 ------------------------------------------------------------- */

export function ProposedApproval({ dismiss, look }: { dismiss?: () => void; look?: ProposedLook }) {
  return (
    <ProposedStatusCard
      lead={
        <Lead>
          <IconShieldCheck className='size-3.5' stroke={1.8} />
        </Lead>
      }
      title='Approval request'
      dismiss={dismiss}
      look={look}
      footer={
        <Actions>
          <Button size='sm' variant='outline' type='button'>
            Deny
          </Button>
          <Button size='sm' variant='outline' type='button'>
            Allow
          </Button>
        </Actions>
      }
    >
      <div className='flex min-w-0 items-baseline justify-between gap-3'>
        <p className='text-foreground/90'>Allow this command?</p>
        <span className='shrink-0 text-xs text-muted-foreground'>Bash</span>
      </div>
      <pre className='overflow-x-auto rounded-lg border border-border/65 bg-background/70 p-3 font-mono text-xs leading-relaxed text-foreground'>
        git diff --stat
      </pre>
    </ProposedStatusCard>
  );
}

/**
 * The question's X was the interrupt (Escape to the CLI), an action rather than
 * a dismiss, and it sat awkwardly beside the collapse chevron. It is a Cancel
 * button in the footer instead; the header keeps only the chevron.
 */
export function ProposedQuestion({ dismiss, look }: { dismiss?: () => void; look?: ProposedLook }) {
  const options = [
    ['Shared controls', 'Unify the buttons and inputs.'],
    ['Card layouts', 'Align padding, borders and typography.'],
  ];
  return (
    <ProposedStatusCard
      lead={
        <Lead>
          <IconHelpCircle className='size-3.5' stroke={1.8} />
        </Lead>
      }
      title='Next step'
      look={look}
      collapsible
      footer={
        <>
          <input
            className='h-8 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground'
            placeholder='Write a custom answer…'
            type='text'
          />
          <Button size='sm' variant='ghost' type='button' onClick={dismiss}>
            Cancel
          </Button>
          <Button size='sm' variant='outline' type='button'>
            Send answer
          </Button>
        </>
      }
    >
      <div className='flex min-w-0 items-baseline justify-between gap-3'>
        <p className='text-foreground/90'>Which part should I update first?</p>
        <span className='shrink-0 text-xs text-muted-foreground tabular-nums'>question 1 of 1</span>
      </div>
      <div className='grid gap-1.5'>
        {options.map(([label, description], index) => (
          <button
            className='flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border/65 bg-background/70 px-3 py-2 text-left hover:border-ring'
            key={label}
            type='button'
          >
            <span className='min-w-0'>
              <span className='block text-foreground'>{label}</span>
              <span className='block text-xs text-muted-foreground'>{description}</span>
            </span>
            <span className='shrink-0 text-xs text-muted-foreground tabular-nums'>{index + 1}</span>
          </button>
        ))}
      </div>
    </ProposedStatusCard>
  );
}

/* --- Family 5 ------------------------------------------------------------- */

export function ProposedDraftNotice({
  look,
  onUse,
  onDismiss,
}: {
  look?: ProposedLook;
  onUse?: () => void;
  onDismiss?: () => void;
}) {
  const textButton = { background: 'transparent', border: 0, borderRadius: 0, padding: '0 0.25rem' } as const;
  return (
    <ProposedStatusCard
      look={{ compact: true, ...look }}
      lead={
        <Lead>
          <IconFileText className='size-3.5' stroke={1.8} />
        </Lead>
      }
      title='Another saved draft is available'
      trailing={
        <span className='flex h-[1lh] shrink-0 items-center gap-1'>
          <button className='text-xs font-semibold text-foreground' style={textButton} type='button' onClick={onUse}>
            Use
          </button>
          <button
            className='text-xs font-semibold text-foreground'
            style={textButton}
            type='button'
            onClick={onDismiss}
          >
            Dismiss
          </button>
        </span>
      }
    />
  );
}

/* --- Family 6 ------------------------------------------------------------- */

export function ProposedWorkingStrip({ look, word }: { look?: ProposedLook; word: string }) {
  return (
    <ProposedStatusCard
      look={look}
      lead={
        <Lead>
          <span className='ghostex-chat-working-strip-spark'>
            <svg viewBox='0 0 24 24'>
              <path d='M12 0.8c.5 4.6 1.8 7.4 3.6 9.1 1.6 1.6 4.2 2.5 7.6 2.1-3.4-.4-6 .5-7.6 2.1-1.8 1.7-3.1 4.5-3.6 9.1-.5-4.6-1.8-7.4-3.6-9.1C6.8 12.5 4.2 11.6.8 12c3.4.4 6-.5 7.6-2.1C10.2 8.2 11.5 5.4 12 .8z' />
            </svg>
          </span>
        </Lead>
      }
      title={`${word}…`}
    />
  );
}
