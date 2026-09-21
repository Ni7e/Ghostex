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
export const MODEL_MENU_PROVIDERS: readonly ModelPickerProvider[] = ['claude', 'codex', 'cursor', 'grok', 'antigravity'];
export const MODEL_MENU_FAVORITES_TAB = 'favorites';
export type ModelMenuTabId = typeof MODEL_MENU_FAVORITES_TAB | ModelPickerProvider;
export const MODEL_MENU_SEARCH_PLACEHOLDER = 'Search models…';
export const MODEL_MENU_SHORTCUT_ROWS = 9;

/** The long-context twin of a model is the same row with another Context Window choice. */
const LONG_CONTEXT_SUFFIX = '[1m]';
const CONTEXT_LABELS = { standard: '200K', long: '1M' } as const;

export interface ModelMenuTab {
  id: ModelMenuTabId;
  /** Agent logo file name; absent on the favorites tab, which draws a star. */
  icon?: string;
  name: string;
  active: boolean;
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

export interface ModelMenuRow extends ModelMenuEntry {
  key: string;
  favorite: boolean;
  selected: boolean;
  /** 1 to 9 for the rows Cmd+number reaches. */
  shortcut?: number;
  /** Favorites mix agents, so those rows name theirs on a second line. */
  showAgent: boolean;
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
  /** The glyph drawn beside the value: a brain for reasoning, chart bars for the context window, a bolt for fast mode. */
  icon?: 'reasoning' | 'context' | 'fast';
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
    .sort((a, b) => a.rank - b.rank || Number(b.favorite) - Number(a.favorite) || a.index - b.index);
  const current = modelMenuEntryFor(entries, params.current.provider, params.current.model);
  return ranked.map(({ entry, favorite }, index) => ({
    ...entry,
    key: modelMenuFavoriteKey(entry.provider, entry.value),
    favorite,
    selected: current !== undefined && current.provider === entry.provider && current.value === entry.value,
    shortcut: index < MODEL_MENU_SHORTCUT_ROWS ? index + 1 : undefined,
    showAgent: favoritesTab,
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

const TRAIT_LABELS: Record<string, string> = { effort: 'Reasoning' };
const TRAIT_ICONS: Record<string, ModelMenuTrait['icon']> = { effort: 'reasoning', context: 'context', fastMode: 'fast' };

/**
 * CDXC:SessionChat 2026-09-21 DECISION:
 * User: Reasoning, Context Window and Fast Mode are three buttons along the bottom of the picker, each an icon beside its value (brain, chart bars, bolt); clicking Fast or the Context Window toggles it, since it usually has only two values.
 * This supersedes the full-width footer rows that each opened a side list; only a button with more than two values, such as Reasoning, still opens one.
 */
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
  const reasoning = effort ? option(effort) : null;
  if (reasoning) traits.push(reasoning);
  if (entry && entry.variants.length > 0)
    traits.push({
      id: 'context',
      label: 'Context Window',
      valueLabel: entry.variants.find((variant) => variant.value === model)?.label ?? null,
      choices: entry.variants.map((variant, index) => ({
        value: variant.value,
        label: variant.label,
        selected: variant.value === model,
        isDefault: index === 0,
      })),
    });
  for (const descriptor of others) {
    if (descriptor === effort) continue;
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
    .filter((trait) => trait.id === 'effort' || trait.id === 'context')
    .map((trait) => trait.valueLabel)
    .filter((value): value is string => !!value);
  return { label: entry?.label ?? modelLabel, suffix: parts.length > 0 ? parts.join(' · ') : null };
}
