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

  test("keeps focused text fields from being redirected into settings search", () => {
    /*
     * CDXC:SettingsTextFields 2026-06-19-16:53:
     * Font Family and other Settings text fields must keep printable typing in
     * the focused input while immediate-save settings updates round-trip
     * through the native modal host.
     */
    const keyCapture = sourceBetween(
      settingsModalSource,
      "const handleSettingsModalKeyDownCapture",
      "const setActiveTab",
    );
    const textField = sourceBetween(
      settingsModalSource,
      "function TextField",
      "function DisabledCommandPreviewField",
    );

    expect(keyCapture).toContain(
      "isEditableSettingsModalElement(event.currentTarget.ownerDocument.activeElement)",
    );
    expect(textField).toContain("const inputRef = useRef<HTMLInputElement>(null);");
    expect(textField).toContain("const [inputValue, setInputValue] = useState(value);");
    expect(textField).toContain("value={inputValue}");
  });

  test("keeps hook and skill uninstall controls at the bottom of integrations", () => {
    /*
     * CDXC:IntegrationsSetup 2026-06-21-02:54:
     * Hooks & Skills uninstall controls belong at the bottom of Settings >
     * Integrations, and their no-op states must be disabled when hooks or
     * bundled skills are already absent.
     */
    const navigation = sourceBetween(
      settingsModalSource,
      "const mainSettingsSectionNavigation",
      "const hasVisibleMainSettings",
    );
    const integrationsTab = sourceBetween(
      settingsModalSource,
      "function IntegrationsSettingsTab",
      "function IntegrationSettingsRow",
    );

    expect(navigation).not.toContain('title: "Hooks & Skills"');
    expect(settingsModalSource).not.toContain("hooksSkills");
    const cuaPermissionsIndex = integrationsTab.indexOf('title="Cua Permissions"');
    const hooksSkillsIndex = integrationsTab.indexOf('title="Hooks & Skills"');
    expect(cuaPermissionsIndex).toBeGreaterThanOrEqual(0);
    expect(hooksSkillsIndex).toBeGreaterThanOrEqual(0);
    expect(cuaPermissionsIndex).toBeLessThan(hooksSkillsIndex);
    expect(integrationsTab).toContain("agentHooksAvailableForUninstall");
    expect(integrationsTab).toContain("bundledAgentSkillsAvailableForUninstall");
    expect(integrationsTab).toContain(
      "disabled={agentHookStatusLoading || !agentHooksAvailableForUninstall || !onUninstallAgentHooks}",
    );
    expect(integrationsTab).toContain(
      "disabled={ghostexCliStatusLoading || !bundledAgentSkillsAvailableForUninstall || !onUninstallBundledAgentSkills}",
    );
    expect(integrationsTab).toContain('title="Hooks & Skills"');
    expect(integrationsTab).toContain("Uninstall Hooks");
    expect(integrationsTab).toContain("Uninstall Skills");
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

  test("routes settings select popups through the close-before-write wrapper", () => {
    /*
     * CDXC:SettingsDropdowns 2026-06-19-19:22:
     * Changing Settings dropdowns in the macOS modal must close the popup
     * before native and gxserver settings hydration can re-render the dialog,
     * otherwise the portaled popup can keep input trapped.
     */
    const settingsSelect = sourceBetween(
      settingsModalSource,
      "function SettingsSelect",
      "function SettingsSelectContent",
    );
    const selectField = sourceBetween(
      settingsModalSource,
      "function SelectField",
      "function StaticNoteField",
    );
    const settingsModalWithoutSettingsSelect = settingsModalSource.replace(settingsSelect, "");

    expect(settingsModalSource).toContain('import { flushSync } from "react-dom";');
    expect(settingsSelect).toContain("const [selectOpen, setSelectOpen] = useState(false);");
    expect(settingsSelect).toContain("flushSync(() => {");
    expect(settingsSelect).toContain("onOpenChange={(nextOpen, eventDetails) => {");
    expect(settingsSelect).toContain("open={selectOpen}");
    expect(selectField).toContain("<SettingsSelect");
    expect(settingsModalWithoutSettingsSelect).not.toMatch(/<Select(?:\s|>)/u);
  });

  test("closes the custom tint picker dialog before final setting commits", () => {
    /*
     * CDXC:SidebarTitlebarColors 2026-06-19-19:51:
     * The custom Background Tint picker is a nested dialog, not a dropdown,
     * but it still must close before final settings persistence can re-render
     * the macOS Settings modal.
     */
    const colorPickerField = sourceBetween(
      settingsModalSource,
      "function WebColorPickerField",
      "function normalizeColorInputValue",
    );

    expect(colorPickerField).toContain("const commitColorAfterClosingPicker");
    expect(colorPickerField).toContain("setPickerOpen(false);");
    expect(colorPickerField).toContain("commitColor(nextColor);");
    expect(colorPickerField).toContain("commitColorAfterClosingPicker(colorValue);");
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
