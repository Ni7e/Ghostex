import Foundation

func assertTrue(_ condition: Bool, _ message: String) {
  if !condition {
    fputs("\(message)\n", stderr)
    exit(1)
  }
}

func serializePrivacyTestPayload(_ payload: [String: Any]) -> String {
  guard
    JSONSerialization.isValidJSONObject(payload),
    let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]),
    let json = String(data: data, encoding: .utf8)
  else {
    fputs("privacy test payload did not serialize\n", stderr)
    exit(1)
  }
  return json
}

@main
enum NativeLogPrivacyTests {
  static func main() {
    let sanitized = NativeLogPrivacy.sanitizePayload([
      "details": [
        "authToken": "secret-token",
        "command": "codex --dangerously-do-something",
        "missingWorkspaceNativeSessionIds": ["P123:G456"],
        "projectId": "P123",
        "projectName": "Customer Project",
        "projectPath": "/Users/person/dev/customer-project",
        "sessionId": "G456",
        "url": "https://example.test/private?token=secret-token",
      ],
      "event": "nativeSidebar.gxserver.presentationTabReconciliation.mismatch",
    ])
    let json = serializePrivacyTestPayload(sanitized)

    assertTrue(json.contains("nativeSidebar.gxserver.presentationTabReconciliation.mismatch"), "event should remain visible")
    assertTrue(json.contains("P123"), "project id should remain visible")
    assertTrue(json.contains("G456"), "session id should remain visible")
    assertTrue(json.contains("missingWorkspaceNativeSessionIds"), "structured mismatch key should remain visible")
    assertTrue(!json.contains("Customer Project"), "project names must be redacted")
    assertTrue(!json.contains("/Users/person"), "paths must be redacted")
    assertTrue(!json.contains("codex --dangerously-do-something"), "command text must be redacted")
    assertTrue(!json.contains("secret-token"), "secrets must be redacted")
    assertTrue(!json.contains("private?token"), "full URLs and query strings must be redacted")

    let persistenceKillPayload = NativeLogPrivacy.sanitizePayload([
      "details": [
        "provider": "zmx",
        "reason": "sleepSession",
        "sessionId": "S456",
        "stderrBytes": 128,
        "stdoutBytes": 64,
        "terminationStatus": 0,
      ],
      "event": "nativeWorkspace.persistenceSessionKill.completed",
    ])
    let persistenceKillJson = serializePrivacyTestPayload(persistenceKillPayload)

    assertTrue(persistenceKillJson.contains("nativeWorkspace.persistenceSessionKill.completed"), "persistence kill event should remain visible")
    assertTrue(persistenceKillJson.contains("stderrBytes"), "stderr byte count should remain visible")
    assertTrue(persistenceKillJson.contains("stdoutBytes"), "stdout byte count should remain visible")
    assertTrue(!persistenceKillJson.contains("sessionName"), "persistence kill logs must not include provider session-name keys")
    assertTrue(!persistenceKillJson.contains("stderr\":\""), "persistence kill logs must not include stderr text")
    assertTrue(!persistenceKillJson.contains("stdout\":\""), "persistence kill logs must not include stdout text")
    assertTrue(!persistenceKillJson.contains("P1.S2"), "persistence kill logs must not include raw zmx names")

    /*
     CDXC:ModeSwitcherDiagnostics 2026-06-15-00:21:
     Mode-switch timings depend on small numeric values such as 0 ms elapsed,
     one browser tab, and zero exit status. Keep those as numbers in sanitized
     payloads while preserving real booleans so support can distinguish timing
     from state without exposing user-owned content.
     */
    let numericTelemetryPayload = NativeLogPrivacy.sanitizePayload([
      "browserTabCount": NSNumber(value: 1),
      "elapsedMs": NSNumber(value: 0),
      "event": "titlebarModeSwitch.browserSurfaceResolvedTabs",
      "exitCode": NSNumber(value: 0),
      "hasError": NSNumber(value: false),
      "isAwakeTargetMode": NSNumber(value: true),
    ])
    let numericTelemetryJson = serializePrivacyTestPayload(numericTelemetryPayload)

    assertTrue(numericTelemetryJson.contains("\"elapsedMs\":0"), "elapsed timing should remain numeric")
    assertTrue(numericTelemetryJson.contains("\"browserTabCount\":1"), "counts should remain numeric")
    assertTrue(numericTelemetryJson.contains("\"exitCode\":0"), "exit codes should remain numeric")
    assertTrue(numericTelemetryJson.contains("\"hasError\":false"), "false booleans should remain boolean")
    assertTrue(numericTelemetryJson.contains("\"isAwakeTargetMode\":true"), "true booleans should remain boolean")

    /*
     CDXC:PromptEditor 2026-06-19-16:45:
     Ctrl+G speed repro logs need stage-level timings across CLI, native bridge,
     native child-window, React, and Monaco. Keep request ids, booleans, counts,
     and durations visible while redacting prompt text, file/status paths, URLs,
     commands, and credentials before the support-bundle log is written.
     */
    let promptEditorTimingPayload = NativeLogPrivacy.sanitizePayload([
      "commandText": "codex --ask private request",
      "durationMs": 17,
      "event": "modalHost.react.monaco.createdAndFocused",
      "filePath": "/Users/person/dev/private-customer/prompt.md",
      "focusDurationMs": 0,
      "hasExistingEditor": true,
      "initialText": "private prompt text",
      "openToEditorReadyMs": 24,
      "requestId": "floating-monaco-editor-fixture",
      "statusFile": "/var/folders/private/status",
      "textLength": 128,
      "token": "secret-token",
      "url": "https://example.test/private?token=secret-token",
    ])
    let promptEditorTimingJson = serializePrivacyTestPayload(promptEditorTimingPayload)

    assertTrue(promptEditorTimingJson.contains("modalHost.react.monaco.createdAndFocused"), "prompt timing event should remain visible")
    assertTrue(promptEditorTimingJson.contains("floating-monaco-editor-fixture"), "prompt timing request id should remain visible")
    assertTrue(promptEditorTimingJson.contains("\"durationMs\":17"), "prompt timing duration should remain numeric")
    assertTrue(promptEditorTimingJson.contains("\"focusDurationMs\":0"), "prompt timing zero durations should remain numeric")
    assertTrue(promptEditorTimingJson.contains("\"openToEditorReadyMs\":24"), "prompt timing open-to-ready duration should remain numeric")
    assertTrue(promptEditorTimingJson.contains("\"textLength\":128"), "prompt timing text length should remain numeric")
    assertTrue(promptEditorTimingJson.contains("\"hasExistingEditor\":true"), "prompt timing boolean state should remain boolean")
    assertTrue(!promptEditorTimingJson.contains("private prompt text"), "prompt timing logs must not include prompt text")
    assertTrue(!promptEditorTimingJson.contains("/Users/person"), "prompt timing logs must not include file paths")
    assertTrue(!promptEditorTimingJson.contains("/var/folders"), "prompt timing logs must not include status paths")
    assertTrue(!promptEditorTimingJson.contains("codex --ask private request"), "prompt timing logs must not include command text")
    assertTrue(!promptEditorTimingJson.contains("secret-token"), "prompt timing logs must not include secrets")
    assertTrue(!promptEditorTimingJson.contains("private?token"), "prompt timing logs must not include full URLs or query strings")

    /*
     CDXC:ProjectBoardDiagnostics 2026-06-21-03:56:
     Kanban title-generation repro logs need prompt-agent ids, command-source
     enums, process exit/output byte counts, and capability booleans, but must
     never persist raw prompt text, command text, paths, URLs, stdout, stderr,
     or secrets from the native bridge.
     */
    let projectBoardTitlePayload = NativeLogPrivacy.sanitizePayload([
      "agentCommand": "codex --dangerously-use-private-flags",
      "agentCommandLength": 37,
      "agentId": "codex",
      "agentKind": "codex",
      "commandSource": "stored",
      "errBytes": 0,
      "event": "projectBoard.nativeTitleGeneration.completed",
      "exitCode": 1,
      "failureClass": "silent",
      "hasCodexExecutable": true,
      "issueId": "ghostex-3xh",
      "outBytes": 0,
      "projectPath": "/Users/person/dev/private-customer",
      "prompt": "private ticket prompt",
      "promptLength": 323,
      "requestId": "request-123",
      "stderr": "private stderr secret-token",
      "stdout": "private stdout",
      "token": "secret-token",
      "url": "https://example.test/private?token=secret-token",
    ])
    let projectBoardTitleJson = serializePrivacyTestPayload(projectBoardTitlePayload)

    assertTrue(projectBoardTitleJson.contains("projectBoard.nativeTitleGeneration.completed"), "project-board title event should remain visible")
    assertTrue(projectBoardTitleJson.contains("\"agentId\":\"codex\""), "project-board title agent id should remain visible")
    assertTrue(projectBoardTitleJson.contains("\"commandSource\":\"stored\""), "project-board title command-source enum should remain visible")
    assertTrue(projectBoardTitleJson.contains("\"agentCommandLength\":37"), "project-board title command length should remain numeric")
    assertTrue(projectBoardTitleJson.contains("\"promptLength\":323"), "project-board title prompt length should remain numeric")
    assertTrue(projectBoardTitleJson.contains("\"outBytes\":0"), "project-board title stdout byte count should remain numeric")
    assertTrue(projectBoardTitleJson.contains("\"errBytes\":0"), "project-board title stderr byte count should remain numeric")
    assertTrue(projectBoardTitleJson.contains("ghostex-3xh"), "project-board title bead id should remain visible")
    assertTrue(!projectBoardTitleJson.contains("codex --dangerously-use-private-flags"), "project-board title logs must not include command text")
    assertTrue(!projectBoardTitleJson.contains("private ticket prompt"), "project-board title logs must not include prompt text")
    assertTrue(!projectBoardTitleJson.contains("private stdout"), "project-board title logs must not include stdout text")
    assertTrue(!projectBoardTitleJson.contains("private stderr"), "project-board title logs must not include stderr text")
    assertTrue(!projectBoardTitleJson.contains("/Users/person"), "project-board title logs must not include paths")
    assertTrue(!projectBoardTitleJson.contains("secret-token"), "project-board title logs must not include secrets")
    assertTrue(!projectBoardTitleJson.contains("private?token"), "project-board title logs must not include full URLs or query strings")

    let hotkeyReproPayload = NativeLogPrivacy.sanitizePayload([
      "actionId": "focusNextSession",
      "commandText": "codex --ask private request",
      "event": "nativeHotkeys.navigationRepro",
      "hotkey": "cmd+shift+]",
      "keyCode": "30",
      "phase": "appKitObserved",
      "projectName": "Private Customer Project",
      "projectPath": "/Users/person/dev/private-customer",
      "secretToken": "secret-token",
      "url": "https://example.test/private?token=secret-token",
    ])
    let hotkeyReproJson = serializePrivacyTestPayload(hotkeyReproPayload)

    assertTrue(hotkeyReproJson.contains("nativeHotkeys.navigationRepro"), "hotkey repro event should remain visible")
    assertTrue(hotkeyReproJson.contains("focusNextSession"), "hotkey repro action id should remain visible")
    assertTrue(hotkeyReproJson.contains("cmd+shift+]"), "hotkey repro shortcut id should remain visible")
    assertTrue(!hotkeyReproJson.contains("Private Customer Project"), "hotkey repro logs must not include project names")
    assertTrue(!hotkeyReproJson.contains("/Users/person"), "hotkey repro logs must not include paths")
    assertTrue(!hotkeyReproJson.contains("codex --ask private request"), "hotkey repro logs must not include command text")
    assertTrue(!hotkeyReproJson.contains("secret-token"), "hotkey repro logs must not include secrets")
    assertTrue(!hotkeyReproJson.contains("private?token"), "hotkey repro logs must not include full URLs or query strings")

    let titlebarHitTestPayload = NativeLogPrivacy.sanitizePayload([
      "commandText": "codex --ask private request",
      "event": "nativeWorkspace.reactTitlebar.hitTest.route",
      "eventNumber": 29136,
      "eventType": "leftMouseDown",
      "filePath": "/Users/person/Pictures/private image.png",
      "hitRegionCount": 8,
      "hitViewFound": true,
      "overlayOpen": false,
      "point": ["x": 900, "y": 979],
      "projectName": "Private Customer Project",
      "route": "webView",
      "secretToken": "secret-token",
      "titlebarHeight": 35,
      "url": "file:///Users/person/Pictures/private%20image.png",
      "webViewFrame": ["height": 1012, "minX": 0, "minY": 0, "width": 1440],
      "wrapperBounds": ["height": 1012, "minX": 0, "minY": 0, "width": 1440],
    ])
    let titlebarHitTestJson = serializePrivacyTestPayload(titlebarHitTestPayload)

    assertTrue(titlebarHitTestJson.contains("nativeWorkspace.reactTitlebar.hitTest.route"), "titlebar hit-test event should remain visible")
    assertTrue(titlebarHitTestJson.contains("webView"), "titlebar hit-test route should remain visible")
    assertTrue(titlebarHitTestJson.contains("webViewFrame"), "titlebar hit-test webview geometry should remain visible")
    assertTrue(titlebarHitTestJson.contains("hitRegionCount"), "titlebar hit-test hit-region count should remain visible")
    assertTrue(!titlebarHitTestJson.contains("Private Customer Project"), "titlebar hit-test logs must not include project names")
    assertTrue(!titlebarHitTestJson.contains("/Users/person"), "titlebar hit-test logs must not include paths")
    assertTrue(!titlebarHitTestJson.contains("private image.png"), "titlebar hit-test logs must not include filenames")
    assertTrue(!titlebarHitTestJson.contains("codex --ask private request"), "titlebar hit-test logs must not include command text")
    assertTrue(!titlebarHitTestJson.contains("secret-token"), "titlebar hit-test logs must not include secrets")

    let paneTabHitTestPayload = NativeLogPrivacy.sanitizePayload([
      "commandText": "codex --ask private request",
      "event": "nativePaneTabs.titleBar.hitTest.tabButton",
      "projectName": "Private Customer Project",
      "resolvedSessionId": "P123:G456",
      "secretToken": "secret-token",
      "tabButtonFrame": ["height": 36, "minX": 0, "minY": 0, "width": 175],
      "tabButtonFrames": [
        [
          "frame": ["height": 36, "minX": 0, "minY": 0, "width": 175],
          "index": 0,
          "isHidden": false,
          "sessionId": "P123:G456",
          "title": "Private Browser Title",
        ],
      ],
      "tabButtonLocalPoint": ["x": 42, "y": 18],
      "tabScrollOffsetX": 120,
      "tabViewportFrame": ["height": 36, "minX": 0, "minY": 0, "width": 400],
      "titleBarBounds": ["height": 36, "minX": 0, "minY": 0, "width": 520],
      "title": "Private Browser Title",
      "url": "https://example.test/private?token=secret-token",
    ])
    let paneTabHitTestJson = serializePrivacyTestPayload(paneTabHitTestPayload)

    assertTrue(paneTabHitTestJson.contains("nativePaneTabs.titleBar.hitTest.tabButton"), "pane-tab hit-test event should remain visible")
    assertTrue(paneTabHitTestJson.contains("P123:G456"), "pane-tab hit-test session id should remain visible")
    assertTrue(paneTabHitTestJson.contains("tabButtonLocalPoint"), "pane-tab hit-test geometry should remain visible")
    assertTrue(!paneTabHitTestJson.contains("Private Browser Title"), "pane-tab hit-test logs must not include tab titles")
    assertTrue(!paneTabHitTestJson.contains("Private Customer Project"), "pane-tab hit-test logs must not include project names")
    assertTrue(!paneTabHitTestJson.contains("codex --ask private request"), "pane-tab hit-test logs must not include command text")
    assertTrue(!paneTabHitTestJson.contains("secret-token"), "pane-tab hit-test logs must not include secrets")
    assertTrue(!paneTabHitTestJson.contains("private?token"), "pane-tab hit-test logs must not include full URLs or query strings")

    let paneTabCloseClickPayload = NativeLogPrivacy.sanitizePayload([
      "commandText": "codex --ask private request",
      "event": "nativePaneTabs.button.inlineMouseDown",
      "inlineActionAtPoint": "close",
      "locallyHoveredInlineAction": "close",
      "projectName": "Private Customer Project",
      "resolvedInlineAction": "close",
      "secretToken": "secret-token",
      "sessionId": "P123:G456",
      "title": "Private Browser Title",
      "url": "https://example.test/private?token=secret-token",
    ])
    let paneTabCloseClickJson = serializePrivacyTestPayload(paneTabCloseClickPayload)

    assertTrue(paneTabCloseClickJson.contains("nativePaneTabs.button.inlineMouseDown"), "pane-tab close click event should remain visible")
    assertTrue(paneTabCloseClickJson.contains("resolvedInlineAction"), "pane-tab close click action metadata should remain visible")
    assertTrue(paneTabCloseClickJson.contains("P123:G456"), "pane-tab close click session id should remain visible")
    assertTrue(!paneTabCloseClickJson.contains("Private Browser Title"), "pane-tab close click logs must not include tab titles")
    assertTrue(!paneTabCloseClickJson.contains("Private Customer Project"), "pane-tab close click logs must not include project names")
    assertTrue(!paneTabCloseClickJson.contains("codex --ask private request"), "pane-tab close click logs must not include command text")
    assertTrue(!paneTabCloseClickJson.contains("secret-token"), "pane-tab close click logs must not include secrets")
    assertTrue(!paneTabCloseClickJson.contains("private?token"), "pane-tab close click logs must not include full URLs or query strings")

    let paneTabOutsideBoundsPayload = NativeLogPrivacy.sanitizePayload([
      "commandText": "codex --ask private request",
      "event": "nativePaneTabs.button.mouseDown.outsideBounds",
      "localPoint": ["x": -295, "y": 20],
      "projectName": "Private Customer Project",
      "secretToken": "secret-token",
      "sessionId": "P123:G456",
      "title": "Private Browser Title",
      "url": "https://example.test/private?token=secret-token",
    ])
    let paneTabOutsideBoundsJson = serializePrivacyTestPayload(paneTabOutsideBoundsPayload)

    assertTrue(paneTabOutsideBoundsJson.contains("nativePaneTabs.button.mouseDown.outsideBounds"), "pane-tab outside-bounds event should remain visible")
    assertTrue(paneTabOutsideBoundsJson.contains("localPoint"), "pane-tab outside-bounds geometry should remain visible")
    assertTrue(paneTabOutsideBoundsJson.contains("P123:G456"), "pane-tab outside-bounds session id should remain visible")
    assertTrue(!paneTabOutsideBoundsJson.contains("Private Browser Title"), "pane-tab outside-bounds logs must not include tab titles")
    assertTrue(!paneTabOutsideBoundsJson.contains("Private Customer Project"), "pane-tab outside-bounds logs must not include project names")
    assertTrue(!paneTabOutsideBoundsJson.contains("codex --ask private request"), "pane-tab outside-bounds logs must not include command text")
    assertTrue(!paneTabOutsideBoundsJson.contains("secret-token"), "pane-tab outside-bounds logs must not include secrets")
    assertTrue(!paneTabOutsideBoundsJson.contains("private?token"), "pane-tab outside-bounds logs must not include full URLs or query strings")

    let paneTabReroutePayload = NativeLogPrivacy.sanitizePayload([
      "commandText": "codex --ask private request",
      "currentTarget": ["kind": "inlineClose", "sessionId": "P123:G456"],
      "event": "nativePaneTabs.titleBar.reroute.mouseDown",
      "phase": "mouseDown",
      "projectName": "Private Customer Project",
      "resolvedTarget": ["kind": "inlineClose", "sessionId": "P123:G456"],
      "secretToken": "secret-token",
      "source": "tabButtonOutsideBounds",
      "sourceLocalPoint": ["x": -295, "y": 20],
      "sourceSessionId": "P123:G999",
      "title": "Private Browser Title",
      "titleBarPoint": ["x": 522, "y": 18],
      "url": "https://example.test/private?token=secret-token",
    ])
    let paneTabRerouteJson = serializePrivacyTestPayload(paneTabReroutePayload)

    assertTrue(paneTabRerouteJson.contains("nativePaneTabs.titleBar.reroute.mouseDown"), "pane-tab reroute event should remain visible")
    assertTrue(paneTabRerouteJson.contains("inlineClose"), "pane-tab reroute target kind should remain visible")
    assertTrue(paneTabRerouteJson.contains("tabButtonOutsideBounds"), "pane-tab reroute source should remain visible")
    assertTrue(paneTabRerouteJson.contains("P123:G456"), "pane-tab reroute resolved session id should remain visible")
    assertTrue(!paneTabRerouteJson.contains("Private Browser Title"), "pane-tab reroute logs must not include tab titles")
    assertTrue(!paneTabRerouteJson.contains("Private Customer Project"), "pane-tab reroute logs must not include project names")
    assertTrue(!paneTabRerouteJson.contains("codex --ask private request"), "pane-tab reroute logs must not include command text")
    assertTrue(!paneTabRerouteJson.contains("secret-token"), "pane-tab reroute logs must not include secrets")
    assertTrue(!paneTabRerouteJson.contains("private?token"), "pane-tab reroute logs must not include full URLs or query strings")

    let paneTabFixedActionPayload = NativeLogPrivacy.sanitizePayload([
      "buttonKind": "newTerminal",
      "commandText": "codex --ask private request",
      "event": "nativePaneTabs.titleBar.hitTest.fixedActionButton",
      "projectName": "Private Customer Project",
      "secretToken": "secret-token",
      "source": "localHover",
      "title": "Private Browser Title",
      "url": "https://example.test/private?token=secret-token",
    ])
    let paneTabFixedActionJson = serializePrivacyTestPayload(paneTabFixedActionPayload)

    assertTrue(paneTabFixedActionJson.contains("nativePaneTabs.titleBar.hitTest.fixedActionButton"), "pane-tab fixed-button event should remain visible")
    assertTrue(paneTabFixedActionJson.contains("newTerminal"), "pane-tab fixed-button kind should remain visible")
    assertTrue(paneTabFixedActionJson.contains("localHover"), "pane-tab fixed-button source should remain visible")
    assertTrue(!paneTabFixedActionJson.contains("Private Browser Title"), "pane-tab fixed-button logs must not include tab titles")
    assertTrue(!paneTabFixedActionJson.contains("Private Customer Project"), "pane-tab fixed-button logs must not include project names")
    assertTrue(!paneTabFixedActionJson.contains("codex --ask private request"), "pane-tab fixed-button logs must not include command text")
    assertTrue(!paneTabFixedActionJson.contains("secret-token"), "pane-tab fixed-button logs must not include secrets")
    assertTrue(!paneTabFixedActionJson.contains("private?token"), "pane-tab fixed-button logs must not include full URLs or query strings")

    let paneTabRootPrepassPayload = NativeLogPrivacy.sanitizePayload([
      "commandText": "codex --ask private request",
      "event": "nativePaneTabs.root.hitTest.titleBarPrepass",
      "hitView": "TerminalTitleBarActionButton",
      "projectName": "Private Customer Project",
      "rootPoint": ["x": 1473, "y": 983],
      "secretToken": "secret-token",
      "title": "Private Browser Title",
      "url": "https://example.test/private?token=secret-token",
      "workspaceFrame": ["height": 998, "minX": 235, "minY": 0, "width": 1493],
      "workspacePoint": ["x": 1238, "y": 983],
    ])
    let paneTabRootPrepassJson = serializePrivacyTestPayload(paneTabRootPrepassPayload)

    assertTrue(paneTabRootPrepassJson.contains("nativePaneTabs.root.hitTest.titleBarPrepass"), "pane-tab root prepass event should remain visible")
    assertTrue(paneTabRootPrepassJson.contains("TerminalTitleBarActionButton"), "pane-tab root prepass hit-view type should remain visible")
    assertTrue(paneTabRootPrepassJson.contains("workspacePoint"), "pane-tab root prepass geometry should remain visible")
    assertTrue(!paneTabRootPrepassJson.contains("Private Browser Title"), "pane-tab root prepass logs must not include tab titles")
    assertTrue(!paneTabRootPrepassJson.contains("Private Customer Project"), "pane-tab root prepass logs must not include project names")
    assertTrue(!paneTabRootPrepassJson.contains("codex --ask private request"), "pane-tab root prepass logs must not include command text")
    assertTrue(!paneTabRootPrepassJson.contains("secret-token"), "pane-tab root prepass logs must not include secrets")
    assertTrue(!paneTabRootPrepassJson.contains("private?token"), "pane-tab root prepass logs must not include full URLs or query strings")

    let paneTabWindowPrepassPayload = NativeLogPrivacy.sanitizePayload([
      "commandText": "codex --ask private request",
      "event": "nativePaneTabs.root.windowMouseEvent.titleBarPrepass",
      "eventType": "leftMouseDown",
      "projectName": "Private Customer Project",
      "rootPoint": ["x": 1473, "y": 983],
      "secretToken": "secret-token",
      "source": "windowPaneTitleBarPrepass",
      "title": "Private Browser Title",
      "url": "https://example.test/private?token=secret-token",
      "workspaceFrame": ["height": 998, "minX": 235, "minY": 0, "width": 1493],
      "workspacePoint": ["x": 1238, "y": 983],
    ])
    let paneTabWindowPrepassJson = serializePrivacyTestPayload(paneTabWindowPrepassPayload)

    assertTrue(paneTabWindowPrepassJson.contains("nativePaneTabs.root.windowMouseEvent.titleBarPrepass"), "pane-tab window prepass event should remain visible")
    assertTrue(paneTabWindowPrepassJson.contains("leftMouseDown"), "pane-tab window prepass event type should remain visible")
    assertTrue(paneTabWindowPrepassJson.contains("windowPaneTitleBarPrepass"), "pane-tab window prepass source should remain visible")
    assertTrue(paneTabWindowPrepassJson.contains("workspacePoint"), "pane-tab window prepass geometry should remain visible")
    assertTrue(!paneTabWindowPrepassJson.contains("Private Browser Title"), "pane-tab window prepass logs must not include tab titles")
    assertTrue(!paneTabWindowPrepassJson.contains("Private Customer Project"), "pane-tab window prepass logs must not include project names")
    assertTrue(!paneTabWindowPrepassJson.contains("codex --ask private request"), "pane-tab window prepass logs must not include command text")
    assertTrue(!paneTabWindowPrepassJson.contains("secret-token"), "pane-tab window prepass logs must not include secrets")
    assertTrue(!paneTabWindowPrepassJson.contains("private?token"), "pane-tab window prepass logs must not include full URLs or query strings")

    let sidebarResizeCursorPayload = NativeLogPrivacy.sanitizePayload([
      "alphaValue": 1,
      "bounds": ["height": 998, "maxX": 6, "maxY": 998, "minX": 0, "minY": 0, "width": 6],
      "commandText": "codex --ask private request",
      "currentLocalPoint": ["x": 8, "y": 420],
      "currentWindowPoint": ["x": 242, "y": 420],
      "cursorAction": "setArrow",
      "event": "nativeSidebarResize.handle.cursorRefresh",
      "eventLocalPoint": ["x": 8, "y": 420],
      "eventType": "mouseExited",
      "eventWindowPoint": ["x": 242, "y": 420],
      "frame": ["height": 998, "maxX": 238, "maxY": 998, "minX": 232, "minY": 0, "width": 6],
      "hasSuperview": true,
      "hasWindow": true,
      "isHidden": false,
      "isResizeDragging": false,
      "pointerInside": false,
      "projectName": "Private Customer Project",
      "projectPath": "/Users/person/dev/private-customer",
      "reason": "mouseExited",
      "secretToken": "secret-token",
      "url": "https://example.test/private?token=secret-token",
      "windowNumber": 12,
    ])
    let sidebarResizeCursorJson = serializePrivacyTestPayload(sidebarResizeCursorPayload)

    assertTrue(sidebarResizeCursorJson.contains("nativeSidebarResize.handle.cursorRefresh"), "sidebar resize cursor event should remain visible")
    assertTrue(sidebarResizeCursorJson.contains("setArrow"), "sidebar resize cursor action should remain visible")
    assertTrue(sidebarResizeCursorJson.contains("mouseExited"), "sidebar resize cursor reason and event type should remain visible")
    assertTrue(sidebarResizeCursorJson.contains("currentWindowPoint"), "sidebar resize cursor pointer geometry should remain visible")
    assertTrue(sidebarResizeCursorJson.contains("pointerInside"), "sidebar resize cursor containment should remain visible")
    assertTrue(!sidebarResizeCursorJson.contains("Private Customer Project"), "sidebar resize cursor logs must not include project names")
    assertTrue(!sidebarResizeCursorJson.contains("/Users/person"), "sidebar resize cursor logs must not include paths")
    assertTrue(!sidebarResizeCursorJson.contains("codex --ask private request"), "sidebar resize cursor logs must not include command text")
    assertTrue(!sidebarResizeCursorJson.contains("secret-token"), "sidebar resize cursor logs must not include secrets")
    assertTrue(!sidebarResizeCursorJson.contains("private?token"), "sidebar resize cursor logs must not include full URLs or query strings")

    let sourceDragPayload = NativeLogPrivacy.sanitizePayload([
      "activeElement": [
        "classTokens": ["monaco-workbench", "part-editor"],
        "draggable": false,
        "matches": ["workbench", "partEditor"],
        "role": "textbox",
        "tag": "div",
      ],
      "commandText": "codex --ask private request",
      "event": "nativeWorkspace.projectEditor.cef.sourceDragDiagnostic",
      "nativeDragId": 42,
      "overlaySnapshot": [
        "activeAppModalKind": "settings",
        "modalHostFrame": ["height": 900, "minX": 0, "minY": 0, "width": 1440],
        "titlebarDropdownPanel": [
          "currentKind": "resources",
          "panelFrame": ["height": 650, "minX": 600, "minY": 300, "width": 656],
          "present": true,
        ],
      ],
      "projectName": "Private Customer Project",
      "projectPath": "/Users/person/dev/private-customer",
      "secretToken": "secret-token",
      "target": [
        "classTokens": ["tab", "tab-border-top"],
        "draggable": true,
        "filePath": "/Users/person/dev/private-customer/private-file-name.ts",
        "matches": ["tabsContainer", "tab", "tabDraggable"],
        "role": "tab",
        "tag": "div",
      ],
      "type": "drag-sequence-summary",
      "url": "https://example.test/private?token=secret-token",
    ])
    let sourceDragJson = serializePrivacyTestPayload(sourceDragPayload)

    assertTrue(sourceDragJson.contains("nativeWorkspace.projectEditor.cef.sourceDragDiagnostic"), "source drag event should remain visible")
    assertTrue(sourceDragJson.contains("drag-sequence-summary"), "source drag diagnostic type should remain visible")
    assertTrue(sourceDragJson.contains("tabsContainer"), "source drag structural matches should remain visible")
    assertTrue(sourceDragJson.contains("nativeDragId"), "native drag id should remain visible")
    assertTrue(!sourceDragJson.contains("Private Customer Project"), "source drag logs must not include project names")
    assertTrue(!sourceDragJson.contains("/Users/person"), "source drag logs must not include paths")
    assertTrue(!sourceDragJson.contains("private-file-name"), "source drag logs must not include file names")
    assertTrue(!sourceDragJson.contains("codex --ask private request"), "source drag logs must not include command text")
    assertTrue(!sourceDragJson.contains("secret-token"), "source drag logs must not include secrets")

    /*
     CDXC:DiagnosticsPrivacy 2026-06-16-12:22:
     Free-form native log lines can include localized error strings from system
     APIs. Sanitize and flatten those messages before writing so one caller
     cannot inject multiline support-log entries containing paths or secrets.
     */
    let sanitizedLine = NativeLogPrivacy.sanitizeLogLine(
      "first line\nsecond line /Users/person/dev/private-customer token=secret-token")

    assertTrue(sanitizedLine.contains("first line\\nsecond line"), "line sanitizer should preserve newline position as escaped text")
    assertTrue(!sanitizedLine.contains("\n"), "line sanitizer must not leave raw newlines")
    assertTrue(!sanitizedLine.contains("/Users/person"), "line sanitizer must not include paths")
    assertTrue(!sanitizedLine.contains("secret-token"), "line sanitizer must not include secrets")

    assertTrue(
      isNativePersistentLogImportantDiagnostic("nativeSidebar.gxserver.sessionTitleEventFailed"),
      "failed native diagnostic events should persist in normal mode")
    assertTrue(
      isNativePersistentLogImportantDiagnostic("nativeWorkspace.runtime.timeout"),
      "timeout native diagnostic events should persist in normal mode")
    assertTrue(
      isNativePersistentLogImportantDiagnostic("nativeSidebar.gxserver.status.invalid"),
      "invalid native diagnostic events should persist in normal mode")
    assertTrue(
      !isNativePersistentLogImportantDiagnostic("nativeSidebar.gxserver.presentationDelta.applied"),
      "routine native diagnostic events should require debugging mode")
    assertTrue(
      !isNativePersistentLogImportantDiagnostic("nativeWorkspace.focusTerminal.missingSession"),
      "missing-session focus probes should require debugging mode")
    assertTrue(
      !isNativePersistentLogImportantDiagnostic("nativeHotkeys.navigationRepro.domObserved"),
      "hotkey repro breadcrumbs should require debugging mode")
    assertTrue(
      !isNativePersistentLogImportantDiagnostic("nativePaneLayoutTrace.layoutSync.focusOwnerMismatch"),
      "pane-layout trace breadcrumbs should require debugging mode")
    assertTrue(
      !isNativePersistentLogImportantDiagnostic("nativePaneLayoutStartup.restoredWorkspaceSnapshot"),
      "startup pane-layout breadcrumbs should require debugging mode")
    assertTrue(
      !isNativePersistentLogImportantDiagnostic("nativeSidebar.actionCrashTrace.titlebarClick"),
      "action crash trace breadcrumbs should require debugging mode")
    assertTrue(
      isNativePersistentLogImportantDiagnostic("nativeSidebar.actionCrashTrace.titlebarCommandError"),
      "actual action crash trace error phases should persist in normal mode")
  }
}
