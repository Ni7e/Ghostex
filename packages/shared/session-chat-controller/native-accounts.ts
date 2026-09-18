import type { AccountSwitchProgress, AgentAccount, AgentAccountsState } from '../agent-accounts';
import type { SessionChatContextUsage } from '../session-chat';
import { accountUsageLabel } from '../account-usage-label';
import {
  ACCOUNT_POLICY_PRIORITY_OPTIONS,
  ACCOUNT_POLICY_RETRY_DESCRIPTION,
  accountFigures,
  accountPolicyAtLimitDescription,
  accountResetLabel,
  accountSwitchCardPresentation,
  sessionAccountPolicySummary,
  switchAccountRowDetail,
} from '../session-chat-presentation/accounts';
import {
  formatSessionChatContextTokens,
  resolveSessionChatContextMeterUsage,
} from '../session-chat-presentation/context-usage';
import { nativeContextText } from './native-context';

/*
GPUI chat's More actions > Switch Account panel and account-switch card,
projected from the same rules and copy as SessionAccountsPanel and
AccountSwitchCard (packages/core-ui/accounts/). Text arrives masked for Hide
emails, so the renderers only lay it out.
SEE-ALSO: apps/desktop/src/app/native_chat/option_menu/accounts.rs,
apps/desktop/src/app/native_chat/account_switch_card.rs.
*/

function identity(account: AgentAccount) {
  return { provider: account.provider, figures: accountFigures(account).map((figure) => figure.value) };
}

export function nativeAccountPanel(
  data: AgentAccountsState | undefined,
  error: string | undefined,
  busy: boolean,
  contextUsage: SessionChatContextUsage | undefined
) {
  const text = nativeContextText;
  const now = Date.now();
  const session = data?.session;
  // Same gate as SessionAccountsPanel: without a saved account for this provider, offer Add account.
  if (
    data &&
    session &&
    !data.accounts.some((account) => account.registered && account.provider === session.provider)
  ) {
    return { kind: 'noAccounts' as const };
  }
  const base = { kind: 'panel' as const, busy, error: error ? text(error) : null };
  if (!data)
    return { ...base, message: busy ? 'Reading accounts and usage…' : 'Could not load accounts.', session: null };
  if (!session) return { ...base, message: 'Account management supports Claude and Codex sessions.', session: null };
  const current = data.accounts.find((account) => account.id === session.accountId);
  const context = resolveSessionChatContextMeterUsage(contextUsage);
  const policy = session.override ?? session.policy;
  return {
    ...base,
    message: null,
    session: {
      recovery: session.recovery
        ? {
            reason: text(session.recovery.reason),
            next: session.recovery.nextAttemptAt
              ? `Next attempt: ${new Date(session.recovery.nextAttemptAt).toLocaleString()} · Attempt ${session.recovery.attempt + 1}`
              : null,
          }
        : null,
      current: current ? identity(current) : null,
      name: text(current?.name ?? 'Choose an account'),
      email: current?.email && current.email !== current.name ? text(current.email) : null,
      usageError: current?.usageError ? text(current.usageError) : null,
      usage: (current?.usage ?? []).map((window) => ({
        label: `${accountUsageLabel(window)}: ${Math.round(window.usedPercent)}%`,
        percent: Math.max(0, Math.min(100, window.usedPercent)),
        reset: accountResetLabel(window.resetsAt, now),
      })),
      context: context
        ? {
            percent: context.usedPercentage ?? 0,
            value: context.usedPercentage === null ? 'Usage unavailable' : `${Math.round(context.usedPercentage)}%`,
            tokens: `${formatSessionChatContextTokens(context.usedTokens)} / ${formatSessionChatContextTokens(context.windowSize)}`,
          }
        : null,
      switchHeading: current ? 'Switch account' : 'Accounts',
      others: data.accounts
        .filter(
          (account) => account.registered && account.provider === session.provider && account.id !== session.accountId
        )
        .map((account) => {
          const detail = switchAccountRowDetail(account, now);
          return {
            ...identity(account),
            id: account.id,
            name: text(account.name),
            detail: detail ? text(detail) : null,
            ready: account.status === 'ready',
            action: account.status === 'ready' ? 'Use account →' : 'Reconnect',
          };
        }),
      policy: {
        summary: sessionAccountPolicySummary(session),
        custom: session.override !== null,
        value: policy,
        atLimitDescription: accountPolicyAtLimitDescription(policy),
        priorityLabel:
          ACCOUNT_POLICY_PRIORITY_OPTIONS.find((option) => option.value === policy.priority)?.label ?? policy.priority,
        priorities: ACCOUNT_POLICY_PRIORITY_OPTIONS,
        retryDescription: ACCOUNT_POLICY_RETRY_DESCRIPTION,
      },
    },
  };
}

/**
 * The card React's chat view renders over the pane while `accountStatus.visible` holds.
 * A failed switch shows the account request's own error when there is one, and offers Retry for its target account.
 */
export function nativeAccountSwitchCard(
  progress: AccountSwitchProgress,
  data: AgentAccountsState | undefined,
  error: string | undefined,
  ready: boolean,
  busy: boolean,
  now: number
) {
  const text = nativeContextText;
  const shown = error && progress.phase === 'failed' ? { ...progress, reason: error } : progress;
  const card = accountSwitchCardPresentation(shown, data?.accounts ?? [], ready, now);
  if (!card) return null;
  return {
    ...card,
    id: progress.id,
    provider: progress.provider,
    from: { ...card.from, label: text(card.from.label) },
    to: { ...card.to, label: text(card.to.label) },
    failure: card.failure ? text(card.failure) : null,
    retry: progress.phase === 'failed' && progress.toAccountId ? { accountId: progress.toAccountId, busy } : null,
  };
}
