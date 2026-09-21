import type { SidebarToExtensionMessage } from './session-grid-contract';

/**
 * What is left of the TypeScript sidebar page's contract after it was deleted (M4d part 2, 2026-09-21):
 * the section shape the shared project-session helpers still build, the command and menu-item
 * shapes the Rust menus are specified against (gx-core `sidebar_menu/`), and the three bridge
 * members the gxserver runtime still needs for the workspace session groups document.
 */
export type NativeSidebarSection = {
  id: 'browser' | 'pinned' | 'sessions' | 'drafts' | 'parked' | 'snoozed';
  collapsed: boolean;
  count: number;
  containsActiveSession: boolean;
  workingCount: number;
  attentionCount: number;
  questionCount: number;
  sessionIds: string[];
};

export type NativeSidebarCommand =
  | {
      type: 'command';
      message: SidebarToExtensionMessage;
    }
  | { type: 'renameGroup'; groupId: string }
  | { type: 'confirmCloseGroup'; groupId: string }
  | { type: 'toggleHoverActions'; groupId: string }
  | { type: 'toggleGroup'; groupId: string }
  | { type: 'toggleSection'; groupId: string; section: NativeSidebarSection['id'] }
  | { type: 'toggleList'; groupId: string }
  | { type: 'machineAction'; machineId: string; action: 'hide' | 'configure' }
  | { type: 'selectMachine'; machineId: string }
  | { type: 'selectSpace'; spaceId: string }
  | { type: 'editSpace'; spaceId?: string }
  | {
      type: 'agentAccounts';
      groupId: string;
      action: 'load' | 'root' | 'accounts' | 'retry' | 'launch';
      agentId?: string;
    }
  | {
      type: 'sessionMenu';
      sessionId: string;
      ownerId: string;
      action?: import('./session-card-hover-actions').SessionCardHoverAction;
    }
  | { type: 'sessionAccounts'; sessionId: string; action: 'load' | 'retry' | 'select'; accountId?: string }
  | {
      type: 'projectMembership';
      groupId: string;
      action: 'createCollection' | 'moveCollection' | 'hide';
      collectionId?: string;
    }
  | { type: 'spaceMembership'; spaceId?: string; collectionId?: string; projectId?: string }
  | { type: 'renameCollection'; collectionId: string }
  | {
      type: 'collectionAction';
      collectionId: string;
      action: 'toggle' | 'toggleProjects' | 'select' | 'hide' | 'rename' | 'color' | 'ungroup';
      value?: string;
    }
  | {
      type: 'sidebarAction';
      action:
        | 'newTag'
        | 'loadSessions'
        | 'accounts'
        | 'addProject'
        | 'editMachine'
        | 'sessions'
        | 'commands'
        | 'importSessions'
        | 'agentsHub'
        | 'remoteSetup'
        | 'hotkeys'
        | 'settings'
        | 'powerSettings'
        | 'sortManual'
        | 'sortLastActivity'
        | 'showHidden'
        | 'toggleProjects';
    }
  | { type: 'toggleTagFilter'; tag: import('./session-tags').SidebarSessionTagFilter }
  | {
      type: 'projectAction';
      groupId: string;
      action: 'worktree' | 'history' | 'agent';
      agentId?: string;
      accountId?: string;
    }
  | {
      type: 'sessionAction';
      sessionId: string;
      action: 'rename' | 'note' | 'delayedSend' | 'firstMessage' | 'snooze';
      sessionTag?: import('./session-tags').SidebarSessionTag | null;
      preset?: import('./session-snooze').SessionSnoozePreset;
    }
  | { type: 'batch'; clearSelection?: boolean; messages: SidebarToExtensionMessage[] }
  | { type: 'selectSession'; sessionId: string; mode: 'clear' | 'focus' | 'additive' | 'range' }
  | { type: 'moveSession'; sessionId: string; groupId: string; targetSessionId?: string; position: 'before' | 'after' }
  | { type: 'moveGroup'; groupId: string; targetGroupId: string; position: 'before' | 'after' }
  | { type: 'moveToSpace'; sourceKind: 'group' | 'collection'; sourceId: string; spaceId: string }
  | { type: 'moveToCollection'; sourceKind: 'group'; sourceId: string; collectionId?: string }
  | {
      type: 'moveCollection';
      sourceId: string;
      targetKind: 'group' | 'collection';
      targetId: string;
      position: 'before' | 'after';
    }
  | {
      type: 'moveSpace';
      spaceId: string;
      targetSpaceId: string;
      visibleSpaceIds: string[];
      position: 'before' | 'after';
    };

export type NativeSidebarBridge = {
  /**
   * The workspace session groups document the app holds, handed to the gxserver runtime after every
   * change.
   *
   * Its own named function rather than a `NativeSidebarCommand`, because a sidebar command arrives
   * in one of two envelopes and picking the wrong one is how a whole port once shipped dead; this
   * one has no envelope to get wrong. The app is the only writer of the stored key and the only
   * thing that pushes it to gxserver (apps/desktop/src/app/gx_store/workspace_groups.rs).
   */
  applyWorkspaceGroups?: (state: unknown) => void;
  /** A document handed over before `applyWorkspaceGroups` was installed; drained when it is. */
  pendingWorkspaceGroups?: unknown;
  /**
   * Post the document the runtime holds. Called once by the app after a read of the stored key that
   * failed while the runtime was editing, where its copy is the only one carrying that edit.
   */
  requestWorkspaceGroups?: () => void;
};

export type NativeSidebarMenuItem = {
  label?: string;
  detail?: string;
  supportsChat?: boolean;
  suffix?: string;
  menuOwner?: string;
  onOpen?: NativeSidebarCommand;
  secondary?: { icon: string; label: string; command: NativeSidebarCommand };
  presentation?: 'page';
  color?: string;
  keepOpen?: boolean;
  heading?: boolean;
  imageDataUrl?: string;
  agentIcon?: string;
  iconColor?: string;
  icon?: string;
  checked?: boolean;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
  command?: NativeSidebarCommand;
  children?: NativeSidebarMenuItem[];
  /** Header actions that form one split button: the `start` half is the action, the `end` half opens its menu. */
  split?: 'start' | 'end';
  /** Panel-level, read from the first item: render the panel with the React agent launcher menu's layout. */
  menuStyle?: 'agentLauncher';
  /** The last-used agent in the agent launcher, shown highlighted with a semibold label. */
  primary?: boolean;
};
