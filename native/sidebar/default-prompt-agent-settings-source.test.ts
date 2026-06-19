import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");
const modalHostSource = readFileSync(new URL("./modal-host.tsx", import.meta.url), "utf8");

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("default prompt agent settings source", () => {
  test("seeds and syncs the gxserver-owned default prompt agent", () => {
    /*
     * CDXC:GxserverAgentSettings 2026-06-19-08:58:
     * Default Prompt Agent is gxserver-owned. Native startup should migrate the
     * existing sidebar value once, Settings saves should write through
     * gxserver, and gxserver responses should update only the local render cache.
     */
    const startupSnapshot = sourceBetween(
      nativeSidebarSource,
      "async function refreshGxserverStartupSnapshot",
      "function syncSidebarSharedStateFromGxserverSnapshot",
    );
    expect(startupSnapshot).toContain("defaultPromptAgentId: settings.defaultPromptAgentId");

    const syncAgentSettings = sourceBetween(
      nativeSidebarSource,
      "function syncGxserverAgentSettings",
      "function applyGxserverAgentSettingsToLocalSettings",
    );
    expect(syncAgentSettings).toContain(
      "nextSettings.defaultPromptAgentId === previousSettings.defaultPromptAgentId",
    );
    expect(syncAgentSettings).toContain("defaultPromptAgentId: nextSettings.defaultPromptAgentId");

    const applyAgentSettings = sourceBetween(
      nativeSidebarSource,
      "function applyGxserverAgentSettingsToLocalSettings",
      "function syncNativeSidebarSide",
    );
    expect(applyAgentSettings).toContain(
      "settings.defaultPromptAgentId === agentSettings.defaultPromptAgentId",
    );
    expect(applyAgentSettings).toContain("defaultPromptAgentId: agentSettings.defaultPromptAgentId");
  });

  test("does not save modal default settings before native hydrate", () => {
    /*
     * CDXC:GxserverAgentSettings 2026-06-19-08:58:
     * The modal store initializes with DEFAULT_ghostex_SETTINGS. Settings and
     * First Launch should not render as writable until a native hydrate replaces
     * that placeholder with the gxserver-backed settings snapshot.
     */
    expect(modalHostSource).toContain("const revision = useSidebarStore((state) => state.revision);");
    expect(modalHostSource).toContain("const hasNativeSettingsHydrated = revision > 0;");
    expect(modalHostSource).toContain("const isSettingsRenderable = isSettingsModalKind(activeModal) && hasNativeSettingsHydrated;");
    expect(modalHostSource).toContain("hasNativeSettingsHydrated &&");
  });

  test("does not silently fall back to Codex for unavailable default prompt agents", () => {
    /*
     * CDXC:GxserverAgentSettings 2026-06-19-08:58:
     * Prompt-agent launch helpers should surface unavailable saved defaults
     * instead of launching Codex or the first available agent.
     */
    const resolver = sourceBetween(
      nativeSidebarSource,
      "function resolvePromptAgentId",
      "function resolveDefaultPromptAgent",
    );

    expect(resolver).toContain("return undefined;");
    expect(resolver).not.toContain("resolveSidebarAgentButtonById(DEFAULT_PROMPT_AGENT_ID)");
    expect(resolver).not.toContain("agents.find((agent) => agent.agentId !== \"t3\"");
  });
});
