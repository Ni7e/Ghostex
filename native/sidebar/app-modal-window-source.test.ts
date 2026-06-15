import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const appDelegateSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift", import.meta.url),
  "utf8",
);
const modalStylesSource = readFileSync(
  new URL("../../sidebar/styles/modals.css", import.meta.url),
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

  test("opens first-launch setup 90px taller than the generic management modals", () => {
    /*
    CDXC:FirstLaunchSetup 2026-06-12-07:13:
    The macOS first-launch setup modal must open 90px taller than its old 1120x760 native child window so onboarding steps with hook status and footer actions are not clipped.
    Keep Agents Hub at the generic management-modal height while firstLaunchSetup and the legacy tipsAndTricks alias use the taller frame.

    CDXC:DiscoverGhostex 2026-06-16-00:26:
    Discover Ghostex uses the same 1120x850 native child-window footprint while keeping its own modal id and title.
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
    expect(defaultSize).toContain('case "discoverGhostex":');

    const modalTitle = sourceBetween(
      appDelegateSource,
      "private func title(for modal: String) -> String",
      "private final class TitlebarDropdownPanelController",
    );
    expect(modalTitle).toContain('case "discoverGhostex":');
    expect(modalTitle).toContain('return "Discover Ghostex"');
  });

  test("opens Settings over the exact macOS workspace area", () => {
    /*
    CDXC:AppModals 2026-06-15-10:12:
    Settings must cover the whole workspace area while leaving the sidebar,
    divider, and titlebar owned by their existing native sibling frames.
    */
    const preferredFrame = sourceBetween(
      appDelegateSource,
      "private func preferredNativeAppModalContentFrame(",
      "private func closeNativeAppModalWindow",
    );
    expect(preferredFrame).toContain('guard modal == "settings"');
    expect(preferredFrame).toContain("let workspaceFrame = rootLayoutFrames().workspace");
    expect(preferredFrame).toContain("parentWindow.convertToScreen(convert(workspaceFrame, to: nil))");

    const openNativeModal = sourceBetween(
      appDelegateSource,
      "private func openNativeAppModalWindow(",
      "private func preferredNativeAppModalContentFrame",
    );
    expect(openNativeModal).toContain("let resolvedPreferredContentFrame = preferredNativeAppModalContentFrame(");
    expect(openNativeModal).toContain("preferredContentFrame: resolvedPreferredContentFrame");

    const appModalWindowController = sourceBetween(
      appDelegateSource,
      "private final class AppModalWindowController",
      "private final class TitlebarDropdownPanelController",
    );
    expect(appModalWindowController).toContain(
      "panel.hasShadow = !shouldUseExactContentFrame(modal: modal)",
    );
    expect(appModalWindowController).toContain("if shouldUseExactContentFrame(modal: modal)");
    expect(appModalWindowController).toContain("private func shouldUseExactContentFrame(modal: String?) -> Bool");
    expect(appModalWindowController).toContain('modal == "settings"');
    expect(appModalWindowController).toContain('case "settings":');
    expect(appModalWindowController).toContain("return CGSize(width: 1, height: 1)");

    const settingsStyles = sourceBetween(
      sidebarStylesSource,
      ".app-modal-host-native-window-body .ghostex-settings-shadcn.settings-modal-dialog {",
      ".ghostex-settings-shadcn.settings-modal-dialog .ghostex-modal-heading-bar",
    );
    expect(settingsStyles).toContain("border-bottom: 1px solid #252525 !important;");
    expect(settingsStyles).toContain("border-right: 1px solid #252525 !important;");
    expect(settingsStyles).toContain("border-top: 1px solid #252525 !important;");
    expect(settingsStyles).toContain("box-sizing: border-box;");
    expect(settingsStyles).toContain("height: 100vh;");
    expect(settingsStyles).toContain("max-height: 100vh;");
    expect(settingsStyles).toContain("max-width: 100vw;");
    expect(settingsStyles).toContain("width: 100vw;");
  });

  test("reframes Settings when workspace geometry changes", () => {
    /*
    CDXC:SettingsLayout 2026-06-15-14:07:
    Settings is a full-workspace native child window. Main-window resize,
    sidebar collapse, and sidebar side changes should reframe Settings to the
    current workspace instead of closing it or keeping the old frame.
    */
    const resizeStart = sourceBetween(
      appDelegateSource,
      "func windowWillStartLiveResize(_ notification: Notification)",
      "func windowDidResize(_ notification: Notification)",
    );
    expect(resizeStart).toContain("resizedWindow === mainWindow");
    expect(resizeStart).toContain("updateSettingsModalWorkspaceFrameIfNeeded()");

    const updateSettingsFrame = sourceBetween(
      appDelegateSource,
      "fileprivate func updateSettingsModalWorkspaceFrameIfNeeded()",
      "private func closeNativeAppModalWindow",
    );
    expect(updateSettingsFrame).toContain('currentModalKind == "settings"');
    expect(updateSettingsFrame).toContain("preferredNativeAppModalContentFrame(");
    expect(updateSettingsFrame).toContain("nativeAppModalWindowController?.updateContentFrame(");
    expect(updateSettingsFrame).not.toContain("closeNativeAppModalWindow(");

    const rootChrome = sourceBetween(
      appDelegateSource,
      "func setSidebarSide(_ side: SidebarSide)",
      "private func setTitlebarSidebarCollapsed",
    );
    expect(rootChrome).toContain("updateSettingsModalWorkspaceFrameIfNeeded()");

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

  test("rotates AppDelegate-owned support logs", () => {
    /*
    CDXC:GxserverLogs 2026-06-15-20:39:
    Shared AppDelegate log files such as native-host-lifecycle should rotate at
    the common support-bundle limit instead of growing without bound during long
    Debugging Mode sessions.
    */
    expect(appDelegateSource).toContain("sharedLogMaxFileBytes: UInt64 = 25 * 1024 * 1024");
    expect(appDelegateSource).toContain("sharedLogMaxRotatedFiles = 3");
    expect(appDelegateSource).toContain("rotateSharedLogIfNeeded(logURL: logURL");
    expect(appDelegateSource).toContain("native-host-lifecycle.log");
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
    expect(enterHandler).toContain("onConfirm(createDraft(");
  });

  test("uses Settings search focus treatment for modal text controls", () => {
    /*
    CDXC:ModalTextFocus 2026-06-15-11:30:
    Editable text fields and textareas in app modals should use the same focus
    look as Settings search: white input border, no outer shadcn focus ring.
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
    expect(settingsTextFocusStyles).toContain("border-color: #fff;");
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

  test("keeps Delayed Send fixed at 472x269 in the macOS app", () => {
    /*
    CDXC:DelayedSend 2026-06-12-04:07:
    Delayed Send must open as a fixed 472x269 macOS child window, including a matching modal-specific minimum because the shared app-modal minimum is larger than this timer dialog.
    */
    const defaultSize = sourceBetween(
      appDelegateSource,
      "private func defaultSize(for modal: String) -> CGSize",
      "private func constrainedSize(_ size: CGSize, parentWindow: NSWindow) -> CGSize",
    );
    expect(defaultSize).toContain('case "delayedSend":');
    expect(defaultSize).toContain("return CGSize(width: 472, height: 269)");

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
    expect(minimumContentSize).toContain("return CGSize(width: 472, height: 269)");
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
    Configure Action, Rename Session, and Previous Sessions are compact native
    child-window modals too, so they must close on parent-window mouse-downs
    outside their NSPanel.
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
      'case "commandPalette", "renameSession", "previousSessions", "discoverGhostex":',
    );
    expect(appModalWindowController).toContain(
      "Discover Ghostex uses the same compact native child-window pattern.",
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

  test("keeps the prewarmed rich prompt editor mounted for the first Ctrl+G", () => {
    /*
    CDXC:PromptEditor 2026-06-13-11:09:
    Ctrl+G rich prompt editor prewarm must keep the hidden native child-window host and mounted Monaco editor alive so the first real prompt open swaps the buffer and focuses immediately instead of recreating Monaco.
    */
    const finishPrewarm = sourceBetween(
      appDelegateSource,
      "private func finishFloatingPromptEditorPrewarm()",
      "private func cleanupFloatingPromptEditorPrewarmTempFile()",
    );
    expect(finishPrewarm).toContain('sendReactClose: false');

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
