import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");
const modalHostSource = readFileSync(new URL("./modal-host.tsx", import.meta.url), "utf8");
const contractSource = readFileSync(
  new URL("../../shared/session-grid-contract-sidebar.ts", import.meta.url),
  "utf8",
);
const gxserverClientSource = readFileSync(new URL("./gxserver-client.ts", import.meta.url), "utf8");

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("agent hook status source", () => {
  test("checks requested hook providers one at a time and prioritizes Codex, Claude, and Pi", () => {
    /*
     * CDXC:AgentHooks 2026-06-18-02:38:
     * First-launch can request the full supported hook set while native checks
     * providers one at a time, prioritizing Codex, Claude, and Pi before the
     * secondary agents and posting each partial result as soon as it arrives.
     */
    expect(contractSource).toContain("agentIds?: readonly string[];");
    expect(modalHostSource).toContain("vscode.postMessage({ agentIds, type: \"requestAgentHookStatus\" });");
    expect(modalHostSource).toContain("vscode.postMessage({ agentIds, type: \"installAgentHooks\" });");
    expect(nativeSidebarSource).toContain('const nativeAgentHookPriorityStatusAgentIds = ["codex", "claude", "pi"] as const;');

    const requestStatus = sourceBetween(
      nativeSidebarSource,
      "async function requestNativeAgentHookStatus",
      "function orderedNativeAgentHookStatusAgentIds",
    );
    expect(requestStatus).toContain("for (const agentId of orderedNativeAgentHookStatusAgentIds(agentIds))");
    expect(requestStatus).toContain("gxserverClient.readAgentHookStatus([agentId])");
    expect(requestStatus).toContain("postAgentHookStatus(");
    expect(requestStatus).toContain("mergeAgentHookStatusMessages(latestNativeAgentHookStatus, nextStatus)");

    const orderedStatus = sourceBetween(
      nativeSidebarSource,
      "function orderedNativeAgentHookStatusAgentIds",
      "function mergeAgentHookStatusMessages",
    );
    expect(orderedStatus).toContain("DEFAULT_SIDEBAR_AGENTS.flatMap");
    expect(orderedStatus).toContain("agent.agentId === \"t3\" ? [] : [agent.agentId]");
    expect(orderedStatus).toContain("nativeAgentHookPriorityStatusAgentIds.filter");
  });

  test("wires advanced Settings uninstall actions for hooks and bundled skills", () => {
    /*
     * CDXC:AgentHooks 2026-06-18-02:54:
     * Advanced Settings should expose explicit uninstall actions for Ghostex
     * hooks and bundled Ghostex skills, with hook cleanup routed through
     * gxserver and skill cleanup handled by the native bundled-skill catalog.
     */
    expect(contractSource).toContain('"requestAgentHookStatus"');
    expect(contractSource).toContain('"installAgentHooks"');
    expect(contractSource).toContain('"installAgentHooksFromTitlebarNotice"');
    expect(contractSource).toContain('"uninstallAgentHooks"');
    expect(contractSource).toContain('"uninstallBundledAgentSkills"');
    expect(modalHostSource).toContain('vscode.postMessage({ type: "uninstallAgentHooks" });');
    expect(modalHostSource).toContain('vscode.postMessage({ type: "uninstallBundledAgentSkills" });');
    expect(nativeSidebarSource).toContain("async function uninstallNativeAgentHooksFromSettings");
    expect(nativeSidebarSource).toContain("gxserverClient.uninstallAgentHooks(agentIds)");
    expect(nativeSidebarSource).toContain("async function uninstallNativeBundledAgentSkills");
    expect(nativeSidebarSource).toContain("BUNDLED_GHOSTEX_AGENT_SKILLS.map((skill) => skill.skillName)");
    expect(gxserverClientSource).toContain('"/api/uninstallAgentHooks"');
  });

  test("installs hooks from the titlebar warning with progress and restart toasts", () => {
    /*
     * CDXC:AgentHooks 2026-06-18-03:22:
     * Clicking the titlebar Tips hook warning should install hooks directly,
     * replace the loading toast with completion feedback, and tell users to
     * restart running agent CLI sessions.
     */
    expect(nativeSidebarSource).toContain("async function installNativeAgentHooksFromTitlebarNotice");
    expect(nativeSidebarSource).toContain('showAppToast("info", "Installing agent hooks"');
    expect(nativeSidebarSource).toContain("await gxserverClient.installAgentHooks();");
    expect(nativeSidebarSource).toContain('showAppToast(\n      "success",\n      "Agent hooks installed"');
    expect(nativeSidebarSource).toContain("Please restart all your agent CLI sessions");
    expect(nativeSidebarSource).toContain('case "installAgentHooksFromTitlebarNotice"');
  });
});
