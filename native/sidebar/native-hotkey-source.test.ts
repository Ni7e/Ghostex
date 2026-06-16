import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");
const sidebarAppSource = readFileSync(new URL("../../sidebar/sidebar-app.tsx", import.meta.url), "utf8");
const nativeAppDelegateSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift", import.meta.url),
  "utf8",
);
const nativeHostProtocolSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/HostProtocol.swift", import.meta.url),
  "utf8",
);
const nativeTerminalWorkspaceSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift", import.meta.url),
  "utf8",
);

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("native sidebar hotkey source", () => {
  test("routes nativeHotkey host events through the native wrapper with source focus", () => {
    /*
     * CDXC:Hotkeys 2026-06-12-12:33:
     * Cmd+T in the macOS app should create one terminal tab. The native wrapper
     * handles typed nativeHotkey host events directly, so its embedded shared
     * SidebarApp disables the shared custom-event listener instead of issuing a
     * second createSession bridge request.
     */
    expect(nativeSidebarSource).toContain('if (hostEvent.type === "nativeHotkey") {');
    expect(nativeSidebarSource).toContain('sourceSessionId?: string; type: "nativeHotkey"');
    expect(nativeSidebarSource).toContain(
      "sidebarSessionIdForNativeSession(hostEvent.sourceSessionId)",
    );
    expect(nativeAppDelegateSource).toContain("workspaceView.nativeHotkeySourceSessionId()");
    expect(nativeAppDelegateSource).toContain(
      "sendHostEvent(.nativeHotkey(actionId: actionId, sourceSessionId: sourceSessionId))",
    );
    expect(nativeHostProtocolSource).toContain(
      "case nativeHotkey(actionId: String, sourceSessionId: String?)",
    );
    expect(nativeHostProtocolSource).toContain(
      "try container.encodeIfPresent(sourceSessionId, forKey: .sourceSessionId)",
    );
    expect(nativeTerminalWorkspaceSource).toContain(
      "func nativeHotkeySourceSessionId() -> String?",
    );
    expect(nativeSidebarSource).toContain("nativeHostEventSource={null}");
    expect(sidebarAppSource).toContain("nativeHostEventSource?: SidebarEventSource | null;");
    expect(sidebarAppSource).toContain("if (!nativeHostEventSource) {");
    expect(sidebarAppSource).toContain(
      'nativeHostEventSource.addEventListener("ghostex-native-host-event", handleNativeHostEvent);',
    );
  });

  test("does not classify routine hotkey and focus breadcrumbs as normal-mode diagnostics", () => {
    /*
     * CDXC:Diagnostics 2026-06-15-18:39:
     * Normal-mode persistent logs should keep failures, warnings, errors,
     * timeouts, and malformed payloads, but routine hotkey/focus/layout repro
     * breadcrumbs must require Debugging Mode so held shortcuts, focus churn,
     * and action trace breadcrumbs cannot create support-bundle noise.
     */
    const classifierSource = sourceBetween(
      nativeSidebarSource,
      "function shouldPersistNativeSidebarDiagnostic",
      "const SIDEBAR_REFRESH_DEBUG_LOG_SAMPLE_MS",
    );
    expect(classifierSource).toContain('normalizedEvent.includes("warn")');
    expect(classifierSource).toContain('normalizedEvent.includes("fail")');
    expect(classifierSource).toContain('normalizedEvent.includes("error")');
    expect(classifierSource).toContain('normalizedEvent.includes("invalid")');
    expect(classifierSource).toContain('normalizedEvent.includes("timeout")');
    expect(classifierSource).not.toContain('startsWith("nativefocustrace.');
    expect(classifierSource).not.toContain('startsWith("nativehotkeys.navigationrepro")');
    expect(classifierSource).not.toContain('startsWith("nativepanelayouttrace.');
    expect(classifierSource).not.toContain('includes("missing")');
    expect(classifierSource).toContain('startsWith("nativesidebar.actioncrashtrace.")');

    const hotkeyReproSource = sourceBetween(
      nativeSidebarSource,
      "function appendNativeHotkeyNavigationReproLog",
      "function recordSidebarCardFocusTrace",
    );
    expect(hotkeyReproSource).toContain("isNativeSidebarDebugLoggingEnabled()");
    expect(hotkeyReproSource).toContain("{ force: true }");

    const actionTraceSource = sourceBetween(
      nativeSidebarSource,
      "function appendActionCrashTraceDebugLog",
      "function appendModeSwitcherDebugLog",
    );
    expect(actionTraceSource).toContain("appendTerminalFocusDebugLog(event, details, { force: true })");
  });

  test("keeps command modifier state wired for the dormant Cmd-hold overlay", () => {
    /*
     * CDXC:Hotkeys 2026-06-14-19:40:
     * Holding Cmd can show the sidebar hotkey overlay from native focus, not
     * only when WebKit sidebar chrome receives keydown. Keep this as a typed
     * host event carrying only the command-modifier boolean.
     *
     * CDXC:Hotkeys 2026-06-15-02:33:
     * The overlay is temporarily disabled in SidebarApp, but its dormant native
     * bridge should remain greppable so restoring it does not require rebuilding
     * the AppKit-to-React event path.
     */
    expect(sidebarAppSource).toContain("const SIDEBAR_HOTKEY_OVERLAY_ENABLED = false;");
    expect(nativeAppDelegateSource).toContain(
      "appHotkeyModifierEventMonitor = NSEvent.addLocalMonitorForEvents(matching: .flagsChanged)",
    );
    expect(nativeAppDelegateSource).toContain(
      "dispatchCommandModifierStateForHotkeyOverlay(",
    );
    expect(nativeAppDelegateSource).toContain(
      ".nativeModifierState(isCommandPressed: isCommandPressed)",
    );
    expect(nativeAppDelegateSource).toContain(
      "dispatchCommandModifierStateForHotkeyOverlay(isCommandPressed: false, force: true)",
    );
    expect(nativeHostProtocolSource).toContain(
      "case nativeModifierState(isCommandPressed: Bool)",
    );
    expect(nativeHostProtocolSource).toContain(
      'try container.encode("nativeModifierState", forKey: .type)',
    );
    expect(nativeHostProtocolSource).toContain(
      "try container.encode(isCommandPressed, forKey: .isCommandPressed)",
    );
    expect(nativeSidebarSource).toContain(
      'isCommandPressed: boolean; type: "nativeModifierState"',
    );
    expect(nativeSidebarSource).toContain('if (hostEvent.type === "nativeModifierState") {');
    expect(sidebarAppSource).toContain("function isNativeModifierStateHostEvent");
    expect(sidebarAppSource).toContain('value as NativeModifierStateHostEvent).type === "nativeModifierState"');
  });

  test("resolves session slot hotkeys from the active project display layout", () => {
    /*
     * CDXC:Hotkeys 2026-06-13-07:33:
     * Cmd+1..9 in the macOS app must count the visible sidebar session rows,
     * not native tab or pane chrome that also carries session IDs. This keeps
     * slot numbers aligned with the Last Active order shown in the sidebar.
     *
     * CDXC:Hotkeys 2026-06-15-01:26:
     * Numbered slots are scoped to the active project so Quick rows above
     * Projects cannot become Cmd+1 for a normal code project.
     *
     * CDXC:Hotkeys 2026-06-15-10:37:
     * Native numbered slots use the same projected group display layout as the
     * sidebar instead of a DOM scan that can omit a mounted visible row.
     */
    expect(nativeSidebarSource).toContain("createDisplaySessionLayout({");
    expect(nativeSidebarSource).toContain("getVisibleProjectSessionIds({");
    expect(nativeSidebarSource).toContain(
      "function getNativeHotkeySidebarSessionSlotGroups(project: NativeProject)",
    );
    expect(nativeSidebarSource).toContain("group.groupId === COMBINED_CHATS_GROUP_ID");
    expect(nativeSidebarSource).toContain(
      "group.projectContext?.editor.projectId === project.projectId",
    );
    expect(nativeSidebarSource).toContain("previousSnapshot.projectId === project.projectId");
    expect(nativeSidebarSource).toContain(
      "NATIVE_HOTKEY_SESSION_SLOT_SNAPSHOT_TTL_MS = 1500",
    );
    expect(nativeSidebarSource).toContain("readNativeHotkeySessionSlotSnapshot()");
    expect(nativeSidebarSource).toContain(
      'logNativeHotkeyDebug("nativeHotkeys.sessionSlotResolved"',
    );
    expect(nativeSidebarSource).toContain("visibleSlotSessionIds: sessionIds.slice(0, 9)");
    expect(nativeSidebarSource).toContain(
      'logNativeHotkeyDebug("nativeHotkeys.sessionSlotScopeMissing"',
    );
    expect(nativeSidebarSource).not.toContain("readRenderedSidebarSessionSlots(slotRoot)");
    expect(nativeSidebarSource).not.toContain(
      'document.querySelector(".native-sidebar-main") ?? document',
    );
  });

  test("resolves project jump hotkeys from projected Projects rows", () => {
    /*
     * CDXC:ProjectHotkeys 2026-06-15-11:12:
     * Cmd+Ctrl+1..9 must jump across local Projects sidebar rows, not active
     * workspace group indexes or rendered DOM cards. The target row may be
     * collapsed, so native dispatch asks SidebarApp to reveal it and optionally
     * switch that project session list to Show less.
     */
    expect(nativeSidebarSource).toContain('case "jumpToProject":');
    expect(nativeSidebarSource).toContain("jumpToNativeHotkeyProject(action.projectIndex);");
    expect(nativeSidebarSource).toContain("function createNativeHotkeyProjectSlots()");
    expect(nativeSidebarSource).toContain(
      "createPresentationSidebarGroups(gxserverStartupSnapshot?.presentation)",
    );
    expect(nativeSidebarSource).toContain("group.projectContext?.editor.projectId");
    expect(nativeSidebarSource).toContain(
      "group.isChatCollection === true || group.remoteMachineContext",
    );
    expect(nativeSidebarSource).toContain("orderNativeProjectsForSidebar(projects)");
    expect(nativeSidebarSource).toContain("!isQuickProject(project)");
    expect(nativeSidebarSource).toContain(
      "NATIVE_HOTKEY_PROJECT_SLOT_SNAPSHOT_TTL_MS = 1500",
    );
    expect(nativeSidebarSource).toContain(
      'rememberActiveProjectWorkspaceTerminal("jumpToProjectBeforeSwitch");',
    );
    expect(nativeSidebarSource).toContain("activateWorkspaceSurfaceForProject(target.projectId);");
    expect(nativeSidebarSource).toContain("focusProject(target.projectId);");
    expect(nativeSidebarSource).toContain(
      "resolveNativeHotkeyProjectJumpTerminalSessionId(",
    );
    expect(nativeSidebarSource).toContain("SIDEBAR_PROJECT_JUMP_EVENT");
    expect(nativeSidebarSource).toContain("settings.expandCollapsedProjectsOnJump");
    expect(nativeSidebarSource).toContain("settings.showLessForExpandedProjectJumps");
    expect(nativeSidebarSource).not.toContain("function focusNativeHotkeyGroupByIndex");

    expect(sidebarAppSource).toContain("SIDEBAR_PROJECT_JUMP_EVENT");
    expect(sidebarAppSource).toContain("projectJumpAutoExpand");
    expect(sidebarAppSource).toContain("revealFocusedSession");
    expect(sidebarAppSource).toContain("focusedSessionRevealRequestId");
    expect(sidebarAppSource).toContain("writeProjectSessionListCollapsedState({");
    expect(sidebarAppSource).toContain("...readProjectSessionListCollapsedState()");
    expect(sidebarAppSource).toContain('action.kind === "jumpToProject"');

    expect(nativeAppDelegateSource).toContain('"jumpToProject1": "cmd+ctrl+1"');
    expect(nativeAppDelegateSource).toContain('"jumpToProject9": "cmd+ctrl+9"');
    expect(nativeAppDelegateSource).toContain('"jumpToProject1": "focusGroup1"');
    expect(nativeAppDelegateSource).not.toContain('"focusGroup1": "cmd+ctrl+1"');
  });

  test("resolves directional pane hotkeys from the rendered native layout first", () => {
    /*
     * CDXC:PaneFocus 2026-06-13-21:19:
     * Cmd+Opt+Arrow must move through visible native panes in rendered order.
     * Keep the rendered-layout resolver ahead of the shared visible-session
     * reducer so a1 b1 c1 cannot skip b1, and so expanded command-pane splits
     * participate in the same arrow-key focus map.
     *
     * CDXC:SleepingPanePlaceholders 2026-06-13-21:35:
     * Rendered pane hotkeys must reuse native pane-tab selection instead of
     * sidebar focus. The tab path preserves selected sleeping placeholders and
     * avoids waking or relocating the target pane while click-to-wake is enabled.
     */
    const directionSourceStart = nativeSidebarSource.indexOf(
      "function focusNativeHotkeyDirection(",
    );
    expect(directionSourceStart).toBeGreaterThanOrEqual(0);
    const directionSourceEnd = nativeSidebarSource.indexOf(
      "function focusProjectEditorCompanionHotkeyDirection",
      directionSourceStart,
    );
    expect(directionSourceEnd).toBeGreaterThan(directionSourceStart);
    const directionSource = nativeSidebarSource.slice(directionSourceStart, directionSourceEnd);
    const renderedResolverIndex = directionSource.indexOf(
      "getRenderedNativeHotkeyDirectionTarget",
    );
    const sharedReducerIndex = directionSource.indexOf("focusVisibleDirectionInSimpleWorkspace");
    const companionResolverAfterRenderedIndex = directionSource.indexOf(
      "focusProjectEditorCompanionHotkeyDirection",
      renderedResolverIndex,
    );

    expect(nativeSidebarSource).toContain("lastRenderedNativeHotkeyLayout");
    expect(nativeSidebarSource).toContain("function buildCurrentRenderedNativeHotkeyLayout");
    expect(nativeSidebarSource).toContain("function getDirectionalNativePaneFocusTarget");
    expect(nativeSidebarSource).toContain(
      "getNativeHotkeyFocusedSidebarSessionId(snapshot, sourceSessionId)",
    );
    expect(nativeSidebarSource).toContain("function collectRenderedNativeHotkeyPaneFocusRects");
    expect(nativeSidebarSource).toContain("commandsPanelLayout");
    expect(nativeSidebarSource).toContain("commandsPanelIsVisible");
    expect(nativeSidebarSource).toContain(
      'const shouldResolveRenderedLayoutBeforeCompanion = direction === "up" || direction === "down";',
    );
    expect(directionSource).toContain("!shouldResolveRenderedLayoutBeforeCompanion &&");
    expect(directionSource).toContain("shouldResolveRenderedLayoutBeforeCompanion &&");
    expect(nativeSidebarSource).toContain('"nativeHotkeys.focusDirectionStart"');
    expect(directionSource).toContain('"nativeHotkeys.renderedFocusDirectionResolved"');
    expect(nativeAppDelegateSource).toContain(
      "fileprivate static func terminalFocusDebugPayload(event: String, details: String?)",
    );
    expect(nativeAppDelegateSource).toContain('event.hasPrefix("nativeHotkeys.")');
    expect(nativeAppDelegateSource).toContain("JSONSerialization.jsonObject(with: data)");
    expect(renderedResolverIndex).toBeGreaterThanOrEqual(0);
    expect(companionResolverAfterRenderedIndex).toBeGreaterThan(renderedResolverIndex);
    expect(sharedReducerIndex).toBeGreaterThan(renderedResolverIndex);
    expect(directionSource).toContain("handleNativePaneTabSelected(renderedPaneTarget.sessionId);");
    expect(directionSource).not.toContain("focusSidebarSession(renderedPaneTarget.sessionId);");
  });

  test("passes explicit layout focus targets for command-pane arrow navigation", () => {
    /*
     * CDXC:PaneFocus 2026-06-13-23:13:
     * Cmd+Opt+Down can resolve from a workspace terminal to an expanded
     * Commands panel pane. The layout focus request must include that exact
     * native session id, and Swift must honor it before the workspace
     * focusedSessionId so first responder moves to the command terminal.
     */
    expect(nativeSidebarSource).toContain("focusRequestSessionId?: string;");
    expect(nativeSidebarSource).toContain(
      "const focusRequestSessionId =\n    shouldConsumeFocusRequest && pendingNativeLayoutFocusRequest",
    );
    expect(nativeSidebarSource).toContain(
      "nativeSessionIdForSidebarSession(pendingNativeLayoutFocusRequest.sessionId)",
    );
    expect(nativeSidebarSource).toContain(
      "...(focusRequestSessionId !== undefined ? { focusRequestSessionId } : {})",
    );
    expect(nativeSidebarSource).toContain(
      'queueNativeLayoutFocusRequest(sessionId, "paneTabSelectedAlreadyActive");',
    );
    expect(nativeSidebarSource).toContain(
      "focusRequestSessionId: _focusRequestSessionId,",
    );
    expect(nativeHostProtocolSource).toContain("let focusRequestSessionId: String?");

    const nativeFocusRequestStart = nativeTerminalWorkspaceSource.indexOf(
      "let requestedFocusSessionId =",
    );
    expect(nativeFocusRequestStart).toBeGreaterThanOrEqual(0);
    const nativeFocusRequestSource = nativeTerminalWorkspaceSource.slice(
      nativeFocusRequestStart,
      nativeFocusRequestStart + 500,
    );
    const requestTargetIndex = nativeFocusRequestSource.indexOf("command.focusRequestSessionId");
    const workspaceFallbackIndex = nativeFocusRequestSource.indexOf("command.focusedSessionId");
    const commandFallbackIndex = nativeFocusRequestSource.indexOf(
      "command.commandsPanelFocusedSessionId",
    );
    expect(requestTargetIndex).toBeGreaterThanOrEqual(0);
    expect(workspaceFallbackIndex).toBeGreaterThan(requestTargetIndex);
    expect(commandFallbackIndex).toBeGreaterThan(workspaceFallbackIndex);
  });

  test("routes native command-pane create split and close hotkeys to live focus", () => {
    /*
     * CDXC:CommandPaneHotkeys 2026-06-13-23:31:
     * Cmd+T, Cmd+D, Cmd+Shift+D, and Cmd+W should apply to the Commands panel
     * when the terminal owning live AppKit typing focus is a command terminal.
     * The native sourceSessionId/responder must override the remembered
     * workspace focusedSessionId for these command-pane hotkeys.
     */
    expect(nativeSidebarSource).toContain(
      "function getNativeHotkeyCommandPanelSourceSessionId(sourceSessionId?: string)",
    );
    expect(nativeSidebarSource).toContain('sourceSession.surface !== "commands"');
    expect(nativeSidebarSource).toContain(
      "createNativeSessionInCurrentContext(sourceSessionId);",
    );
    expect(nativeSidebarSource).toContain(
      "splitFocusedNativePane(action.direction, sourceSessionId);",
    );
    expect(nativeSidebarSource).toContain(
      "targetTabGroupSessionId: commandSourceSessionId",
    );
    expect(nativeSidebarSource).toContain("function splitFocusedCommandPanelPane(");
    expect(nativeSidebarSource).toContain(
      'const commandPanelSplitDirection: SessionPaneSplitDirection = "horizontal";',
    );
    expect(nativeSidebarSource).toContain("requestedDirection: direction");
    expect(nativeSidebarSource).toContain("targetSplitDirection: commandPanelSplitDirection");
    expect(nativeSidebarSource).toContain("targetSplitSessionId: targetSessionId");
    expect(nativeSidebarSource).toContain(
      'queueNativeLayoutFocusRequest(commandSession.sessionId, "commandTerminalCreated");',
    );
    expect(nativeSidebarSource).toContain(
      "function resolveCommandPanelActiveSessionIdAfterRemoval(",
    );
    expect(nativeSidebarSource).toContain('case "close":');
    expect(nativeSidebarSource).toContain(
      "transitionOrigin: createCommandPaneTransitionOrigin(activeProject(), sessionId)",
    );
    expect(nativeTerminalWorkspaceSource).toContain(
      "Cmd+W should close the command terminal that owns first responder",
    );
    expect(nativeTerminalWorkspaceSource).toContain(
      "sendEvent(.terminalTitleBarAction(sessionId: sessionId, action: .close))",
    );
    expect(nativeSidebarSource).toContain(
      "direction: SessionPaneSplitDirection",
    );
    expect(nativeSidebarSource).toContain(
      'throw new Error("Command panel split placement target was validated but not found.")',
    );
  });
});
