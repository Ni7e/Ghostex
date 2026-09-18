import {
  previewCall,
  previewResult,
  previewRow,
  previewStamp,
  previewTextRow,
  type PreviewScenarioSnapshot,
} from './message';
import type { GxserverReadSessionChatResult } from '../session-chat';

const TURNS_EXCERPT = [
  'export function completedWorkRenderItems(',
  '  messages: readonly SessionChatMessage[],',
  '  isWorking: boolean,',
  '  interactedMessageIds: ReadonlySet<string>,',
  '  rawMessages: readonly SessionChatMessage[]',
  '): SessionChatRenderItem[] {',
  '  const items: SessionChatRenderItem[] = [];',
  '  const activeStart = isWorking ? activeResponseStartIndex(messages) : messages.length;',
  '  // … 60 more lines',
  '}',
].join('\n');

const GREP_MATCHES = [
  'packages/shared/session-chat-presentation/turns.ts',
  'packages/shared/session-chat-presentation/transcript.ts',
  'packages/core-ui/chat/session-chat-message-list/list.tsx',
  'apps/desktop/src/app/native_chat/transcript.rs',
].join('\n');

const TEST_OUTPUT = [
  'bun test v1.2.19',
  '',
  'packages/shared/session-chat-presentation/turns.test.ts:',
  '✓ folds a finished turn into one completed-work row [4.11ms]',
  '✓ keeps the active response expanded while working [2.02ms]',
  '✓ never settles a turn on a harness-injected row [1.87ms]',
  '',
  ' 3 pass',
  ' 0 fail',
  ' 9 expect() calls',
  'Ran 3 tests across 1 file. [124.00ms]',
].join('\n');

const TYPE_ERROR = [
  "apps/desktop/sidebar/gxserver-runtime/session-chat.ts(184,7): error TS2322: Type 'string | undefined' is not assignable to type 'string'.",
  "  Type 'undefined' is not assignable to type 'string'.",
  '',
  'Found 1 error in apps/desktop/sidebar/gxserver-runtime/session-chat.ts:184',
].join('\n');

const SUBAGENT_RESULT = JSON.stringify(
  {
    agent_id: 'agent_7f31',
    agent_nickname: 'turn-auditor',
    result:
      'Every caller of completedWorkRenderItems passes the raw list as well as the folded one. Nothing reads the folded list for byte offsets.',
  },
  null,
  2
);

/**
 * Tool activity as a transcript really records it: one finished turn that folds
 * into "Worked for", one live turn whose calls are still on screen, reasoning
 * with and without tools under it, an error result, a subagent call, and enough
 * calls in one row for the "+N previous tool calls" fold.
 */
export function toolsPreviewScenario(): PreviewScenarioSnapshot {
  const liveActivity: GxserverReadSessionChatResult['terminalActivity'] = {
    kind: 'claude-tool',
    label: 'Bash(bun run help:generate)',
    detail:
      '$ bun run help:generate\n  Reading settings search rows…\n  Writing skills/ghostex-help/references/settings.md',
    detectedAt: previewStamp(200),
  };
  return {
    working: true,
    terminalActivity: liveActivity,
    messages: [
      previewTextRow(
        'tools-1',
        'user',
        0,
        'Where does the transcript decide that a turn is finished? Read the code before changing anything.'
      ),
      previewRow('tools-2', 'reasoning', 2, [
        {
          type: 'text',
          text: 'Turn boundaries belong to the presentation layer, so I will read `turns.ts` first and only then look for the callers that depend on its ordering.',
        },
        previewCall('Read', {
          file_path: '/sample/project/packages/shared/session-chat-presentation/turns.ts',
          offset: 170,
          limit: 70,
        }),
        previewResult(TURNS_EXCERPT),
        previewCall('Grep', {
          pattern: 'completedWorkRenderItems',
          path: 'packages',
          output_mode: 'files_with_matches',
        }),
        previewResult(GREP_MATCHES),
      ]),
      previewTextRow(
        'tools-3',
        'assistant',
        26,
        '`completedWorkRenderItems` owns it. A turn ends at the next genuine user row, and everything between the prompt and the final reply becomes one collapsed work section.\n\nThe rule is deliberate: a harness-injected row must never settle a response that is still running.'
      ),
      previewTextRow('tools-4', 'user', 40, 'Good. Now run the checks and tell me what each tool reported.'),
      previewRow('tools-5', 'tool', 42, [
        previewCall('Read', {
          file_path: '/sample/project/packages/core-ui/chat/session-chat-message-list/list.tsx',
          offset: 374,
          limit: 40,
        }),
        previewResult(
          'export function SessionChatMessageList({\n  sessionKey,\n  hasMore,\n  isWorking,\n  messages: incomingMessages,\n  readHistory,\n  …\n}: SessionChatMessageListProps) {'
        ),
        previewCall('Grep', { pattern: 'hasAgentResponseContent', path: 'packages/shared', '-n': true }),
        previewResult(
          'packages/shared/session-chat-presentation/turns.ts:26:function hasAgentResponseContent(message: SessionChatMessage): boolean {\npackages/shared/session-chat-presentation/turns.ts:205:      if (candidate && hasAgentResponseContent(candidate)) {'
        ),
        previewCall('Bash', {
          command: 'bun test packages/shared/session-chat-presentation/turns.test.ts',
          description: 'Run the turn-boundary tests',
        }),
        previewResult(TEST_OUTPUT),
        previewCall('Bash', {
          command: 'bunx tsc --noEmit -p apps/desktop/tsconfig.json',
          description: 'Type check the desktop project',
        }),
        previewResult(TYPE_ERROR, true),
        previewCall('Task', {
          subagent_type: 'general-purpose',
          description: 'Audit turn boundary callers',
          prompt:
            'List every caller of completedWorkRenderItems and say whether it depends on the raw message list as well as the folded one.',
        }),
        previewResult(SUBAGENT_RESULT),
        previewCall('WebSearch', { query: 'incremental transcript pagination byte offsets' }),
        previewResult(
          'Three results. The closest match describes a byte-cursor pager that reads backwards from the tail, which is the shape this transcript already uses.'
        ),
      ]),
      previewTextRow(
        'tools-6',
        'reasoning',
        70,
        'The only failing check is the desktop project, and its error is in the sidebar runtime rather than in the shared rules. That narrows the fix to one file.'
      ),
      previewRow('tools-7', 'reasoning', 72, [
        {
          type: 'text',
          text: 'I want the exact line before I decide anything, so I will read around it and check whether the value can really be undefined there.',
        },
        previewCall('Read', {
          file_path: '/sample/project/apps/desktop/sidebar/gxserver-runtime/session-chat.ts',
          offset: 176,
          limit: 16,
        }),
        previewResult(
          '  const beforeOffset = page.beforeOffset;\n  const cursor = cursors.get(sessionId);\n  return { ...page, cursor };'
        ),
        previewCall('Bash', {
          command: 'rg -n "cursors.get" apps/desktop/sidebar',
          description: 'Find the cursor map',
        }),
        previewResult(
          'apps/desktop/sidebar/gxserver-runtime/session-chat.ts:181:  const cursor = cursors.get(sessionId);'
        ),
      ]),
      previewRow('tools-8', 'assistant', 80, [
        {
          type: 'text',
          text: 'Here is what the checks reported so far.\n\n- The shared turn-boundary tests pass.\n- The desktop type check fails on one line in the sidebar runtime.\n- The subagent found no caller that depends on the folded list alone.\n\nI am still generating the help reference before I report the fix.',
        },
        previewCall('Read', {
          file_path: '/sample/project/skills/ghostex-help/references/settings.md',
          offset: 1,
          limit: 20,
        }),
        previewResult('# Settings\n\nEvery row the Settings modal can search, with its default.'),
        previewCall('Grep', { pattern: 'sessionChatUseGpui', path: 'packages/shared', output_mode: 'content' }),
        previewResult('packages/shared/session-chat-settings.ts:  sessionChatUseGpui: false,'),
        previewCall('Bash', { command: 'git status --short', description: 'Check the working tree' }),
        previewResult(' M packages/shared/session-chat-presentation/turns.ts'),
      ]),
    ],
  };
}

/** The child transcript the Task row's subagent link opens. */
export function chatPreviewSubagentPage(selector: string): GxserverReadSessionChatResult {
  return {
    subagent: {
      id: selector,
      name: 'turn-auditor',
      agentType: 'general-purpose',
      model: 'gpt-5',
      effort: 'high',
    },
    messages: [
      previewTextRow(
        'subagent-1',
        'user',
        44,
        'List every caller of completedWorkRenderItems and say whether it depends on the raw message list as well as the folded one.'
      ),
      previewRow('subagent-2', 'tool', 46, [
        previewCall('Grep', { pattern: 'completedWorkRenderItems', output_mode: 'content', '-n': true }),
        previewResult(GREP_MATCHES),
      ]),
      previewTextRow(
        'subagent-3',
        'assistant',
        58,
        'Two callers, both in the shared presentation layer, and both pass the raw list beside the folded one. Nothing reads the folded list for byte offsets.'
      ),
    ],
    hasMore: false,
    beforeOffset: 0,
    epoch: 1,
    seq: 1,
    status: 'ready',
    agent: 'codex',
    lifecycle: { state: 'completed', turnId: 'subagent-turn', timestamp: null },
  };
}
