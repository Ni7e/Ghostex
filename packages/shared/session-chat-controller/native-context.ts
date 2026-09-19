import { maskAccountText } from '../account-display';
import type { AgentAccountsState } from '../agent-accounts';
import type { UseSessionChatResult } from '@/packages/core-ui/chat/use-session-chat/state';
import {
  resolveContextDetailStatus,
  type ContextDetailsAgent,
} from '@/packages/core-ui/chat/session-chat-context-details-agents';
import {
  normalizeSessionChatContextDetailsPreferences,
  resolveSessionChatContextDetailGroups,
  resolveSessionChatStarredContextDetails,
  type SessionChatContextDetailsPreferences,
} from '../session-chat-presentation/context-details';
import {
  resolveSessionChatContextMeterUsage,
  formatSessionChatContextPercentage,
  formatSessionChatContextTokens,
} from '../session-chat-presentation/context-usage';
import { adoptModelPicksSessionOnly } from '../session-chat-presentation/model-picker';
import { sessionChatStatusLineReserved } from '../session-chat-presentation/status-line-layout';
import type { ChatLifecycle } from './lifecycle';

let preferences: Record<ContextDetailsAgent, SessionChatContextDetailsPreferences> = {
  claude: normalizeSessionChatContextDetailsPreferences(null, 'claude'),
  codex: normalizeSessionChatContextDetailsPreferences(null, 'codex'),
};
export const currentNativeContextPreferences = () => preferences;
let settings: { title: string | null; hideAccountEmails: boolean; modelPicksSessionOnly?: boolean } = {
  title: null,
  hideAccountEmails: false,
};
export const nativeContextTitle = () => settings.title;
export const nativeContextText = (text: string) => (settings.hideAccountEmails ? maskAccountText(text) : text);
export function adoptNativeChatSettings(next: typeof settings) {
  settings = next;
  adoptModelPicksSessionOnly(next.modelPicksSessionOnly === true);
  for (const listener of listeners) listener();
}
const listeners = new Set<() => void>();
export function adoptNativeContextPreferences(next: typeof preferences) {
  if (JSON.stringify(next) === JSON.stringify(preferences)) return;
  preferences = next;
  for (const listener of listeners) listener();
}

export function computeNativeChatContext(
  chat: UseSessionChatResult,
  icon: string | undefined,
  accounts: AgentAccountsState | undefined,
  lifecycle: ChatLifecycle
) {
  const [stored, setStored] = lifecycle.useState(() => preferences);
  const [now, setNow] = lifecycle.useState(Date.now);
  lifecycle.useEffect(() => {
    const update = () => {
      setStored({ ...preferences });
      setNow(Date.now());
    };
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);
  lifecycle.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const agent = icon === 'codex' ? 'codex' : 'claude';
  const hasDetails = icon === 'codex' || icon === 'claude';
  const reported = resolveSessionChatContextMeterUsage(chat.selectedOptions?.contextUsage, agent === 'codex');
  if (!reported && !hasDetails) return { contextMeter: null };
  const usage = reported ?? { usedPercentage: null, usedTokens: null, windowSize: null };
  const percentage = formatSessionChatContextPercentage(usage.usedPercentage);
  const account = accounts?.accounts.find((account) => account.id === accounts.session?.accountId);
  const status = resolveContextDetailStatus(agent, chat.selectedOptions, account);
  const session = { title: settings.title, agentSessionId: chat.agentSessionId, draft: chat.availableAgents !== null };
  const details = hasDetails
    ? resolveSessionChatContextDetailGroups(status, stored[agent], now, 'shown', session, agent)
    : null;
  const starred = hasDetails ? resolveSessionChatStarredContextDetails(status, stored[agent], now, session, agent) : [];
  const hasConfiguredItems = hasDetails && Object.values(stored[agent].starred).some(Boolean);
  const label = percentage
    ? `Context window ${percentage} used`
    : usage.usedTokens === null
      ? 'Context usage not yet reported'
      : `Context window ${formatSessionChatContextTokens(usage.usedTokens)} tokens used`;
  const summary =
    usage.windowSize !== null && percentage
      ? `${percentage} · ${formatSessionChatContextTokens(usage.usedTokens)}/${formatSessionChatContextTokens(usage.windowSize)}`
      : (percentage ??
        (usage.usedTokens === null ? 'Not yet reported' : formatSessionChatContextTokens(usage.usedTokens)));
  return {
    contextMeter: {
      ...usage,
      percentage,
      label,
      summary,
      hasConfiguredItems,
      // The native status line holds its row of space by the same rule React's `is-reserved` class applies.
      statusLineReserved: sessionChatStatusLineReserved({ hasConfiguredItems, itemCount: starred.length }),
      details:
        details?.map((group) => ({
          ...group,
          items: group.items.map((item) => ({ ...item, value: nativeContextText(item.value) })),
        })) ?? null,
      starred: starred.map((item) => ({ ...item, value: nativeContextText(item.value) })),
      tooltip: nativeContextText(chat.selectedOptions?.terminalStatusLine?.trim() || label),
      compactDisabled: chat.working,
      compactDisabledReason: chat.working ? 'Available once the agent is idle.' : null,
    },
  };
}
