// The per-message rows the GPUI transcript paints: tool runs, their fold, file
// change cards, and the pending terminal tool card. Every classification here
// comes from the same `session-chat-presentation` rules React reads, so GPUI
// only lays the rows out (`apps/desktop/src/app/native_chat/tool_run.rs`,
// `file_change_card.rs`, `terminal_tool_row.rs`).

import type { SessionChatFileChange } from '@/packages/core-ui/chat/session-chat-file-changes';
import type { SessionChatToolPair } from '@/packages/core-ui/chat/session-chat-tool-fold';
import { formatSessionChatToolInput } from '@/packages/core-ui/chat/session-chat-tool-summary';
import {
  isSessionChatTerminalToolMessage,
  sessionChatTerminalToolActivity,
} from '@/packages/core-ui/chat/session-chat-terminal-status';
import { answeredSessionChatQuestionExchange } from '../session-chat-presentation/questions';
import {
  sessionChatFileChangeCounts,
  sessionChatFileChangeExpandable,
  sessionChatFileChangePathParts,
} from '../session-chat-presentation/file-change-rows';
import { isSessionChatSubagentSelf, sessionChatToolSubagent } from '../session-chat-presentation/subagent';
import {
  clipSessionChatToolBody,
  sessionChatToolGlyph,
  sessionChatToolPreview,
  sessionChatToolRunFold,
} from '../session-chat-presentation/tool-rows';
import type { SessionChatMessage } from '../session-chat';

export function nativeChatToolRows(pairs: readonly SessionChatToolPair[], agentPath = '/root') {
  return pairs.map((pair) => {
    const input = clipSessionChatToolBody(pair.call ? formatSessionChatToolInput(pair.call.input) : '');
    const output = clipSessionChatToolBody(pair.result?.output ?? '');
    const subagent = sessionChatToolSubagent(pair.call, pair.result, agentPath);
    // Only the projected row crosses the bridge: the raw blocks would ship every tool argument and result twice.
    return {
      hasCall: Boolean(pair.call),
      // An answered question is conversation, not work: a standalone run renders the pair as the
      // exchange card instead of a tool row, so the raw `AskUserQuestion` row never shows above it.
      // Inside a disclosure or a turn's work fold the card is hoisted out and the row does stay,
      // which is what React's `questionPairsAsRows` says (question-hoisting.ts).
      exchange: answeredSessionChatQuestionExchange(pair) !== null,
      name: pair.call?.name ?? 'Result',
      glyph: sessionChatToolGlyph(pair.call?.name ?? ''),
      preview: sessionChatToolPreview(pair),
      input,
      output,
      failed: pair.result?.isError === true,
      hasDetail: Boolean(input || output),
      // `self` is a selector pointing back at the conversation being read: React renders
      // it as plain text rather than a link, and so does the GPUI heading chip.
      subagent: subagent && { ...subagent, self: isSessionChatSubagentSelf(subagent.selector, agentPath) },
    };
  });
}

export function nativeChatToolFold(pairs: readonly SessionChatToolPair[]) {
  return sessionChatToolRunFold(pairs.map((pair) => answeredSessionChatQuestionExchange(pair) !== null));
}

export function nativeChatFileRows(changes: readonly SessionChatFileChange[], workingDirectory?: string) {
  return changes.map((change) => {
    const counts = sessionChatFileChangeCounts(change.lines);
    const failed = change.result?.isError === true;
    // Only the projected card crosses the bridge: the raw result block would ship the whole write output again.
    return {
      path: change.path,
      action: change.action,
      lines: change.lines,
      // The same opt-out React's card takes (session-chat-file-change-card.tsx): both renderers
      // shorten the folder half against the row's real width, so a character budget on top of that
      // only cuts folders that would have fitted, and the two panes disagree about the same path.
      ...sessionChatFileChangePathParts(change.path, workingDirectory, Number.POSITIVE_INFINITY),
      added: counts.added,
      removed: counts.removed,
      codeLines: counts.code,
      failed,
      error: failed ? (change.result?.output ?? '') : '',
      // GPUI owns the "previews enabled" setting, so it only needs the half of the rule it cannot see.
      expandableWithPreviews: sessionChatFileChangeExpandable(counts, true, failed),
    };
  });
}

/** The painted tool row gxserver reads off the agent's terminal, or null. */
export function nativeChatTerminalTool(message: SessionChatMessage) {
  return isSessionChatTerminalToolMessage(message) ? sessionChatTerminalToolActivity(message) : null;
}
