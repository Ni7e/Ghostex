import type { SessionChatOptionDescriptor, SessionChatOptionState } from '@/packages/core-ui/chat/session-chat-session-options';
import {
  MODEL_MENU_SEARCH_PLACEHOLDER,
  modelMenuEffortFor,
  modelMenuEmptyText,
  modelMenuEntries,
  modelMenuOpeningTab,
  modelMenuPickValue,
  modelMenuPillLabels,
  modelMenuRows,
  modelMenuTabs,
  modelMenuTraits,
  type ModelMenuRow,
  type ModelMenuTabId,
} from '../session-chat-presentation/model-menu';
import {
  MODEL_PICKER_DEFAULT_SCOPE_ONLY_REASON,
  modelPickerSupportsSessionScope,
  type ModelPickerProvider,
} from '../session-chat-presentation/model-picker';
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
}

/** What a click on a model row means for this session. */
export type ModelMenuPick =
  | { kind: 'select'; value: string }
  | { kind: 'handoff'; provider: ModelPickerProvider; model: string; effort: string };

export function modelMenuPick(row: ModelMenuRow, context: ModelMenuContext): ModelMenuPick {
  const current = context.modelId ? context.state[context.modelId]?.value : undefined;
  if (row.provider === context.provider)
    return { kind: 'select', value: modelMenuPickValue(row, current, context.modelDefault) };
  const model = modelMenuPickValue(row, undefined, undefined);
  return {
    kind: 'handoff',
    provider: row.provider,
    model,
    effort: modelMenuEffortFor(row.provider, model, context.state.effort?.value),
  };
}

/** Everything both renderers draw for the picker, from the view state each of them owns. */
export function modelMenuProjection(context: ModelMenuContext, view: { tab: ModelMenuTabId | null; query: string }) {
  const entries = modelMenuEntries();
  const tab = view.tab ?? modelMenuOpeningTab(entries, context.provider);
  const traits = modelMenuTraits(entries, context);
  const model = context.modelId ? context.state[context.modelId]?.value : undefined;
  const rows = modelMenuRows(entries, {
    tab,
    query: view.query,
    favorites: modelFavorites(),
    current: { provider: context.provider, model },
  });
  return {
    tab,
    query: view.query,
    placeholder: MODEL_MENU_SEARCH_PLACEHOLDER,
    tabs: modelMenuTabs(entries, tab),
    rows,
    emptyText: rows.length === 0 ? modelMenuEmptyText(tab, view.query) : null,
    traits,
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
