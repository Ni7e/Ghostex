import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const settingsModalSource = readFileSync(new URL("./settings-modal.tsx", import.meta.url), "utf8");
const settingsModalStylesSource = readFileSync(
  new URL("./styles/modals.css", import.meta.url),
  "utf8",
);

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

  test("keeps settings search in a header row outside the floating sidebar", () => {
    /*
     * CDXC:SettingsNavigation 2026-06-19-12:18:
     * Settings and Hotkeys search should center above the settings card column,
     * independent of the floating left sidebar.
     */
    const headerSearch = sourceBetween(
      settingsModalSource,
      '<div className="settings-modal-search-row">',
      'toolbarClassName="settings-modal-search-toolbar"',
    );
    expect(headerSearch).toContain("<SidebarSessionSearchField");
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

  test("gates Keep Awake settings behind Show Beta features", () => {
    /*
     * CDXC:TitlebarKeepAwake 2026-06-19-13:13:
     * Keep Awake is beta-only in regular macOS Settings, but the Beta section
     * must name the hidden Power settings and titlebar button so search can
     * lead users to the opt-in gate.
     */
    const betaSearch = sourceBetween(
      settingsModalSource,
      'beta: getSettingsSectionSearch(settingsSearchQuery, "Beta", [',
      'debugging: getSettingsSectionSearch(settingsSearchQuery, "Debugging", [',
    );
    const betaSection = sourceBetween(
      settingsModalSource,
      '<SettingsSection sectionRef={betaSectionRef} title="Beta">',
      '{mainSectionVisible("debugging", settingsSearch.debugging) ? (',
    );
    const mainVisibility = sourceBetween(
      settingsModalSource,
      "const keepAwakeSettingsVisible =",
      "const visibleMainSettingsSectionNavigation",
    );

    expect(betaSearch).toContain("Keep Awake");
    expect(betaSection).toContain("Title bar and Power settings: Keep Awake");
    expect(betaSection).toContain("Keep Awake title-bar button");
    expect(mainVisibility).toContain('sectionId === "power" && !keepAwakeSettingsVisible');
    expect(mainVisibility).toContain("first-launch lid-close preference");
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

  test("keeps project deletion out of the Projects settings page", () => {
    /*
     * CDXC:ProjectSettings 2026-06-19-12:11:
     * Projects settings edits selected-project metadata only. The standalone
     * trash action should not be available from this page.
     */
    const projectsPanel = sourceBetween(
      settingsModalSource,
      "function ProjectsSettingsPanel",
      "function OpenTargetsSettingsTab",
    );

    expect(projectsPanel).not.toContain('type: "removeProject"');
    expect(projectsPanel).not.toContain("removeSelectedProject");
    expect(projectsPanel).not.toContain("Remove project");
    expect(projectsPanel).not.toContain("<IconTrash");
  });

  test("keeps the open project selector neutral", () => {
    /*
     * CDXC:ProjectSettings 2026-06-19-12:22:
     * The Projects dropdown trigger should use neutral Settings colors when
     * open, not the app accent color that appears blue in dark themes.
     */
    const openSelectorStyles = sourceBetween(
      settingsModalStylesSource,
      ".projects-settings-selector-trigger[data-popup-open]",
      "}",
    );

    expect(openSelectorStyles).not.toContain("--app-button-background");
    expect(openSelectorStyles).toContain("--app-card-active");
    expect(openSelectorStyles).toContain("--app-border");
  });
});
