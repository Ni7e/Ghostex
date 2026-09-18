import { previewCall, previewResult, previewRow, previewTextRow, type PreviewScenarioSnapshot } from './message';

const LONG_PATH =
  '/sample/project/apps/desktop/src/app/native_chat/option_menu/very-long-directory-name/session-chat-option-menu-geometry.rs';

const NEW_FILE = [
  "import type { SessionChatMessage } from '../session-chat';",
  '',
  '/** One page of stitched scroll-back, oldest first. */',
  'export interface HistoryPage {',
  '  messages: SessionChatMessage[];',
  '  beforeOffset: number;',
  '  hasMore: boolean;',
  '}',
  '',
  'export function emptyHistoryPage(): HistoryPage {',
  '  return { messages: [], beforeOffset: 0, hasMore: false };',
  '}',
].join('\n');

const APPLY_PATCH = [
  '*** Begin Patch',
  '*** Update File: packages/shared/session-chat-presentation/transcript.ts',
  '@@ -13,7 +13,7 @@',
  ' export function normalizeChatTranscript(messages: readonly SessionChatMessage[]): SessionChatMessage[] {',
  '   return dropSessionChatHiddenMessages(',
  '-    normalizeSessionChatImageTranscriptMessages(orderSessionChatMessages(messages))',
  '+    normalizeSessionChatImageTranscriptMessages(',
  '+      normalizeSessionChatLocalCommandMessages(orderSessionChatMessages(messages))',
  '+    )',
  '   );',
  ' }',
  '@@ -35,6 +36,7 @@',
  ' export function projectChatTranscript(',
  '   messages: readonly SessionChatMessage[],',
  '   working: boolean,',
  '+  interactedMessageIds: ReadonlySet<string> = new Set()',
  ' ) {',
  '*** Update File: packages/core-ui/chat/session-chat-file-changes.ts',
  '@@ -98,6 +98,7 @@',
  ' export function splitSessionChatFileChanges(',
  '   blocks: readonly (SessionChatToolCallBlock | SessionChatToolResultBlock)[]',
  ' ) {',
  '+  // Pair before extracting so a removed write cannot adopt the next result.',
  '   const tools: (SessionChatToolCallBlock | SessionChatToolResultBlock)[] = [];',
  '*** End Patch',
].join('\n');

const EDIT_FAILURE = [
  'Edit failed: the file has changed on disk since it was read.',
  '',
  'Read /sample/project/packages/core-ui/chat/session-chat-noise.ts again before editing it.',
].join('\n');

/**
 * File change cards as the transcript produces them: an ordinary edit, a new
 * file, a multi-hunk patch, a rejected edit that keeps its error, and a path
 * long enough to exercise the header's truncation. One finished turn collects
 * its cards behind "N files changed"; the live turn shows them inline.
 */
export function filesPreviewScenario(): PreviewScenarioSnapshot {
  return {
    working: true,
    messages: [
      previewTextRow(
        'files-1',
        'user',
        0,
        'Rename the compaction label constant and update the readers that quote it.'
      ),
      previewRow('files-2', 'assistant', 4, [
        { type: 'text', text: 'Renaming the constant, then its two readers.' },
        previewCall('Edit', {
          file_path: '/sample/project/packages/core-ui/chat/session-chat-noise.ts',
          old_string: "const CONTEXT_COMPACTED_LABEL = 'Context compacted';",
          new_string: "const CONTEXT_COMPACTION_LABEL = 'Context compacted';",
        }),
        previewResult('Applied 1 edit to session-chat-noise.ts'),
        previewCall('Edit', {
          file_path: '/sample/project/packages/shared/session-chat-presentation/transcript.ts',
          old_string: "  return suppressed?.kind === 'status' && suppressed.label === CONTEXT_COMPACTED_LABEL;",
          new_string: "  return suppressed?.kind === 'status' && suppressed.label === CONTEXT_COMPACTION_LABEL;",
        }),
        previewResult('Applied 1 edit to transcript.ts'),
      ]),
      previewTextRow(
        'files-3',
        'assistant',
        22,
        'Renamed. Both readers now quote `CONTEXT_COMPACTION_LABEL`, and the visible row still reads "Context compacted".'
      ),
      previewTextRow(
        'files-4',
        'user',
        60,
        'Now add the history page helper, apply the transcript patch, and fix the option menu geometry.'
      ),
      previewRow('files-5', 'assistant', 64, [
        {
          type: 'text',
          text: 'Writing the new module first so the patch below it has something to import.',
        },
        previewCall('Write', {
          file_path: '/sample/project/packages/shared/session-chat-history-page.ts',
          content: NEW_FILE,
        }),
        previewResult('Created session-chat-history-page.ts (12 lines)'),
        previewCall('apply_patch', { patch: APPLY_PATCH }),
        previewResult('Updated 2 files.'),
        previewCall('MultiEdit', {
          file_path: '/sample/project/packages/core-ui/chat/session-chat-pagination.ts',
          edits: [
            {
              old_string: 'export const SESSION_CHAT_PAGE = 200;',
              new_string: 'export const SESSION_CHAT_PAGE = 200;\nexport const SESSION_CHAT_HISTORY_PAGE = 120;',
            },
            {
              old_string: 'export function nextSessionChatLimit(current: number): number {',
              new_string:
                '/** The next window size a resync should ask for. */\nexport function nextSessionChatLimit(current: number): number {',
            },
            {
              old_string: '  return returnedCount >= requestedLimit;',
              new_string: '  return returnedCount >= requestedLimit && requestedLimit > 0;',
            },
          ],
        }),
        previewResult('Applied 3 edits to session-chat-pagination.ts'),
      ]),
      previewRow('files-6', 'tool', 78, [
        previewCall('Edit', {
          file_path: LONG_PATH,
          old_string: '    let width = px(240.0);',
          new_string: '    let width = px(268.0);',
        }),
        previewResult('Applied 1 edit to session-chat-option-menu-geometry.rs'),
        previewCall('Edit', {
          file_path: '/sample/project/packages/core-ui/chat/session-chat-noise.ts',
          old_string: "const COMPACTION_COMPLETED_LABEL = 'Compaction completed';",
          new_string: "const COMPACTION_COMPLETED_LABEL = 'Compaction finished';",
        }),
        previewResult(EDIT_FAILURE, true),
      ]),
      previewTextRow(
        'files-7',
        'reasoning',
        84,
        'The rejected edit needs a fresh read first. I will leave it for now and report what already applied.'
      ),
    ],
  };
}
