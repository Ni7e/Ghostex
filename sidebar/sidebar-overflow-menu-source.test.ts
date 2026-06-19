import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const sidebarAppSource = readFileSync(new URL("./sidebar-app.tsx", import.meta.url), "utf8");
const titlebarHostSource = readFileSync(
  new URL("../native/sidebar/titlebar-host.tsx", import.meta.url),
  "utf8",
);
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

describe("titlebar settings menu source", () => {
  test("moves the sidebar overflow actions into a native titlebar settings dropdown", () => {
    /*
     * CDXC:TitlebarSettingsMenu 2026-06-18-23:28:
     * The old sidebar overflow trigger is removed; the far-right titlebar Settings menu is a native dropdown kind that opens on left click and owns the requested global actions.
     */
    expect(titlebarHostSource).toContain('| "settings"');
    expect(titlebarHostSource).toContain('rawKind === "settings"');
    expect(titlebarHostSource).toContain('className="titlebar-open-group titlebar-settings-group"');
    expect(titlebarHostSource).toContain('showTitlebarDropdownPanel("settings", event.currentTarget)');
    expect(titlebarHostSource).toContain("<IconMenu2");
    expect(titlebarHostSource).toContain(".titlebar-settings-menu-button");
    expect(titlebarHostSource).toContain("width: 45px;");
    expect(titlebarHostSource).toContain("padding-right: 15px;");
    expect(sidebarAppSource).not.toContain("function renderFloatingOverflowMenu(");
    expect(sidebarAppSource).not.toContain('aria-label="Open sidebar menu"');
  });

  test("keeps the requested settings menu order with right-aligned shortcuts", () => {
    const settingsMenuSource = sourceBetween(
      titlebarHostSource,
      '{kind === "settings" ? (',
      '{kind === "openIn" ? (',
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
    expect(settingsMenuSource).toContain("settingsMenuHotkeys.openSettings");
    expect(settingsMenuSource).toContain("settingsMenuHotkeys.openHotkeys");
    expect(settingsMenuSource).toContain("settingsMenuHotkeys.openCommandPalette");
    expect(titlebarHostSource).toContain("titlebar-settings-menu-shortcut");
    expect(titlebarHostSource).toContain("grid-template-columns: 18px minmax(0, 1fr) auto;");
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
