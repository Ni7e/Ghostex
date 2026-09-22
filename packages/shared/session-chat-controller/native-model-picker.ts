import { ModelPickerKeyFeedback } from '../session-chat-presentation/model-picker-feedback';
import { getDefaultSidebarAgentById } from '../sidebar-agents';
import { modelPickerArtworkKey, modelPickerEffortArtworkKey } from '../session-chat-presentation/model-picker-artwork';
import {
  modelPickerChooseEffort,
  modelPickerChooseModel,
  modelPickerLayout,
  modelPickerNextEffortIndex,
  modelPickerSupportsSessionScope,
  MODEL_PICKER_DEFAULT_SCOPE_ONLY_REASON,
  type ModelPickerRequest,
  type ModelPickerSelection,
} from '../session-chat-presentation/model-picker';
import type { SessionChatModelSelectionScope } from '../session-chat';
import {
  modelPickerControlForKey,
  ModelPickerWheelNavigation,
  type ModelPickerWheelInput,
  type PickerControl,
} from '../session-chat-presentation/model-picker-input';
import { ModelPickerPaneResize } from '../session-chat-presentation/model-picker-pane-resize';

export class NativeModelPicker {
  readonly request: ModelPickerRequest;
  selection: ModelPickerSelection;
  closing = false;
  saving = false;
  private pointerRailStart: number | null = null;
  private pointerTimer: ReturnType<typeof setTimeout> | undefined;
  private closeTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly feedback: ModelPickerKeyFeedback;
  private readonly wheel = new ModelPickerWheelNavigation();
  private readonly paneResize = new ModelPickerPaneResize();
  private size = { width: 1, height: 1 };
  private controlsHeight = 56;

  /** Claude's `/model` list can commit without saving a default; Codex's cannot. */
  readonly sessionScope: boolean;

  constructor(
    request: ModelPickerRequest,
    private readonly changed: () => void,
    private readonly finished: (selection: ModelPickerSelection | null, scope: SessionChatModelSelectionScope) => void
  ) {
    this.feedback = new ModelPickerKeyFeedback(() => this.changed());
    this.request = request;
    this.selection = { model: request.model, effort: request.effort };
    this.sessionScope = modelPickerSupportsSessionScope(request.provider);
  }

  private get defaultScope(): SessionChatModelSelectionScope {
    return 'default';
  }

  projection() {
    const request = this.request;
    const index = request.models.findIndex((model) => model.value === this.selection.model);
    const model = request.models[index]!;
    const layout = modelPickerLayout(request, index, this.size, this.controlsHeight, this.pointerRailStart);
    const standard = request.provider !== 'claude' && request.provider !== 'codex';
    const agent = getDefaultSidebarAgentById(request.provider)!;
    return {
      ...layout,
      requestId: request.requestId,
      provider: request.provider,
      selection: this.selection,
      agent: { name: agent.name, icon: agent.icon },
      closing: this.closing,
      saving: this.saving,
      sessionScope: this.sessionScope,
      primaryScope: this.defaultScope,
      scopeReason: this.sessionScope ? undefined : MODEL_PICKER_DEFAULT_SCOPE_ONLY_REASON,
      pressed: [...this.feedback.pressed],
      compactControls: this.size.width < 560,
      canUp: index > 0,
      canDown: index < request.models.length - 1,
      canLeft: modelPickerNextEffortIndex(request, this.selection, -1) !== undefined,
      canRight: modelPickerNextEffortIndex(request, this.selection, 1) !== undefined,
      models: request.models
        .map((entry, i) => ({
          ...entry,
          index: i,
          selected: i === index,
          artwork: modelPickerArtworkKey(entry.value, standard),
          y: 71 + layout.railOffset + i * 142,
        }))
        .filter((entry) => !layout.short || entry.selected),
      efforts: request.efforts.map((entry, i) => ({
        ...entry,
        index: i,
        selected: entry.value === this.selection.effort,
        available: model.efforts.some((effort) => effort.value === entry.value),
        artwork: modelPickerEffortArtworkKey(entry.value),
        x: (i < layout.effortSplit ? i - layout.effortSplit : i - layout.effortSplit + 1) * 142,
      })),
      // A model without effort levels (Cursor's Auto) shows only its name.
      effortLabel: request.efforts.find((entry) => entry.value === this.selection.effort)?.label ?? null,
    };
  }

  /** The host reports the owning chat pane's size, starting with the one it had when the picker opened (model-picker-pane-resize.ts). */
  pane(size: { width: number; height: number }) {
    if (this.closing) return;
    if (this.paneResize.resized(size)) this.finish(false);
  }

  measure(size: { width: number; height: number; controlsHeight?: number }) {
    this.size = size;
    this.controlsHeight = size.controlsHeight ?? 56;
  }

  chooseModel(index: number, save = false, pointer = false) {
    if (this.closing) return;
    const choice = modelPickerChooseModel(this.request, this.selection, index);
    if (!choice) return;
    const layout = this.projection();
    clearTimeout(this.pointerTimer);
    this.pointerRailStart = pointer ? layout.firstVisible : null;
    if (pointer)
      this.pointerTimer = setTimeout(() => {
        this.pointerRailStart = null;
        this.changed();
      }, 350);
    this.selection = choice;
    if (save) this.finish(true);
  }

  chooseEffort(index: number, save = false) {
    if (this.closing) return;
    const choice = modelPickerChooseEffort(this.request, this.selection, index);
    if (!choice) return;
    this.selection = choice;
    if (save) this.finish(true);
  }

  navigate(control: PickerControl) {
    if (this.closing) return;
    this.feedback.pulse(control);
    const modelIndex = this.request.models.findIndex((entry) => entry.value === this.selection.model);
    if (control === 'ArrowUp') this.chooseModel(modelIndex - 1);
    if (control === 'ArrowDown') this.chooseModel(modelIndex + 1);
    if (control === 'ArrowLeft' || control === 'ArrowRight') {
      const next = modelPickerNextEffortIndex(this.request, this.selection, control === 'ArrowLeft' ? -1 : 1);
      if (next !== undefined) this.chooseEffort(next);
    }
    if (control === 'EnterAlternate' && this.sessionScope)
      this.finish(true, this.defaultScope === 'session' ? 'default' : 'session');
    if (control === 'Enter' || control === 'Escape') this.finish(control === 'Enter');
  }

  key(input: Parameters<typeof modelPickerControlForKey>[0] & { code?: string }) {
    const control = modelPickerControlForKey(input);
    if (control) {
      this.feedback.press(input.code || input.key, control);
      this.navigate(control);
    }
  }
  release(key: string) {
    this.feedback.release(key);
  }
  blur() {
    this.feedback.blur();
  }

  scroll(input: ModelPickerWheelInput) {
    const control = this.wheel.update(input);
    if (control) this.navigate(control);
  }

  /**
   * CDXC:SessionChat 2026-09-23 DECISION:
   * User: Escape closes the quick model picker instantly instead of waiting, then closing. Only a
   * save plays the 190ms close animation; every cancel (Escape, a click outside, the hotkey again)
   * closes on the next tick. SEE-ALSO: session-chat-model-picker.tsx and gx-chat-core's
   * menus/picker/native.rs keep the same rule.
   */
  finish(save: boolean, scope: SessionChatModelSelectionScope = this.defaultScope) {
    if (this.closing) return;
    this.closing = true;
    this.saving = save;
    this.closeTimer = setTimeout(() => this.finished(save ? this.selection : null, scope), save ? 190 : 0);
  }

  dispose() {
    clearTimeout(this.pointerTimer);
    clearTimeout(this.closeTimer);
    this.feedback.dispose();
  }
}
