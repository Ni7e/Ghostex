import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");

function sourceBetween(start: string, end: string): string {
  const startIndex = nativeSidebarSource.indexOf(start);
  const endIndex = nativeSidebarSource.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return nativeSidebarSource.slice(startIndex, endIndex);
}

describe("native sidebar Quick Git state", () => {
  test("does not probe Git endpoints for Quick session containers", () => {
    /*
     * CDXC:QuickSessions 2026-06-08-08:27:
     * Opening a Quick terminal should create and focus the terminal without a Git-scope error toast. Quick containers are not code projects, so source coverage keeps the local Quick guard before gxserver Git/diff endpoint calls.
     */
    const gitRefreshSource = sourceBetween(
      "async function refreshGitState()",
      "function parseGitNumstat",
    );
    const quickGuardIndex = gitRefreshSource.indexOf("isQuickProject(project)");
    const gitProbeIndex = gitRefreshSource.indexOf(
      'runGxserverGitActionForNativeProject(project, { action: "isInsideWorkTree" })',
    );

    expect(quickGuardIndex).toBeGreaterThanOrEqual(0);
    expect(gitProbeIndex).toBeGreaterThan(quickGuardIndex);
    expect(gitRefreshSource).toContain(
      "gitState = { ...baseState, hasCheckedGitHubRemote: true, isBusy: false, isRepo: false };",
    );

    const visibleDiffSource = sourceBetween(
      "function getVisibleProjectDiffStatsRefreshTargets()",
      "function refreshProjectDiffStatsTarget",
    );
    expect(visibleDiffSource).toContain("!isQuickProject(project)");

    const projectDiffSource = sourceBetween(
      "async function refreshProjectDiffStats",
      "async function refreshRemoteProjectDiffStats",
    );
    expect(projectDiffSource).toContain("if (!project || isQuickProject(project))");
  });

  test("runs project diff stats from staggered background cadence and attention edges", () => {
    /*
     * CDXC:ProjectDiffStats 2026-06-30-19:13:
     * Project-header Git stats should refresh in native background scheduling,
     * not from React hover. Run a staggered 15-second cycle and refresh the
     * owning project immediately when a session transitions into attention.
     */
    expect(nativeSidebarSource).toContain(
      "const PROJECT_DIFF_STATS_BACKGROUND_INTERVAL_MS = 15 * 1000;",
    );

    const schedulerSource = sourceBetween(
      "function startProjectDiffStatsBackgroundRefresh",
      "async function refreshProjectDiffStats",
    );
    expect(schedulerSource).toContain("window.setInterval(");
    expect(schedulerSource).toContain("PROJECT_DIFF_STATS_BACKGROUND_INTERVAL_MS");
    expect(schedulerSource).toContain(
      "const staggerStepMs = PROJECT_DIFF_STATS_BACKGROUND_INTERVAL_MS / targets.length;",
    );
    expect(schedulerSource).toContain("window.setTimeout(");

    const activitySource = sourceBetween(
      "function applyGxserverSessionActivityResult",
      "async function syncNativeSessionActivityWithGxserver",
    );
    expect(activitySource).toContain(
      'if (previousActivity !== "attention" && nextActivity === "attention") {',
    );
    expect(activitySource).toContain("refreshProjectDiffStatsForAttentionSession(sessionId);");
  });
});
