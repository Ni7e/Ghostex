import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const appModalBridgeSource = readFileSync(
  new URL("../../sidebar/app-modal-host-bridge.ts", import.meta.url),
  "utf8",
);
const appDelegateSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift", import.meta.url),
  "utf8",
);
const modalHostSource = readFileSync(new URL("modal-host.tsx", import.meta.url), "utf8");
const nativeSidebarSource = readFileSync(new URL("native-sidebar.tsx", import.meta.url), "utf8");
const portlessModalSource = readFileSync(
  new URL("../../sidebar/portless-setup-modal.tsx", import.meta.url),
  "utf8",
);
const sidebarContractSource = readFileSync(
  new URL("../../shared/session-grid-contract-sidebar.ts", import.meta.url),
  "utf8",
);

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("Portless Phase 13 setup modal source contract", () => {
  test("app-modal bridge and host expose the Portless setup modal kind", () => {
    /*
    CDXC:PortlessSetupModal 2026-06-23-13:42:
    Phase 13 setup must open through the React app-modal child-window host, not
    an AppKit alert or sidebar-local dialog. The modal-open payload carries only
    copy mode and protocol enums.
    */
    expect(appModalBridgeSource).toContain('| "portlessSetup"');
    expect(appModalBridgeSource).toContain('modal: "portlessSetup"');
    expect(appModalBridgeSource).toContain('mode: "firstSetup" | "standaloneReconfigure"');
    expect(appModalBridgeSource).toContain('protocol: "https" | "http"');
    expect(modalHostSource).toContain("PortlessSetupModal");
    expect(modalHostSource).toContain('activeModal === "portlessSetup"');
    const renderability = sourceBetween(
      modalHostSource,
      "function isModalRenderable({",
      "function applySidebarStateMessage",
    );
    expect(renderability).toContain("portlessSetup: PortlessSetupModalState | undefined");
    expect(renderability).toContain('case "portlessSetup":');
    expect(renderability).toContain("return portlessSetup !== undefined");
    expect(appDelegateSource).not.toContain("Set up Portless domains?");
    expect(appDelegateSource).not.toContain("Reconfigure Portless for Ghostex?");
  });

  test("modal component contains exact handoff copy and buttons", () => {
    expect(portlessModalSource).toContain("Set up Portless domains?");
    expect(portlessModalSource).toContain(
      "Ghostex found a running dev server. Portless gives it a stable local domain like https://ghostex.localhost, so you can run multiple apps and worktrees of the same project without conflicting ports.",
    );
    expect(portlessModalSource).toContain(
      "Installing the Portless background proxy requires admin permission once so it can listen on standard local web ports. You can disable Portless if you do not want Ghostex to show this again.",
    );
    expect(portlessModalSource).toContain("Install");
    expect(portlessModalSource).toContain("Postpone");
    expect(portlessModalSource).toContain("Disable");

    expect(portlessModalSource).toContain("Reconfigure Portless for Ghostex?");
    expect(portlessModalSource).toContain(
      "Portless is already installed on this Mac. Ghostex needs to manage the Portless background proxy so it can create stable domains for your projects and worktrees.",
    );
    expect(portlessModalSource).toContain(
      "Reconfiguring will point Portless at Ghostex's state directory. You can cancel, or disable Portless in Settings if you do not want Ghostex to show this again.",
    );
    expect(portlessModalSource).toContain("Reconfigure");
    expect(portlessModalSource).toContain("Cancel");
  });

  test("modal commands are metadata-only and native-sidebar owns settings merge", () => {
    const modalRender = sourceBetween(
      modalHostSource,
      "<PortlessSetupModal",
      "<ScratchPadModal",
    );
    expect(modalRender).toContain('type: "runPortlessSetupPromptAdminAction"');
    expect(modalRender).toContain('type: "postponePortlessSetupPrompt"');
    expect(modalRender).toContain('type: "cancelPortlessSetupPrompt"');
    expect(modalRender).toContain('type: "setPortlessEnabled"');
    expect(modalRender).toContain("enabled: false");
    expect(modalRender).not.toContain("updateSettings");
    expect(modalRender).not.toContain("settings:");

    const sidebarCommands = sourceBetween(
      sidebarContractSource,
      'action: Extract<NativePortlessAdminInstallAction, "install" | "reconfigure">',
      'type: "saveRemoteMachinePassword"',
    );
    expect(sidebarCommands).toContain("protocol: NativePortlessProtocol");
    expect(sidebarCommands).toContain("requestId: string");
    expect(sidebarCommands).toContain("enabled: false");
    expect(sidebarCommands).not.toContain("settings: ghostexSettings");

    const disableHandler = sourceBetween(
      nativeSidebarSource,
      "function setPortlessEnabledFromSetupPrompt",
      "function buildSidebarMessage()",
    );
    expect(disableHandler).toContain("suppressPortlessSetupPromptForThisRun()");
    expect(disableHandler).toContain("saveSettings({");
    expect(disableHandler).toContain("...settings");
    expect(disableHandler).toContain("portlessEnabled: false");
  });

  test("native-sidebar trigger uses Phase 12 state and in-memory prompt suppression", () => {
    const promptSource = sourceBetween(
      nativeSidebarSource,
      "function maybeOpenPortlessSetupPrompt",
      "function buildSidebarMessage()",
    );
    expect(promptSource).toContain("portlessSetupPromptSuppressedUntilRestart");
    expect(promptSource).toContain("activePortlessSetupPromptMode");
    expect(promptSource).toContain("settings.portlessEnabled");
    expect(promptSource).toContain("health.enabled");
    expect(promptSource).toContain("portless.nativeAdmin.available");
    expect(promptSource).toContain("portless.presentation?.liveListenerCount");
    expect(promptSource).toContain('health.setupStatus !== "needed"');
    expect(promptSource).toContain('health.setupOwnership === "missing"');
    expect(promptSource).toContain('health.setupOwnership === "standalone"');
    expect(promptSource).toContain('health.setupOwnership === "ghostex"');
    expect(promptSource).toContain('modal: "portlessSetup"');
    expect(promptSource).toContain("runTrackedPortlessAdminAction(message.action");
    expect(nativeSidebarSource).toContain("maybeOpenPortlessSetupPrompt(sidebarMessage.hud.portless)");
    expect(nativeSidebarSource).toContain('case "postponePortlessSetupPrompt":');
    expect(nativeSidebarSource).toContain('case "cancelPortlessSetupPrompt":');
    expect(nativeSidebarSource).toContain('case "runPortlessSetupPromptAdminAction":');
  });
});
