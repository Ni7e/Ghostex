import { IconCheck, IconRefresh } from '@tabler/icons-react';
import { Button } from '@/packages/components/ui/button';
import type { AccountSwitchProgress, AgentAccount } from '@/packages/shared/agent-accounts';
import {
  accountSwitchCardPresentation,
  type AccountSwitchCardAccount,
  type AccountSwitchUsageCard,
} from '@/packages/shared/session-chat-presentation/accounts';
import { getBrandAgentLogoStyle } from '../agent-logos';
import { useAccountText } from './account-text';
import './account-switch-card.css';

function UsageCard({ usage: { label, used, level, reset } }: { usage: AccountSwitchUsageCard }) {
  return (
    <div
      className='gx-account-switch-usage-card'
      data-level={level}
      role={used === undefined ? undefined : 'meter'}
      aria-label={label}
      aria-valuenow={used}
      aria-valuemin={used === undefined ? undefined : 0}
      aria-valuemax={used === undefined ? undefined : 100}
      aria-valuetext={used === undefined ? undefined : `${Math.round(used)}%${reset ? `. Resets in ${reset}` : ''}`}
    >
      <span className='gx-account-switch-usage-label'>{label}</span>
      <strong className='gx-account-switch-usage-value'>
        {used === undefined ? '–' : Math.round(used)}
        {used !== undefined && <small>%</small>}
      </strong>
      <span className='gx-account-switch-usage-reset' title={reset ? `Resets in ${reset}` : 'Reset time unavailable'}>
        {reset ?? '–'}
      </span>
      {used !== undefined && (
        <span className='gx-account-switch-usage-bar' style={{ width: `${used}%` }} aria-hidden='true' />
      )}
    </div>
  );
}

function Account({
  account: { label, role, target, usage },
  provider,
  verified,
}: {
  account: AccountSwitchCardAccount;
  provider: AccountSwitchProgress['provider'];
  verified: boolean;
}) {
  const text = useAccountText();
  const shortRole = target ? (verified ? 'Active' : 'To') : verified ? 'Previous' : 'From';
  return (
    <div
      className={`gx-account-switch-account gx-account-switch-account-${target ? 'to' : 'from'}`}
      role='group'
      aria-label={`${role}: ${text(label)}`}
    >
      <div className='gx-account-switch-account-identity'>
        <span className='gx-account-switch-agent-mark' aria-hidden='true'>
          <span style={getBrandAgentLogoStyle(provider)} />
        </span>
        <span className='gx-account-switch-account-role'>{shortRole}</span>
        <strong className='gx-account-switch-account-email' title={text(label)}>
          {text(label)}
        </strong>
        {target && verified && <IconCheck size={13} className='gx-account-switch-verified' aria-hidden='true' />}
      </div>
      <div className='gx-account-switch-usage-cards'>
        {usage.map((card) => (
          <UsageCard key={card.label} usage={card} />
        ))}
      </div>
    </div>
  );
}

/** Renders accountSwitchCardPresentation (packages/shared/session-chat-presentation/accounts.ts), which owns the card's copy, steps and usage levels. */
export function AccountSwitchCard({
  progress,
  accounts,
  onRetry,
  retrying = false,
  ready = true,
  now = Date.now(),
}: {
  progress: AccountSwitchProgress;
  accounts: readonly AgentAccount[];
  onRetry?: () => void;
  retrying?: boolean;
  ready?: boolean;
  now?: number;
}) {
  const text = useAccountText();
  const card = accountSwitchCardPresentation(progress, accounts, ready, now);
  if (!card) return null;
  return (
    <section className='gx-account-switch-card' data-phase={card.phase} aria-label='Account switch status'>
      <div className='gx-account-switch-card-heading' role='status' aria-live='polite'>
        <h2>{card.heading}</h2>
        <p>{card.lede}</p>
      </div>
      <Account account={card.from} provider={progress.provider} verified={card.verified} />
      <Account account={card.to} provider={progress.provider} verified={card.verified} />
      {card.steps === null ? (
        <div className='gx-account-switch-failure-detail' role='alert'>
          <p>{text(card.failure ?? '')}</p>
          {onRetry && (
            <div className='gx-account-switch-failure-actions'>
              <Button size='sm' variant='outline' disabled={retrying} onClick={onRetry}>
                <IconRefresh />
                Retry switch
              </Button>
            </div>
          )}
        </div>
      ) : (
        <ol className='gx-account-switch-progress' aria-label='Switch progress'>
          {card.steps.map(({ label, state }, index) => (
            <li
              key={label}
              className='gx-account-switch-step'
              data-state={state}
              aria-current={state === 'active' ? 'step' : undefined}
              aria-label={`Step ${index + 1}: ${label}, ${state === 'done' ? 'complete' : state === 'active' ? 'in progress' : 'pending'}`}
            >
              <span className='gx-account-switch-step-number' aria-hidden='true'>
                {state === 'done' ? <IconCheck size={10} /> : index + 1}
              </span>
              <span className='gx-account-switch-step-label'>{label}</span>
              {state === 'active' && <span className='gx-account-switch-step-motion' aria-hidden='true' />}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
