import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { SessionChatActivityRow } from './session-chat-activity-row';
import { SessionChatAgentFleetStrip } from './session-chat-agent-fleet-strip';
import { SessionChatAgentMessageCard } from './session-chat-agent-message-card';
import { SessionChatAgentTasksPanel } from './session-chat-agent-tasks-panel';
import {
  APPROVAL,
  DELIVERY_NOTICES,
  Example,
  Family,
  PENDING_TOOL_ACTIVITY,
  QUESTION,
  SUBAGENTS_FLEET,
} from './session-chat-card-gallery';
import { DIALOG_EXAMPLES } from './session-chat-card-gallery-dialogs';
import { DETECTED_NOTICE_EXAMPLES } from './session-chat-card-gallery-notices';
import { SessionChatComposerNotReadyNotice } from './session-chat-composer-not-ready';
import { SessionChatDraftConflict } from './session-chat-draft-conflict';
import { SessionChatExtensionPanel } from './session-chat-extension-panel';
import { SessionChatGoalCard } from './session-chat-goal-card';
import { SessionChatInteractiveCard } from './session-chat-interactive-card';
import { SessionChatTerminalNoticeCard } from './session-chat-terminal-notice-card';
import { SessionChatTerminalToolRow } from './session-chat-terminal-tool-row';
import { SessionChatWorkingStrip } from './session-chat-working-strip';

/*
Every card above the composer, and the status cards in the transcript, on the
one shared shell (session-chat-status-card.tsx). Grouped by what the card is
for, so a change to the shell can be checked against every member on one page.
The working strip is shown last because it deliberately stays a bare line.
*/

const AT = new Date().toISOString();

const TASKS = {
  tasks: [
    { id: '1', subject: 'Inventory card layouts', status: 'completed' as const },
    { id: '2', subject: 'Collect examples', status: 'completed' as const },
    { id: '3', subject: 'Review the gallery', activeForm: 'Reviewing the gallery', status: 'in_progress' as const },
    { id: '4', subject: 'Unify the styles', status: 'pending' as const, blockedBy: ['3'] },
  ],
};

const EXTENSIONS = [
  {
    id: 'session-scratchpad',
    title: 'Session Scratchpad',
    iconUrl: '',
    url: 'https://session-scratchpad.example.invalid/',
  },
];

function StatusCardsPreview({ theme }: { theme: 'dark' | 'light' }) {
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(true);
  const act = async (label: string) => setLastAction(label);
  const noticeProps = {
    canSend: true,
    onSendKeys: async () => act('send keys'),
    onAnswerChoice: async (index: number) => act(`option ${index + 1}`),
    onAnswerDialog: async () => act('dialog'),
    onSwitchToTerminal: () => setLastAction('Open terminal'),
  };
  const detected = DETECTED_NOTICE_EXAMPLES.find(
    ({ notice }) => notice.title === 'Claude Code is waiting to continue'
  )!.notice;
  return (
    <div
      className={`ghostex-session-chat-scope ${theme} flex h-screen items-start justify-center overflow-y-auto bg-background p-6 text-foreground [--radius:0.625rem]`}
      data-chat-theme={theme}
    >
      <div className='flex w-full max-w-2xl flex-col gap-6'>
        <div className='grid gap-1'>
          <h2 className='text-base font-semibold'>Status cards</h2>
          <p className='text-sm text-muted-foreground'>
            Every card on the shared shell. Click a header to fold it, hover to see the edge-to-edge fill.
          </p>
          <p role='status' className='text-xs text-muted-foreground'>
            {lastAction ? `${lastAction} (preview only).` : 'All actions stay in this preview.'}
          </p>
        </div>
        <Family
          index={1}
          title='Working status'
          spec='The blinking dot is reserved for these: something is running right now.'
        >
          <Example label='Pending tool card'>
            <SessionChatTerminalToolRow activity={PENDING_TOOL_ACTIVITY} />
          </Example>
          <Example label='Compaction progress'>
            <SessionChatActivityRow
              activity={{
                kind: 'compacting',
                label: 'Compacting conversation',
                detectedAt: AT,
                percent: 49,
                elapsedSeconds: 60,
              }}
            />
          </Example>
          <Example label='Background monitors'>
            <SessionChatActivityRow
              activity={{ kind: 'shells-running', label: '2 monitors still running', detectedAt: AT }}
            />
          </Example>
        </Family>
        <Family index={2} title='Agent state' spec='Foldable cards with an icon: the header toggles the animated body.'>
          <Example label='Subagents'>
            <SessionChatAgentFleetStrip fleet={SUBAGENTS_FLEET} sessionKey='status-cards-subagents' />
          </Example>
          <Example label='Tasks'>
            <SessionChatAgentTasksPanel tasks={TASKS} />
          </Example>
          <Example label='Chat extension panel'>
            <SessionChatExtensionPanel
              activeExtensionId='session-scratchpad'
              extensions={EXTENSIONS}
              minimized={minimized}
              onActiveExtensionChange={() => undefined}
              onBridgeRequest={async () => null}
              onClose={() => setLastAction('Extension panel: closed')}
              onMinimizedChange={setMinimized}
            />
          </Example>
        </Family>
        <Family index={3} title='Transcript status' spec='Open cards whose chevron swaps a preview for the full text.'>
          <Example label='Codex goal'>
            <SessionChatGoalCard
              objective='Unify the composer cards so every header shares one shape, then report which cards still differ. Keep each component responsible for its own state and let the shell own the look.'
              status='active'
              usage='12% of budget'
            />
          </Example>
          <Example label='Received agent message'>
            <SessionChatAgentMessageCard
              body='The card gallery now lists every composer card on the shared shell. Each component kept its own state and only lost its bespoke shell markup, so the next retune is one CSS edit.'
              sender='/root/windows_support'
            />
          </Example>
        </Family>
        <Family
          index={4}
          title='Notices'
          spec='Severity is the leading icon; an error keeps a red border and is one tone. Actions sit in the footer band.'
        >
          <Example label='Composer not ready'>
            <SessionChatComposerNotReadyNotice
              reason='The agent is waiting for setup to finish.'
              onOpenTerminal={() => setLastAction('Open terminal')}
              onReadTerminalTail={async () => ({
                agentId: 'codex',
                projectId: 'P1gallery',
                sessionId: 'G1preview',
                captured: true,
                composerState: 'notReady',
                reason: 'Setup is waiting for input.',
                lines: ['Setup is waiting for input.'],
              })}
            />
          </Example>
          <Example label='Delivery notice'>
            <SessionChatTerminalNoticeCard notice={DELIVERY_NOTICES[2]!} {...noticeProps} />
          </Example>
          <Example label='Detected notice with a keyed action'>
            <SessionChatTerminalNoticeCard notice={detected} {...noticeProps} />
          </Example>
          <Example label='Picker'>
            <SessionChatTerminalNoticeCard notice={DIALOG_EXAMPLES[0]!} {...noticeProps} />
          </Example>
        </Family>
        <Family
          index={5}
          title='Questions'
          spec='The tool name or question counter sits right-aligned on the first body row; the answer controls sit in the footer.'
        >
          <Example label='Command approval'>
            <SessionChatInteractiveCard
              prompt={APPROVAL}
              canSend
              onAnswer={async () => act('Command approval')}
              onInterrupt={() => setLastAction('Command approval: dismissed')}
              onSwitchToTerminal={() => setLastAction('Open terminal')}
            />
          </Example>
          <Example label='Single-choice question'>
            <SessionChatInteractiveCard
              prompt={{ kind: 'question', questions: [QUESTION] }}
              canSend
              onAnswer={async () => act('Question')}
              onInterrupt={() => setLastAction('Question: dismissed')}
              onSwitchToTerminal={() => setLastAction('Open terminal')}
            />
          </Example>
        </Family>
        <Family index={6} title='Compact bar' spec='The saved-draft size on the same shell.'>
          <Example label='Saved draft notice'>
            <SessionChatDraftConflict
              draft={{ content: 'A draft saved from another device.', originClientId: 'story', updatedAt: AT }}
              onDismiss={() => setLastAction('Saved draft: dismissed')}
              onUse={() => setLastAction('Saved draft: used')}
            />
          </Example>
        </Family>
        <Family index={7} title='Bare line' spec='Not a card, on purpose.'>
          <Example label='Working strip'>
            <SessionChatWorkingStrip working activity={null} />
          </Example>
        </Family>
      </div>
    </div>
  );
}

const meta = {
  title: 'Chat/Status cards',
  component: StatusCardsPreview,
  parameters: { layout: 'fullscreen' },
  args: { theme: 'dark' },
  argTypes: { theme: { control: 'inline-radio', options: ['dark', 'light'] } },
} satisfies Meta<typeof StatusCardsPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Dark: Story = {};
export const Light: Story = { args: { theme: 'light' } };
