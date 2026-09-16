import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ReactNode } from 'react';
import { SessionChatWorkingStrip } from './session-chat-working-strip';
import {
  ProposedApproval,
  ProposedDeliveryNotice,
  ProposedTasks,
  ProposedWorkingStrip,
  type ProposedLook,
  PROPOSED_TONES_CSS,
} from './session-chat-card-style-proposal';

/*
The open choices for the unified card style, each shown as lettered variants
of the same card so they can be compared directly and answered as "1B, 2A, …".
Story-only mockups; production components are untouched.
*/

function Choice({
  index,
  title,
  question,
  children,
}: {
  index: number;
  title: string;
  question: string;
  children: ReactNode;
}) {
  return (
    <section
      className='grid min-w-0 gap-4 rounded-xl border border-dashed border-border/70 p-4'
      data-style-choice={index}
    >
      <div className='grid gap-1'>
        <h3 className='text-sm font-semibold'>
          {index}. {title}
        </h3>
        <p className='text-xs text-muted-foreground'>{question}</p>
      </div>
      {children}
    </section>
  );
}

function Option({ letter, label, children }: { letter: string; label: string; children: ReactNode }) {
  return (
    <div className='grid min-w-0 gap-2 rounded-lg border border-border/40 p-3' data-style-option={letter}>
      <div className='flex items-center gap-2'>
        <span className='flex size-6 items-center justify-center rounded-md bg-foreground text-xs font-bold text-background'>
          {letter}
        </span>
        <span className='text-xs text-muted-foreground'>{label}</span>
      </div>
      <div className='grid min-w-0 gap-3'>{children}</div>
    </div>
  );
}

const HEADER_A: ProposedLook = { header: 'dot', dismiss: 'plain', roomy: false };
const HEADER_B: ProposedLook = { header: 'plain', dismiss: 'circle', roomy: true };
const HEADER_C: ProposedLook = { header: 'dot-medium', dismiss: 'circle', roomy: false };

function StyleOptions({ theme }: { theme: 'dark' | 'light' }) {
  const [lastAction, setLastAction] = useState<string | null>(null);
  const dismiss = (label: string) => () => setLastAction(`${label}: dismissed`);
  return (
    <div
      className={`ghostex-session-chat-scope ${theme} flex h-screen items-start justify-center overflow-y-auto bg-background p-6 text-foreground [--radius:0.625rem]`}
      data-chat-theme={theme}
      data-style-options
    >
      {/* Story-only: the roomy header pulls into the larger padding the same way
          the shared header rule pulls into the standard one. */}
      <style>{`
        ${PROPOSED_TONES_CSS}
        [data-style-options] .ghostex-chat-status-card-header-roomy {
          margin: -1rem -1.25rem;
          padding: 1rem 1.25rem;
          width: calc(100% + 2.5rem);
        }
        [data-style-options] .ghostex-chat-status-card-header-roomy[aria-expanded='true'] {
          margin-bottom: -0.125rem;
          padding-bottom: 0.5rem;
        }
      `}</style>
      <div className='flex w-full max-w-2xl flex-col gap-6'>
        <div className='grid gap-1'>
          <h2 className='text-base font-semibold'>Card style options</h2>
          <p className='text-sm text-muted-foreground'>
            Four choices, each shown on the same card. Answer with the letters, for example "1B, 2A, 3A, 4A".
          </p>
          <p role='status' className='text-xs text-muted-foreground'>
            {lastAction ? `${lastAction} (preview only).` : 'All actions stay in this preview.'}
          </p>
        </div>

        <Choice index={1} title='Header' question='Which header does every card get?'>
          <Option
            letter='A'
            label='Dot on the left, regular-weight title, bare X. The status card header as it is now.'
          >
            <ProposedApproval dismiss={dismiss('Approval A')} look={HEADER_A} />
            <ProposedDeliveryNotice dismiss={dismiss('Notice A')} look={HEADER_A} />
          </Option>
          <Option
            letter='B'
            label="No dot, medium-weight title, circled X, roomier padding. Today's approval card header."
          >
            <ProposedApproval dismiss={dismiss('Approval B')} look={HEADER_B} />
            <ProposedDeliveryNotice dismiss={dismiss('Notice B')} look={HEADER_B} />
          </Option>
          <Option
            letter='C'
            label='Dot on the left, medium-weight title, circled X, standard padding. A blend of A and B.'
          >
            <ProposedApproval dismiss={dismiss('Approval C')} look={HEADER_C} />
            <ProposedDeliveryNotice dismiss={dismiss('Notice C')} look={HEADER_C} />
          </Option>
        </Choice>

        <Choice
          index={2}
          title='Colours'
          question='Which colours does every card get, including Subagents and the pending tool card?'
        >
          <Option
            letter='A'
            label='Question card colours: card fill, input border, muted panel for header and body, bare footer band for actions.'
          >
            <ProposedDeliveryNotice dismiss={dismiss('Notice colours A')} look={{ ...HEADER_B, colors: 'card' }} />
            <ProposedTasks look={{ ...HEADER_B, colors: 'card' }} />
          </Option>
          <Option
            letter='B'
            label='Status card colours: muted fill on the page background, hairline border, actions inside the card with no footer band.'
          >
            <ProposedDeliveryNotice dismiss={dismiss('Notice colours B')} look={{ ...HEADER_B, colors: 'muted' }} />
            <ProposedTasks look={{ ...HEADER_B, colors: 'muted' }} />
          </Option>
        </Choice>

        <Choice
          index={3}
          title='Working strip'
          question='The "agent is working" line above the stack: does it become a card too?'
        >
          <Option letter='A' label='Stays a bare line, as today.'>
            <SessionChatWorkingStrip working activity={null} />
          </Option>
          <Option letter='B' label='Becomes a card like the others.'>
            <ProposedWorkingStrip look={{ ...HEADER_B, header: 'dot-medium' }} word='Forming' />
          </Option>
        </Choice>

        <Choice index={4} title='Task rows' question='How big are the rows inside the Tasks card?'>
          <Option letter='A' label='Same size as the Subagents rows (0.875rem).'>
            <ProposedTasks look={HEADER_B} rowSize='sm' />
          </Option>
          <Option letter='B' label="Today's larger task rows (1rem).">
            <ProposedTasks look={HEADER_B} rowSize='lg' />
          </Option>
        </Choice>
      </div>
    </div>
  );
}

const meta = {
  title: 'Chat/Card style options',
  component: StyleOptions,
  parameters: { layout: 'fullscreen' },
  args: { theme: 'dark' },
  argTypes: { theme: { control: 'inline-radio', options: ['dark', 'light'] } },
} satisfies Meta<typeof StyleOptions>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Dark: Story = {};
export const Light: Story = { args: { theme: 'light' } };
