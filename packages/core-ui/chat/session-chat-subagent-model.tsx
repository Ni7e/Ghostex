import type { SessionChatSubagentInfo } from '@/packages/shared/session-chat';

// The label is shared with GPUI chat's subagent strip, so it lives with the fleet projection.
import { subagentModelLabel } from '@/packages/shared/session-chat-presentation/agent-fleet';

type ModelInfo = Pick<SessionChatSubagentInfo, 'model' | 'effort'>;

export { subagentModelLabel };

/**
 * CDXC:SessionChat 2026-09-10 DECISION:
 * User: show compact model and effort labels such as "Opus 5 High" and "Opus 5 xHigh" in the subagent card and popup; move agent types such as Explore and general-purpose into the tooltip. Model labels stay out of the tooltip.
 */
export function SessionChatSubagentModel({
  info,
  loading,
  unavailable,
}: {
  info?: ModelInfo | null;
  loading?: boolean;
  unavailable?: boolean;
}) {
  return <span>{loading ? 'Loading…' : unavailable ? 'Model unavailable' : subagentModelLabel(info)}</span>;
}
