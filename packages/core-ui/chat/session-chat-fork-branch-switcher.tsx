/*
CDXC:SessionFork 2026-08-28:
The chat's branch switcher. A Codex fork keeps the earlier conversation on the
session it branched off, and Previous Sessions hides that ancestor once
something continues from it, so without this control a user who forked can no
longer reach the thread they forked away from. `/api/sessionForkBranches`
answers with the whole family, ancestors included, and this renders it as one
compact control that only exists when there is actually something to switch
between.

It asks ONCE per session, lazily, and caches the answer for the lifetime of the
page: the family only changes when a session is forked or retired, both of
which land the user on a different session key anyway. A daemon or host that
cannot answer leaves the control unrendered rather than showing an empty menu.

CDXC:SessionFork 2026-09-03:
Picking a STOPPED branch revives that same registry row (the hosts wake it
before focusing), so the row says so instead of silently doing nothing. A host
that cannot switch omits `onSelectBranch` and the rows stay disabled.
*/
import { IconGitBranch } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import type { GxserverSessionForkBranch } from '../../shared/gxserver-protocol';
import { cn } from '@/packages/components/utils';
import { Button } from '../../components/ui/button';
import { AppTooltip } from '../app-tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import {
  SESSION_CHAT_FORK_BRANCH_CURRENT_LABEL,
  SESSION_CHAT_FORK_BRANCH_MENU_LABEL,
  sessionChatForkBranchRows,
  sessionChatForkBranchTooltip,
  type SessionChatForkBranchTone,
} from '../../shared/session-chat-presentation/fork-branches';

export interface SessionChatForkBranchSwitcherProps {
  /** Stable identity of the conversation; a change re-asks for the family. */
  sessionKey: string;
  /** Transport-backed reader; omitted by hosts without a route to the endpoint. */
  loadBranches?: () => Promise<{ branches: readonly GxserverSessionForkBranch[] }>;
  /**
   * Navigates the host to another branch. Hosts that cannot switch sessions
   * from this surface omit it and the rows render as a read-only list.
   */
  onSelectBranch?: (branch: GxserverSessionForkBranch) => void;
}

/** Answers already fetched on this page, keyed by session. */
const branchCache = new Map<string, readonly GxserverSessionForkBranch[]>();

/** The tones of `sessionChatForkBranchTone`, in this renderer's colours. */
const BRANCH_DOT_CLASS_NAMES: Readonly<Record<SessionChatForkBranchTone, string>> = {
  running: 'bg-emerald-500',
  sleeping: 'bg-muted-foreground/60',
  stopped: 'bg-muted-foreground/35',
};

export function SessionChatForkBranchSwitcher({
  loadBranches,
  onSelectBranch,
  sessionKey,
}: SessionChatForkBranchSwitcherProps) {
  const [branches, setBranches] = useState<readonly GxserverSessionForkBranch[]>(
    () => branchCache.get(sessionKey) ?? []
  );

  useEffect(() => {
    const cached = branchCache.get(sessionKey);
    if (cached) {
      setBranches(cached);
      return;
    }
    setBranches([]);
    if (!loadBranches) {
      return;
    }
    let cancelled = false;
    void loadBranches()
      .then((result) => {
        const next = result.branches ?? [];
        branchCache.set(sessionKey, next);
        if (!cancelled) {
          setBranches(next);
        }
      })
      .catch(() => {
        /*
        A daemon that predates the endpoint, or a machine that dropped mid
        request. Nothing is cached, so the next mount of this session asks
        again; the control simply stays hidden until an answer arrives.
        */
      });
    return () => {
      cancelled = true;
    };
  }, [loadBranches, sessionKey]);

  const rows = sessionChatForkBranchRows(branches);
  if (!rows) {
    return null;
  }

  const tooltip = sessionChatForkBranchTooltip(rows.length);

  return (
    <DropdownMenu>
      {/*
      CDXC:SessionFork 2026-09-23 DECISION:
      User: the switcher's tooltip opens "to the left not to the right (below it)" with a max width of 220px. It sits under the button with its right edge on the button's right edge and wraps at 220px, like the desktop chat's (fork_branches.rs).
      */}
      <AppTooltip align='end' content={tooltip} contentClassName='max-w-[220px]' side='bottom'>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={tooltip}
              // It floats over the transcript rather than sitting in a row of its own, so it carries
              // the chat's own surface and a hairline to stay readable over the text beneath it.
              className='h-6 gap-1 rounded-md border border-border bg-background px-1.5 text-[11px] font-normal text-muted-foreground'
              size='sm'
              variant='ghost'
            />
          }
        >
          <IconGitBranch aria-hidden='true' className='size-3.5' stroke={2} />
          {rows.length}
        </DropdownMenuTrigger>
      </AppTooltip>
      <DropdownMenuContent align='end' className='w-72 min-w-72'>
        {/*
        Base UI's GroupLabel needs a Group context and throws (error #31) without one.
        With no error boundary in the chat page that unmounted the whole transcript.
        */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>{SESSION_CHAT_FORK_BRANCH_MENU_LABEL}</DropdownMenuLabel>
          {rows.map((row) => (
            <DropdownMenuItem
              disabled={row.current || !onSelectBranch}
              key={row.key}
              onClick={() => {
                if (!row.current) {
                  onSelectBranch?.(row.branch);
                }
              }}
            >
              <span
                aria-hidden='true'
                className={cn('size-1.5 shrink-0 rounded-full', BRANCH_DOT_CLASS_NAMES[row.tone])}
              />
              <span className='flex min-w-0 flex-1 flex-col gap-0.5'>
                <span className='truncate'>{row.title}</span>
                <span className='truncate text-[11px] text-muted-foreground'>{row.subtitle}</span>
              </span>
              {row.current ? (
                <span className='shrink-0 text-[11px] text-muted-foreground'>
                  {SESSION_CHAT_FORK_BRANCH_CURRENT_LABEL}
                </span>
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
