import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Button } from '@/packages/components/ui/button';
import { Textarea } from '@/packages/components/ui/textarea';
import type { SessionChatTerminalNotice } from '@/packages/shared/session-chat';
import { SessionChatTerminalNoticeCard } from './session-chat-terminal-notice-card';

function CodexLockPreview({
  external,
  theme,
  result,
}: {
  external: boolean;
  theme: 'light' | 'dark';
  result: 'success' | 'failure' | 'pending';
}) {
  const [draft, setDraft] = useState('Keep this draft while continuing here.');
  const [complete, setComplete] = useState(false);
  const [lastAction, setLastAction] = useState('No action yet.');
  const [version, setVersion] = useState(0);
  const notice: SessionChatTerminalNotice = {
    kind: 'codexInputBlocked',
    severity: 'warning',
    source: 'screen',
    title: 'Conversation open elsewhere',
    detectedAt: '2026-09-16T12:00:00Z',
    detail: external
      ? 'Close this conversation in the other app, then retry. Your draft stays here.'
      : 'Close 1 other Ghostex session using this conversation and continue here. This stops any work running in that session. Your draft stays here.',
    conversationLock: {
      conversationId: 'preview-conversation',
      sessions: external ? [] : [{ projectId: 'preview', sessionId: 'other' }],
    },
    actions: [
      { id: 'recoverCodexConversation', kind: 'recoverCodexConversation', label: external ? 'Retry' : 'Continue here' },
      { id: 'switchToTerminal', kind: 'switchToTerminal', label: 'Open terminal' },
    ],
    screenTail:
      '🔒 This conversation is open in another app\nClose it there and press R to continue here.\nr retry   esc/ctrl+c/q exit   ctrl+t transcript',
  };
  return (
    <div
      className={`ghostex-session-chat-scope ${theme} h-screen overflow-y-auto bg-background p-4 text-foreground [--radius:0.625rem]`}
      data-chat-theme={theme}
    >
      <div className='mx-auto grid w-full max-w-2xl gap-4 pb-4'>
        <p>Codex conversation recovery. Preview actions do not reach a session.</p>
        <SessionChatTerminalNoticeCard
          key={version}
          notice={complete ? null : notice}
          canSend
          onSendKeys={async () => {
            throw new Error('Unexpected raw input.');
          }}
          onAnswerDialog={async (answer) => {
            setLastAction(answer.kind);
            if (result === 'failure')
              throw new Error('The other session could not be closed. Your draft has not been sent.');
            if (result === 'pending') await new Promise<void>(() => {});
            setComplete(true);
          }}
          onFocusSession={async () => setLastAction('Go to other session')}
          onSwitchToTerminal={() => setLastAction('Open terminal')}
        />
        <Textarea aria-label='Message draft' value={draft} onChange={(event) => setDraft(event.target.value)} />
        <p role='status'>{complete ? 'Ready. Draft has not been sent.' : lastAction}</p>
        <Button
          variant='outline'
          onClick={() => {
            setVersion((value) => value + 1);
            setComplete(false);
            setLastAction('No action yet.');
          }}
        >
          Reset preview
        </Button>
      </div>
    </div>
  );
}

const meta = {
  title: 'Chat/Codex conversation lock',
  component: CodexLockPreview,
  parameters: { layout: 'fullscreen' },
  args: { external: false, theme: 'dark', result: 'success' },
} satisfies Meta<typeof CodexLockPreview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ContinueHere: Story = {};
export const Retry: Story = { args: { external: true } };
export const Light: Story = { args: { theme: 'light' } };
export const Failure: Story = { args: { result: 'failure' } };
export const Pending: Story = { args: { result: 'pending' } };
