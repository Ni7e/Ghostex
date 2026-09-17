import type { GxserverReadSessionChatResult, SessionChatMessage } from '../session-chat';

export const PREVIEW_SCENARIOS = ['conversation', 'working', 'compacting', 'question', 'queue', 'empty'] as const;
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

export function previewMessage(
  id: string,
  role: SessionChatMessage['role'],
  text: string,
  timestamp?: number
): SessionChatMessage {
  return {
    id,
    role,
    blocks: [{ type: 'text', text }],
    timestamp: timestamp ?? 1_789_632_000_000 + Number(id.replace(/\D/g, '') || 0) * 1000,
    source: 'transcript',
  };
}

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
  return {
    messages: config.scenario === 'empty' ? [] : messages,
    hasMore: false,
    beforeOffset: 0,
    epoch: 1,
    seq: 1,
    status: 'ready',
    agent: 'codex',
    sessionAgentId: 'codex',
    agentSessionId: 'chat-preview',
    screenProbed: true,
    working: config.scenario === 'working' || config.scenario === 'compacting',
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
}
