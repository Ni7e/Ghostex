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

describe("gxserver renderer command target source", () => {
  test("matches raw gxserver session targets against combined sidebar ids", () => {
    /*
    CDXC:GxserverRendererCommands 2026-06-21-19:22:
    Renderer-only CLI commands such as generated-title rename receive raw
    project-scoped gxserver targets. Source coverage keeps the macOS executor
    resolving those targets to combined sidebar presentation ids before it
    reports "No matching session was found."
    */
    const targetSource = sourceBetween(
      nativeSidebarSource,
      "function findSidebarSessionByCliTarget",
      "function parseCliGlobalSessionRef",
    );
    expect(targetSource).toContain("createCombinedProjectSessionId(projectId, sessionId)");
    expect(targetSource).toContain("parseCombinedProjectSessionId(session.sessionId)");
    expect(targetSource).toContain("reference?.projectId === projectId && reference.sessionId === sessionId");

    const requireSource = sourceBetween(
      nativeSidebarSource,
      "function requireCliSession",
      "function readCliSessionTarget",
    );
    expect(requireSource).toContain("const sessionTarget = readCliSessionTarget(payload);");
    expect(requireSource).toContain('readUnknownRecordString(sessionTarget, "projectId")');
    expect(requireSource).toContain('readUnknownRecordString(sessionTarget, "sessionId")');
  });
});
