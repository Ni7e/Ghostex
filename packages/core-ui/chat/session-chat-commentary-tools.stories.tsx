import type { Meta, StoryObj } from '@storybook/react-vite';
import type { SessionChatMessage } from '../../shared/session-chat';
import { SessionChatMessageList } from './session-chat-message-list';

const MESSAGES: SessionChatMessage[] = [
  {
    id: 'commentary-user',
    role: 'user',
    source: 'transcript',
    timestamp: 1000,
    blocks: [{ type: 'text', text: 'Show me how tool calls look underneath the message.' }],
  },
  {
    id: 'commentary-intro',
    role: 'assistant',
    source: 'transcript',
    timestamp: 2000,
    blocks: [
      {
        type: 'text',
        text: 'I’ll check the chat controls and settings, then add a global Simple mode with the tool-call and edit summaries you described. I’ll also suggest a few other ways to simplify the view.',
      },
    ],
  },
  {
    id: 'commentary-intro-tools',
    role: 'tool',
    source: 'transcript',
    timestamp: 3000,
    blocks: [
      { type: 'tool-call', name: 'exec', input: { cmd: 'cat AGENTS.md' } },
      { type: 'tool-result', output: 'Read the repository guidance.' },
      { type: 'tool-call', name: 'exec', input: { cmd: 'rg -n "tool call" packages/core-ui/chat' } },
      { type: 'tool-result', output: 'Found the tool disclosure and transcript renderer.' },
      { type: 'tool-call', name: 'exec', input: { cmd: 'git diff --stat' } },
      { type: 'tool-result', output: 'Reviewed the current changes.' },
    ],
  },
  {
    id: 'commentary-markdown',
    role: 'assistant',
    source: 'transcript',
    timestamp: 4000,
    blocks: [
      {
        type: 'text',
        text: [
          'The message keeps **bold text**, *emphasis*, and `inline code`.',
          '',
          '- Links like [the renderer](/Users/madda/dev/_active/Ghostex/packages/core-ui/chat/session-chat-message-list/rows.tsx) keep their own action.',
          '- Paragraphs and lists remain visible even with the tools collapsed.',
          '',
          '```ts',
          'const toolsVisible = expanded;',
          'const messageVisible = true;',
          '```',
          '',
          'Click this sentence to reveal the tool calls, or use the chevron with your keyboard.',
        ].join('\n'),
      },
    ],
  },
  {
    id: 'commentary-markdown-tools',
    role: 'tool',
    source: 'transcript',
    timestamp: 5000,
    blocks: [
      { type: 'tool-call', name: 'exec', input: { cmd: 'bun run typecheck' } },
      { type: 'tool-result', output: 'Type checking completed.' },
    ],
  },
  {
    id: 'commentary-reasoning',
    role: 'reasoning',
    source: 'transcript',
    timestamp: 6000,
    blocks: [{ type: 'text', text: 'Checking the existing reasoning layout for comparison' }],
  },
  {
    id: 'commentary-reasoning-tools',
    role: 'tool',
    source: 'transcript',
    timestamp: 7000,
    blocks: [
      { type: 'tool-call', name: 'exec', input: { cmd: 'git diff --check' } },
      { type: 'tool-result', output: 'No whitespace errors.' },
    ],
  },
  {
    id: 'commentary-plain',
    role: 'assistant',
    source: 'transcript',
    timestamp: 8000,
    blocks: [{ type: 'text', text: 'A message without tool calls keeps its usual appearance.' }],
  },
];

function CommentaryToolsPreview({
  theme,
  verboseMode,
  completed = false,
}: {
  theme: 'dark' | 'light';
  verboseMode: boolean;
  completed?: boolean;
}) {
  return (
    <div
      className='ghostex-session-chat-scope flex min-h-0 flex-col bg-background text-foreground'
      data-chat-theme={theme}
      style={{ height: '100dvh' }}
    >
      <div className='shrink-0 border-b border-border px-4 py-3 text-sm'>
        Click a message or its chevron to expand its tools.
      </div>
      <SessionChatMessageList
        hasMore={false}
        isWorking={!completed}
        loadingEarlier={false}
        messages={MESSAGES}
        onLoadEarlier={() => undefined}
        verboseMode={verboseMode}
      />
      <div className='shrink-0 border-t border-border px-4 py-3 text-xs text-muted-foreground'>End of preview</div>
    </div>
  );
}

const meta = {
  title: 'Chat/Commentary tool disclosures',
  component: CommentaryToolsPreview,
  parameters: { layout: 'fullscreen' },
  argTypes: { theme: { control: 'inline-radio', options: ['dark', 'light'] } },
} satisfies Meta<typeof CommentaryToolsPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Collapsed: Story = { args: { theme: 'dark', verboseMode: false } };
export const Expanded: Story = { args: { theme: 'dark', verboseMode: true } };
export const Light: Story = { args: { theme: 'light', verboseMode: false } };

export const CompletedTurn: Story = {
  args: { theme: 'dark', verboseMode: false, completed: true },
  decorators: [
    (Story) => (
      <>
        <Story />
        {/* The desktop bundle emits the shared marker rule after the component stylesheet. */}
        <style>{`.ghostex-chat-agent-message::before { content: ''; }`}</style>
      </>
    ),
  ],
};
