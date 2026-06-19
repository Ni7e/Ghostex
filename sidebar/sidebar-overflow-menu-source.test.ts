import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const sidebarAppSource = readFileSync(new URL("./sidebar-app.tsx", import.meta.url), "utf8");
const titlebarHostSource = readFileSync(
  new URL("../native/sidebar/titlebar-host.tsx", import.meta.url),
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
    expect(sidebarAppSource).not.toContain("function renderFloatingOverflowMenu(");
    expect(sidebarAppSource).not.toContain('aria-label="Open sidebar menu"');
  });

  test("keeps the requested settings menu order and debug-only Running row", () => {
    const settingsMenuSource = sourceBetween(
      titlebarHostSource,
      '{kind === "settings" ? (',
      '{kind === "openIn" ? (',
    );
    const expectedLabels = [
      "<span>Settings</span>",
      "<span>Commands [⌘⇧P]</span>",
      "<span>Hotkeys</span>",
      "<span>Wake Pet</span>",
      "<span>Pinned Prompts</span>",
      "<span>Scratch Pad</span>",
      "<span>Running</span>",
      "<span>Join Discord</span>",
    ];

    for (let index = 1; index < expectedLabels.length; index += 1) {
      expect(settingsMenuSource.indexOf(expectedLabels[index - 1])).toBeLessThan(
        settingsMenuSource.indexOf(expectedLabels[index]),
      );
    }
    expect(settingsMenuSource).toContain("settingsShowRunning ?");
    expect(titlebarHostSource).toContain('postTitlebarSidebarCommand({ type: "refreshDaemonSessions" })');
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
    expect(sidebarAppSource).not.toContain("function SidebarReferenceSettingsButton(");
  });
});
