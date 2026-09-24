import { agentModelCatalogEffortLabel } from '../agent-model-catalog';
import { currentAgentModelCatalog } from '../agent-model-catalog-state';
import { getDefaultSidebarAgentById } from '../sidebar-agents';
import {
  sessionChatOptionValueLabel,
  sessionChatSessionOptionCatalog,
  type SessionChatOptionDescriptor,
  type SessionChatOptionState,
  type SessionChatSessionOptionCatalog,
} from '@/packages/core-ui/chat/session-chat-session-options';
import { isShiftTabModeCycler, sessionChatOptionRows } from './option-menu';
import type { ModelPickerProvider } from './model-picker';

/**
 * CDXC:SessionChat 2026-09-21 DECISION:
 * User: the composer's model and effort pills become one pill that opens one picker: agent tabs with a favorites tab first, a model search, rows with a Cmd+number badge and a star, and a footer for reasoning, context window and fast mode (see asButton below).
 * React and GPUI both draw what this module decides, so tabs, row order, search ranking, favorites and the footer can never differ between them.
 * SEE-ALSO: packages/core-ui/chat/session-chat-model-menu.tsx, apps/desktop/src/app/native_chat/option_menu/model_menu/, packages/shared/session-chat-controller/model-menu.ts.
 */
export const MODEL_MENU_PROVIDERS: readonly ModelPickerProvider[] = [
  'claude',
  'codex',
  'cursor',
  'grok',
  'antigravity',
];
export const MODEL_MENU_FAVORITES_TAB = 'favorites';
export type ModelMenuTabId = typeof MODEL_MENU_FAVORITES_TAB | ModelPickerProvider;
export const MODEL_MENU_SEARCH_PLACEHOLDER = 'Search models…';
export const MODEL_MENU_SHORTCUT_ROWS = 9;

const AUTO_MODEL_VALUE = 'auto';

/** The long-context twin of a model is the same row with another Context Window choice. */
const LONG_CONTEXT_SUFFIX = '[1m]';
const CONTEXT_LABELS = { standard: '200K', long: '1M' } as const;

export interface ModelMenuTab {
  id: ModelMenuTabId;
  /** Agent logo file name; absent on the favorites tab, which draws a star. */
  icon?: string;
  name: string;
  active: boolean;
  /** Another agent's tab in a started session: its models hand the conversation off to that agent's CLI. */
  handoff?: boolean;
}

export interface ModelMenuVariant {
  /** The model value this context window is picked with. */
  value: string;
  label: string;
}

export interface ModelMenuEntry {
  provider: ModelPickerProvider;
  icon: string;
  agentName: string;
  /** Row identity and favorites key; the standard-context value where the model has two. */
  value: string;
  label: string;
  description?: string;
  variants: readonly ModelMenuVariant[];
}

export interface ModelMenuEffort {
  value: string;
  label: string;
}

export interface ModelMenuRow extends ModelMenuEntry {
  key: string;
  favorite: boolean;
  selected: boolean;
  /** 1 to 9 for the rows Cmd+number reaches. */
  shortcut?: number;
  /** Favorites mix agents, so those rows lead with their agent's logo. */
  showAgent: boolean;
  /** Picking this row hands the conversation off to another agent's CLI rather than switching this session's model. */
  handoff?: boolean;
  /** The reasoning levels this model offers, lowest first; empty where it has none. */
  efforts: readonly ModelMenuEffort[];
  /** The level a pick of this row uses until Left or Right moves it: the one in use, else the model's default. */
  effort: string;
}

export interface ModelMenuTraitChoice {
  value: string;
  label: string;
  selected: boolean;
  isDefault: boolean;
  /** Leaving Codex plan mode is a key press, not a value; the option command carries this through. */
  exitPlan?: boolean;
}

export interface ModelMenuTrait {
  /** `context` picks a model variant; anything else is the option descriptor with this id. */
  id: string;
  label: string;
  valueLabel: string | null;
  disabled?: boolean;
  choices: readonly ModelMenuTraitChoice[];
  /** The glyph drawn beside the value: a brain for reasoning, chart bars for the context window, a bolt for fast mode, a person for the account. */
  icon?: 'reasoning' | 'context' | 'fast' | 'account';
  /** Present when the button has at most two values: the one a click moves to. Longer lists open a side list instead. */
  toggle?: { value: string; exitPlan?: boolean };
}

export const modelMenuFavoriteKey = (provider: string, value: string) => `${provider}:${value}`;

function entriesFor(provider: ModelPickerProvider, catalog: SessionChatSessionOptionCatalog): ModelMenuEntry[] {
  const agent = getDefaultSidebarAgentById(provider);
  const choices = catalog.model.choices ?? [];
  const values = new Set(choices.map((choice) => choice.value));
  const entries: ModelMenuEntry[] = [];
  for (const choice of choices) {
    const long = choice.value.endsWith(LONG_CONTEXT_SUFFIX);
    const base = long ? choice.value.slice(0, -LONG_CONTEXT_SUFFIX.length) : choice.value;
    if (long && values.has(base)) continue;
    const twin = `${choice.value}${LONG_CONTEXT_SUFFIX}`;
    entries.push({
      provider,
      icon: catalog.modelIcon,
      agentName: agent?.name ?? provider,
      value: choice.value,
      label: choice.label,
      description: choice.description,
      variants:
        !long && values.has(twin)
          ? [
              { value: choice.value, label: CONTEXT_LABELS.standard },
              { value: twin, label: CONTEXT_LABELS.long },
            ]
          : [],
    });
  }
  return entries;
}

/** Every agent the catalog knows, in tab order; the session's own agent is one of them when it has a provider. */
export function modelMenuEntries(): Record<string, ModelMenuEntry[]> {
  const entries: Record<string, ModelMenuEntry[]> = {};
  for (const provider of MODEL_MENU_PROVIDERS) {
    const catalog = sessionChatSessionOptionCatalog(provider);
    if (catalog) entries[provider] = entriesFor(provider, catalog);
  }
  return entries;
}

export function modelMenuEntryFor(
  entries: Record<string, ModelMenuEntry[]>,
  provider: string | undefined,
  model: string | undefined
): ModelMenuEntry | undefined {
  if (!provider || !model) return undefined;
  return entries[provider]?.find(
    (entry) => entry.value === model || entry.variants.some((variant) => variant.value === model)
  );
}

export function modelMenuTabs(entries: Record<string, ModelMenuEntry[]>, tab: ModelMenuTabId): ModelMenuTab[] {
  return [
    { id: MODEL_MENU_FAVORITES_TAB, name: 'Favorites', active: tab === MODEL_MENU_FAVORITES_TAB },
    ...MODEL_MENU_PROVIDERS.filter((provider) => entries[provider]?.length).map((provider) => ({
      id: provider,
      icon: entries[provider]![0]!.icon,
      name: entries[provider]![0]!.agentName,
      active: tab === provider,
    })),
  ];
}

/** The session's own agent, where a pick applies in place; favorites already float to the top of every tab. */
export function modelMenuOpeningTab(
  entries: Record<string, ModelMenuEntry[]>,
  provider: ModelPickerProvider | undefined
): ModelMenuTabId {
  return provider && entries[provider]?.length
    ? provider
    : (MODEL_MENU_PROVIDERS.find((id) => entries[id]?.length) ?? MODEL_MENU_FAVORITES_TAB);
}

/** 0 for a prefix, 1 for a substring, as the label; the description ranks two below the label. */
function matchRank(query: string, text: string): number | undefined {
  const at = text.toLowerCase().indexOf(query);
  return at < 0 ? undefined : at === 0 ? 0 : 1;
}

export function modelMenuRows(
  entries: Record<string, ModelMenuEntry[]>,
  params: {
    tab: ModelMenuTabId;
    query: string;
    favorites: readonly string[];
    current: { provider?: string; model?: string };
  }
): ModelMenuRow[] {
  const favoritesTab = params.tab === MODEL_MENU_FAVORITES_TAB;
  const isFavorite = (entry: ModelMenuEntry) =>
    params.favorites.includes(modelMenuFavoriteKey(entry.provider, entry.value));
  const pool = favoritesTab
    ? MODEL_MENU_PROVIDERS.flatMap((provider) => entries[provider] ?? []).filter(isFavorite)
    : (entries[params.tab] ?? []);
  const query = params.query.trim().toLowerCase();
  /**
   * CDXC:SessionChat 2026-09-22 DECISION:
   * User: "make Auto show up at the top here", above a starred model on the agent's own tab. Auto is the agent choosing for you rather than one model among the others, so a star does not move it down; a search still ranks it by the match.
   */
  const pinned = (entry: ModelMenuEntry) => !favoritesTab && entry.value === AUTO_MODEL_VALUE;
  const ranked = pool
    .map((entry, index) => {
      const favorite = isFavorite(entry);
      if (!query) return { entry, favorite, index, rank: 0 };
      const byLabel = matchRank(query, entry.label);
      const byDescription = matchRank(query, `${entry.description ?? ''} ${entry.label}`);
      const rank = Math.min(byLabel ?? Infinity, byDescription === undefined ? Infinity : byDescription + 2);
      return Number.isFinite(rank) ? { entry, favorite, index, rank } : null;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        Number(pinned(b.entry)) - Number(pinned(a.entry)) ||
        Number(b.favorite) - Number(a.favorite) ||
        a.index - b.index
    );
  const current = modelMenuEntryFor(entries, params.current.provider, params.current.model);
  return ranked.map(({ entry, favorite }, index) => ({
    ...entry,
    key: modelMenuFavoriteKey(entry.provider, entry.value),
    favorite,
    selected: current !== undefined && current.provider === entry.provider && current.value === entry.value,
    shortcut: index < MODEL_MENU_SHORTCUT_ROWS ? index + 1 : undefined,
    showAgent: favoritesTab,
    efforts: [],
    effort: '',
  }));
}

export function modelMenuEmptyText(tab: ModelMenuTabId, query: string): string {
  if (query.trim()) return 'No models found';
  return tab === MODEL_MENU_FAVORITES_TAB ? "No starred models yet. Star a model from an agent's tab." : 'No models';
}

export function toggleModelMenuFavorite(favorites: readonly string[], key: string): string[] {
  return favorites.includes(key) ? favorites.filter((item) => item !== key) : [...favorites, key];
}

/** The value a row is picked with: the context window in use when the row offers it, else the catalog's default twin. */
export function modelMenuPickValue(
  entry: ModelMenuEntry,
  currentModel: string | undefined,
  defaultValue: string | undefined
): string {
  if (entry.variants.length === 0) return entry.value;
  if (currentModel && entry.variants.some((variant) => variant.value === currentModel)) return currentModel;
  const long = entry.variants.find((variant) => variant.value.endsWith(LONG_CONTEXT_SUFFIX));
  if (long && currentModel?.endsWith(LONG_CONTEXT_SUFFIX)) return long.value;
  return entry.variants.find((variant) => variant.value === defaultValue)?.value ?? entry.value;
}

/** The effort a model from another agent starts on: the one in use when that model offers it, else its default. */
export function modelMenuEffortFor(provider: ModelPickerProvider, model: string, currentEffort: string | undefined) {
  const effort = sessionChatSessionOptionCatalog(provider)
    ?.optionsForModel(model)
    .find((descriptor) => descriptor.id === 'effort');
  return (
    effort?.choices?.find((choice) => choice.value === currentEffort)?.value ??
    effort?.defaultValue ??
    effort?.choices?.[0]?.value ??
    ''
  );
}

/**
 * The reasoning levels a row's model offers and the one its pick starts on. For the session's own model the
 * choices come from the session's live descriptor, so they match what the Reasoning button lists today.
 */
export function modelMenuRowEfforts(
  row: Pick<ModelMenuRow, 'provider' | 'value' | 'selected'> & { variants: readonly ModelMenuVariant[] },
  params: {
    pickValue: string;
    currentEffort: string | undefined;
    sessionEffort?: SessionChatOptionDescriptor;
  }
): { efforts: ModelMenuEffort[]; effort: string } {
  const descriptor =
    row.selected && params.sessionEffort
      ? params.sessionEffort
      : sessionChatSessionOptionCatalog(row.provider)
          ?.optionsForModel(params.pickValue)
          .find((entry) => entry.id === 'effort');
  const catalog = currentAgentModelCatalog();
  const efforts = (descriptor?.choices ?? []).map((choice) => ({
    value: choice.value,
    label: agentModelCatalogEffortLabel(catalog, choice.value) || choice.label,
  }));
  if (efforts.length === 0) return { efforts, effort: '' };
  const offered = (value: string | undefined) =>
    value !== undefined && efforts.some((effort) => effort.value === value) ? value : undefined;
  return {
    efforts,
    effort:
      offered(params.currentEffort) ??
      offered(descriptor?.defaultValue) ??
      efforts[Math.floor(efforts.length / 2)]!.value,
  };
}

/**
 * CDXC:SessionChat 2026-09-24 DECISION:
 * User: take away the full-screen quick picker and make the composer's model pop-up the one model picker, opened by
 * Option+P in chat and terminal view and driven from the keyboard: "I would actually be able to use the left and
 * right arrows to change the [effort]". Left and Right move the highlighted model's reasoning one level and stop at
 * the ends (a small shake, also on a model with no levels); the Reasoning button shows the highlighted model's level,
 * and Enter saves that model with it.
 * SEE-ALSO: apps/desktop/src/app/native_chat/option_menu/model_menu/keys.rs, packages/core-ui/chat/session-chat-model-menu.tsx.
 */
export function modelMenuStepEffort(row: Pick<ModelMenuRow, 'efforts'>, current: string, step: -1 | 1): string | null {
  if (row.efforts.length === 0) return null;
  const index = row.efforts.findIndex((effort) => effort.value === current);
  if (index < 0) return row.efforts[step > 0 ? 0 : row.efforts.length - 1]!.value;
  return row.efforts[index + step]?.value ?? null;
}

/** The Reasoning button for the highlighted model: its levels, with the one Left and Right have moved to marked. */
export function modelMenuReasoningFor(
  trait: ModelMenuTrait,
  row: Pick<ModelMenuRow, 'efforts' | 'selected'> | undefined,
  effort: string | undefined
): ModelMenuTrait {
  if (trait.id !== 'effort' || !row || effort === undefined || row.efforts.length === 0) return trait;
  if (row.selected && trait.choices.some((choice) => choice.selected && choice.value === effort)) return trait;
  return {
    ...trait,
    disabled: false,
    valueLabel: row.efforts.find((entry) => entry.value === effort)?.label ?? trait.valueLabel,
    choices: row.efforts.map((entry) => ({
      value: entry.value,
      label: entry.label,
      selected: entry.value === effort,
      isDefault: false,
    })),
    toggle: undefined,
  };
}

/** The tab Tab or Shift+Tab moves to, wrapping round. */
export function modelMenuNextTab(
  tabs: readonly Pick<ModelMenuTab, 'id' | 'active'>[],
  step: -1 | 1
): ModelMenuTabId | undefined {
  if (tabs.length === 0) return undefined;
  const index = Math.max(
    tabs.findIndex((tab) => tab.active),
    0
  );
  return tabs[(index + step + tabs.length) % tabs.length]!.id;
}

/** The compact key reminder along the bottom of the pop-up. */
export const MODEL_MENU_KEY_HINTS: readonly { keys: string; label: string }[] = [
  { keys: '↑↓', label: 'model' },
  { keys: '←→', label: 'effort' },
  { keys: '⇥', label: 'agent' },
  { keys: '⏎', label: 'save' },
  { keys: 'esc', label: 'close' },
];

/** One signed-in account the Account button can switch this session to. */
export interface ModelMenuAccount {
  id: string;
  label: string;
  current: boolean;
  ready: boolean;
}

/**
 * CDXC:SessionChat 2026-09-24 DECISION:
 * User: accounts can be switched from the keyboard too, "but make it hidden, need to press enter to show this (same
 * as fast mode, should take up smaller area)". With more than one signed-in account for the session's agent the
 * footer gains an Account button beside Fast that shows the account in use; Enter or a click opens the list of
 * accounts, and Up, Down and Enter switch. It never toggles in place, even with two accounts.
 */
export function modelMenuAccountTrait(accounts: readonly ModelMenuAccount[] | undefined): ModelMenuTrait | null {
  if (!accounts || accounts.filter((account) => account.ready || account.current).length < 2) return null;
  const current = accounts.find((account) => account.current);
  return {
    id: 'account',
    label: 'Account',
    valueLabel: current?.label ?? 'Choose',
    icon: 'account',
    choices: accounts.map((account) => ({
      value: account.id,
      label: account.label,
      selected: account.current,
      isDefault: false,
    })),
  };
}

const TRAIT_LABELS: Record<string, string> = { effort: 'Reasoning' };
const TRAIT_ICONS: Record<string, ModelMenuTrait['icon']> = {
  effort: 'reasoning',
  context: 'context',
  fastMode: 'fast',
};

/**
 * CDXC:SessionChat 2026-09-21 DECISION:
 * User: Reasoning, Context Window and Fast Mode are three buttons along the bottom of the picker, each an icon beside its value (brain, chart bars, bolt); clicking Fast or the Context Window toggles it, since it usually has only two values.
 * This supersedes the full-width footer rows that each opened a side list; only a button with more than two values, such as Reasoning, still opens one.
 */
/**
 * CDXC:SessionChat 2026-09-22 DECISION:
 * User: "always show the 3 bottom buttons in all cases, make them disabled when they don't make sense and say Default for options that don't have options, or N/A where makes sense."
 * A model with one reasoning level or one context window runs on its default, so those read Default; an agent or model without a fast mode reads Off (the user asked for Off rather than N/A on 2026-09-22).
 */
function unavailable(id: string, label: string, valueLabel: string): Omit<ModelMenuTrait, 'icon' | 'toggle'> {
  return { id, label, valueLabel, disabled: true, choices: [] };
}

/**
 * CDXC:SessionChat 2026-09-22 DECISION:
 * User: a Cursor session running Grok 4.7 in Fast mode must show Fast as on. Cursor sets Fast from a checkbox inside its
 * own /model panel, so chat has no toggle for it, but gxserver reads "Fast" off the footer; the disabled button reports
 * that detected state instead of a fixed Off.
 */
function detectedFastLabel(state: SessionChatOptionState): string {
  return state.fastMode?.value === 'on' ? 'On' : 'Off';
}

function asButton(trait: Omit<ModelMenuTrait, 'icon' | 'toggle'>): ModelMenuTrait {
  const next = trait.choices.length <= 2 ? trait.choices.find((choice) => !choice.selected) : undefined;
  return {
    ...trait,
    icon: TRAIT_ICONS[trait.id],
    ...(next ? { toggle: { value: next.value, ...(next.exitPlan ? { exitPlan: true } : {}) } } : {}),
  };
}

/**
 * The footer buttons for the session's current model: reasoning, the context window when the model has
 * two, then every other option the old Options pill listed. Mode stays on its own pill.
 */
export function modelMenuTraits(
  entries: Record<string, ModelMenuEntry[]>,
  params: {
    provider: string | undefined;
    descriptors: readonly SessionChatOptionDescriptor[];
    state: SessionChatOptionState;
    modelId: string | undefined;
    caps: { canPickModel: boolean; queuedControls: boolean; canSendKey: boolean };
  }
): ModelMenuTrait[] {
  const traits: ModelMenuTrait[] = [];
  const model = params.modelId ? params.state[params.modelId]?.value : undefined;
  const entry = modelMenuEntryFor(entries, params.provider, model);
  const option = (descriptor: SessionChatOptionDescriptor): ModelMenuTrait | null => {
    const rows = sessionChatOptionRows(descriptor, params.state, params.caps);
    const label = TRAIT_LABELS[descriptor.id] ?? descriptor.actionLabel ?? descriptor.label;
    if (rows.kind === 'toggle') {
      // `rows.value` is where the toggle would go, so it names the choice that is not selected.
      const held = params.state[descriptor.id]?.value;
      const on = rows.checked ? (held ?? 'on') : rows.value;
      const off = rows.checked ? rows.value : (held ?? 'off');
      return {
        id: descriptor.id,
        label,
        valueLabel: rows.checked ? 'On' : 'Off',
        disabled: rows.disabled,
        choices: [
          { value: on, label: 'On', selected: rows.checked, isDefault: false },
          { value: off, label: 'Off', selected: !rows.checked, isDefault: true, exitPlan: rows.exitPlan },
        ],
      };
    }
    if (rows.kind !== 'choices') return null;
    return {
      id: descriptor.id,
      label,
      valueLabel:
        descriptor.id === 'effort' && rows.current
          ? agentModelCatalogEffortLabel(currentAgentModelCatalog(), rows.current)
          : sessionChatOptionValueLabel(descriptor, params.state),
      choices: rows.sections
        .flatMap((section) => section.choices)
        .map((choice) => ({
          value: choice.value,
          label: choice.label,
          selected: choice.value === rows.current,
          isDefault: choice.value === descriptor.defaultValue,
        })),
    };
  };
  const others = params.descriptors.filter((descriptor) => !isShiftTabModeCycler(descriptor));
  const effort = others.find((descriptor) => descriptor.id === 'effort');
  const fast = others.find((descriptor) => descriptor.id === 'fastMode');
  traits.push(
    (effort && option(effort)) || unavailable('effort', 'Reasoning', 'Default'),
    entry && entry.variants.length > 0
      ? {
          id: 'context',
          label: 'Context Window',
          valueLabel: entry.variants.find((variant) => variant.value === model)?.label ?? null,
          choices: entry.variants.map((variant, index) => ({
            value: variant.value,
            label: variant.label,
            selected: variant.value === model,
            isDefault: index === 0,
          })),
        }
      : unavailable('context', 'Context Window', 'Default'),
    (fast && option(fast)) || unavailable('fastMode', 'Fast mode', detectedFastLabel(params.state))
  );
  for (const descriptor of others) {
    if (descriptor === effort || descriptor === fast) continue;
    const trait = option(descriptor);
    if (trait) traits.push(trait);
  }
  return traits.map(asButton);
}

/** The merged pill: the model's name, then the footer values that are set, as "High · 1M". */
export function modelMenuPillLabels(
  entries: Record<string, ModelMenuEntry[]>,
  provider: string | undefined,
  model: string | undefined,
  modelLabel: string | null,
  traits: readonly ModelMenuTrait[]
): { label: string | null; suffix: string | null } {
  const entry = modelMenuEntryFor(entries, provider, model);
  const parts = traits
    .filter((trait) => (trait.id === 'effort' || trait.id === 'context') && trait.choices.length > 0)
    .map((trait) => trait.valueLabel)
    .filter((value): value is string => !!value);
  return { label: entry?.label ?? modelLabel, suffix: parts.length > 0 ? parts.join(' · ') : null };
}
