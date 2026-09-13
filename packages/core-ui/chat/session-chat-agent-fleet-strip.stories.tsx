import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Switch } from '../../components/ui/switch';
import type { SessionChatAgentFleet, SessionChatQueuedPrompt } from '../../shared/session-chat';
import { SessionChatComposer } from './session-chat-composer';
import { SessionChatPresentationProvider } from './session-chat-presentation-provider';
import { moveSessionChatQueueRow } from './session-chat-queue';
import type { SessionChatQueueController } from './use-session-chat';

/*
CDXC:AgentScreenDetection 2026-08-23:
The sub-agent strip, mounted on the REAL composer with a REAL prompt
queue, because the thing worth looking at is the boundary between them:

  - the fleet strip is OUTSIDE the composer container — work the agent owns
  - the queue strip is INSIDE it — input the user still owns

Two containers, two weights, stacked in that order. A reader should be able to
tell at a glance which rows they can act on, and here they actually can: the
queue rows drag, edit, send-now and delete, and Tab in the input queues a
prompt, all against local state instead of a daemon.

Everything is local — no gxserver, no transport, no daemon. The queue
controller below is the same shape useSessionChat hands the composer, with
every capability on, so the strip renders every control a live session would.

This story uses the shared default Lexical input, just like desktop, web, and mobile.

The clocks tick for real: they interpolate from the fleet's `detectedAt`, a
fixed timestamp here, exactly as they do against a live daemon.
*/

const AT = new Date().toISOString();

/*
Realistic tasks, NOT pre-ellipsized ones. The CLI truncates to whatever its own
column allows and we can only ever show what it painted, but seeding the story
with an already-cut string hides how much room the row actually gives the task.
The last row keeps a terminal-truncated value on purpose, because that is what
a narrow agent pane really sends.
*/
const FLEET: SessionChatAgentFleet = {
  agents: [
    {
      elapsedSeconds: 756,
      name: 'general-purpose',
      model: 'claude-opus-5',
      effort: 'high',
      task: 'Fixing tool-row alignment in the transcript',
      tokens: '↓ 155.4k tokens',
    },
    {
      elapsedSeconds: 195,
      name: 'general-purpose',
      model: 'claude-opus-5',
      effort: 'high',
      nested: 1,
      task: 'Launching board_gxserver.rs split',
      tokens: '↓ 76.0k tokens',
    },
    // A shorter name and a shorter counter, so both shared columns are visibly
    // doing their job.
    {
      elapsedSeconds: 12,
      name: 'explore',
      model: 'claude-sonnet-4-6',
      effort: 'medium',
      task: 'Reviewing the diff…',
      tokens: '↑ 4.6k tokens',
    },
  ],
  detectedAt: AT,
};

function queued(id: string, text: string, extra: Partial<SessionChatQueuedPrompt> = {}): SessionChatQueuedPrompt {
  return { createdAt: AT, id, state: 'queued', text, updatedAt: AT, ...extra };
}

const QUEUE_SEED: SessionChatQueuedPrompt[] = [
  queued('1', 'When those land, run the release preflight.'),
  queued('2', 'Then summarise what changed in three bullets.'),
];

function SessionChatAgentFleetStripStory({
  agents,
  isWorking,
  paneWidth,
  queued: queuedCount,
  simpleMode: initialSimpleMode,
  theme,
}: {
  agents: number;
  isWorking: boolean;
  /** Chat-pane width in px. The strip drops columns as this shrinks. */
  paneWidth: number;
  queued: number;
  simpleMode: boolean;
  theme: 'dark' | 'light';
}) {
  const [prompts, setPrompts] = useState<SessionChatQueuedPrompt[]>(() => QUEUE_SEED.slice(0, queuedCount));
  const [sent, setSent] = useState<string[]>([]);
  const [simpleMode, setSimpleMode] = useState(initialSimpleMode);
  const [session, setSession] = useState('A');
  const [showFleet, setShowFleet] = useState(true);

  const fleet: SessionChatAgentFleet | null =
    !showFleet || agents === 0
      ? null
      : {
          ...FLEET,
          agents: Array.from({ length: agents }, (_, index) => ({
            ...FLEET.agents[index % FLEET.agents.length]!,
            id: `preview-agent-${index}`,
          })),
        };

  // The shape useSessionChat builds from a live daemon, with every capability
  // on so no control is hidden behind a missing endpoint.
  const queue: SessionChatQueueController = {
    capabilities: {
      canEdit: true,
      canQueue: true,
      canRemove: true,
      canReorder: true,
      canRetry: true,
      canSendNow: true,
      canSyncDraft: false,
      supported: true,
    },
    prompts,
    async queuePrompt(text) {
      setPrompts((current) => [...current, queued(`local-${current.length + 1}-${text.length}`, text)]);
    },
    async removePrompt(promptId) {
      const row = prompts.find((entry) => entry.id === promptId) ?? null;
      setPrompts((current) => current.filter((entry) => entry.id !== promptId));
      return row;
    },
    async reorder(promptIds) {
      setPrompts((current) => {
        let next = [...current];
        promptIds.forEach((id, target) => {
          const from = next.findIndex((entry) => entry.id === id);
          if (from >= 0) {
            next = moveSessionChatQueueRow(next, from, target);
          }
        });
        return next;
      });
    },
    async retryPrompt(promptId) {
      setPrompts((current) => current.map((entry) => (entry.id === promptId ? queued(entry.id, entry.text) : entry)));
    },
    async sendNow(promptId) {
      const row = prompts.find((entry) => entry.id === promptId);
      if (row) {
        setSent((current) => [...current, row.text]);
      }
      setPrompts((current) => current.filter((entry) => entry.id !== promptId));
    },
  };

  return (
    <SessionChatPresentationProvider
      simpleMode={simpleMode}
      onSimpleModeChange={setSimpleMode}
      fileEditPreviews={false}
    >
      <div
        className='ghostex-session-chat-scope flex flex-col gap-4 bg-background p-4 text-foreground'
        data-chat-theme={theme}
        style={{ minHeight: '100dvh' }}
      >
        <div
          className='mx-auto flex w-full flex-wrap items-center gap-3 text-sm'
          style={{ maxWidth: `${paneWidth}px` }}
        >
          <label className='flex items-center gap-2'>
            <Switch checked={simpleMode} onCheckedChange={setSimpleMode} aria-label='Simple mode' />
            Simple mode
          </label>
          <span>Chat {session}</span>
          <Button variant='outline' size='sm' onClick={() => setSession(session === 'A' ? 'B' : 'A')}>
            Switch to Chat {session === 'A' ? 'B' : 'A'}
          </Button>
          <Button variant='outline' size='sm' onClick={() => setShowFleet(!showFleet)}>
            {showFleet ? 'Hide subagents' : 'Show subagents'}
          </Button>
          <p className='w-full text-muted-foreground'>
            Click the Subagents header, switch chats, or reload. Each chat remembers your choice. Cards you have not
            toggled follow the mode's default.
          </p>
        </div>
        <div className='mx-auto mt-auto flex w-full flex-col gap-2' style={{ maxWidth: `${paneWidth}px` }}>
          {/* Standing in for the transcript, so a send has somewhere to land. */}
          {sent.length > 0 ? (
            <div className='text-xs text-muted-foreground'>Sent: {sent.map((text) => `“${text}”`).join(', ')}</div>
          ) : null}
          <SessionChatComposer
            key={session}
            agentFleet={fleet}
            isWorking={isWorking}
            onInterrupt={() => undefined}
            onSend={(text) => {
              setSent((current) => [...current, text]);
            }}
            queue={queue}
            sendOnEnter
            sessionKey={`story-agent-fleet-${initialSimpleMode ? 'simple' : 'regular'}:${session}`}
          />
        </div>
      </div>
    </SessionChatPresentationProvider>
  );
}

const meta = {
  args: { agents: 3, isWorking: true, paneWidth: 768, queued: 2, simpleMode: false, theme: 'dark' },
  argTypes: {
    agents: { control: { max: 7, min: 0, step: 1, type: 'range' } },
    paneWidth: { control: { max: 900, min: 220, step: 10, type: 'range' } },
    queued: { control: { max: 2, min: 0, step: 1, type: 'range' } },
    theme: { control: 'inline-radio', options: ['dark', 'light'] },
  },
  component: SessionChatAgentFleetStripStory,
  parameters: { layout: 'fullscreen' },
  title: 'Chat/Sub-agents strip',
} satisfies Meta<typeof SessionChatAgentFleetStripStory>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Three sub-agents over two queued prompts: both strips, in their own boxes. */
export const Dark: Story = { args: { theme: 'dark' } };

export const Light: Story = { args: { theme: 'light' } };

export const SimpleMode: Story = { args: { simpleMode: true, agents: 7 } };

/** A single sub-agent, no queue — the quietest the strip ever gets. */
export const OneAgent: Story = { args: { agents: 1, queued: 0 } };

/** No fleet: the strip renders NOTHING, leaving the composer where it was. */
export const NoFleet: Story = { args: { agents: 0 } };

/**
 * One queued row and nothing in flight: nothing to reorder, so no handle
 * column, so no empty gutter indenting the prompt away from the input text.
 * With two rows (the default story) the handles are back and the gutter is
 * theirs.
 */
export const SingleQueuedPrompt: Story = { args: { agents: 1, queued: 1 } };

/**
 * Narrow enough to have dropped the token counters, keeping the task, the name
 * and the clock. Drag `paneWidth` down from here to watch the clock go, then
 * the name — the task never does.
 */
export const NarrowPane: Story = { args: { paneWidth: 560, queued: 0 } };

/** Narrower still: task only, with the agent name on the task's tooltip. */
export const VeryNarrowPane: Story = { args: { paneWidth: 280, queued: 0 } };
