import { nativeOptionMenus } from './native-option-menus';
import {
  sessionChatAccountIndicator,
  sessionChatOptionPillValues,
  sessionChatOptionsTitle,
} from '../session-chat-presentation/option-pills';
import {
  sessionChatOptionsMayResolve,
  visibleSessionChatOptions,
  isShiftTabModeCycler,
  optionMenuSections,
} from '../session-chat-presentation/option-menu';
import type { UseSessionChatResult } from '@/packages/core-ui/chat/use-session-chat/state';
import type { SessionChatOptionState } from '@/packages/core-ui/chat/session-chat-session-options';
import { currentAgentModelCatalog, subscribeAgentModelCatalog } from '../agent-model-catalog-state';
import { modelPickerProvider } from '../session-chat-presentation/model-picker-request';
import type { ChatLifecycle } from './lifecycle';
import { computeSessionChatOptions } from './session-options';
import {
  computeModelSelectionOutbox,
  queuedModelSelection,
  type ModelSelectionIntent,
  type ModelSelectionPersistence,
} from './model-selection';
import type { SessionChatOptionPersistence } from './option-state';
import type { AgentAccountsState } from '../agent-accounts';
import type { ModelMenuContext } from './model-menu';

export interface NativeOptionSeed {
  sessionKey: string;
  optionStates: Record<string, SessionChatOptionState>;
  modelOutboxes: Record<string, ModelSelectionIntent | null>;
}

export function nativeOptionPersistence(
  seed: NativeOptionSeed,
  composer: (operation: string, params: Record<string, unknown>) => Promise<unknown>,
  onError: (error: unknown) => void
) {
  const options: SessionChatOptionPersistence = {
    read: (key) => (key ? (seed.optionStates[key] ?? {}) : {}),
    write: (key, state) => {
      if (!key) return;
      seed.optionStates[key] = state;
      void composer('optionWrite', { optionKey: key, optionState: state }).catch(onError);
    },
  };
  const model: ModelSelectionPersistence = {
    read: (key) => seed.modelOutboxes[key] ?? null,
    write: async (key, value) => {
      seed.modelOutboxes[key] = value;
      await composer('modelWrite', { optionKey: key, modelSelection: value });
    },
    acknowledge: async (key, id) => {
      await composer('modelAck', { optionKey: key, selectionId: id });
      if (seed.modelOutboxes[key]?.id === id) seed.modelOutboxes[key] = null;
    },
  };
  return { sessionKey: seed.sessionKey, options, model };
}

export function computeNativeChatOptions(
  chat: UseSessionChatResult,
  persistence: ReturnType<typeof nativeOptionPersistence>,
  rpc: <T>(method: string, params: Record<string, unknown>) => Promise<T>,
  onUnconfirmed: () => void,
  accounts: AgentAccountsState | undefined,
  lifecycle: ChatLifecycle
) {
  const { useMemo, useState, useLayoutEffect } = lifecycle;
  const [catalog, setCatalog] = useState(currentAgentModelCatalog);
  useLayoutEffect(() => subscribeAgentModelCatalog(() => setCatalog(currentAgentModelCatalog())), []);
  const sessionOptions = computeSessionChatOptions(
    {
      agent: chat.agent,
      draftAgentId: chat.availableAgents ? chat.sessionAgentId : undefined,
      sessionKey: persistence.sessionKey,
      agentModelCatalog: catalog,
      persistence: persistence.options,
      onUnconfirmed,
    },
    lifecycle
  );
  useLayoutEffect(
    () => sessionOptions.applyDetected(chat.selectedOptions),
    [sessionOptions.applyDetected, chat.selectedOptions]
  );
  const provider = modelPickerProvider(sessionOptions.catalog?.modelIcon);
  const canQueue = chat.pendingModelSelection !== undefined && provider !== undefined;
  const deliver = useMemo(
    () => (canQueue ? queuedModelSelection((params) => rpc('selectSessionChatModel', params)) : undefined),
    [canQueue]
  );
  const modelSelection = computeModelSelectionOutbox(
    {
      sessionKey: sessionOptions.sessionKey,
      pending: chat.pendingModelSelection,
      beginDispatch: sessionOptions.beginDispatch,
      deliver,
      persistence: persistence.model,
    },
    lifecycle
  );
  const menus = nativeOptionMenus(sessionOptions, {
    quickPicker: !!provider,
    canPickModel: canQueue,
    working: chat.working,
    canSendKey: !!chat.sendKey,
    draftAgents: chat.availableAgents,
    draftAgentId: chat.sessionAgentId,
    provider,
    selectionError: modelSelection.selectionError,
  });
  const values = sessionChatOptionPillValues(
    sessionOptions.catalog,
    sessionOptions.optionDescriptors,
    sessionOptions.state
  );
  const sections = optionMenuSections(
    visibleSessionChatOptions(sessionOptions.optionDescriptors, {
      canSendKey: !!chat.sendKey,
      canPickModel: canQueue,
      queuedControls: !!provider,
    }).filter((descriptor) => !isShiftTabModeCycler(descriptor))
  );
  const draftAgent = chat.availableAgents?.find((agent) => agent.agentId === chat.sessionAgentId);
  const queuedControls = sessionOptions.catalog?.modelIcon === 'codex' || sessionOptions.catalog?.modelIcon === 'claude';
  // Agents outside the model catalog keep their own model and options pills; the picker needs a provider's lineup.
  const modelMenuContext: ModelMenuContext | null =
    provider && sessionOptions.catalog
      ? {
          provider,
          modelId: sessionOptions.catalog.model.id,
          modelDefault: sessionOptions.catalog.model.defaultValue,
          modelLabel: values.model,
          descriptors: visibleSessionChatOptions(sessionOptions.optionDescriptors, {
            canSendKey: !!chat.sendKey,
            canPickModel: canQueue,
            queuedControls,
          }),
          state: sessionOptions.state,
          caps: { canPickModel: canQueue, queuedControls, canSendKey: !!chat.sendKey },
          selectionError: modelSelection.selectionError,
          disabled: !canQueue,
        }
      : null;
  return {
    sessionOptions,
    modelSelection,
    modelProvider: provider,
    modelMenuContext,
    optionMenus: menus,
    optionLabels: {
      ...values,
      accountIndicator: sessionChatAccountIndicator(accounts),
      optionsTitle: sessionChatOptionsTitle(sections, values.fast, values.plan),
      optionsTooltip: sessionChatOptionsTitle(sections, values.fast, values.plan, provider ? ' ({shortcut})' : ''),
      modelQuickPicker: !!provider,
      ...(!sessionOptions.catalog && draftAgent
        ? { model: draftAgent.name, modelDisplay: draftAgent.name, agentIcon: draftAgent.icon }
        : {}),
      showModel: !!sessionOptions.catalog || menus.model.length > 0,
      showOptions:
        menus.options.length > 0 ||
        (!values.options &&
          !!sessionOptions.catalog &&
          sessionChatOptionsMayResolve(sessionOptions.catalog, !!chat.sendKey)),
    },
  };
}
