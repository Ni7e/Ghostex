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

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("first-launch highlighted features sequence source", () => {
  test("opens the tutorial video directly on first startup", () => {
    /*
     * CDXC:GhostexTutorialVideo 2026-06-18-05:31:
     * Startup should show the tutorial video when the current setup revision
     * has not been seen. Highlighted Features is marked seen so the old modal
     * stays unused.
     */
    const firstLaunchStartup = sourceBetween(
      nativeSidebarSource,
      "function openFirstLaunchSetupOnFirstLaunch(): void",
      "function showOSIntegrationOnboardingOnFirstLaunch(): void",
    );
    expect(firstLaunchStartup).toContain("hasSeenCurrentFirstLaunchSetup(localStorage)");
    expect(firstLaunchStartup).toContain("!hasSeenCurrentHighlightedFeatures(localStorage)");
    expect(firstLaunchStartup).toContain("markCurrentHighlightedFeaturesSeen(localStorage);");
    expect(firstLaunchStartup).toContain('openAppModal({ modal: "watchGhostexVideo", type: "open" });');
    expect(firstLaunchStartup).toContain("markCurrentFirstLaunchSetupSeen(localStorage);");
    expect(firstLaunchStartup.indexOf('openAppModal({ modal: "watchGhostexVideo", type: "open" });')).toBeLessThan(
      firstLaunchStartup.indexOf("markCurrentFirstLaunchSetupSeen(localStorage);"),
    );
    expect(firstLaunchStartup).not.toContain('modal: "firstLaunchSetup"');
    expect(firstLaunchStartup).not.toContain('modal: "discoverGhostex"');
    expect(firstLaunchStartup).not.toContain("showFirstLaunchSetupOnClose");

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

    const highlightedFeaturesCompatibilityLauncher = sourceBetween(
      nativeSidebarSource,
      'case "openHighlightedFeatures":',
      'case "openGhostexTutorialVideo":',
    );
    expect(highlightedFeaturesCompatibilityLauncher).toContain(
      'openAppModal({ modal: "watchGhostexVideo", type: "open" });',
    );
    expect(highlightedFeaturesCompatibilityLauncher).not.toContain(
      'openAppModal({ modal: "discoverGhostex", type: "open" });',
    );
    expect(highlightedFeaturesCompatibilityLauncher).not.toContain("showFirstLaunchSetupOnClose");
  });

  test("continues into setup from native Discover close paths", () => {
    /*
     * CDXC:FirstLaunchSetup 2026-06-16-07:58:
     * Highlighted Features can close from React controls, Escape, or AppKit
     * close handling. Parent-window outside clicks are ignored by the
     * Highlighted Features modal, so the follow-up setup open must live in the
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
