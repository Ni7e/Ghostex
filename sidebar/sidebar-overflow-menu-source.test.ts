import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const sidebarAppSource = readFileSync(new URL("./sidebar-app.tsx", import.meta.url), "utf8");
const groupPanelsCssSource = readFileSync(
  new URL("./styles/group-panels.css", import.meta.url),
  "utf8",
);

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("sidebar settings menu source", () => {
  test("keeps the requested settings menu order with right-aligned shortcuts", () => {
    const settingsMenuSource = sourceBetween(
      sidebarAppSource,
      "function SidebarReferenceSettingsDropdown({",
      "function SidebarReferenceKeepAwakeDropdown({",
    );
    const expectedLabels = [
      'label="Settings"',
      'label="Hotkeys"',
      'label="Commands"',
      'label="Wake Pet"',
      'label="Join Discord"',
    ];

    for (let index = 1; index < expectedLabels.length; index += 1) {
      expect(settingsMenuSource.indexOf(expectedLabels[index - 1])).toBeLessThan(
        settingsMenuSource.indexOf(expectedLabels[index]),
      );
    }
    expect(settingsMenuSource).toContain("hotkeys.openSettings");
    expect(settingsMenuSource).toContain("hotkeys.openHotkeys");
    expect(settingsMenuSource).toContain("hotkeys.openCommandPalette");
    expect(groupPanelsCssSource).toContain("reference-sidebar-primary-menu-shortcut");
    expect(groupPanelsCssSource).toContain("flex: none;");
    expect(settingsMenuSource).not.toContain("Commands [");
    expect(settingsMenuSource).not.toContain('label="Pinned Prompts"');
    expect(settingsMenuSource).not.toContain('label="Scratch Pad"');
    expect(settingsMenuSource).not.toContain('label="Running"');
    expect(settingsMenuSource).not.toContain("Setup Flow");
    expect(settingsMenuSource).not.toContain("Tutorial Video");
  });

  test("moves the Commands Pane launcher onto Recent Projects", () => {
    const recentProjectsSource = sourceBetween(
      sidebarAppSource,
      'aria-label="Recent Projects"',
      '<GitCommitModal',
    );
    expect(recentProjectsSource).toContain("reference-sidebar-commands-pane-action");
    expect(recentProjectsSource).toContain('aria-label="Show Commands Pane"');
    expect(recentProjectsSource).toContain("createFullWidthTerminalPane();");
    expect(groupPanelsCssSource).toContain(".reference-sidebar-commands-pane-action");
    expect(groupPanelsCssSource).toContain("pointer-events: auto;");
    expect(groupPanelsCssSource).toContain("cannot fall through to the drawer toggle");
    expect(sidebarAppSource).not.toContain("function SidebarReferenceSettingsButton(");
  });
});
