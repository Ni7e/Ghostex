import type { SessionChatModelSelectionScope, SessionChatSendKey, SessionChatSelectionOptions } from '../session-chat';
import type { ModelPickerSelection } from '../session-chat-presentation/model-picker';
import type { SessionChatOptionDispatchReceipt } from './option-state';
import {
  sessionChatBoundedKeySteps,
  sessionChatCyclicKeySteps,
  type SessionChatOptionDescriptor,
  type SessionChatOptionState,
  type SessionChatSessionOptionCatalog,
} from '@/packages/core-ui/chat/session-chat-session-options';

interface OptionTarget {
  catalog: SessionChatSessionOptionCatalog | null;
  state: SessionChatOptionState;
}

export function queueSessionChatOption(
  descriptor: SessionChatOptionDescriptor,
  value: string | undefined,
  {
    catalog,
    state,
    queuedControls,
    quickPicker,
    picker,
    scope,
  }: OptionTarget & {
    queuedControls: boolean;
    quickPicker: boolean;
    /** Where a model or effort pick from these pills lands; see modelScopeForPills. */
    scope?: SessionChatModelSelectionScope;
    picker: {
      select(selection: ModelPickerSelection, options?: SessionChatSelectionOptions, scope?: SessionChatModelSelectionScope): void;
      selectOptions(options: SessionChatSelectionOptions): void;
    } | null;
  }
): boolean {
  if (queuedControls && value !== undefined && (descriptor.id === 'mode' || descriptor.id === 'fastMode')) {
    picker?.selectOptions(descriptor.id === 'mode' ? { mode: value } : { fastMode: value === 'on' ? 'on' : 'off' });
    return true;
  }
  if (
    value !== undefined &&
    quickPicker &&
    catalog &&
    (descriptor.id === catalog.model.id || descriptor.id === 'effort')
  ) {
    const model = descriptor.id === catalog.model.id ? value : state[catalog.model.id]?.value;
    if (!model) return true;
    const effortOption = catalog.optionsForModel(model).find((entry) => entry.id === 'effort');
    const preferred = descriptor.id === 'effort' ? value : state.effort?.value;
    const effort =
      effortOption?.choices?.find((entry) => entry.value === preferred)?.value ??
      effortOption?.defaultValue ??
      effortOption?.choices?.[0]?.value ??
      '';
    picker?.select({ model, effort }, undefined, scope);
    return true;
  }
  return false;
}

export async function dispatchSessionChatOption(
  descriptor: SessionChatOptionDescriptor,
  value: string | undefined,
  {
    catalog,
    state,
    beginDispatch,
    onDispatchCommand,
    onDispatchKey,
    onPickModel,
    onSwitchToTerminal,
    onSwitchingChange,
  }: OptionTarget & {
    beginDispatch(values: Readonly<Record<string, string>>): SessionChatOptionDispatchReceipt;
    onDispatchCommand(text: string): Promise<void>;
    onDispatchKey(key: SessionChatSendKey, marker: string): Promise<void>;
    onPickModel?: (selection: ModelPickerSelection) => Promise<void>;
    onSwitchToTerminal?: () => void;
    onSwitchingChange?: (switching: boolean) => void;
  }
): Promise<void> {
  let receipt: SessionChatOptionDispatchReceipt | undefined;
  if (value !== undefined && descriptor.dispatch.kind !== 'model-picker') {
    receipt = beginDispatch({ [descriptor.id]: value });
  }
  const run = async (): Promise<void> => {
    const { dispatch: delivery } = descriptor;
    if (delivery.kind === 'command') {
      await onDispatchCommand(delivery.build(value ?? ''));
      return;
    }
    if (delivery.kind === 'command-confirm-picker') {
      await onDispatchCommand(delivery.build(value ?? ''));
      await onDispatchKey('enter', '');
      return;
    }
    if (delivery.kind === 'toggle-command') {
      await onDispatchCommand(delivery.command);
      return;
    }
    if (delivery.kind === 'model-picker') {
      if (!onPickModel || value === undefined || catalog === null) {
        // No daemon route: the agent's own picker in the terminal is the
        // only way to change it, exactly as `agent-picker` behaves.
        await onDispatchCommand('/model');
        onSwitchToTerminal?.();
        return;
      }
      const currentModel = state[catalog.model.id]?.value;
      const currentEffort = state.effort?.value;
      const model = descriptor.id === catalog.model.id ? value : currentModel;
      const effort =
        descriptor.id === 'effort' ? value : model ? catalog.pickerEffortFor?.(model, currentEffort) : undefined;
      if (!model || !effort) {
        throw new Error('The current model is not known yet, so there is nothing to change it from.');
      }
      receipt = beginDispatch({ [catalog.model.id]: model, effort });
      await onPickModel({ model, effort });
      return;
    }
    if (delivery.kind === 'agent-picker') {
      await onDispatchCommand(delivery.command);
      onSwitchToTerminal?.();
      return;
    }
    if (delivery.kind === 'terminal-handoff') {
      // Nothing is typed: the agent's own picker owns the change.
      onSwitchToTerminal?.();
      return;
    }
    if (delivery.kind === 'bounded-key-steps') {
      const keys = sessionChatBoundedKeySteps(
        descriptor.choices ?? [],
        state[descriptor.id]?.value,
        value ?? '',
        delivery.decreaseKey,
        delivery.increaseKey
      );
      for (const key of keys) {
        await onDispatchKey(key, '');
      }
      return;
    }
    if (delivery.kind === 'cyclic-key-steps') {
      const keys = sessionChatCyclicKeySteps(
        descriptor.choices ?? [],
        state[descriptor.id]?.value,
        value ?? '',
        delivery.key
      );
      if (value === undefined || keys.length === 0) {
        return;
      }
      onSwitchingChange?.(true);
      try {
        for (const key of keys) {
          await onDispatchKey(key, '');
        }
      } finally {
        onSwitchingChange?.(false);
      }
      return;
    }
    await onDispatchKey(delivery.key, delivery.marker);
  };
  try {
    await run();
    receipt?.complete();
  } catch (error) {
    receipt?.rollback();
    throw error;
  }
}
