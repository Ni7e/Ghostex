/**
 * FROZEN copy of the TypeScript sidebar page, which was deleted on 2026-09-21 (M4d part 2). It is
 * kept only so the parity gates beside it still have the behaviour the app shipped on that date to
 * compare the Rust store against: a clean run proves Rust still matches THAT, not that it matches
 * the app. Never edit this file to make a gate pass; change the Rust and re-record, or delete the
 * gate.
 */
import { nativeTagPresentation } from '@/apps/desktop/sidebar/native-quick-access/tag-presentation';
import { resolveSessionChatTranscriptAgent } from '@/packages/shared/session-chat';
import { buildSidebarSessionDetailsClipboardText } from '@/packages/shared/session-details-copy';
import {
  getSidebarSessionContextMenuEligibility,
  canSleepSidebarSession,
} from '@/packages/core-ui/session-card-capabilities';
import {
  getSidebarSessionLifecycleState,
  type SidebarSessionItem,
  type SidebarSessionGroup,
  type SidebarToExtensionMessage,
} from '@/packages/shared/session-grid-contract';
import {
  getEffectiveSidebarSessionTag,
  getEnabledVisibleSidebarSessionTagSections,
  type CustomSessionTagsState,
} from '@/packages/shared/session-tags';
import {
  splitSessionCardHoverButtons,
  type SessionCardHoverAction,
} from '@/packages/shared/session-card-hover-actions';
import {
  isSidebarSessionSnoozed,
  SESSION_SNOOZE_PRESETS,
  SESSION_SNOOZE_PRESET_LABELS,
} from '@/packages/shared/session-snooze';
import type { ghostexSettings } from '@/packages/shared/ghostex-settings';
import type { NativeSidebarCommand, NativeSidebarMenuItem } from '@/packages/shared/native-sidebar';

export function createNativeSessionActions(
  session: SidebarSessionItem,
  settings: ghostexSettings,
  group: Omit<SidebarSessionGroup, 'sessions'>,
  customTags?: CustomSessionTagsState,
  below: SidebarSessionItem[] = [],
  includeMenu = true
) {
  const id = session.sessionId;
  const caps = getSidebarSessionContextMenuEligibility({
    session,
    isRemoteSession: !!group.remoteMachineContext,
    isProjectSessionListMoreRow: false,
    showSessionCommandCopyActions: settings.showSessionCommandCopyActions,
    showSessionDetailsCopyAction: settings.showSessionDetailsCopyAction,
  });
  const runtime = (label: string, icon: string, message: SidebarToExtensionMessage): NativeSidebarMenuItem => ({
    label,
    icon,
    command: { type: 'command', message },
  });
  const intent = (
    label: string,
    icon: string,
    action: Extract<NativeSidebarCommand, { type: 'sessionAction' }>['action']
  ): NativeSidebarMenuItem => ({ label, icon, command: { type: 'sessionAction', sessionId: id, action } });
  const tag = getEffectiveSidebarSessionTag(session);
  const tagSections = getEnabledVisibleSidebarSessionTagSections(settings.sidebarSessionTagListItems, {
    customTags,
    includeTags: tag ? [tag] : [],
  });
  const lazyMenu = (action?: SessionCardHoverAction): NativeSidebarMenuItem[] => [
    {
      label: 'Loading…',
      disabled: true,
      menuOwner: `session:${id}`,
      onOpen: { type: 'sessionMenu', sessionId: id, action, ownerId: `session:${id}` },
    },
  ];
  const tags: NativeSidebarMenuItem[] = !includeMenu
    ? tagSections.some((section) => section.options.length) || !group.remoteMachineContext
      ? lazyMenu('tag')
      : []
    : tagSections.flatMap((section, index) => [
        ...(index ? [{ separator: true } as NativeSidebarMenuItem] : []),
        ...section.options.map((option) => ({
          ...nativeTagPresentation(option.value),
          ...runtime(option.label, nativeTagPresentation(option.value)?.icon ?? 'tag', {
            type: 'setSessionTag',
            sessionId: id,
            sessionTag: tag === option.value ? null : option.value,
          }),
          checked: tag === option.value,
        })),
      ]);
  if (includeMenu && !group.remoteMachineContext)
    tags.push(
      { separator: true },
      { label: 'New Tag…', icon: 'plus', command: { type: 'sidebarAction', action: 'newTag' } }
    );
  const parked = session.isParked === true;
  const park: NativeSidebarMenuItem = runtime(parked ? 'Unpark' : 'Park', 'archive', {
    type: 'setSessionParked',
    sessionId: id,
    parked: !parked,
  });
  if (!parked && settings.showTagMenuWhenParking && caps.canTagSession && tags.length) {
    park.children = !includeMenu
      ? lazyMenu('park')
      : [
          runtime('No Tag Change', 'tag-off', { type: 'setSessionParked', sessionId: id, parked: true }),
          { separator: true },
          ...tags.map((item) =>
            item.command?.type === 'command'
              ? {
                  ...item,
                  command: {
                    type: 'batch' as const,
                    messages: [
                      item.command.message.type === 'setSessionTag'
                        ? { ...item.command.message, sessionTag: item.command.message.sessionTag ?? tag ?? null }
                        : item.command.message,
                      { type: 'setSessionParked' as const, sessionId: id, parked: true },
                    ],
                  },
                }
              : item
          ),
        ];
    delete park.command;
  }
  const snoozePresets: NativeSidebarMenuItem[] = !includeMenu
    ? lazyMenu('snooze')
    : SESSION_SNOOZE_PRESETS.map((preset) => {
        const command = { type: 'sessionAction' as const, sessionId: id, action: 'snooze' as const, preset };
        return settings.showTagMenuWhenParking && caps.canTagSession && tags.length
          ? {
              label: SESSION_SNOOZE_PRESET_LABELS[preset],
              children: [
                { label: 'No Tag Change', icon: 'alarm', command },
                { separator: true },
                ...tags.map((item) =>
                  item.command?.type === 'command' && item.command.message.type === 'setSessionTag'
                    ? { ...item, command: { ...command, sessionTag: item.command.message.sessionTag ?? tag ?? null } }
                    : item
                ),
              ],
            }
          : { label: SESSION_SNOOZE_PRESET_LABELS[preset], command };
      });
  const sleep = getSidebarSessionLifecycleState(session) === 'sleeping';
  const rows: Partial<Record<SessionCardHoverAction, NativeSidebarMenuItem>> = {
    close: { ...runtime('Close', 'x', { type: 'closeSession', sessionId: id }), danger: true },
    ...(caps.canRenameSession ? { rename: intent('Rename', 'pencil', 'rename') } : {}),
    ...(caps.canOpenSessionNote ? { note: intent('Note', 'note', 'note') } : {}),
    ...(caps.canSleepSession
      ? {
          sleep: runtime(sleep ? 'Wake' : 'Sleep', sleep ? 'player-play' : 'moon', {
            type: 'setSessionSleeping',
            sessionId: id,
            sleeping: !sleep,
          }),
        }
      : {}),
    ...(caps.canPinSession
      ? {
          pin: runtime(session.isPinned ? 'Unpin' : 'Pin', session.isPinned ? 'pinned-off' : 'pin', {
            type: 'setSessionPinned',
            sessionId: id,
            pinned: !session.isPinned,
          }),
        }
      : {}),
    ...(!caps.isBrowserSession && settings.enableSessionParking ? { park } : {}),
    ...(caps.canTagSession && tags.length ? { tag: { label: 'Tag As', icon: 'tag', children: tags } } : {}),
    ...(!caps.isBrowserSession
      ? {
          snooze: isSidebarSessionSnoozed(session)
            ? runtime('Unsnooze', 'alarm', { type: 'unsnoozeSession', sessionId: id })
            : { label: 'Snooze', icon: 'alarm', children: snoozePresets },
        }
      : {}),
    ...(caps.canCloseAfterDone
      ? { closeAfterDone: runtime('Close After Done', 'clock', { type: 'toggleCloseAfterDone', sessionId: id }) }
      : {}),
  };
  const strip = splitSessionCardHoverButtons(settings.sessionCardHoverButtons);
  const hover = {
    hoverBefore: strip.before.flatMap((action) => (rows[action] ? [rows[action]!] : [])),
    hoverAfter: strip.after.flatMap((action) => (rows[action] ? [rows[action]!] : [])),
    hoverChevron: strip.chevron,
  };
  if (!includeMenu) return { menu: lazyMenu(), ...hover };
  const enabled = [...strip.before, ...strip.after];
  const mirror = settings.showSessionCardHoverButtonsInContextMenu
    ? caps.isBrowserSession
      ? (['sleep'] as const)
      : [...enabled].reverse().filter((action) => action !== 'close' && action !== 'closeAfterDone')
    : [];
  /**
   * CDXC:ContextMenus 2026-09-19 DECISION:
   * The user asked for a different pin icon in the sidebar context menu. Pin uses the upright pushpin that pairs with Unpin's crossed-out pushpin (the React menu's IconPinned); the card hover button keeps the diagonal pin. Every sidebar menu label is Title Case ("Close Inactive", "Pin Selected"), except disabled status sentences.
   */
  const primary = [
    ...mirror,
    ...(['rename', 'sleep', 'pin', 'park', 'snooze', 'note', 'tag'] as const).filter(
      (action) => !enabled.includes(action)
    ),
  ].flatMap((action) =>
    action === 'pin' && rows.pin && !session.isPinned
      ? [{ ...rows.pin, icon: 'pinned' }]
      : rows[action]
        ? [rows[action]!]
        : []
  );
  const advanced: NativeSidebarMenuItem[] = [{ label: 'Session', heading: true }];
  if (caps.canDelayedSend) advanced.push(intent('Delayed Send', 'clock', 'delayedSend'));
  if (
    caps.canCloseAfterDone &&
    (!enabled.includes('closeAfterDone') || settings.showSessionCardHoverButtonsInContextMenu)
  )
    advanced.push(rows.closeAfterDone!);
  if (caps.canForkSession) advanced.push(runtime('Fork', 'git-fork', { type: 'forkSession', sessionId: id }));
  if (caps.canFullReloadSession)
    advanced.push(runtime('Full Reload', 'refresh', { type: 'fullReloadSession', sessionId: id }));
  const accountProvider = resolveSessionChatTranscriptAgent(session.agentName, session.agentIcon);
  if (!caps.isBrowserSession && !group.isStale && (accountProvider === 'claude' || accountProvider === 'codex'))
    advanced.push({
      label: 'Switch Account',
      icon: 'users-group',
      keepOpen: true,
      command: { type: 'sessionAccounts', action: 'load', sessionId: id },
    });
  if (caps.canExportTranscript)
    advanced.push(runtime('Handoff / Export', 'file-export', { type: 'exportSessionTranscript', sessionId: id }));
  if (session.firstUserMessage?.trim()) advanced.push(intent('View 1st Message', 'message-circle', 'firstMessage'));
  if (caps.canGenerateSessionTitle)
    advanced.push(
      runtime('Generate Title', 'sparkles', {
        type: 'renameSession',
        sessionId: id,
        title: session.firstUserMessage!,
        shouldGenerateTitle: true,
      })
    );
  if (caps.canSplitSessionRight)
    advanced.push(runtime('Split Right', 'layout-columns', { type: 'splitSessionRight', sessionId: id }));
  if (group.canCreateSessionGroup)
    advanced.push(
      runtime('Move to New Group', 'layout-sidebar-right-expand', { type: 'createGroupFromSession', sessionId: id })
    );
  if (group.canFocusMode) advanced.push(runtime('Focus', 'focus-2', { type: 'focusSessionMode', sessionId: id }));
  const copy: NativeSidebarMenuItem[] = [];
  if (caps.canCopySessionDetails)
    copy.push(
      runtime('Copy Details', 'copy', {
        type: 'copySessionDetails',
        sessionId: id,
        detailsText: buildSidebarSessionDetailsClipboardText(session, group),
      })
    );
  if (caps.canCopyResumeCommand)
    copy.push(runtime('Copy Resume', 'copy', { type: 'copyResumeCommand', sessionId: id }));
  if (caps.canCopyAttachCommand)
    copy.push(runtime('Copy Attach Command', 'copy', { type: 'copyAttachCommand', sessionId: id }));
  if (copy.length) advanced.push({ separator: true }, { label: 'Copy', heading: true }, ...copy);
  if (below.length) {
    advanced.push({ separator: true }, { label: 'Below', heading: true });
    const sleepable = below.filter(canSleepSidebarSession).map((item) => item.sessionId);
    if (sleepable.length)
      advanced.push(
        runtime('Sleep Below', 'moon', {
          type: 'setSessionsSleeping',
          sessionIds: sleepable,
          sleeping: true,
          source: 'sleepBelow',
        })
      );
    advanced.push({
      ...runtime('Close Below', 'x', { type: 'closeSessions', sessionIds: below.map((item) => item.sessionId) }),
      danger: true,
    });
  }
  const menu = [...primary];
  if (caps.canDelayedSend && session.delayedSendDeadlineAt) {
    menu.push({
      label: 'Postpone By',
      icon: 'clock',
      children: [
        ...[
          { label: '10 Minutes', delayMs: 600_000 },
          { label: '30 Minutes', delayMs: 1_800_000 },
          { label: '1 Hour', delayMs: 3_600_000 },
          { label: '2 Hours', delayMs: 7_200_000 },
          { label: '5 Hours', delayMs: 18_000_000 },
        ].map((preset) =>
          runtime(preset.label, 'clock', { type: 'postponeDelayedSend', sessionId: id, delayMs: preset.delayMs })
        ),
        { separator: true },
        intent('Edit Delayed Send', 'pencil', 'delayedSend'),
        runtime('Disable Delayed Send', 'x', { type: 'cancelDelayedSend', sessionId: id }),
      ],
    });
  }
  if (advanced.length > 1) menu.push({ separator: true }, { label: 'Advanced', icon: 'dots', children: advanced });
  if (!enabled.includes('close')) menu.push({ separator: true }, rows.close!);
  return {
    menu,
    ...hover,
  };
}
