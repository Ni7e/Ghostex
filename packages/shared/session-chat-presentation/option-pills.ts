import { truncateAgentModelLabel } from '../agent-model-catalog';
import {
  sessionChatOptionValueLabel,
  sessionChatOptionsPillLabel,
  type SessionChatOptionDescriptor,
  type SessionChatOptionState,
  type SessionChatSessionOptionCatalog,
} from '@/packages/core-ui/chat/session-chat-session-options';
import { isShiftTabModeCycler, optionMenuSections } from './option-menu';
import { MODES_SECTION_LABEL } from '@/packages/core-ui/chat/session-chat-session-options';
import type { AgentAccountsState } from '../agent-accounts';

/**
 * The account mark the model pill draws over the provider logo: the account this session is bound
 * to, by its own two-character indicator or, without one, its slot selector. `-` hides the mark,
 * and a session with no bound account (or an agent that has no accounts) leaves the logo plain.
 * SEE-ALSO: packages/core-ui/project-agent-launcher-icon.tsx, packages/core-ui/accounts/indicator.tsx,
 * packages/core-ui/accounts/accounts.css (.gx-account-mark), apps/desktop/src/app/native_chat/option_pills.rs.
 */
export function sessionChatAccountIndicator(accounts: AgentAccountsState | undefined): string | undefined {
  const active = accounts?.accounts.find((account) => account.id === accounts.session?.accountId);
  const value = active ? active.indicator || active.selector : undefined;
  return value && value !== '-' ? value : undefined;
}

export function sessionChatOptionsTitle(
  sections: ReturnType<typeof optionMenuSections>,
  fast: boolean,
  plan: boolean,
  pickerShortcutSuffix = ''
) {
  return (
    [
      ...sections
        .filter((section) => section.label !== MODES_SECTION_LABEL)
        .map(
          (section) =>
            `${section.label}${section.descriptors.some((descriptor) => descriptor.id === 'effort') ? pickerShortcutSuffix : ''}`
        ),
      ...(fast ? ['Fast enabled'] : []),
      ...(plan ? ['Plan mode'] : []),
    ].join(' • ') || 'Options'
  );
}

export function sessionChatOptionPillValues(
  catalog: SessionChatSessionOptionCatalog | null,
  descriptors: readonly SessionChatOptionDescriptor[],
  state: SessionChatOptionState
) {
  const model = catalog ? sessionChatOptionValueLabel(catalog.model, state) : null;
  const mode = descriptors.find(isShiftTabModeCycler);
  return {
    model,
    modelDisplay: model === null ? null : truncateAgentModelLabel(model),
    options: sessionChatOptionsPillLabel(
      descriptors.filter((item) => !isShiftTabModeCycler(item)),
      state
    ),
    mode: mode ? sessionChatOptionValueLabel(mode, state) : null,
    modeValue: mode ? state[mode.id]?.value : undefined,
    agentIcon: catalog?.modelIcon,
    fast: catalog?.modelIcon === 'codex' && state.fastMode?.value === 'on',
    plan: catalog?.modelIcon === 'codex' && state.mode?.value === 'plan',
  };
}
