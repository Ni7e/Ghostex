import type { Meta, StoryObj } from '@storybook/react-vite';
import { useLayoutEffect, useState } from 'react';
import type { SessionChatTheme } from '@/packages/shared/session-chat';
import type { ContextDetailStatus, ContextDetailsAgent } from './session-chat-context-details-agents';
import { SessionChatContextDetailsDialog } from './session-chat-context-details-dialog';

const nowSeconds = Math.floor(Date.now() / 1000);

const sampleStatus: ContextDetailStatus = {
  version: '2.1.0',
  cost: { totalUsd: 3.34, durationMs: 4_440_000, apiDurationMs: 240_000, linesAdded: 0, linesRemoved: 0 },
  rateLimits: {
    fiveHour: { usedPercentage: 35, resetsAt: nowSeconds + 9_000 },
    sevenDay: { usedPercentage: 56, resetsAt: nowSeconds + 496_800 },
  },
  currentDir: '/Users/madda/dev/_active/Ghostex',
  totalOutputTokens: 215_000,
  contextUsedPercent: '42%',
  contextTokens: '84k/200k',
  modelName: 'claude-fable-5-1',
  effortName: 'high',
  lastRequest: { inputTokens: 28_300_000, outputTokens: 4_200, cacheReadTokens: 27_400_000 },
  promptCache: { warm: true, ttl: '1h', hitRatio: 0.968, requests: 412 },
};

function DialogPreview({ agent, theme }: { agent: ContextDetailsAgent; theme: SessionChatTheme }) {
  const [open, setOpen] = useState(true);
  useLayoutEffect(() => {
    document.body.dataset.sessionChatTheme = theme;
    return () => {
      delete document.body.dataset.sessionChatTheme;
    };
  }, [theme]);
  return (
    <div
      className='ghostex-session-chat-scope'
      data-chat-theme={theme}
      style={{ height: '100vh', background: theme === 'dark' ? '#08090c' : '#ffffff' }}
    >
      <button style={{ margin: 16 }} type='button' onClick={() => setOpen(true)}>
        Open Context details
      </button>
      <SessionChatContextDetailsDialog
        agent={agent}
        onOpenChange={setOpen}
        open={open}
        session={{
          title: 'Windows & wmx & Powershell',
          agentSessionId: '0d5b3d6e-1e2f-4d5f-9a2c-1f6a0e8d9b11',
          draft: false,
        }}
        status={sampleStatus}
        theme={theme}
      />
    </div>
  );
}

const meta = {
  title: 'Chat/Context Details Dialog',
  component: DialogPreview,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof DialogPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Resize the preview below 640px to see the narrow chat-pane layout. */
export const Light: Story = { args: { agent: 'claude', theme: 'light' } };
export const Dark: Story = { args: { agent: 'codex', theme: 'dark' } };
