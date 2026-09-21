/**
 * Writes family b's projection fixture to `/tmp/gx-chat/transcript-b.json`.
 *
 * Usage: `bun tooling/gx-chat-core/synthetic-b.ts`
 *
 * Family b's output is the `itemsSplice` payload, which the whole-document replay can only reach
 * through family a's fold. This gate goes straight at it instead: it runs the SHIPPED projection
 * (`packages/shared/session-chat-controller/native-presentation.ts`, imported directly, nothing
 * reimplemented) over a list of message lists, and records the input and the item list it produced.
 * `cargo run --example transcript_check` replays the same inputs through `src/transcript/` and diffs
 * the two item lists.
 *
 * Every message list comes from the Chat Lab fixtures (`packages/shared/session-chat-preview/`)
 * plus the invented markdown case below, so the file holds no user data, can be regenerated on any
 * machine, and two generations produce the same bytes apart from the clock the fixture records.
 *
 * The markdown case is deliberately nasty, because markdown is the riskiest part of the port: the
 * TypeScript parses with `mdast-util-from-markdown` and the Rust with `markdown::to_mdast`, and a
 * difference between the two parsers shows up here and nowhere else. It covers nested lists, a GFM
 * table, fences with info strings and titles, inline code that is and is not a path, links,
 * autolinks, raw HTML, hard breaks, emphasis edge cases, a very long line, CRLF line endings, and
 * text outside the Basic Multilingual Plane, because a JavaScript string index is a UTF-16 code
 * unit and a Rust one is a byte.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

import {
  chatPreviewSnapshot,
  DEFAULT_CHAT_PREVIEW,
  PREVIEW_SCENARIOS,
} from '@/packages/shared/session-chat-preview/fixture';
import { previewCall, previewResult, previewRow, previewTextRow } from '@/packages/shared/session-chat-preview/message';
import type { SessionChatMessage } from '@/packages/shared/session-chat';
import { NativeChatPresentation } from '@/packages/shared/session-chat-controller/native-presentation';

const OUTPUT = '/tmp/gx-chat/transcript-b.json';
const WORKING_DIRECTORY = '/sample/project';

/** Markdown an agent could plausibly write that exercises every construct the port has to survive. */
const NASTY_MARKDOWN = [
  '# Heading with `inline code` and **bold**',
  '',
  'A paragraph with a bare link https://example.com/a(b)c, and one in parentheses',
  '(https://example.com/x?y=1&z=2), and a trailing one https://example.com/end.',
  '',
  'Emphasis edge cases: snake_case_identifier stays, *star* and _underscore_ go,',
  '**double** and __double underscore__ and ***triple*** and a literal \\*escaped\\*.',
  '',
  '- Outer item one',
  '  - Nested item with `packages/shared/session-chat.ts:42` and `cargo check`',
  '    1. Deep ordered item',
  '    2. Another one with [a link](packages/core-ui/chat/session-chat-noise.ts:12)',
  '- Outer item two',
  '',
  '| Column | Status |',
  '| :--- | ---: |',
  '| Messages | Ready |',
  '| Composer | `apps/desktop/src/app/native_chat/state.rs` |',
  '',
  '```ts title="src/main.ts"',
  'export const value = 1;',
  '```',
  '',
  '```rust apps/desktop/src/terminal_element.rs',
  'fn draw() {}',
  '```',
  '',
  '````',
  '```not a fence close```',
  '````',
  '',
  '> [!NOTE]',
  '> An alert whose body has its own fence:',
  '>',
  '> ```json file=package.json',
  '> { "name": "x" }',
  '> ```',
  '',
  '> An ordinary quote that is not an alert.',
  '',
  '<div data-x="1">Raw HTML block</div>',
  '',
  'Hard break at the end of this line  ',
  'and the line after it.',
  '',
  'Unicode: café, 日本語, emoji 👩‍💻🏳️‍🌈, maths 𝕏, and a combining a\u0301.',
  '',
  `A very long line: ${'lorem ipsum dolor sit amet '.repeat(40)}end.`,
  '',
  '![An image](media/screenshot.png) and [a picture link](media/other.JPEG?v=2)',
  'and ![](media/empty-alt.gif) and `![not an image](x.png)`.',
  '',
  '[reference link][ref] and [missing][nope].',
  '',
  '[ref]: packages/find/src/lib.rs:7:3',
  '',
  'Autolink in angle brackets: <https://example.com/angle> and <mailto:nobody@example.com>.',
].join('\n');

/** The same, with CRLF endings, which the line scanners have to treat as one line each. */
const NASTY_MARKDOWN_CRLF = NASTY_MARKDOWN.replaceAll('\n', '\r\n');

function markdownCase(id: string, text: string): SessionChatMessage[] {
  return [
    previewTextRow(`${id}-user`, 'user', 1, 'Write me every markdown construct at once, please.'),
    previewTextRow(`${id}-assistant`, 'assistant', 2, text),
  ];
}

/** A user turn, which is the only role whose unmarked paths are promoted to links. */
function userPathsCase(): SessionChatMessage[] {
  return [
    previewTextRow(
      'paths-user',
      'user',
      1,
      [
        'Look at packages/shared/session-chat.ts:120 and @apps/desktop/src/app/native_chat/state.rs,',
        'plus @"my notes/plan with spaces.md" and @report(final).pdf and v1.2.3 and example.com',
        'and text/plain and origin/main and README and Makefile:12 and ./relative/file.rs',
        'and ~/home/file.toml and C:\\Windows\\System32\\drivers.txt and a trailing one.',
        '',
        '[Image #1](/tmp/ghostex-paste-abc.png) should stay one reference.',
      ].join('\n')
    ),
    previewTextRow(
      'paths-assistant',
      'assistant',
      2,
      'An agent turn with packages/shared/session-chat.ts in it stays plain.'
    ),
  ];
}

/** Tool rows whose arguments are the shapes the previews and the file-change split care about. */
function toolShapesCase(): SessionChatMessage[] {
  return [
    previewTextRow('tools-user', 'user', 1, 'Make the edits.'),
    previewRow('tools-work', 'assistant', 2, [
      { type: 'text', text: 'Working on it.' },
      previewCall('Edit', {
        file_path: '/sample/project/src/chat.ts',
        old_string: 'const a = 1;\nconst b = 2;\n',
        new_string: 'const a = 3;\nconst b = 4;\nconst c = 5;\n',
      }),
      previewResult('Applied'),
      previewCall('Bash', { command: 'cargo check --all\nbun run typecheck\nbun run lint\nbun run build' }),
      previewResult('ok'),
      previewCall('apply_patch', {
        patch: '*** Begin Patch\n*** Update File: src/other.ts\n@@\n-old line\n+new line\n*** End Patch\n',
      }),
      previewResult('Patched'),
      previewCall('WebFetch', { url: 'https://example.com/docs', prompt: 'summarise' }),
      previewResult('An error happened', true),
      previewCall('AskUserQuestion', {
        questions: [
          { question: 'Which pane?', options: ['Left', 'Right'], multiSelect: false },
          { question: 'Anything else?', options: [] },
        ],
      }),
      previewResult('The user answered: ["Which pane?"="Left", "Anything else?"="no, thanks"]. You can now continue'),
      previewCall('Task', { subagent_type: 'general-purpose', description: 'Find the thing', task_name: 'finder' }),
      previewResult('{"agent_id":"agent-7","agent_nickname":"finder"}'),
    ]),
    previewTextRow('tools-final', 'assistant', 3, 'Done.'),
  ];
}

/** Harness-injected turns, which the noise classifier has to label identically. */
function harnessCase(): SessionChatMessage[] {
  return [
    previewTextRow('harness-user', 'user', 1, 'Run the compaction.'),
    previewTextRow(
      'harness-1',
      'user',
      2,
      '<command-name>/compact</command-name><command-args>keep the plan</command-args>'
    ),
    previewTextRow('harness-2', 'user', 3, '<local-command-stdout>Compacted.</local-command-stdout>'),
    previewTextRow(
      'harness-3',
      'user',
      4,
      '<local-command-stdout>Set model to `gpt-5` and saved as your default for new sessions. A settings pin disagrees.</local-command-stdout>'
    ),
    previewTextRow('harness-4', 'user', 5, '<local-command-stdout>Set effort level to high</local-command-stdout>'),
    previewTextRow(
      'harness-5',
      'user',
      6,
      '<task-notification><status>completed</status><summary>Background build finished (exit code 0)</summary></task-notification>'
    ),
    previewTextRow('harness-6', 'user', 7, '<system-reminder>Never shown.</system-reminder>'),
    previewTextRow('harness-7', 'system', 8, 'Context compacted', { source: 'transcript' }),
    previewTextRow('harness-8', 'user', 9, '[Request interrupted by user]'),
    previewTextRow('harness-9', 'system', 10, 'Message from /root/windows_support\n\nThe Windows build is green now.'),
    previewTextRow('harness-final', 'assistant', 11, 'All caught up.'),
  ];
}

/**
 * More turns than the eager tail, so the projection ships the older rows as plain-text placeholders
 * and queues them for backfill. Without a case this long that branch never runs.
 */
function longTranscriptCase(): SessionChatMessage[] {
  const messages: SessionChatMessage[] = [];
  for (let turn = 0; turn < 30; turn += 1) {
    messages.push(
      previewTextRow(`long-${turn}-user`, 'user', turn * 10, `Prompt ${turn} about packages/shared/x.ts:${turn + 1}`)
    );
    messages.push(
      previewRow(`long-${turn}-work`, 'assistant', turn * 10 + 1, [
        { type: 'text', text: `Checking item ${turn}.` },
        previewCall('Read', { file_path: `/sample/project/src/file-${turn}.ts` }),
        previewResult(`line one\nline two`),
      ])
    );
    messages.push(
      previewTextRow(`long-${turn}-final`, 'assistant', turn * 10 + 2, `Answer ${turn} with \`inline\` and **bold**.`)
    );
  }
  return messages;
}

/** A turn whose older work is deferred, which the completed-work fold reports and reads back. */
function deferredCase(): SessionChatMessage[] {
  return [
    previewTextRow('deferred-user', 'user', 1, 'The older turn.', {
      deferredWork: {
        beforeOffset: 128,
        startId: 'deferred-start',
        endId: 'deferred-end',
        completedAt: 1_789_632_000_000 + 45_000,
        messageCount: 4,
        filePaths: ['/sample/project/src/deferred.ts', '/sample/project/src/other.ts'],
      },
    } as Partial<SessionChatMessage>),
    previewTextRow('deferred-final', 'assistant', 45, 'Done with the older turn.', { byteOffset: 200 }),
    previewTextRow('deferred-next-user', 'user', 60, 'And the newer one.', { byteOffset: 300 }),
    previewTextRow('deferred-next-final', 'assistant', 61, 'Answered.', { byteOffset: 400 }),
  ];
}

interface ProjectionCase {
  name: string;
  workingDirectory: string | null;
  agentPath: string;
  working: boolean;
  summary: boolean;
  messages: SessionChatMessage[];
}

/** Every `{kind, messageId, index}` an open row could ask for in this case. */
function rowDetailRequests(
  messages: readonly SessionChatMessage[]
): { key: string; kind: string; messageId: string; index: number }[] {
  const requests: { key: string; kind: string; messageId: string; index: number }[] = [];
  for (const message of messages) {
    const tools = message.blocks.filter((block) => block.type === 'tool-call' || block.type === 'tool-result').length;
    for (let index = 0; index < tools + 1; index += 1) {
      requests.push({ key: `${message.id}:tool:${index}`, kind: 'tool', messageId: message.id, index });
      requests.push({ key: `${message.id}:file:${index}`, kind: 'file', messageId: message.id, index });
    }
  }
  return requests;
}

function cases(): ProjectionCase[] {
  const out: ProjectionCase[] = [];
  const push = (name: string, messages: SessionChatMessage[], working = false) => {
    for (const summary of [false, true]) {
      out.push({
        name: `${name}${summary ? '-summary' : ''}`,
        workingDirectory: WORKING_DIRECTORY,
        agentPath: '/root',
        working,
        summary,
        messages,
      });
    }
  };
  for (const scenario of PREVIEW_SCENARIOS) {
    const snapshot = chatPreviewSnapshot({ ...DEFAULT_CHAT_PREVIEW, scenario });
    push(`preview-${scenario}`, snapshot.messages);
  }
  // The same conversation with the agent still working, which moves every turn boundary.
  push(
    'preview-working-live',
    chatPreviewSnapshot({ ...DEFAULT_CHAT_PREVIEW, scenario: 'conversation' }).messages,
    true
  );
  push('markdown-nasty', markdownCase('nasty', NASTY_MARKDOWN));
  push('markdown-nasty-crlf', markdownCase('crlf', NASTY_MARKDOWN_CRLF));
  push('user-paths', userPathsCase());
  push('tool-shapes', toolShapesCase());
  push('harness-turns', harnessCase());
  push('long-transcript', longTranscriptCase());
  push('long-transcript-live', longTranscriptCase(), true);
  push('deferred-turn', deferredCase());
  // No working directory at all, which is the path a card takes before the session reports one.
  out.push({
    name: 'no-working-directory',
    workingDirectory: null,
    agentPath: '/root',
    working: false,
    summary: false,
    messages: toolShapesCase(),
  });
  // A subagent viewer resolves its `Task` chips against the child's own path, not `/root`.
  out.push({
    name: 'subagent-path',
    workingDirectory: WORKING_DIRECTORY,
    agentPath: '/root/finder',
    working: false,
    summary: false,
    messages: toolShapesCase(),
  });
  return out;
}

function main(): void {
  const nowMs = Date.now();
  const utcOffsetMinutes = -new Date(nowMs).getTimezoneOffset();
  const recorded = cases().map((entry) => {
    const presentation = new NativeChatPresentation();
    presentation.setAgentPath(entry.agentPath);
    presentation.setWorkingDirectory(entry.workingDirectory ?? undefined);
    const projection = presentation.update(entry.messages, entry.working, entry.summary, new Map(), 0);
    const rowDetails = rowDetailRequests(entry.messages).flatMap((request) => {
      const detail = presentation.rowDetail(request.kind, request.messageId, request.index);
      return detail === undefined ? [] : [{ ...request, detail }];
    });
    return {
      name: entry.name,
      workingDirectory: entry.workingDirectory,
      agentPath: entry.agentPath,
      working: entry.working,
      summary: entry.summary,
      messages: entry.messages,
      items: projection.items,
      finalIds: projection.finalIds,
      rowDetails,
    };
  });
  mkdirSync('/tmp/gx-chat', { mode: 0o700, recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify({ v: 1, nowMs, utcOffsetMinutes, cases: recorded }, null, 0)}\n`, {
    mode: 0o600,
  });
  const items = recorded.reduce((total, entry) => total + entry.items.length, 0);
  process.stdout.write(`fixture        ${recorded.length} cases, ${items} items\nwrote          ${OUTPUT}\n`);
}

main();
