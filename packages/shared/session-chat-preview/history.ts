import {
  previewCall,
  previewResult,
  previewRow,
  previewStamp,
  previewTextRow,
  type PreviewScenarioSnapshot,
} from './message';
import type { GxserverReadSessionChatResult, SessionChatMessage } from '../session-chat';
import type { GxserverProjectId, GxserverSessionForkBranchesResult, GxserverSessionId } from '../gxserver-protocol';

/** The byte cursor the newest page hands back; each older page halves it. */
const NEWEST_CURSOR = 4000;
const MIDDLE_CURSOR = 2000;

const MINUTE_MS = 60_000;

/**
 * The fork family the branch switcher offers in this scenario: the sample conversation, a sibling
 * fork that is still asleep, and the stopped ancestor both of them branched off.
 */
export function chatPreviewForkBranches(): GxserverSessionForkBranchesResult {
  const projectId = 'P0preview' as GxserverProjectId;
  const now = Date.now();
  return {
    branches: [
      {
        current: true,
        lastActiveMs: now - MINUTE_MS,
        lifecycleState: 'running',
        projectId,
        sessionId: 'G0preview' as GxserverSessionId,
        title: 'Transcript paging',
      },
      {
        current: false,
        lastActiveMs: now - 42 * MINUTE_MS,
        lifecycleState: 'sleeping',
        projectId,
        sessionId: 'G1preview' as GxserverSessionId,
        title: 'Mobile transcript width',
      },
      {
        ancestor: true,
        current: false,
        lastActiveMs: now - 5 * 60 * MINUTE_MS,
        lifecycleState: 'stopped',
        projectId,
        sessionId: 'G2preview' as GxserverSessionId,
        title: '',
      },
    ],
  };
}

function olderPage(): SessionChatMessage[] {
  return [
    previewTextRow('history-old-1', 'user', -620, 'Start from the beginning: why does the transcript keep two lists?', {
      byteOffset: 120,
    }),
    previewTextRow(
      'history-old-2',
      'reasoning',
      -618,
      'One list is what the reader sees and the other is what the pager needs. I will confirm that before answering.',
      { byteOffset: 260 }
    ),
    previewRow(
      'history-old-3',
      'tool',
      -616,
      [
        previewCall('Read', {
          file_path: '/sample/project/packages/shared/session-chat-presentation/transcript.ts',
          offset: 1,
          limit: 50,
        }),
        previewResult(
          'export function projectChatTranscript(\n  messages: readonly SessionChatMessage[],\n  working: boolean,\n) {\n  const normalized = normalizeChatTranscript(messages);\n  const rendered = foldChatTranscript(normalized);'
        ),
      ],
      { byteOffset: 420 }
    ),
    previewTextRow(
      'history-old-4',
      'assistant',
      -600,
      'The folded list is for rendering and the normalized list keeps every row the pager needs, including the ones the fold hides. Both come out of `projectChatTranscript` together so they can never disagree.',
      { byteOffset: 880 }
    ),
  ];
}

function middlePage(): SessionChatMessage[] {
  return [
    previewTextRow('history-mid-1', 'user', -320, 'Good. Now show me what a resync does to the scroll position.', {
      byteOffset: 2100,
    }),
    previewRow(
      'history-mid-2',
      'tool',
      -318,
      [
        previewCall('Grep', { pattern: 'scrollRestoration', path: 'packages/core-ui/chat', output_mode: 'content' }),
        previewResult(
          'packages/core-ui/chat/use-session-chat-scroll-restoration.ts:12:export function useSessionChatScrollRestoration('
        ),
      ],
      { byteOffset: 2320 }
    ),
    previewTextRow(
      'history-mid-3',
      'assistant',
      -300,
      'A resync keeps the anchor row rather than the pixel offset, so growing a page above the viewport does not move what you are reading.',
      { byteOffset: 2740 }
    ),
  ];
}

/**
 * Older pages exactly as `/api/readSessionChat` hands them back: oldest first,
 * each answering with the cursor the next request should use. `beforeOffset: 0`
 * on the last page is what ends the paging.
 */
export function chatPreviewHistoryPage(beforeOffset: number): GxserverReadSessionChatResult {
  if (beforeOffset > MIDDLE_CURSOR) {
    return historyResult(middlePage(), MIDDLE_CURSOR, true);
  }
  if (beforeOffset > 0) {
    return historyResult(olderPage(), 0, false);
  }
  return historyResult([], 0, false);
}

function historyResult(
  messages: SessionChatMessage[],
  beforeOffset: number,
  hasMore: boolean
): GxserverReadSessionChatResult {
  return {
    messages,
    hasMore,
    hasMoreExact: true,
    beforeOffset,
    epoch: 1,
    seq: 1,
    status: 'ready',
    agent: 'codex',
    sessionAgentId: 'codex',
    agentSessionId: 'chat-preview',
  };
}

/**
 * A session with scroll-back left on the server: scrolling to the top pages in
 * two older windows. The tail also carries the two send states that are not
 * ordinary history — a prompt the agent's own queue is still holding, and sends
 * this client accepted while the session was starting.
 */
export function historyPreviewScenario(): PreviewScenarioSnapshot {
  return {
    working: true,
    hasMore: true,
    hasMoreExact: true,
    beforeOffset: NEWEST_CURSOR,
    queue: [
      {
        id: 'startup-1',
        startupSend: true,
        text: 'Then run the desktop type check and paste the first error.',
        state: 'sending',
        createdAt: previewStamp(40),
        updatedAt: previewStamp(41),
      },
      {
        id: 'startup-2',
        startupSend: true,
        text: 'After that, summarise the three rules in one paragraph each.',
        state: 'failed',
        errorMessage: 'The session was not accepting input yet. Retry when the agent is ready.',
        createdAt: previewStamp(42),
        updatedAt: previewStamp(43),
      },
    ],
    messages: [
      previewTextRow('history-1', 'user', 0, 'Keep going. What happens when the reader scrolls past the first page?', {
        byteOffset: 4100,
      }),
      previewTextRow(
        'history-2',
        'reasoning',
        2,
        'Paging is a byte cursor, not a page number, so the answer is the same however far back the reader goes.',
        { byteOffset: 4240 }
      ),
      previewRow(
        'history-3',
        'tool',
        4,
        [
          previewCall('Read', {
            file_path: '/sample/project/packages/core-ui/chat/session-chat-pagination.ts',
            offset: 28,
            limit: 16,
          }),
          previewResult(
            'export function sessionChatPageHasMore(page: SessionChatPageBoundary, requestedBeforeOffset?: number): boolean {\n  if (page.hasMore || page.hasMoreExact === true) {\n    return page.hasMore;\n  }'
          ),
        ],
        { byteOffset: 4420 }
      ),
      previewTextRow(
        'history-4',
        'assistant',
        20,
        'Each page answers with the cursor for the next one, and the last page answers with zero. Scroll to the top of this transcript and two older windows load in front of this turn.',
        { byteOffset: 4680 }
      ),
      previewTextRow('history-5', 'user', 30, 'Also check the mobile view while you are in there.', {
        byteOffset: 4820,
        queued: true,
      }),
    ],
  };
}
