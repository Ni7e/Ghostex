import { IconArrowRight, IconCheck, IconRefresh } from '@tabler/icons-react';
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
        {reset && <IconRefresh size={10} aria-hidden='true' />}
        {reset ?? '–'}
      </span>
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
  return (
    <div
      className={`gx-account-switch-account gx-account-switch-account-${target ? 'to' : 'from'}`}
      role='group'
      aria-label={`${text(label)} usage`}
    >
      <span className='gx-account-switch-account-role'>{role}</span>
      <div className='gx-account-switch-account-identity'>
        <span className='gx-account-switch-agent-mark' aria-hidden='true'>
          <span style={getBrandAgentLogoStyle(provider)} />
        </span>
        <div>
          <strong title={text(label)}>{text(label)}</strong>
        </div>
        {target && verified && <IconCheck size={15} className='gx-account-switch-verified' />}
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
      <div className='gx-account-switch-card-heading'>
        <div role='status' aria-live='polite'>
          <h2>{card.heading}</h2>
          <p>{card.lede}</p>
        </div>
      </div>
      <div className='gx-account-switch-account-route'>
        <Account account={card.from} provider={progress.provider} verified={card.verified} />
        <IconArrowRight size={17} className='gx-account-switch-route-arrow' aria-hidden='true' />
        <Account account={card.to} provider={progress.provider} verified={card.verified} />
      </div>
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
              <span className='gx-account-switch-step-marker' aria-hidden='true'>
                <span className='gx-account-switch-step-number'>{index + 1}</span>
              </span>
              <span className='gx-account-switch-step-copy'>
                <span className='gx-account-switch-step-label'>{label}</span>
                <span className='gx-account-switch-step-track' aria-hidden='true'>
                  {state === 'active' && <span className='gx-account-switch-step-motion' />}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
