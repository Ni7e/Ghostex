import type { ContextDetailsAgent } from '@/packages/core-ui/chat/session-chat-context-details-agents';
import type { UseSessionChatResult } from '@/packages/core-ui/chat/use-session-chat/state';
import type { AgentAccountsState } from '../agent-accounts';
import { resolveContextDetailStatus } from '@/packages/core-ui/chat/session-chat-context-details-agents';
import {
  matchesContextDetailFilter,
  reorderContextDetails,
  toggleContextDetailStar,
} from '../session-chat-presentation/context-editor';
import {
  normalizeSessionChatContextDetailsPreferences,
  sessionChatContextDetailRows,
  SESSION_CHAT_CONTEXT_DETAIL_GROUPS,
  orderedSessionChatContextDetailRows,
  orderedSessionChatStarredRows,
  isSessionChatContextDetailShown,
  isSessionChatContextDetailStarred,
  type SessionChatContextDetailsPreferences,
} from '../session-chat-presentation/context-details';
import { currentNativeContextPreferences, nativeContextText, nativeContextTitle } from './native-context';

let editor: {
  agent: ContextDetailsAgent;
  draft: SessionChatContextDetailsPreferences;
  query: string;
  saving: boolean;
  error?: string;
} | null = null;
export function nativeContextEditor(chat: UseSessionChatResult, accounts: AgentAccountsState | undefined) {
  if (!editor) return null;
  const { agent, draft, query } = editor;
  const account = accounts?.accounts.find((account) => account.id === accounts.session?.accountId);
  const status = resolveContextDetailStatus(agent, chat.selectedOptions, account);
  const session = {
    title: nativeContextTitle(),
    agentSessionId: chat.agentSessionId,
    draft: chat.availableAgents !== null,
  };
  const row = (row: ReturnType<typeof sessionChatContextDetailRows>[number]) => ({
    id: row.id,
    label: row.label,
    description: row.description,
    sample: row.value({ status, session, now: Date.now() }),
    shown: isSessionChatContextDetailShown(draft, row),
    starred: isSessionChatContextDetailStarred(draft, row),
  });
  return {
    agent,
    query,
    saving: editor.saving,
    error: editor.error,
    description: `Pick the rows shown under the context meter in ${agent === 'claude' ? 'Claude Code' : 'Codex'} sessions. Drag to reorder within a group. Star a row to show its value under the chat box.`,
    groups: SESSION_CHAT_CONTEXT_DETAIL_GROUPS.map((group) => ({
      ...group,
      rows: orderedSessionChatContextDetailRows(draft, group.id, agent)
        .map(row)
        .filter((item) =>
          matchesContextDetailFilter(
            query,
            sessionChatContextDetailRows(agent).find((row) => row.id === item.id)!,
            item.sample
          )
        )
        .map((item) => ({ ...item, sample: item.sample === null ? null : nativeContextText(item.sample) })),
    })).filter((group) => group.rows.length > 0),
    starred: orderedSessionChatStarredRows(draft, agent).map(row),
  };
}

export async function nativeContextEditorCommand(
  command: Record<string, any>,
  agent: ContextDetailsAgent,
  save: (agent: ContextDetailsAgent, preferences: SessionChatContextDetailsPreferences) => Promise<unknown>,
  changed: () => void
) {
  if (command.type === 'contextEdit') {
    editor = {
      agent,
      draft: normalizeSessionChatContextDetailsPreferences(currentNativeContextPreferences()[agent], agent),
      query: '',
      saving: false,
    };
    return;
  }
  if (!editor || editor.saving) return;
  const row = sessionChatContextDetailRows(editor.agent).find((row) => row.id === command.id);
  switch (command.type) {
    case 'contextCancel':
      editor = null;
      break;
    case 'contextQuery':
      editor.query = String(command.query ?? '');
      break;
    case 'contextShown':
      if (row) editor.draft = { ...editor.draft, shown: { ...editor.draft.shown, [row.id]: command.shown === true } };
      break;
    case 'contextStar':
      if (row) editor.draft = toggleContextDetailStar(editor.draft, row, editor.agent);
      break;
    case 'contextReorder':
      if (command.group === 'starred' || SESSION_CHAT_CONTEXT_DETAIL_GROUPS.some((group) => group.id === command.group))
        editor.draft = reorderContextDetails(editor.draft, editor.agent, command.group, command.from, command.to);
      break;
    case 'contextReset':
      editor.draft = normalizeSessionChatContextDetailsPreferences(null, editor.agent);
      break;
    case 'contextSave': {
      const active = editor;
      active.saving = true;
      active.error = undefined;
      changed();
      try {
        await save(active.agent, active.draft);
        if (editor === active) editor = null;
      } catch (error) {
        active.error = error instanceof Error ? error.message : String(error);
      } finally {
        active.saving = false;
      }
      break;
    }
  }
}
