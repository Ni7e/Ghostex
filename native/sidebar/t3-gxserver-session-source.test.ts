import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");
const gxserverProtocolSource = readFileSync(
  new URL("../../shared/gxserver-protocol.ts", import.meta.url),
  "utf8",
);

describe("T3 gxserver session source contract", () => {
  test("new T3 cards use gxserver identity and keep pending thread ids out of native", () => {
    expect(gxserverProtocolSource).toContain(
      'export type GxserverSessionKind = "terminal" | "agent" | "t3"',
    );
    expect(nativeSidebarSource).toContain("function createGxserverT3RecordForNativeCreate");
    expect(nativeSidebarSource).toContain('kind: "t3"');
    expect(nativeSidebarSource).toContain("sessionId: gxserverSession.sessionId");
    expect(nativeSidebarSource).toContain("function createNativeT3WebPaneCommand");
    expect(nativeSidebarSource).toContain("Pending sidebar thread ids are placeholders only");
    expect(nativeSidebarSource).toContain("const threadId = normalizeNativeT3ThreadId(input.threadId)");
    expect(nativeSidebarSource).toContain("...(threadId ? { threadId } : {})");
  });

  test("resolved T3 thread metadata, title, and lifecycle are synced to gxserver", () => {
    expect(nativeSidebarSource).toContain("function syncGxserverNativeT3Session");
    expect(nativeSidebarSource).toContain("provider: \"t3code\"");
    expect(nativeSidebarSource).toContain("ghostexSessionId");
    expect(nativeSidebarSource).toContain("function handleNativeT3ThreadReady");
    expect(nativeSidebarSource).toContain('"t3-thread-ready"');
    expect(nativeSidebarSource).toContain('"t3-title-sync"');
    expect(nativeSidebarSource).toContain("function setNativeT3SessionSleeping");
    expect(nativeSidebarSource).toContain('"sleep-t3-session"');
    expect(nativeSidebarSource).toContain('"wake-t3-session"');
  });

  test("draft T3 route ids cannot create sibling sidebar sessions", () => {
    expect(nativeSidebarSource).toContain("function isNativeT3DraftRouteThreadId");
    expect(nativeSidebarSource).toContain('startsWith("ghostex-draft-")');

    const changedHandler = nativeSidebarSource.slice(
      nativeSidebarSource.indexOf("async function handleNativeT3ThreadChanged"),
      nativeSidebarSource.indexOf("function restoreNativeBrowserSession"),
    );
    expect(changedHandler.indexOf("isNativeT3DraftRouteThreadId(threadId)")).toBeLessThan(
      changedHandler.indexOf("createNativeT3SessionForBoundThread"),
    );
  });
});
