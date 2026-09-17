import type { SessionChatDraftVersion } from '../session-chat-queue';

/** A delayed transfer must never replace text typed after the view switch. */
export function classifyDraftHandoff(input: {
  content: string;
  version?: SessionChatDraftVersion;
  current: string;
  stored?: { text: string; version?: SessionChatDraftVersion; parked?: boolean } | null;
  parked: boolean;
}): 'current' | 'conflict' | 'accept' {
  const { version, stored } = input;
  if (version && stored?.version && stored.version.draftId === version.draftId && !stored.parked && !input.parked && input.current === stored.text && stored.version.revision >= version.revision) return 'current';
  return input.current !== '' && input.current !== input.content ? 'conflict' : 'accept';
}
