import type { SessionChatAvailableAgent } from '../session-chat';
import {
  isShiftTabModeCycler,
  optionMenuSections,
  sessionChatOptionRows,
  visibleSessionChatOptions,
} from '../session-chat-presentation/option-menu';
import type { computeSessionChatOptions } from './session-options';
import type { SessionChatOptionDescriptor } from '@/packages/core-ui/chat/session-chat-session-options';

export interface NativeChatMenuItem {
  id: string;
  label?: string;
  description?: string;
  detail?: string;
  hotkeyAction?: string;
  icon?: string;
  separator?: boolean;
  heading?: boolean;
  checked?: boolean;
  disabled?: boolean;
  children?: NativeChatMenuItem[];
  command?: Record<string, unknown>;
}

export function nativeOptionMenus(
  controller: ReturnType<typeof computeSessionChatOptions>,
  params: {
    quickPicker: boolean;
    canPickModel: boolean;
    working: boolean;
    canSendKey: boolean;
    draftAgents: readonly SessionChatAvailableAgent[] | null;
    draftAgentId: string | null;
  }
) {
  const { catalog, state, optionDescriptors } = controller;
  const queuedControls = catalog?.modelIcon === 'codex' || catalog?.modelIcon === 'claude';
  const caps = { canPickModel: params.canPickModel, canSendKey: params.canSendKey, queuedControls };
  const rows = (descriptor: SessionChatOptionDescriptor): NativeChatMenuItem[] => {
    const presentation = sessionChatOptionRows(descriptor, state, caps);
    const command = { type: 'selectOption', descriptorId: descriptor.id };
    const disabled =
      params.working &&
      !(
        (params.quickPicker && (descriptor.id === 'model' || descriptor.id === 'effort')) ||
        (queuedControls && (descriptor.id === 'mode' || descriptor.id === 'fastMode'))
      );
    if (presentation.kind === 'action') return [{ id: descriptor.id, label: presentation.label, disabled, command }];
    if (presentation.kind === 'toggle')
      return [
        {
          id: descriptor.id,
          label: presentation.label,
          checked: presentation.checked,
          disabled: disabled || presentation.disabled,
          command: { ...command, value: presentation.value, exitPlan: presentation.exitPlan },
        },
      ];
    return presentation.sections.flatMap((section): NativeChatMenuItem[] => {
      const choices = section.choices.map((choice) => ({
        id: `${descriptor.id}:${choice.value}`,
        label: choice.label,
        description: choice.description,
        checked: presentation.current === choice.value,
        disabled,
        command: { ...command, value: choice.value },
      }));
      return section.kind === 'choices'
        ? choices
        : [
            {
              id: section.key,
              label: section.group.label,
              description: section.group.description,
              detail: section.choices.find((choice) => choice.value === presentation.current)?.label,
              children: choices,
            },
          ];
    });
  };
  const model: NativeChatMenuItem[] = [];
  if (params.draftAgents?.length) {
    model.push(
      {
        id: 'agents',
        label: 'Switch Agent CLI',
        children: params.draftAgents.map((agent) => ({
          id: agent.agentId,
          label: agent.name,
          icon: agent.icon,
          checked: agent.agentId === params.draftAgentId,
          command: { type: 'switchDraftAgent', agentId: agent.agentId },
        })),
      },
      { id: 'agents-separator', separator: true }
    );
  }
  if (!catalog) return { model, options: [], mode: [] };
  if (params.quickPicker)
    model.push({
      id: 'quick-picker',
      label: 'Quick picker',
      hotkeyAction: 'openModelPicker',
      command: { type: 'toggleModelPicker' },
    });
  model.push(
    { id: 'model-heading', heading: true, label: catalog.model.label, description: catalog.model.description },
    ...rows(catalog.model)
  );
  const visibleOptions = visibleSessionChatOptions(optionDescriptors, caps);
  const mode = visibleOptions.find(isShiftTabModeCycler);
  const options = optionMenuSections(visibleOptions.filter((descriptor) => !isShiftTabModeCycler(descriptor))).flatMap(
    (section, index): NativeChatMenuItem[] => [
      ...(index > 0 ? [{ id: `${section.label}:separator`, separator: true }] : []),
      { id: `${section.label}:heading`, label: section.label, description: section.description, heading: true },
      ...section.descriptors.flatMap(rows),
    ]
  );
  return {
    model,
    options,
    mode: mode
      ? [{ id: 'mode-heading', heading: true, label: mode.label, description: mode.description }, ...rows(mode)]
      : [],
  };
}
