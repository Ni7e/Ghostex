import { describe, expect, test } from "vitest";
import type { TerminalSessionRecord } from "../../shared/session-grid-contract";
import { createLocalPersistableSessionRecord } from "./native-project-local-persistence";

describe("native project local persistence", () => {
  test("keeps only macOS-local placement fields for canonical gxserver sessions", () => {
    /*
    CDXC:ProjectSidebarOwnership 2026-06-02-19:07:
    Native owns the current-window pane/tab layout after the gxserver split. Canonical G-session local persistence may keep placement fields and the macOS-owned delayed-send timer deadline, while gxserver-owned identity, title, lifecycle, provider, agent, pin, and favorite fields must be stripped at the writer boundary.
    */
    const session: TerminalSessionRecord = {
      agentName: "codex",
      agentSessionId: "conversation-id",
      agentSessionPath: "/private/thread.jsonl",
      alias: "Stale Alias",
      closeAfterDone: true,
      column: 2,
      commandTitle: "Stale Command",
      createdAt: "2026-06-02T10:00:00.000Z",
      delayedSendDeadlineAt: "2026-06-02T10:05:00.000Z",
      displayId: "old-display",
      isFavorite: true,
      isPinned: true,
      isPoppedOut: true,
      isSleeping: true,
      kind: "terminal",
      lastAccessedAt: "2026-06-02T10:03:00.000Z",
      lastActivityAt: "2026-06-02T10:04:00.000Z",
      lastStartedAt: "2026-06-02T10:02:00.000Z",
      restoreActivity: "working",
      row: 1,
      sessionId: "G1abc",
      sessionPersistenceName: "P1abc-G1abc",
      sessionPersistenceProvider: "zmx",
      slotIndex: 4,
      surface: "workspace",
      terminalEngine: "ghostty-native",
      title: "Stale Title",
      titleSource: "user",
    };

    const persisted = createLocalPersistableSessionRecord(session);

    expect(persisted).toMatchObject({
      alias: "Terminal Session",
      closeAfterDone: true,
      column: 2,
      createdAt: "1970-01-01T00:00:00.000Z",
      delayedSendDeadlineAt: "2026-06-02T10:05:00.000Z",
      displayId: "G1abc",
      isPoppedOut: true,
      kind: "terminal",
      row: 1,
      sessionId: "G1abc",
      slotIndex: 4,
      surface: "workspace",
      terminalEngine: "ghostty-native",
      title: "Terminal Session",
      titleSource: "placeholder",
    });
    expect("agentName" in persisted).toBe(false);
    expect("agentSessionId" in persisted).toBe(false);
    expect("agentSessionPath" in persisted).toBe(false);
    expect("commandTitle" in persisted).toBe(false);
    expect("isFavorite" in persisted).toBe(false);
    expect("isPinned" in persisted).toBe(false);
    expect("isSleeping" in persisted).toBe(false);
    expect("lastAccessedAt" in persisted).toBe(false);
    expect("lastActivityAt" in persisted).toBe(false);
    expect("lastStartedAt" in persisted).toBe(false);
    expect("restoreActivity" in persisted).toBe(false);
    expect("sessionPersistenceName" in persisted).toBe(false);
    expect("sessionPersistenceProvider" in persisted).toBe(false);
  });

  test("leaves non-gxserver local terminal sessions untouched", () => {
    const session: TerminalSessionRecord = {
      alias: "Local Terminal",
      column: 0,
      createdAt: "2026-06-02T10:00:00.000Z",
      displayId: "1",
      isSleeping: true,
      kind: "terminal",
      row: 0,
      sessionId: "session-1",
      slotIndex: 0,
      terminalEngine: "ghostty-native",
      title: "Local Terminal",
      titleSource: "user",
    };

    expect(createLocalPersistableSessionRecord(session)).toBe(session);
  });
});
