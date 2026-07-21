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

describe("native auto sleep split protection", () => {
  test("builds protected project/session keys from all project pane layouts", () => {
    /*
     * CDXC:AutoSleep 2026-06-09-20:33:
     * Auto Sleep must protect selected split owners across every project, plus
     * visible command-panel owners and popped-out panes, before choosing idle
     * agent terminals to retire.
     */
    const protectedKeyCollector = sourceBetween(
      nativeSidebarSource,
      "function collectAutoSleepProtectedProjectSessionKeys",
      "function autoSleepProjectSessionKey",
    );

    expect(protectedKeyCollector).toContain("for (const project of projects)");
    expect(protectedKeyCollector).toContain("for (const group of project.workspace.groups)");
    expect(protectedKeyCollector).toContain(
      "collectActivePaneOwnerSessionIds(group.snapshot.paneLayout",
    );
    expect(protectedKeyCollector).toContain("project.commandsPanel.isVisible === true");
    expect(protectedKeyCollector).toContain("project.commandsPanel.activeSessionId");
    expect(protectedKeyCollector).toContain("session.isPoppedOut === true");
  });

  test("checks split protection before agent auto sleep eligibility", () => {
    const autoSleepMonitor = sourceBetween(
      nativeSidebarSource,
      'function runNativeAutoSleepMonitor(source: "interval" | "settings-change" | "startup")',
      "function shouldAutoSleepAgentSession",
    );
    expect(autoSleepMonitor).toContain(
      "const protectedProjectSessionKeys = collectAutoSleepProtectedProjectSessionKeys()",
    );
    expect(autoSleepMonitor.match(/protectedProjectSessionKeys,/g)?.length).toBeGreaterThanOrEqual(2);

    const eligibility = sourceBetween(
      nativeSidebarSource,
      "function shouldAutoSleepAgentSession",
      "function collectAutoSleepProtectedProjectSessionKeys",
    );
    expect(eligibility).toContain("protectedProjectSessionKeys: ReadonlySet<string>");
    expect(eligibility).toContain(
      "protectedProjectSessionKeys.has(autoSleepProjectSessionKey(project.projectId, session.sessionId))",
    );
  });
});
