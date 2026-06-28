import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const appDelegateSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift", import.meta.url),
  "utf8",
);
const hostProtocolSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/HostProtocol.swift", import.meta.url),
  "utf8",
);
const modeSwitcherLogSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/NativeModeSwitcherDebugLog.swift", import.meta.url),
  "utf8",
);
const terminalWorkspaceSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift", import.meta.url),
  "utf8",
);
const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");
const titlebarHostSource = readFileSync(new URL("./titlebar-host.tsx", import.meta.url), "utf8");

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

function appendModeSwitcherLogCalls(source: string): string {
  const calls: string[] = [];
  let searchIndex = 0;
  while (searchIndex < source.length) {
    const startIndex = source.indexOf("appendModeSwitcherDebugLog(", searchIndex);
    if (startIndex === -1) {
      break;
    }
    const endIndex = source.indexOf("});", startIndex);
    expect(endIndex).toBeGreaterThan(startIndex);
    calls.push(source.slice(startIndex, endIndex + 3));
    searchIndex = endIndex + 3;
  }
  return calls.join("\n");
}

function nativeModeSwitcherLogCalls(source: string): string {
  return source.match(/NativeModeSwitcherDebugLog\.append\([\s\S]*?\]\)/g)?.join("\n") ?? "";
}

describe("titlebar mode switch diagnostics source", () => {
  test("routes all mode-switch timing through the dedicated sanitized native log", () => {
    /*
     * CDXC:ModeSwitcherDiagnostics 2026-06-15-00:21:
     * Agents/Source/Browser/Kanban/Manage lag repros need a dedicated support-bundle
     * log that is Debugging Mode gated and sanitized at the writer boundary.
     * Source coverage keeps the titlebar/sidebar bridge off the older
     * session-title log and prevents raw path, URL, title, command, or user-text
     * fields from returning to the mode-switch breadcrumb chain.
     */
    expect(hostProtocolSource).toContain(
      "case appendModeSwitcherDebugLog(AppendModeSwitcherDebugLog)",
    );
    expect(hostProtocolSource).toContain("struct AppendModeSwitcherDebugLog: Decodable");
    expect(appDelegateSource).toContain("fileprivate static func appendModeSwitcherDebugLog");
    expect(modeSwitcherLogSource).toContain("native-mode-switcher-debug.log");
    expect(modeSwitcherLogSource).toContain("NativeDiagnosticLogging.isScenarioEnabled(.nativeModeSwitcher)");
    expect(modeSwitcherLogSource).toContain("NativeLogPrivacy.sanitizePayload(payload)");

    const titlebarHelper = sourceBetween(
      titlebarHostSource,
      "function appendTitlebarModeSwitchDebugLog",
      "function titlebarModeSwitchLogDetails",
    );
    expect(titlebarHelper).toContain('type: "appendModeSwitcherDebugLog"');
    expect(titlebarHelper).not.toContain("appendSessionTitleDebugLog");

    const sidebarHelper = sourceBetween(
      nativeSidebarSource,
      "function appendModeSwitcherDebugLog",
      "function appendTerminalLaunchDebugLog",
    );
    expect(sidebarHelper).toContain('type: "appendModeSwitcherDebugLog"');
    expect(sidebarHelper).toContain("isNativeSidebarDebugLoggingEnabled()");
    expect(sidebarHelper).not.toContain("appendSessionTitleDebugLog");
  });

  test("covers every mode and the Browser seed lookup without sensitive fields", () => {
    const titlebarClickSource = sourceBetween(
      titlebarHostSource,
      "  const openAgentsMode = () => {",
      "  const toggleProjectEditorCompanion = () => {",
    );
    expect(titlebarClickSource).toContain('targetMode: "agents"');
    expect(titlebarClickSource).toContain('targetMode: "code"');
    expect(titlebarClickSource).toContain('targetMode: "git"');
    expect(titlebarClickSource).toContain('targetMode: "tasks"');
    expect(titlebarClickSource).toContain('targetMode: "manage"');
    expect(titlebarClickSource).toContain("titlebarModeSwitch.titlebarClickStart");
    expect(titlebarClickSource).toContain("titlebarModeSwitch.titlebarClickPostedNative");
    expect(titlebarClickSource).not.toContain("projectPath");

    const sidebarModeSource = sourceBetween(
      nativeSidebarSource,
      "function wakeProjectEditorSurface",
      "function openRemoteProjectBoardForGroup",
    );
    expect(sidebarModeSource).toContain("titlebarModeSwitch.sidebarAgentsHandlerStart");
    expect(sidebarModeSource).toContain("titlebarModeSwitch.sidebarWakeStart");
    expect(sidebarModeSource).toContain("titlebarModeSwitch.browserSeedRepoCheckStart");
    expect(sidebarModeSource).toContain("titlebarModeSwitch.browserSeedRemoteCheckDone");
    expect(sidebarModeSource).toContain("titlebarModeSwitch.tasksHandlerResolvedBoard");
    expect(sidebarModeSource).toContain("titlebarModeSwitch.manageHandlerStart");
    const sidebarModeLogCalls = appendModeSwitcherLogCalls(sidebarModeSource);
    expect(sidebarModeLogCalls).not.toContain("projectPath:");
    expect(sidebarModeLogCalls).not.toContain("projectName:");
    expect(sidebarModeLogCalls).not.toContain("cwd:");
    expect(sidebarModeLogCalls).not.toContain("command.cwd");
    expect(sidebarModeLogCalls).not.toContain("command.title");
    expect(sidebarModeLogCalls).not.toContain("localizedDescription");
  });

  test("covers native CEF and WebKit load state without raw navigation details", () => {
    /*
     * CDXC:ModeSwitcherDiagnostics 2026-06-15-00:21:
     * Browser delay repros need native load-state breadcrumbs after the sidebar
     * posts createProjectEditorPane. The mode-switch log must record load phase,
     * renderer kind, booleans, and timings without raw URLs, page titles, paths,
     * console text, or CEF error text.
     */
    const nativeLoadSource = sourceBetween(
      terminalWorkspaceSource,
      "private static func modeSwitcherDebugURLKind",
      "private func updateProjectEditorActiveTabMetadata",
    );
    expect(nativeLoadSource).toContain("titlebarModeSwitch.nativeProjectEditorLoadStart");
    expect(nativeLoadSource).toContain("titlebarModeSwitch.nativeProjectEditorDirectNavigationPosted");
    expect(nativeLoadSource).toContain("titlebarModeSwitch.nativeCefNavigationStateChanged");
    expect(nativeLoadSource).toContain("titlebarModeSwitch.nativeCefLoadEvent");
    expect(nativeLoadSource).toContain("titlebarModeSwitch.nativeCefRunningDeferred");
    expect(nativeLoadSource).toContain("titlebarModeSwitch.nativeCefRunningSent");
    expect(terminalWorkspaceSource).toContain("titlebarModeSwitch.nativeWebKitRunningSent");
    expect(terminalWorkspaceSource).toContain("titlebarModeSwitch.nativeWebKitLoadFailed");

    const nativeModeLogCalls = nativeModeSwitcherLogCalls(nativeLoadSource);
    expect(nativeModeLogCalls).toContain("urlKind");
    expect(nativeModeLogCalls).toContain("currentUrlKind");
    expect(nativeModeLogCalls).not.toContain('"url":');
    expect(nativeModeLogCalls).not.toContain('"title":');
    expect(nativeModeLogCalls).not.toContain("errorText");
    expect(nativeModeLogCalls).not.toContain("currentURLString ??");
    expect(nativeModeLogCalls).not.toContain("localizedDescription");
  });
});
