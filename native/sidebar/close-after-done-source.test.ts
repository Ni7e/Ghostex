import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");
const sortableSessionCardSource = readFileSync(
  new URL("../../sidebar/sortable-session-card.tsx", import.meta.url),
  "utf8",
);
const terminalWorkspaceViewSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift", import.meta.url),
  "utf8",
);
const hostProtocolSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/HostProtocol.swift", import.meta.url),
  "utf8",
);
const nativeHostProtocolSource = readFileSync(
  new URL("../../shared/native-ghostty-host-protocol.ts", import.meta.url),
  "utf8",
);

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThan(-1);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("close after done source", () => {
  test("arms a three-minute done watcher from the session context menu", () => {
    /*
     * CDXC:CloseAfterDone 2026-06-15-21:00:
     * Close After Done must be a native-owned three-minute Done-state watcher,
     * exposed immediately below Delayed Send and routed through the existing
     * close path only after rechecking the session is still Done.
     */
    const publishSource = sourceBetween(
      nativeSidebarSource,
      "function preparePublishContext(): PublishContext {",
      "function finishPublishContext(",
    );
    const completeTimerSource = sourceBetween(
      nativeSidebarSource,
      "function completeCloseAfterDoneTimer(",
      "function isCloseAfterDoneSessionMarkedDone(",
    );
    const messageHandlerSource = sourceBetween(
      nativeSidebarSource,
      '    case "scheduleDelayedSend":',
      '    case "fullReloadSession":',
    );
    const sessionActionsSource = sourceBetween(
      sortableSessionCardSource,
      "  if (canDelayedSend) {",
      "  if (canForkSession) {",
    );
    const nativePaneActionsSource = sourceBetween(
      nativeSidebarSource,
      "function getNativePaneTitleBarActions(session: SessionRecord): NativeTerminalTitleBarAction[] {",
      "type NativeResumeAgentId =",
    );
    const nativeActionHandlerSource = sourceBetween(
      nativeSidebarSource,
      '    case "delayedSend":',
      '    case "fork":',
    );
    const primaryTabMenuSource = sourceBetween(
      terminalWorkspaceViewSource,
      "  private func primaryTabContextMenuActions() -> [TerminalTitleBarAction] {",
      "  private func addTabActionMenuItem",
    );
    const defaultActionsSource = sourceBetween(
      terminalWorkspaceViewSource,
      "  static let defaultActions: [TerminalTitleBarAction] = [",
      "  static let webPaneCreationActions: [TerminalTitleBarAction] = [",
    );
    const donePredicateSource = sourceBetween(
      nativeSidebarSource,
      "function isCloseAfterDoneSessionMarkedDone(",
      "function getCloseAfterDoneProjectionForProjectSession(",
    );

    expect(nativeSidebarSource).toContain("const CLOSE_AFTER_DONE_DELAY_MS = 3 * 60_000;");
    expect(publishSource).toContain("refreshCloseAfterDoneTimersForAllSessions();");
    expect(messageHandlerSource).toContain('case "toggleCloseAfterDone":');
    expect(messageHandlerSource).toContain("toggleCloseAfterDone(message.sessionId);");
    expect(completeTimerSource).toContain("!isCloseAfterDoneSessionMarkedDone(projectId, sessionId)");
    expect(completeTimerSource).toContain("closeTerminal(createCombinedProjectSessionId(projectId, sessionId));");
    expect(donePredicateSource).toContain('presentationSession.activity !== "working"');
    expect(donePredicateSource).toContain("hasCloseAfterDoneAgentIdentity(presentationSession)");
    expect(donePredicateSource).toContain('terminalState?.activity === "working"');
    expect(sessionActionsSource.indexOf('key: "delayed-send"')).toBeLessThan(
      sessionActionsSource.indexOf('key: "close-after-done"'),
    );
    expect(sortableSessionCardSource).not.toContain("session-context-menu-icon-close-after-done");
    expect(nativeHostProtocolSource).toContain('| "closeAfterDone"');
    expect(hostProtocolSource).toContain("case closeAfterDone");
    expect(nativePaneActionsSource.indexOf('"delayedSend"')).toBeLessThan(
      nativePaneActionsSource.indexOf('"closeAfterDone"'),
    );
    expect(nativeActionHandlerSource).toContain('case "closeAfterDone":');
    expect(nativeActionHandlerSource).toContain("toggleCloseAfterDone(sessionId);");
    expect(primaryTabMenuSource).toContain(
      "return [.rename, .delayedSend, .closeAfterDone, .fork, .reload, popOutAction]",
    );
    expect(defaultActionsSource.indexOf(".delayedSend")).toBeLessThan(
      defaultActionsSource.indexOf(".closeAfterDone"),
    );
  });
});
