// React renderer for the context details editor. Preferences and row operations are shared with native chat.
import {
  moveContextRow as moveRow,
  matchesContextDetailFilter,
  toggleContextDetailStar,
  reorderContextDetails,
} from '@/packages/shared/session-chat-presentation/context-editor';

import {
  IconFileImport,
  IconFileExport,
  IconGripVertical,
  IconSearch,
  IconStar,
  IconStarFilled,
  IconX,
} from '@tabler/icons-react';
import { PointerActivationConstraints, PointerSensor } from '@dnd-kit/dom';
import { DragDropProvider, type DragDropEventHandlers } from '@dnd-kit/react';
import { isSortableOperation, useSortable } from '@dnd-kit/react/sortable';
import { useEffect, useState } from 'react';
import { Button } from '@/packages/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/packages/components/ui/dialog';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/packages/components/ui/input-group';
import { Switch } from '@/packages/components/ui/switch';
import { cn } from '@/packages/components/utils';
import type { SessionChatTheme } from '@/packages/shared/session-chat';
import { AppTooltip } from '../app-tooltip';
import { AccountText, useAccountText } from '../accounts/account-text';
import { postAppModalHostMessage } from '../app-modal-host-bridge';
import { createAppToastRequest } from '@/packages/shared/app-toast-contract';
import type { ContextDetailStatus, ContextDetailsAgent } from './session-chat-context-details-agents';
import {
  copySessionChatContextDetailsPreferences,
  mapSessionChatContextDetailsPreferences,
  DEFAULT_SESSION_CHAT_CONTEXT_DETAILS_PREFERENCES,
  SESSION_CHAT_CONTEXT_DETAIL_GROUPS,
  isSessionChatContextDetailShown,
  isSessionChatContextDetailStarred,
  orderedSessionChatContextDetailRows,
  orderedSessionChatStarredRows,
  readSessionChatContextDetailsPreferences,
  useSessionChatContextDetailsClock,
  writeSessionChatContextDetailsPreferences,
  type SessionChatContextDetailGroupId,
  type SessionChatContextDetailRowDefinition,
  type SessionChatContextDetailSession,
  type SessionChatContextDetailsPreferences,
} from './session-chat-context-details';

/** CDXC:AgentProviders 2026-09-14 DECISION:
 * User: hide Copy to and Copy from for both Claude and Codex for now because the feature is not working well.
 * This temporarily supersedes the earlier decision to show the transfer buttons in the statusline settings modal.
 */
const SHOW_CONTEXT_DETAILS_COPY_BUTTONS = false;

const rowSensors = [
  PointerSensor.configure({
    activationConstraints: () => [new PointerActivationConstraints.Distance({ value: 4 })],
  }),
];

export function SessionChatContextDetailsDialog({
  agent = 'claude',
  onOpenChange,
  open,
  session,
  status,
  theme,
}: {
  agent?: ContextDetailsAgent;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  /** Ghostex's own title, id and draft state for the session row. */
  session: SessionChatContextDetailSession | null;
  /** Live sample values next to each row; absent rows show a dash. */
  status: ContextDetailStatus | undefined;
  theme: SessionChatTheme;
}) {
  const [draft, setDraft] = useState<SessionChatContextDetailsPreferences>(() =>
    readSessionChatContextDetailsPreferences(agent)
  );
  const [query, setQuery] = useState('');
  const now = useSessionChatContextDetailsClock();

  useEffect(() => {
    if (open) {
      setDraft(readSessionChatContextDetailsPreferences(agent));
      setQuery('');
    }
  }, [open, agent]);

  const toggleShown = (row: SessionChatContextDetailRowDefinition, shown: boolean) => {
    setDraft((current) => ({ ...current, shown: { ...current.shown, [row.id]: shown } }));
  };
  const toggleStarred = (row: SessionChatContextDetailRowDefinition) => {
    setDraft((current) => toggleContextDetailStar(current, row, agent));
  };
  const reorderStarred = (from: number, to: number) => {
    setDraft((current) => ({
      ...current,
      starredOrder: moveRow(orderedSessionChatStarredRows(current, agent), from, to).map((row) => row.id),
    }));
  };
  const starredRows = orderedSessionChatStarredRows(draft, agent);
  const handleStarredDragEnd = ((event) => {
    if (event.canceled || !isSortableOperation(event.operation)) {
      return;
    }
    const { source, target } = event.operation;
    if (!source) {
      return;
    }
    const toIndex = 'index' in source && typeof source.index === 'number' ? source.index : target?.index;
    if (toIndex == null || source.initialIndex === toIndex) {
      return;
    }
    reorderStarred(source.initialIndex, toIndex);
  }) satisfies DragDropEventHandlers['onDragEnd'];
  /**
   * Moves by row id, not by list index: while the filter bar hides rows, the
   * dragged list is a subset of the group, so the move is applied to the full
   * group order by putting the moved row where the target row sits.
   */
  const reorder = (
    group: SessionChatContextDetailGroupId,
    fromId: SessionChatContextDetailRowDefinition['id'],
    toId: SessionChatContextDetailRowDefinition['id']
  ) => {
    setDraft((current) => reorderContextDetails(current, agent, group, fromId, toId));
  };

  // Groups with no row left after the filter are dropped so a label never renders alone.
  const filteredGroups = SESSION_CHAT_CONTEXT_DETAIL_GROUPS.map((group) => ({
    group,
    rows: orderedSessionChatContextDetailRows(draft, group.id, agent)
      .map((row) => ({ row, sample: status ? row.value({ status, now, session }) : null }))
      .filter(({ row, sample }) => matchesContextDetailFilter(query, row, sample)),
  })).filter(({ rows }) => rows.length > 0);

  const otherAgent = agent === 'claude' ? 'codex' : 'claude';
  const otherAgentName = otherAgent === 'claude' ? 'Claude Code' : 'Codex';
  const transferSettings = (direction: 'to' | 'from') => {
    let message;
    try {
      let result: { matched: number; skipped: number };
      if (direction === 'to') {
        result = copySessionChatContextDetailsPreferences(draft, agent);
      } else {
        const imported = mapSessionChatContextDetailsPreferences(
          readSessionChatContextDetailsPreferences(otherAgent),
          otherAgent,
          draft
        );
        setDraft(imported.preferences);
        result = imported;
      }
      message = createAppToastRequest(
        'success',
        `Settings copied ${direction} ${otherAgentName}`,
        `${result.matched} selections mapped. ${result.skipped} fields have no counterpart.${direction === 'from' ? ' Save to apply these changes.' : ''}`
      );
    } catch {
      message = createAppToastRequest('error', 'Could not copy settings', 'The browser could not save the settings.');
    }
    postAppModalHostMessage(message, 'SessionChatContextDetails:copy');
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className={cn(
          'ghostex-session-chat-popup ghostex-chat-context-details-dialog flex max-h-[calc(100vh-1.5rem)] w-full max-w-[calc(100%-1.5rem)] flex-col gap-4 rounded-xl p-4 font-sans sm:max-h-[calc(100vh-2rem)] sm:max-w-xl sm:gap-6 sm:p-6 [--radius:0.625rem]',
          theme === 'dark' && 'dark'
        )}
      >
        <DialogHeader>
          <div className='flex w-full items-center justify-between gap-2'>
            <DialogTitle>Context details</DialogTitle>
            {SHOW_CONTEXT_DETAILS_COPY_BUTTONS && (
              <div className='ml-auto flex shrink-0 items-center gap-1'>
                <AppTooltip content={`Copy settings from ${otherAgentName}`}>
                  <Button
                    aria-label={`Copy settings from ${otherAgentName}`}
                    size='icon-xs'
                    variant='ghost'
                    type='button'
                    onClick={() => transferSettings('from')}
                  >
                    <IconFileImport className='size-3.5' />
                  </Button>
                </AppTooltip>
                <AppTooltip content={`Copy settings to ${otherAgentName}`}>
                  <Button
                    aria-label={`Copy settings to ${otherAgentName}`}
                    size='icon-xs'
                    variant='ghost'
                    type='button'
                    onClick={() => transferSettings('to')}
                  >
                    <IconFileExport className='size-3.5' />
                  </Button>
                </AppTooltip>
              </div>
            )}
          </div>
          <DialogDescription>
            Pick the rows shown under the context meter in {agent === 'claude' ? 'Claude Code' : 'Codex'} sessions. Drag
            to reorder within a group. Star a row to show its value under the chat box.
          </DialogDescription>
        </DialogHeader>
        {/* User: the filter bar is rounded, unlike the square inputs elsewhere, so it reads as a search field. */}
        <InputGroup className='ghostex-chat-context-details-filter h-8 shrink-0 rounded-lg border-border/70 bg-muted/40 dark:bg-muted/25'>
          <InputGroupAddon className='pl-2.5 text-muted-foreground/80'>
            <IconSearch aria-hidden='true' className='size-3.5' stroke={2} />
          </InputGroupAddon>
          <InputGroupInput
            aria-label='Search rows'
            autoFocus
            className='h-8 pl-1 text-[13px] font-normal placeholder:text-muted-foreground/60 md:text-[13px]'
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder='Search rows'
            value={query}
          />
          {query.length > 0 ? (
            <InputGroupAddon align='inline-end' className='pr-1.5'>
              <InputGroupButton
                aria-label='Clear search'
                className='rounded-md text-muted-foreground hover:text-foreground'
                onClick={() => setQuery('')}
                size='icon-xs'
              >
                <IconX size={13} stroke={2} />
              </InputGroupButton>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
        <div className='ghostex-chat-context-details-dialog-body -mx-1 flex max-h-[60vh] min-h-0 shrink flex-col gap-1 overflow-x-hidden overflow-y-auto px-1'>
          {filteredGroups.length === 0 ? (
            <p className='ghostex-chat-context-details-empty px-1 py-6 text-center text-[11px] text-muted-foreground'>
              No rows match “{query.trim()}”.
            </p>
          ) : (
            filteredGroups.map(({ group, rows }) => {
              const handleDragEnd = ((event) => {
                if (event.canceled || !isSortableOperation(event.operation)) {
                  return;
                }
                const { source, target } = event.operation;
                if (!source) {
                  return;
                }
                const toIndex = 'index' in source && typeof source.index === 'number' ? source.index : target?.index;
                if (toIndex == null || source.initialIndex === toIndex) {
                  return;
                }
                const from = rows[source.initialIndex];
                const to = rows[toIndex];
                if (!from || !to) {
                  return;
                }
                reorder(group.id, from.row.id, to.row.id);
              }) satisfies DragDropEventHandlers['onDragEnd'];
              return (
                <section aria-label={group.label} className='flex flex-col' key={group.id}>
                  <h3 className='ghostex-chat-context-details-group-label mt-2 mb-0.5 px-1 text-[10px] font-medium tracking-[0.06em] text-muted-foreground/70 uppercase'>
                    {group.label}
                  </h3>
                  {/*
                  One provider per group: a row's sortable only knows its own
                  group's manager, so a drag can never land in another group.
                  */}
                  <DragDropProvider onDragEnd={handleDragEnd}>
                    {rows.map(({ row, sample }, index) => (
                      <ContextDetailOptionRow
                        group={group.id}
                        index={index}
                        key={row.id}
                        onToggleShown={(shown) => toggleShown(row, shown)}
                        onToggleStarred={() => toggleStarred(row)}
                        row={row}
                        sample={sample}
                        shown={isSessionChatContextDetailShown(draft, row)}
                        starred={isSessionChatContextDetailStarred(draft, row)}
                      />
                    ))}
                  </DragDropProvider>
                </section>
              );
            })
          )}
        </div>
        {/*
        The status line's own section, pinned under the scrolling groups: the
        starred rows as chips in the order they render under the chat box, drag
        to rearrange freely (this order is separate from the groups above).
        */}
        <section
          aria-label='Status line'
          className='ghostex-chat-context-details-status-line -mx-1 shrink-0 border-t border-border/60 px-1 pt-3'
        >
          <div className='mb-1.5 flex items-baseline justify-between gap-2'>
            <h3 className='text-[10px] font-medium tracking-[0.06em] text-muted-foreground/70 uppercase'>
              Status line
            </h3>
            <span className='text-[11px] text-muted-foreground'>
              {starredRows.length === 0 ? 'Star rows above to show them under the chat box.' : 'Drag to arrange.'}
            </span>
          </div>
          {starredRows.length > 0 ? (
            <DragDropProvider onDragEnd={handleStarredDragEnd}>
              <div className='flex flex-wrap gap-1.5'>
                {starredRows.map((row, index) => (
                  <StarredRowChip index={index} key={row.id} onRemove={() => toggleStarred(row)} row={row} />
                ))}
              </div>
            </DragDropProvider>
          ) : null}
        </section>
        {/* One row at every width: below the `sm` breakpoint the shared footer stacks Cancel/Save above Reset, which reads as three loose lines in a narrow chat pane. */}
        <DialogFooter className='shrink-0 flex-row flex-wrap items-center justify-between'>
          <Button
            className='-ml-3 text-muted-foreground'
            onClick={() => setDraft(DEFAULT_SESSION_CHAT_CONTEXT_DETAILS_PREFERENCES)}
            size='sm'
            type='button'
            variant='ghost'
          >
            Reset to recommended
          </Button>
          <div className='flex gap-2'>
            <Button onClick={() => onOpenChange(false)} size='sm' type='button' variant='outline'>
              Cancel
            </Button>
            <Button
              onClick={() => {
                writeSessionChatContextDetailsPreferences(draft, agent);
                onOpenChange(false);
              }}
              size='sm'
              type='button'
            >
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ContextDetailOptionRow({
  group,
  index,
  onToggleShown,
  onToggleStarred,
  row,
  sample,
  shown,
  starred,
}: {
  group: SessionChatContextDetailGroupId;
  index: number;
  onToggleShown: (shown: boolean) => void;
  onToggleStarred: () => void;
  row: SessionChatContextDetailRowDefinition;
  sample: string | null;
  shown: boolean;
  starred: boolean;
}) {
  const formatAccountText = useAccountText();
  const kind = `session-chat-context-detail:${group}`;
  const sortable = useSortable({
    accept: kind,
    group,
    id: row.id,
    index,
    sensors: rowSensors,
    type: kind,
  });
  const { handleRef, isDragging } = sortable;
  const setRowRef = (element: HTMLDivElement | null): void => {
    sortable.ref(element);
    sortable.sourceRef(element);
  };
  const sampleTitle = sample === null ? undefined : formatAccountText(sample);
  const sampleText = sample === null ? '\u2014' : <AccountText text={sample} />;

  return (
    <div
      className={cn(
        'ghostex-chat-context-details-option flex items-center gap-2 rounded-md px-1 py-1.5 hover:bg-accent/40',
        isDragging && 'bg-accent/60'
      )}
      data-dragging={isDragging ? 'true' : undefined}
      ref={setRowRef}
    >
      <button
        aria-label={`Reorder ${row.label}`}
        className='ghostex-chat-queue-row-handle'
        ref={handleRef}
        type='button'
      >
        <IconGripVertical aria-hidden='true' size={14} stroke={1.8} />
      </button>
      <div className='min-w-0 flex-1'>
        {/* In a narrow chat pane the value shares the label line; a third right-hand column would leave the description a few characters. */}
        <div className='flex items-baseline justify-between gap-2'>
          <div className='truncate text-xs text-foreground'>{row.label}</div>
          <div
            className='max-w-[55%] shrink-0 truncate text-[11px] text-muted-foreground tabular-nums sm:hidden'
            title={sampleTitle}
          >
            {sampleText}
          </div>
        </div>
        <div className='truncate text-[11px] text-muted-foreground'>{row.description}</div>
      </div>
      <div
        className='hidden max-w-[13rem] shrink-0 truncate text-[11px] text-muted-foreground tabular-nums sm:block'
        title={sampleTitle}
      >
        {sampleText}
      </div>
      <AppTooltip content={starred ? 'Remove from the status line' : 'Show under the chat box'} side='top'>
        <Button
          aria-label={starred ? `Unstar ${row.label}` : `Star ${row.label}`}
          aria-pressed={starred}
          className={cn('rounded-md', starred ? 'text-amber-300 hover:text-amber-200' : 'text-muted-foreground')}
          onClick={onToggleStarred}
          size='icon-xs'
          type='button'
          variant='ghost'
        >
          {starred ? <IconStarFilled size={13} /> : <IconStar size={13} stroke={1.8} />}
        </Button>
      </AppTooltip>
      <Switch aria-label={`Show ${row.label}`} checked={shown} onCheckedChange={onToggleShown} size='sm' />
    </div>
  );
}

function StarredRowChip({
  index,
  onRemove,
  row,
}: {
  index: number;
  onRemove: () => void;
  row: SessionChatContextDetailRowDefinition;
}) {
  const sortable = useSortable({
    accept: 'session-chat-context-detail:starred',
    id: `starred:${row.id}`,
    index,
    sensors: rowSensors,
    type: 'session-chat-context-detail:starred',
  });
  const { handleRef, isDragging } = sortable;
  const setChipRef = (element: HTMLDivElement | null): void => {
    sortable.ref(element);
    sortable.sourceRef(element);
  };

  return (
    <div
      className={cn(
        'ghostex-chat-context-details-chip flex h-6 items-center gap-1 rounded-md border border-border/70 bg-accent/30 pr-1 pl-0.5 text-[11px] text-foreground',
        isDragging && 'bg-accent/70'
      )}
      data-dragging={isDragging ? 'true' : undefined}
      ref={setChipRef}
    >
      <button
        aria-label={`Move ${row.label}`}
        className='ghostex-chat-queue-row-handle !h-5 !w-4'
        ref={handleRef}
        type='button'
      >
        <IconGripVertical aria-hidden='true' size={12} stroke={1.8} />
      </button>
      <span>{row.label}</span>
      <Button
        aria-label={`Unstar ${row.label}`}
        className='size-4 rounded-sm text-muted-foreground'
        onClick={onRemove}
        size='icon-xs'
        type='button'
        variant='ghost'
      >
        <IconX size={11} stroke={2} />
      </Button>
    </div>
  );
}
