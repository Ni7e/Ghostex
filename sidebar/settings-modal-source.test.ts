import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const settingsModalSource = readFileSync(new URL("./settings-modal.tsx", import.meta.url), "utf8");

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("settings modal source", () => {
  test("keeps Show Advanced inside the Settings section sidebar", () => {
    /*
     * CDXC:SettingsNavigation 2026-06-19-08:40:
     * The macOS Settings section list and Show Advanced filter should render
     * as one sidebar surface, not as separate floating controls.
     */
    const settingsSidebar = sourceBetween(
      settingsModalSource,
      '<aside aria-label="Settings sections" className="settings-section-sidebar">',
      "</aside>",
    );
    expect(settingsSidebar).toContain("settings-section-sidebar-list");
    expect(settingsSidebar).toContain("settings-section-sidebar-footer");
    expect(settingsSidebar).toContain("Show Advanced");
    expect(settingsModalSource).not.toContain("settings-show-advanced-anchor");
  });

  test("keeps hook and skill uninstall controls in a searchable advanced bottom section", () => {
    /*
     * CDXC:SettingsAdvanced 2026-06-18-02:54:
     * Hooks & Skills uninstall controls belong at the bottom of General
     * Settings, hidden behind Show Advanced during browsing while remaining
     * searchable by uninstall hooks and uninstall skills.
     */
    const navigation = sourceBetween(
      settingsModalSource,
      "const mainSettingsSectionNavigation",
      "const hasVisibleMainSettings",
    );
    expect(navigation).toMatch(/title: "Debugging"[\s\S]*title: "Hooks & Skills"/u);
    expect(settingsModalSource).toContain('hooksSkills: ["uninstallAgentHooks", "uninstallBundledAgentSkills"]');
    expect(settingsModalSource).toContain('title: "Uninstall hooks"');
    expect(settingsModalSource).toContain('title: "Uninstall skills"');
    expect(settingsModalSource).toContain('"uninstallAgentHooks"');
    expect(settingsModalSource).toContain('"uninstallBundledAgentSkills"');
    expect(settingsModalSource).toContain('title="Hooks & Skills"');
    expect(settingsModalSource).toContain('Uninstall Hooks');
    expect(settingsModalSource).toContain('Uninstall Skills');
  });

  test("shows unavailable gxserver-owned default prompt agents without selecting Codex", () => {
    /*
     * CDXC:GxserverAgentSettings 2026-06-19-08:58:
     * Settings must preserve and display a gxserver-owned Default Prompt Agent
     * even when the local launcher registry cannot currently provide a command.
     * Showing an unavailable row is preferable to visually falling back to Codex.
     */
    const agentsTab = sourceBetween(
      settingsModalSource,
      "function AgentsSettingsTab",
      "function AgentHookStatusRow",
    );

    expect(agentsTab).toContain("const promptAgentSelectOptions = promptAgentHasSavedDefault");
    expect(agentsTab).toContain("Unavailable (${normalizedDefaultPromptAgentId})");
    expect(agentsTab).toContain("const selectedDefaultPromptAgentId = normalizedDefaultPromptAgentId;");
    expect(agentsTab).not.toContain("promptAgentOptions.find");
  });
});
