import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");
const sidebarAppSource = readFileSync(new URL("../../sidebar/sidebar-app.tsx", import.meta.url), "utf8");
const sessionGroupSectionSource = readFileSync(
  new URL("../../sidebar/session-group-section.tsx", import.meta.url),
  "utf8",
);

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("remote recent projects source", () => {
  test("parks remote close actions in Recent Projects instead of removing them", () => {
    /*
     * CDXC:RemoteRecentProjects 2026-06-24-10:36:
     * Remote Close Project should be a local parking action so users can
     * restore it from Recent Projects; remote removeProject remains reserved
     * for explicit Remove Project actions.
     */
    const closeRemoteSource = sourceBetween(
      nativeSidebarSource,
      "function closeRemoteProjectToRecentForGroup",
      "async function renameRemotePresentationProjectForGroup",
    );
    expect(closeRemoteSource).toContain("RemoteRecentProjectState");
    expect(closeRemoteSource).toContain("writeStoredRemoteRecentProjects");
    expect(closeRemoteSource).toContain("publish();");
    expect(closeRemoteSource).not.toContain('"/api/removeProject"');

    const closeCaseSource = sourceBetween(
      nativeSidebarSource,
      '    case "closeWorkspaceProjectForGroup":',
      '    case "removeWorkspaceProjectForGroup":',
    );
    expect(closeCaseSource).toContain("closeRemoteProjectToRecentForGroup(message.groupId)");
    expect(closeCaseSource).not.toContain("removeRemotePresentationProjectForGroup");

    const remoteProjectionSource = sourceBetween(
      nativeSidebarSource,
      "function createRemoteMachinePresentationSidebarGroups",
      "function createRemotePresentationSessionsByProjectFromGroups",
    );
    expect(remoteProjectionSource).toContain("isRemoteProjectClosedToRecent(machineId, project.projectId)");
  });

  test("renders remote recent project rows with the machine suffix", () => {
    /*
     * CDXC:RemoteRecentProjects 2026-06-24-10:36:
     * Recent Projects rows must distinguish closed remote projects by appending
     * the machine name after the project name.
     */
    const closeEligibilitySource = sourceBetween(
      sessionGroupSectionSource,
      "const canCloseProject =",
      "  useEffect(() => {",
    );
    expect(closeEligibilitySource).toContain("group.remoteMachineContext");
    expect(closeEligibilitySource).toContain("projectContext?.canRemoveProject === true");

    const recentTitleSource = sourceBetween(
      sidebarAppSource,
      "function formatRecentProjectTitle",
      "function createWorkspaceSessionIdsByGroup",
    );
    expect(recentTitleSource).toContain("project.remoteMachineName");
    expect(recentTitleSource).toContain("`${project.title} (${project.remoteMachineName})`");
  });
});
