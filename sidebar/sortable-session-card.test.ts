import { describe, expect, test } from "vitest";
import type { SidebarSessionItem } from "../shared/session-grid-contract";
import {
  canSleepSidebarSession,
  createSleepBelowDebugDetails,
  getSessionCardAccessibleLabel,
  getSessionTagSubmenuSections,
  resolveSessionCardSessionIdsBelow,
  runSidebarBulkContextMenuActionInBackground,
} from "./sortable-session-card";

describe("getSessionCardAccessibleLabel", () => {
  test("keeps session row labels independent from focused styling", () => {
    expect(
      getSessionCardAccessibleLabel({
        isFocused: false,
        title: "Fix sidebar session rows",
      }),
    ).toBe("Fix sidebar session rows");

    expect(
      getSessionCardAccessibleLabel({
        isFocused: true,
        title: "Fix sidebar session rows",
      }),
    ).toBe("Fix sidebar session rows, current session");
  });

  test("falls back to a stable label when the title is empty", () => {
    expect(
      getSessionCardAccessibleLabel({
        isFocused: false,
        title: " ",
      }),
    ).toBe("Session");
  });
});

describe("getSessionTagSubmenuSections", () => {
  test("uses default enabled and visible tag rows for the Tag as menu", () => {
    /*
     * CDXC:SessionTagFilters 2026-06-15-22:23:
     * Session context-menu tagging should mirror the Settings-controlled
     * sidebar tag list so Reset to Default removes default-off tags from both
     * the filter menu and the Tag as assignment submenu.
     */
    expect(
      getSessionTagSubmenuSections({})
        .flatMap((section) => section.options.map((option) => option.value)),
    ).toEqual([
      "favorite",
      "in-progress",
      "testing",
      "blocked",
      "on-hold",
      "done",
      "research",
      "design",
    ]);
  });

  test("keeps the current hidden tag visible so it can be removed", () => {
    expect(
      getSessionTagSubmenuSections({ currentSessionTag: "bug" })
        .flatMap((section) => section.options.map((option) => option.value)),
    ).toEqual([
      "favorite",
      "in-progress",
      "testing",
      "blocked",
      "on-hold",
      "done",
      "research",
      "bug",
      "design",
    ]);
  });
});

describe("runSidebarBulkContextMenuActionInBackground", () => {
  test("defers each bulk target onto the scheduler", () => {
    const queuedOperations: Array<() => void> = [];
    const processedSessionIds: string[] = [];

    runSidebarBulkContextMenuActionInBackground(
      ["session-2", "session-3"],
      (sessionId) => {
        processedSessionIds.push(sessionId);
      },
      (operation) => {
        queuedOperations.push(operation);
      },
    );

    expect(processedSessionIds).toEqual([]);
    expect(queuedOperations).toHaveLength(1);

    queuedOperations.shift()?.();
    expect(processedSessionIds).toEqual(["session-2"]);
    expect(queuedOperations).toHaveLength(1);

    queuedOperations.shift()?.();
    expect(processedSessionIds).toEqual(["session-2", "session-3"]);
    expect(queuedOperations).toHaveLength(0);
  });

  test("uses the clicked menu target list even if the caller mutates its array later", () => {
    const queuedOperations: Array<() => void> = [];
    const processedSessionIds: string[] = [];
    const sessionIds = ["session-2"];

    runSidebarBulkContextMenuActionInBackground(
      sessionIds,
      (sessionId) => {
        processedSessionIds.push(sessionId);
      },
      (operation) => {
        queuedOperations.push(operation);
      },
    );
    sessionIds.push("session-3");

    queuedOperations.shift()?.();

    expect(processedSessionIds).toEqual(["session-2"]);
    expect(queuedOperations).toHaveLength(0);
  });
});

describe("resolveSessionCardSessionIdsBelow", () => {
  test("keeps below actions scoped to the group-provided session list", () => {
    expect(
      resolveSessionCardSessionIdsBelow({
        contextMenuSessionIdsBelow: [],
        isContextMenuOpen: false,
        sessionIdsBelow: ["same-project-2", "same-project-3"],
      }),
    ).toEqual(["same-project-2", "same-project-3"]);
  });

  test("uses the clicked menu snapshot while the context menu is open", () => {
    expect(
      resolveSessionCardSessionIdsBelow({
        contextMenuSessionIdsBelow: ["snapshot-session"],
        isContextMenuOpen: true,
        sessionIdsBelow: ["rerendered-session"],
      }),
    ).toEqual(["snapshot-session"]);
  });
});

describe("createSleepBelowDebugDetails", () => {
  test("keeps Sleep below lag diagnostics free of user-owned content", () => {
    const details = createSleepBelowDebugDetails({
      clickedSessionKind: "terminal",
      debugInstanceId: 42,
      elapsedSinceRequestMs: 12.34,
      event: "posted",
      flushDurationMs: 4.44,
      frameDelayMs: 17.19,
      postMessageDurationMs: 3.91,
      resolveDurationMs: 2.24,
      skippedCount: 1,
      sourceIndex: 3,
      targetCount: 5,
      visibleBelowCount: 6,
    });

    expect(details).toEqual({
      action: "sleepBelow",
      clickedSessionKind: "terminal",
      debugInstanceId: 42,
      elapsedSinceRequestMs: 12.3,
      event: "posted",
      flushDurationMs: 4.4,
      frameDelayMs: 17.2,
      postMessageDurationMs: 3.9,
      resolveDurationMs: 2.2,
      skippedCount: 1,
      sourceIndex: 3,
      targetCount: 5,
      visibleBelowCount: 6,
    });
    expect(Object.keys(details).sort()).not.toEqual(
      expect.arrayContaining([
        "command",
        "message",
        "path",
        "sessionId",
        "sessionIds",
        "text",
        "title",
        "url",
      ]),
    );
  });
});

describe("canSleepSidebarSession", () => {
  const baseSession: SidebarSessionItem = {
    activity: "idle",
    alias: "Session 1",
    isRunning: true,
    isSleeping: false,
    kind: "terminal",
    lifecycleState: "running",
    primaryTitle: "Session 1",
    sessionId: "session-1",
    sessionKind: "terminal",
  };

  test("skips already sleeping sessions from bulk sleep actions", () => {
    expect(canSleepSidebarSession(baseSession)).toBe(true);
    expect(canSleepSidebarSession({ ...baseSession, isSleeping: true })).toBe(false);
    expect(canSleepSidebarSession({ ...baseSession, lifecycleState: "sleeping" })).toBe(false);
  });
});
