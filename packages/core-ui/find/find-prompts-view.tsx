import { formatSidebarHotkeyLabel } from '@/packages/core-ui/hotkey-label';
import { useAppScrollbars } from '@/packages/components/ui/app-scrollbars';
/*
CDXC:PromptSearch 2026-08-20:
The Find surface — a GUI for `gx f`. Item placement follows the terminal picker
(query and hint strip on top, two-line results in the middle, the selected
prompt and its metadata at the bottom), while the type, color, spacing, and
radii come from the Session Chat surface's tokens.

The query input keeps DOM focus for the whole session so every hotkey resolves
through one handler; rows and overlays select on mousedown with the default
prevented rather than taking focus.
*/

import { IconCalendarWeek, IconCopy, IconEye, IconGitFork, IconStar, IconStarFilled } from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FindPromptAgent, FindPromptRow } from '../../shared/agent-prompt-search';
import { Button } from '@/packages/components/ui/button';
import { cn } from '@/packages/components/utils';
import { FIND_PROMPT_AGENTS } from '../../shared/agent-prompt-search';
import { FindPromptResultRow } from './find-prompt-row';
import { AppTooltip } from '../app-tooltip';
import { FIND_TOOLBAR_BUTTON_CLASS, FindAgentFilterMenu, FindProjectFilterMenu } from './find-prompts-filters';
import {
  formatDayHeader,
  formatLastActiveCompact,
  formatLastActiveFull,
  formatPromptMetaLine,
} from './find-prompts-format';
import {
  FIND_PROMPTS_HINTS,
  resolveFindPromptsAction,
  type FindPromptsAction,
  type FindPromptsHintAction,
  type FindPromptsMode,
} from './find-prompts-hotkeys';
import { FindForkOverlay } from './find-prompts-overlays';
import { FindPromptsListSkeleton, FindPromptsPreviewSkeleton } from './find-prompts-skeleton';
import type { FindPromptsTransport } from './find-prompts-transport';
import { useFindPrompts } from './use-find-prompts';

export interface FindPromptsViewProps {
  /**
   * Overrides the daemon's Accept All policy. Hosts normally omit it and let
   * gxserver apply the same setting `gx f` reads.
   */
  acceptAll?: boolean;
  /** Rendered at the top-right, for host chrome such as a close button. */
  hostActions?: React.ReactNode;
  /** Called after the page has mounted and installed its input-focus lifecycle. */
  onReady?: () => void;
  transport: FindPromptsTransport;
}

type FindFilterMenu = 'agent' | 'project' | null;

const HINT_ICONS: Record<FindPromptsHintAction, React.ComponentType<{ className?: string }> | null> = {
  copyPrompt: IconCopy,
  forkPicker: IconGitFork,
  openAgentPicker: null,
  openProjectPicker: null,
  toggleDayGrouping: IconCalendarWeek,
  toggleFavorite: IconStar,
  viewPrompt: IconEye,
};

/** Tooltip copy per toolbar action; the favorite line flips with the selected row's state. */
function hintTooltip(action: FindPromptsHintAction, active: boolean): string {
  switch (action) {
    case 'toggleDayGrouping':
      return active ? 'Stop grouping results by day' : 'Group results by day';
    case 'toggleFavorite':
      return active ? 'Remove this prompt from favorites' : 'Favorite this prompt';
    case 'viewPrompt':
      return active ? 'Close the full prompt' : 'View the full prompt';
    case 'copyPrompt':
      return 'Copy this prompt';
    case 'forkPicker':
      return active ? 'Cancel fork' : 'Fork this prompt into another agent';
    case 'openAgentPicker':
      return 'Filter by agent';
    case 'openProjectPicker':
      return 'Filter by project';
  }
}

function hotkeyLabel(key: string): string {
  return formatSidebarHotkeyLabel(key.replace('^', 'ctrl+'));
}

type ViewRow =
  /*
  `position` is carried on day headers only to key them. Toggling `^d` flips
  grouping a render before the re-sorted rows arrive, so for one frame headers
  are derived from ungrouped rows and the same day can appear twice — with a
  bare `day-<dayKey>` key that is a duplicate-key collision, and React answers
  those by dropping and duplicating siblings, which corrupted the list for good.
  */
  { dayKey: number; position: number; type: 'day' } | { position: number; row: FindPromptRow; type: 'row' };

function buildViewRows(rows: readonly FindPromptRow[], windowOffset: number, groupByDay: boolean): ViewRow[] {
  if (!groupByDay) {
    return rows.map((row, position) => ({ position: windowOffset + position, row, type: 'row' }));
  }
  const out: ViewRow[] = [];
  let lastDay: number | null = null;
  rows.forEach((row, position) => {
    if (lastDay === null || lastDay !== row.dayKey) {
      out.push({ dayKey: row.dayKey, position: windowOffset + position, type: 'day' });
      lastDay = row.dayKey;
    }
    out.push({ position: windowOffset + position, row, type: 'row' });
  });
  return out;
}

export function FindPromptsView({ acceptAll, hostActions, onReady, transport }: FindPromptsViewProps) {
  useAppScrollbars();
  const find = useFindPrompts({ acceptAll, transport });
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const selectedRef = useRef<HTMLDivElement | null>(null);
  const userInteractedAfterMountRef = useRef(false);
  const [openMenu, setOpenMenu] = useState<FindFilterMenu>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  // Relative labels ("6m ago") go stale while the surface sits open.
  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(timer);
  }, []);

  const focusQueryInput = useCallback(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  const markUserInteractedAfterMount = useCallback(() => {
    userInteractedAfterMountRef.current = true;
  }, []);

  useEffect(() => {
    userInteractedAfterMountRef.current = false;
    const focusUnlessUserInteracted = () => {
      if (!userInteractedAfterMountRef.current) {
        focusQueryInput();
      }
    };
    const retryDelaysMs = [0, 16, 50, 100, 250, 500, 1000, 1600, 2400];
    const timeoutIds = retryDelaysMs.map((delayMs) => window.setTimeout(focusUnlessUserInteracted, delayMs));
    const animationFrame = window.requestAnimationFrame(focusUnlessUserInteracted);
    const windowFocusTimeoutIds: number[] = [];
    const windowFocusAnimationFrames: number[] = [];
    const handleWindowFocus = () => {
      windowFocusTimeoutIds.push(window.setTimeout(focusUnlessUserInteracted, 0));
      windowFocusAnimationFrames.push(window.requestAnimationFrame(focusUnlessUserInteracted));
    };

    window.addEventListener('focus', handleWindowFocus);
    onReady?.();
    return () => {
      window.cancelAnimationFrame(animationFrame);
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
      windowFocusTimeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
      windowFocusAnimationFrames.forEach((frameId) => window.cancelAnimationFrame(frameId));
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [focusQueryInput, onReady]);

  const agentColors = useMemo(() => {
    const colors: Record<string, string> = {};
    for (const facet of find.agentFacets) {
      colors[facet.agent] = facet.color;
    }
    return colors;
  }, [find.agentFacets]);

  const mode: FindPromptsMode = find.overlay === 'fork' ? 'forkPicker' : find.previewFocused ? 'preview' : 'list';

  // The filter menus are the only place focus may leave the query input; hand it back as soon as they close.
  useEffect(() => {
    if (find.overlay === null && openMenu === null) {
      inputRef.current?.focus();
    }
  }, [find.overlay, openMenu]);

  const toggleMenu = useCallback((menu: Exclude<FindFilterMenu, null>) => {
    setOpenMenu((current) => (current === menu ? null : menu));
  }, []);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [find.selection, find.rows]);

  const editQuery = useCallback(
    (transform: (value: string, caret: number) => { caret: number; value: string }) => {
      const input = inputRef.current;
      const caret = input?.selectionStart ?? find.query.length;
      const next = transform(find.query, caret);
      find.setQuery(next.value);
      requestAnimationFrame(() => {
        inputRef.current?.setSelectionRange(next.caret, next.caret);
      });
    },
    [find]
  );

  const runAction = useCallback(
    (action: FindPromptsAction) => {
      switch (action.type) {
        case 'move':
          find.moveSelection(action.delta);
          break;
        case 'jumpDay':
          find.jumpDay(action.delta);
          break;
        case 'scrollPreview': {
          const pane = document.querySelector<HTMLElement>('[data-find-preview]');
          pane?.scrollBy({ top: action.delta * pane.clientHeight * 0.9 });
          break;
        }
        case 'resumePrompt':
          void find.resumeSelected();
          break;
        case 'close':
          transport.close?.();
          break;
        case 'toggleDayGrouping':
          find.setGroupByDay(!find.groupByDay);
          break;
        case 'openAgentPicker':
          toggleMenu('agent');
          break;
        case 'openProjectPicker':
          toggleMenu('project');
          break;
        case 'toggleFavorite':
          void find.toggleFavorite();
          break;
        case 'viewPrompt':
          if (find.expandedPrompt) {
            find.closeExpandedPrompt();
          } else {
            find.openExpandedPrompt();
          }
          break;
        case 'copyPrompt':
          void find.copySelected();
          break;
        case 'forkPicker':
          if (find.overlay === 'fork') {
            find.cancelOverlay();
          } else if (find.selectedRow) {
            find.openOverlay('fork');
          }
          break;
        case 'togglePreviewFocus':
          find.togglePreviewFocus();
          break;
        case 'toggleWrap':
          find.toggleWrapPreview();
          break;
        case 'toggleFullscreenPreview':
          find.toggleFullscreenPreview();
          break;
        case 'cancelOverlay':
          find.cancelOverlay();
          break;
        case 'pickIndex':
          if (mode === 'forkPicker') {
            void find.forkSelected(FIND_PROMPT_AGENTS[action.index]);
          }
          break;
        case 'killToEnd':
          editQuery((value, caret) => ({ caret, value: value.slice(0, caret) }));
          break;
        case 'killToStart':
          editQuery((value, caret) => ({ caret: 0, value: value.slice(caret) }));
          break;
        case 'deleteWordBackward':
          editQuery((value, caret) => {
            const head = value.slice(0, caret).replace(/[^\p{L}\p{N}_]*[\p{L}\p{N}_]*$/u, '');
            return { caret: head.length, value: head + value.slice(caret) };
          });
          break;
        case 'deleteWordForward':
          editQuery((value, caret) => {
            const tail = value.slice(caret).replace(/^[^\p{L}\p{N}_]*[\p{L}\p{N}_]*/u, '');
            return { caret, value: value.slice(0, caret) + tail };
          });
          break;
        default:
          break;
      }
    },
    [editQuery, find, mode, toggleMenu, transport]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (find.expandedPrompt) {
        if (event.key === 'Escape') {
          event.preventDefault();
          find.closeExpandedPrompt();
        }
        return;
      }
      const action = resolveFindPromptsAction(event, mode);
      if (!action) {
        return;
      }
      // An open filter menu owns arrows, Enter, and Escape; only its own chord closes it from here.
      if (openMenu !== null && action.type !== 'openAgentPicker' && action.type !== 'openProjectPicker') {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      runAction(action);
    },
    [find, mode, openMenu, runAction]
  );

  const viewRows = useMemo(
    () => buildViewRows(find.rows, find.windowOffset, find.groupByDay),
    [find.groupByDay, find.rows, find.windowOffset]
  );

  const selectedRow = find.selectedRow;
  const previewText = find.selectedText ?? selectedRow?.text ?? '';
  const metaLine = selectedRow ? formatPromptMetaLine(selectedRow.meta) : '';

  const hintState = useCallback(
    (action: FindPromptsHintAction) => {
      switch (action) {
        case 'toggleDayGrouping':
          return { active: find.groupByDay, disabled: false };
        case 'openAgentPicker':
          return { active: find.agents.size > 0, disabled: false };
        case 'openProjectPicker':
          return { active: find.project !== null, disabled: false };
        case 'toggleFavorite':
          return { active: selectedRow?.favorite === true, disabled: !selectedRow };
        case 'viewPrompt':
          return { active: find.expandedPrompt, disabled: !selectedRow };
        case 'forkPicker':
          return { active: find.overlay === 'fork', disabled: !selectedRow };
        case 'copyPrompt':
          return { active: false, disabled: !selectedRow };
      }
    },
    [find, selectedRow]
  );

  return (
    <div
      className='ghostex-find-scope relative flex h-full min-h-0 flex-col bg-background text-foreground [--radius:0.625rem]'
      onKeyDown={handleKeyDown}
      onKeyDownCapture={markUserInteractedAfterMount}
      onPointerDownCapture={markUserInteractedAfterMount}
    >
      {/* Query row: input on the left, filter dropdowns and action buttons on the right. */}
      <div className='ghostex-find-toolbar flex shrink-0 items-center gap-2.5 border-b border-border/60 px-3.5 py-2'>
        <span aria-hidden='true' className='text-[15px] text-primary'>
          ❯
        </span>
        <input
          aria-label='Search previous prompts'
          autoFocus
          className='h-8 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground'
          onChange={(event) => find.setQuery(event.target.value)}
          placeholder='Search every prompt you have sent to an agent'
          ref={inputRef}
          spellCheck={false}
          type='text'
          value={find.query}
        />
        {/*
         * CDXC:PromptSearch 2026-09-16 DECISION:
         * User: the top-right controls match the Quick Access Sessions tab in size, show their hotkey in the app's regular tooltip for the one control under the pointer, and read as toggles (Days, Fav, View, Fork) or dropdowns (agents, projects) so the active state is obvious.
         */}
        <div className='hidden shrink-0 items-center gap-1.5 md:flex'>
          {FIND_PROMPTS_HINTS.map((hint) => {
            const state = hintState(hint.action);
            const key = hotkeyLabel(hint.key);
            if (hint.action === 'openAgentPicker') {
              return (
                <FindAgentFilterMenu
                  colors={agentColors}
                  hotkey={key}
                  key={hint.key}
                  onClear={find.clearAgents}
                  onOpenChange={(next) => setOpenMenu(next ? 'agent' : null)}
                  onToggle={find.toggleAgent}
                  open={openMenu === 'agent'}
                  selected={find.agents}
                />
              );
            }
            if (hint.action === 'openProjectPicker') {
              return (
                <FindProjectFilterMenu
                  hotkey={key}
                  key={hint.key}
                  onOpenChange={(next) => setOpenMenu(next ? 'project' : null)}
                  onSelect={find.setProject}
                  open={openMenu === 'project'}
                  projects={find.projectFacets}
                  selected={find.project}
                />
              );
            }
            const isToggle = hint.action !== 'copyPrompt';
            const Icon = hint.action === 'toggleFavorite' && state.active ? IconStarFilled : HINT_ICONS[hint.action];
            return (
              <AppTooltip content={`${hintTooltip(hint.action, state.active)} (${key})`} key={hint.key}>
                <Button
                  aria-pressed={isToggle ? state.active : undefined}
                  className={cn(
                    FIND_TOOLBAR_BUTTON_CLASS,
                    hint.action === 'toggleFavorite' && state.active && 'text-amber-400 hover:text-amber-300'
                  )}
                  data-active={isToggle && state.active ? 'true' : 'false'}
                  disabled={state.disabled}
                  onClick={() => runAction({ type: hint.action })}
                  onKeyDown={(event) => event.stopPropagation()}
                  onMouseDown={(event) => event.preventDefault()}
                  type='button'
                  variant='outline'
                >
                  {Icon ? <Icon className='size-3.5 shrink-0' /> : null}
                  <span className='capitalize'>{hint.label}</span>
                </Button>
              </AppTooltip>
            );
          })}
        </div>
        {hostActions}
      </div>

      {/*
       * Results, with the match counter pinned over their bottom-right corner.
       *
       * CDXC:PromptSearch 2026-09-19 DECISION:
       * User: the matched/total counter sits in a pill at the bottom right of the results, in the style of the floating "Search by Prompt" button over the Previous Sessions list, instead of in the query row where it cut the placeholder short.
       */}
      <div className={cn('relative min-h-0 flex-1', find.fullscreenPreview && 'hidden')}>
        <div
          className={cn(
            'h-full overflow-y-auto scrollbar-thin px-2.5 pb-10 pt-1.5',
            find.loading && viewRows.length === 0 && 'overflow-hidden'
          )}
          ref={listRef}
          role='listbox'
          tabIndex={-1}
        >
          {find.loading && viewRows.length === 0 ? <FindPromptsListSkeleton groupByDay={find.groupByDay} /> : null}
          {viewRows.length === 0 && !find.loading ? (
            <div className='px-2 py-6 text-center text-[15px] text-muted-foreground'>
              {find.total === 0
                ? 'No agent prompt history was found on this machine.'
                : 'No prompts match this search.'}
            </div>
          ) : null}
          {viewRows.map((viewRow) =>
            viewRow.type === 'day' ? (
              <div
                className='px-2 pb-1.5 pt-3.5 text-[12px] font-medium text-muted-foreground'
                key={`day-${viewRow.position}-${viewRow.dayKey}`}
              >
                {formatDayHeader(viewRow.dayKey, now)}
              </div>
            ) : (
              <div
                key={`${viewRow.row.key}-${viewRow.position}`}
                ref={viewRow.position === find.selection ? selectedRef : undefined}
              >
                <FindPromptResultRow
                  onActivate={() => void find.resumeRow(viewRow.row)}
                  onSelect={() => find.selectRow(viewRow.position)}
                  row={viewRow.row}
                  selected={viewRow.position === find.selection}
                  timeLabel={formatLastActiveCompact(viewRow.row.ts, now)}
                />
              </div>
            )
          )}
        </div>
        {/* CDXC:PromptSearch 2026-09-08 DECISION: Hide both result counters while loading so Search by Prompt does not display provisional 0/0 counts. */}
        {!find.loading ? (
          <span aria-live='polite' className='ghostex-find-count-pill tabular-nums'>
            {find.matched}/{find.total}
          </span>
        ) : null}
      </div>

      {/* Bottom pane: overlays take it over, otherwise the selected prompt. */}
      <div
        className={cn(
          'flex shrink-0 flex-col border-t border-border/60',
          find.fullscreenPreview ? 'min-h-0 flex-1' : 'h-64'
        )}
      >
        {find.overlay === 'fork' ? (
          <FindForkOverlay colors={agentColors} onPick={(agent) => void find.forkSelected(agent)} />
        ) : (
          <>
            <div className='flex shrink-0 items-baseline gap-2 px-3.5 pb-1.5 pt-2.5 text-[12px] text-muted-foreground'>
              {find.loading && !selectedRow ? (
                <span aria-hidden='true' className='ghostex-find-skeleton ghostex-find-skeleton-bar h-3 w-28' />
              ) : (
                <span className='min-w-0 flex-1 truncate'>{selectedRow?.project || 'No project'}</span>
              )}
              {!find.loading ? (
                <span className='shrink-0 tabular-nums'>
                  {find.matched === 0 ? 0 : find.selection + 1}/{find.matched}
                </span>
              ) : null}
              {find.agents.size > 0 ? <span className='shrink-0'>agents: {[...find.agents].join(',')}</span> : null}
              {find.project ? <span className='shrink-0'>project filter on</span> : null}
            </div>
            <div
              className={cn(
                'min-h-0 flex-1 overflow-auto scrollbar-thin px-3.5 text-[14px] leading-6',
                find.wrapPreview ? 'whitespace-pre-wrap break-words' : 'whitespace-pre',
                find.previewFocused && 'ring-1 ring-inset ring-border/70'
              )}
              data-find-preview='true'
            >
              {find.loading && !selectedRow ? <FindPromptsPreviewSkeleton /> : previewText}
            </div>
            <div className='flex shrink-0 items-baseline gap-2 px-3.5 pb-2.5 pt-1.5 text-[12px] text-muted-foreground'>
              <span className='truncate'>
                {selectedRow ? formatLastActiveFull(selectedRow.ts) : ''}
                {metaLine ? ` ${metaLine}` : ''}
              </span>
            </div>
          </>
        )}
      </div>

      {find.notice ? (
        <div
          className={cn(
            'shrink-0 border-t px-3.5 py-2 text-[12px]',
            find.notice.kind === 'error'
              ? 'border-destructive/40 bg-destructive/10 text-destructive-foreground'
              : 'border-border/60 bg-accent/30 text-muted-foreground'
          )}
          role='status'
        >
          {find.notice.message}
          {find.notice.detail ? <span className='opacity-70'> {find.notice.detail}</span> : null}
        </div>
      ) : null}

      {/* `^e` — the whole prompt, scrollable and selectable. */}
      {find.expandedPrompt && selectedRow ? (
        <div className='absolute inset-0 z-20 flex flex-col bg-background/95 backdrop-blur-sm' role='dialog'>
          <div className='flex shrink-0 items-center gap-2 border-b border-border/60 px-3.5 py-2.5 text-[13px] text-muted-foreground'>
            <span className='font-medium' style={{ color: selectedRow.agentColor }}>
              {selectedRow.agent}
            </span>
            <span className='min-w-0 flex-1 truncate'>{selectedRow.title}</span>
            <button
              className='rounded-md px-2.5 py-1 hover:bg-accent/60'
              onMouseDown={(event) => {
                event.preventDefault();
                find.closeExpandedPrompt();
              }}
              type='button'
            >
              Close
            </button>
          </div>
          <div className='min-h-0 flex-1 select-text overflow-auto scrollbar-thin whitespace-pre-wrap break-words px-4 py-3 text-[15px] leading-7'>
            {previewText}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export type { FindPromptAgent };
