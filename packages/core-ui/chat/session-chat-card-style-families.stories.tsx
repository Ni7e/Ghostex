import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ReactNode } from 'react';
import { FieldError } from '@/packages/components/ui/field';
import { SessionChatActivityRow } from './session-chat-activity-row';
import { SessionChatAgentFleetStrip } from './session-chat-agent-fleet-strip';
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
import {
  PROPOSED_PANEL_BACKGROUND,
  PROPOSED_TONES_CSS,
  ProposedApproval,
  ProposedComposerNotReady,
  ProposedDeliveryNotice,
  ProposedDetectedNotice,
  ProposedDraftNotice,
  ProposedExtensionPanel,
  ProposedQuestion,
  ProposedTasks,
  ProposedTerminalMenu,
} from './session-chat-card-style-proposal';
import { SessionChatComposerNotReadyNotice } from './session-chat-composer-not-ready';
import { SessionChatDraftConflict } from './session-chat-draft-conflict';
import { SessionChatExtensionPanel } from './session-chat-extension-panel';
import { SessionChatInteractiveCard } from './session-chat-interactive-card';
import { SessionChatStartupSendStatus } from './session-chat-startup-send-status';
import { SessionChatStatusLine } from './session-chat-status-line';
import { SessionChatTerminalNoticeCard } from './session-chat-terminal-notice-card';
import { SessionChatTerminalToolRow } from './session-chat-terminal-tool-row';
import { SessionChatWorkingStrip } from './session-chat-working-strip';

/*
Two representatives per style family drawn above the composer, so one family
can be picked as the basis for all of them without scrolling the full gallery.
Families 5 and 6 have a single member each. The full membership is the
"Style families above the composer" section of Chat/Card gallery.
*/

const AT = new Date().toISOString();

const TASKS = {
  tasks: [
    { id: '1', subject: 'Inventory card layouts', status: 'completed' as const },
    { id: '2', subject: 'Review the gallery', activeForm: 'Reviewing the gallery', status: 'in_progress' as const },
    { id: '3', subject: 'Unify the styles', status: 'pending' as const, blockedBy: ['2'] },
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

function StyleFamiliesPreview({ theme }: { theme: 'dark' | 'light' }) {
  const [lastAction, setLastAction] = useState<string | null>(null);
  const act = async (label: string) => setLastAction(label);
  return (
    <div
      className={`ghostex-session-chat-scope ${theme} flex h-screen items-start justify-center overflow-y-auto bg-background p-6 text-foreground [--radius:0.625rem]`}
      data-chat-theme={theme}
    >
      <div className='flex w-full max-w-2xl flex-col gap-6'>
        <div className='grid gap-1'>
          <h2 className='text-base font-semibold'>Composer card style families</h2>
          <p className='text-sm text-muted-foreground'>
            Two representatives per family. Pick the family to keep; the others get changed to match.
          </p>
          <p role='status' className='text-xs text-muted-foreground'>
            {lastAction ? `${lastAction} (preview only).` : 'All actions stay in this preview.'}
          </p>
        </div>
        <Family
          index={1}
          title='Status card'
          spec='0.75rem radius, hairline border at 65%, muted fill at 20%, 1rem/0.75rem padding, 0.875rem text at a relaxed line height. Dot on the left in a 1lh box, chevron on the right.'
        >
          <Example label='Pending tool card'>
            <SessionChatTerminalToolRow activity={PENDING_TOOL_ACTIVITY} />
          </Example>
          <Example label='Subagents'>
            <SessionChatAgentFleetStrip fleet={SUBAGENTS_FLEET} sessionKey='style-families-subagents' />
          </Example>
        </Family>
        <Family
          index={2}
          title='Panel with a header bar'
          spec='Card fill with an input border, 1rem radius (0.625rem for the extension panel). Full-width header bar with an icon and a small bold title on the left, icon buttons or a chevron on the right, body under a divider.'
        >
          <Example label='Tasks'>
            <SessionChatAgentTasksPanel tasks={TASKS} />
          </Example>
          <Example label='Chat extension panel'>
            <SessionChatExtensionPanel
              activeExtensionId='session-scratchpad'
              extensions={EXTENSIONS}
              minimized
              onActiveExtensionChange={() => undefined}
              onBridgeRequest={async () => null}
              onClose={() => setLastAction('Extension panel: closed')}
              onMinimizedChange={() => setLastAction('Extension panel: toggled')}
            />
          </Example>
        </Family>
        <Family
          index={3}
          title='Notice card'
          spec='1rem radius with a severity-tinted border and fill, 0.75rem/0.625rem padding. 0.875rem weight-500 title with no dot, a dismiss X on the right, detail text under the title, actions as outlined buttons.'
        >
          <Example label='Composer not ready'>
            <SessionChatComposerNotReadyNotice
              reason='The agent is waiting for setup to finish.'
              onOpenTerminal={() => setLastAction('Open terminal')}
            />
          </Example>
          <Example label='Delivery notice'>
            <SessionChatTerminalNoticeCard
              notice={DELIVERY_NOTICES[2]!}
              canSend
              onSendKeys={async () => act('Delivery notice: send keys')}
              onAnswerChoice={async (index) => act(`Delivery notice: option ${index + 1}`)}
              onAnswerDialog={async () => act('Delivery notice: dialog')}
              onSwitchToTerminal={() => setLastAction('Open terminal')}
            />
          </Example>
        </Family>
        <Family
          index={4}
          title='Question card'
          spec='Composer-like shell: 1.5rem radius, input border, card fill. Title row with the tool or question header, option rows or an answer field below, primary and outlined buttons at the bottom.'
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
        <Family
          index={5}
          title='Compact bar'
          spec='0.75rem radius, plain border, 5% foreground fill, 0.3125rem/0.625rem padding, 0.75rem muted text. Icon on the left, inline text buttons on the right. Single member.'
        >
          <Example label='Saved draft notice'>
            <SessionChatDraftConflict
              draft={{ content: 'A draft saved from another device.', originClientId: 'story', updatedAt: AT }}
              onDismiss={() => setLastAction('Saved draft: dismissed')}
              onUse={() => setLastAction('Saved draft: used')}
            />
          </Example>
        </Family>
        <Family
          index={6}
          title='Bare line'
          spec='No shell at all: the spark and a 0.78125rem muted word with 0.375rem side padding, pinned above every card. Single member; the compaction row below is what replaces it while an activity runs.'
        >
          <Example label='Working strip'>
            <SessionChatWorkingStrip working activity={null} />
          </Example>
          <Example label='Working strip while compacting (renders the family 1 activity card)'>
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
        </Family>
      </div>
    </div>
  );
}

/*
The same members, each shown as it is today and directly beneath it rebuilt in
the family 1 style (story-only mockups from session-chat-card-style-proposal.tsx).
Production components are untouched until the board is approved.
*/
function Pair({ label, current, proposed }: { label: string; current: ReactNode; proposed: ReactNode }) {
  return (
    <div className='grid min-w-0 gap-3 rounded-lg border border-border/40 p-3' data-proposal-pair={label}>
      <Example label={`${label}: today`}>{current}</Example>
      <Example label={`${label}: proposed (family 1)`}>{proposed}</Example>
    </div>
  );
}

function StyleFamiliesProposal({ theme }: { theme: 'dark' | 'light' }) {
  const [lastAction, setLastAction] = useState<string | null>(null);
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
      <div className='flex w-full max-w-2xl flex-col gap-6' data-proposal-colors>
        {/* Story-only: show the shipped family 1 cards in the proposed colours
            without touching them. */}
        <style>{`
          ${PROPOSED_TONES_CSS}
          [data-proposal-colors] .ghostex-chat-agent-fleet,
          [data-proposal-colors] .ghostex-chat-terminal-tool-card {
            background: ${PROPOSED_PANEL_BACKGROUND};
            border-color: var(--input);
          }
        `}</style>
        <div className='grid gap-1'>
          <h2 className='text-base font-semibold'>Proposal: every card in the family 1 style</h2>
          <p className='text-sm text-muted-foreground'>
            Each member as it is today, then the same card rebuilt as a status card: two tones (a panel for the header
            and body, a band under a hairline for the actions, both a little lighter and greyer than the page in dark
            mode and a little darker in light mode), an input border, 0.75rem radius, 1rem/0.75rem padding, 0.875rem
            text. Each card leads with its own icon; only working status keeps the blinking dot. Medium-weight title,
            circled X, edge-to-edge header hover, animated body, 12px between body blocks. A card with a coloured border
            is one tone.
          </p>
          <p role='status' className='text-xs text-muted-foreground'>
            {lastAction ? `${lastAction} (preview only).` : 'All actions stay in this preview.'}
          </p>
        </div>
        <Family
          index={1}
          title='Status card'
          spec='The basis, shown here in the proposed colours. Today they use a 20% muted fill on the page background with a 65% border.'
        >
          <Example label='Pending tool card'>
            <SessionChatTerminalToolRow activity={PENDING_TOOL_ACTIVITY} />
          </Example>
          <Example label='Subagents'>
            <SessionChatAgentFleetStrip fleet={SUBAGENTS_FLEET} sessionKey='style-proposal-subagents' />
          </Example>
        </Family>
        <Family
          index={2}
          title='Panel with a header bar'
          spec='Becomes a status card. Keeps its list icon; the count reads as words, the progress bar stays as a small trailing element, rows are the Subagents row size. Completed tasks fold behind a text line under a hairline.'
        >
          <Pair label='Tasks' current={<SessionChatAgentTasksPanel tasks={TASKS} />} proposed={<ProposedTasks />} />
          <Pair
            label='Chat extension panel'
            current={
              <SessionChatExtensionPanel
                activeExtensionId='session-scratchpad'
                extensions={EXTENSIONS}
                minimized
                onActiveExtensionChange={() => undefined}
                onBridgeRequest={async () => null}
                onClose={() => setLastAction('Extension panel: closed')}
                onMinimizedChange={() => setLastAction('Extension panel: toggled')}
              />
            }
            proposed={<ProposedExtensionPanel onClose={() => setLastAction('Extension panel: closed')} />}
          />
        </Family>
        <Family
          index={3}
          title='Notice card'
          spec='Becomes a status card. Severity is the leading icon (info circle, warning triangle, red alert circle) plus a red border for errors, and a red-bordered card is one tone. Circled X on the right. Actions move to the footer band, right-aligned; a keyed action stays on the left.'
        >
          <Pair
            label='Composer not ready'
            current={
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
            }
            proposed={<ProposedComposerNotReady />}
          />
          <Pair
            label='Delivery notice'
            current={<SessionChatTerminalNoticeCard notice={DELIVERY_NOTICES[2]!} {...noticeProps} />}
            proposed={<ProposedDeliveryNotice dismiss={() => setLastAction('Delivery notice: dismissed')} />}
          />
          <Pair
            label='Detected notice with actions'
            current={<SessionChatTerminalNoticeCard notice={detected} {...noticeProps} />}
            proposed={<ProposedDetectedNotice dismiss={() => setLastAction('Detected notice: dismissed')} />}
          />
          <Pair
            label='Terminal menu'
            current={<SessionChatTerminalNoticeCard notice={DIALOG_EXAMPLES[0]!} {...noticeProps} />}
            proposed={<ProposedTerminalMenu />}
          />
        </Family>
        <Family
          index={4}
          title='Question card'
          spec='Becomes a status card with a shield or question icon. The tool name and the question counter sit right-aligned on the first body row; the uppercase header goes. Options stay rows in the panel; Deny and Allow, or the custom answer and Send, sit in the footer band as today.'
        >
          <Pair
            label='Command approval'
            current={
              <SessionChatInteractiveCard
                prompt={APPROVAL}
                canSend
                onAnswer={async () => act('Command approval')}
                onInterrupt={() => setLastAction('Command approval: dismissed')}
                onSwitchToTerminal={() => setLastAction('Open terminal')}
              />
            }
            proposed={<ProposedApproval dismiss={() => setLastAction('Command approval: dismissed')} />}
          />
          <Pair
            label='Single-choice question'
            current={
              <SessionChatInteractiveCard
                prompt={{ kind: 'question', questions: [QUESTION] }}
                canSend
                onAnswer={async () => act('Question')}
                onInterrupt={() => setLastAction('Question: dismissed')}
                onSwitchToTerminal={() => setLastAction('Open terminal')}
              />
            }
            proposed={<ProposedQuestion dismiss={() => setLastAction('Question: dismissed')} />}
          />
        </Family>
        <Family
          index={5}
          title='Compact bars'
          spec='Every one-line bar around the composer. The saved-draft bar keeps its size (0.75rem text, 0.3125rem/0.625rem padding) and only takes the family colours, icon and title weight. The plain text lines under it are shown as they are today, for the record.'
        >
          <Pair
            label='Saved draft notice'
            current={
              <SessionChatDraftConflict
                draft={{ content: 'A draft saved from another device.', originClientId: 'story', updatedAt: AT }}
                onDismiss={() => setLastAction('Saved draft: dismissed')}
                onUse={() => setLastAction('Saved draft: used')}
              />
            }
            proposed={
              <ProposedDraftNotice
                onDismiss={() => setLastAction('Saved draft: dismissed')}
                onUse={() => setLastAction('Saved draft: used')}
              />
            }
          />
          <Example label='Send error line (above the composer, today)'>
            <FieldError className='px-2'>Connection interrupted. Your draft is kept.</FieldError>
          </Example>
          <Example label='Save status line (above the composer, today)'>
            <div className='px-2 text-xs text-muted-foreground' role='status'>
              Draft saved
            </div>
          </Example>
          <Example label='Startup send status (transcript tail, today)'>
            <SessionChatStartupSendStatus
              delivery={{ promptId: 'p1', state: 'failed', errorMessage: 'Message could not be delivered.' }}
              onRetryStartupSend={async () => setLastAction('Startup send: retry')}
              onRemoveStartupSend={async () => setLastAction('Startup send: remove')}
            />
          </Example>
          <Example label='Status line under the composer (today)'>
            <SessionChatStatusLine
              hasConfiguredItems
              items={[
                { id: 'sessionName', label: 'Session', value: 'Ghostex release operator revamp' },
                { id: 'costUsd', label: 'Cost', value: 'Fable: 41%' },
                { id: 'sessionTime', label: 'Session time', value: '5h: 18%' },
                { id: 'apiTime', label: 'API time', value: '7d: 23%' },
                { id: 'repo', label: 'Repository', value: 'maddada/Ghostex' },
              ]}
            />
          </Example>
        </Family>
        <Family index={6} title='Bare line' spec='Stays exactly as it is: a bare line above the cards, never a card.'>
          <Example label='Working strip'>
            <SessionChatWorkingStrip working activity={null} />
          </Example>
        </Family>
      </div>
    </div>
  );
}

const meta = {
  title: 'Chat/Card style families',
  component: StyleFamiliesPreview,
  parameters: { layout: 'fullscreen' },
  args: { theme: 'dark' },
  argTypes: { theme: { control: 'inline-radio', options: ['dark', 'light'] } },
} satisfies Meta<typeof StyleFamiliesPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Dark: Story = {};
export const Light: Story = { args: { theme: 'light' } };
export const Proposed: Story = { render: (args) => <StyleFamiliesProposal theme={args.theme} /> };
export const ProposedLight: Story = {
  args: { theme: 'light' },
  render: (args) => <StyleFamiliesProposal theme={args.theme} />,
};
