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
});
