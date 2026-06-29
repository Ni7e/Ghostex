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

describe("sidebar settings menu source", () => {
  test("moves the titlebar settings controls into the sidebar shortcut row", () => {
    /*
     * CDXC:SidebarTopChrome 2026-06-29-01:43:
     * Settings and Keep Awake moved out of the titlebar into normal sidebar dropdown buttons that share the full-width primary shortcut row.
     *
     * CDXC:SidebarTopChrome 2026-06-29-02:13:
     * Search remains below the shortcut row as a borderless full-width button.
     *
     * CDXC:SidebarTopChrome 2026-06-29-02:24:
     * Settings and Keep Awake dropdowns are centered inside the sidebar instead of overflowing from their icon cells.
     *
     * CDXC:SidebarTopChrome 2026-06-29-03:01:
     * The shortcut icon row moves up 14px by removing the old nav top margin, and Search owns a separate top gap.
     *
     * CDXC:SidebarTopChrome 2026-06-29-18:34:
     * Search's top gap matches the 4px gap between shortcut buttons while Quick's first-section extra stays tightened toward Search.
     *
     * CDXC:SidebarTopChrome 2026-06-29-03:05:
     * Shortcut icon buttons are 35px tall so the extra 1px extends downward from the fixed top edge.
     *
     * CDXC:SidebarTopChrome 2026-06-29-16:40:
     * Shortcut icon buttons use titlebar-colored rounded borders with internal-only gaps.
     *
     * CDXC:SidebarTopChrome 2026-06-29-18:10:
     * Search uses the same titlebar-colored rounded border and explicit width math as the shortcut strip so their border edges align.
     *
     * CDXC:SidebarSearch 2026-06-29-21:32:
     * Search is text-only and uses the shared primary-nav left padding again so it aligns with rows below.
     *
     * CDXC:SidebarTopChrome 2026-06-29-03:39:
     * The overflow menu icon should use "More" for its shortcut tooltip while keeping Settings as a dropdown item.
     */
    expect(sidebarAppSource).toContain("function SidebarReferenceSettingsDropdown");
    expect(sidebarAppSource).toContain("function SidebarReferenceKeepAwakeDropdown");
    expect(sidebarAppSource).toContain("icon={IconMenu2}");
    expect(sidebarAppSource).toContain('label="More"');
    expect(sidebarAppSource).toContain('label="Keep awake"');
    expect(sidebarAppSource).toContain('type: "runTitlebarKeepAwakeCommand"');
    expect(groupPanelsCssSource).toContain("--reference-sidebar-primary-shortcut-count");
    expect(groupPanelsCssSource).toContain("column-gap: 4px;");
    expect(groupPanelsCssSource).toContain(`.reference-sidebar-primary-icon-row
  .reference-sidebar-nav-icon-button {
  border: 1px solid var(--titlebar-button-border-color, #252525);
  border-radius: 5px;
  height: 35px;`);
    expect(groupPanelsCssSource).toContain(`> .reference-sidebar-primary-icon-row,
.sidebar-reference-layout[data-reference-sidebar="true"]
  .reference-sidebar-primary-nav
  > .reference-sidebar-search-slot {
  max-width: none;`);
    expect(groupPanelsCssSource).toContain(`.reference-sidebar-search-slot
  .reference-sidebar-nav-button {
  border: 1px solid var(--titlebar-button-border-color, #252525);
  border-radius: 5px;`);
    expect(groupPanelsCssSource).not.toContain(
      "padding-left: calc(4px + var(--reference-sidebar-primary-nav-edge-bleed-left));",
    );
    expect(groupPanelsCssSource).toContain("width: min(220px, calc(100% - 16px));");
    expect(groupPanelsCssSource).toContain("transform: translateX(-50%);");
    expect(groupPanelsCssSource).toContain(`.reference-sidebar-primary-menu-cell {
  position: static;`);
    expect(groupPanelsCssSource).toContain(`.reference-sidebar-primary-nav {
  display: grid;
  gap: 0;`);
    expect(groupPanelsCssSource).toContain(`  margin: 0;
  min-width: 0;`);
    expect(groupPanelsCssSource).toContain(`.reference-sidebar-search-slot {
  margin-top: 4px;
  min-width: 0;`);
    expect(groupPanelsCssSource).toContain("--reference-sidebar-quick-top-extra: -2px;");
    expect(groupPanelsCssSource).toContain("min-height: 35px;");
    expect(titlebarHostSource).not.toContain('className="titlebar-open-group titlebar-settings-group"');
    expect(titlebarHostSource).not.toContain('showTitlebarDropdownPanel("settings", event.currentTarget)');
    expect(titlebarHostSource).not.toContain(".titlebar-settings-menu-button");
    expect(sidebarAppSource).not.toContain("function renderFloatingOverflowMenu(");
    expect(sidebarAppSource).not.toContain('aria-label="Open sidebar menu"');
  });

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
