import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const settingsModalSource = readFileSync(new URL("./settings-modal.tsx", import.meta.url), "utf8");
const agentsHubModalSource = readFileSync(new URL("./agents-hub-modal.tsx", import.meta.url), "utf8");
const settingsModalStylesSource = readFileSync(
  new URL("./styles/modals.css", import.meta.url),
  "utf8",
);
const sidebarStylesSource = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const sharedSidebarContractSource = readFileSync(
  new URL("../shared/session-grid-contract-sidebar.ts", import.meta.url),
  "utf8",
);
const nativeSidebarSource = readFileSync(
  new URL("../native/sidebar/native-sidebar.tsx", import.meta.url),
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
  test("keeps Agents Hub tab rail visibly bordered while Settings uses sidebar navigation", () => {
    /*
     * CDXC:AppModalTabs 2026-06-24-04:25:
     * Agents Hub top-level tabs use the app-modal tab style, and that style
     * must keep a visible 1px #252525 outside border plus single-pixel internal
     * dividers.
     *
     * CDXC:SettingsNavigation 2026-06-24-22:16:
     * Settings must not render the app-modal top tab rail anymore; Settings
     * page navigation belongs in the left sidebar.
     */
    const tabRailStyles = sourceBetween(
      sidebarStylesSource,
      '.app-modal-tab-rail[data-slot="tabs-list"] {',
      ".app-modal-tab-rail [data-slot=\"tabs-trigger\"]:hover",
    );
    expect(tabRailStyles).toContain("border: 1px solid #252525 !important;");
    expect(tabRailStyles).toContain("border: 0 !important;");
    expect(tabRailStyles).toContain(
      ".app-modal-tab-rail [data-slot=\"tabs-trigger\"] + [data-slot=\"tabs-trigger\"]",
    );
    expect(tabRailStyles).toContain("border-left: 1px solid #252525 !important;");
    expect(settingsModalSource).not.toContain('<TabsList className="app-modal-tab-rail">');
    expect(settingsModalSource).not.toContain("settings-modal-tabs-scroll");
    expect(agentsHubModalSource).toContain(
      '<TabsList className="agents-hub-tabs-list app-modal-tab-rail">',
    );
  });

  test("keeps Settings page navigation and Show Advanced inside the sidebar", () => {
    /*
     * CDXC:SettingsNavigation 2026-06-19-08:40:
     * The macOS Settings section list and Show Advanced filter should render
     * as one sidebar surface, not as separate floating controls.
     *
     * CDXC:SettingsNavigation 2026-06-24-22:16:
     * Top-level Settings pages and expandable page sections now share that
     * sidebar, replacing the old top tab bar.
     *
     * CDXC:SettingsNavigation 2026-06-25-17:12:
     * Only top-level Settings categories should get Tabler icons; nested
     * expandable section rows remain text-only.
     */
    const settingsSidebar = sourceBetween(
      settingsModalSource,
      '<aside aria-label="Settings pages and sections" className="settings-section-sidebar">',
      "</aside>",
    );
    expect(settingsSidebar).toContain("settings-sidebar-tabs-list");
    expect(settingsSidebar).toContain("settings-sidebar-page-disclosure");
    expect(settingsSidebar).toContain("settings-sidebar-subsection-list");
    expect(settingsSidebar).toContain("settings-section-sidebar-footer");
    expect(settingsSidebar).toContain("Show Advanced");
    expect(settingsSidebar).toContain('<PageIcon aria-hidden="true" data-icon="inline-start" />');
    expect(settingsSidebar).toContain('className="settings-sidebar-page-title truncate"');
    expect(settingsModalSource).not.toContain("settings-show-advanced-anchor");
    for (const categoryIcon of [
      "icon: IconSettings",
      "icon: IconDeviceDesktop",
      "icon: IconCloud",
      "icon: IconFolderOpen",
      "icon: IconKeyboard",
      "icon: IconCodeDots",
      "icon: IconTools",
      "icon: IconPlayerPlay",
      "icon: IconExternalLink",
    ]) {
      expect(settingsModalSource).toContain(categoryIcon);
    }
    const subsectionButton = sourceBetween(
      settingsSidebar,
      'className="settings-section-sidebar-button settings-sidebar-subsection-button"',
      "</Button>",
    );
    expect(subsectionButton).toContain("{section.title}");
    expect(subsectionButton).not.toContain("data-icon");

    const sidebarPageRowStyles = sourceBetween(
      sidebarStylesSource,
      ".ghostex-settings-shadcn .settings-sidebar-page-row {",
      ".ghostex-settings-shadcn .settings-sidebar-tab-trigger[data-slot=\"tabs-trigger\"] {",
    );
    expect(sidebarPageRowStyles).toContain(
      ".settings-sidebar-page-row:has(.settings-sidebar-tab-trigger[data-active])",
    );
    expect(sidebarPageRowStyles).toContain("background: var(--accent);");
    expect(sidebarPageRowStyles).toContain("including the disclosure chevron");
    const sidebarTriggerStyles = sourceBetween(
      sidebarStylesSource,
      ".ghostex-settings-shadcn .settings-sidebar-tab-trigger[data-slot=\"tabs-trigger\"] {",
      ".ghostex-settings-shadcn .settings-sidebar-tab-trigger[data-slot=\"tabs-trigger\"]:hover",
    );
    expect(sidebarTriggerStyles).toContain("gap: 0.5rem;");
    expect(sidebarTriggerStyles).toContain(".settings-sidebar-page-title");
  });

  test("uses the native window title instead of duplicate Settings chrome", () => {
    /*
     * CDXC:SettingsWindow 2026-06-25-17:05:
     * The native Settings titlebar owns the visible "Ghostex Settings" title.
     * React should not duplicate a large Settings heading or render an extra
     * close button inside the content surface.
     */
    const dialogHeader = sourceBetween(
      settingsModalSource,
      '<DialogHeader className="ghostex-modal-heading-bar">',
      "</DialogHeader>",
    );
    expect(dialogHeader).toContain("Ghostex Settings");
    expect(dialogHeader).toContain('!isFirstLaunchSetup && "sr-only"');
    expect(settingsModalSource).not.toContain('aria-label="Close Settings"');
    expect(settingsModalSource).not.toContain("ghostex-modal-icon-close");
  });

  test("keeps settings search at the top of the content column outside the sidebar", () => {
    /*
     * CDXC:SettingsNavigation 2026-06-19-12:18:
     * Settings and Hotkeys search should center above the settings card column,
     * independent of the floating left sidebar.
     *
     * CDXC:SettingsNavigation 2026-06-24-22:16:
     * Settings has one search field above the active content column while page
     * and section navigation lives in the sidebar.
     */
    const headerSearch = sourceBetween(
      settingsModalSource,
      '<div className="settings-modal-search-row">',
      'toolbarClassName="settings-modal-search-toolbar"',
    );
    expect(headerSearch).toContain("<SidebarSessionSearchField");
    expect(headerSearch).toContain('placeholder="Search settings"');
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
    expect(settingsModalSource).toContain("keepAwakeWhileWorkingSessions");
    expect(settingsModalSource).toContain("Keep awake for working sessions");
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

  test("labels intentionally omitted local T3 runtime as not bundled", () => {
    /*
     * CDXC:ContributorStart 2026-06-22-23:23:
     * Contributor local builds can intentionally omit the optional t3code
     * checkout. Settings should label that state as Not bundled instead of
     * Missing so users understand only the T3 feature is unavailable.
     */
    const integrationsTab = sourceBetween(
      settingsModalSource,
      "function IntegrationsSettingsTab",
      "function IntegrationSettingsRow",
    );

    expect(integrationsTab).toContain('ghostexCliStatus?.t3RuntimeSource === "unavailable"');
    expect(integrationsTab).toContain('"Not bundled"');
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

  test("keeps dev-server controls in the Terminal settings flow", () => {
    /*
     * CDXC:TerminalDevServers 2026-06-23-19:22:
     * Dev-server detection, one system-default/internal-browser launch choice, and ignored ports should live in a dedicated Terminal settings section rather than the generic Browser section or a per-browser checklist.
     */
    const sectionKeys = sourceBetween(
      settingsModalSource,
      "terminalDevServers: [",
      "editor: [",
    );
    const settingsNavigation = sourceBetween(
      settingsModalSource,
      "const mainSettingsSectionNavigation",
      "const hasVisibleMainSettings",
    );
    const devServersSection = sourceBetween(
      settingsModalSource,
      'title="Dev Servers"',
      '{mainSectionVisible("editor", settingsSearch.editor) ? (',
    );

    expect(sectionKeys).toContain("terminalDevServerDetectionEnabled");
    expect(sectionKeys).toContain("terminalDevServerOpenTarget");
    expect(sectionKeys).toContain("terminalDevServerIgnoredPortRules");
    expect(settingsNavigation).toContain('id: "terminalDevServers"');
    expect(devServersSection).toContain("TERMINAL_DEV_SERVER_OPEN_TARGET_OPTIONS");
    expect(devServersSection).not.toContain("TerminalDevServerBrowserTargetsField");
    expect(devServersSection).toContain("TerminalDevServerIgnoredPortsField");
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
    const selectedProjectEditor = sourceBetween(
      settingsModalSource,
      '<Card className="settings-project-command-card">',
      "type PortlessSettingsDomainSummary",
    );

    expect(projectsPanel).not.toContain('type: "removeProject"');
    expect(projectsPanel).not.toContain("removeSelectedProject");
    expect(projectsPanel).not.toContain("Remove project");
    expect(selectedProjectEditor).not.toContain("<IconTrash");
  });

  test("places Portless global settings above the Projects selector", () => {
    /*
     * CDXC:PortlessSettings 2026-06-23-03:47:
     * Phase 14 puts app-wide Portless controls at the top of Settings ->
     * Projects, before the project selector and selected-project fields.
     */
    const projectsPanel = sourceBetween(
      settingsModalSource,
      "function ProjectsSettingsPanel",
      "function PortlessGlobalSettingsPanel",
    );
    const settingsModalProjectsTab = sourceBetween(
      settingsModalSource,
      '<TabsContent className="mt-0 min-h-0 flex-1 overflow-hidden" value="projects">',
      "</TabsContent>",
    );

    expect(projectsPanel.indexOf("<PortlessGlobalSettingsPanel")).toBeGreaterThanOrEqual(0);
    expect(projectsPanel.indexOf("<PortlessGlobalSettingsPanel")).toBeLessThan(
      projectsPanel.indexOf('className="projects-settings-selector"'),
    );
    expect(settingsModalProjectsTab).toContain("portless={portless}");
    expect(settingsModalStylesSource).toContain(".settings-projects-global-settings");
  });

  test("wires Portless defaults through normalized global settings", () => {
    /*
     * CDXC:PortlessSettings 2026-06-23-03:47:
     * The Projects tab should use the global settings defaults from
     * normalizeghostexSettings: Portless enabled and HTTPS protocol until the
     * user changes those app-wide settings.
     */
    const settingsModalProjectsTab = sourceBetween(
      settingsModalSource,
      '<TabsContent className="mt-0 min-h-0 flex-1 overflow-hidden" value="projects">',
      "</TabsContent>",
    );
    const globalPanel = sourceBetween(
      settingsModalSource,
      "function PortlessGlobalSettingsPanel",
      "function PortlessSettingsAdminActionButton",
    );

    expect(settingsModalProjectsTab).toContain(
      'onPortlessEnabledChange={(checked) => updateDraft("portlessEnabled", checked)}',
    );
    expect(settingsModalProjectsTab).toContain(
      'onPortlessProtocolChange={(protocol) => updateDraft("portlessProtocol", protocol)}',
    );
    expect(globalPanel).toContain("checked={settings.portlessEnabled}");
    expect(globalPanel).toContain("value={[settings.portlessProtocol]}");
    expect(settingsModalSource).toContain('{ label: "HTTPS", value: "https" }');
    expect(settingsModalSource).toContain('{ label: "HTTP", value: "http" }');
  });

  test("keeps Portless settings actions explicit and sanitized", () => {
    /*
     * CDXC:PortlessSettings 2026-06-23-03:47:
     * Settings actions can install, reconfigure, retry, disable, or remove the
     * Ghostex-managed proxy, but the sidebar command may carry only enum action,
     * request id, and selected protocol metadata.
     */
    const projectsPanel = sourceBetween(
      settingsModalSource,
      "function ProjectsSettingsPanel",
      "type SettingsAgentDragData",
    );
    const sharedSettingsCommand = sourceBetween(
      sharedSidebarContractSource,
      "Settings -> Projects exposes explicit Portless setup actions",
      'type: "postponePortlessSetupPrompt"',
    );
    const nativeSettingsHandler = sourceBetween(
      nativeSidebarSource,
      "function runPortlessSettingsAdminAction",
      "function setPortlessEnabledFromSetupPrompt",
    );

    expect(projectsPanel).toContain('type: "runPortlessSettingsAdminAction"');
    expect(projectsPanel).toContain('action === "remove"');
    expect(projectsPanel).toContain("protocol: settings.portlessProtocol");
    expect(projectsPanel).toContain('onClick={() => onEnabledChange(false)}');
    expect(projectsPanel).toContain('remove: "Remove background proxy"');
    expect(sharedSettingsCommand).toContain("action: NativePortlessAdminInstallAction;");
    expect(sharedSettingsCommand).toContain("protocol: NativePortlessProtocol;");
    expect(sharedSettingsCommand).toContain('action: "remove";');
    expect(nativeSettingsHandler).toContain("runTrackedPortlessAdminAction");
    expect(nativeSettingsHandler).not.toContain("runProcess");
    expect(nativeSettingsHandler).not.toContain("stdout");
    expect(nativeSettingsHandler).not.toContain("stderr");
  });

  test("shows assigned Portless domains as read-only project and worktree summaries", () => {
    /*
     * CDXC:PortlessSettings 2026-06-23-03:47:
     * Phase 14 displays generated project/worktree domains without slug edit,
     * reset, or input controls. Worktree grouping needs only stable project ids.
     */
    const domainsSummary = sourceBetween(
      settingsModalSource,
      "function PortlessAssignedDomainsSummary",
      "function getPortlessSettingsStatus",
    );
    const domainGrouping = sourceBetween(
      settingsModalSource,
      "function getProjectPortlessDomainSummaries",
      "function getPortlessAssignedDomainsEmptyMessage",
    );

    expect(domainsSummary).toContain('aria-label="Assigned Portless domains"');
    expect(domainsSummary).toContain("settings-portless-domain-hostname");
    expect(domainsSummary).toContain("Generated project and worktree domains are read-only.");
    expect(domainsSummary).not.toContain("SettingsInput");
    expect(domainsSummary).not.toContain("SettingsTextarea");
    expect(domainsSummary).not.toContain("slug");
    expect(domainsSummary).not.toContain("reset");
    expect(domainGrouping).toContain("assignedDomains");
    expect(domainGrouping).toContain("liveRoutesByProjectAndHostname");
    expect(domainGrouping).toContain("worktreeParentProjectId");
    expect(sharedSidebarContractSource).toContain("worktreeParentProjectId?: string");
    expect(nativeSidebarSource).toContain("worktreeParentProjectId: worktree.parentProjectId");
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
