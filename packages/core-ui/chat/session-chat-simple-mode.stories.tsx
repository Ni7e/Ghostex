import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Switch } from '../../components/ui/switch';
import type { SessionChatMessage } from '../../shared/session-chat';
import { SessionChatComposerActions } from './session-chat-composer-actions';
import { SessionChatMessageList } from './session-chat-message-list';
import { SessionChatPresentationProvider } from './session-chat-presentation-provider';

const TOOL_MESSAGES: SessionChatMessage[] = [
  {
    id: 'simple-user',
    role: 'user',
    source: 'transcript',
    timestamp: 1000,
    blocks: [{ type: 'text', text: 'Please check the application files.' }],
  },
  {
    id: 'simple-tools',
    role: 'tool',
    source: 'transcript',
    timestamp: 2000,
    blocks: [
      'ls -d ~/Applications/example.app',
      'ls ~/Applications',
      'ls ~/.local/bin',
      'which example',
      'ls /Applications',
      'ls ~/Downloads',
    ].flatMap((cmd) => [
      { type: 'tool-call' as const, name: 'Bash', input: { cmd } },
      { type: 'tool-result' as const, output: `Checked: ${cmd}` },
    ]),
  },
  {
    id: 'simple-tool-commentary',
    role: 'assistant',
    source: 'transcript',
    timestamp: 3000,
    blocks: [{ type: 'text', text: 'I found the files. I’ll check their contents next.' }],
  },
  {
    id: 'simple-read',
    role: 'tool',
    source: 'transcript',
    timestamp: 4000,
    blocks: [
      { type: 'tool-call', name: 'Read', input: { file_path: '/project/settings.json' } },
      { type: 'tool-result', output: '{ "appearance": "system" }' },
    ],
  },
];

const EDIT_MESSAGES: SessionChatMessage[] = [
  {
    id: 'simple-edit-user',
    role: 'user',
    source: 'transcript',
    timestamp: 1000,
    blocks: [{ type: 'text', text: 'Update the chat layout and its settings.' }],
  },
  {
    id: 'simple-edit-commentary',
    role: 'assistant',
    source: 'transcript',
    timestamp: 2000,
    blocks: [{ type: 'text', text: 'I’ll update **both files**, keeping the existing diff cards available.' }],
  },
  {
    id: 'simple-edit-tools',
    role: 'tool',
    source: 'transcript',
    timestamp: 3000,
    blocks: [
      {
        type: 'tool-call',
        name: 'apply_patch',
        input:
          '*** Begin Patch\n*** Update File: /project/chat.tsx\n@@\n-const expanded = true;\n+const expanded = false;\n*** Update File: /project/settings.ts\n@@\n+export const simpleMode = false;\n*** End Patch',
      },
      { type: 'tool-result', output: 'Updated both files.' },
    ],
  },
  {
    id: 'simple-edit-followup',
    role: 'assistant',
    source: 'transcript',
    timestamp: 4000,
    blocks: [{ type: 'text', text: 'I’ll also adjust the spacing in one file.' }],
  },
  {
    id: 'simple-one-edit',
    role: 'tool',
    source: 'transcript',
    timestamp: 5000,
    blocks: [
      {
        type: 'tool-call',
        name: 'Edit',
        input: { file_path: '/project/chat.css', old_string: 'gap: 16px;', new_string: 'gap: 8px;' },
      },
      { type: 'tool-result', output: 'Updated the spacing.' },
    ],
  },
];

function SimpleModePreview() {
  const [simpleMode, setSimpleMode] = useState(true);
  return (
    <SessionChatPresentationProvider
      simpleMode={simpleMode}
      onSimpleModeChange={setSimpleMode}
      fileEditPreviews={false}
    >
      <div
        className='ghostex-session-chat-scope bg-background text-foreground'
        data-chat-theme='dark'
        style={{ minHeight: '100dvh' }}
      >
        <style>{`
          .simple-mode-preview-chats { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 400px), 1fr)); gap: 16px; padding: 16px; }
          .simple-mode-preview-chats [data-slot="message-scroller-content"] { width: 100%; max-width: 100%; }
        `}</style>
        <label className='flex items-center gap-3 border-b border-border px-4 py-3'>
          <Switch checked={simpleMode} onCheckedChange={setSimpleMode} aria-label='Simple mode for all chats' />
          <span>Simple mode (all chats)</span>
        </label>
        <div className='px-4 pt-3 text-sm text-muted-foreground'>
          Toggle here or in either chat’s More actions menu. Both chats update together.
        </div>
        <div className='simple-mode-preview-chats'>
          {[
            ['Tools without a message', TOOL_MESSAGES],
            ['File edits', EDIT_MESSAGES],
          ].map(([title, messages], index) => (
            <section
              key={index}
              className='flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border'
              style={{ height: 'max(340px, calc(100dvh - 144px))' }}
            >
              <div className='shrink-0 border-b border-border px-4 py-2 text-sm'>{title as string}</div>
              <SessionChatMessageList
                hasMore={false}
                isWorking
                loadingEarlier={false}
                messages={messages as SessionChatMessage[]}
                onLoadEarlier={() => undefined}
              />
              <div className='flex shrink-0 justify-end border-t border-border px-3 py-2'>
                <SessionChatComposerActions
                  sendBlocked={false}
                  hasSendableDraft={false}
                  maximized={false}
                  onToggleMaximized={() => undefined}
                  sessionNoteActive={false}
                  sessionNoteHasText={false}
                  stashedPromptCount={0}
                  summaryMode={false}
                  verboseMode={false}
                />
              </div>
            </section>
          ))}
        </div>
      </div>
    </SessionChatPresentationProvider>
  );
}

const meta = {
  title: 'Chat/Simple mode',
  component: SimpleModePreview,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof SimpleModePreview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const AllChats: Story = {};
