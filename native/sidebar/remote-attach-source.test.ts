import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("remote attach sidebar ownership", () => {
  test("keeps remote attach carriers hidden from local project presentation", () => {
    /*
     * CDXC:RemoteAttach 2026-06-08-21:12:
     * Clicking a session under a Remote machine must wake that remote row in place. The native Ghostty SSH surface may need a local owner, but it must be a hidden carrier project instead of Quick or the currently active local project.
     */
    const openRemoteAttach = sourceBetween(
      nativeSidebarSource,
      "async function openRemoteAttachTerminalForTarget",
      "async function createNativeRemoteAttachCarrierTerminal",
    );
    expect(openRemoteAttach).not.toContain("createNativeQuickTerminal");
    expect(openRemoteAttach).toContain("createNativeRemoteAttachCarrierTerminal(target, plan)");
    expect(openRemoteAttach).toContain('hideGxserverPresentationProjectLocally(carrier.projectId, "remote-attach-carrier")');
    expect(openRemoteAttach).toContain('hideGxserverPresentationSessionLocally(carrier.projectId, carrier.session.sessionId, "remote-attach-carrier")');
    expect(openRemoteAttach).toContain("rememberRemoteAttachLocalSession(target, createCombinedProjectSessionId(carrier.projectId, carrier.session.sessionId))");

    const carrierTerminal = sourceBetween(
      nativeSidebarSource,
      "async function createNativeRemoteAttachCarrierTerminal",
      "async function ensureNativeRemoteAttachCarrierProject",
    );
    expect(carrierTerminal).toContain("activeProjectId = carrierProject.projectId");
    expect(carrierTerminal).toContain("forceSessionPersistenceOff: true");
    expect(carrierTerminal).toContain("buildRemoteAttachTerminalProcessCommand(plan.sshCommand)");
    expect(carrierTerminal).toContain("markNativeRemoteAttachCarrierProject(projectId)");

    const readStoredProjects = sourceBetween(
      nativeSidebarSource,
      "function readStoredProjects",
      "function writeStoredProjects",
    );
    expect(readStoredProjects).toContain(".filter((project: NativeProject) => !isRemoteAttachCarrierProject(project))");

    const carrierDetector = sourceBetween(
      nativeSidebarSource,
      "function isRemoteAttachCarrierProject",
      "function quickKindForProject",
    );
    expect(carrierDetector).toContain("remoteAttachCarrierProjectPath()");
    expect(carrierDetector).toContain('createProjectId("remote-attach-carrier")');
    expect(carrierDetector).toContain('"Remote Attach"');

    const presentationGroups = sourceBetween(
      nativeSidebarSource,
      "function createPresentationSidebarGroups",
      "function createRemotePresentationSidebarGroups",
    );
    expect(presentationGroups).toContain("remoteAttachCarrierProjectIds: createNativePresentationRemoteAttachCarrierProjectIds(presentation)");
    expect(presentationGroups).toContain("isRemoteAttachCarrier: isRemoteAttachCarrierProject(project)");

    const presentationProjectionSource = readFileSync(
      new URL("./native-presentation-projection.ts", import.meta.url),
      "utf8",
    );
    expect(presentationProjectionSource).toContain("localProjectsById.get(project.projectId)?.isRemoteAttachCarrier !== true");
    expect(presentationProjectionSource).toContain("!input.remoteAttachCarrierProjectIds?.has(project.projectId)");
  });

  test("builds Android-compatible ssh attach commands", () => {
    /*
     * CDXC:RemoteAttach 2026-06-08-21:12:
     * macOS Remote clicks should attach like Android: force an SSH PTY, target the Ghostex session id through `ghostex attach`, include project id when present, and run through a shell that loads user-managed Node/Homebrew paths.
     */
    const attachSshCommand = sourceBetween(
      nativeSidebarSource,
      "function buildRemoteGhostexAttachSshCommand",
      "function buildRemoteGhostexAttachCommand",
    );
    expect(attachSshCommand).toContain("buildRemoteLoginShellCommand(buildRemoteGhostexAttachCommand(target))");
    expect(attachSshCommand).toContain("buildRemoteSshCommand(remoteMachine, [remoteCommand], { forceTty: true })");

    const attachCommand = sourceBetween(
      nativeSidebarSource,
      "function buildRemoteGhostexAttachCommand",
      "function buildRemoteLoginShellCommand",
    );
    expect(attachCommand).toContain('"ghostex"');
    expect(attachCommand).toContain('"attach"');
    expect(attachCommand).toContain('"--session-id"');
    expect(attachCommand).toContain("quoteNativeShellArg(target.sessionId)");
    expect(attachCommand).toContain('"--project-id"');
    expect(attachCommand).toContain("quoteNativeShellArg(target.projectId)");
    expect(attachCommand).toContain('currentZmxPromptEditorAttachMode() === "monaco"');
    expect(attachCommand).toContain('"--prompt-editor"');
    expect(attachCommand).toContain('"monaco"');

    const loginShellCommand = sourceBetween(
      nativeSidebarSource,
      "function buildRemoteLoginShellCommand",
      "function buildRemoteSshCommand",
    );
    expect(loginShellCommand).toContain("/bin/zsh -lic");
    expect(loginShellCommand).toContain("zsh -lic");
    expect(loginShellCommand).toContain("/bin/sh -lc");

    const sshCommand = sourceBetween(
      nativeSidebarSource,
      "function buildRemoteSshCommand",
      "function quoteRemoteSshCommandArg",
    );
    expect(sshCommand).toContain('args.push("-tt")');
  });
});
