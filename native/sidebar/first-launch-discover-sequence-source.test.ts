import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const appDelegateSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift", import.meta.url),
  "utf8",
);
const appModalHostBridgeSource = readFileSync(
  new URL("../../sidebar/app-modal-host-bridge.ts", import.meta.url),
  "utf8",
);
const modalHostSource = readFileSync(new URL("./modal-host.tsx", import.meta.url), "utf8");
const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");
const sidebarAppSource = readFileSync(
  new URL("../../sidebar/sidebar-app.tsx", import.meta.url),
  "utf8",
);

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("first-launch highlighted features sequence source", () => {
  test("starts automatic onboarding with Discover before setup", () => {
    /*
     * CDXC:FirstLaunchSetup 2026-06-16-07:58:
     * The automatic first-run path should show Highlighted Features first, then
     * continue into firstLaunchSetup after the feature tour closes. Manual
     * overflow opens remain standalone because only startup sends the
     * follow-up flag.
     */
    const firstLaunchStartup = sourceBetween(
      nativeSidebarSource,
      "function openFirstLaunchSetupOnFirstLaunch(): void",
      "function showOSIntegrationOnboardingOnFirstLaunch(): void",
    );
    expect(firstLaunchStartup).toContain('modal: "discoverGhostex"');
    expect(firstLaunchStartup).toContain("showFirstLaunchSetupOnClose: true");
    expect(firstLaunchStartup).toContain("markCurrentFirstLaunchSetupSeen(localStorage);");
    expect(firstLaunchStartup.indexOf('modal: "discoverGhostex"')).toBeLessThan(
      firstLaunchStartup.indexOf("markCurrentFirstLaunchSetupSeen(localStorage);"),
    );
    expect(firstLaunchStartup).not.toContain('modal: "firstLaunchSetup"');

    const bridgeDiscoverOpen = sourceBetween(
      appModalHostBridgeSource,
      'modal: "discoverGhostex";',
      'modal: "commandPalette";',
    );
    expect(bridgeDiscoverOpen).toContain("showFirstLaunchSetupOnClose?: boolean;");

    const modalHostOpenMessage = sourceBetween(
      modalHostSource,
      "type AppModalHostMessage =",
      "type RenameSessionModalState =",
    );
    expect(modalHostOpenMessage).toContain("showFirstLaunchSetupOnClose?: boolean;");

    const manualDiscoverLauncher = sourceBetween(
      sidebarAppSource,
      "const openDiscoverGhostex = () => {",
      "const openFirstLaunchSetup = () => {",
    );
    expect(manualDiscoverLauncher).toContain('openAppModal({ modal: "discoverGhostex", type: "open" });');
    expect(manualDiscoverLauncher).not.toContain("showFirstLaunchSetupOnClose");
  });

  test("continues into setup from native Discover close paths", () => {
    /*
     * CDXC:FirstLaunchSetup 2026-06-16-07:58:
     * Highlighted Features can close from React controls, Escape, AppKit close handling, or
     * parent-window outside clicks. The follow-up setup open must live in the
     * native close lifecycle rather than a React-only onClose callback.
     */
    expect(appDelegateSource).toContain(
      "private var shouldOpenFirstLaunchSetupAfterDiscoverClose = false",
    );

    const openNativeModal = sourceBetween(
      appDelegateSource,
      "private func openNativeAppModalWindow(",
      "private func shouldIgnoreDuplicateNativeAppModalOpen",
    );
    expect(openNativeModal).toContain(
      "rememberFirstLaunchSetupAfterDiscoverCloseRequest(message: message, modal: modal)",
    );
    expect(openNativeModal).toContain(
      "message[\"showFirstLaunchSetupOnClose\"] as? Bool == true",
    );
    expect(openNativeModal).toContain("shouldOpenFirstLaunchSetupAfterDiscoverClose = false");

    const discoverCloseFollowUp = sourceBetween(
      appDelegateSource,
      "private func takeFirstLaunchSetupAfterDiscoverClose",
      "private func closeNativeAppModalWindow",
    );
    expect(discoverCloseFollowUp).toContain('closingModal == "discoverGhostex"');
    expect(discoverCloseFollowUp).toContain(
      'message: ["modal": "firstLaunchSetup", "type": "open"]',
    );

    const closeNativeAppModal = sourceBetween(
      appDelegateSource,
      "private func closeNativeAppModalWindow",
      "private func nativeAppModalWindowDidClose",
    );
    expect(closeNativeAppModal).toContain(
      "let closingModal = activeNativeAppModalKind ?? activeAppModalWindowController()?.currentModalKind",
    );
    expect(closeNativeAppModal).toContain(
      "openFirstLaunchSetupAfterDiscoverIfNeeded(closingModal: closingModal)",
    );

    const nativeWindowDidClose = sourceBetween(
      appDelegateSource,
      "private func nativeAppModalWindowDidClose",
      "private func dispatchNativeAppModalWindowMessage",
    );
    expect(nativeWindowDidClose).toContain("let closingModal = modal");
    expect(nativeWindowDidClose).toContain(
      "openFirstLaunchSetupAfterDiscoverIfNeeded(closingModal: closingModal)",
    );

    const closeAppModalHost = sourceBetween(
      appDelegateSource,
      "private func closeAppModalHost",
      "private func rememberAppModalReturnFocusTarget",
    );
    expect(closeAppModalHost).toContain(
      "let closingModal = activeNativeAppModalKind ?? activeAppModalWindowController()?.currentModalKind",
    );
    expect(closeAppModalHost).toContain(
      "openFirstLaunchSetupAfterDiscoverIfNeeded(closingModal: closingModal)",
    );
  });
});
