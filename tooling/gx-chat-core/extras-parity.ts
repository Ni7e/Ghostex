/*
 * Family f's parity fixture: runs the shipped TypeScript rules over a table of inputs and writes
 * what they produced, so `packages/gx-chat-core/examples/extras_parity.rs` can run the Rust port
 * over the same table and diff the two.
 *
 * The replay gate (`docs/2026-09-21/rust-chat/REPLAY.md`) drives the whole brain, which needs
 * family a's fold to be in place first. This covers family f's own rules in the meantime, and it
 * keeps covering the branches a recording never reaches: a stale fleet roster, a blocked task, a
 * rule-only terminal screen, a reserved file name.
 *
 * Everything in the table is invented. It carries no session, project or conversation data, so the
 * output is safe to commit and safe to read.
 *
 * Run: bun tooling/gx-chat-core/extras-parity.ts [output.json]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { sessionChatAgentFleetRows, subagentModelLabel } from '@/packages/shared/session-chat-presentation/agent-fleet';
import { sessionChatAgentTaskPanel } from '@/packages/shared/session-chat-presentation/agent-tasks';
import {
  formatSessionChatActivityElapsed,
  sessionChatActivityElapsedSeconds,
} from '@/packages/shared/session-chat-controller/activity';
import { formatSessionTerminalTailPreview } from '@/packages/shared/session-chat-presentation/terminal-tail';
import {
  SESSION_CHAT_MINIMAP,
  sessionChatMinimapPreview,
  sessionChatMinimapPreviewText,
} from '@/packages/shared/session-chat-presentation/minimap';
import {
  sessionChatSearchCountLabel,
  sessionChatTranscriptItemText,
  sessionChatTranscriptMatches,
} from '@/packages/shared/session-chat-presentation/transcript-search';
import {
  isSessionChatSubagentSelf,
  sessionChatToolSubagent,
} from '@/packages/shared/session-chat-presentation/subagent';
import {
  sessionChatNewSessionWelcomeTitle,
  sessionChatShowsNewSessionWelcome,
  sessionChatWelcomeAgentIcon,
  sessionChatWelcomeAgentName,
} from '@/packages/shared/session-chat-presentation/new-session-welcome';
import { sessionChatEmptyStateCopy } from '@/packages/core-ui/chat/session-chat-empty-state';
import { formatSessionChatDuration } from '@/packages/core-ui/chat/session-chat-duration';
import {
  folderPathError,
  markdownStemError,
  normalizedFolderPath,
  normalizedMarkdownStem,
  suggestedMarkdownStem,
} from '@/packages/shared/session-chat-presentation/save-markdown';
import { SESSION_CHAT_WORKING_WORDS } from '@/packages/shared/session-chat-presentation/working-words';

/** A fixed instant, so the elapsed clocks are the same on every machine. */
const NOW = Date.parse('2026-09-22T12:00:00.000Z');

const cases: Record<string, { input: unknown; output: unknown }[]> = {};
function record(group: string, input: unknown, output: unknown): void {
  (cases[group] ??= []).push({ input, output });
}

// --- working words ---------------------------------------------------------
for (const draw of [0, 0.04182539903558791, 0.5, 0.723172509809956, 0.9999999]) {
  record(
    'workingWord',
    draw,
    SESSION_CHAT_WORKING_WORDS[Math.floor(draw * SESSION_CHAT_WORKING_WORDS.length)] ?? 'Working'
  );
}

// --- activity clock --------------------------------------------------------
for (const seconds of [0, 0.4, 1, 59, 60, 61, 3599, 3600, 3661, 86_399]) {
  record('activityElapsed', seconds, formatSessionChatActivityElapsed(seconds));
}
for (const input of [
  { elapsedSeconds: 12, detectedAt: '2026-09-22T11:59:30.000Z' },
  { elapsedSeconds: 12, detectedAt: '2026-09-22T12:00:30.000Z' },
  { elapsedSeconds: 0, detectedAt: 'not a date' },
  { detectedAt: '2026-09-22T11:59:30.000Z' },
]) {
  record('activitySeconds', input, sessionChatActivityElapsedSeconds(input, NOW));
}

// --- model and effort labels ----------------------------------------------
for (const info of [
  {},
  { model: 'claude-opus-4-5' },
  { model: 'claude-opus-4-5', effort: 'xhigh' },
  { model: 'Opus 5 [1m]', effort: 'high' },
  { model: 'claude-3-5-sonnet-20241022' },
  { model: 'gpt-5.1-astra' },
  { model: 'gpt-5-codex', effort: 'medium' },
  { model: 'some-other-model' },
  { model: '  haiku  ' },
]) {
  record('modelLabel', info, subagentModelLabel(info));
}

// --- the fleet strip -------------------------------------------------------
const fleets: { fleet: unknown; provider: string | null }[] = [
  { fleet: null, provider: 'claude' },
  { fleet: { agents: [], detectedAt: '2026-09-22T11:59:00.000Z' }, provider: 'claude' },
  {
    fleet: {
      detectedAt: '2026-09-22T11:59:00.000Z',
      agents: [
        {
          id: 'a1',
          name: 'general-purpose',
          task: 'Audit the config',
          status: 'working',
          elapsedSeconds: 30,
          tokens: '↓ 12.1k tokens',
          model: 'claude-opus-4-5',
          effort: 'high',
        },
        { name: 'explorer', status: 'idle', nested: 2 },
      ],
    },
    provider: 'claude',
  },
  {
    fleet: {
      detectedAt: '2026-09-22T11:59:00.000Z',
      stale: true,
      agents: [{ name: 'worker', task: 'x', status: 'working', elapsedSeconds: 5 }],
    },
    provider: 'codex',
  },
  {
    fleet: {
      detectedAt: '2026-09-22T11:59:00.000Z',
      validUntil: '2026-09-22T11:59:30.000Z',
      agents: [{ name: 'worker', status: 'working' }],
    },
    provider: 'codex',
  },
  {
    fleet: {
      detectedAt: '2026-09-22T11:59:00.000Z',
      validUntil: 'nonsense',
      agents: [{ name: 'worker', status: 'working', elapsedSeconds: 7 }],
    },
    provider: null,
  },
];
for (const { fleet, provider } of fleets) {
  record('fleetStrip', { fleet, provider, now: NOW }, sessionChatAgentFleetRows(fleet as never, provider, NOW));
}

// --- the task panel --------------------------------------------------------
const tasks = {
  tasks: [
    { id: '3', subject: 'Write the tests', status: 'pending', blockedBy: ['1', '2', '9'] },
    { id: '1', subject: 'Read the code', status: 'completed' },
    { id: '2', subject: 'Draft the change', activeForm: 'Drafting the change', status: 'in_progress' },
    { id: '10', subject: 'Ship it', status: 'weird-status' },
    { id: 'x', subject: 'Unnumbered', status: 'completed' },
  ],
};
for (const collapsed of [true, false]) {
  for (const showCompleted of [true, false]) {
    record(
      'taskPanel',
      { tasks, collapsed, showCompleted },
      sessionChatAgentTaskPanel(tasks as never, { collapsed, showCompleted })
    );
  }
}
record(
  'taskPanel',
  { tasks: null, collapsed: false, showCompleted: false },
  sessionChatAgentTaskPanel(null, { collapsed: false, showCompleted: false })
);
record(
  'taskPanel',
  { tasks: { tasks: [] }, collapsed: false, showCompleted: false },
  sessionChatAgentTaskPanel({ tasks: [] }, { collapsed: false, showCompleted: false })
);

// --- the terminal tail preview --------------------------------------------
for (const lines of [
  [],
  ['  hello', ''],
  ['────────────────────────────────────────────', '  a short line', '────────────────────────────────────────────'],
  ['━━━━━━━━', 'x'],
  ['-------', 'seven dashes are not a rule'],
  ['a──────b', 'mixed'],
]) {
  record('tailPreview', lines, formatSessionTerminalTailPreview(lines));
}

// --- the minimap -----------------------------------------------------------
const longText = 'word '.repeat(60);
for (const message of [
  null,
  { id: 'm1', blocks: [] },
  {
    id: 'm2',
    blocks: [
      { type: 'text', text: '  spaced \n out  ' },
      { type: 'tool-call', name: 'x' },
    ],
  },
  { id: 'm3', blocks: [{ type: 'text', text: longText }] },
]) {
  record('minimapPreview', message, {
    text: sessionChatMinimapPreviewText(message as never),
    preview: sessionChatMinimapPreview(message as never),
  });
}
record('minimapGeometry', null, SESSION_CHAT_MINIMAP);

// --- transcript search -----------------------------------------------------
const items = [
  { kind: 'message', message: { id: 'm1', text: 'the cat sat on the mat' } },
  {
    kind: 'summary',
    id: 't1',
    user: { id: 'u1', text: 'cat' },
    final: { id: 'f1', text: 'CAT cat' },
    work: [{ id: 'w1', tools: [{ call: { name: 'Cat' }, preview: 'cat preview' }], files: [{ path: '/tmp/cat.txt' }] }],
  },
  {
    kind: 'completed-work',
    id: 't2',
    label: 'Worked for 3s',
    artifacts: [{ id: 'a1', suppressed: { label: 'a cat card' } }],
  },
];
for (const query of ['', '  ', 'cat', 'CAT', 'nothing']) {
  record('searchMatches', query, sessionChatTranscriptMatches(items, query));
  record(
    'searchLabel',
    { query, total: sessionChatTranscriptMatches(items, query).length, activeIndex: 0 },
    sessionChatSearchCountLabel(query, sessionChatTranscriptMatches(items, query).length, 0)
  );
}
for (const item of items) {
  record('searchItemText', item, sessionChatTranscriptItemText(item));
}

// --- the subagent target ---------------------------------------------------
const targets: { call: unknown; result: unknown; agentPath?: string }[] = [
  { call: { type: 'tool-call', name: 'Read', input: {} }, result: undefined },
  {
    call: { type: 'tool-call', name: 'Task', input: { description: 'Audit', subagent_type: 'general-purpose' } },
    result: { type: 'tool-result', output: 'agentId: abc_123 done' },
  },
  {
    call: { type: 'tool-call', name: 'mcp.spawn_agent', input: { task_name: 'audit' } },
    result: { type: 'tool-result', output: '{"agent_nickname":"Auditor"}' },
  },
  {
    call: { type: 'tool-call', name: 'send_message', input: { target: 'child' } },
    result: undefined,
    agentPath: '/root/parent',
  },
  { call: { type: 'tool-call', name: 'send_message', input: { id: '/abs/child' } }, result: undefined },
  { call: { type: 'tool-call', name: 'followup_task', input: {} }, result: undefined },
];
for (const { call, result, agentPath } of targets) {
  record(
    'subagentTarget',
    { call, result, agentPath: agentPath ?? '/root' },
    sessionChatToolSubagent(call as never, result as never, agentPath)
  );
}
for (const selector of ['/root', '/root/parent', '/other']) {
  record('subagentSelf', { selector, agentPath: '/root/parent' }, isSessionChatSubagentSelf(selector, '/root/parent'));
}

// --- the welcome and the empty state --------------------------------------
for (const kind of ['loading', 'empty', 'error', 'unsupported', 'starting', 'ready', 'notFound']) {
  record('showsWelcome', kind, sessionChatShowsNewSessionWelcome(kind));
}
for (const label of [null, '', '  ', 'codex', 'claude', 'claude-code', 'my_custom-agent', 'hermes', 'grok', 'omp']) {
  const name = sessionChatWelcomeAgentName(label);
  record('welcomeAgentName', label, name);
  record('welcomeTitle', name, sessionChatNewSessionWelcomeTitle(name));
  record('welcomeIcon', { label, icon: null }, sessionChatWelcomeAgentIcon(label, null) ?? null);
}
record('welcomeIcon', { label: 'codex', icon: 'browser' }, sessionChatWelcomeAgentIcon('codex', 'browser') ?? null);
record(
  'welcomeIcon',
  { label: 'codex', icon: 'not-an-icon' },
  sessionChatWelcomeAgentIcon('codex', 'not-an-icon') ?? null
);
for (const kind of ['loading', 'empty', 'error', 'unsupported', 'starting'] as const) {
  for (const agent of [null, 'codex', '  ']) {
    record('emptyState', { kind, agent }, sessionChatEmptyStateCopy(kind, agent));
  }
}

// --- durations -------------------------------------------------------------
for (const ms of [0, -5, 499, 500, 1_000, 59_400, 60_000, 3_600_000, 3_723_000]) {
  record('duration', ms, formatSessionChatDuration(ms));
}

// --- Save to Markdown paths ------------------------------------------------
for (const value of ['', '  ', 'notes', ' notes / deep ', 'a/./b', 'con', 'a<b', 'trailing.', 'x'.repeat(250)]) {
  record('folderError', value, folderPathError(value) ?? null);
  record('folderPath', value, normalizedFolderPath(value));
}
for (const value of ['', '  ', 'notes', 'notes.MD', 'notes.md ', 'nul.txt', 'a/b', '..', 'ends.', 'x'.repeat(130)]) {
  record('stemError', value, markdownStemError(value) ?? null);
  record('stem', value, normalizedMarkdownStem(value));
}
const existing = [
  'docs/2026-09-22/Fixing the build 1.md',
  'docs/2026-09-22/Fixing the build 4.md',
  'docs/2026-09-22/fixing the build 9.md',
  'docs/2026-09-22/nested/Fixing the build 99.md',
  'docs/other/Fixing the build 50.md',
  'docs/2026-09-22/Fixing the build.md',
];
for (const title of ['Fixing the build', 'Fix-the-build', '', '  ??  ', 'A'.repeat(140), 'Trailing dots...']) {
  record(
    'suggestedStem',
    { title, folder: '2026-09-22', existing },
    suggestedMarkdownStem(title, '2026-09-22', existing)
  );
}

const target = process.argv[2] ?? '/tmp/gx-chat/extras-parity.json';
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify({ v: 1, now: NOW, cases }, null, 2)}\n`);
let total = 0;
for (const group of Object.values(cases)) total += group.length;
console.log(`extras parity  ${Object.keys(cases).length} groups, ${total} cases`);
console.log(`wrote          ${target}`);
