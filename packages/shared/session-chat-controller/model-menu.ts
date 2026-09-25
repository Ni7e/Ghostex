import type {
  SessionChatOptionDescriptor,
  SessionChatOptionState,
} from '@/packages/core-ui/chat/session-chat-session-options';
import {
  MODEL_MENU_FAVORITES_TAB,
  MODEL_MENU_SEARCH_PLACEHOLDER,
  modelMenuAccountTrait,
  modelMenuEffortFor,
  modelMenuEmptyText,
  modelMenuEntries,
  modelMenuOpeningTab,
  modelMenuPickValue,
  modelMenuPillLabels,
  modelMenuRowEfforts,
  modelMenuRows,
  modelMenuTabs,
  modelMenuTraits,
  type ModelMenuAccount,
  type ModelMenuRow,
  type ModelMenuTabId,
} from '../session-chat-presentation/model-menu';
import {
  MODEL_PICKER_DEFAULT_SCOPE_ONLY_REASON,
  modelPickerSupportsSessionScope,
  type ModelPickerProvider,
} from '../session-chat-presentation/model-picker';
import type { AgentAccountsState } from '../agent-accounts';
import { modelFavorites } from './model-favorites';

export interface ModelMenuContext {
  provider: ModelPickerProvider | undefined;
  modelId: string | undefined;
  modelDefault: string | undefined;
  modelLabel: string | null;
  descriptors: readonly SessionChatOptionDescriptor[];
  state: SessionChatOptionState;
  caps: { canPickModel: boolean; queuedControls: boolean; canSendKey: boolean };
  selectionError?: string | null;
  /** Picks are refused while an option command is being typed into a working agent. */
  disabled: boolean;
  /** The session agent's signed-in accounts, for the footer's Account button. */
  accounts?: readonly ModelMenuAccount[];
  /** A draft has no conversation yet, so another agent's model switches the draft instead of handing off. */
  draft?: boolean;
}

/**
 * The Account button's list: this session's agent's signed-in accounts, the one in use marked. `text` applies the
 * host's Hide emails masking to the names.
 */
export function modelMenuAccounts(
  state: AgentAccountsState | undefined,
  text: (value: string) => string
): ModelMenuAccount[] | undefined {
  const session = state?.session;
  if (!state || !session) return undefined;
  return state.accounts
    .filter((account) => account.registered && account.provider === session.provider)
    .map((account) => ({
      id: account.id,
      label: text(account.name),
      current: account.id === session.accountId,
      ready: account.status === 'ready',
    }));
}

/**
 * What picking a model row means for this session. `effort` is set when the pick carries a reasoning level
 * (the keyboard's Left and Right, or a level chosen for the highlighted model); a plain click leaves it out.
 */
export type ModelMenuPick =
  | { kind: 'select'; value: string; effort?: string }
  | { kind: 'handoff'; provider: ModelPickerProvider; model: string; effort: string };

export function modelMenuPick(row: ModelMenuRow, context: ModelMenuContext, effort?: string): ModelMenuPick {
  const current = context.modelId ? context.state[context.modelId]?.value : undefined;
  if (row.provider === context.provider)
    return {
      kind: 'select',
      value: modelMenuPickValue(row, current, context.modelDefault),
      ...(effort !== undefined ? { effort } : {}),
    };
  const model = modelMenuPickValue(row, undefined, undefined);
  return {
    kind: 'handoff',
    provider: row.provider,
    model,
    effort: effort ?? modelMenuEffortFor(row.provider, model, context.state.effort?.value),
  };
}

/** Everything both renderers draw for the picker, from the view state each of them owns. */
export function modelMenuProjection(context: ModelMenuContext, view: { tab: ModelMenuTabId | null; query: string }) {
  const entries = modelMenuEntries();
  const tab = view.tab ?? modelMenuOpeningTab(entries, context.provider);
  const traits = modelMenuTraits(entries, context);
  const model = context.modelId ? context.state[context.modelId]?.value : undefined;
  const currentEffort = context.state.effort?.value;
  const sessionEffort = context.descriptors.find((descriptor) => descriptor.id === 'effort');
  const rows = modelMenuRows(entries, {
    tab,
    query: view.query,
    favorites: modelFavorites(),
    current: { provider: context.provider, model },
  }).map((row) => {
    const pick = modelMenuPick(row, context);
    return {
      ...row,
      handoff: pick.kind === 'handoff' && !context.draft,
      ...modelMenuRowEfforts(row, {
        pickValue: pick.kind === 'select' ? pick.value : pick.model,
        currentEffort,
        sessionEffort,
      }),
    };
  });
  const account = modelMenuAccountTrait(context.accounts);
  return {
    tab,
    query: view.query,
    placeholder: MODEL_MENU_SEARCH_PLACEHOLDER,
    tabs: modelMenuTabs(entries, tab).map((entry) => ({
      ...entry,
      handoff: entry.id !== MODEL_MENU_FAVORITES_TAB && entry.id !== context.provider && !context.draft,
    })),
    rows,
    emptyText: rows.length === 0 ? modelMenuEmptyText(tab, view.query) : null,
    traits: account ? [...traits, account] : traits,
    pill: modelMenuPillLabels(entries, context.provider, model, context.modelLabel, traits),
    error: context.selectionError ?? null,
    disabled: context.disabled,
    /** Right-click applies to this session only where the agent can; elsewhere the hint says why not. */
    sessionScope: !!context.provider && modelPickerSupportsSessionScope(context.provider),
    scopeHint:
      context.provider && modelPickerSupportsSessionScope(context.provider)
        ? 'Click saves as default · Right-click applies to this session only'
        : MODEL_PICKER_DEFAULT_SCOPE_ONLY_REASON,
  };
}
export type ModelMenuProjection = ReturnType<typeof modelMenuProjection>;
