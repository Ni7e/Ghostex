export interface ModelPickerModel {
  value: string;
  label: string;
  version?: string;
  efforts: { value: string; label: string }[];
  defaultEffort?: string;
}
export type ModelPickerProvider = 'codex' | 'claude' | 'cursor' | 'grok' | 'antigravity';
export interface ModelPickerRequest {
  requestId: string;
  provider: ModelPickerProvider;
  models: ModelPickerModel[];
  efforts: { value: string; label: string }[];
  model: string;
  effort: string;
}
export interface ModelPickerSelection {
  model: string;
  effort: string;
}

/**
 * Whether this agent's own picker can apply a choice without changing its saved default.
 * Claude Code's `/model` list answers `s` with "for this session only"; Codex's picker writes
 * `model` and `model_reasoning_effort` into `~/.codex/config.toml` on every confirm.
 */
export function modelPickerSupportsSessionScope(provider: ModelPickerProvider): boolean {
  return provider === 'claude';
}

/**
 * CDXC:SessionChat 2026-09-19 DECISION:
 * User: session-only model and effort picks must not be the default; they are the `sessionChatModelPicksSessionOnly` setting under Settings, Agents, Config, off by default.
 * This supersedes the 2026-09-18 decision that a pick was session-only unless the session ticked Also set as default. Off, a pill pick and the picker's Enter save the agent's default as they always did; on, they apply to the session alone. The per-session switch and the picker's Shift+Enter still reach the other scope either way.
 * Hosts adopt the saved setting here so React, GPUI, and the picker window read one value.
 */
let picksSessionOnly = false;
const picksSessionOnlyListeners = new Set<() => void>();
export const modelPicksSessionOnly = () => picksSessionOnly;
export function adoptModelPicksSessionOnly(next: boolean): void {
  if (next === picksSessionOnly) return;
  picksSessionOnly = next;
  for (const listener of picksSessionOnlyListeners) listener();
}
export function subscribeModelPicksSessionOnly(listener: () => void): () => void {
  picksSessionOnlyListeners.add(listener);
  return () => {
    picksSessionOnlyListeners.delete(listener);
  };
}

/** The scope the big picker's Enter commits with; Shift+Enter commits the other one where the agent has two. */
export function modelPickerPrimaryScope(provider: ModelPickerProvider, sessionOnly: boolean): 'session' | 'default' {
  return modelPickerSupportsSessionScope(provider) && sessionOnly ? 'session' : 'default';
}

/** A session that never touched its Also set as default switch follows the setting. */
export function modelScopeAlsoSetDefault(stored: boolean | null, sessionOnly: boolean): boolean {
  return stored ?? !sessionOnly;
}

/** Shown for every agent whose picker cannot apply a choice to one session: Codex, Cursor, Grok, Antigravity. */
export const MODEL_PICKER_DEFAULT_SCOPE_ONLY_REASON =
  "This agent's model picker always saves the choice as its default.";

export const MODEL_SCOPE_DEFAULT_ROW_LABEL = 'Also set as default';

/**
 * The checkbox the composer's model and effort pills carry, in both renderers. An agent that cannot
 * apply a pick to one session shows it checked and disabled, with the reason, rather than hiding it.
 */
export function modelScopeMenuRow(
  provider: ModelPickerProvider | undefined,
  alsoSetDefault: boolean
): { label: string; description?: string; checked: boolean; disabled: boolean } | null {
  if (!provider) return null;
  if (!modelPickerSupportsSessionScope(provider))
    return {
      label: MODEL_SCOPE_DEFAULT_ROW_LABEL,
      description: MODEL_PICKER_DEFAULT_SCOPE_ONLY_REASON,
      checked: true,
      disabled: true,
    };
  return { label: MODEL_SCOPE_DEFAULT_ROW_LABEL, checked: alsoSetDefault, disabled: false };
}

/** The scope a pill pick commits with. The big picker asks per pick instead. */
export function modelScopeForPills(
  provider: ModelPickerProvider | undefined,
  alsoSetDefault: boolean
): 'session' | 'default' {
  return provider && modelPickerSupportsSessionScope(provider) && !alsoSetDefault ? 'session' : 'default';
}

export function modelPickerLayout(
  request: ModelPickerRequest,
  modelIndex: number,
  paneSize: { width: number; height: number },
  controlsHeight: number,
  pointerRailStart: number | null
) {
  const narrow = paneSize.width <= 700;
  const viewportHeight = Math.max(1, paneSize.height - controlsHeight - 24);
  const stageWidth = Math.max(1180, Math.ceil(request.efforts.length / 2) * 284 + 328);
  const widthScale = Math.max(0.01, Math.min(1, (paneSize.width - 28) / (narrow ? 240 : stageWidth - 120)));
  const short = viewportHeight - 24 < 3 * 142 * widthScale;
  const scale = Math.max(0.01, Math.min(widthScale, (viewportHeight - 24) / (short ? 200 : 3 * 142)));
  const visibleModels = short
    ? 1
    : Math.min(request.models.length, Math.max(3, Math.floor((viewportHeight - 24) / (142 * scale))));
  const firstVisible = short
    ? modelIndex
    : (pointerRailStart ??
      Math.max(0, Math.min(request.models.length - visibleModels, modelIndex - Math.floor(visibleModels / 2))));
  const stageHeight = viewportHeight / scale;
  const railOffset = (stageHeight - visibleModels * 142) / 2 - firstVisible * 142;
  const centerY = 71 + modelIndex * 142 + railOffset;
  const effortSplit = Math.ceil(request.efforts.length / 2);
  return {
    narrow,
    viewportHeight,
    stageWidth,
    short,
    scale,
    visibleModels,
    firstVisible,
    stageHeight,
    railOffset,
    centerY,
    effortSplit,
  };
}

export function modelPickerChooseModel(
  request: ModelPickerRequest,
  selection: ModelPickerSelection,
  index: number
): ModelPickerSelection | undefined {
  const next = request.models[index];
  if (!next) return;
  return {
    model: next.value,
    effort: next.efforts.some((effort) => effort.value === selection.effort)
      ? selection.effort
      : (next.efforts.find((effort) => effort.value === next.defaultEffort)?.value ?? next.efforts[0]?.value ?? ''),
  };
}

export function modelPickerChooseEffort(
  request: ModelPickerRequest,
  selection: ModelPickerSelection,
  index: number
): ModelPickerSelection | undefined {
  const next = request.efforts[index];
  const model = request.models.find((entry) => entry.value === selection.model);
  if (!next || !model?.efforts.some((entry) => entry.value === next.value)) return;
  return { ...selection, effort: next.value };
}

export function modelPickerNextEffortIndex(
  request: ModelPickerRequest,
  selection: ModelPickerSelection,
  direction: -1 | 1
): number | undefined {
  const effortIndex = request.efforts.findIndex((effort) => effort.value === selection.effort);
  for (let index = effortIndex + direction; index >= 0 && index < request.efforts.length; index += direction) {
    if (modelPickerChooseEffort(request, selection, index)) return index;
  }
}
