import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createNativeSidebarGxserverClient,
  parseNativeGxserverResponse,
} from "./gxserver-client";

describe("native sidebar gxserver client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("sends authenticated protocol-versioned health and RPC requests from native bootstrap", async () => {
    /*
    CDXC:GxserverVerification 2026-05-30-18:37:
    The macOS React sidebar client wrapper is part of the hard cutover contract. It must consume native bootstrap auth, send gxserver protocol headers, build RPC envelopes, and reject protocol drift instead of routing shared state through the retired app-owned backend.
    */
    const requests: Array<{ body?: unknown; headers: Record<string, string>; method: string; url: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const headers = normalizeHeaders(init?.headers);
        const bodyText = typeof init?.body === "string" ? init.body : undefined;
        requests.push({
          body: bodyText ? JSON.parse(bodyText) : undefined,
          headers,
          method: init?.method ?? "GET",
          url,
        });

        if (url.endsWith("/api/health/server")) {
          return jsonResponse({
            capabilities: [],
            listeners: {
              local: { enabled: true, host: "127.0.0.1", kind: "local", port: 58744 },
              remote: { auth: { mode: "bearerToken", required: true }, enabled: false, host: "0.0.0.0", kind: "remote", port: 58745 },
            },
            migration: { appliedMigrations: [], currentVersion: 2, stateDbFile: "/tmp/state.db" },
            ok: true,
            pid: 123,
            port: 58744,
            product: "gxserver",
            protocolVersion: 1,
            serverId: "S7k",
            startedAt: "2026-05-30T10:00:00.000Z",
            tools: [],
            version: "0.1.0-test",
          });
        }
        if (url.endsWith("/api/listProjects")) {
          return jsonResponse({
            ok: true,
            product: "gxserver",
            protocolVersion: 1,
            requestId: "projects-request",
            result: { projects: [] },
          });
        }
        if (url.endsWith("/api/readAgentSettings")) {
          return jsonResponse({
            ok: true,
            product: "gxserver",
            protocolVersion: 1,
            requestId: "agent-settings-request",
            result: {
              isPersisted: true,
              settings: { agentAcceptAllEnabled: true, defaultPromptAgentId: "claude" },
            },
          });
        }
        if (url.endsWith("/api/readAppUserData")) {
          return jsonResponse({
            ok: true,
            product: "gxserver",
            protocolVersion: 1,
            requestId: "app-user-data-request",
            result: {
              pinnedPrompts: [],
              scratchPadContent: "",
            },
          });
        }
        if (url.endsWith("/api/readPresentationSnapshot")) {
          return jsonResponse({
            ok: true,
            product: "gxserver",
            protocolVersion: 1,
            requestId: "presentation-request",
            result: {
              snapshot: {
                generatedAt: "2026-06-02T07:16:00.000Z",
                groups: [],
                projects: [],
                revision: 1,
                sessions: [],
              },
            },
          });
        }
        throw new Error(`Unexpected request ${url}`);
      }),
    );

    const client = createNativeSidebarGxserverClient({
      authToken: "token-123",
      baseUrl: "http://127.0.0.1:60000",
    });
    const snapshot = await client.fetchStartupSnapshot();

    expect(snapshot.agentSettings).toEqual({
      agentAcceptAllEnabled: true,
      defaultPromptAgentId: "claude",
    });
    expect(snapshot.projects).toEqual([]);
    expect(snapshot.presentation?.sessions).toEqual([]);
    expect(snapshot.appUserData).toEqual({
      pinnedPrompts: [],
      scratchPadContent: "",
    });
    expect(requests.map((request) => request.url)).toEqual([
      "http://127.0.0.1:60000/api/health/server",
      "http://127.0.0.1:60000/api/readAgentSettings",
      "http://127.0.0.1:60000/api/readAppUserData",
      "http://127.0.0.1:60000/api/listProjects",
      "http://127.0.0.1:60000/api/readPresentationSnapshot",
    ]);
    for (const request of requests) {
      expect(request.headers.authorization).toBe("Bearer token-123");
      expect(request.headers["x-gxserver-protocol-version"]).toBe("1");
    }
    expect(requests[1].body).toEqual({ params: {}, protocolVersion: 1 });
    expect(requests[2].body).toEqual({ params: {}, protocolVersion: 1 });
    expect(requests[3].body).toEqual({ params: {}, protocolVersion: 1 });
    expect(requests[4].body).toEqual({ params: {}, protocolVersion: 1 });
  });

  test("updates bootstrap from native status events and hard-fails protocol mismatch", async () => {
    const client = createNativeSidebarGxserverClient({
      authToken: "old-token",
      baseUrl: "http://127.0.0.1:58744",
    });
    expect(
      client.applyNativeStatus(
        JSON.stringify({
          authToken: "new-token",
          baseUrl: "http://127.0.0.1:60001",
          protocolVersion: 1,
        }),
      ),
    ).toMatchObject({ authToken: "new-token" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe("http://127.0.0.1:60001/api/listSessions");
        expect(normalizeHeaders(init?.headers).authorization).toBe("Bearer new-token");
        return jsonResponse({
          ok: true,
          product: "gxserver",
          protocolVersion: 999,
          requestId: "bad-protocol",
          result: { sessions: [] },
        });
      }),
    );

    await expect(client.rpc("/api/listSessions")).rejects.toThrow(/Update Ghostex and gxserver/);
  });

  test("uses native bootstrap daemon status before host events arrive", () => {
    /*
    CDXC:GxserverVerification 2026-06-07-12:02:
    Local startup gating must see the first native daemon status from injected bootstrap data because the follow-up host event can arrive before the sidebar message listener is active.
    */
    const client = createNativeSidebarGxserverClient({
      authToken: "token-123",
      baseUrl: "http://127.0.0.1:60000",
      message: "gxserver is running and uses the expected protocol.",
      ok: true,
      protocolVersion: 1,
      state: "running",
    });

    expect(client.getCurrentStatus()).toMatchObject({
      authToken: "token-123",
      baseUrl: "http://127.0.0.1:60000",
      ok: true,
      state: "running",
    });
  });

  test("routes arbitrary path Git-root lookup through gxserver RPC", async () => {
    const requests: Array<{ body?: unknown; headers: Record<string, string>; method: string; url: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const bodyText = typeof init?.body === "string" ? init.body : undefined;
        requests.push({
          body: bodyText ? JSON.parse(bodyText) : undefined,
          headers: normalizeHeaders(init?.headers),
          method: init?.method ?? "GET",
          url,
        });
        return jsonResponse({
          ok: true,
          product: "gxserver",
          protocolVersion: 1,
          requestId: "resolve-git-root",
          result: { gitRoot: "/tmp/example-repo" },
        });
      }),
    );

    /*
    CDXC:GxserverVerification 2026-06-02-12:14:
    Native CLI open-path routing must call gxserver's local-only repository fact endpoint instead of shelling out to Git in the macOS app. The client test pins the RPC envelope so UI code has one ownership-compliant path.
    */
    const client = createNativeSidebarGxserverClient({
      authToken: "token-123",
      baseUrl: "http://127.0.0.1:60000",
    });
    await expect(client.resolveGitRootForPath({ path: "/tmp/example-repo/src" })).resolves.toEqual({
      gitRoot: "/tmp/example-repo",
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("http://127.0.0.1:60000/api/resolveGitRootForPath");
    expect(requests[0].method).toBe("POST");
    expect(requests[0].headers.authorization).toBe("Bearer token-123");
    expect(requests[0].headers["x-gxserver-protocol-version"]).toBe("1");
    expect(requests[0].body).toEqual({
      params: { path: "/tmp/example-repo/src" },
      protocolVersion: 1,
    });
  });

  test("starts a missing zmx provider through the typed local gxserver RPC", async () => {
    /*
    CDXC:GxserverVerification 2026-06-08-20:49:
    Local macOS zmx restore must start missing providers through gxserver before native attaches Ghostty. Pin the sidebar client envelope so restore code can use a typed `/api/startSessionProvider` call instead of queuing startup scripts for terminalReady.
    */
    const requests: Array<{ body?: unknown; headers: Record<string, string>; method: string; url: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const bodyText = typeof init?.body === "string" ? init.body : undefined;
        requests.push({
          body: bodyText ? JSON.parse(bodyText) : undefined,
          headers: normalizeHeaders(init?.headers),
          method: init?.method ?? "GET",
          url: String(input),
        });
        return jsonResponse({
          ok: true,
          product: "gxserver",
          protocolVersion: 1,
          requestId: "start-provider",
          result: {
            provider: "zmx",
            providerState: {
              lifecycleState: "exists",
              probedAt: "2026-06-08T16:49:00.000Z",
              zmxName: "S1a-P1a-G1a",
            },
            session: {
              createdAt: "2026-06-08T16:49:00.000Z",
              kind: "terminal",
              lifecycleState: "running",
              projectId: "P1a",
              sessionId: "G1a",
              surface: "workspace",
              title: "Codex",
              updatedAt: "2026-06-08T16:49:00.000Z",
            },
            started: true,
            startupTextDisposition: "queueAfterTerminalReady",
            zmxName: "S1a-P1a-G1a",
          },
        });
      }),
    );

    const client = createNativeSidebarGxserverClient({
      authToken: "token-123",
      baseUrl: "http://127.0.0.1:60000",
    });
    const result = await client.startSessionProvider({
      projectId: "P1a" as never,
      sessionId: "G1a" as never,
      startupText: " codex resume abc\r",
    });

    expect(result.started).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("http://127.0.0.1:60000/api/startSessionProvider");
    expect(requests[0].method).toBe("POST");
    expect(requests[0].headers.authorization).toBe("Bearer token-123");
    expect(requests[0].headers["x-gxserver-protocol-version"]).toBe("1");
    expect(requests[0].body).toEqual({
      params: {
        projectId: "P1a",
        sessionId: "G1a",
        startupText: " codex resume abc\r",
      },
      protocolVersion: 1,
    });
  });

  test("formats WebKit Load failed as a user-facing gxserver action error", async () => {
    /*
    CDXC:GxserverVerification 2026-06-08-19:24:
    gxserver fetch transport errors are toast-facing in several native sidebar flows. They must name the failed product action and must not expose WebKit `Load failed`, internal API paths, or loopback URLs to users.
    */
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Load failed");
      }),
    );
    const client = createNativeSidebarGxserverClient({
      authToken: "token-123",
      baseUrl: "http://127.0.0.1:60000",
    });

    const request = client.fetchAttachSessionMetadata({
      projectId: "P1a" as never,
      sessionId: "G1a" as never,
      startupText: "",
    }).catch((error: unknown) => error);
    await vi.runAllTimersAsync();

    const error = await request;
    expect(error).toBeInstanceOf(Error);
    const message = error instanceof Error ? error.message : String(error);
    expect(message).toBe(
      "Could not prepare the terminal attach command. gxserver did not respond. Try again; if it keeps failing, restart gxserver.",
    );
    expect(message).not.toContain("Load failed");
    expect(message).not.toContain("/api/attachSessionMetadata");
    expect(message).not.toContain("127.0.0.1");
  });

  test("formats native bridge gxserver transport errors without raw endpoint diagnostics", () => {
    expect(() =>
      parseNativeGxserverResponse({
        error: "Remote gxserver request timed out",
        ok: false,
        path: "/api/browseProjectDirectories",
        requestId: "bridge-request",
        type: "gxserverResponse",
      }),
    ).toThrow(
      "Could not browse project folders. gxserver did not respond before the timeout. Try again; if it keeps failing, restart gxserver.",
    );
    try {
      parseNativeGxserverResponse({
        error: "Remote gxserver request timed out",
        ok: false,
        path: "/api/browseProjectDirectories",
        requestId: "bridge-request",
        type: "gxserverResponse",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("/api/browseProjectDirectories");
    }
  });

  test("notifies presentation handlers only for unexpected websocket close", () => {
    /*
    CDXC:GxserverVerification 2026-06-03-19:56:
    The macOS presentation client must distinguish a dropped gxserver event stream from caller-owned teardown. Unexpected close triggers snapshot recovery, while deliberate close during app shutdown must not start a stale resubscribe loop.
    */
    const sockets: MockPresentationWebSocket[] = [];
    vi.stubGlobal(
      "WebSocket",
      class extends MockPresentationWebSocket {
        constructor(url: string) {
          super(url);
          sockets.push(this);
        }
      },
    );
    const client = createNativeSidebarGxserverClient({
      authToken: "token-123",
      baseUrl: "http://127.0.0.1:60000",
    });
    const onClose = vi.fn();

    client.subscribePresentation("native-sidebar-test", { onClose }, 42);
    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toBe("ws://127.0.0.1:60000/api/events?protocolVersion=1&authToken=token-123");
    sockets[0].open();
    expect(JSON.parse(sockets[0].sent[0])).toEqual({
      clientId: "native-sidebar-test",
      lastRevision: 42,
      type: "subscribePresentation",
    });
    sockets[0].drop();
    expect(onClose).toHaveBeenCalledTimes(1);

    const deliberate = client.subscribePresentation("native-sidebar-test", { onClose }, 43);
    expect(sockets).toHaveLength(2);
    deliberate.close();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

class MockPresentationWebSocket extends EventTarget {
  readonly sent: string[] = [];

  constructor(readonly url: string) {
    super();
  }

  close(): void {
    this.dispatchEvent(new Event("close"));
  }

  drop(): void {
    this.dispatchEvent(new Event("close"));
  }

  open(): void {
    this.dispatchEvent(new Event("open"));
  }

  send(payload: string): void {
    this.sent.push(payload);
  }
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const normalized: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => {
    normalized[key.toLowerCase()] = value;
  });
  return normalized;
}
