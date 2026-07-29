import { IconChevronRight, IconRefresh } from "@tabler/icons-react";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { ConfirmationModal } from "./confirmation-modal";
import { SidebarSessionSearchField } from "./sidebar-session-search-overlay";
import { useSidebarStore } from "./sidebar-store";
import type { WebviewApi } from "./webview-api";

export type DaemonSessionsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  vscode: WebviewApi;
};

export function DaemonSessionsModal({ isOpen, onClose, vscode }: DaemonSessionsModalProps) {
  const state = useSidebarStore((storeState) => storeState.daemonSessionsState);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [expandedPanels, setExpandedPanels] = useState<Record<string, boolean>>({});
  const [isKillDaemonConfirmOpen, setIsKillDaemonConfirmOpen] = useState(false);
  const [isKillT3ServerConfirmOpen, setIsKillT3ServerConfirmOpen] = useState(false);

  /**
   * CDXC:RunningSessionsModal 2026-05-26-14:11:
   * Running modal records should open collapsed so users can scan daemon status, shared T3 code, and active session rows before expanding a row for metadata or kill actions.
   */
  const isPanelExpanded = (panelId: string): boolean => expandedPanels[panelId] === true;

  const togglePanel = (panelId: string) => {
    setExpandedPanels((current) => ({
      ...current,
      [panelId]: current[panelId] !== true,
    }));
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (isKillT3ServerConfirmOpen) {
          setIsKillT3ServerConfirmOpen(false);
          return;
        }
        if (isKillDaemonConfirmOpen) {
          setIsKillDaemonConfirmOpen(false);
          return;
        }
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isKillDaemonConfirmOpen, isKillT3ServerConfirmOpen, isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) {
      setSearchQuery("");
      setExpandedPanels({});
      setIsKillDaemonConfirmOpen(false);
      setIsKillT3ServerConfirmOpen(false);
    }
  }, [isOpen]);

  const filteredSessions = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return state?.sessions ?? [];
    }

    return (state?.sessions ?? []).filter((session) =>
      [
        session.agentName,
        session.cwd,
        session.errorMessage,
        session.ownership,
        session.sessionId,
        session.shell,
        session.status,
        session.title,
        session.workspaceId,
      ]
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .some((value) => value.toLowerCase().includes(normalizedQuery)),
    );
  }, [searchQuery, state?.sessions]);

  const filteredT3Sessions = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return state?.t3Sessions ?? [];
    }

    return (state?.t3Sessions ?? []).filter((session) =>
      [
        session.detail,
        session.ownership,
        session.lastInteractionAt,
        session.sessionId,
        session.threadId,
        session.title,
        session.workspaceId,
        session.workspaceRoot,
      ]
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .some((value) => value.toLowerCase().includes(normalizedQuery)),
    );
  }, [searchQuery, state?.t3Sessions]);

  if (!isOpen) {
    return null;
  }

  return createPortal(
    <>
      <div className="confirm-modal-root scroll-mask-y" role="presentation">
        <button className="confirm-modal-backdrop" onClick={onClose} type="button" />
        <div
          aria-describedby="daemon-sessions-modal-description"
          aria-labelledby="daemon-sessions-modal-title"
          aria-modal="true"
          className="confirm-modal daemon-sessions-modal scroll-mask-y"
          role="dialog"
        >
          <div className="confirm-modal-header">
            <div className="confirm-modal-title" id="daemon-sessions-modal-title">
              Running Ghostex Sessions
            </div>
            {/* <div className="confirm-modal-description" id="daemon-sessions-modal-description"> */}
            {/* </div> */}
          </div>
          <div className="daemon-sessions-toolbar">
            <SidebarSessionSearchField
              ariaLabel="Search daemon sessions"
              clearLabel="Clear daemon sessions search"
              inputClassName="daemon-sessions-search-input"
              inputRef={searchInputRef}
              placeholder="Search by workspace, session, cwd, title, or agent"
              query={searchQuery}
              setQuery={setSearchQuery}
              toolbarClassName="daemon-sessions-search-control"
            />
            <div className="daemon-sessions-toolbar-actions">
              <button
                className="secondary daemon-sessions-toolbar-button"
                onClick={() => {
                  vscode.postMessage({ type: "refreshDaemonSessions" });
                }}
                type="button"
              >
                <IconRefresh aria-hidden="true" className="session-context-menu-icon" size={14} />
                Refresh
              </button>
              <button
                className="secondary daemon-sessions-toolbar-button daemon-sessions-toolbar-button-danger"
                disabled={!state?.daemon}
                onClick={() => {
                  setIsKillDaemonConfirmOpen(true);
                }}
                type="button"
              >
                Kill Daemon
              </button>
            </div>
          </div>
          <div className="daemon-sessions-modal-body scroll-mask-y">
            {state ? (
              <>
                <section
                  className="daemon-sessions-summary"
                  data-collapsed={String(!isPanelExpanded("daemon-summary"))}
                >
                  <button
                    aria-controls="daemon-summary-panel"
                    aria-expanded={isPanelExpanded("daemon-summary")}
                    className="daemon-collapsible-heading daemon-sessions-summary-heading"
                    onClick={() => {
                      togglePanel("daemon-summary");
                    }}
                    type="button"
                  >
                    <CollapseChevron isExpanded={isPanelExpanded("daemon-summary")} />
                    <span className="daemon-sessions-section-title">Daemon</span>
                    <span className="daemon-sessions-heading-meta">
                      {state.daemon
                        ? `PID ${String(state.daemon.pid)} on port ${String(state.daemon.port)}`
                        : "Not running"}
                    </span>
                  </button>
                  <div
                    className="daemon-collapsible-body"
                    hidden={!isPanelExpanded("daemon-summary")}
                    id="daemon-summary-panel"
                  >
                    <div className="daemon-sessions-summary-row">
                      <span className="daemon-sessions-summary-label">Daemon</span>
                      <span className="daemon-sessions-summary-value">
                        {state.daemon
                          ? `PID ${String(state.daemon.pid)} on port ${String(state.daemon.port)}`
                          : "Not running"}
                      </span>
                    </div>
                    <div className="daemon-sessions-summary-row">
                      <span className="daemon-sessions-summary-label">Protocol</span>
                      <span className="daemon-sessions-summary-value">
                        {state.daemon ? String(state.daemon.protocolVersion) : "N/A"}
                      </span>
                    </div>
                    <div className="daemon-sessions-summary-row">
                      <span className="daemon-sessions-summary-label">Started</span>
                      <span className="daemon-sessions-summary-value">
                        {state.daemon ? formatTimestamp(state.daemon.startedAt) : "N/A"}
                      </span>
                    </div>
                    <div className="daemon-sessions-summary-row">
                      <span className="daemon-sessions-summary-label">Visible rows</span>
                      <span className="daemon-sessions-summary-value">
                        {String(filteredT3Sessions.length + filteredSessions.length)} of{" "}
                        {String((state.t3Sessions?.length ?? 0) + state.sessions.length)}
                      </span>
                    </div>
                  </div>
                </section>
                <section
                  className="daemon-sessions-section"
                  data-collapsed={String(!isPanelExpanded("shared-t3-code"))}
                >
                  <div className="daemon-sessions-section-header">
                    <button
                      aria-controls="shared-t3-code-panel"
                      aria-expanded={isPanelExpanded("shared-t3-code")}
                      className="daemon-collapsible-heading"
                      onClick={() => {
                        togglePanel("shared-t3-code");
                      }}
                      type="button"
                    >
                      <CollapseChevron isExpanded={isPanelExpanded("shared-t3-code")} />
                      <span className="daemon-sessions-section-title">Shared T3 Code</span>
                      <span className="daemon-sessions-heading-meta">
                        {String(filteredT3Sessions.length)} visible
                      </span>
                    </button>
                    <button
                      className="secondary daemon-sessions-toolbar-button daemon-sessions-toolbar-button-danger"
                      disabled={!state.t3Server}
                      onClick={() => {
                        setIsKillT3ServerConfirmOpen(true);
                      }}
                      type="button"
                    >
                      Kill Server
                    </button>
                  </div>
                  <div
                    className="daemon-collapsible-body"
                    hidden={!isPanelExpanded("shared-t3-code")}
                    id="shared-t3-code-panel"
                  >
                    <article
                      className="daemon-session-card daemon-session-card-t3-server"
                      data-current-workspace="true"
                    >
                      <div className="daemon-session-card-header">
                        <div className="daemon-session-card-title-wrap">
                          <div className="daemon-session-card-title">Managed T3 runtime</div>
                          <div className="daemon-session-card-subtitle">
                            Share route is served by VS Code. The runtime on port 3774 starts on
                            demand.
                          </div>
                        </div>
                        <div className="daemon-session-card-badges">
                          <span className="daemon-session-badge">
                            {state.t3Server ? "runtime running" : "runtime stopped"}
                          </span>
                        </div>
                      </div>
                      <div className="daemon-session-card-details">
                        <Detail label="Share URL Port">45438</Detail>
                        <Detail label="Runtime Port">
                          {state.t3Server ? String(state.t3Server.port) : "3774"}
                        </Detail>
                        <Detail label="PID">
                          {state.t3Server
                            ? String(state.t3Server.pid)
                            : state.t3Sessions.length > 0
                              ? "Starts on demand"
                              : "N/A"}
                        </Detail>
                        <Detail label="Started">
                          {state.t3Server?.startedAt
                            ? formatTimestamp(state.t3Server.startedAt)
                            : state.t3Server
                              ? "Detected from live port"
                              : "Not running"}
                        </Detail>
                        <Detail label="Sessions">{String(state.t3Sessions.length)}</Detail>
                      </div>
                    </article>
                    {filteredT3Sessions.length > 0 ? (
                      <div className="daemon-sessions-list">
                        {filteredT3Sessions.map((session) => {
                          const panelId = `t3-session:${session.sessionId}`;
                          const isExpanded = isPanelExpanded(panelId);
                          return (
                            <article
                              className="daemon-session-card"
                              data-current-workspace={String(session.isCurrentWorkspace)}
                              data-collapsed={String(!isExpanded)}
                              key={`t3:${session.sessionId}`}
                            >
                              <div className="daemon-session-card-header">
                                <button
                                  aria-controls={`${panelId}-panel`}
                                  aria-expanded={isExpanded}
                                  className="daemon-session-card-heading-button"
                                  onClick={() => {
                                    togglePanel(panelId);
                                  }}
                                  type="button"
                                >
                                  <CollapseChevron isExpanded={isExpanded} />
                                  <span className="daemon-session-card-title-wrap">
                                    <span className="daemon-session-card-title">
                                      {session.title?.trim() || session.sessionId}
                                    </span>
                                    <span className="daemon-session-card-subtitle">
                                      {session.sessionId}
                                    </span>
                                  </span>
                                </button>
                                <div className="daemon-session-card-badges">
                                  {session.isLocalOnly ? (
                                    <span className="daemon-session-badge">Local</span>
                                  ) : null}
                                  {session.isFocused ? (
                                    <span className="daemon-session-badge daemon-session-badge-current">
                                      Focused
                                    </span>
                                  ) : null}
                                  <span className="daemon-session-badge">
                                    {session.isSleeping
                                      ? "sleeping"
                                      : session.isRunning
                                        ? "running"
                                        : "stopped"}
                                  </span>
                                  <span className="daemon-session-badge">{session.activity}</span>
                                </div>
                              </div>
                              <div
                                className="daemon-collapsible-body"
                                hidden={!isExpanded}
                                id={`${panelId}-panel`}
                              >
                                <div className="daemon-session-card-details">
                                  <Detail label="Workspace">{session.workspaceId}</Detail>
                                  <Detail label="Root">{session.workspaceRoot ?? "Pending"}</Detail>
                                  <Detail label="Thread">{session.threadId ?? "Pending"}</Detail>
                                  <Detail label="Ownership">
                                    {session.isLocalOnly ? "Local" : session.ownership ?? "Local"}
                                  </Detail>
                                  <Detail label="Last Active">
                                    {session.lastInteractionAt
                                      ? formatTimestamp(session.lastInteractionAt)
                                      : "N/A"}
                                  </Detail>
                                  <Detail label="Title">{session.title?.trim() || "N/A"}</Detail>
                                  <Detail label="Detail">{session.detail ?? "N/A"}</Detail>
                                </div>
                                <div className="daemon-session-card-actions">
                                  <button
                                    className="secondary daemon-session-action-button daemon-session-action-button-danger"
                                    onClick={() => {
                                      vscode.postMessage({
                                        sessionId: session.sessionId,
                                        type: "killT3RuntimeSession",
                                      });
                                    }}
                                    type="button"
                                  >
                                    Kill Session
                                  </button>
                                </div>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="group-empty-state daemon-sessions-empty-state daemon-sessions-t3-empty">
                        {searchQuery.trim()
                          ? "No T3 sessions match that search."
                          : state.t3Server
                            ? "No T3 sessions are currently open in this workspace."
                            : "No shared T3 server is currently running."}
                      </div>
                    )}
                  </div>
                </section>
                {state.errorMessage ? (
                  <div className="daemon-sessions-error-banner">{state.errorMessage}</div>
                ) : null}
                {filteredSessions.length > 0 ? (
                  <div className="daemon-sessions-list">
                    {filteredSessions.map((session) => {
                      const panelId = `daemon-session:${session.workspaceId}:${session.sessionId}:${session.startedAt}`;
                      const isExpanded = isPanelExpanded(panelId);
                      return (
                        <article
                          className="daemon-session-card"
                          data-current-workspace={String(session.isCurrentWorkspace)}
                          data-collapsed={String(!isExpanded)}
                          key={`${session.workspaceId}:${session.sessionId}:${session.startedAt}`}
                        >
                          <div className="daemon-session-card-header">
                            <button
                              aria-controls={`${panelId}-panel`}
                              aria-expanded={isExpanded}
                              className="daemon-session-card-heading-button"
                              onClick={() => {
                                togglePanel(panelId);
                              }}
                              type="button"
                            >
                              <CollapseChevron isExpanded={isExpanded} />
                              <span className="daemon-session-card-title-wrap">
                                <span className="daemon-session-card-title">
                                  {session.title?.trim() || session.sessionId}
                                </span>
                                <span className="daemon-session-card-subtitle">
                                  {session.sessionId}
                                </span>
                              </span>
                            </button>
                            <div className="daemon-session-card-badges">
                              {/*
                               * CDXC:RunningSessionsModal 2026-06-02-17:19:
                               * Local-only rows need an in-modal label because gxserver-owned terminal rows and macOS-local panes can appear together after the ownership cutover.
                               */}
                              {session.isLocalOnly ? (
                                <span className="daemon-session-badge">Local</span>
                              ) : session.ownership === "gxserver" ? (
                                <span className="daemon-session-badge">gxserver</span>
                              ) : null}
                              {session.isCurrentWorkspace ? (
                                <span className="daemon-session-badge daemon-session-badge-current">
                                  Current Workspace
                                </span>
                              ) : null}
                              <span className="daemon-session-badge">{session.status}</span>
                              <span className="daemon-session-badge">{session.agentStatus}</span>
                            </div>
                          </div>
                          <div
                            className="daemon-collapsible-body"
                            hidden={!isExpanded}
                            id={`${panelId}-panel`}
                          >
                            <div className="daemon-session-card-details">
                              <Detail label="Workspace">{session.workspaceId}</Detail>
                              <Detail label="CWD">{session.cwd}</Detail>
                              <Detail label="Shell">{session.shell}</Detail>
                              <Detail label="Agent">{session.agentName ?? "Unknown"}</Detail>
                              <Detail label="Ownership">
                                {session.isLocalOnly ? "Local" : session.ownership ?? "Unknown"}
                              </Detail>
                              <Detail label="Restore">{session.restoreState}</Detail>
                              <Detail label="Size">{`${String(session.cols)} x ${String(session.rows)}`}</Detail>
                              <Detail label="Started">{formatTimestamp(session.startedAt)}</Detail>
                              <Detail label="Ended">
                                {session.endedAt ? formatTimestamp(session.endedAt) : "Active"}
                              </Detail>
                              <Detail label="Exit Code">
                                {session.exitCode !== undefined ? String(session.exitCode) : "N/A"}
                              </Detail>
                              <Detail label="Title">{session.title?.trim() || "N/A"}</Detail>
                            </div>
                            {session.errorMessage ? (
                              <div className="daemon-session-card-error">
                                {session.errorMessage}
                              </div>
                            ) : null}
                            <div className="daemon-session-card-actions">
                              <button
                                className="secondary daemon-session-action-button daemon-session-action-button-danger"
                                onClick={() => {
                                  vscode.postMessage({
                                    sessionId: session.sessionId,
                                    type: "killDaemonSession",
                                    workspaceId: session.workspaceId,
                                  });
                                }}
                                type="button"
                              >
                                Kill Session
                              </button>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="group-empty-state daemon-sessions-empty-state">
                    {searchQuery.trim()
                      ? "No daemon sessions match that search."
                      : state.daemon
                        ? "No Ghostex sessions are currently running."
                        : "No Ghostex daemon is currently running."}
                  </div>
                )}
              </>
            ) : (
              <div className="group-empty-state daemon-sessions-empty-state">
                Loading daemon session state…
              </div>
            )}
          </div>
        </div>
      </div>
      <ConfirmationModal
        confirmLabel="Kill Daemon"
        description="This will close the shared Ghostex daemon and disconnect every daemon-managed terminal session across workspaces."
        isOpen={isKillDaemonConfirmOpen}
        onCancel={() => setIsKillDaemonConfirmOpen(false)}
        onConfirm={() => {
          setIsKillDaemonConfirmOpen(false);
          vscode.postMessage({ type: "killTerminalDaemon" });
        }}
        title="Kill Shared Daemon"
      />
      <ConfirmationModal
        confirmLabel="Kill Server"
        description="This will stop the shared T3 Code server for this VS Code window. Existing T3 sessions will remain listed in Ghostex and can be started again later."
        isOpen={isKillT3ServerConfirmOpen}
        onCancel={() => setIsKillT3ServerConfirmOpen(false)}
        onConfirm={() => {
          setIsKillT3ServerConfirmOpen(false);
          vscode.postMessage({ type: "killT3RuntimeServer" });
        }}
        title="Kill Shared T3 Server"
      />
    </>,
    document.body,
  );
}

type DetailProps = {
  children: string;
  label: string;
};

function Detail({ children, label }: DetailProps) {
  return (
    <div className="daemon-session-detail">
      <div className="daemon-session-detail-label">{label}</div>
      <div className="daemon-session-detail-value">{children}</div>
    </div>
  );
}

function CollapseChevron({ isExpanded }: { isExpanded: boolean }) {
  return (
    <IconChevronRight
      aria-hidden="true"
      className="daemon-collapsible-chevron"
      data-expanded={String(isExpanded)}
      size={14}
      stroke={2}
    />
  );
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}
