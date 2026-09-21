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
 * CDXC:SessionChat 2026-09-21 DECISION:
 * User: "left-clicking on a model selected, as always, the default. Right-clicking should just apply that for that session." The Session-only model picks setting and the Also set as default switch are removed.
 * This supersedes the 2026-09-19 decision that a setting and a per-session switch chose the scope. The big picker keeps the same split on the keyboard: Enter saves the default, Shift+Enter applies to the session alone.
 */
export function modelPickScope(provider: ModelPickerProvider | undefined, secondary: boolean): 'session' | 'default' {
  return secondary && provider && modelPickerSupportsSessionScope(provider) ? 'session' : 'default';
}

/** Shown for every agent whose picker cannot apply a choice to one session: Codex, Cursor, Grok, Antigravity. */
export const MODEL_PICKER_DEFAULT_SCOPE_ONLY_REASON =
  "This agent's model picker always saves the choice as its default.";

export function modelPickerLayout(
  request: ModelPickerRequest,
  modelIndex: number,
  paneSize: { width: number; height: number },
  controlsHeight: number,
  pointerRailStart: number | null
) {
  const narrow = paneSize.width <= 920;
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
