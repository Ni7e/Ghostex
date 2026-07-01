import { describe, expect, test } from "vitest";
import {
  summarizeAutomationErrorForLog,
  summarizeProjectAutomationsForLog,
} from "./automations-debug";

describe("automation diagnostics", () => {
  test("summarizes picker state without serializing private fields", () => {
    const summary = summarizeProjectAutomationsForLog(
      {
        agents: [
          {
            agentId: "custom-secret-agent",
            command: "codex --api-key sk-secret --cwd /Users/alice/private",
            icon: "codex",
            label: "Alice private reviewer",
          },
        ],
        automations: [
          {
            agentId: "custom-secret-agent",
            createdAt: "2026-07-01T00:00:00.000Z",
            enabled: true,
            executionMode: { kind: "local" },
            id: "automation-private-review",
            name: "Review Alice repo",
            projectIds: ["project-private"],
            prompt: "Read https://example.com/private?token=secret and inspect /Users/alice/private",
            schedule: { everyMs: 60_000, kind: "interval" },
            updatedAt: "2026-07-01T00:00:00.000Z",
          },
        ],
        defaultAgentId: "custom-secret-agent",
        projectCanUseWorktrees: false,
        projects: [
          {
            canUseWorktrees: false,
            label: "Alice private repo",
            path: "/Users/alice/private",
            projectId: "project-private",
            worktreeUnavailableReason: "Alice private repo is not inside a Git work tree.",
          },
        ],
        runs: [
          {
            automationId: "automation-private-review",
            createdAt: "2026-07-01T00:00:00.000Z",
            errorMessage: "failed to read /Users/alice/private",
            id: "run-private",
            isArchived: false,
            isUnread: true,
            projectId: "project-private",
            status: "failed",
          },
        ],
        worktreeUnavailableReason: "Alice private repo is not inside a Git work tree.",
      },
      { surface: "overview" },
    );

    const serialized = JSON.stringify(summary);
    expect(summary).toMatchObject({
      agentCount: 1,
      agentsWithCommandCount: 1,
      automationCount: 1,
      defaultAgentKnown: true,
      projectOptionCount: 1,
      runCount: 1,
      worktreeUnavailable: true,
    });
    expect(serialized).not.toContain("Alice");
    expect(serialized).not.toContain("/Users/alice/private");
    expect(serialized).not.toContain("codex --api-key");
    expect(serialized).not.toContain("sk-secret");
    expect(serialized).not.toContain("https://example.com/private");
  });

  test("summarizes errors without serializing messages", () => {
    const error = new Error("failed for /Users/alice/private with token sk-secret");
    error.name = "AutomationStateError";
    const summary = summarizeAutomationErrorForLog(error);

    const serialized = JSON.stringify(summary);
    expect(summary).toMatchObject({
      errorType: "AutomationStateError",
      hasMessage: true,
    });
    expect(serialized).not.toContain("/Users/alice/private");
    expect(serialized).not.toContain("sk-secret");
  });

  test("normalizes unsafe error type names", () => {
    const error = new Error("message");
    error.name = "/Users/alice/private sk-secret";

    expect(summarizeAutomationErrorForLog(error)).toMatchObject({
      errorType: "Error",
    });
  });
});
