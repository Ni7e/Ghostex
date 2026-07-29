import { IconChevronDown, IconGitBranch, IconPlus } from "@tabler/icons-react";
import { useState } from "react";
import type { SidebarNewSessionEnvMode } from "../../shared/ghostex-settings";
import { SidebarContextMenuPortal } from "../sidebar-context-menu-portal";
import type { WebviewApi } from "../webview-api";

/*
 * CDXC:SidebarV2Worktree 2026-07-29:
 * V2's creation control: a split button whose PLAIN half is the unchanged
 * instant-session path (it posts exactly the message the classic sidebar's
 * agent button posts) and whose chevron opens the worktree entry point.
 *
 * Two rules this component enforces so the flow can never regress V1 behavior:
 * - Without the `worktreeSessions` capability there is NO chevron. The control
 *   collapses to a bare "+" that is byte-identical in behavior to what the
 *   sidebar did before this phase, which is what an un-upgraded daemon (or a
 *   remote machine) must see.
 * - The "default to worktree" preference only ever changes what the PLAIN half
 *   opens. It never changes the message the instant path posts, and it is
 *   ignored entirely when the capability is missing.
 */

export type SidebarV2CreateButtonPosition = {
  clientX: number;
  clientY: number;
};

export type SidebarV2CreateButtonProps = {
  /** gxserver for this button's project can serve the worktree flow. */
  canCreateWorktree: boolean;
  /** Global default for the plain half: instant local session, or the popover. */
  defaultEnvMode: SidebarNewSessionEnvMode;
  /** Accessible name for the plain half, e.g. "New session in ghostex". */
  label: string;
  onCreateInstantSession: () => void;
  onOpenWorktreePopover: (position: SidebarV2CreateButtonPosition) => void;
  onSetDefaultEnvMode?: (mode: SidebarNewSessionEnvMode) => void;
  vscode: WebviewApi;
};

export function SidebarV2CreateButton({
  canCreateWorktree,
  defaultEnvMode,
  label,
  onCreateInstantSession,
  onOpenWorktreePopover,
  onSetDefaultEnvMode,
  vscode,
}: SidebarV2CreateButtonProps) {
  const [menuPosition, setMenuPosition] = useState<SidebarV2CreateButtonPosition>();

  const popoverPositionFrom = (element: HTMLElement): SidebarV2CreateButtonPosition => {
    const rect = element.getBoundingClientRect();
    return { clientX: rect.left, clientY: rect.bottom + 4 };
  };

  const worktreeIsDefault = canCreateWorktree && defaultEnvMode === "worktree";

  return (
    <div className="sidebar-v2-create-split" data-can-worktree={String(canCreateWorktree)}>
      <button
        aria-label={label}
        className="sidebar-v2-create-button"
        onClick={(event) => {
          event.stopPropagation();
          if (worktreeIsDefault) {
            onOpenWorktreePopover(popoverPositionFrom(event.currentTarget));
            return;
          }
          onCreateInstantSession();
        }}
        title={worktreeIsDefault ? "New worktree session" : label}
        type="button"
      >
        <IconPlus aria-hidden="true" size={14} stroke={2} />
      </button>
      {canCreateWorktree ? (
        <button
          aria-expanded={menuPosition !== undefined}
          aria-haspopup="menu"
          aria-label="New session options"
          className="sidebar-v2-create-chevron"
          onClick={(event) => {
            event.stopPropagation();
            setMenuPosition(popoverPositionFrom(event.currentTarget));
          }}
          type="button"
        >
          <IconChevronDown aria-hidden="true" size={12} stroke={2} />
        </button>
      ) : null}
      {menuPosition ? (
        <SidebarContextMenuPortal
          menuClassName="session-context-menu sidebar-v2-create-menu"
          menuStyle={{ left: `${menuPosition.clientX}px`, top: `${menuPosition.clientY}px` }}
          onDismiss={() => setMenuPosition(undefined)}
          vscode={vscode}
        >
          <div className="session-context-menu-section">
            <button
              className="session-context-menu-item"
              onClick={() => {
                const position = menuPosition;
                setMenuPosition(undefined);
                onOpenWorktreePopover(position);
              }}
              role="menuitem"
              type="button"
            >
              <IconGitBranch
                aria-hidden="true"
                className="session-context-menu-icon"
                size={16}
                stroke={1.8}
              />
              New worktree session…
            </button>
          </div>
          {onSetDefaultEnvMode ? (
            <>
              <div className="session-context-menu-divider" role="separator" />
              <div className="session-context-menu-section">
                <button
                  aria-checked={defaultEnvMode === "worktree"}
                  className="session-context-menu-item"
                  onClick={() => {
                    setMenuPosition(undefined);
                    onSetDefaultEnvMode(defaultEnvMode === "worktree" ? "local" : "worktree");
                  }}
                  role="menuitemcheckbox"
                  type="button"
                >
                  <span className="session-context-menu-icon" aria-hidden="true">
                    {defaultEnvMode === "worktree" ? "✓" : ""}
                  </span>
                  Default new sessions to worktree
                </button>
              </div>
            </>
          ) : null}
        </SidebarContextMenuPortal>
      ) : null}
    </div>
  );
}
