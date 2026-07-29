import {
  IconAlarmOff,
  IconArrowBackUp,
  IconCheck,
  IconClock,
  IconGitBranch,
  IconMaximize,
  IconMoon,
  IconPencil,
  IconPinned,
  IconPinnedOff,
  IconPlayerPlay,
  IconServer,
  IconX,
} from "@tabler/icons-react";
import { useState, type ReactNode } from "react";
import type { SidebarProjectGroupingMode } from "../../shared/ghostex-settings";
import type { SidebarSessionItem } from "../../shared/session-grid-contract";
import {
  resolveSidebarV2SnoozePresets,
  type SidebarV2SnoozePreset,
} from "../../shared/sidebar-v2-snooze";
import { SidebarContextMenuPortal } from "../sidebar-context-menu-portal";
import type { WebviewApi } from "../webview-api";

/*
 * CDXC:SidebarV2 2026-07-29:
 * V2's session menu is deliberately a small, self-contained menu rather than a
 * reuse of V1's `sortable-session-card` menu builder. That builder is fused to
 * the V1 card: it reads dnd-kit sortable state, multi-select bulk availability,
 * project-session-list overflow rows, and the app-modal host, none of which
 * exist in the V2 tree. Extracting it would mean refactoring the hottest file
 * in the sidebar while other agents work in it.
 *
 * What matters for correctness is that every item here posts the SAME message
 * V1's equivalent item posts, so the host cannot tell which sidebar issued it.
 * The V1-only items (tags, copy resume/attach/details, Delayed Send, Close
 * After Done, Fork, Generate Title, Full reload, Move to New Group, Sleep/Close
 * below, View 1st message, Remote Access, and every bulk action) stay in V1
 * until V2 has multi-select and the P2 lifecycle actions to sit beside them.
 */

export type SidebarV2ContextMenuPosition = {
  clientX: number;
  clientY: number;
};

export type SidebarV2ContextMenuAction = {
  danger?: boolean;
  icon: ReactNode;
  key: string;
  label: string;
  onClick: () => void;
  /**
   * CDXC:SidebarV2Lifecycle 2026-07-29:
   * Snooze needs a second choice (which preset), so it carries a submenu. It
   * expands INLINE under its parent rather than flying out sideways: the
   * sidebar is ~260px wide, a flyout would have to open over the sessions it
   * was launched from, and an inline list needs no hover-intent timers to be
   * usable — or testable.
   */
  submenu?: readonly SidebarV2ContextMenuSubmenuItem[];
};

export type SidebarV2ContextMenuSubmenuItem = {
  /**
   * CDXC:SidebarV2LogicalProjects 2026-07-29:
   * Marks the option that is already in force. Only CHOICE submenus set it
   * (grouping mode); the snooze presets are commands, not a current state, so
   * they leave it unset and no checkmark column appears for them.
   */
  isChecked?: boolean;
  key: string;
  label: string;
  onClick: () => void;
  /** Right-aligned absolute time column, e.g. "9:00 AM". */
  trailingLabel?: string;
};

export type SidebarV2ContextMenuLifecycleState = {
  /** The row currently classifies as settled, so the item reads "Un-settle". */
  isSettled: boolean;
  /** The row currently classifies as snoozed, so Wake is offered. */
  isSnoozed: boolean;
  /** gxserver for this row's machine supports settle. */
  supportsSettle: boolean;
  /** gxserver for this row's machine supports snooze. */
  supportsSnooze: boolean;
};

export type SidebarV2ContextMenuHandlers = {
  onClose: () => void;
  onFocusMode: () => void;
  /**
   * CDXC:SidebarV2Worktree 2026-07-29:
   * t3code parity: start another session in the checkout this row already
   * lives in. It is an OPEN-EXISTING create (the worktree is right there), so
   * it never cuts a new branch.
   */
  onNewSessionOnBranch?: () => void;
  onRename: () => void;
  onSetPinned: (pinned: boolean) => void;
  onSetSleeping: (sleeping: boolean) => void;
  onSettle?: () => void;
  onSnooze?: (preset: SidebarV2SnoozePreset) => void;
  onUnsettle?: () => void;
  onWake?: () => void;
};

export type SidebarV2ContextMenuOptions = {
  lifecycle?: SidebarV2ContextMenuLifecycleState;
  /** Clock the snooze presets resolve against; the menu is built on open. */
  nowMs?: number;
  /**
   * CDXC:SidebarV2Worktree 2026-07-29:
   * The branch this row's cwd is on. Supplied ONLY when the row is a git
   * checkout on a machine whose gxserver serves the worktree flow, so the
   * capability gate lives with the caller that already resolves it per group.
   */
  worktreeBranch?: string;
};

const CONTEXT_MENU_ICON_CLASS = "session-context-menu-icon";

export function createSidebarV2ContextMenuSections(
  session: SidebarSessionItem,
  handlers: SidebarV2ContextMenuHandlers,
  options: SidebarV2ContextMenuOptions = {},
): SidebarV2ContextMenuAction[][] {
  const isBrowser = session.kind === "browser" || session.sessionKind === "browser";
  const isSleeping = session.isSleeping === true;
  const isPinned = session.isPinned === true;
  /*
   * CDXC:SidebarV2Lifecycle 2026-07-29:
   * Guards are the same ones the hover slot applies, and the same ones gxserver
   * enforces: a browser tab has no agent lifecycle, a session blocked on the
   * user can be neither settled nor snoozed (hiding a pending approval defeats
   * the request), and a working session cannot be settled but CAN be snoozed —
   * snooze changes visibility only, never the agent.
   */
  const lifecycle = options.lifecycle;
  const isBlockedOnUser = session.activity === "attention";
  const isWorking = session.activity === "working";
  const canSettle =
    !isBrowser && lifecycle?.supportsSettle === true && !isBlockedOnUser && !isWorking;
  const canSnooze = !isBrowser && lifecycle?.supportsSnooze === true && !isBlockedOnUser;

  const lifecycleActions: SidebarV2ContextMenuAction[] = [];
  if (canSettle && handlers.onSettle && !lifecycle?.isSettled) {
    lifecycleActions.push({
      icon: <IconCheck aria-hidden="true" className={CONTEXT_MENU_ICON_CLASS} size={16} stroke={2} />,
      key: "settle",
      label: "Settle",
      onClick: handlers.onSettle,
    });
  }
  if (!isBrowser && lifecycle?.supportsSettle === true && lifecycle.isSettled && handlers.onUnsettle) {
    lifecycleActions.push({
      icon: (
        <IconArrowBackUp aria-hidden="true" className={CONTEXT_MENU_ICON_CLASS} size={16} stroke={1.8} />
      ),
      key: "unsettle",
      label: "Un-settle",
      onClick: handlers.onUnsettle,
    });
  }
  if (!isBrowser && lifecycle?.supportsSnooze === true && lifecycle.isSnoozed && handlers.onWake) {
    lifecycleActions.push({
      icon: <IconAlarmOff aria-hidden="true" className={CONTEXT_MENU_ICON_CLASS} size={16} stroke={1.8} />,
      key: "wake",
      label: "Wake now",
      onClick: handlers.onWake,
    });
  }
  if (canSnooze && handlers.onSnooze && !lifecycle?.isSnoozed) {
    const onSnooze = handlers.onSnooze;
    lifecycleActions.push({
      icon: <IconClock aria-hidden="true" className={CONTEXT_MENU_ICON_CLASS} size={16} stroke={1.8} />,
      key: "snooze",
      label: "Snooze",
      // Opening the parent only reveals the presets; the snooze itself is
      // always an explicit preset choice, never a default guess.
      onClick: () => undefined,
      submenu: resolveSidebarV2SnoozePresets(options.nowMs ?? Date.now()).map((preset) => ({
        key: preset.id,
        label: preset.label,
        onClick: () => onSnooze(preset),
        trailingLabel: preset.whenLabel,
      })),
    });
  }

  const primary: SidebarV2ContextMenuAction[] = [];
  if (!isBrowser) {
    primary.push({
      icon: <IconPencil aria-hidden="true" className="session-context-menu-icon" size={16} stroke={1.8} />,
      key: "rename",
      label: "Rename",
      onClick: handlers.onRename,
    });
  }
  primary.push({
    icon: <IconMaximize aria-hidden="true" className="session-context-menu-icon" size={16} stroke={1.8} />,
    key: "focus",
    label: "Focus",
    onClick: handlers.onFocusMode,
  });
  if (!isBrowser && options.worktreeBranch && handlers.onNewSessionOnBranch) {
    primary.push({
      icon: (
        <IconGitBranch aria-hidden="true" className={CONTEXT_MENU_ICON_CLASS} size={16} stroke={1.8} />
      ),
      key: "newSessionOnBranch",
      label: `New session on ${options.worktreeBranch}`,
      onClick: handlers.onNewSessionOnBranch,
    });
  }

  const stateActions: SidebarV2ContextMenuAction[] = [
    {
      icon: isPinned ? (
        <IconPinnedOff aria-hidden="true" className="session-context-menu-icon" size={16} stroke={1.8} />
      ) : (
        <IconPinned aria-hidden="true" className="session-context-menu-icon" size={16} stroke={1.8} />
      ),
      key: "pin",
      label: isPinned ? "Unpin" : "Pin",
      onClick: () => handlers.onSetPinned(!isPinned),
    },
    {
      icon: isSleeping ? (
        <IconPlayerPlay aria-hidden="true" className="session-context-menu-icon" size={16} stroke={1.8} />
      ) : (
        <IconMoon aria-hidden="true" className="session-context-menu-icon" size={16} stroke={1.8} />
      ),
      key: "sleep",
      label: isSleeping ? "Wake" : "Sleep",
      onClick: () => handlers.onSetSleeping(!isSleeping),
    },
  ];

  const destructive: SidebarV2ContextMenuAction[] = [
    {
      danger: true,
      icon: <IconX aria-hidden="true" className="session-context-menu-icon" size={16} stroke={1.8} />,
      key: "close",
      label: "Close",
      onClick: handlers.onClose,
    },
  ];

  return [primary, lifecycleActions, stateActions, destructive].filter(
    (section) => section.length > 0,
  );
}

/*
 * CDXC:SidebarV2LogicalProjects 2026-07-29:
 * The project group header's menu. Today it carries exactly one thing —
 * how this repository's checkouts merge across machines — and it is a SUBMENU
 * of three radio options rather than a dialog: the choice has three values, no
 * free text, and no confirmation step, so a dialog would add a modal surface
 * for one click.
 *
 * The chosen mode is written to EVERY member checkout of the group the user is
 * looking at. Acting on the visible merged row and silently changing only one
 * hidden member would produce a group that half-agrees with itself, which is
 * exactly the `groupingMode: undefined` (no checkmark) state this builder
 * renders when it finds one.
 */
export const SIDEBAR_V2_PROJECT_GROUPING_MENU_OPTIONS: readonly {
  label: string;
  mode: SidebarProjectGroupingMode;
}[] = [
  { label: "Repository", mode: "repository" },
  { label: "Repository + path", mode: "repositoryPath" },
  { label: "Keep separate", mode: "separate" },
];

export type SidebarV2ProjectGroupMenuState = {
  /** False for a project with no git origin: merging cannot apply, so the
      submenu is not offered at all rather than offered and inert. */
  canGroupAcrossMachines: boolean;
  /** The mode every member currently resolves to, or undefined when they
      disagree — no option is then marked as active. */
  groupingMode?: SidebarProjectGroupingMode;
};

export function createSidebarV2ProjectGroupMenuSections(
  group: SidebarV2ProjectGroupMenuState,
  handlers: { onSetGroupingMode: (mode: SidebarProjectGroupingMode) => void },
): SidebarV2ContextMenuAction[][] {
  if (!group.canGroupAcrossMachines) {
    return [];
  }
  return [
    [
      {
        icon: (
          <IconServer aria-hidden="true" className={CONTEXT_MENU_ICON_CLASS} size={16} stroke={1.8} />
        ),
        key: "groupAcrossMachines",
        label: "Group across machines",
        // The parent only reveals the choices; picking one is always explicit.
        onClick: () => undefined,
        submenu: SIDEBAR_V2_PROJECT_GROUPING_MENU_OPTIONS.map((option) => ({
          isChecked: group.groupingMode === option.mode,
          key: option.mode,
          label: option.label,
          onClick: () => handlers.onSetGroupingMode(option.mode),
        })),
      },
    ],
  ];
}

export type SidebarV2ContextMenuProps = {
  onDismiss: () => void;
  position: SidebarV2ContextMenuPosition;
  sections: readonly (readonly SidebarV2ContextMenuAction[])[];
  vscode: WebviewApi;
};

export function SidebarV2ContextMenu({
  onDismiss,
  position,
  sections,
  vscode,
}: SidebarV2ContextMenuProps) {
  const [expandedActionKey, setExpandedActionKey] = useState<string>();
  return (
    <SidebarContextMenuPortal
      menuClassName="session-context-menu sidebar-v2-session-context-menu"
      menuStyle={{ left: `${position.clientX}px`, top: `${position.clientY}px` }}
      onDismiss={onDismiss}
      vscode={vscode}
    >
      {sections.map((section, sectionIndex) => (
        // Sections are positional, not identified: the index IS the identity.
        <div key={`sidebar-v2-menu-section-${sectionIndex}`}>
          {sectionIndex > 0 ? (
            <div className="session-context-menu-divider" role="separator" />
          ) : null}
          <div className="session-context-menu-section">
            {section.map((action) => {
              const isExpanded = expandedActionKey === action.key;
              return (
                <div key={action.key}>
                  <button
                    aria-expanded={action.submenu ? isExpanded : undefined}
                    aria-haspopup={action.submenu ? "menu" : undefined}
                    className={`session-context-menu-item${
                      action.danger ? " session-context-menu-item-danger" : ""
                    }`}
                    onClick={() => {
                      /*
                       * A parent with a submenu only toggles its children. It
                       * must not dismiss the menu, or the presets it exists to
                       * offer would never be reachable.
                       */
                      if (action.submenu) {
                        setExpandedActionKey(isExpanded ? undefined : action.key);
                        return;
                      }
                      onDismiss();
                      action.onClick();
                    }}
                    role="menuitem"
                    type="button"
                  >
                    {action.icon}
                    {action.label}
                  </button>
                  {action.submenu && isExpanded ? (
                    <div className="sidebar-v2-context-submenu">
                      {action.submenu.map((item) => (
                        <button
                          aria-checked={
                            item.isChecked === undefined ? undefined : item.isChecked
                          }
                          className="session-context-menu-item sidebar-v2-context-submenu-item"
                          data-checked={
                            item.isChecked === undefined ? undefined : String(item.isChecked)
                          }
                          key={item.key}
                          onClick={() => {
                            onDismiss();
                            item.onClick();
                          }}
                          role={item.isChecked === undefined ? "menuitem" : "menuitemradio"}
                          type="button"
                        >
                          <span className="sidebar-v2-context-submenu-label">{item.label}</span>
                          {item.isChecked ? (
                            <IconCheck
                              aria-hidden="true"
                              className="sidebar-v2-context-submenu-check"
                              size={14}
                              stroke={2}
                            />
                          ) : null}
                          {item.trailingLabel ? (
                            <span className="sidebar-v2-context-submenu-when">
                              {item.trailingLabel}
                            </span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </SidebarContextMenuPortal>
  );
}
