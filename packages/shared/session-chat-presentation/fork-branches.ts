import { formatRelativeTimeLabel } from '@/packages/core-ui/relative-time';
import type { GxserverSessionForkBranch } from '../gxserver-protocol';

/**
 * CDXC:SessionFork 2026-09-18 SEE-ALSO:
 * The branch switcher's copy and row rules, shared by
 * packages/core-ui/chat/session-chat-fork-branch-switcher.tsx and
 * apps/desktop/src/app/native_chat/fork_branches.rs (through
 * packages/shared/session-chat-controller/native-fork-branches.ts). Neither renderer may
 * re-derive a title, a subtitle, the lifecycle tone, or the family gate.
 */

/** One branch is not a family: there is nothing to switch to. */
export const SESSION_CHAT_FORK_BRANCH_FAMILY_MIN = 2;

export const SESSION_CHAT_FORK_BRANCH_MENU_LABEL = 'Branches';

export const SESSION_CHAT_FORK_BRANCH_CURRENT_LABEL = 'Current';

/** The lifecycle dot's meaning; each renderer owns the colour it paints for it. */
export type SessionChatForkBranchTone = 'running' | 'sleeping' | 'stopped';

export interface SessionChatForkBranchRow {
  /** Stable across publishes: the family is keyed by its registry rows. */
  key: string;
  title: string;
  /** "Earlier thread · Resumes when opened · 4h ago", already joined; empty when nothing applies. */
  subtitle: string;
  tone: SessionChatForkBranchTone;
  current: boolean;
  branch: GxserverSessionForkBranch;
}

export function sessionChatForkBranchTone(branch: GxserverSessionForkBranch): SessionChatForkBranchTone {
  if (branch.lifecycleState === 'running') return 'running';
  return branch.lifecycleState === 'sleeping' ? 'sleeping' : 'stopped';
}

export function sessionChatForkBranchTitle(branch: GxserverSessionForkBranch): string {
  return branch.title || 'Untitled session';
}

export function sessionChatForkBranchKey(branch: GxserverSessionForkBranch): string {
  return `${branch.projectId}:${branch.sessionId}`;
}

/**
 * CDXC:SessionFork 2026-09-03:
 * Picking a STOPPED branch revives that same registry row (the hosts wake it before focusing),
 * so the row says so instead of looking inert.
 */
export function sessionChatForkBranchSubtitle(branch: GxserverSessionForkBranch, nowMs?: number): string {
  const lastActive =
    Number.isFinite(branch.lastActiveMs) && branch.lastActiveMs > 0
      ? formatRelativeTimeLabel(
          new Date(branch.lastActiveMs).toISOString(),
          nowMs === undefined ? undefined : { nowMs }
        )
      : '';
  return [
    branch.ancestor ? 'Earlier thread' : '',
    branch.lifecycleState === 'stopped' && !branch.current ? 'Resumes when opened' : '',
    lastActive,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function sessionChatForkBranchTooltip(count: number): string {
  return `This conversation has ${count} branches that share earlier history.`;
}

/**
 * The whole control, or null when the daemon reported no family: the strip renders nothing at all
 * until there are two or more rows, which is why an unforked session shows no empty row. The rows
 * keep the daemon's own order (newest activity first).
 */
export function sessionChatForkBranchRows(
  branches: readonly GxserverSessionForkBranch[],
  nowMs?: number
): readonly SessionChatForkBranchRow[] | null {
  if (branches.length < SESSION_CHAT_FORK_BRANCH_FAMILY_MIN) return null;
  return branches.map((branch) => ({
    key: sessionChatForkBranchKey(branch),
    title: sessionChatForkBranchTitle(branch),
    subtitle: sessionChatForkBranchSubtitle(branch, nowMs),
    tone: sessionChatForkBranchTone(branch),
    current: branch.current,
    branch,
  }));
}
