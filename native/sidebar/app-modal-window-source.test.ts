import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const appDelegateSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift", import.meta.url),
  "utf8",
);
const remoteGxserverClientSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/RemoteGxserverClient.swift", import.meta.url),
  "utf8",
);
const buildGhostexHostSource = readFileSync(
  new URL("../macos/ghostexHost/build-ghostex-host.sh", import.meta.url),
  "utf8",
);
const remoteGxserverLinuxPackageScriptSource = readFileSync(
  new URL("../../gxserver-rs/package-remote-linux.mjs", import.meta.url),
  "utf8",
);
const packageJsonSource = readFileSync(new URL("../../package.json", import.meta.url), "utf8");
const gpuiMainSource = readFileSync(new URL("../../gpui/src/main.rs", import.meta.url), "utf8");
const gpuiCefMacosSource = readFileSync(
  new URL("../../gpui/src/cef/macos.rs", import.meta.url),
  "utf8",
);
const modalStylesSource = readFileSync(
  new URL("../../sidebar/styles/modals.css", import.meta.url),
  "utf8",
);
const delayedSendModalSource = readFileSync(
  new URL("../../sidebar/delayed-send-modal.tsx", import.meta.url),
  "utf8",
);
const remoteGxserverInstallModalSource = readFileSync(
  new URL("../../sidebar/remote-gxserver-install-modal.tsx", import.meta.url),
  "utf8",
);
const remoteProjectPickerModalSource = readFileSync(
  new URL("../../sidebar/remote-project-picker/remote-project-picker-modal.tsx", import.meta.url),
  "utf8",
);
const sidebarStylesSource = readFileSync(
  new URL("../../sidebar/styles.css", import.meta.url),
  "utf8",
);
const modalHostSource = readFileSync(new URL("./modal-host.tsx", import.meta.url), "utf8");
const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");
const sidebarAppSource = readFileSync(
  new URL("../../sidebar/sidebar-app.tsx", import.meta.url),
  "utf8",
);
const sortableSessionCardSource = readFileSync(
  new URL("../../sidebar/sortable-session-card.tsx", import.meta.url),
  "utf8",
);
const titlebarHostSource = readFileSync(new URL("./titlebar-host.tsx", import.meta.url), "utf8");
const commandPaletteSource = readFileSync(
  new URL("../../sidebar/command-palette.tsx", import.meta.url),
  "utf8",
);
const settingsModalSource = readFileSync(
  new URL("../../sidebar/settings-modal.tsx", import.meta.url),
  "utf8",
);
const worktreeCreateModalSource = readFileSync(
  new URL("../../sidebar/worktree-create-modal.tsx", import.meta.url),
  "utf8",
);

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("native app modal window source", () => {
  test("keeps floating prompt editor input owned by its native child window", () => {
    /*
    CDXC:PromptEditor 2026-06-13-13:48:
    The floating prompt editor must not publish root-window input regions from React. Its native child window owns frame, focus, movement, resize, and event delivery.
    */
    expect(modalHostSource).toContain("The floating prompt editor is a native child window");
    expect(modalHostSource).not.toContain("floatingPromptEditorHitRegion");
    expect(modalHostSource).not.toContain("PromptEditor:hitRegion");
    expect(modalHostSource).not.toContain("react.hitRegion");
    expect(appDelegateSource).not.toContain("updateFloatingPromptEditorHitRegion");
    expect(appDelegateSource).not.toContain("native.hitRegion");
  });

  test("shows the native prompt editor resize handle and opens previews from the full thumbnail", () => {
    /*
    CDXC:PromptEditor 2026-06-16-10:23:
    The native child-window prompt editor needs a visible bottom-right resize handle with a resize cursor, and every visible part of an image thumbnail should open the image preview except the explicit remove button.

    CDXC:PromptEditor 2026-06-16-21:32:
    The bottom thumbnail shelf must own normal WebKit clicks. Native prompt-window drag/resize handling may intercept only the explicit bottom-right resize handle, not the whole bottom edge.

    CDXC:PromptEditor 2026-06-17-17:04:
    WKWebView reports flipped local coordinates, so the native titlebar drag band must be the visual top edge, not the bottom image shelf. The WebView should also reject generic background window movement.
    */
    const nativeResizeRule = sourceBetween(
      modalStylesSource,
      ".app-modal-host-native-window-body .floating-prompt-editor-resize {",
      ".floating-prompt-editor-titlebar {",
    );
    expect(nativeResizeRule).toContain("display: block");
    expect(nativeResizeRule).not.toContain("display: none");

    const resizeRule = sourceBetween(
      modalStylesSource,
      "\n.floating-prompt-editor-resize {",
      "\n.floating-prompt-editor-resize::before",
    );
    expect(resizeRule).toContain("cursor: nwse-resize");
    expect(resizeRule).toContain("height: 24px");
    expect(resizeRule).toContain("width: 24px");

    expect(modalHostSource).toContain('className="floating-prompt-editor-image-open"');
    expect(modalHostSource).toContain('onClick={() => setOpenImagePreview(preview)}');
    expect(modalHostSource).toContain("onPointerDown={isNativeWindowSurface ? undefined : startResize}");
    expect(appDelegateSource).toContain("promptEditorBottomRightResizeHandleSize");
    expect(appDelegateSource).toContain("return [.right, .bottom]");
    const promptEditorResizeEdges = sourceBetween(
      appDelegateSource,
      "private func promptEditorResizeEdges(for point: CGPoint) -> ResizeEdges {",
      "private func resizePromptEditorWindow(from event: NSEvent, edges: ResizeEdges) {",
    );
    expect(promptEditorResizeEdges).not.toContain("point.y <= promptEditorResizeMargin");
    expect(promptEditorResizeEdges).toContain("point.x <= promptEditorResizeMargin");
    expect(promptEditorResizeEdges).toContain("point.x >= frame.width - promptEditorResizeMargin");
    expect(appDelegateSource).toContain(
      "panel.promptEditorBottomRightResizeHandleSize = Self.floatingPromptEditorResizeHandleSize",
    );
    const promptEditorWebView = sourceBetween(
      appDelegateSource,
      "private final class AppModalWindowWebView: WKWebView {",
      "private final class AppModalWindowController: NSObject",
    );
    expect(promptEditorWebView).toContain("override var mouseDownCanMoveWindow: Bool");
    expect(promptEditorWebView).toContain("return false");
    expect(promptEditorWebView).toContain("let isInTitleDragBand: Bool");
    expect(promptEditorWebView).toContain("if isFlipped");
    expect(promptEditorWebView).toContain("isInTitleDragBand = point.y <= nativeWindowTitleDragHeight");
    expect(promptEditorWebView).toContain(
      "isInTitleDragBand = point.y >= bounds.height - nativeWindowTitleDragHeight",
    );
  });

  test("keeps prompt editor text through app and window close", () => {
    /*
    CDXC:PromptEditor 2026-06-16-10:36:
    Prompt editor text must not be lost when the app or main window closes before the user presses Save. React should live-write Monaco edits to the native prompt file, and AppKit lifecycle close should mark that current draft saved instead of cancelling the editor.
    */
    expect(modalHostSource).toContain('type: "floatingPromptEditorDraftUpdate"');
    expect(modalHostSource).toContain("postDraftUpdate");
    expect(modalHostSource).toContain("refreshEditorTextDerivedState");
    expect(modalHostSource).toContain('refreshEditorTextDerivedState(existingEditor, "contentChanged")');
    expect(modalHostSource).toContain('refreshEditorTextDerivedState(monacoEditor, "contentChanged")');
    expect(modalHostSource).toContain('refreshEditorTextDerivedState(monacoEditor, "pageLifecycle", { force: true })');

    expect(appDelegateSource).toContain('case "floatingPromptEditorDraftUpdate":');
    expect(appDelegateSource).toContain("updateFloatingPromptEditorDraft(message: message)");
    expect(appDelegateSource).toContain("func saveActiveFloatingPromptEditorForAppLifecycleClose(reason: String)");
    expect(appDelegateSource).toContain(
      'writeFloatingPromptEditorStatusFile(active.statusFile, status: "saved", requestId: active.requestId)',
    );
    expect(appDelegateSource).toContain(
      "saveActiveFloatingPromptEditorForAppLifecycleClose(\n      reason: \"mainWindowWillClose\")",
    );
    expect(appDelegateSource).toContain(
      "saveActiveFloatingPromptEditorForAppLifecycleClose(\n      reason: \"applicationWillTerminate\")",
    );
  });

  test("animates native app toasts from the bottom center of the app window", () => {
    /*
    CDXC:AppToasts 2026-06-13-19:57:
    Native macOS toasts should center on the app window, start from a lower bottom-center frame, and fade upward into the stack so sidebar placement and the initial NSPanel origin never leak into the visible animation.
    */
    const rootLayoutToastAnchor = sourceBetween(
      appDelegateSource,
      "workspaceView.frame = frames.workspace",
      "layoutRootChromeLayers(frames: frames)",
    );
    expect(rootLayoutToastAnchor).toContain("anchorFrame: bounds");
    expect(rootLayoutToastAnchor).not.toContain("anchorFrame: frames.workspace");

    const nativeToastController = sourceBetween(
      appDelegateSource,
      "private final class NativeAppToastController",
      "private final class NativeAppToastView",
    );
    expect(nativeToastController).toContain("private static let enterYOffset: CGFloat = 24");
    expect(nativeToastController).toContain(
      "layoutPanels(animated: true, enteringToastId: enteringToastId)",
    );
    expect(nativeToastController).toContain("frame.offsetBy(dx: 0, dy: -Self.enterYOffset)");
    expect(nativeToastController).toContain(
      "item.panel.setFrame(Self.enterStartFrame(for: frame), display: true)",
    );
    expect(nativeToastController).toContain("context.timingFunction = Self.toastAnimationTimingFunction()");
    expect(nativeToastController).toContain("item.panel.animator().alphaValue = 1");
    expect(nativeToastController).toContain("x: floor(screenAnchorFrame.midX - size.width / 2)");
  });

  test("sizes native app toasts from wrapped title and description text", () => {
    /*
    CDXC:AppToasts 2026-06-16-18:41:
    Native app toasts should measure wrapped description text and grow the
    panel height instead of using a fixed two-line frame that can cut off Git
    error messages.

    CDXC:AppToasts 2026-06-21-13:59:
    Title-only daemon errors also need wrapped measurement so a long startup
    message grows the panel instead of truncating in a fixed-height toast.
    */
    const nativeToastView = sourceBetween(
      appDelegateSource,
      "private final class NativeAppToastView",
      "private final class NativeToastActionButton",
    );
    expect(nativeToastView).toContain("titleField.lineBreakMode = .byWordWrapping");
    expect(nativeToastView).toContain("titleField.maximumNumberOfLines = 0");
    expect(nativeToastView).toContain("titleField.cell?.wraps = true");
    expect(nativeToastView).toContain("measuredTitleHeight(request.title, width: textWidth)");
    expect(nativeToastView).toContain("descriptionField.lineBreakMode = .byWordWrapping");
    expect(nativeToastView).toContain("descriptionField.maximumNumberOfLines = 0");
    expect(nativeToastView).toContain("descriptionField.cell?.wraps = true");
    expect(nativeToastView).toContain("measuredDescriptionHeight(description, width: textWidth)");
    expect(nativeToastView).toContain("boundingRect(");
    expect(nativeToastView).not.toContain("descriptionField.lineBreakMode = .byTruncatingTail");
    expect(nativeToastView).not.toContain("titleField.lineBreakMode = .byTruncatingTail");
    expect(nativeToastView).not.toContain("titleField.usesSingleLineMode = true");
    expect(nativeToastView).not.toContain("let baseHeight: CGFloat = hasDescription ? 72 : 52");
    expect(nativeToastView).not.toContain(
      "descriptionField.frame = CGRect(x: leadingContentX, y: 37, width: textWidth, height: bounds.height - 49)",
    );
  });

  test("opens first-launch setup 90px taller than the generic management modals", () => {
    /*
    CDXC:FirstLaunchSetup 2026-06-12-07:13:
    The macOS first-launch setup modal must open 90px taller than its old 1120x760 native child window so onboarding steps with hook status and footer actions are not clipped.
    Keep Agents Hub at the generic management-modal height while firstLaunchSetup and the legacy tipsAndTricks alias use the taller frame.

    CDXC:HighlightedFeatures 2026-06-18-02:02:
    Highlighted Features uses a shorter 1120x750 native child-window footprint while keeping the existing discoverGhostex modal id.

    CDXC:GhostexTutorialVideo 2026-06-18-04:49:
    The copied tutorial video modal should use the same 1120x750 native child-window footprint so its one embedded player fills the modal.
    */
    const defaultSize = sourceBetween(
      appDelegateSource,
      "private func defaultSize(for modal: String) -> CGSize",
      "private func constrainedSize(_ size: CGSize, parentWindow: NSWindow) -> CGSize",
    );
    expect(defaultSize).toContain('case "agentsHub":');
    expect(defaultSize).toContain("return CGSize(width: 1120, height: 760)");
    expect(defaultSize).toContain('case "firstLaunchSetup", "tipsAndTricks":');
    expect(defaultSize).toContain("return CGSize(width: 1120, height: 850)");
    expect(defaultSize).toContain('case "discoverGhostex", "watchGhostexVideo":');
    expect(defaultSize).toContain("return CGSize(width: 1120, height: 750)");

    const modalTitle = sourceBetween(
      appDelegateSource,
      "private func title(for modal: String) -> String",
      "private final class TitlebarDropdownPanelController",
    );
    expect(modalTitle).toContain('case "firstLaunchSetup", "tipsAndTricks":');
    expect(modalTitle).toContain('return "Tips"');
    expect(modalTitle).toContain('case "discoverGhostex":');
    expect(modalTitle).toContain('return "Highlighted Features"');
    expect(modalTitle).toContain('case "watchGhostexVideo":');
    expect(modalTitle).toContain('return "Tutorial Video"');
  });

  test("opens Settings-family modals as separate resizable native windows", () => {
    /*
    CDXC:SettingsWindow 2026-06-24-05:39:
    Settings and Settings-family entry points must open in a separate titled,
    draggable, resizable native modal instead of covering the app workspace.
    The content area starts and bottoms out at 1000x750 and is capped at
    1800x1200.
    */
    const preferredFrame = sourceBetween(
      appDelegateSource,
      "private func preferredNativeAppModalContentFrame(",
      "fileprivate func updateAppModalChildWindowFramesIfNeeded()",
    );
    expect(preferredFrame).toContain("CDXC:SettingsWindow 2026-06-24-05:39:");
    expect(preferredFrame).toContain("return preferredContentFrame");
    expect(preferredFrame).not.toContain("rootLayoutFrames().workspace");
    expect(preferredFrame).not.toContain("parentWindow.convertToScreen(convert(workspaceFrame, to: nil))");
    expect(appDelegateSource).toContain("private func isSettingsAppModal(_ modal: String?) -> Bool");
    expect(appDelegateSource).toContain(
      'case "settings", "configureAgents", "configureActions", "openTargets", "hotkeys":',
    );
    const modalTitle = sourceBetween(
      appDelegateSource,
      "private func title(for modal: String) -> String",
      "private final class TitlebarDropdownPanel",
    );
    expect(modalTitle).toContain("if isSettingsAppModal(modal)");
    expect(modalTitle).toContain('return "Ghostex Settings"');
    expect(modalTitle).not.toContain('return "Settings"');

    const openNativeModal = sourceBetween(
      appDelegateSource,
      "private func openNativeAppModalWindow(",
      "private func preferredNativeAppModalContentFrame",
    );
    expect(openNativeModal).toContain("let resolvedPreferredContentFrame = preferredNativeAppModalContentFrame(");
    expect(openNativeModal).toContain("preferredContentFrame: resolvedPreferredContentFrame");

    const defaultSize = sourceBetween(
      appDelegateSource,
      "private func defaultSize(for modal: String) -> CGSize",
      "private func constrainedSize(_ size: CGSize, parentWindow: NSWindow) -> CGSize",
    );
    expect(defaultSize).toContain('case "settings", "configureAgents", "configureActions", "openTargets", "hotkeys":');
    expect(defaultSize).toContain("return Self.settingsWindowSize");

    const appModalWindowController = sourceBetween(
      appDelegateSource,
      "private final class AppModalWindowController",
      "private final class TitlebarDropdownPanelController",
    );
    expect(appModalWindowController).toContain(
      "private static let settingsWindowSize = CGSize(width: 1000, height: 750)",
    );
    expect(appModalWindowController).toContain(
      "private static let settingsWindowMaximumSize = CGSize(width: 1800, height: 1200)",
    );
    expect(appModalWindowController).toContain("panel.contentMaxSize = maximumContentSize");
    expect(appModalWindowController).toContain("private func maximumContentSize(for modal: String?) -> CGSize?");
    expect(appModalWindowController).toContain("return Self.settingsWindowMaximumSize");
    expect(appModalWindowController).toContain("return [.titled, .closable, .resizable]");
    expect(appModalWindowController).toContain(
      'case "settings", "configureAgents", "configureActions", "openTargets", "hotkeys":',
    );
    expect(appModalWindowController).toContain("return Self.settingsWindowSize");
    expect(appModalWindowController).not.toContain("return CGSize(width: 1, height: 1)");
    expect(appModalWindowController).not.toContain("isSettingsWorkspaceAppModal");

    const settingsStyles = sourceBetween(
      sidebarStylesSource,
      ".app-modal-host-native-window-body .ghostex-settings-shadcn.settings-modal-dialog {",
      ".ghostex-settings-shadcn.settings-modal-dialog .ghostex-modal-heading-bar",
    );
    expect(settingsStyles).toContain("box-sizing: border-box;");
    expect(settingsStyles).toContain("height: 100vh;");
    expect(settingsStyles).toContain("max-height: 100vh;");
    expect(settingsStyles).toContain("max-width: 100vw;");
    expect(settingsStyles).toContain("width: 100vw;");
    expect(settingsStyles).not.toContain("border-bottom:");
    expect(settingsStyles).not.toContain("border-right:");
    expect(settingsStyles).not.toContain("border-top:");
  });

  test("loads the tutorial video modal host with an HTTPS base URL", () => {
    /*
    CDXC:GhostexTutorialVideo 2026-06-18-05:35:
    Third-party iframe playback can fail when the modal host is loaded from
    file:// without a valid HTTP referrer. The tutorial video modal should load
    the generated modal-host HTML string with a stable HTTPS base URL while
    keeping normal local-file loading for other modals.
    */
    const appModalWindowController = sourceBetween(
      appDelegateSource,
      "private final class AppModalWindowController",
      "private final class TitlebarDropdownPanel",
    );
    expect(appModalWindowController).toContain(
      'private static let ghostexTutorialVideoEmbedBaseURL = URL(string: "https://ghostex.local/")!',
    );
    expect(appModalWindowController).toContain('if loadedModal == "watchGhostexVideo"');
    expect(appModalWindowController).toContain("String(contentsOf: builtModalHost, encoding: .utf8)");
    expect(appModalWindowController).toContain(
      "baseURL: Self.ghostexTutorialVideoEmbedBaseURL",
    );
    expect(appModalWindowController).toContain(
      "webView.loadFileURL(builtModalHost, allowingReadAccessTo: webAssets)",
    );
  });

  test("opens titlebar dropdown panels as keyable child windows for hover", () => {
    /*
    CDXC:TitlebarDropdowns 2026-06-16-09:22:
    Resources, Git, Tips, Keep Awake, Actions, Open In, and mode dropdowns all
    use the titlebar child-window controller. Those panels must be keyable and
    mouse-move aware so WKWebView hover detection works like Settings instead
    of inheriting nonactivating-panel hover gaps.
    */
    const dropdownPanelClass = sourceBetween(
      appDelegateSource,
      "private final class TitlebarDropdownPanel",
      "private final class TitlebarDropdownPanelController",
    );
    expect(dropdownPanelClass).toContain("override var canBecomeKey: Bool { true }");
    expect(dropdownPanelClass).toContain("override var canBecomeMain: Bool { false }");

    const dropdownController = sourceBetween(
      appDelegateSource,
      "private final class TitlebarDropdownPanelController",
      "final class ReactTitlebarChromeView",
    );
    expect(dropdownController).toContain("let panel = TitlebarDropdownPanel(");
    expect(dropdownController).toContain("styleMask: [.borderless]");
    expect(dropdownController).toContain("panel.acceptsMouseMovedEvents = true");
    expect(dropdownController).toContain("panel.makeKeyAndOrderFront(nil)");
    expect(dropdownController).toContain("panel.makeFirstResponder(webView)");
    expect(dropdownController).not.toContain(".nonactivatingPanel");
  });

  test("keeps resizable Settings windows user-positioned while refreshing child-window overlays", () => {
    /*
    CDXC:SettingsWindow 2026-06-24-05:39:
    Settings is a user-draggable and user-resizable native modal. Main-window
    resize, sidebar collapse, and sidebar side changes must not reframe Settings
    back onto the workspace; only overlay surfaces that intentionally track app
    layout, such as onboarding backdrops, should refresh here.
    */
    const resizeStart = sourceBetween(
      appDelegateSource,
      "func windowWillStartLiveResize(_ notification: Notification)",
      "func windowDidResize(_ notification: Notification)",
    );
    expect(resizeStart).toContain("resizedWindow === mainWindow");
    expect(resizeStart).toContain("updateAppModalChildWindowFramesIfNeeded()");

    const updateChildWindows = sourceBetween(
      appDelegateSource,
      "fileprivate func updateAppModalChildWindowFramesIfNeeded()",
      "private func shouldShowOnboardingAppModalBackdrop",
    );
    expect(updateChildWindows).toContain("updateOnboardingAppModalBackdropFrameIfNeeded()");
    expect(updateChildWindows).not.toContain("updateSettingsModalWorkspaceFrameIfNeeded");
    expect(updateChildWindows).not.toContain("preferredNativeAppModalContentFrame(");
    expect(updateChildWindows).not.toContain("nativeAppModalWindowController?.updateContentFrame(");

    const rootChrome = sourceBetween(
      appDelegateSource,
      "func setSidebarSide(_ side: SidebarSide)",
      "private func setTitlebarSidebarCollapsed",
    );
    expect(rootChrome).toContain("updateAppModalChildWindowFramesIfNeeded()");

    const appModalWindowController = sourceBetween(
      appDelegateSource,
      "private final class AppModalWindowController",
      "private static func sidebarTheme",
    );
    expect(appModalWindowController).toContain("func updateContentFrame(");
    expect(appModalWindowController).toContain("panel.setFrame(panel.frameRect(forContentRect: contentFrame), display: true)");
  });

  test("dismisses Settings from sidebar and titlebar navigation", () => {
    /*
    CDXC:SettingsDismissal 2026-06-15-14:07:
    Settings should close when users navigate through sidebar sessions, sidebar
    creation/search/modal actions, titlebar mode/action buttons, or native
    create-session and rename hotkeys.

    CDXC:SettingsDismissal 2026-06-16-02:12:
    Quick-row creation actions replaced the old reference-session label.
    Assert the current terminal, browser, and agent quick-create dismissal
    markers so Settings still closes before those actions run.
    */
    expect(sidebarAppSource).toContain("dismissAppModalForSidebarNavigation");
    expect(sidebarAppSource).toContain("SettingsDismissal:sessionClick");
    expect(sidebarAppSource).toContain("SettingsDismissal:createQuickTerminal");
    expect(sidebarAppSource).toContain("SettingsDismissal:createQuickBrowser");
    expect(sidebarAppSource).toContain("SettingsDismissal:createQuickAgent");
    expect(sidebarAppSource).toContain("SettingsDismissal:previousSessionsTextSearch");
    expect(sidebarAppSource).toContain("SettingsDismissal:agentsHub");
    expect(sidebarAppSource).toContain("SettingsDismissal:renameSession");

    expect(sortableSessionCardSource).toContain("SettingsDismissal:sessionRowRename");
    expect(titlebarHostSource).toContain("closeAppModalFromTitlebarNavigation");
    expect(titlebarHostSource).toContain("SettingsDismissal:titlebarAction");
    expect(titlebarHostSource).toContain("SettingsDismissal:titlebarAgentsMode");
    expect(titlebarHostSource).toContain("SettingsDismissal:titlebarSourceMode");
    expect(titlebarHostSource).toContain("SettingsDismissal:titlebarBrowserMode");
    expect(titlebarHostSource).toContain("SettingsDismissal:titlebarKanbanMode");
    expect(titlebarHostSource).toContain("SettingsDismissal:titlebarManageMode");

    expect(nativeSidebarSource).toContain("SettingsDismissal:nativeHotkeyCreateSession");
    expect(nativeSidebarSource).toContain("SettingsDismissal:nativeHotkeyRename");
    expect(nativeSidebarSource).toContain("SettingsDismissal:nativeSidebarCreateSession");
  });

  test("keeps titlebar action crash breadcrumbs behind Debugging Mode", () => {
    /*
    CDXC:GxserverLogs 2026-06-15-20:39:
    Titlebar action crash traces are breadcrumbs from an isolated webview, not
    normal-mode crash warnings. The titlebar host should only post them while
    Debugging Mode is enabled.
    */
    expect(titlebarHostSource).toContain("function appendTitlebarActionCrashDebugLog(");
    expect(titlebarHostSource).toContain("if (!debuggingMode) {");
    expect(titlebarHostSource).toContain("projectState.debuggingMode");
    expect(titlebarHostSource).toContain("nativeSidebar.actionCrashTrace.titlebarClick");
  });

  test("relays dropdown Quick Action selection to the main titlebar button", () => {
    /*
    CDXC:TitlebarActions 2026-06-16-18:31:
    The Quick Actions dropdown runs in a native child WKWebView, so selecting an
    action there must explicitly update the main titlebar WKWebView's selected
    action id before forwarding execution to the sidebar runner.
    */
    expect(titlebarHostSource).toContain("setLastActionCommandId: (commandId: string) => void");
    expect(titlebarHostSource).toContain("setLastActionCommandId: (commandId) => {");
    expect(titlebarHostSource).toContain("setSelectedActionCommandId(commandId);");
    expect(appDelegateSource).toContain("setLastActionCommandId?.(\\(commandIdJson))");
    expect(appDelegateSource).toContain("runSidebarCommandFromTitlebar?.(\\(commandIdJson))");
  });

  test("rotates AppDelegate-owned support logs", () => {
    /*
    CDXC:GxserverLogs 2026-06-15-20:39:
    Shared AppDelegate log files such as native-host-lifecycle should rotate at
    the common support-bundle limit instead of growing without bound during long
    Debugging Mode sessions.

    CDXC:Diagnostics 2026-06-16-12:22:
    App startup should also schedule a one-minute delayed line-retention pass so
    shared support logs stay bounded even when old debug storms predate byte
    rotation.

    CDXC:Diagnostics 2026-06-16-14:09:
    Retention should keep one current split file per `.log`/`.jsonl` basename,
    delete older rotated siblings from that group, then trim the retained file
    to 25,000 lines.
    */
    expect(appDelegateSource).toContain("sharedLogMaxFileBytes: UInt64 = 25 * 1024 * 1024");
    expect(appDelegateSource).toContain("sharedLogMaxRotatedFiles = 3");
    expect(appDelegateSource).toContain("sharedLogMaxRetainedLines = 25_000");
    expect(appDelegateSource).toContain("sharedLogRetentionStartupDelay: TimeInterval = 60");
    expect(appDelegateSource).toContain("rotateSharedLogIfNeeded(logURL: logURL");
    expect(appDelegateSource).toContain("Self.scheduleSupportLogLineRetentionAfterStartup()");
    expect(appDelegateSource).toContain("private static func scheduleSupportLogLineRetentionAfterStartup()");
    expect(appDelegateSource).toContain("private static func pruneSupportLogFile(_ logURL: URL, maxLines: Int) throws");
    expect(appDelegateSource).toContain("private static func sharedSupportLogBaseName(_ fileName: String) -> String?");
    expect(appDelegateSource).toContain("private static func preferredSharedSupportLogFile(in fileURLs: [URL]) -> URL?");
    expect(appDelegateSource).toContain("try manager.removeItem(at: fileURL)");
    expect(appDelegateSource).toContain('baseName.hasSuffix(".log") || baseName.hasSuffix(".jsonl")');
    expect(appDelegateSource).toContain("native-host-lifecycle.log");
    expect(appDelegateSource).toContain("sampledNativeHostLifecycleMessage");
    expect(appDelegateSource).toContain('"activationBoundaryInput"');
    expect(appDelegateSource).toContain('"workspaceApplicationActivated"');
  });

  test("ignores duplicate native app-modal opens except command-palette mode switches", () => {
    /*
    CDXC:AppModals 2026-06-15-10:27:
    Opening the same native app modal again should be a no-op for Settings,
    Rename Session, Previous Sessions, and the rest of the app-modal family.
    Command Palette remains the exception because repeat Cmd+P/Cmd+Shift+P
    requests switch the already-visible palette between files and commands.
    */
    const openNativeModal = sourceBetween(
      appDelegateSource,
      "private func openNativeAppModalWindow(",
      "private func preferredNativeAppModalContentFrame",
    );
    expect(openNativeModal).toContain("shouldIgnoreDuplicateNativeAppModalOpen(");
    expect(openNativeModal).toContain("if !isVisibleCommandPaletteModeSwitch(modal: modal)");

    const duplicateGuard = sourceBetween(
      appDelegateSource,
      "private func shouldIgnoreDuplicateNativeAppModalOpen(",
      "private func preferredNativeAppModalContentFrame",
    );
    expect(duplicateGuard).toContain('guard modal != "commandPalette"');
    expect(duplicateGuard).toContain("isSettingsAppModal(modal)");
    expect(duplicateGuard).toContain("isVisibleModal(modal) == true");
    expect(duplicateGuard).toContain("isActiveOrPendingModal(modal)");
    expect(duplicateGuard).toContain("nativeBridge.appModal.open.duplicateIgnored");
    expect(duplicateGuard).toContain("private func isVisibleCommandPaletteModeSwitch(modal: String) -> Bool");

    const appModalWindowController = sourceBetween(
      appDelegateSource,
      "private final class AppModalWindowController",
      "private final class TitlebarDropdownPanelController",
    );
    expect(appModalWindowController).toContain("func isActiveOrPendingModal(_ modal: String) -> Bool");

    expect(modalHostSource).toContain("commandPaletteOpenRequestSequence");
    expect(modalHostSource).toContain("setCommandPaletteOpenRequestSequence((sequence) => sequence + 1)");
    expect(modalHostSource).toContain("openRequestSequence={commandPaletteOpenRequestSequence}");
  });

  test("keeps Settings modal diagnostics privacy-safe", () => {
    /*
    CDXC:SettingsModalDiagnostics 2026-06-20-05:38:
    Settings blank-window diagnostics may persist to the shared support logs while Debugging Mode is enabled. They must prove bridge delivery and renderability with safe lifecycle fields instead of raw settings values, paths, URLs, project names, command text, search text, or secrets.

    CDXC:SettingsModalDiagnostics 2026-06-20-06:03:
    Diagnostics must cover native WebView load, host-ready dispatch, React open handling, React renderability, presented dispatch, and final AppKit visibility so blank Settings reports can be placed on one lifecycle timeline.

    CDXC:GPUISettingsModalDiagnostics 2026-06-27-20:31:
    GPUI Settings blank-window recovery must add CEF lifecycle diagnostics and one ready-timeout recreate while keeping the persistent app-modal log writer sanitized to fixed booleans, numbers, and enums.

    CDXC:FirstLaunchSetupDiagnostics 2026-06-29-22:08:
    Setup slow-open repros must log native child-window lifecycle and React
    renderability checkpoints in app-modal-debug.log while keeping payloads to
    modal ids, booleans, revisions, request ids, timings, and enum-like fields.
    */
    const settingsWindowLogger = sourceBetween(
      appDelegateSource,
      "private func logSettingsWindowEvent(",
      "private func defaultSize(for modal: String)",
    );
    expect(settingsWindowLogger).toContain("CDXC:FirstLaunchSetupDiagnostics 2026-06-29-22:08:");
    expect(settingsWindowLogger).toContain("isFirstLaunchSetupAppModal(loadedModal)");
    expect(settingsWindowLogger).toContain("AppDelegate.appendAppModalDebugLog");
    expect(appDelegateSource).toContain(
      "NativeDiagnosticLogging.isScenarioEnabled(.nativeAppModal)",
    );
    expect(appDelegateSource).toContain(
      'AppDelegate.appendAppModalDebugLog(\n        event: "nativeBridge.appModal.open.received"',
    );
    expect(appDelegateSource).toContain(
      'AppDelegate.appendAppModalDebugLog(\n        event: "nativeBridge.appModal.nativeWindow.ready"',
    );
    expect(appDelegateSource).toContain(
      'AppDelegate.appendAppModalDebugLog(\n        event: "nativeBridge.appModal.nativeWindow.presented"',
    );
    expect(appDelegateSource).toContain('"nativeWindow.webView.loadStart"');
    expect(appDelegateSource).toContain('"nativeWindow.webView.didFinish"');
    expect(appDelegateSource).toContain('"nativeWindow.hostReady"');
    expect(appDelegateSource).toContain('"nativeWindow.present.completed"');

    const nativeSettingsDispatchLog = sourceBetween(
      appDelegateSource,
      "if isSettingsModalMessage {",
      "guard JSONSerialization.isValidJSONObject(deliveryMessage)",
    );
    expect(nativeSettingsDispatchLog).toContain('"messageModal"');
    expect(nativeSettingsDispatchLog).toContain('"messageType"');
    expect(nativeSettingsDispatchLog).toContain('"hasInlineSidebarStateMessage"');
    expect(nativeSettingsDispatchLog).toContain('"requestId"');
    expect(nativeSettingsDispatchLog).not.toContain('message["projectPath"]');
    expect(nativeSettingsDispatchLog).not.toContain('message["projectName"]');
    expect(nativeSettingsDispatchLog).not.toContain('message["initialSearchQuery"]');
    expect(nativeSettingsDispatchLog).not.toContain('message["settings"]');
    expect(nativeSettingsDispatchLog).not.toContain('message["password"]');
    expect(appDelegateSource).toContain("private func messageForDispatch(_ message: [String: Any])");
    expect(appDelegateSource).toContain('deliveryMessage["latestSidebarStateMessage"] = sidebarStateMessage');

    const reactSettingsOpenLog = sourceBetween(
      modalHostSource,
      'postSettingsModalDebugLog("modalHost.settings.open.received"',
      "          }\n          if (message.modal === \"renameSession\")",
    );
    expect(modalHostSource).toContain("applySidebarStateMessage(message.latestSidebarStateMessage)");
    expect(modalHostSource).toContain("message.latestSidebarStateMessage !== undefined");
    expect(reactSettingsOpenLog).toContain("hasInlineSidebarStateMessage");
    expect(reactSettingsOpenLog).toContain("hasInitialSearchQuery");
    expect(reactSettingsOpenLog).toContain("hasInitialRemoteMachineId");
    expect(reactSettingsOpenLog).toContain("initialSection");
    expect(reactSettingsOpenLog).toContain("initialTab");
    expect(reactSettingsOpenLog).not.toContain("initialSearchQuery:");
    expect(reactSettingsOpenLog).not.toContain("initialRemoteMachineId:");
    expect(reactSettingsOpenLog).not.toContain("projectName");
    expect(reactSettingsOpenLog).not.toContain("projectPath");
    expect(reactSettingsOpenLog).not.toContain("password");

    const reactSettingsRenderStateLog = sourceBetween(
      modalHostSource,
      'postSettingsModalDebugLog("modalHost.settings.renderState"',
      "  });\n  }, [",
    );
    expect(reactSettingsRenderStateLog).toContain("hasSettingsInitialSearchQuery");
    expect(reactSettingsRenderStateLog).toContain("hasSettingsInitialRemoteMachineId");
    expect(reactSettingsRenderStateLog).toContain("settingsInitialTab");
    expect(reactSettingsRenderStateLog).not.toContain("settingsInitialSearchQuery:");
    expect(reactSettingsRenderStateLog).not.toContain("settingsInitialRemoteMachineId:");
    expect(reactSettingsRenderStateLog).not.toContain("settings:");
    expect(reactSettingsRenderStateLog).not.toContain("projectName");
    expect(reactSettingsRenderStateLog).not.toContain("projectPath");
    expect(reactSettingsRenderStateLog).not.toContain("password");

    const reactSettingsPresentedPayload = sourceBetween(
      modalHostSource,
      "latestSettingsPresentedLogDetailsRef.current = {",
      "  };\n\n  useEffect(() => {",
    );
    expect(reactSettingsPresentedPayload).toContain("hasSettingsInitialSearchQuery");
    expect(reactSettingsPresentedPayload).toContain("hasSettingsInitialRemoteMachineId");
    expect(reactSettingsPresentedPayload).toContain("settingsInitialTab");
    expect(reactSettingsPresentedPayload).not.toContain("settingsInitialSearchQuery:");
    expect(reactSettingsPresentedPayload).not.toContain("settingsInitialRemoteMachineId:");
    expect(reactSettingsPresentedPayload).not.toContain("settings:");
    expect(reactSettingsPresentedPayload).not.toContain("projectName");
    expect(reactSettingsPresentedPayload).not.toContain("projectPath");
    expect(reactSettingsPresentedPayload).not.toContain("password");

    const reactSetupOpenLog = sourceBetween(
      modalHostSource,
      'postAppModalDebugLog("modalHost.setup.open.received"',
      "          }\n          if (message.modal === \"renameSession\")",
    );
    expect(reactSetupOpenLog).toContain("hasInlineSidebarStateMessage");
    expect(reactSetupOpenLog).toContain("hasNativeSettingsHydrated");
    expect(reactSetupOpenLog).toContain("inlineSidebarStateApplied");
    expect(reactSetupOpenLog).toContain("revision");
    expect(reactSetupOpenLog).not.toContain("initialSearchQuery:");
    expect(reactSetupOpenLog).not.toContain("initialRemoteMachineId:");
    expect(reactSetupOpenLog).not.toContain("projectName");
    expect(reactSetupOpenLog).not.toContain("projectPath");
    expect(reactSetupOpenLog).not.toContain("password");

    const reactSetupRenderStateLog = sourceBetween(
      modalHostSource,
      'postAppModalDebugLog("modalHost.setup.renderState"',
      "  }, [\n    activeModal,",
    );
    expect(reactSetupRenderStateLog).toContain("hasNativeSettingsHydrated");
    expect(reactSetupRenderStateLog).toContain("isFirstLaunchSetupRenderable");
    expect(reactSetupRenderStateLog).toContain("isActiveModalRenderable");
    expect(reactSetupRenderStateLog).not.toContain("settings:");
    expect(reactSetupRenderStateLog).not.toContain("projectName");
    expect(reactSetupRenderStateLog).not.toContain("projectPath");
    expect(reactSetupRenderStateLog).not.toContain("password");

    const reactSetupPresentedPayload = sourceBetween(
      modalHostSource,
      "latestFirstLaunchSetupPresentedLogDetailsRef.current = {",
      "  };\n\n  useEffect(() => {\n    if (!isSettingsModalKind(activeModal))",
    );
    expect(reactSetupPresentedPayload).toContain("isFirstLaunchSetupRenderable");
    expect(reactSetupPresentedPayload).toContain("isActiveModalRenderable");
    expect(reactSetupPresentedPayload).not.toContain("settings:");
    expect(reactSetupPresentedPayload).not.toContain("projectName");
    expect(reactSetupPresentedPayload).not.toContain("projectPath");
    expect(reactSetupPresentedPayload).not.toContain("password");

    const reactPresentedEffect = sourceBetween(
      modalHostSource,
      "useLayoutEffect(() => {",
      "  useEffect(() => {\n    if (activeModal !== \"settings\")",
    );
    expect(modalHostSource).toContain("(!isSettingsModal || isSettingsRenderable)");
    expect(reactPresentedEffect).toContain("latestSettingsPresentedLogDetailsRef.current");
    expect(reactPresentedEffect).toContain("latestFirstLaunchSetupPresentedLogDetailsRef.current");
    expect(reactPresentedEffect).toContain("modalHost.setup.presented.sent");
    expect(reactPresentedEffect).toContain(
      "[activeModal, activeModalRequestId, floatingPromptEditor?.requestId, isActiveModalRenderable]",
    );
    expect(reactPresentedEffect).not.toContain("revision,\n");

    const gpuiReadyTimeout = sourceBetween(
      gpuiMainSource,
      "fn schedule_gpui_app_modal_ready_timeout(",
      "fn clear_lost_gpui_app_modal_window_handle",
    );
    expect(gpuiMainSource).toContain("const APP_MODAL_HOST_READY_TIMEOUT: Duration = Duration::from_secs(3);");
    expect(gpuiReadyTimeout).toContain("window.ready.timeout");
    expect(gpuiReadyTimeout).toContain("window.ready.timeout.retry");
    expect(gpuiReadyTimeout).toContain("window.ready.timeout.final");
    expect(gpuiReadyTimeout).toContain("self.open_gpui_app_modal_window_inner(");
    expect(gpuiReadyTimeout).toContain("self.remove_gpui_app_modal_window_without_focus_restore(cx);");
    expect(gpuiReadyTimeout).not.toContain("projectName");
    expect(gpuiReadyTimeout).not.toContain("projectPath");
    expect(gpuiReadyTimeout).not.toContain("initialSearchQuery");
    expect(gpuiReadyTimeout).not.toContain("settings:");

    const gpuiLifecycleReceiver = sourceBetween(
      gpuiMainSource,
      "fn receive_app_modal_host_bridge_event(",
      "fn finish_gpui_remote_machine_password_save",
    );
    expect(gpuiLifecycleReceiver).toContain("cef::AppModalHostBridgeEvent::Lifecycle(event)");
    expect(gpuiLifecycleReceiver).toContain("event.kind.log_event_name()");
    expect(gpuiLifecycleReceiver).toContain("isMainFrame");
    expect(gpuiLifecycleReceiver).toContain("httpStatusCode");
    expect(gpuiLifecycleReceiver).toContain("errorCode");
    expect(gpuiLifecycleReceiver).not.toContain("frame_url");
    expect(gpuiLifecycleReceiver).not.toContain("pageTitle");
    expect(gpuiLifecycleReceiver).not.toContain("projectPath");

    const gpuiLogBoolKeys = sourceBetween(
      gpuiMainSource,
      "const GPUI_APP_MODAL_DEBUG_BOOL_KEYS",
      "const GPUI_APP_MODAL_DEBUG_NUMBER_KEYS",
    );
    const gpuiLogNumberKeys = sourceBetween(
      gpuiMainSource,
      "const GPUI_APP_MODAL_DEBUG_NUMBER_KEYS",
      "const GPUI_APP_MODAL_DEBUG_ENUM_KEYS",
    );
    expect(gpuiLogBoolKeys).toContain('"isMainFrame"');
    expect(gpuiLogBoolKeys).toContain('"retryUsed"');
    expect(gpuiLogNumberKeys).toContain('"httpStatusCode"');
    expect(gpuiLogNumberKeys).toContain('"errorCode"');
    expect(gpuiLogBoolKeys).not.toContain("url");
    expect(gpuiLogBoolKeys).not.toContain("path");
    expect(gpuiLogNumberKeys).not.toContain("url");
    expect(gpuiLogNumberKeys).not.toContain("path");

    expect(gpuiCefMacosSource).toContain("pub enum AppModalHostBridgeSurface");
    expect(gpuiCefMacosSource).toContain("APP_MODAL_HOST_BRIDGE_SURFACE_EXTRA_INFO_KEY");
    expect(gpuiCefMacosSource).toContain("APP_MODAL_HOST_LIFECYCLE_PROCESS_MESSAGE_NAME");
    expect(gpuiCefMacosSource).toContain("GhostexGpuiAppModalHostLoadHandler");
    expect(gpuiCefMacosSource).toContain("fn on_load_start(");
    expect(gpuiCefMacosSource).toContain("fn on_load_end(");
    expect(gpuiCefMacosSource).toContain("fn on_load_error(");
    expect(gpuiCefMacosSource).toContain("AppModalHostLifecycleEventKind::BridgePostMessageCalled");
    expect(gpuiCefMacosSource).toContain("app_modal_host_bridge_surface_from_extra_info(extra_info)");
    expect(gpuiCefMacosSource).not.toContain("failed_url.map");
    expect(gpuiCefMacosSource).not.toContain("error_text.map");
  });

  test("logs first-launch setup slow-open diagnostics without private payloads", () => {
    /*
    CDXC:FirstLaunchSetupDiagnostics 2026-06-29-22:08:
    Setup slow-open repros need app-modal-debug.log checkpoints for native
    open/WebView/ready/dispatch/present and React open/renderability/presented
    without logging settings values, project names, paths, URLs, command text,
    user text, or secrets.
    */
    const settingsWindowLogger = sourceBetween(
      appDelegateSource,
      "private func logSettingsWindowEvent(",
      "private func defaultSize(for modal: String)",
    );
    expect(settingsWindowLogger).toContain("CDXC:FirstLaunchSetupDiagnostics 2026-06-29-22:08:");
    expect(settingsWindowLogger).toContain("isFirstLaunchSetupAppModal(loadedModal)");
    expect(settingsWindowLogger).toContain("AppDelegate.appendAppModalDebugLog");
    expect(appDelegateSource).toContain(
      'AppDelegate.appendAppModalDebugLog(event: "nativeBridge.appModal.\\(event)", details: details)',
    );
    expect(appDelegateSource).toContain(
      'AppDelegate.appendAppModalDebugLog(\n        event: "nativeBridge.appModal.open.received"',
    );
    expect(appDelegateSource).toContain(
      'AppDelegate.appendAppModalDebugLog(\n        event: "nativeBridge.appModal.nativeWindow.ready"',
    );
    expect(appDelegateSource).toContain(
      'AppDelegate.appendAppModalDebugLog(\n        event: "nativeBridge.appModal.nativeWindow.presented"',
    );
    expect(appDelegateSource).toContain('"nativeWindow.webView.loadStart"');
    expect(appDelegateSource).toContain('"nativeWindow.webView.didFinish"');
    expect(appDelegateSource).toContain('"nativeWindow.hostReady"');
    expect(appDelegateSource).toContain('"nativeWindow.present.completed"');

    const reactSetupOpenLog = sourceBetween(
      modalHostSource,
      'postAppModalDebugLog("modalHost.setup.open.received"',
      "          }\n          if (message.modal === \"renameSession\")",
    );
    expect(reactSetupOpenLog).toContain("hasInlineSidebarStateMessage");
    expect(reactSetupOpenLog).toContain("hasNativeSettingsHydrated");
    expect(reactSetupOpenLog).toContain("inlineSidebarStateApplied");
    expect(reactSetupOpenLog).toContain("revision");
    expect(reactSetupOpenLog).not.toContain("initialSearchQuery:");
    expect(reactSetupOpenLog).not.toContain("projectName");
    expect(reactSetupOpenLog).not.toContain("projectPath");
    expect(reactSetupOpenLog).not.toContain("password");

    const reactSetupRenderStateLog = sourceBetween(
      modalHostSource,
      'postAppModalDebugLog("modalHost.setup.renderState"',
      "  }, [\n    activeModal,",
    );
    expect(reactSetupRenderStateLog).toContain("hasNativeSettingsHydrated");
    expect(reactSetupRenderStateLog).toContain("isFirstLaunchSetupRenderable");
    expect(reactSetupRenderStateLog).toContain("isActiveModalRenderable");
    expect(reactSetupRenderStateLog).not.toContain("settings:");
    expect(reactSetupRenderStateLog).not.toContain("projectName");
    expect(reactSetupRenderStateLog).not.toContain("projectPath");
    expect(reactSetupRenderStateLog).not.toContain("password");

    const reactPresentedEffect = sourceBetween(
      modalHostSource,
      "useLayoutEffect(() => {",
      "  useEffect(() => {\n    if (activeModal !== \"settings\")",
    );
    expect(reactPresentedEffect).toContain("latestFirstLaunchSetupPresentedLogDetailsRef.current");
    expect(reactPresentedEffect).toContain("modalHost.setup.presented.sent");
    expect(reactPresentedEffect).not.toContain("revision,\n");
  });

  test("keeps remote gxserver install approval state renderable", () => {
    /*
    CDXC:RemoteMachines 2026-06-23-08:30:
    When an SSH-reachable Ubuntu or macOS remote is missing gxserver, the
    Remote Settings flow must open the approval modal with its Install
    gxserver button instead of clearing modal state after the warning toast.
    */
    const installOpenBranch = sourceBetween(
      modalHostSource,
      '} else if (message.modal === "remoteGxserverInstall") {',
      '} else if (message.modal === "remoteProjectPicker") {',
    );
    const remoteSettingsTab = sourceBetween(
      settingsModalSource,
      "function RemoteSettingsTab({",
      "function RemoteMachineFields({",
    );
    expect(remoteSettingsTab).toContain("Install / Connect gxserver");
    expect(remoteSettingsTab).toContain('type: "reconnectRemoteMachine"');
    expect(installOpenBranch).toContain("setRemoteGxserverInstall({");
    expect(installOpenBranch).not.toContain("setRemoteGxserverInstall(undefined);");
    expect(modalHostSource).toContain("<RemoteGxserverInstallModal");
    expect(modalHostSource).toContain('type: "reconnectRemoteMachine"');
  });

  test("shows create-time remote passwords without storing raw settings data", () => {
    /*
    CDXC:RemoteMachines 2026-06-24-10:40:
    The Add remote machine card should render the password row like saved
    machine cards so the new and created cards stay the same height. Passwords
    entered before Add Machine must still use the one-shot Keychain command and
    must not be normalized into Remote machine settings.
    */
    const remoteSettingsTab = sourceBetween(
      settingsModalSource,
      "function RemoteSettingsTab({",
      "function RemoteMachineFields({",
    );
    const addRemoteMachine = sourceBetween(
      settingsModalSource,
      "  const addRemoteMachine = () => {",
      "  const removeRemoteMachine =",
    );
    const postPasswordSave = sourceBetween(
      settingsModalSource,
      "  const postRemoteMachinePasswordSave = (remoteMachineId: string, password: string) => {",
      "  const saveRemoteMachinePassword =",
    );
    const remoteMachineFields = sourceBetween(
      settingsModalSource,
      "function RemoteMachineFields({",
      "function normalizeRemoteMachineDraft(",
    );
    const remoteMachineHeaderStyles = sourceBetween(
      modalStylesSource,
      ".settings-remote-machine-summary {",
      ".settings-remote-machine-body {",
    );
    const normalizeDraft = sourceBetween(
      settingsModalSource,
      "function normalizeRemoteMachineDraft(",
      "function formatRemoteMachineSshTarget(",
    );

    expect(remoteSettingsTab).not.toContain("hidePasswordField");
    expect(remoteSettingsTab).toContain("New SSH machine");
    expect(remoteSettingsTab).toContain(
      'passwordDescription="Passwords are stored in macOS Keychain. Leave blank to add the machine without a saved password."',
    );
    expect(addRemoteMachine).toContain("const machineId =");
    expect(addRemoteMachine).toContain("const password = newMachine.sshPassword;");
    expect(addRemoteMachine).toContain("postRemoteMachinePasswordSave(machine.id, password);");
    expect(addRemoteMachine).toContain("setNewMachine(createRemoteMachineDraft());");
    expect(postPasswordSave).toContain('type: "saveRemoteMachinePassword"');
    expect(postPasswordSave).toContain("remoteMachineId,");
    expect(remoteMachineFields).toContain(">Password</FieldLabel>");
    expect(remoteMachineFields).toContain("settings-remote-machine-password-row-single");
    expect(remoteMachineFields).not.toContain("hidePasswordField");
    expect(remoteMachineHeaderStyles).toContain(".settings-remote-machine-add-summary");
    expect(remoteMachineHeaderStyles).toContain("padding-block: 10px;");
    expect(remoteMachineHeaderStyles).toContain(".settings-remote-machine-add-icon");
    expect(remoteMachineHeaderStyles).toContain("height: 36px;");
    expect(remoteMachineHeaderStyles).toContain("width: 36px;");
    expect(normalizeDraft).not.toContain("sshPassword:");
  });

  test("sizes remote setup modals to their compact native content", () => {
    /*
    CDXC:RemoteMachines 2026-06-24-10:43:
    The remote gxserver approval modal and Add Remote Project picker should fit
    their React content instead of inheriting generic app-modal padding from all
    four sides. Keep their native child windows locked to compact content sizes
    and center the picker command surface inside the smaller frame.
    */
    const defaultSize = sourceBetween(
      appDelegateSource,
      "private func defaultSize(for modal: String) -> CGSize",
      "private func constrainedSize(_ size: CGSize, parentWindow: NSWindow) -> CGSize",
    );
    expect(defaultSize).toContain('case "remoteGxserverInstall":');
    expect(defaultSize).toContain("return CGSize(width: 520, height: 340)");
    expect(defaultSize).toContain('case "remoteProjectPicker":');
    expect(defaultSize).toContain("return CGSize(width: 480, height: 260)");
    expect(defaultSize).toContain('case "scratchPad":');
    expect(defaultSize).not.toContain('case "scratchPad", "addRepository", "remoteProjectPicker":');

    const shouldLockContentSize = sourceBetween(
      appDelegateSource,
      "private func shouldLockContentSize(modal: String) -> Bool",
      "private func minimumContentSize(for modal: String?) -> CGSize",
    );
    expect(shouldLockContentSize).toContain('|| modal == "remoteGxserverInstall"');
    expect(shouldLockContentSize).toContain('|| modal == "remoteProjectPicker"');

    const minimumContentSize = sourceBetween(
      appDelegateSource,
      "private func minimumContentSize(for modal: String?) -> CGSize",
      "private func maximumContentSize(for modal: String?) -> CGSize?",
    );
    expect(minimumContentSize).toContain('case "remoteGxserverInstall":');
    expect(minimumContentSize).toContain("return CGSize(width: 520, height: 340)");
    expect(minimumContentSize).toContain('case "remoteProjectPicker":');
    expect(minimumContentSize).toContain("return CGSize(width: 480, height: 260)");

    const remoteProjectPickerRule = sourceBetween(
      modalStylesSource,
      ".remote-project-picker-dialog {",
      "/*\n * CDXC:SettingsRoundness",
    );
    expect(remoteProjectPickerRule).toContain("top: 50% !important;");
    expect(remoteProjectPickerRule).toContain("translate: -50% -50% !important;");
    expect(remoteProjectPickerModalSource).toContain(
      'className="remote-project-picker-dialog max-w-2xl"',
    );
  });

  test("keeps Clone Repository fields from overlapping in native validation states", () => {
    /*
    CDXC:AddRepository 2026-06-24-10:35:
    Clone Repository must have enough native child-window height for the branch
    row, remote folder help, and inline clone errors. It may reuse Rename Session
    chrome, but it must not reuse Rename Session's first-field shrink behavior
    because that can overlap repository validation text with the folder row.
    */
    const defaultSize = sourceBetween(
      appDelegateSource,
      "private func defaultSize(for modal: String) -> CGSize",
      "private func constrainedSize(_ size: CGSize, parentWindow: NSWindow) -> CGSize",
    );
    expect(defaultSize).toContain('case "scratchPad":');
    expect(defaultSize).toContain("return CGSize(width: 760, height: 640)");
    expect(defaultSize).toContain('case "addRepository":');
    expect(defaultSize).toContain("return CGSize(width: 760, height: 760)");
    expect(defaultSize).not.toContain('case "scratchPad", "addRepository":');

    const addRepositoryStyles = sourceBetween(
      modalStylesSource,
      ".add-repository-modal-shadcn {",
      ".worktree-create-modal-shadcn {",
    );
    expect(addRepositoryStyles).toContain(
      ".app-modal-host-native-window-body .add-repository-modal-shadcn .session-rename-field-group",
    );
    expect(addRepositoryStyles).toContain("overflow-y: auto;");
    expect(addRepositoryStyles).toContain(
      ".add-repository-modal-shadcn\n  .session-rename-field-group\n  > [data-slot=\"field\"]:first-child",
    );
    expect(addRepositoryStyles).toContain("flex: 0 0 auto;");
    expect(addRepositoryStyles).toContain("min-height: auto;");
  });

  test("probes remote gxserver install target before choosing the package", () => {
    /*
    CDXC:RemoteMachines 2026-06-23-09:46:
    First-time Ubuntu install must not upload the local macOS gxserver bundle.
    Native probes the remote OS/CPU and selects a matching package resource,
    while React has a distinct unsupported-package message when no match exists.
    */
    const approvedInstallBranch = sourceBetween(
      remoteGxserverClientSource,
      "if command.installApproved == true {",
      "if installResult.exitCode != 0 {",
    );
    expect(approvedInstallBranch).toContain("probeRemoteInstallTarget");
    expect(approvedInstallBranch).toContain("bundledGxserverPackageURL(for: installTarget)");
    expect(approvedInstallBranch).toContain('state: "unsupportedRemotePlatform"');
    expect(remoteGxserverClientSource).toContain("uname -s");
    expect(remoteGxserverClientSource).toContain("uname -m");
    expect(remoteGxserverClientSource).toContain("Web/gxserver-linux-x64");
    expect(remoteGxserverClientSource).toContain("Web/gxserver-linux-arm64");
    expect(remoteGxserverClientSource).toContain("Web/gxserver-darwin-arm64");
    expect(remoteGxserverClientSource).toContain("bundledGxserverPackageIsCompatible");
    expect(remoteGxserverClientSource).toContain("isMachOBinary");
    expect(remoteGxserverClientSource).toContain("isELFBinary");
    expect(remoteGxserverClientSource).toContain("expectedELFMachine");
    expect(remoteGxserverClientSource).toContain("code-server/lib/node");
    expect(remoteGxserverClientSource).toContain("portless/dist/cli.js");
    expect(remoteGxserverClientSource).toContain("CLI/ghostex-cli.mjs");
    expect(remoteGxserverClientSource).toContain("$HOME/.local/bin/ghostex");
    expect(remoteGxserverClientSource).toContain("$HOME/.local/bin/gx");
    expect(remoteGxserverClientSource).toContain("gxserver zmx zehn bd ghostex-tui");
    expect(remoteGxserverClientSource).toContain("if [ -f \"$package_link/bin/ghostex\" ]; then");
    expect(remoteGxserverClientSource).toContain("chmod 755 \"$package_link/bin/ghostex\"");
    expect(remoteGxserverClientSource).toContain('while [ -L "$SOURCE" ]; do');
    expect(remoteGxserverClientSource).toContain('SOURCE_TARGET="$(readlink "$SOURCE")"');
    expect(remoteGxserverClientSource).toContain("COPYFILE_DISABLE");
    expect(remoteGxserverClientSource).toContain("package.backup.");
    expect(remoteGxserverClientSource).toContain("releases/\\(releaseId)");
    expect(remoteGxserverClientSource).toContain("ghostex_remote_stop_existing_gxserver");
    expect(remoteGxserverClientSource).toContain("ss -ltnp");
    expect(remoteGxserverClientSource).toContain("lsof -nP -iTCP:$ghostex_remote_gxserver_port");
    expect(remoteGxserverClientSource).toContain("kill -TERM");
    expect(remoteGxserverClientSource).toContain("kill -KILL");
    expect(remoteGxserverClientSource).toContain(".ghostex/gxserver/");
    expect(remoteGxserverClientSource).not.toContain("rm -rf");
    expect(remoteGxserverClientSource).not.toContain("command -v gxserver");
    expect(remoteGxserverInstallModalSource).toContain("compatible bundled remote package");
    expect(remoteGxserverInstallModalSource).toContain("<code>zmx</code>");
    expect(remoteGxserverInstallModalSource).toContain("<code>ghostex</code>");
    expect(buildGhostexHostSource).toContain("GHOSTEX_REMOTE_GXSERVER_LINUX_X64_PACKAGE");
    expect(buildGhostexHostSource).toContain("GHOSTEX_REMOTE_GXSERVER_LINUX_X64_DEFAULT_PACKAGE");
    expect(buildGhostexHostSource).toContain("build/remote-gxserver-linux/x64/package");
    expect(buildGhostexHostSource).toContain("stage_remote_gxserver_linux_packages_if_configured");
    expect(buildGhostexHostSource).toContain("validate_remote_gxserver_linux_package");
    expect(buildGhostexHostSource).toContain("gxserver-linux-x64");
    expect(buildGhostexHostSource).toContain("Linux packages must not ship Mach-O payloads");
    expect(buildGhostexHostSource).toContain("native Linux ELF payload");
    expect(buildGhostexHostSource).toContain("wrong Linux ELF architecture");
    expect(buildGhostexHostSource).toContain("bin/ghostex-tui");
    expect(remoteGxserverLinuxPackageScriptSource).toContain("Usage: node gxserver-rs/package-remote-linux.mjs");
    expect(remoteGxserverLinuxPackageScriptSource).toContain("--arch x64|arm64|all");
    expect(remoteGxserverLinuxPackageScriptSource).toContain('requestedArch === "all"');
    expect(remoteGxserverLinuxPackageScriptSource).toContain('["x64", "arm64"]');
    expect(remoteGxserverLinuxPackageScriptSource).toContain("build/remote-gxserver-linux");
    expect(remoteGxserverLinuxPackageScriptSource).toContain("bin/gxserver");
    expect(remoteGxserverLinuxPackageScriptSource).toContain("bin/zmx");
    expect(remoteGxserverLinuxPackageScriptSource).toContain("bin/zehn");
    expect(remoteGxserverLinuxPackageScriptSource).toContain("bin/bd");
    expect(remoteGxserverLinuxPackageScriptSource).toContain("bin/ghostex-tui");
    expect(remoteGxserverLinuxPackageScriptSource).toContain("--tui-bin <path>");
    expect(remoteGxserverLinuxPackageScriptSource).toContain("code-server/lib/node");
    expect(remoteGxserverLinuxPackageScriptSource).toContain("portless/dist/cli.js");
    expect(remoteGxserverLinuxPackageScriptSource).toContain("CLI/ghostex-cli.mjs");
    expect(remoteGxserverLinuxPackageScriptSource).toContain("Linux remote package expected an ELF binary");
    expect(remoteGxserverLinuxPackageScriptSource).toContain("Linux remote package expected ${config.arch} ELF architecture");
    expect(packageJsonSource).toContain('"gxserver:remote-linux": "node gxserver-rs/package-remote-linux.mjs --arch all"');
    expect(packageJsonSource).toContain('"gxserver:remote-linux:x64": "node gxserver-rs/package-remote-linux.mjs --arch x64"');
    expect(packageJsonSource).toContain('"gxserver:remote-linux:arm64": "node gxserver-rs/package-remote-linux.mjs --arch arm64"');
    expect(nativeSidebarSource).toContain('case "unsupportedRemotePlatform":');
    expect(nativeSidebarSource).toContain("No compatible gxserver package");
  });

  test("keeps Add Worktree fixed at 570x574 with exact native-window padding", () => {
    /*
    CDXC:WorktreeModal 2026-06-12-10:51:
    Add Worktree must open as an exact 570x550 native child window in the macOS app, separate from the larger Git Commit review modal size.

    CDXC:WorktreeModal 2026-06-12-11:10:
    Add Worktree must keep the 570px fixed width and own its native child-window WebView padding directly.

    CDXC:WorktreeModal 2026-06-13-18:39:
    Add Worktree must use the same top-right shadcn close X pattern as Rename Session, remove the footer Cancel button, use 17px native-window edge padding, and fit the shorter footer stack into a 570x574 child window.

    */
    const defaultSize = sourceBetween(
      appDelegateSource,
      "private func defaultSize(for modal: String) -> CGSize",
      "private func constrainedSize(_ size: CGSize, parentWindow: NSWindow) -> CGSize",
    );
    expect(defaultSize).toContain('case "gitCommit":');
    expect(defaultSize).toContain("return CGSize(width: 1020, height: 760)");
    expect(defaultSize).toContain('case "worktree":');
    expect(defaultSize).toContain("return CGSize(width: 570, height: 574)");

    const shouldLockContentSize = sourceBetween(
      appDelegateSource,
      "private func shouldLockContentSize(modal: String) -> Bool",
      "private func minimumContentSize(for modal: String?) -> CGSize",
    );
    expect(shouldLockContentSize).toContain('|| modal == "worktree"');

    const worktreeStyles = sourceBetween(
      modalStylesSource,
      ".worktree-create-modal-shadcn {",
      ".delayed-send-modal-shadcn {",
    );
    expect(worktreeStyles).toContain(
      ".app-modal-host-native-window-body .worktree-create-modal-shadcn",
    );
    expect(worktreeStyles).toContain("height: 100vh;");
    expect(worktreeStyles).toContain("max-height: 100vh;");
    expect(worktreeStyles).toContain("max-width: 100vw;");
    expect(worktreeStyles).toContain("padding: 17px;");
    expect(worktreeStyles).toContain("width: 100vw;");
    expect(worktreeStyles).toContain(
      '.app-modal-host-native-window-body .worktree-create-modal-shadcn [data-slot="dialog-close"]',
    );
    expect(worktreeStyles).toContain("right: 17px;");
    expect(worktreeStyles).toContain("top: 17px;");

    const worktreeDialogContent = sourceBetween(
      worktreeCreateModalSource,
      "<DialogContent",
      "<form",
    );
    expect(worktreeDialogContent).toContain("showCloseButton");
    expect(worktreeDialogContent).toContain("initialFocus={focusInput}");

    const worktreeFooter = sourceBetween(
      worktreeCreateModalSource,
      "<DialogFooter>",
      "</DialogFooter>",
    );
    expect(worktreeFooter).not.toContain("Cancel");

    /*
    CDXC:WorktreeBaseBranch 2026-06-24-11:32:
    Add Worktree Create New mode must expose a required base-branch selector
    and carry the selected branch through the native modal bridge.
    */
    expect(worktreeCreateModalSource).toContain('export type WorktreeBaseBranchOption = {');
    expect(worktreeCreateModalSource).toContain('htmlFor={baseBranchId}>Base branch');
    expect(worktreeCreateModalSource).toContain('className="worktree-create-base-branch-select"');
    expect(modalStylesSource).toContain(".worktree-create-base-branch-select");
    expect(worktreeCreateModalSource).toContain("selectedAgentId && selectedBaseBranch");
    expect(worktreeCreateModalSource).toContain("normalizeWorktreeBaseBranchOptions(result.branches)");
    expect(modalHostSource).toContain(
      "baseBranch: draft.mode === \"create\" ? draft.baseBranch : undefined",
    );
    expect(nativeSidebarSource).toContain('action: "listBranches"');
    expect(nativeSidebarSource).toContain("baseRef: baseBranch");
  });

  test("retries Add Worktree first-prompt focus across native child-window focus", () => {
    /*
    CDXC:WorktreeModal 2026-06-15-11:30:
    Add Worktree is presented from the hidden native app-modal host. Source
    coverage keeps the first-prompt textarea focused for immediate typing,
    retries across native window activation, and preserves user interaction by
    stopping delayed focus after the user clicks or types in the modal.
    */
    expect(worktreeCreateModalSource).toContain("userInteractedAfterOpenRef.current = false;");
    expect(worktreeCreateModalSource).toContain("input.focus({ preventScroll: true });");
    expect(worktreeCreateModalSource).toContain(
      "input.setSelectionRange(selectionIndex, selectionIndex);",
    );
    expect(worktreeCreateModalSource).toContain(
      "const retryDelaysMs = [0, 16, 50, 100, 250, 500, 1000, 1600, 2400];",
    );
    expect(worktreeCreateModalSource).toContain('window.addEventListener("focus", handleWindowFocus);');
    expect(worktreeCreateModalSource).toContain(
      'window.removeEventListener("focus", handleWindowFocus);',
    );
    expect(worktreeCreateModalSource).toContain("onKeyDownCapture={markUserInteractedAfterOpen}");
    expect(worktreeCreateModalSource).toContain("onPointerDownCapture={markUserInteractedAfterOpen}");

    const enterHandler = sourceBetween(
      worktreeCreateModalSource,
      "const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {",
      "const handlePaste =",
    );
    expect(enterHandler).toContain('event.key !== "Enter"');
    expect(enterHandler).toContain("event.preventDefault();");
    expect(enterHandler).toContain("event.stopPropagation();");
    expect(enterHandler).toContain("createDraft(");
  });

  test("uses Settings search focus treatment for modal text controls", () => {
    /*
    CDXC:ModalTextFocus 2026-06-15-11:30:
    Editable text fields and textareas in app modals should use the same focus
    look as Settings search: white input border, no outer shadcn focus ring.

    CDXC:ModalTextFocus 2026-06-16-14:33:
    Settings text controls now share the Settings search focus token instead of
    hard-coding white, so theme tuning can change one variable without
    reintroducing the outer shadcn ring.
    */
    const modalTextFocusStyles = sourceBetween(
      modalStylesSource,
      '.command-config-modal-shadcn [data-slot="input"]:is(:focus, :focus-visible),',
      ".command-config-textarea-shadcn {",
    );
    expect(modalTextFocusStyles).toContain(
      '.command-config-modal-shadcn [data-slot="textarea"]:is(:focus, :focus-visible)',
    );
    expect(modalTextFocusStyles).toContain("border-color: #fff;");
    expect(modalTextFocusStyles).toContain("box-shadow: none;");
    expect(modalTextFocusStyles).toContain("outline: none;");

    const settingsTextFocusStyles = sourceBetween(
      sidebarStylesSource,
      '.ghostex-settings-shadcn [data-slot="input"]:is(:focus, :focus-visible),',
      ".ghostex-settings-shadcn .settings-modal-search-toolbar .session-search-input-icon",
    );
    expect(settingsTextFocusStyles).toContain(
      '.ghostex-settings-shadcn [data-slot="textarea"]:is(:focus, :focus-visible)',
    );
    expect(settingsTextFocusStyles).toContain("border-color: var(--settings-focus-border-color);");
    expect(settingsTextFocusStyles).toContain("box-shadow: none;");
    expect(settingsTextFocusStyles).toContain("outline: none;");
  });

  test("widens Git Commit 20px from the right side in the macOS app", () => {
    /*
    CDXC:TitlebarGit 2026-06-12-11:30:
    Git Commit review must be 20px wider than its prior 1000px native child window, with the old left edge preserved so the added width appears on the right diff side.
    */
    const defaultSize = sourceBetween(
      appDelegateSource,
      "private func defaultSize(for modal: String) -> CGSize",
      "private func constrainedSize(_ size: CGSize, parentWindow: NSWindow) -> CGSize",
    );
    expect(defaultSize).toContain('case "gitCommit":');
    expect(defaultSize).toContain("return CGSize(width: 1020, height: 760)");

    const gitCommitFrame = sourceBetween(
      appDelegateSource,
      "private func gitCommitContentFrame(size: CGSize, parentWindow: NSWindow) -> CGRect",
      "private func clampFrameToVisibleScreen",
    );
    expect(gitCommitFrame).toContain("let previousCenteredWidth: CGFloat = 1000");
    expect(gitCommitFrame).toContain("x: parentWindow.frame.midX - previousCenteredWidth / 2");

    const constrainedContentFrame = sourceBetween(
      appDelegateSource,
      "private func constrainedContentFrame(",
      "private func shouldLockContentSize(modal: String) -> Bool",
    );
    expect(constrainedContentFrame).toContain('if modal == "gitCommit"');
    expect(constrainedContentFrame).toContain(
      "return gitCommitContentFrame(size: size, parentWindow: parentWindow)",
    );
  });

  test("keeps Rename Session fixed at 570x480 in the macOS app", () => {
    /*
    CDXC:SidebarRename 2026-06-12-05:05:
    Rename Session must keep a 540px React dialog cap and 9px side padding so it is 20px wider while reducing left/right content padding by 15px.

    CDXC:SidebarRename 2026-06-12-06:35:
    Rename Session must keep its 570px width but gain 80px of native-window height, opening as 570x480 so the generated-name controls and bottom action area fit.
    */
    const defaultSize = sourceBetween(
      appDelegateSource,
      "private func defaultSize(for modal: String) -> CGSize",
      "private func constrainedSize(_ size: CGSize, parentWindow: NSWindow) -> CGSize",
    );
    expect(defaultSize).toContain('case "renameSession":');
    expect(defaultSize).toContain("return CGSize(width: 570, height: 480)");

    const shouldLockContentSize = sourceBetween(
      appDelegateSource,
      "private func shouldLockContentSize(modal: String) -> Bool",
      "private func minimumContentSize(for modal: String?) -> CGSize",
    );
    expect(shouldLockContentSize).toContain('modal == "previousSessions" || modal == "renameSession"');

    const renameStyles = sourceBetween(
      modalStylesSource,
      ".session-rename-modal-shadcn {",
      ".add-repository-modal-shadcn {",
    );
    expect(renameStyles).toContain("max-width: min(540px, calc(100vw - 2rem));");
    expect(renameStyles).toContain("padding-left: 9px;");
    expect(renameStyles).toContain("padding-right: 9px;");
  });

  test("routes unconfigured action setup to Settings Actions", () => {
    /*
    CDXC:ProjectActions 2026-06-15-15:29:
    The standalone Configure Action modal is removed. Empty or unconfigured
    action clicks should open Settings on the Actions page, which also explains
    that frequent commands can be run with one click or a hotkey.
    */
    expect(titlebarHostSource).toContain("openSidebarActionsSettings");
    expect(titlebarHostSource).toContain('initialTab: "actions"');
    expect(commandPaletteSource).toContain('initialTab: "actions"');
    expect(nativeSidebarSource).toContain("openNativeSidebarActionsSettings");
    expect(nativeSidebarSource).toContain('initialTab: "actions"');
    expect(settingsModalSource).toContain("Set frequently used terminal or browser commands here");
    expect(settingsModalSource).toContain("click or a hotkey.");
    expect(settingsModalSource).toContain("isSidebarCommandConfigured");
    expect(modalHostSource).not.toContain('"commandConfig"');
    expect(modalHostSource).not.toContain("CommandConfigModal");
    expect(titlebarHostSource).not.toContain('modal: "commandConfig"');
    expect(commandPaletteSource).not.toContain('modal: "commandConfig"');
    expect(nativeSidebarSource).not.toContain('modal: "commandConfig"');
  });

  test("lets Settings Actions editor delete default and custom actions", () => {
    /*
    CDXC:ActionsSettings 2026-06-18-10:11:
    Users can open default Actions such as Build or Test from Settings and must still be able to delete them from that edit surface. The Settings editor should route Delete through the same native deleteSidebarCommand path that records default-action removals in deletedDefaultCommandIds.
    */
    const actionEditorSource = sourceBetween(
      settingsModalSource,
      "function ActionSettingsEditor({",
      "function getSettingsCommandDraftTitle(",
    );
    expect(actionEditorSource).toContain("onDelete?: () => void");
    expect(actionEditorSource).toContain("variant=\"destructive\"");
    expect(actionEditorSource).toContain("<IconTrash aria-hidden=\"true\" data-icon=\"inline-start\" />");

    const actionsTabSource = sourceBetween(
      settingsModalSource,
      "function ActionsSettingsTab",
      "function SettingsCommandRow",
    );
    expect(actionsTabSource).toContain("const editorCommandId = editorState?.draft.commandId");
    expect(actionsTabSource).toContain("deleteCommand(editorCommandId)");
    expect(actionsTabSource).toContain('type: "deleteSidebarCommand"');

    const nativeDeleteSource = sourceBetween(
      nativeSidebarSource,
      "function deleteSidebarCommand(commandId: string): void",
      "function syncSidebarCommandOrder(",
    );
    expect(nativeDeleteSource).toContain("isDefaultSidebarCommandId(commandId)");
    expect(nativeDeleteSource).toContain("writeDeletedDefaultCommandIds");
  });

  test("keeps Delayed Send fixed at 472x336 in the macOS app", () => {
    /*
    CDXC:DelayedSend 2026-06-12-04:07:
    Delayed Send must open as a fixed compact macOS child window, including a matching modal-specific minimum because the shared app-modal minimum is larger than this timer dialog.

    CDXC:DelayedSend 2026-06-17-17:01:
    The fixed delayed-send child window needs 336px of height so the full React timer form is visible without scrolling after the seconds control was removed.
    */
    const defaultSize = sourceBetween(
      appDelegateSource,
      "private func defaultSize(for modal: String) -> CGSize",
      "private func constrainedSize(_ size: CGSize, parentWindow: NSWindow) -> CGSize",
    );
    expect(defaultSize).toContain('case "delayedSend":');
    expect(defaultSize).toContain("return CGSize(width: 472, height: 336)");

    const shouldLockContentSize = sourceBetween(
      appDelegateSource,
      "private func shouldLockContentSize(modal: String) -> Bool",
      "private func minimumContentSize(for modal: String?) -> CGSize",
    );
    expect(shouldLockContentSize).toContain(
      'modal == "previousSessions" || modal == "renameSession" || modal == "delayedSend"',
    );

    const minimumContentSize = sourceBetween(
      appDelegateSource,
      "private func minimumContentSize(for modal: String?) -> CGSize",
      "private func appModalStyleMask(for modal: String) -> NSWindow.StyleMask",
    );
    expect(minimumContentSize).toContain('case "delayedSend":');
    expect(minimumContentSize).toContain("return CGSize(width: 472, height: 336)");
  });

  test("keeps Delayed Send duration input to hours and minutes", () => {
    /*
    CDXC:DelayedSend 2026-06-16-17:57:
    Delayed Send should expose only hours and minutes. The modal must not render a seconds input, active timers should prefill by rounding up to whole minutes, and native must reject sub-minute or non-whole-minute bridge requests.
    */
    expect(delayedSendModalSource).toContain('aria-label="Hours"');
    expect(delayedSendModalSource).toContain('aria-label="Minutes"');
    expect(delayedSendModalSource).toContain("autoFocus");
    expect(delayedSendModalSource).toContain("focusMinutesInput");
    expect(delayedSendModalSource).toContain("scheduleMinutesFocus");
    expect(delayedSendModalSource).toContain("focus({ preventScroll: true })");
    expect(delayedSendModalSource).toContain("window.setTimeout(focusMinutesInput");
    expect(delayedSendModalSource).toContain("submitFromDurationInput");
    expect(delayedSendModalSource).toContain('event.key !== "Enter"');
    expect(delayedSendModalSource).not.toContain('aria-label="Seconds"');
    expect(delayedSendModalSource).not.toContain("setSeconds");
    expect(delayedSendModalSource).not.toContain("Enter a delay between 1 minute and 24 days.");
    expect(delayedSendModalSource).toContain('className="delayed-send-footer"');
    expect(delayedSendModalSource).toContain('className="delayed-send-cancel-row"');
    expect(delayedSendModalSource).toContain(
      'data-has-active-timer={hasActiveTimer ? "true" : "false"}',
    );
    expect(delayedSendModalSource).toContain("Math.ceil(delayMs / MINUTE_MS)");

    const durationGrid = sourceBetween(
      modalStylesSource,
      ".delayed-send-duration-grid {",
      ".session-rename-form",
    );
    expect(durationGrid).toContain("grid-template-columns: repeat(2, minmax(0, 1fr));");

    const nativeDelayedSendStyles = sourceBetween(
      modalStylesSource,
      ".app-modal-host-native-window-body .delayed-send-modal-shadcn {",
      ".delayed-send-form",
    );
    expect(nativeDelayedSendStyles).toContain("height: 100vh;");
    expect(nativeDelayedSendStyles).toContain("max-height: 100vh;");
    expect(nativeDelayedSendStyles).toContain("overflow: hidden;");
    expect(nativeDelayedSendStyles).toContain("padding: 24px;");

    const nativeDelayedSendFormStyles = sourceBetween(
      modalStylesSource,
      ".app-modal-host-native-window-body .delayed-send-modal-shadcn .delayed-send-form {",
      ".delayed-send-form",
    );
    expect(nativeDelayedSendFormStyles).toContain("height: 100%;");
    expect(nativeDelayedSendFormStyles).toContain("justify-content: space-between;");

    const delayedSendFooterStyles = sourceBetween(
      modalStylesSource,
      ".delayed-send-footer {",
      ".session-rename-form",
    );
    expect(delayedSendFooterStyles).toContain("display: grid;");
    expect(delayedSendFooterStyles).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(delayedSendFooterStyles).toContain(
      '.delayed-send-cancel-row[data-has-active-timer="true"]',
    );
    expect(delayedSendFooterStyles).toContain("grid-template-columns: repeat(2, minmax(0, 1fr));");
    expect(delayedSendFooterStyles).toContain("width: 100%;");

    const delayedSendValidation = sourceBetween(
      nativeSidebarSource,
      "function scheduleDelayedSend(",
      "function cancelDelayedSend(",
    );
    expect(delayedSendValidation).toContain("DELAYED_SEND_MIN_DELAY_MS");
    expect(delayedSendValidation).toContain("Number.isInteger(delayMs / DELAYED_SEND_MIN_DELAY_MS)");
    expect(delayedSendValidation).toContain("Choose a Delayed Send timer between 1 minute and 24 days.");
  });

  test("sizes the macOS Command Palette to the adjusted native content area", () => {
    /*
    CDXC:CommandPalette 2026-06-12-05:04:
    Command Palette should open 15px narrower on both left and right than the old 720px native frame, while adding 15px of vertical WebView/modal room for the React command list.

    CDXC:CommandPalette 2026-06-12-05:14:
    The extra height must be added at the bottom rather than recentering the modal vertically, so the native placement keeps the previous 520px top edge and extends down to 535px.
    */
    const defaultSize = sourceBetween(
      appDelegateSource,
      "private func defaultSize(for modal: String) -> CGSize",
      "private func constrainedSize(_ size: CGSize, parentWindow: NSWindow) -> CGSize",
    );
    expect(defaultSize).toContain('case "commandPalette":');
    expect(defaultSize).toContain("return CGSize(width: 690, height: 535)");

    const commandPaletteFrame = sourceBetween(
      appDelegateSource,
      "private func commandPaletteContentFrame(size: CGSize, parentWindow: NSWindow) -> CGRect",
      "private func clampFrameToVisibleScreen",
    );
    expect(commandPaletteFrame).toContain("let previousCenteredHeight: CGFloat = 520");
    expect(commandPaletteFrame).toContain(
      "let bottomOnlyHeightIncrease = max(0, size.height - previousCenteredHeight)",
    );

    const constrainedContentFrame = sourceBetween(
      appDelegateSource,
      "private func constrainedContentFrame(",
      "private func shouldLockContentSize(modal: String) -> Bool",
    );
    expect(constrainedContentFrame).toContain('if modal == "commandPalette"');
    expect(constrainedContentFrame).toContain(
      "return commandPaletteContentFrame(size: size, parentWindow: parentWindow)",
    );
  });

  test("keeps the macOS Command Palette React surface inset compact", () => {
    /*
    CDXC:CommandPalette 2026-06-12-05:23:
    Command Palette should reduce the combined search-bar top gap and the whole component's left/right inset by 5px, producing a 3px scoped inset without changing shared CommandInput defaults.
    */
    const commandPaletteStyles = sourceBetween(
      sidebarStylesSource,
      ".ghostex-command-palette-dialog {",
      ".ghostex-command-palette-list {",
    );
    expect(commandPaletteStyles).toContain(
      '.ghostex-command-palette-dialog [data-slot="command"]',
    );
    expect(commandPaletteStyles).toContain("padding: 0 0 4px;");
    expect(commandPaletteStyles).toContain(
      '.ghostex-command-palette-dialog [data-slot="command-input-wrapper"]',
    );
    expect(commandPaletteStyles).toContain("padding: 3px 3px 0;");
    expect(commandPaletteStyles).toContain(
      '.ghostex-command-palette-dialog [data-slot="command-group"]',
    );
    expect(commandPaletteStyles).toContain("padding-left: 3px;");
    expect(commandPaletteStyles).toContain("padding-right: 3px;");
  });

  test("closes compact macOS app modals from outside clicks but switches repeat hotkeys", () => {
    /*
    CDXC:CommandPalette 2026-06-12-05:45:
    The native Command Palette is now a child window. AppKit must close it when the user clicks back into the parent Ghostex window.

    CDXC:CommandPalette 2026-06-15-10:27:
    Repeat command-mode and session-search-mode hotkeys share the visible
    child window and switch modes in-place instead of closing the palette.

    CDXC:AppModals 2026-06-15-13:30:
    Command Palette, Rename Session, and Previous Sessions are compact native
    child-window modals too, so they must close on parent-window mouse-downs
    outside their NSPanel.

    CDXC:HighlightedFeatures 2026-06-16-19:50:
    Highlighted Features should not use the compact outside-click close monitor.
    It closes from its in-modal X, Escape, or native close lifecycle while the
    native backdrop absorbs parent-window clicks.

    CDXC:AppModals 2026-06-29-13:46:
    The compact fixed-size native dialog set should close from parent-window
    outside clicks, matching the React backdrop behavior that cannot receive
    those clicks once the modal lives in a child NSPanel.
    */
    const dispatchNativeHotkey = sourceBetween(
      appDelegateSource,
      "private func dispatchNativeHotkey(_ actionId: String)",
      "private func shouldHandleHotkeyWhileWebChromeOwnsFocus",
    );
    expect(dispatchNativeHotkey).toContain(
      "if Self.isCommandPaletteHotkeyActionId(actionId), isCommandPaletteNativeModalOpenOrPending()",
    );
    expect(dispatchNativeHotkey).toContain("nativeHotkeys.commandPaletteModeSwitch");
    expect(dispatchNativeHotkey).not.toContain("commandPaletteHotkeyToggle");
    expect(dispatchNativeHotkey).not.toContain("nativeHotkeys.commandPaletteToggleClose");
    expect(appDelegateSource).toContain(
      'actionId == "openCommandPalette" || actionId == "openSessionSearchPalette"',
    );
    expect(dispatchNativeHotkey).toContain('activeNativeAppModalKind == "commandPalette"');
    expect(dispatchNativeHotkey).toContain(
      'commandPaletteNativeAppModalWindowController?.currentModalKind ?? ""',
    );

    const webChromeHotkeyGuard = sourceBetween(
      appDelegateSource,
      "private func shouldHandleHotkeyWhileWebChromeOwnsFocus(actionId: String) -> Bool",
      "private func logNativeHotkeyDebug",
    );
    expect(webChromeHotkeyGuard).toContain(
      "if Self.isCommandPaletteHotkeyActionId(actionId), isCommandPaletteNativeModalOpenOrPending()",
    );
    expect(webChromeHotkeyGuard).toContain("return true");

    const appModalWindowController = sourceBetween(
      appDelegateSource,
      "private final class AppModalWindowController",
      "private final class TitlebarDropdownPanelController",
    );
    expect(appModalWindowController).toContain("private var outsideEventMonitor: Any?");
    expect(appModalWindowController).toContain("installOutsideEventMonitorIfNeeded(for: modal)");
    expect(appModalWindowController).toContain("guard shouldCloseFromOutsideMouseDown(modal: modal)");
    expect(appModalWindowController).toContain(
      'case "commandPalette", "renameSession", "previousSessions", "delayedSend", "worktree",',
    );
    expect(appModalWindowController).toContain(
      '"remoteGxserverInstall", "remoteProjectPicker":',
    );
    expect(appModalWindowController).toContain(
      "Do not install the compact\n     outside-click monitor for discoverGhostex.",
    );
    expect(appModalWindowController).toContain(
      "matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown]",
    );
    expect(appModalWindowController).toContain("currentModal == modal");
    expect(appModalWindowController).toContain("event.window === panel");
    expect(appModalWindowController).toContain("self.closeFromOutsideMouseDown()");
    expect(appModalWindowController).toContain('onClosed("outsideMouseDown", closedModal)');
    expect(appModalWindowController).toContain("removeOutsideEventMonitor()");
  });

  test("top-aligns Previous Sessions inside its macOS native child window", () => {
    /*
    CDXC:PreviousSessions 2026-06-17-12:02:
    The macOS Previous Sessions modal should keep the title, search field, and rows at the top of the fixed child window instead of centering the shorter result list vertically.
    */
    const previousSessionsRootRule = sourceBetween(
      modalStylesSource,
      ".app-modal-host-native-window-body .confirm-modal-root:has(.previous-sessions-modal) {",
      ".app-modal-host-body .previous-sessions-modal {",
    );
    expect(previousSessionsRootRule).toContain("align-items: start");
    expect(previousSessionsRootRule).toContain("justify-items: center");

    const previousSessionsNativeRule = sourceBetween(
      modalStylesSource,
      ".app-modal-host-native-window-body .previous-sessions-modal {",
      ".app-modal-host-body .pinned-prompts-modal,",
    );
    expect(previousSessionsNativeRule).toContain("margin: 0 auto auto");
    expect(previousSessionsNativeRule).toContain("max-height: calc(100vh - 16px)");
  });

  test("shows an AppKit backdrop behind first-launch and highlighted-feature modals", () => {
    /*
    CDXC:AppModals 2026-06-16-19:50:
    First Time Setup and Highlighted Features should dim and block the full app
    behind them with a native 40% black AppKit child panel, then remove that
    panel when those onboarding modals close.

    CDXC:GhostexTutorialVideo 2026-06-18-04:49:
    The copied tutorial video modal should use the same native backdrop as
    Highlighted Features while its own dialog owns close behavior.

    CDXC:FirstLaunchSetup 2026-06-29-13:46:
    First Time Setup should close from clicks on the visible native backdrop;
    Highlighted Features and Tutorial Video still absorb backdrop clicks.
    */
    expect(appDelegateSource).toContain("private var onboardingAppModalBackdropPanel: AppModalBackdropPanel?");
    expect(appDelegateSource).toContain("private final class AppModalBackdropPanel: NSPanel");
    expect(appDelegateSource).toContain("private final class AppModalBackdropView: NSView");
    expect(appDelegateSource).toContain("override var canBecomeKey: Bool { false }");
    expect(appDelegateSource).toContain("var onBackdropMouseDown: (() -> Void)?");
    expect(appDelegateSource).toContain("onBackdropMouseDown?()");

    const backdropHelpers = sourceBetween(
      appDelegateSource,
      "private func shouldShowOnboardingAppModalBackdrop",
      "private func takeFirstLaunchSetupAfterDiscoverClose",
    );
    expect(backdropHelpers).toContain("private func shouldCloseOnOnboardingAppModalBackdropClick");
    expect(backdropHelpers).toContain('case "firstLaunchSetup", "tipsAndTricks":');
    expect(backdropHelpers).toContain("contentView.onBackdropMouseDown");
    expect(backdropHelpers).toContain('reason: "onboardingBackdropMouseDown"');
    expect(backdropHelpers).toContain('case "discoverGhostex", "watchGhostexVideo", "firstLaunchSetup", "tipsAndTricks":');
    expect(backdropHelpers).toContain("NSColor.black.withAlphaComponent(0.4)");
    expect(backdropHelpers).toContain("styleMask: [.borderless, .nonactivatingPanel]");
    expect(backdropHelpers).toContain("window.addChildWindow(panel, ordered: .above)");
    expect(backdropHelpers).toContain("panel.setFrame(window.frame, display: true)");
    expect(backdropHelpers).toContain("removeOnboardingAppModalBackdrop()");
    expect(backdropHelpers).toContain("panel.orderOut(nil)");

    const openNativeModal = sourceBetween(
      appDelegateSource,
      "private func openNativeAppModalWindow(",
      "private func rememberFirstLaunchSetupAfterDiscoverCloseRequest",
    );
    expect(openNativeModal).toContain("updateOnboardingAppModalBackdrop(for: modal)");

    const closeNativeModal = sourceBetween(
      appDelegateSource,
      "private func closeNativeAppModalWindow",
      "private func dispatchNativeAppModalWindowMessage",
    );
    expect(closeNativeModal).toContain("updateOnboardingAppModalBackdrop(for: nil)");

    expect(appDelegateSource).toContain("fileprivate func updateAppModalChildWindowFramesIfNeeded()");
    expect(appDelegateSource).toContain("updateOnboardingAppModalBackdropFrameIfNeeded()");
  });

  test("prewarms and reuses the macOS Command Palette native window", () => {
    /*
    CDXC:CommandPalette 2026-06-13-09:53:
    Command Palette should prewarm a hidden native child-window modal host after launch and reuse that loaded WKWebView for the configured command-palette hotkey, without evicting the separate Monaco prompt-editor prewarm host.
    */
    expect(appDelegateSource).toContain("root.scheduleAppModalPrewarmsAfterLaunch()");
    expect(appDelegateSource).toContain(
      'private static let commandPalettePrewarmRequestId = "ghostex-command-palette-prewarm"',
    );
    expect(appDelegateSource).toContain("private var commandPaletteNativeAppModalWindowController");
    expect(appDelegateSource).toContain("private func prewarmCommandPaletteIfNeeded()");
    expect(appDelegateSource).toContain('"modal": "commandPalette"');
    expect(appDelegateSource).toContain('"prewarm": true');
    expect(appDelegateSource).toContain('"requestId": Self.commandPalettePrewarmRequestId');
    expect(appDelegateSource).toContain("finishCommandPalettePrewarm()");
    expect(appDelegateSource).toContain('hostId: "commandPalette"');

    const appModalWindowController = sourceBetween(
      appDelegateSource,
      "private final class AppModalWindowController",
      "private final class TitlebarDropdownPanelController",
    );
    expect(appModalWindowController).toContain(
      'modal == "floatingPromptEditor" || modal == "commandPalette"',
    );
    expect(appModalWindowController).toContain("func hideReusableModal(");
    expect(appModalWindowController).toContain("func isVisibleModal(_ modal: String) -> Bool");
    expect(appModalWindowController).toContain(
      'window.__ghostex_APP_MODAL_HOST_ID__ = \\(encodedHostId);',
    );
    expect(appModalWindowController).toContain("hideReusableModal(modal: \"commandPalette\"");

    expect(modalHostSource).toContain("activeModalRequestId");
    expect(modalHostSource).toContain("presentedMessage.requestId = activeModalRequestId");
    expect(modalHostSource).toContain("nativeWindowHostId: window.__ghostex_APP_MODAL_HOST_ID__");
  });

  test("does not treat a hidden reusable Command Palette host as already open", () => {
    /*
    CDXC:CommandPalette 2026-06-13-10:31:
    The configured command-palette hotkey must open the palette when the reusable command-palette WKWebView is hidden after prewarm or close. Only a visible command-palette child window should take the repeat-hotkey close path.
    */
    const commandPaletteOpenCheck = sourceBetween(
      appDelegateSource,
      "private func isCommandPaletteNativeModalOpenOrPending() -> Bool",
      "private func shouldHandleHotkeyWhileWebChromeOwnsFocus",
    );
    expect(commandPaletteOpenCheck).toContain('isVisibleModal("commandPalette") == true');
    expect(commandPaletteOpenCheck).toContain('activeNativeAppModalKind == "commandPalette", !isVisible');
    expect(commandPaletteOpenCheck).toContain("activeNativeAppModalKind = nil");
    expect(commandPaletteOpenCheck).toContain("return isVisible");
  });

  test("presents Command Palette through its dedicated native window controller", () => {
    /*
    CDXC:CommandPalette 2026-06-13-10:58:
    Cmd+K should show the Command Palette after React reports presented from the dedicated command-palette modal host. The native bridge must route that acknowledgement by modal kind instead of always presenting the primary app-modal controller.
    */
    const presentedHandler = sourceBetween(
      appDelegateSource,
      'case "presented":',
      'case "close":',
    );
    expect(presentedHandler).toContain("activeNativeAppModalKind = modal");
    expect(presentedHandler).toContain("appModalWindowController(for: modal)?.presentIfCurrent(modal: modal)");
    expect(presentedHandler).not.toContain("nativeAppModalWindowController?.presentIfCurrent(modal: modal)");
  });

  test("makes the native command palette WebView first responder when presented", () => {
    /*
    CDXC:CommandPalette 2026-06-16-19:24:
    The visible macOS command-palette child window must own keyboard focus so
    Cmd+Shift+P opens directly into a typeable search field.
    */
    const presentIfCurrent = sourceBetween(
      appDelegateSource,
      "func presentIfCurrent(modal: String?)",
      "func presentBackgroundPrewarmIfCurrent(modal: String?)",
    );
    expect(presentIfCurrent).toContain("panel.makeKeyAndOrderFront(nil)");
    expect(presentIfCurrent).toContain('if modal == "commandPalette", let webView');
    expect(presentIfCurrent).toContain("panel.makeFirstResponder(webView)");
  });

  test("keeps the prewarmed rich prompt editor mounted for the first Ctrl+G", () => {
    /*
    CDXC:PromptEditor 2026-06-13-11:09:
    Ctrl+G rich prompt editor prewarm must keep the hidden native child-window host and mounted Monaco editor alive so the first real prompt open swaps the buffer and focuses immediately instead of recreating Monaco.

    CDXC:PromptEditor 2026-06-16-10:23:
    Launch-time prompt-editor prewarm must retry when another startup modal or pending child-window presentation blocks the first attempt, so a busy launch cannot leave the first Ctrl+G cold.

    CDXC:PromptEditor 2026-06-16-10:41:
    Prompt-editor prewarm must briefly order the native child window in a transparent non-interactive background state so WebKit, React, and Monaco become live the same way they do after the first real Ctrl+G open.
    */
    expect(appDelegateSource).toContain("private static let floatingPromptEditorPrewarmRetryDelay");
    expect(appDelegateSource).toContain("private var hasPendingFloatingPromptEditorPrewarmRetry");
    expect(appDelegateSource).toContain("private func scheduleFloatingPromptEditorPrewarmRetryIfNeeded");
    expect(appDelegateSource).toContain('event: "native.prewarm.retryScheduled"');
    expect(appDelegateSource).toContain(
      'scheduleFloatingPromptEditorPrewarmRetryIfNeeded(reason: "modalBusy")',
    );
    expect(appDelegateSource).toContain(
      'scheduleFloatingPromptEditorPrewarmRetryIfNeeded(reason: "modalClosed")',
    );

    const finishPrewarm = sourceBetween(
      appDelegateSource,
      "private func finishFloatingPromptEditorPrewarm()",
      "private func cleanupFloatingPromptEditorPrewarmTempFile()",
    );
    expect(finishPrewarm).toContain('sendReactClose: false');

    const presentedHandler = sourceBetween(
      appDelegateSource,
      'case "presented":',
      'case "close":',
    );
    expect(presentedHandler).toContain(
      "appModalWindowController(for: modal)?.presentBackgroundPrewarmIfCurrent(modal: modal)",
    );

    const appModalWindowController = sourceBetween(
      appDelegateSource,
      "private final class AppModalWindowController",
      "private final class TitlebarDropdownPanel",
    );
    expect(appModalWindowController).toContain("func presentBackgroundPrewarmIfCurrent(modal: String?)");
    expect(appModalWindowController).toContain("panel.ignoresMouseEvents = true");
    expect(appModalWindowController).toContain("panel.alphaValue = 0");
    expect(appModalWindowController).toContain("panel.orderFront(nil)");
    expect(appModalWindowController).toContain("private func resetPanelBackgroundPrewarmState()");
    expect(appModalWindowController).toContain("panel?.ignoresMouseEvents = false");
    expect(appModalWindowController).toContain("panel?.alphaValue = 1");

    const monacoRequestEffect = sourceBetween(
      modalHostSource,
      'appendPromptEditorDebugLog("react.monaco.loadStart"',
      "  useEffect(() => {\n    editorRef.current?.layout();",
    );
    expect(monacoRequestEffect).toContain("const existingEditor = editorRef.current");
    expect(monacoRequestEffect).toContain("existingEditor.setValue(editor.initialText)");
    expect(monacoRequestEffect).toContain('appendPromptEditorDebugLog("react.monaco.reusedAndFocused"');
    expect(monacoRequestEffect).toContain("retainedEditor: true");

    const closedLifecycle = sourceBetween(
      modalHostSource,
      'appendPromptEditorDebugLog("react.lifecycle.closed"',
      'appendPromptEditorDebugLog("react.lifecycle.opened"',
    );
    expect(closedLifecycle).toContain("editorRef.current?.dispose()");
    expect(closedLifecycle).toContain("editorRef.current = null");
  });
});
