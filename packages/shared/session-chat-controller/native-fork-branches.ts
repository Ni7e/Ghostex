import type { GxserverSessionForkBranch, GxserverSessionForkBranchesResult } from '../gxserver-protocol';
import {
  SESSION_CHAT_FORK_BRANCH_CURRENT_LABEL,
  SESSION_CHAT_FORK_BRANCH_MENU_LABEL,
  sessionChatForkBranchRows,
  sessionChatForkBranchTooltip,
  type SessionChatForkBranchTone,
} from '../session-chat-presentation/fork-branches';
import type { NativeChatMenuItem } from './native-option-menus';

/** An option-menu row with the lifecycle dot the branch list paints beside its title. */
type ForkBranchMenuItem = NativeChatMenuItem & { dot?: SessionChatForkBranchTone };

export interface NativeForkBranchesProjection {
  /** What the strip's trigger shows; also the family size. */
  count: number;
  tooltip: string;
  /** Ready-made `option_menu` rows: heading plus one row per branch. */
  menu: ForkBranchMenuItem[];
}

/**
 * CDXC:SessionFork 2026-09-18 WHY:
 * GPUI chat's branch switcher, the native half of
 * packages/core-ui/chat/session-chat-fork-branch-switcher.tsx. It asks ONCE per chat runtime,
 * lazily, and keeps the answer: the family only changes when a session is forked or retired, both
 * of which land the user on a different session and therefore a different runtime. A daemon that
 * predates `/api/sessionForkBranches`, or a machine that dropped mid request, leaves the strip
 * unrendered rather than showing an empty menu.
 */
export class NativeForkBranches {
  private branches: readonly GxserverSessionForkBranch[] = [];
  private asked = false;

  constructor(
    private readonly load: () => Promise<GxserverSessionForkBranchesResult>,
    private readonly republish: () => void
  ) {}

  /** Reads the family on the first publish and never again. */
  ensure(): void {
    if (this.asked) return;
    this.asked = true;
    void this.load()
      .then((result) => {
        const next = result?.branches ?? [];
        if (next.length === 0) return;
        this.branches = next;
        this.republish();
      })
      .catch(() => {
        // No family is known, so the strip stays hidden; nothing to report to the user.
      });
  }

  project(): NativeForkBranchesProjection | null {
    const rows = sessionChatForkBranchRows(this.branches);
    if (!rows) return null;
    return {
      count: rows.length,
      tooltip: sessionChatForkBranchTooltip(rows.length),
      menu: [
        { id: 'fork-branches-heading', heading: true, label: SESSION_CHAT_FORK_BRANCH_MENU_LABEL },
        ...rows.map((row): ForkBranchMenuItem => ({
          id: row.key,
          label: row.title,
          ...(row.subtitle ? { description: row.subtitle } : {}),
          ...(row.current ? { detail: SESSION_CHAT_FORK_BRANCH_CURRENT_LABEL } : {}),
          dot: row.tone,
          disabled: row.current,
          command: {
            type: 'selectForkBranch',
            projectId: row.branch.projectId,
            sessionId: row.branch.sessionId,
            lifecycleState: row.branch.lifecycleState,
          },
        })),
      ],
    };
  }
}
