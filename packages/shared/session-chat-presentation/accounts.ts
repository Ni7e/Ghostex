import type { AccountPolicy, AccountSwitchProgress, AccountUsageWindow, AgentAccount } from '../agent-accounts';
import { accountHeadlineWindows, fableWindow, isFiveHourWindow, isWeeklyWindow } from '../account-usage-windows';
import { formatResetCountdown } from '../reset-countdown';

/*
Account copy and figures shared by the React account panel and switch card
(packages/core-ui/accounts/) and their GPUI chat ports
(apps/desktop/src/app/native_chat/option_menu/accounts.rs, account_switch_card.rs).
Labels are returned unmasked; each renderer applies Hide emails itself.
*/

/** One of the two small figures stacked beside an account's logo. */
export interface AccountFigure {
  label?: string;
  value: string;
}

/**
 * CDXC:AgentProviders 2026-09-08 DECISION:
 * User: Codex account badges show the five-hour percentage on the second line when that limit exists; otherwise show available resets as "2rs" or "0rs".
 * Use the main account windows so Spark's separate five-hour limit does not stand in for an absent account limit.
 * Claude figures are the two tightest of weekly, five-hour, and Fable (see accountHeadlineWindows).
 */
export function accountFigureWindows(
  account: AgentAccount
): [AccountUsageWindow | undefined, AccountUsageWindow | undefined] {
  const [first, second] = accountHeadlineWindows(account);
  return [first, second];
}

export function accountFigures(account: AgentAccount): [AccountFigure, AccountFigure] {
  const [first, second] = accountFigureWindows(account);
  return [
    { label: first?.label, value: first ? `${Math.round(first.usedPercent)}%` : '·' },
    second
      ? { label: second.label, value: `${Math.round(second.usedPercent)}%` }
      : account.provider === 'codex' && account.resetCredits != null
        ? { label: 'Available usage resets', value: `${account.resetCredits}rs` }
        : { label: undefined, value: '·' },
  ];
}

export function accountResetLabel(value: string | undefined, now = Date.now()): string {
  if (!value) return 'Reset time unavailable';
  const time = new Date(value);
  if (!Number.isFinite(time.getTime())) return 'Reset time unavailable';
  const remainingMs = time.getTime() - now;
  return remainingMs > 0 ? `Resets ${formatResetCountdown(remainingMs)}` : 'Reset due';
}

/** One "Resets 2h 14m · 3d 6h" line for several limits, in the order given, skipping limits without a reset time. */
export function accountResetsLine(windows: AccountUsageWindow[], now = Date.now()): string {
  const remaining = windows
    .map((window) => (window.resetsAt ? new Date(window.resetsAt).getTime() - now : Number.NaN))
    .filter((ms) => Number.isFinite(ms));
  if (remaining.length === 0) return 'Reset time unavailable';
  return `Resets ${remaining.map((ms) => (ms > 0 ? formatResetCountdown(ms) : 'due')).join(' · ')}`;
}

/**
 * CDXC:AgentProviders 2026-09-11 DECISION:
 * User: the chat panel must not print an account's email twice. The account name is the email whenever the login helper has no alias, so the second line of a Switch account row is the email only when the account has a name of its own; otherwise it shows the reset countdowns of the two limits in the badge, in the same order. A usage error takes the line instead, as in Settings. The current-account block above drops the line because the usage bars beneath it already show each reset.
 */
export function switchAccountRowDetail(account: AgentAccount, now = Date.now()): string | null {
  if (account.usageError) return account.usageError;
  if (account.email && account.email !== account.name) return account.email;
  const windows = accountFigureWindows(account).filter((window) => window !== undefined);
  return windows.length ? accountResetsLine(windows, now) : null;
}

export function sessionAccountPolicySummary(session: {
  policy: AccountPolicy;
  override: AccountPolicy | null;
}): string {
  return session.override
    ? 'Custom settings · This session only'
    : `Session defaults · ${session.policy.enabled ? (session.policy.atLimit === 'wait' ? 'Wait for reset' : 'Switch when eligible') : 'Automatic continuation off'}`;
}

export const ACCOUNT_POLICY_PRIORITY_OPTIONS: { value: AccountPolicy['priority']; label: string }[] = [
  { value: 'leastUsed', label: 'Lowest usage first' },
  { value: 'mostUsed', label: 'Highest usage first' },
  { value: 'soonestReset', label: 'Earliest reset first' },
  { value: 'latestReset', label: 'Latest reset first' },
];

export function accountPolicyAtLimitDescription(policy: AccountPolicy): string {
  return policy.atLimit === 'wait'
    ? 'Pick up on this account when its usage resets.'
    : 'Use another eligible login for this model. Wait when every account is at its limit.';
}

export const ACCOUNT_POLICY_RETRY_DESCRIPTION =
  'Retry after 5, 10, 20, 40, then every 60 minutes. Login and permission requests need your attention. Stop cancels recovery for the current task.';

export type AccountSwitchUsageLevel = 'unknown' | 'low' | 'moderate' | 'high' | 'exhausted';

export interface AccountSwitchUsageCard {
  label: string;
  /** 0–100, or undefined when the limit has no reading. */
  used: number | undefined;
  level: AccountSwitchUsageLevel;
  /** Countdown to the reset, `Due` once passed, or null without a reset time. */
  reset: string | null;
}

export interface AccountSwitchCardAccount {
  role: string;
  label: string;
  target: boolean;
  usage: AccountSwitchUsageCard[];
}

export interface AccountSwitchCardStep {
  label: string;
  state: 'done' | 'active' | 'pending';
}

export interface AccountSwitchCardPresentation {
  /** The card's `data-phase`: gxserver's phase, or `finishing` while a success waits for `ready`. */
  phase: Exclude<AccountSwitchProgress['phase'], 'cancelled'> | 'finishing';
  heading: string;
  lede: string;
  /** The target account is bound: roles read Previous/Active and the target shows a check. */
  verified: boolean;
  from: AccountSwitchCardAccount;
  to: AccountSwitchCardAccount;
  /** Null when the switch failed; the failure text replaces the steps. */
  steps: AccountSwitchCardStep[] | null;
  failure: string | null;
}

function accountSwitchUsageCard(
  label: string,
  usage: AccountUsageWindow | undefined,
  now: number
): AccountSwitchUsageCard {
  const used = usage && Number.isFinite(usage.usedPercent) ? Math.max(0, Math.min(100, usage.usedPercent)) : undefined;
  const level: AccountSwitchUsageLevel =
    used === undefined ? 'unknown' : used >= 100 ? 'exhausted' : used >= 80 ? 'high' : used >= 50 ? 'moderate' : 'low';
  const remaining = usage?.resetsAt ? Date.parse(usage.resetsAt) - now : Number.NaN;
  const reset = Number.isFinite(remaining) ? (remaining > 0 ? formatResetCountdown(remaining) : 'Due') : null;
  return { label, used, level, reset };
}

function accountSwitchCardAccount(
  account: AgentAccount | undefined,
  provider: AccountSwitchProgress['provider'],
  role: string,
  target: boolean,
  now: number
): AccountSwitchCardAccount {
  const main = account?.usage.filter((window) => !window.model) ?? [];
  return {
    role,
    label: account?.email || (target ? 'Selected account' : 'Current CLI login'),
    target,
    usage: [
      accountSwitchUsageCard('5h limit', main.find(isFiveHourWindow), now),
      accountSwitchUsageCard('7d limit', main.find(isWeeklyWindow), now),
      ...(provider === 'claude' ? [accountSwitchUsageCard('Fable', fableWindow(account?.usage ?? []), now)] : []),
    ],
  };
}

/**
 * CDXC:AgentProviders 2026-09-12 DECISION:
 * User: center the account-switch card in chat until the switch completes; only add this card and leave the Switch Account menu unchanged.
 * Show both accounts with their three usage windows, including Fable. Omit "used" and "limit reached" captions. The steps keep one animated line on the active step, never a spinner. The automatic third step is "Continue Session"; manual switches wait for the user's next message.
 * 2026-09-23: the proximity colours (red at 100%) and the large tiles were replaced by the compact-tiles design the user picked, with usage in neutral ink; see account-switch-card.css.
 * No heading spinner, repeated status above the composer, View terminal button, draft reassurance, or bottom bar.
 * Show plain provider logos in this card, without the account's two-character indicator inside them.
 * Identify each account by its real email on one line, respecting Hide emails, rather than account names or the preview's former invented aliases.
 *
 * `ready` is the chat's confirmation that the second account is bound and usable (see account-switch.ts). A `success` phase without it keeps the last step active and the "Switching" heading, so the card never announces completion before the account is ready.
 */
export function accountSwitchCardPresentation(
  progress: AccountSwitchProgress,
  accounts: readonly AgentAccount[],
  ready: boolean,
  now: number
): AccountSwitchCardPresentation | null {
  const { phase, source, provider } = progress;
  if (phase === 'cancelled') return null;
  const settled = phase === 'success' && ready;
  const finishing = phase === 'success' && !ready;
  const verified = progress.accountReady === true || phase === 'success' || phase === 'continuing';
  const providerName = provider === 'claude' ? 'Claude' : 'Codex';
  const labels = ['Switch account', 'Resume conversation', ...(source === 'automatic' ? ['Continue Session'] : [])];
  const current = phase === 'switching' ? 0 : phase === 'resuming' ? 1 : finishing ? labels.length - 1 : 2;
  return {
    phase: finishing ? 'finishing' : phase,
    heading:
      phase === 'failed'
        ? verified
          ? 'Couldn’t continue the session'
          : 'Couldn’t complete the switch'
        : settled
          ? 'Account switched'
          : `Switching ${providerName} account`,
    lede:
      phase === 'failed'
        ? verified
          ? 'The account is ready, but continuation needs attention.'
          : 'The new account isn’t ready yet.'
        : settled
          ? source === 'automatic'
            ? 'Your task is continuing on the new account.'
            : 'Ready whenever you are. Send your next message.'
          : finishing
            ? 'Loading your conversation on the new account.'
            : source === 'automatic'
              ? 'Usage limit reached. Continuing on an available account.'
              : 'Your conversation will be ready for your next message.',
    verified,
    from: accountSwitchCardAccount(
      accounts.find((account) => account.id === progress.fromAccountId),
      provider,
      verified ? 'Previous account' : 'Current account',
      false,
      now
    ),
    to: accountSwitchCardAccount(
      accounts.find((account) => account.id === progress.toAccountId),
      provider,
      verified ? 'Active account' : 'Switching to',
      true,
      now
    ),
    steps:
      phase === 'failed'
        ? null
        : labels.map((label, index) => {
            const done = settled || index < current;
            return { label, state: done ? 'done' : index === current ? 'active' : 'pending' };
          }),
    failure:
      phase === 'failed'
        ? progress.reason ||
          'We couldn’t confirm the new login. Retry this switch or use Switch Account to choose another account.'
        : null,
  };
}
