import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source
    .slice(startIndex, endIndex)
    .replace(/\s+/g, " ")
    .replace(/([([])\s+/g, "$1")
    .replace(/,?\s+([)\]])/g, "$1");
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

  test("acknowledges remote attention through gxserver before opening the local carrier", () => {
    /*
     * CDXC:RemoteSessionStatus 2026-06-30-04:05:
     * Remote session clicks must clear the remote gxserver-owned Done status,
     * not only focus or create the local SSH carrier terminal.
     */
    const remoteActivityLocalFirst = sourceBetween(
      nativeSidebarSource,
      "function setRemotePresentationSessionActivityLocally",
      "function setRemotePresentationSessionFlagsLocally",
    );
    expect(remoteActivityLocalFirst).toContain("const { attention: _attention, ...withoutAttention } = session");
    expect(remoteActivityLocalFirst).toContain("acknowledgeAttention: false");
    expect(remoteActivityLocalFirst).toContain('"nativeSidebar.remoteGxserver.presentationActivity.localFirst"');

    const acknowledgeRemoteAttention = sourceBetween(
      nativeSidebarSource,
      "async function acknowledgeRemotePresentationSessionAttention",
      "async function openRemoteAttachTerminalForTarget",
    );
    expect(acknowledgeRemoteAttention).toContain('session.activity !== "attention"');
    expect(acknowledgeRemoteAttention).toContain("session.actions.acknowledgeAttention !== true");
    expect(acknowledgeRemoteAttention).toContain("setRemotePresentationSessionActivityLocally(");
    expect(acknowledgeRemoteAttention).toContain('"/api/updateAgentActivity"');
    expect(acknowledgeRemoteAttention).toContain('event: "acknowledge"');
    expect(acknowledgeRemoteAttention).toContain("refreshRemoteGxserverPresentationSnapshot(target.machineId, `${reason}-failed`)");

    const openRemoteAttach = sourceBetween(
      nativeSidebarSource,
      "async function openRemoteAttachTerminalForTarget",
      "async function createNativeRemoteAttachCarrierTerminal",
    );
    expect(openRemoteAttach).toContain('void acknowledgeRemotePresentationSessionAttention(target, "remote-attach-focus");');
    expect(openRemoteAttach.indexOf("acknowledgeRemotePresentationSessionAttention")).toBeLessThan(
      openRemoteAttach.indexOf("focusExistingRemoteAttachTerminal(target)"),
    );
  });

  test("builds gxserver metadata-backed ssh attach commands", () => {
    /*
     * CDXC:RemoteAttach 2026-06-30-04:22:
     * macOS Remote clicks should force an SSH PTY but use the already-authenticated remote gxserver attach metadata instead of a remote `ghostex` PATH lookup. This keeps macOS remote packages usable when gxserver/zmx are installed but the Ghostex CLI shim is absent.
     */
    const createPlan = sourceBetween(
      nativeSidebarSource,
      "async function createRemoteAttachCommandPlan",
      "async function copyRemoteAttachCommandForTarget",
    );
    expect(createPlan).toContain("await buildRemoteGxserverAttachSshCommand(remoteMachine, target)");

    const attachSshCommand = sourceBetween(
      nativeSidebarSource,
      "async function buildRemoteGxserverAttachSshCommand",
      "async function resolveRemoteAttachMetadataForTarget",
    );
    expect(attachSshCommand).toContain("const attach = await resolveRemoteAttachMetadataForTarget(target)");
    expect(attachSshCommand).toContain("const attachCommand = attach.attachCommand?.trim()");
    expect(attachSshCommand).toContain("buildRemoteLoginShellCommand(attachCommand)");
    expect(attachSshCommand).toContain("buildRemoteSshCommand(remoteMachine, [remoteCommand], { forceTty: true })");

    const attachMetadata = sourceBetween(
      nativeSidebarSource,
      "async function resolveRemoteAttachMetadataForTarget",
      "async function fetchRemoteAttachSessionMetadataForTarget",
    );
    expect(attachMetadata).toContain("fetchRemoteAttachSessionMetadataForTarget(target)");
    expect(attachMetadata).toContain("attach.restoreBlocked");
    expect(attachMetadata).toContain("shouldStartZmxProviderBeforeNativeAttach(attach)");
    expect(attachMetadata).toContain('"/api/startSessionProvider"');
    expect(attachMetadata).toContain("buildRemoteAttachMetadataParams(target, attach.startupText)");

    const fetchAttachMetadata = sourceBetween(
      nativeSidebarSource,
      "async function fetchRemoteAttachSessionMetadataForTarget",
      "function buildRemoteAttachMetadataParams",
    );
    expect(fetchAttachMetadata).toContain('"/api/attachSessionMetadata"');
    expect(fetchAttachMetadata).toContain("buildRemoteAttachMetadataParams(target)");

    const attachParams = sourceBetween(
      nativeSidebarSource,
      "function buildRemoteAttachMetadataParams",
      "function buildRemoteLoginShellCommand",
    );
    expect(attachParams).toContain("currentZmxPromptEditorAttachMode()");
    expect(attachParams).toContain("promptEditor: promptEditorAttachMode");
    expect(attachParams).toContain("projectId: target.projectId");
    expect(attachParams).toContain("sessionId: target.sessionId");
    expect(attachParams).toContain("startupText !== undefined");
    expect(attachParams).not.toContain('remote_ghostex="ghostex"');

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
