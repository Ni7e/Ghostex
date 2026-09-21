import type { SidebarHudState, SidebarSessionGroup, SidebarToExtensionMessage } from './session-grid-contract';
import type { SessionChatArmedAction } from './session-chat-presentation/armed-actions';

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

export type NativeSidebarGroup = SidebarSessionGroup & {
  collectionColor?: string;
  titleTooltip?: string;
  storageId: string;
  summary: { workingCount: number; attentionCount: number; awakeCount: number };
  collapsed: boolean;
  sections: NativeSidebarSection[];
  expanded: boolean;
  hiddenSessionCount: number;
  showListToggle: boolean;
  hoverActionsExpanded: boolean;
  menu: NativeSidebarMenuItem[];
  headerActions: NativeSidebarMenuItem[];
};

export type NativeSidebarCollection = {
  collectionId: string;
  storageId: string;
  title: string;
  color: string;
  groupIds: string[];
  collapsed: boolean;
  containsActiveSession: boolean;
  workingCount: number;
  attentionCount: number;
  awakeCount: number;
  menu: NativeSidebarMenuItem[];
};

/**
 * CDXC:Sidebar 2026-09-16 DECISION:
 * User: replace the desktop sidebar with modular GPUI UI, retaining the React sidebar and matching its appearance, functionality, and settings exactly.
 * The existing sidebar service owns presentation and commands; this contract carries display state to the native renderer without a React tree.
 */
export type NativeSidebarSnapshot = {
  kind: 'snapshot';
  version: 1;
  revision: number;
  renameRequest?: { collectionId: string; requestId: number };
  revealRequest?: { sessionId: string; requestId: number };
  scrollScope: string;
  ready: boolean;
  emptyState: { loading: boolean; error: boolean; canAddProject: boolean; copy: string };
  hud: SidebarHudState;
  groups: NativeSidebarGroup[];
  selectedMachineId: string;
  machines: {
    id: string;
    label: string;
    state: string;
    message?: string;
    workingCount: number;
    attentionCount: number;
  }[];
  spaces: {
    id: string;
    name: string;
    icon: string;
    color: string;
    selected: boolean;
    containsActiveSession: boolean;
    workingCount: number;
    attentionCount: number;
  }[];
  spacesEnabled: boolean;
  collections: NativeSidebarCollection[];
  order: { kind: 'project' | 'collection'; id: string }[];
  moreMenu: NativeSidebarMenuItem[];
  searchShortcut?: string;
  commandsShortcut?: string;
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
  postNativeSidebarSnapshot?: (snapshot: string) => void;
  onNativeSidebarCommand?: (command: NativeSidebarCommand) => void;
  /**
   * The workspace session groups document the app holds, handed to this page after every change.
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
   * Post the document this page holds. Called once by the app after a read of the stored key that
   * failed while this page was editing, where the page's copy is the only one carrying that edit.
   */
  requestWorkspaceGroups?: () => void;
  /**
   * The project collections document the app holds, handed to this page after every change.
   *
   * Same shape and same reason as `applyWorkspaceGroups`: since M5 piece 7d the app is the only
   * writer of `ghostex.sidebar.projectCollections.v1` and the only thing that pushes it to gxserver
   * for this computer (apps/desktop/src/app/gx_store/project_docs.rs). A REMOTE machine's copy is
   * unchanged and still goes out as a command.
   */
  applyProjectCollections?: (state: unknown) => void;
  /** A document handed over before `applyProjectCollections` was installed; drained when it is. */
  pendingProjectCollections?: unknown;
  /**
   * Post the collections document this page holds. Called once by the app after a hand-off it had
   * to refuse because the stored key had not been read yet, where this page's copy is the only one
   * carrying that edit. The Spaces document needs no counterpart: it has no stored key, so its host
   * is ready from the first frame and never refuses.
   */
  requestProjectCollections?: () => void;
  /** The Spaces document the app holds. gxserver owns it outright, so there is no stored key. */
  applySidebarSpaces?: (state: unknown) => void;
  /** A document handed over before `applySidebarSpaces` was installed; drained when it is. */
  pendingSidebarSpaces?: unknown;
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

export type NativeSidebarClockRow = {
  sessionId: string;
  timerLabel?: string;
  lastInteractionLabel?: string;
  /** Every session's armed Delayed Send / Close After Done, not only visible rows: the chat working row reads these. */
  armedActions?: SessionChatArmedAction[];
};
export type NativeSidebarClockUpdate = { kind: 'clock'; version: 1; rows: NativeSidebarClockRow[] };

export type NativeSidebarPatch = {
  kind: 'patch';
  version: 1;
  hud: Record<string, unknown>;
  fields: Record<string, unknown>;
  groupOrder?: string[];
  groups: {
    groupId: string;
    fields: Record<string, unknown>;
    sessionOrder?: string[];
    sessions: { sessionId: string; fields: Record<string, unknown> }[];
  }[];
};
