import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const terminalWorkspaceSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift", import.meta.url),
  "utf8",
);
const appDelegateSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift", import.meta.url),
  "utf8",
);
const nativePaneReorderReproLogSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/NativePaneReorderReproLog.swift", import.meta.url),
  "utf8",
);

function sourceSection(source: string, startNeedle: string, endNeedle: string, fromIndex = 0): string {
  const startIndex = source.indexOf(startNeedle, fromIndex);
  expect(startIndex).toBeGreaterThan(-1);
  const endIndex = source.indexOf(endNeedle, startIndex + startNeedle.length);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("native pane tab titlebar hit testing", () => {
  test("keeps root hit testing on normal AppKit traversal", () => {
    /**
     * CDXC:RootHitBoundaries 2026-06-13-09:52:
     * The root view must not route sidebar, divider, resize-rail, or pane
     * titlebar hits by prepass. Those regions are laid out as normal
     * non-overlapping AppKit child views.
     */
    const rootSource = sourceSection(
      appDelegateSource,
      "final class ghostexRootView",
      "extension ghostexRootView: WKNavigationDelegate",
    );

    expect(rootSource).not.toContain("override func hitTest(_ point: NSPoint) -> NSView?");
    expect(rootSource).not.toContain("workspacePaneTitleBarHitView");
    expect(appDelegateSource).not.toContain("workspaceResizeHandleHitView(at point: NSPoint)");
    expect(appDelegateSource).not.toContain("nativePaneTabs.root.hitTest.titleBarPrepass");
    expect(rootSource).toContain("sidebarView.frame = frames.sidebar");
    expect(rootSource).toContain("divider.frame = frames.divider");
    expect(rootSource).toContain("workspaceView.frame = frames.workspace");
  });

  test("rotates pane-tab support logs while keeping Debugging Mode diagnostics", () => {
    /*
     * CDXC:GxserverLogs 2026-06-15-20:39:
     * Pane-tab diagnostics can stay available under Debugging Mode, but the
     * persistent file must rotate so support bundles remain bounded.
     *
     * CDXC:PaneTabs 2026-06-16-12:22:
     * Cursor, mouse-drag, and layout diagnostics should be sampled in the
     * native-pane-tabs writer so Debugging Mode preserves repro signals without
     * writing one line per resize or titlebar tick.
     */
    expect(nativePaneReorderReproLogSource).toContain("native-pane-tabs-debug.log");
    expect(nativePaneReorderReproLogSource).toContain("NativePaneReproLogRotation.rotateIfNeeded");
    expect(nativePaneReorderReproLogSource).toContain("25 * 1024 * 1024");
    expect(nativePaneReorderReproLogSource).toContain("maxRotatedLogFiles = 3");
    expect(nativePaneReorderReproLogSource).toContain("private static let highVolumeSampleInterval: TimeInterval = 5");
    expect(nativePaneReorderReproLogSource).toContain("shouldWriteSampledLogEvent(");
    expect(nativePaneReorderReproLogSource).toContain('"nativePaneResize.handle.mouseDragged"');
    expect(nativePaneReorderReproLogSource).toContain('"nativePaneTabs.geometry.layout"');
    expect(nativePaneReorderReproLogSource).toContain('"nativeSidebarResize.handle.resetCursorRects"');
  });

  test("keeps sidebar and divider as non-overlapping native regions", () => {
    /*
     * CDXC:NativeLayout 2026-06-13-09:02:
     * Sidebar controls should be clickable through normal AppKit traversal, not
     * a root hit-test prepass. Keep the sidebar WKWebView and native divider in
     * adjacent frames so the divider owns only its visible grab region and the
     * webview owns only sidebar content.
     */
    const rootSource = sourceSection(
      appDelegateSource,
      "final class ghostexRootView",
      "extension ghostexRootView: WKNavigationDelegate",
    );
    const sidebarWebViewSource = sourceSection(
      appDelegateSource,
      "final class SidebarWebView: WKWebView",
      "final class ghostexRootView",
    );
    const layoutSource = sourceSection(
      appDelegateSource,
      "override func layout()",
      "private func dividerSeparatorFrame",
      appDelegateSource.indexOf("final class ghostexRootView"),
    );

    expect(rootSource).not.toContain("if let sidebarHitView = sidebarContentHitView(at: point)");
    expect(appDelegateSource).not.toContain("private func sidebarContentHitView(at point: NSPoint)");
    expect(layoutSource).toContain("sidebarView.frame = frames.sidebar");
    expect(layoutSource).toContain("divider.frame = frames.divider");
    expect(layoutSource).not.toContain("visualSidebarFrame");
    expect(layoutSource).not.toContain("resizeLayoutRecordExclusion");
    expect(appDelegateSource).not.toContain("sidebarResizeEdgeExtension");
    expect(appDelegateSource).toContain("private static let dividerWidth: CGFloat = 5");
    expect(appDelegateSource).not.toContain("private static let dividerWidth: CGFloat = 6");
    expect(appDelegateSource).toContain(
      "reserve one real five-point AppKit rail between the sidebar and workspace",
    );
    expect(appDelegateSource).toContain(
      "without monitors, overlays, or root hit-test expansion",
    );
    expect(appDelegateSource).not.toContain("sidebarWorkareaBorderX = dividerFrame.minX");
    expect(appDelegateSource).toContain(
      "let sidebarWorkareaBorderX = max(dividerFrame.maxX - separatorWidth, dividerFrame.minX)",
    );
    expect(appDelegateSource).toContain("private static let sidebarDividerLineColor = NSColor(");
    expect(appDelegateSource).toContain("srgbRed: 33.0 / 255.0");
    expect(appDelegateSource).toContain("divider.separatorColor = Self.sidebarDividerLineColor");
    expect(appDelegateSource).toContain(
      "The left-sidebar 1px line belongs on the workspace side of the five-point drag rail",
    );
    expect(appDelegateSource).not.toContain("final class SidebarModalBackdropView");
    expect(appDelegateSource).not.toContain("NonInteractiveChromeLineView");
    expect(appDelegateSource).toContain("private let workareaTitlebarBorderLayer = CALayer()");
    expect(appDelegateSource).not.toContain("private func visualSidebarFrame");
    expect(terminalWorkspaceSource).not.toContain("sidebarResizeEdgeExtensionWidth");
    expect(sidebarWebViewSource).not.toContain("override func hitTest(_ point: NSPoint) -> NSView?");
    expect(sidebarWebViewSource).not.toContain("containsInteractiveHitPoint");
    expect(sidebarWebViewSource).not.toContain("resizeLayoutRecordExclusion");
  });

  test("does not route titlebar controls from the window boundary", () => {
    /**
     * CDXC:NativePaneTabClicks 2026-06-13-09:52:
     * Pane titlebars and the fixed React/macOS titlebar are normal child
     * regions. Window-boundary events must not pre-route either surface.
     */
    expect(appDelegateSource).not.toContain("func routeTitlebarMouseEventFromWindow(_ event: NSEvent) -> Bool");
    expect(appDelegateSource).not.toContain("var onTitlebarMouseEvent: ((NSEvent) -> Bool)?");
    expect(appDelegateSource).not.toContain("titlebarChromeView.routeWindowMouseEvent(event)");
    expect(appDelegateSource).not.toContain("func routeWindowMouseEvent(_ event: NSEvent) -> Bool");
    expect(appDelegateSource).not.toContain("dispatchWindowMouseEventToWebView");
    expect(appDelegateSource).not.toContain("windowSendEvent.titlebarRerouted");
    expect(appDelegateSource).not.toContain("routeWorkspacePaneTitleBarMouseEventFromWindow");
    expect(appDelegateSource).not.toContain("private func routeWorkspacePaneTitleBarMouseEventFromWindow");
    expect(appDelegateSource).not.toContain("isWorkspacePaneTitleBarWindowMouseEvent");
    expect(appDelegateSource).not.toContain("windowPaneTitleBarPrepass");
  });

  test("keeps workspace hit testing on normal AppKit traversal", () => {
    /**
     * CDXC:NativeWorkspaceHitTesting 2026-06-13-09:52:
     * Workspace pane titlebars, pane content, and resize rails are strict
     * sibling/child regions, so TerminalWorkspaceView must not override hitTest
     * or expose pane-titlebar hit resolver helpers.
     */
    const workspaceSource = sourceSection(
      terminalWorkspaceSource,
      "@MainActor\nfinal class TerminalWorkspaceView: NSView",
      "final class ProjectEditorInitialLoadingOverlayView",
    );

    expect(workspaceSource).not.toContain("override func hitTest(_ point: NSPoint) -> NSView?");
    expect(terminalWorkspaceSource).not.toContain("func paneTitleBarHitView(at point: NSPoint)");
    expect(terminalWorkspaceSource).not.toContain("private func paneTitleBarEventTarget(at point: NSPoint)");
    expect(terminalWorkspaceSource).not.toContain("directPaneTitleBarEventTarget");
    expect(terminalWorkspaceSource).not.toContain("func resizeHandleHitView(at point: NSPoint)");
    expect(terminalWorkspaceSource).not.toContain("if let resizeHandleHitView = resizeHandleHitView(at: point)");
    expect(workspaceSource).toContain("Pane titlebars, pane content, and resize rails are strict sibling regions");
    expect(workspaceSource).toContain("PaneContentLayoutRegion");
    expect(workspaceSource).toContain("paneContentLayoutRegions");
    expect(workspaceSource).not.toContain("PaneContentHitRegion");
    expect(workspaceSource).not.toContain("paneContentHitRegions");
  });

  test("mounts directly managed project titlebars as normal AppKit views", () => {
    /**
     * CDXC:NativePaneTabClicks 2026-06-13-09:52:
     * GitHub/project tab strips that are mounted directly under the workspace
     * should rely on their real AppKit view frames, not a workspace prepass.
     */
    const projectEditorIndex = terminalWorkspaceSource.indexOf("func createProjectEditorPane");
    const projectEditorSource = terminalWorkspaceSource.slice(
      projectEditorIndex,
      terminalWorkspaceSource.indexOf("private func makeProjectEditorBrowserTab", projectEditorIndex),
    );

    expect(projectEditorIndex).toBeGreaterThan(-1);
    expect(projectEditorSource).toContain("view.setDebugContext(ownerSessionId: command.projectId, paneKind: \"projectEditorGit\")");
    expect(projectEditorSource).toContain("addSubview(titleBarView)");
    expect(terminalWorkspaceSource).not.toContain("PaneTitleBarEventTarget");
    expect(terminalWorkspaceSource).not.toContain("private func directPaneTitleBarEventTarget(");
  });

  test("does not keep window-routed pane titlebar mouse stream state", () => {
    /**
     * CDXC:NativePaneTabClicks 2026-06-13-11:35:
     * Pane titlebar mouse streams should stay on the concrete AppKit tab/action
     * controls that receive mouseDown. There should be no workspace-level or
     * titlebar-level reroute state.
     */
    const titleBarIndex = terminalWorkspaceSource.indexOf("private final class TerminalSessionTitleBarView");
    const titleBarSource = terminalWorkspaceSource.slice(
      titleBarIndex,
      terminalWorkspaceSource.indexOf("final class ProjectEditorInitialLoadingOverlayView", titleBarIndex),
    );

    expect(terminalWorkspaceSource).not.toContain("private weak var windowRoutedPaneTitleBar");
    expect(terminalWorkspaceSource).not.toContain("func routePaneTitleBarMouseEvent(");
    expect(titleBarSource).not.toContain("fileprivate func routeWindowTitleBarMouseEvent(");
    expect(titleBarSource).not.toContain("handleReroutedTitleBarMouseDown(");
    expect(titleBarSource).not.toContain("handleReroutedTitleBarMouseDragged(");
    expect(titleBarSource).not.toContain("handleReroutedTitleBarMouseUp(");
    expect(titleBarSource).not.toContain("ReroutedTitleBarTarget");
    expect(titleBarSource).not.toContain("pendingReroutedTitleBarTarget");
    expect(titleBarSource).not.toContain("override func mouseDragged(with event: NSEvent)");
    expect(titleBarSource).not.toContain("override func mouseUp(with event: NSEvent)");
  });

  test("keeps pane titlebar and content as normal sibling regions", () => {
    /**
     * CDXC:NativePaneTabClicks 2026-06-13-09:52:
     * Normal workspace panes should not need a container-level hitTest override.
     * Titlebar and content frames are strict siblings, while visual borders are
     * layers, so AppKit can dispatch normal child hits without full-frame overlay
     * views intercepting clicks.
     *
     * CDXC:TerminalPanePadding 2026-06-25-21:27:
     * Terminal padding must remain normal layout: paint the existing pane
     * container background and inset the Ghostty scroll view frame instead of
     * adding transparent overlays or hit-test routing.
     */
    const containerIndex = terminalWorkspaceSource.indexOf("private final class TerminalPaneLeafContainerView");
    const containerSource = sourceSection(
      terminalWorkspaceSource,
      "private final class TerminalPaneLeafContainerView",
      "private final class SleepingPanePlaceholderContentView",
    );
    const mountTerminalSource = sourceSection(
      terminalWorkspaceSource,
      "private func mountTerminalPaneContainer(for session: TerminalSession)",
      "private func mountWebPaneContainer(for session: WebPaneSession)",
    );
    const setFrameSource = sourceSection(
      terminalWorkspaceSource,
      "private func setFrame(",
      "private func commandPanelTitleBarActions()",
    );
    const setWebFrameSource = sourceSection(
      terminalWorkspaceSource,
      "private func setWebPaneFrame(",
      "private func scheduleDeferredWebPaneLayout",
    );

    expect(containerIndex).toBeGreaterThan(-1);
    expect(containerSource).not.toContain("override func hitTest(_ point: NSPoint) -> NSView?");
    expect(containerSource).toContain("func resolvedTitleBarView() -> TerminalSessionTitleBarView?");
    expect(containerSource).toContain("func setBackgroundColor(_ color: NSColor)");
    expect(terminalWorkspaceSource).not.toContain("titleBarHitTestView");
    expect(terminalWorkspaceSource).toContain("private func terminalPaneContentRect(in availableTerminalRect: CGRect) -> CGRect");
    expect(terminalWorkspaceSource).toContain("terminalPaneHorizontalPaddingPx");
    expect(terminalWorkspaceSource).toContain("terminalPaneVerticalPaddingPx");
    expect(mountTerminalSource.indexOf("mount(session.titleBarView, in: session.containerView)")).toBeLessThan(
      mountTerminalSource.indexOf("mount(session.scrollView, in: session.containerView)"),
    );
    expect(mountTerminalSource).toContain("installPaneBorderLayer(session.borderView, in: session.containerView)");
    expect(setFrameSource).toContain("session.titleBarView.frame = titleBarRect");
    expect(setFrameSource).toContain("session.containerView.setBackgroundColor(terminalPaneBackgroundColor())");
    expect(setFrameSource).toContain("let terminalRect = terminalPaneContentRect(in: availableTerminalRect)");
    expect(setFrameSource).toContain("session.scrollView.frame = terminalRect");
    expect(setWebFrameSource).toContain("session.titleBarView.frame = titleBarRect");
    expect(setWebFrameSource).toContain("session.hostView.frame = contentRect");
  });

  test("uses normal titlebar child controls instead of a titlebar hit-test router", () => {
    /**
     * CDXC:NativePaneTabClicks 2026-06-13-11:35:
     * Pane tabs and tab-bar actions should be concrete AppKit child controls,
     * not controls returned manually by TerminalSessionTitleBarView.hitTest.
     * The tab strip remains an ordinary clipped view containing real tab
     * buttons, so AppKit can dispatch clicks through the child hierarchy.
     */
    const titleBarIndex = terminalWorkspaceSource.indexOf("private final class TerminalSessionTitleBarView");
    const titleBarSource = terminalWorkspaceSource.slice(
      titleBarIndex,
      terminalWorkspaceSource.indexOf("private func backgroundColor", titleBarIndex),
    );
    const layoutTabButtonsSource = sourceSection(
      terminalWorkspaceSource,
      "private func layoutTabButtons(",
      "private func scrollActiveTabIntoView",
    );

    expect(titleBarIndex).toBeGreaterThan(-1);
    expect(titleBarSource).not.toContain("override func hitTest(_ point: NSPoint) -> NSView?");
    expect(titleBarSource).toContain("private let tabClipView = NSClipView(frame: .zero)");
    expect(titleBarSource).toContain("tabClipView.documentView = tabContentView");
    expect(titleBarSource).toContain("addSubview(tabClipView)");
    expect(titleBarSource).toContain("addSubview(tabAddButton)");
    expect(titleBarSource).toContain("addSubview(tabBrowserButton)");
    expect(titleBarSource).toContain("addSubview(stickyActiveTabButton)");
    expect(titleBarSource).toContain("onMouseDown?(event)");
    expect(terminalWorkspaceSource).toContain("tabContentView.addSubview(button)");
    expect(layoutTabButtonsSource).toContain("tabClipView.frame = tabViewportFrame");
    expect(layoutTabButtonsSource).toContain("tabContentView.frame = CGRect(");
    expect(layoutTabButtonsSource).toContain("x: -tabScrollOffsetX");
    expect(layoutTabButtonsSource).toContain("button.frame = CGRect(x: nextX, y: 0, width: tabWidth, height: height)");
    expect(terminalWorkspaceSource).not.toContain("nativePaneTabs.titleBar.hitTest.tabButton");
    expect(terminalWorkspaceSource).not.toContain("nativePaneTabs.titleBar.hitTest.actionButton");
    expect(terminalWorkspaceSource).not.toContain("nativePaneTabs.titleBar.hitTest.fixedActionButton");
    expect(terminalWorkspaceSource).not.toContain("private func reroutedTitleBarTarget");
  });

  test("reveals the selected native pane tab after keyboard-driven focus", () => {
    /*
     * CDXC:PaneTabs 2026-06-13-21:09:
     * Cmd+Tab and Cmd+Shift+Tab use the pane-tab selection path, but the
     * selected tab can already be the titlebar's active id by the time native
     * focus runs. Explicit focus and pane-owner swaps must request a native
     * reveal so an offscreen active tab scrolls into view like clicked tabs do.
     */
    const revealActiveTabSource = sourceSection(
      terminalWorkspaceSource,
      "func revealActiveTabIfNeeded(reason _: String)",
      "private static func tabScrollGroupSignature",
    );
    const revealFocusPolicySource = sourceSection(
      terminalWorkspaceSource,
      "private func shouldRevealActivePaneTabOnFocus(reason: String)",
      "func focusWebPane(sessionId rawSessionId: String",
    );
    const focusTerminalSource = sourceSection(
      terminalWorkspaceSource,
      "func focusTerminal(sessionId rawSessionId: String",
      "private func refreshZmxPersistenceTerminalIfFocusOrSurfaceChanged",
    );
    const focusWebPaneSource = sourceSection(
      terminalWorkspaceSource,
      "func focusWebPane(sessionId rawSessionId: String",
      "func createProjectEditorPane",
    );
    const paneOwnerSelectionSource = sourceSection(
      terminalWorkspaceSource,
      "private func applyPaneOwnerSelection(",
      "private func isPaneSessionVisible",
    );

    expect(revealActiveTabSource).toContain("shouldScrollActiveTabIntoViewAfterLayout = true");
    expect(revealActiveTabSource).toContain("layoutSubtreeIfNeeded()");
    expect(revealFocusPolicySource).toContain('reason == "setActiveTerminalSet"');
    expect(revealFocusPolicySource).toContain('reason == "sidebarFocusCommand"');
    expect(revealFocusPolicySource).not.toContain("nativeTerminalContentMouseDown");
    expect(focusTerminalSource).toContain(
      'revealActivePaneTab(for: sessionId, reason: "focusTerminal.\\(reason)")',
    );
    expect(focusWebPaneSource).toContain(
      'revealActivePaneTab(for: sessionId, reason: "focusWebPane.\\(reason)")',
    );
    expect(paneOwnerSelectionSource).toContain(
      'revealActivePaneTab(for: selectedSessionId, reason: "paneOwnerSelection.\\(reason)")',
    );
  });

  test("keeps passive pane titlebar chrome out of the AppKit view tree", () => {
    /*
     * CDXC:NativePaneTabClicks 2026-06-13-13:21:
     * The activity indicator, collapsed trailing fill, bottom border, and action
     * separators are visual titlebar chrome. They must stay as CALayers so only
     * real AppKit controls participate in click dispatch.
     */
    const titleBarIndex = terminalWorkspaceSource.indexOf("private final class TerminalSessionTitleBarView");
    const titleBarSource = terminalWorkspaceSource.slice(
      titleBarIndex,
      terminalWorkspaceSource.indexOf("private func isEmptyTitleBarDoubleClickPoint", titleBarIndex),
    );

    expect(titleBarIndex).toBeGreaterThan(-1);
    expect(titleBarSource).toContain("private let activityIndicatorLayer = CALayer()");
    expect(titleBarSource).toContain("private let commandCollapsedTrailingBackgroundLayer = CALayer()");
    expect(titleBarSource).toContain("private let bottomBorderLayer = CALayer()");
    expect(titleBarSource).toContain("private var actionSeparatorLayers: [CALayer] = []");
    expect(titleBarSource).toContain("private func configurePassiveTitlebarLayer(_ passiveLayer: CALayer)");
    expect(titleBarSource).toContain("layer?.insertSublayer(commandCollapsedTrailingBackgroundLayer, at: 0)");
    expect(titleBarSource).not.toContain("private let activityIndicatorView = NSView(frame: .zero)");
    expect(titleBarSource).not.toContain("private let commandCollapsedTrailingBackgroundView = NSView(frame: .zero)");
    expect(titleBarSource).not.toContain("private let bottomBorderView = NSView(frame: .zero)");
    expect(titleBarSource).not.toContain("private var actionSeparators: [NSView]");
    expect(titleBarSource).not.toContain("addSubview(commandCollapsedTrailingBackgroundView");
    expect(titleBarSource).not.toContain("addSubview(bottomBorderView");
    expect(titleBarSource).not.toContain("addSubview(separator)");
  });

  test("renders per-pane titlebar activity indicator as a lowered square", () => {
    /*
     * CDXC:ProjectEditorCompanion 2026-06-20-18:22:
     * Companion pane title bars should place the status indicator 3px lower than
     * centered geometry and draw it as a square mark instead of a circular dot.
     */
    const titleBarIndex = terminalWorkspaceSource.indexOf("private final class TerminalSessionTitleBarView");
    const titleBarSource = terminalWorkspaceSource.slice(
      titleBarIndex,
      terminalWorkspaceSource.indexOf("private func isEmptyTitleBarDoubleClickPoint", titleBarIndex),
    );
    const layoutSource = sourceSection(
      terminalWorkspaceSource,
      "override func layout()",
      "private func reserveDoubleClickNewTerminalTarget",
      titleBarIndex,
    );

    expect(titleBarIndex).toBeGreaterThan(-1);
    expect(titleBarSource).toContain("activityIndicatorLayer.cornerRadius = 4");
    expect(layoutSource).toContain(
      "let activityIndicatorVerticalOffset: CGFloat = usesProjectEditorCompanionChrome ? 3 : 0",
    );
    expect(layoutSource).toContain(
      "activityIndicatorLayer.cornerRadius = usesProjectEditorCompanionChrome ? 0 : indicatorSize / 2",
    );
    expect(layoutSource).toContain("y: floor((bounds.height - indicatorSize) / 2) + activityIndicatorVerticalOffset");
    expect(layoutSource).not.toContain("y: floor((bounds.height - indicatorSize) / 2),");
  });

  test("uses explicit scroll-offset tab geometry for local hover and close helpers", () => {
    /**
     * CDXC:NativePaneTabClicks 2026-06-13-11:35:
     * Each native tab button must own its own click. Titlebar helper geometry
     * remains only for local hover, inline Close, and drag metadata, and should
     * resolve concrete buttons from visible frames instead of asking the shifted
     * clipped-strip view to rediscover a subview.
     *
     * CDXC:NativePaneTabClicks 2026-06-12-05:41:
     * The 05:33 repro proved AppKit conversion can still hand mouseDown to a
     * tab whose local point is outside its bounds. Resolve tab ownership from
     * the layout scroll offset and each tab button frame directly.
     */
    const helperIndex = terminalWorkspaceSource.indexOf("private func tabButtonHit(at point: NSPoint)");
    const helperEndIndex = terminalWorkspaceSource.indexOf("func containsTab(_ sessionId: String) -> Bool", helperIndex);
    const helperSource = terminalWorkspaceSource.slice(helperIndex, helperEndIndex);

    expect(helperIndex).toBeGreaterThan(-1);
    expect(helperSource).toContain("return visibleTabButtonHit(at: point)");
    expect(helperSource).toContain("private func tabButtonHitRecords(at point: NSPoint)");
    expect(helperSource).toContain("private func visibleTabButtonFrame(for button: TerminalTitleBarTabButton) -> CGRect");
    expect(helperSource).toContain("private func tabContentPoint(forTitleBarPoint point: NSPoint) -> NSPoint");
    expect(helperSource).toContain("point.x - tabViewportFrame.minX + tabScrollOffsetX");
    expect(helperSource).toContain("contentPoint.x - button.frame.minX");
    expect(helperSource).toContain("tabViewportFrame.minX + button.frame.minX - tabScrollOffsetX");
    expect(helperSource).toContain("frameInTitleBar.intersection(tabViewportFrame)");
    expect(helperSource).toContain("visibleFrame.contains(point)");
    expect(helperSource).toContain("button.bounds.contains(localPoint)");
    expect(helperSource).not.toContain("tabClipView.hitTest");
    expect(helperSource).not.toContain("let localPoint = convert(point, to: button)");
  });

  test("prefers each tab button's local hover owner before clipped-strip fallback", () => {
    /**
     * CDXC:NativePaneTabClicks 2026-06-12-04:45:
     * When a scrolled native tab strip paints/hover-tracks the intended tab but
     * titlebar click picking selects the tab to its right, click ownership must
     * first follow the tab button's own AppKit tracking-area hover state.
     */
    const buttonIndex = terminalWorkspaceSource.indexOf("private final class TerminalTitleBarTabButton");
    const titleBarIndex = terminalWorkspaceSource.indexOf("private final class TerminalSessionTitleBarView");
    const helperIndex = terminalWorkspaceSource.indexOf("private func tabButtonHit(at point: NSPoint)");
    const helperEndIndex = terminalWorkspaceSource.indexOf("func containsTab(_ sessionId: String) -> Bool", helperIndex);
    const buttonSource = terminalWorkspaceSource.slice(buttonIndex, titleBarIndex);
    const helperSource = terminalWorkspaceSource.slice(helperIndex, helperEndIndex);

    expect(buttonIndex).toBeGreaterThan(-1);
    expect(helperIndex).toBeGreaterThan(-1);
    expect(buttonSource).toContain("fileprivate var isPointerLocallyInside = false");
    expect(buttonSource).toContain("isPointerLocallyInside = isInside");
    expect(buttonSource).toContain("isPointerLocallyInside = false");
    expect(helperSource).toContain("if let hoverHit = locallyHoveredTabButtonHit(at: point)");
    expect(helperSource).toContain("return hoverHit");
    expect(helperSource).toContain("private func locallyHoveredTabButtonHit(at point: NSPoint)");
    expect(helperSource.indexOf("if let hoverHit = locallyHoveredTabButtonHit(at: point)")).toBeLessThan(
      helperSource.indexOf("return visibleTabButtonHit(at: point)"),
    );
    expect(helperSource).toContain("$0.button.isPointerLocallyInside");
    expect(helperSource).toContain("guard hoveredHits.count == 1, let hoverHit = hoveredHits.first");
  });

  test("keeps tab close and fixed tab-bar actions as local AppKit controls", () => {
    /**
     * CDXC:NativePaneTabClicks 2026-06-13-11:35:
     * Inline tab Close plus sticky active-tab, New Terminal, New Browser, and
     * overflow controls should stay in their own AppKit button mouse handlers.
     * The titlebar must not rediscover those fixed controls through a reroute
     * helper.
     */
    const actionButtonIndex = terminalWorkspaceSource.indexOf("private final class TerminalTitleBarActionButton");
    const tabButtonIndex = terminalWorkspaceSource.indexOf("private final class TerminalTitleBarTabButton");
    const titleBarIndex = terminalWorkspaceSource.indexOf("private final class TerminalSessionTitleBarView");
    const actionButtonSource = terminalWorkspaceSource.slice(actionButtonIndex, tabButtonIndex);
    const tabButtonSource = terminalWorkspaceSource.slice(tabButtonIndex, titleBarIndex);
    const titleBarSource = terminalWorkspaceSource.slice(titleBarIndex, terminalWorkspaceSource.indexOf("private func isEmptyTitleBarDoubleClickPoint", titleBarIndex));

    expect(actionButtonIndex).toBeGreaterThan(-1);
    expect(tabButtonIndex).toBeGreaterThan(-1);
    expect(titleBarSource).not.toContain("override func hitTest(_ point: NSPoint) -> NSView?");
    expect(titleBarSource).not.toContain("private func locallyHoveredTitleBarActionButton");
    expect(titleBarSource).not.toContain("logFixedTitleBarActionButtonHit(");
    expect(actionButtonSource).toContain("fileprivate var isPointerLocallyInside: Bool");
    expect(tabButtonSource).toContain("fileprivate var locallyHoveredInlineAction: InlineAction?");
    expect(tabButtonSource).toContain("locallyHoveredInlineAction ?? inlineActionAtPoint");
    expect(tabButtonSource).toContain("private var hasValidMouseDown = false");
    expect(tabButtonSource).toContain('NativePaneTabDragReproLog.append(event: "nativePaneTabs.button.mouseDown.outsideBounds"');
    expect(tabButtonSource).toContain("guard bounds.contains(point) else");
    expect(tabButtonSource).toContain("guard hasValidMouseDown || bounds.contains(point) else");
    expect(tabButtonSource).not.toContain("owningTitleBarView()");
    expect(tabButtonSource).not.toContain("rerouteMisdirected");
    expect(tabButtonSource).not.toContain("TerminalSessionTitleBarView.reroute");
    expect(actionButtonSource).not.toContain("override func mouseDown");
    expect(actionButtonSource).not.toContain("override func mouseUp");
    expect(actionButtonSource).not.toContain("nativePaneTabs.actionButton.mouseDown.outsideBounds");
    expect(actionButtonSource).not.toContain("owningTitleBarView()");
    expect(actionButtonSource).not.toContain("rerouteMisdirected");
    expect(titleBarSource).not.toContain("private func reroutedTitleBarTarget");
    expect(titleBarSource).not.toContain("handleReroutedTitleBar");
    expect(terminalWorkspaceSource).toContain("@objc private func performTitleBarAction(_ sender: NSButton)");
    expect(tabButtonSource).toContain('NativePaneTabDragReproLog.append(event: "nativePaneTabs.button.inlineMouseDown"');
    expect(tabButtonSource).toContain('NativePaneTabDragReproLog.append(event: "nativePaneTabs.button.inlineMouseUp"');
    expect(terminalWorkspaceSource).toContain('NativePaneTabDragReproLog.append(event: "nativePaneTabs.actionButton.perform"');
  });

  test("does not reroute misdelivered tab or fixed-button events through titlebar geometry", () => {
    /**
     * CDXC:NativePaneTabClicks 2026-06-13-11:35:
     * Stale receivers should be fixed by strict AppKit clipping and exact
     * child frames. Do not preserve titlebar geometry rerouting for
     * misdelivered tab, Close, or fixed-action events.
     */
    const titleBarIndex = terminalWorkspaceSource.indexOf("private final class TerminalSessionTitleBarView");
    const titleBarSource = terminalWorkspaceSource.slice(
      titleBarIndex,
      terminalWorkspaceSource.indexOf("final class ProjectEditorInitialLoadingOverlayView", titleBarIndex),
    );

    expect(titleBarSource).not.toContain("fileprivate static func rerouteMisdirectedTitleBarMouseDown(");
    expect(titleBarSource).not.toContain("fileprivate static func rerouteMisdirectedTitleBarMouseDragged(");
    expect(titleBarSource).not.toContain("fileprivate static func rerouteMisdirectedTitleBarMouseUp(");
    expect(titleBarSource).not.toContain("fileprivate func rerouteMisdirectedOwnedTitleBarMouseDown(");
    expect(titleBarSource).not.toContain("fileprivate func rerouteMisdirectedOwnedTitleBarMouseDragged(");
    expect(titleBarSource).not.toContain("fileprivate func rerouteMisdirectedOwnedTitleBarMouseUp(");
    expect(titleBarSource).not.toContain("handleReroutedTitleBarMouseDown(");
    expect(titleBarSource).not.toContain("handleReroutedTitleBarMouseDragged(");
    expect(titleBarSource).not.toContain("handleReroutedTitleBarMouseUp(");
    expect(titleBarSource).not.toContain('source: "titleBarDirect"');
    expect(titleBarSource).not.toContain("override func mouseDragged(with event: NSEvent)");
    expect(titleBarSource).not.toContain("override func mouseUp(with event: NSEvent)");
    expect(titleBarSource).not.toContain("private static func titleBarRerouteCandidate(for event: NSEvent)");
    expect(titleBarSource).not.toContain("collectTitleBarsForReroute(in: root, into: &titleBars)");
    expect(titleBarSource).not.toContain("private var pendingReroutedTitleBarTarget");
    expect(titleBarSource).not.toContain("private func reroutedTitleBarTarget");
    expect(titleBarSource).not.toContain("performReroutedFixedAction");
    expect(titleBarSource).not.toContain("performReroutedTitleBarAction");
    expect(titleBarSource).not.toContain('event: "nativePaneTabs.titleBar.reroute.mouseDown"');
    expect(titleBarSource).not.toContain('event: "nativePaneTabs.titleBar.reroute.mouseUp"');
    expect(titleBarSource).not.toContain('NativePaneTabDragReproLog.append(event: "nativePaneTabs.titleBar.reroute.miss"');
    expect(terminalWorkspaceSource).not.toContain("ReroutedTitleBarTarget");
  });

  test("keeps commands-panel resize rail outside the command tab strip", () => {
    /**
     * CDXC:NativePaneTabClicks 2026-06-12-04:08:
     * The command-panel resize rail is allowed to sit on the panel boundary, but
     * not across the native command tab bar where it can steal clicks from tabs.
     *
     * CDXC:CommandsPanel 2026-06-13-20:57:
     * The visible resize affordance should sit flush with the command tab bar by
     * moving only the hover line inside the existing rail, not by overlapping
     * the rail frame with command-tab chrome.
     */
    const resizeHandleIndex = terminalWorkspaceSource.indexOf("private func syncCommandsPanelResizeHandle");
    const frameIndex = terminalWorkspaceSource.indexOf("commandsPanelResizeHandleView.frame = CGRect(", resizeHandleIndex);
    const functionEndIndex = terminalWorkspaceSource.indexOf("private func syncPaneResizeHandleViews", resizeHandleIndex);
    const functionSource = terminalWorkspaceSource.slice(resizeHandleIndex, functionEndIndex);

    expect(resizeHandleIndex).toBeGreaterThan(-1);
    expect(frameIndex).toBeGreaterThan(resizeHandleIndex);
    expect(functionSource).toContain("let railY = min(");
    expect(functionSource).toContain("max(commandPanelBounds.maxY, bounds.minY)");
    expect(functionSource).toContain("y: railY");
    expect(functionSource).toContain("let commandPanelResizeHoverLineFrame = CGRect(");
    expect(functionSource).toContain("y: commandsPanelResizeHandleView.bounds.minY");
    expect(functionSource).toContain("explicitHoverLineFrame: commandPanelResizeHoverLineFrame");
    expect(functionSource).toContain("addSubview(commandsPanelResizeHandleView, positioned: .above, relativeTo: nil)");
    expect(functionSource).toContain("orderResizeHandlesToFront(reason: \"syncCommandsPanelResizeHandle\")");
    expect(functionSource).not.toContain("commandPanelBounds.maxY - railHeight / 2");
  });

  test("releases native resize cursors when rails end, reset, or hide", () => {
    /**
     * CDXC:NativePaneResize 2026-06-13-03:40:
     * Native resize cursors must be owned by visible concrete rails only. End,
     * double-click reset, and hide/collapse paths should refresh from the rail
     * currently under the pointer instead of reasserting resize cursors after
     * the resize gesture or visible rail frame has ended.
     */
    const beginProjectResizeSource = sourceSection(
      terminalWorkspaceSource,
      "private func beginProjectEditorCompanionResize(with event: NSEvent) -> Bool",
      "@discardableResult\n  private func continueProjectEditorCompanionResize",
    );
    const beginProjectResetSource = beginProjectResizeSource.slice(
      beginProjectResizeSource.indexOf("if event.clickCount >= 2"),
      beginProjectResizeSource.indexOf("let point = convert"),
    );
    const endProjectResizeSource = sourceSection(
      terminalWorkspaceSource,
      "private func endProjectEditorCompanionResize(with event: NSEvent) -> Bool",
      "private func keepCommandsPanelAboveWorkspacePanes",
    );
    const beginPaneResizeSource = sourceSection(
      terminalWorkspaceSource,
      "private func beginPaneResize(record: PaneResizeLayoutRecord, event: NSEvent) -> Bool",
      "@discardableResult\n  private func continuePaneResize",
    );
    const beginPaneResetSource = beginPaneResizeSource.slice(
      beginPaneResizeSource.indexOf("if event.clickCount >= 2"),
      beginPaneResizeSource.indexOf("let currentRatios"),
    );
    const continuePaneResizeSource = sourceSection(
      terminalWorkspaceSource,
      "private func continuePaneResize(with event: NSEvent) -> Bool",
      "private func paneResizeCursor(for direction",
    );
    const endPaneResizeSource = sourceSection(
      terminalWorkspaceSource,
      "private func endPaneResize(with event: NSEvent) -> Bool",
      "private func resetPaneHeaderInteractionState",
    );
    const beginCommandsResizeSource = sourceSection(
      terminalWorkspaceSource,
      "private func beginCommandsPanelResize(with event: NSEvent) -> Bool",
      "private func resetCommandsPanelHeightRatio",
    );
    const beginCommandsResetSource = beginCommandsResizeSource.slice(
      beginCommandsResizeSource.indexOf("if event.clickCount >= 2"),
      beginCommandsResizeSource.indexOf("let point = convert"),
    );
    const endCommandsResizeSource = sourceSection(
      terminalWorkspaceSource,
      "private func endCommandsPanelResize(with event: NSEvent) -> Bool",
      "@discardableResult\n  private func endPaneResize",
    );
    const workspaceHandleIndex = terminalWorkspaceSource.indexOf(
      "final class TerminalWorkspacePaneResizeHandleView: NSView",
    );
    const workspaceHandleSource = sourceSection(
      terminalWorkspaceSource,
      "final class TerminalWorkspacePaneResizeHandleView: NSView",
      "final class TerminalPaneBorderLayer",
    );
    const terminalPaneBorderLayerIndex = terminalWorkspaceSource.indexOf(
      "final class TerminalPaneBorderLayer: CAShapeLayer",
    );
    const terminalPaneBorderLayerSource = terminalWorkspaceSource.slice(terminalPaneBorderLayerIndex);
    expect(terminalWorkspaceSource).toContain("final class TerminalPaneBorderLayer: CAShapeLayer");
    expect(terminalWorkspaceSource).not.toContain("final class TerminalPaneBorderView");
    expect(terminalPaneBorderLayerIndex).toBeGreaterThan(-1);
    expect(terminalPaneBorderLayerSource).toContain("strokeColor = nextColor");
    expect(terminalPaneBorderLayerSource).toContain(
      "lineWidth = nextColor == nil ? 0 : currentBorderWidth()",
    );
    expect(terminalPaneBorderLayerSource).toContain("shadowPath = nil");
    expect(terminalPaneBorderLayerSource).not.toContain("shadowPath = nextPath");
    expect(workspaceHandleSource).not.toContain("override func hitTest(_ point: NSPoint) -> NSView?");
    expect(terminalWorkspaceSource).not.toContain("workspaceResizeHandleHitView");
    expect(terminalWorkspaceSource).not.toContain("resizeHandleHitView(at point: NSPoint)");
    expect(terminalWorkspaceSource).toContain("addSubview(handleView, positioned: .above, relativeTo: nil)");
    expect(terminalWorkspaceSource).toContain("orderResizeHandlesToFront(reason: \"syncPaneResizeHandleViews\")");
    const workspaceHandleMouseExitedSource = sourceSection(
      workspaceHandleSource,
      "override func mouseExited(with event: NSEvent)",
      "override func cursorUpdate(with event: NSEvent)",
    );
    const workspaceHandleMouseUpSource = sourceSection(
      terminalWorkspaceSource,
      "override func mouseUp(with event: NSEvent)",
      "final class TerminalPaneBorderLayer",
      workspaceHandleIndex,
    );
    const rootLayoutSource = sourceSection(
      appDelegateSource,
      "override func layout()",
      "private func promoteSidebarChrome",
      appDelegateSource.indexOf("final class ghostexRootView"),
    );
    const sidebarHandleIndex = appDelegateSource.indexOf("final class PaneResizeHandleView: NSView");
    const sidebarHandleSource = sourceSection(
      appDelegateSource,
      "final class PaneResizeHandleView: NSView",
      "extension ghostexRootView: WKNavigationDelegate",
    );
    const sidebarHandleMouseExitedSource = sourceSection(
      sidebarHandleSource,
      "override func mouseExited(with event: NSEvent)",
      "override func resetCursorRects",
    );
    const sidebarHandleMouseDraggedSource = sourceSection(
      sidebarHandleSource,
      "override func mouseDragged(with event: NSEvent)",
      "override func mouseUp(with event: NSEvent)",
    );
    const sidebarHandleMouseUpSource = sourceSection(
      appDelegateSource,
      "override func mouseUp(with event: NSEvent)",
      "extension ghostexRootView: WKNavigationDelegate",
      sidebarHandleIndex,
    );

    expect(terminalWorkspaceSource).toContain("private func refreshResizeCursorForCurrentPointer()");
    expect(terminalWorkspaceSource).toContain("refreshCursorForCurrentPointerIfInside()");
    expect(terminalWorkspaceSource).toContain("needsCursorRefreshBeforeRemoval()");
    expect(terminalWorkspaceSource).toContain("let shouldRefreshCursor = paneResizeHandleViews.contains");
    expect(terminalWorkspaceSource).toContain("commandsPanelResizeHandleView.needsCursorRefreshBeforeRemoval()");
    expect(terminalWorkspaceSource).toContain("projectEditorCompanionResizeHandleView.needsCursorRefreshBeforeRemoval()");
    expect(workspaceHandleSource).toContain("isResizeDragging || isCurrentPointerInsideVisibleHandle()");
    expect(workspaceHandleSource).toContain("private func isCurrentPointerInsideVisibleHandle() -> Bool");
    expect(workspaceHandleMouseExitedSource).toContain("if !isResizeDragging");
    expect(workspaceHandleMouseExitedSource).toContain("refreshCursorForCurrentPointer()");
    expect(workspaceHandleMouseExitedSource).not.toContain("NSCursor.arrow.set()");
    expect(workspaceHandleMouseUpSource).toContain("isResizeDragging = false");
    expect(workspaceHandleMouseUpSource).toContain("refreshCursorForCurrentPointer()");

    expect(beginProjectResetSource).toContain("refreshResizeCursorForCurrentPointer()");
    expect(beginProjectResetSource).not.toContain("NSCursor.resizeLeftRight.set()");
    expect(endProjectResizeSource).toContain("refreshResizeCursorForCurrentPointer()");
    expect(endProjectResizeSource).not.toContain("NSCursor.resizeLeftRight.set()");
    expect(beginPaneResetSource).toContain("refreshResizeCursorForCurrentPointer()");
    expect(beginPaneResetSource).not.toContain("paneResizeCursor(for: record.direction).set()");
    expect(beginPaneResizeSource).toContain("paneResizeCursor(for: record.direction).set()");
    expect(continuePaneResizeSource).toContain("paneResizeCursor(for: drag.direction).set()");
    expect(endPaneResizeSource).toContain("refreshResizeCursorForCurrentPointer()");
    expect(endPaneResizeSource).not.toContain("paneResizeCursor(for: drag.direction).set()");
    expect(beginCommandsResetSource).toContain("refreshResizeCursorForCurrentPointer()");
    expect(beginCommandsResetSource).not.toContain("NSCursor.resizeUpDown.set()");
    expect(endCommandsResizeSource).toContain("refreshResizeCursorForCurrentPointer()");
    expect(endCommandsResizeSource).not.toContain("NSCursor.resizeUpDown.set()");

    expect(rootLayoutSource).toContain("divider.needsCursorRefreshBeforeHide()");
    expect(rootLayoutSource).toContain("divider.refreshCursorAfterVisibilityChange()");
    expect(appDelegateSource).not.toContain("addCursorRect(divider.frame, cursor: .resizeLeftRight)");
    expect(sidebarHandleSource).toContain("private var isResizeDragging = false");
    expect(sidebarHandleSource).toContain("private func appendSidebarResizeCursorLog(");
    expect(sidebarHandleSource).toContain("guard NativeDebugLogging.isEnabled");
    expect(sidebarHandleSource).toContain("NativePaneTabDragReproLog.append(event: eventName, details: details)");
    expect(sidebarHandleSource).toContain('"nativeSidebarResize.handle.mouseEntered"');
    expect(sidebarHandleSource).toContain('"nativeSidebarResize.handle.mouseExited"');
    expect(sidebarHandleSource).toContain('"nativeSidebarResize.handle.cursorRefresh"');
    expect(sidebarHandleSource).toContain('"nativeSidebarResize.handle.resetCursorRects"');
    expect(sidebarHandleSource).toContain('"nativeSidebarResize.handle.mouseDown"');
    expect(sidebarHandleSource).toContain('"nativeSidebarResize.handle.mouseDragged"');
    expect(sidebarHandleSource).toContain('"nativeSidebarResize.handle.mouseUp"');
    expect(sidebarHandleSource).toContain('"cursorAction": cursorAction');
    expect(sidebarHandleSource).toContain('"pointerInside": pointerInside ?? isCurrentPointerInsideVisibleHandle()');
    expect(sidebarHandleSource).toContain('"currentWindowPoint"');
    expect(sidebarHandleSource).toContain('"eventWindowPoint"');
    expect(sidebarHandleSource).toContain("if Self.sidebarResizeCursorEventSupportsClickCount(event.type)");
    expect(sidebarHandleSource).toContain("private static func sidebarResizeCursorEventSupportsClickCount");
    expect(sidebarHandleSource).toContain("case .leftMouseDown, .leftMouseDragged, .leftMouseUp,");
    expect(sidebarHandleSource).toContain(".rightMouseDown, .rightMouseDragged, .rightMouseUp,");
    expect(sidebarHandleSource).toContain(".otherMouseDown, .otherMouseDragged, .otherMouseUp:");
    expect(sidebarHandleSource).toContain("func needsCursorRefreshBeforeHide() -> Bool");
    expect(sidebarHandleSource).toContain("func refreshCursorAfterVisibilityChange()");
    expect(sidebarHandleSource).toContain("private func isCurrentPointerInsideVisibleHandle() -> Bool");
    expect(sidebarHandleSource).toContain("addCursorRect(bounds, cursor: .resizeLeftRight)");
    expect(sidebarHandleMouseExitedSource).toContain("if !isResizeDragging");
    expect(sidebarHandleMouseExitedSource).not.toContain("clickCount");
    expect(sidebarHandleMouseDraggedSource).toContain("NSCursor.resizeLeftRight.set()");
    expect(sidebarHandleMouseUpSource).toContain("isResizeDragging = false");
    expect(sidebarHandleMouseUpSource).toContain('refreshCursorForCurrentPointer(reason: "mouseUp", event: event)');
  });
});
