import {
  sessionChatOptionChoiceSections,
  sessionChatOptionTracksValue,
  type SessionChatOptionDescriptor,
  type SessionChatOptionState,
  type SessionChatSessionOptionCatalog,
} from '@/packages/core-ui/chat/session-chat-session-options';

export function isShiftTabModeCycler(descriptor: SessionChatOptionDescriptor): boolean {
  return (
    descriptor.category === 'mode' &&
    descriptor.dispatch.kind === 'cyclic-key-steps' &&
    descriptor.dispatch.key === 'shift-tab'
  );
}

export function isCodexPlanModeToggle(descriptor: SessionChatOptionDescriptor): boolean {
  return descriptor.id === 'mode' && descriptor.dispatch.kind === 'toggle-command';
}

export function optionMenuSections(descriptors: readonly SessionChatOptionDescriptor[]) {
  const sections: { label: string; description?: string; descriptors: SessionChatOptionDescriptor[] }[] = [];
  for (const descriptor of descriptors) {
    const last = sections[sections.length - 1];
    if (last?.label === descriptor.label) last.descriptors.push(descriptor);
    else sections.push({ label: descriptor.label, description: descriptor.description, descriptors: [descriptor] });
  }
  return sections;
}

export function visibleSessionChatOptions(
  descriptors: readonly SessionChatOptionDescriptor[],
  { canSendKey, canPickModel, queuedControls }: { canSendKey: boolean; canPickModel: boolean; queuedControls: boolean }
) {
  return descriptors.filter(
    (descriptor) =>
      ((descriptor.dispatch.kind !== 'key' &&
        descriptor.dispatch.kind !== 'bounded-key-steps' &&
        descriptor.dispatch.kind !== 'cyclic-key-steps') ||
        canSendKey ||
        (queuedControls && descriptor.id === 'mode')) &&
      (descriptor.dispatch.kind !== 'model-picker' || canPickModel)
  );
}

export function sessionChatOptionsMayResolve(catalog: SessionChatSessionOptionCatalog, canSendKey: boolean): boolean {
  return (catalog.model.choices ?? []).some((choice) =>
    catalog
      .optionsForModel(choice.value)
      .some(
        (descriptor) =>
          !isShiftTabModeCycler(descriptor) &&
          (canSendKey ||
            (descriptor.dispatch.kind !== 'key' &&
              descriptor.dispatch.kind !== 'bounded-key-steps' &&
              descriptor.dispatch.kind !== 'cyclic-key-steps'))
      )
  );
}

export function sessionChatOptionRows(
  descriptor: SessionChatOptionDescriptor,
  state: SessionChatOptionState,
  { canPickModel, queuedControls, canSendKey }: { canPickModel: boolean; queuedControls: boolean; canSendKey: boolean }
) {
  const label = descriptor.actionLabel ?? descriptor.label;
  if (descriptor.dispatch.kind === 'model-picker' && !canPickModel) {
    return { kind: 'action' as const, label: descriptor.actionLabel ?? "Open the CLI's model picker" };
  }
  if (descriptor.dispatch.kind === 'toggle-command' && descriptor.id === 'fastMode') {
    const checked = state.fastMode?.value === 'on';
    return { kind: 'toggle' as const, label, checked, value: checked ? 'off' : 'on', disabled: false, exitPlan: false };
  }
  if (isCodexPlanModeToggle(descriptor)) {
    const checked = state.mode?.value === 'plan';
    return {
      kind: 'toggle' as const,
      label,
      checked,
      value: checked ? 'default' : 'plan',
      disabled: !queuedControls && checked && !canSendKey,
      exitPlan: checked,
    };
  }
  if (sessionChatOptionTracksValue(descriptor)) {
    return {
      kind: 'choices' as const,
      sections: sessionChatOptionChoiceSections(descriptor),
      current: state[descriptor.id]?.value,
    };
  }
  return { kind: 'action' as const, label };
}
