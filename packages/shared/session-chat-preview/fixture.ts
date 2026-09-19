import type { GxserverReadSessionChatResult, SessionChatMessage } from '../session-chat';
import { DEFAULT_ACCOUNT_POLICY, type AgentAccount, type AgentAccountsState } from '../agent-accounts';
import { LINKS_PREVIEW_MESSAGES } from './links';
import { MARKDOWN_PREVIEW } from './markdown-fixture';
import { previewMessage } from './message';
import { chatPreviewScenarioOverride } from './scenarios';

export const PREVIEW_SCENARIOS = [
  'conversation',
  'markdown',
  'working',
  'compacting',
  'question',
  'approval',
  'update',
  'update-error',
  'links',
  'async',
  'queue',
  'empty',
  'tools',
  'files',
  'images',
  'system',
  'rich-markdown',
  'agents',
  'history',
] as const;
export type PreviewScenario = (typeof PREVIEW_SCENARIOS)[number];
export interface ChatPreviewConfig {
  scenario: PreviewScenario;
  theme: 'dark' | 'light';
  zoom: number;
  verbose: boolean;
  simple: boolean;
  revision: number;
}
export const DEFAULT_CHAT_PREVIEW: ChatPreviewConfig = {
  scenario: 'working',
  theme: 'dark',
  zoom: 100,
  verbose: false,
  simple: false,
  revision: 1,
};

export { previewMessage };

/** CDXC:SessionChat 2026-09-17 DECISION: User: provide a standalone sample-conversation app to compare the real GPUI and React chat renderers while the native port evolves. Both previews use this fixture and the same simulated transport. */
export function chatPreviewSnapshot(config: ChatPreviewConfig): GxserverReadSessionChatResult {
  const messages: SessionChatMessage[] = [
    previewMessage('1', 'user', 'Can you review this small project and suggest a maintainable implementation?'),
    previewMessage('2', 'assistant', 'I’ll inspect the structure, then explain the change and the checks it needs.'),
    previewMessage(
      '3',
      'reasoning',
      'The controller should own behavior, while each renderer owns layout and input. I am checking the existing boundaries.'
    ),
    {
      ...previewMessage('4', 'tool', ''),
      blocks: [
        { type: 'tool-call', name: 'Read', input: { file_path: '/sample/project/src/chat.ts' } },
        { type: 'tool-result', output: 'export const title = "Shared conversation";\nexport const ready = true;' },
      ],
    },
    previewMessage(
      '5',
      'assistant',
      '## Proposed change\n\nKeep the conversation state shared and render it with the platform UI.\n\n- **One controller** for messages and actions.\n- **Two renderers** for layout and input.\n- Preserve drafts across navigation.\n\n```ts\nexport function greeting(name: string) {\n  return `Hello, ${name}!`;\n}\n```\n\n> The same data should produce the same visible state.\n\n| Area | Status |\n| --- | --- |\n| Messages | Ready |\n| Composer | Ready |\n| Scrolling | Check both panes |'
    ),
    previewMessage(
      '6',
      'user',
      'Please include a longer conversation so I can check scrolling, code blocks, and collapsed tool calls.'
    ),
    ...Array.from({ length: 12 }, (_, index) =>
      previewMessage(
        String(index + 7),
        index % 3 === 0 ? 'user' : 'assistant',
        index % 3 === 0
          ? `Review item ${index + 1}: how does this behave in a narrow pane?`
          : `Sample response ${index + 1}. Resize the window and scroll this conversation to compare wrapping, spacing, and the composer.\n\nThis paragraph includes **bold text**, *emphasis*, and an \`inlineCode()\` reference.`
      )
    ),
    previewMessage(
      '19',
      'assistant',
      'The sample is ready. You can type and send a message, change the scenario, or reset both previews from the comparison controls.'
    ),
  ];
  if (config.scenario === 'async') {
    messages.push({
      ...previewMessage('20', 'assistant', 'I can keep reviewing while you choose the next check.'),
      asyncQuestions: [
        { title: 'Which layout should I check next?', options: ['Narrow pane', 'Large text'] },
        { title: 'Any other behavior you want me to verify?' },
      ],
    });
  }
  const result: GxserverReadSessionChatResult = {
    messages:
      config.scenario === 'empty'
        ? []
        : config.scenario === 'links'
          ? LINKS_PREVIEW_MESSAGES
          : config.scenario === 'markdown'
            ? [
                previewMessage('1', 'user', 'Compare inline code wrapping and selection.'),
                previewMessage('2', 'assistant', MARKDOWN_PREVIEW),
              ]
            : messages,
    hasMore: false,
    beforeOffset: 0,
    epoch: 1,
    seq: 1,
    status: 'ready',
    agent: 'codex',
    sessionAgentId: 'codex',
    agentSessionId: 'chat-preview',
    screenProbed: true,
    working: config.scenario === 'working' || config.scenario === 'compacting' || config.scenario === 'async',
    selectedOptions: {
      detectedAt: '2026-09-17T10:00:00Z',
      model: { value: 'gpt-5', label: 'GPT 5' },
      effort: { value: 'high', label: 'High' },
    },
    queue:
      config.scenario === 'queue'
        ? [
            {
              id: 'preview-queued',
              text: 'Check the narrow layout next.',
              state: 'queued',
              createdAt: '2026-09-17T10:00:00Z',
              updatedAt: '2026-09-17T10:00:00Z',
            },
          ]
        : [],
    ...(config.scenario === 'compacting'
      ? {
          terminalActivity: {
            kind: 'compacting' as const,
            label: 'Compacting conversation',
            percent: 42,
            elapsedSeconds: 18,
            detectedAt: new Date().toISOString(),
          },
        }
      : {}),
    ...(config.scenario === 'update' || config.scenario === 'update-error'
      ? {
          terminalNotice: {
            kind: 'updatePrompt',
            severity: 'warning' as const,
            source: 'screen' as const,
            detectedAt: '2026-09-18T01:14:09Z',
            title: 'Update Codex to 0.155.0?',
            detail:
              'This session runs Codex 0.154.0. Update now installs 0.155.0 through pnpm. Codex quits to install it, so start it again in this session afterwards.',
            choices: ['Update now', 'Skip for now', 'Skip until next version'].map((label, index) => ({
              index,
              label,
              selected: index === 0,
            })),
            dialog: {
              id: 'codex-update-prompt:preview',
              title: 'Update Codex to 0.155.0?',
              body: '',
              footer: 'Choose an option to continue.',
              input: null,
              inputValue: '',
              actions: [],
              rows: ['Update now', 'Skip for now', 'Skip until next version'].map((label, index) => ({
                number: index + 1,
                label,
                description: null,
                selected: index === 0,
              })),
            },
            screenTail:
              'Update available! 0.154.0 -> 0.155.0\n1. Update now (pnpm add -g @openai/codex)\n2. Skip for now\n3. Skip until next version',
          },
        }
      : {}),
    ...(config.scenario === 'approval'
      ? { prompt: { kind: 'approval' as const, tool: 'Shell', summary: 'bun run typecheck' } }
      : {}),
    ...(config.scenario === 'question'
      ? {
          prompt: {
            kind: 'question' as const,
            questions: [
              {
                question: 'Which part should we review next?',
                header: 'Next step',
                multiSelect: false,
                options: [
                  { label: 'Layout', description: 'Compare spacing and typography.' },
                  { label: 'Composer', description: 'Try typing and keyboard controls.' },
                ],
              },
            ],
          },
        }
      : {}),
  };
  // Scenarios with a transcript of their own live in their own file beside this
  // registry; everything they do not name keeps the shared sample's state.
  const override = chatPreviewScenarioOverride(config.scenario);
  return override ? { ...result, ...override } : result;
}

/**
 * Sample Codex accounts for Switch Account and the account-switch card. Picking the
 * spare account simulates a failed switch; the signed-out one asks for Settings.
 */
export function chatPreviewAccounts(now = Date.now()): AgentAccountsState {
  const at = (hours: number) => new Date(now + hours * 3_600_000).toISOString();
  const account = (
    id: string,
    // The helper's slot number, which is also the mark the model pill draws over the provider logo
    // for an account without its own indicator.
    slot: string,
    name: string,
    email: string,
    fiveHour: number,
    weekly: number,
    status: AgentAccount['status'] = 'ready'
  ): AgentAccount => ({
    id,
    provider: 'codex',
    selector: slot,
    name,
    email,
    color: 'neutral',
    eligible: true,
    registered: true,
    sharedHistory: true,
    status,
    sessionCount: id === 'work' ? 1 : 0,
    resetCredits: 2,
    usage: [
      { id: 'fiveHour', label: '5h', usedPercent: fiveHour, limitWindowSeconds: 18_000, resetsAt: at(2.2) },
      { id: 'sevenDay', label: '7d', usedPercent: weekly, limitWindowSeconds: 604_800, resetsAt: at(78) },
    ],
  });
  return {
    accounts: [
      account('work', '1', 'work@example.com', 'work@example.com', 96, 82),
      account('personal', '2', 'Personal', 'me@example.com', 12, 31),
      account('spare', '3', 'spare@example.com', 'spare@example.com', 40, 55),
      account('old', '4', 'old@example.com', 'old@example.com', 0, 0, 'loginRequired'),
    ],
    helpers: [],
    defaults: { claude: DEFAULT_ACCOUNT_POLICY, codex: DEFAULT_ACCOUNT_POLICY },
    defaultAccounts: {},
    session: { provider: 'codex', accountId: 'work', policy: DEFAULT_ACCOUNT_POLICY, override: null },
  };
}
