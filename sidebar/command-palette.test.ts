import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import type {
  SidebarPreviousSessionItem,
  SidebarSessionItem,
} from "../shared/session-grid-contract";
import {
  createCommandPaletteCurrentSessionItems,
  createCommandPaletteSessionSections,
  createPreviousSessionSearchText,
  filterCommandPaletteCurrentSessionItems,
  filterCommandPalettePreviousSessions,
  getCommandPaletteCommandQuery,
  getCommandPaletteModeSwitchSelectionRange,
  getCommandPaletteQueryForRequestedMode,
  isCommandPaletteCommandMode,
  sortCommandPalettePreviousSessionsByLastActive,
  type CommandPaletteCurrentSessionItem,
} from "./command-palette-session-search";

const commandPaletteSource = readFileSync(
  new URL("./command-palette.tsx", import.meta.url),
  "utf8",
);
const gpuiMainSource = readFileSync(new URL("../gpui/src/main.rs", import.meta.url), "utf8");
const sidebarAppSource = readFileSync(new URL("./sidebar-app.tsx", import.meta.url), "utf8");
const commandPaletteSearchSource = readFileSync(
  new URL("./command-palette-session-search.ts", import.meta.url),
  "utf8",
);
const commandInputSource = readFileSync(
  new URL("../components/ui/command.tsx", import.meta.url),
  "utf8",
);
const modalHostSource = readFileSync(new URL("../native/sidebar/modal-host.tsx", import.meta.url), "utf8");
const nativeSidebarSource = readFileSync(
  new URL("../native/sidebar/native-sidebar.tsx", import.meta.url),
  "utf8",
);
const sessionGridContractSource = readFileSync(
  new URL("../shared/session-grid-contract-sidebar.ts", import.meta.url),
  "utf8",
);
const sidebarStylesSource = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

describe("command palette modes", () => {
  test("uses a leading > as command mode and no prefix as session search mode", () => {
    /*
     * CDXC:CommandPalette 2026-06-13-22:18:
     * Cmd+Shift+P pre-fills `>` for command fuzzy finding, while Cmd+P leaves
     * the input empty for session search. The mode switch is the typed prefix,
     * not a separate modal kind.
     */
    expect(isCommandPaletteCommandMode(">")).toBe(true);
    expect(isCommandPaletteCommandMode(">focus")).toBe(true);
    expect(isCommandPaletteCommandMode("  >focus")).toBe(true);
    expect(isCommandPaletteCommandMode("focus")).toBe(false);
    expect(isCommandPaletteCommandMode("")).toBe(false);
    expect(getCommandPaletteCommandQuery(">focus left")).toBe("focus left");
    expect(getCommandPaletteCommandQuery("> focus left")).toBe("focus left");
    expect(getCommandPaletteCommandQuery("focus left")).toBe("");
  });

  test("switches an already-open palette between session and command modes", () => {
    /*
     * CDXC:CommandPalette 2026-06-15-10:27:
     * Cmd+P and Cmd+Shift+P should switch the visible shared palette in-place:
     * adding `>` preserves a session-search query as a command query, removing
     * `>` preserves a command query as a session-search query, and same-mode
     * repeats remain no-ops.
     */
    expect(getCommandPaletteQueryForRequestedMode("agent", ">")).toBe(">agent");
    expect(getCommandPaletteQueryForRequestedMode(">agent", "")).toBe("agent");
    expect(getCommandPaletteQueryForRequestedMode("> agent", "")).toBe("agent");
    expect(getCommandPaletteQueryForRequestedMode("agent", "")).toBe("agent");
    expect(getCommandPaletteQueryForRequestedMode(">agent", ">")).toBe(">agent");
    expect(getCommandPaletteModeSwitchSelectionRange(">agent")).toEqual({ start: 1, end: 6 });
    expect(getCommandPaletteModeSwitchSelectionRange("> agent")).toEqual({ start: 2, end: 7 });
    expect(getCommandPaletteModeSwitchSelectionRange("agent")).toEqual({ start: 0, end: 5 });
  });

  test("filters current sessions by visible title only", () => {
    const reviewSession = createSession({
      alias: "Claude Review",
      detail: "testing hidden detail",
      sessionId: "session-review",
    });
    const sourceSession = createSession({
      alias: "Source Shell",
      detail: "Terminal",
      sessionId: "session-source",
    });
    const settingsSession = createSession({
      alias: "Project Settings Delete Issue",
      detail: "Terminal",
      sessionId: "session-settings",
    });
    const defaultAgentSession = createSession({
      alias: "Pi Agent Session",
      detail: "Terminal",
      sessionId: "session-default-agent",
    });
    const items: CommandPaletteCurrentSessionItem[] = [
      {
        groupId: "group-ghostex",
        groupIsActive: true,
        projectLabel: "Ghostex",
        searchText: "Claude Review Ghostex",
        session: reviewSession,
      },
      {
        groupId: "group-testing",
        groupIsActive: false,
        projectLabel: "Testing Project",
        searchText: "Source Shell",
        session: sourceSession,
      },
      {
        groupId: "group-settings",
        groupIsActive: false,
        projectLabel: "Ghostex",
        searchText: "Project Settings Delete Issue",
        session: settingsSession,
      },
      {
        groupId: "group-default-agent",
        groupIsActive: false,
        projectLabel: "Ghostex",
        searchText: "Pi Agent Session",
        session: defaultAgentSession,
      },
    ];

    /*
     * CDXC:CommandPalette 2026-06-17-22:39:
     * Cmd+P session search must be a title jump, not a metadata search. A
     * typed title query should not match hidden details, project labels, or
     * near-looking words such as Settings when the user typed testing.
     *
     * CDXC:SessionSearch 2026-06-18-00:01:
     * Default agent CLI names are placeholders, so Cmd+P should omit them even
     * when the query text would otherwise match the default title exactly.
     */
    expect(filterCommandPaletteCurrentSessionItems(items, "claude")).toEqual([items[0]]);
    expect(filterCommandPaletteCurrentSessionItems(items, "source")).toEqual([items[1]]);
    expect(filterCommandPaletteCurrentSessionItems(items, "testing")).toEqual([]);
    expect(filterCommandPaletteCurrentSessionItems(items, "pi")).toEqual([]);
    expect(
      createCommandPaletteCurrentSessionItems({
        groupsById: {
          "group-testing": {
            projectContext: { path: "/Users/madda/dev/_active/testing-project" },
            title: "Testing Project",
          },
        },
        sessionIdsByGroup: { "group-testing": [sourceSession.sessionId] },
        sessionsById: { [sourceSession.sessionId]: sourceSession },
        workspaceGroupIds: ["group-testing"],
      })[0]?.searchText,
    ).toBe("Source Shell");
    expect(filterCommandPaletteCurrentSessionItems(items, "")).toEqual([
      items[0],
      items[1],
      items[2],
    ]);
    expect(
      createCommandPaletteCurrentSessionItems({
        groupsById: { "group-default-agent": { title: "Ghostex" } },
        sessionIdsByGroup: { "group-default-agent": [defaultAgentSession.sessionId] },
        sessionsById: { [defaultAgentSession.sessionId]: defaultAgentSession },
        workspaceGroupIds: ["group-default-agent"],
      }),
    ).toEqual([]);
  });

  test("orders session sections and sorts each section by last active descending", () => {
    const currentOlder = createSession({
      alias: "Focused Older Shell",
      detail: "Terminal",
      isFocused: true,
      lastInteractionAt: "2026-06-13T08:00:00.000Z",
      sessionId: "session-current-older",
    });
    const currentNewer = createSession({
      alias: "Focused Newer Shell",
      detail: "Terminal",
      lastInteractionAt: "2026-06-13T11:00:00.000Z",
      sessionId: "session-current-newer",
    });
    const activeOlder = createSession({
      alias: "Active Older Project Shell",
      detail: "Terminal",
      lastInteractionAt: "2026-06-13T09:00:00.000Z",
      sessionId: "session-active-older",
    });
    const activeNewer = createSession({
      alias: "Active Newer Project Shell",
      detail: "Terminal",
      lastInteractionAt: "2026-06-13T12:00:00.000Z",
      sessionId: "session-active-newer",
    });
    const collapsedOlder = createSession({
      alias: "Collapsed Older Project Shell",
      detail: "Terminal",
      lastInteractionAt: "2026-06-13T07:00:00.000Z",
      sessionId: "session-collapsed-older",
    });
    const collapsedNewer = createSession({
      alias: "Collapsed Newer Project Shell",
      detail: "Terminal",
      lastInteractionAt: "2026-06-13T10:00:00.000Z",
      sessionId: "session-collapsed-newer",
    });
    const items: CommandPaletteCurrentSessionItem[] = [
      {
        groupId: "group-active",
        groupIsActive: false,
        projectLabel: "Active",
        searchText: "Active Older Project Shell",
        session: activeOlder,
      },
      {
        groupId: "group-current",
        groupIsActive: true,
        projectLabel: "Current",
        searchText: "Focused Older Shell",
        session: currentOlder,
      },
      {
        groupId: "group-collapsed",
        groupIsActive: false,
        projectLabel: "Collapsed",
        searchText: "Collapsed Older Project Shell",
        session: collapsedOlder,
      },
      {
        groupId: "group-active",
        groupIsActive: false,
        projectLabel: "Active",
        searchText: "Active Newer Project Shell",
        session: activeNewer,
      },
      {
        groupId: "group-collapsed",
        groupIsActive: false,
        projectLabel: "Collapsed",
        searchText: "Collapsed Newer Project Shell",
        session: collapsedNewer,
      },
      {
        groupId: "group-current",
        groupIsActive: true,
        projectLabel: "Current",
        searchText: "Focused Newer Shell",
        session: currentNewer,
      },
    ];

    /*
     * CDXC:CommandPalette 2026-06-13-23:06:
     * Session search sections are ordered Current Project, Other Active
     * Projects, Collapsed Projects, then Previous sessions in render. Each
     * area sorts its rows by Last Active descending instead of inheriting
     * workspace order.
     */
    const sections = createCommandPaletteSessionSections(items, {
      collapsedGroupsById: { "group-collapsed": true },
    });

    expect(sections.map((section) => section.heading)).toEqual([
      "Current Project",
      "Other Active Projects",
      "Collapsed Projects",
    ]);
    expect(
      sections.map((section) => section.items.map((item) => item.session.sessionId)),
    ).toEqual([
      ["session-current-newer", "session-current-older"],
      ["session-active-newer", "session-active-older"],
      ["session-collapsed-newer", "session-collapsed-older"],
    ]);

    expect(
      createCommandPaletteSessionSections([items[0]], {
        collapsedGroupsById: { "group-collapsed": true },
        currentGroupId: "group-current",
      }).map((section) => section.heading),
    ).toEqual(["Other Active Projects"]);
  });

  test("uses the active project as Current Project instead of stale focused sessions", () => {
    const staleRootFocused = createSession({
      alias: "Root Shell",
      detail: "Terminal",
      isFocused: true,
      sessionId: "session-root",
    });
    const ghostexActive = createSession({
      alias: "Ghostex Agent",
      detail: "Terminal",
      sessionId: "session-ghostex",
    });
    const items: CommandPaletteCurrentSessionItem[] = [
      {
        groupId: "group-root",
        groupIsActive: false,
        projectLabel: "/",
        searchText: "Root Shell",
        session: staleRootFocused,
      },
      {
        groupId: "group-ghostex",
        groupIsActive: true,
        projectLabel: "Ghostex",
        searchText: "Ghostex Agent",
        session: ghostexActive,
      },
    ];

    /*
     * CDXC:CommandPalette 2026-06-19-14:10:
     * Cmd+P Current Project must follow the active project state, not stale
     * terminal focus metadata. When `/` still has a focused session but the
     * Ghostex project is active, Ghostex owns Current Project and `/` moves to
     * the other active project section.
     */
    const sections = createCommandPaletteSessionSections(items, {
      collapsedGroupsById: {},
    });

    expect(sections.map((section) => section.heading)).toEqual([
      "Current Project",
      "Other Active Projects",
    ]);
    expect(
      sections.map((section) => section.items.map((item) => item.projectLabel)),
    ).toEqual([["Ghostex"], ["/"]]);
    expect(
      createCommandPaletteSessionSections([items[0]], {
        collapsedGroupsById: {},
      }).map((section) => section.heading),
    ).toEqual(["Other Active Projects"]);
  });

  test("sorts previous session rows by last active descending before display limit", () => {
    const older = createPreviousSession({
      closedAt: "2026-06-13T12:00:00.000Z",
      historyId: "history-older",
      lastInteractionAt: "2026-06-13T09:00:00.000Z",
      sessionId: "session-older",
    });
    const newer = createPreviousSession({
      closedAt: "2026-06-13T10:00:00.000Z",
      historyId: "history-newer",
      lastInteractionAt: "2026-06-13T11:00:00.000Z",
      sessionId: "session-newer",
    });
    const closedOnly = createPreviousSession({
      closedAt: "2026-06-13T10:30:00.000Z",
      historyId: "history-closed-only",
      sessionId: "session-closed-only",
    });

    expect(
      sortCommandPalettePreviousSessionsByLastActive([older, newer, closedOnly]).map(
        (session) => session.historyId,
      ),
    ).toEqual(["history-newer", "history-closed-only", "history-older"]);
  });

  test("filters previous sessions by title only", () => {
    const matching = createPreviousSession({
      alias: "Testing Session",
      closedAt: "2026-06-13T12:00:00.000Z",
      historyId: "history-testing",
      projectPath: "/Users/madda/dev/_active/not-a-match",
      sessionId: "session-testing",
    });
    const hiddenProjectMatch = createPreviousSession({
      alias: "Prompt Editor Losing Content",
      closedAt: "2026-06-13T12:00:00.000Z",
      historyId: "history-hidden-project",
      projectPath: "/Users/madda/dev/_active/testing-project",
      sessionId: "session-hidden-project",
    });
    const defaultAgentSession = createPreviousSession({
      alias: "Pi Agent Session",
      closedAt: "2026-06-13T12:00:00.000Z",
      historyId: "history-default-agent",
      sessionId: "session-default-agent",
    });

    expect(
      filterCommandPalettePreviousSessions([matching, hiddenProjectMatch, defaultAgentSession], "testing"),
    ).toEqual([matching]);
    expect(filterCommandPalettePreviousSessions([defaultAgentSession], "pi")).toEqual([]);
    expect(filterCommandPalettePreviousSessions([matching, defaultAgentSession], "")).toEqual([
      matching,
    ]);
    expect(createPreviousSessionSearchText(hiddenProjectMatch)).toBe("Prompt Editor Losing Content");
  });
});

describe("command palette source contracts", () => {
  test("keeps Escape as close and leaves the input clear button unboxed", () => {
    /*
     * CDXC:CommandPalette 2026-06-15-16:21:
     * Escape while the command palette is shown closes the palette even with
     * a non-empty query. The clear affordance remains a bare X glyph inside
     * the command input, without inherited square button chrome.
     */
    expect(commandInputSource).toContain("clearOnEscape = true");
    expect(commandInputSource).toContain(
      'clearOnEscape && event.key === "Escape" && currentValue.length > 0',
    );
    expect(commandInputSource).toContain('data-slot="command-input-clear"');
    expect(commandPaletteSource).toContain("clearOnEscape={false}");
    expect(commandPaletteSource).toContain("onOpenChange(false);");
    expect(sidebarStylesSource).toContain('[data-slot="command-input-clear"]');
    expect(sidebarStylesSource).toContain("border: 0 !important;");
  });

  test("routes visible native command-palette typing into the search input", () => {
    /*
     * CDXC:CommandPalette 2026-06-16-19:24:
     * When the macOS command palette is open, plain typing and paste must go
     * to the palette input even after native/WebKit focus handoffs.
     */
    expect(commandPaletteSource).toContain("const COMMAND_PALETTE_INPUT_SELECTOR");
    expect(commandPaletteSource).toContain("function findCommandPaletteInput()");
    expect(commandPaletteSource).toContain("function isCommandPaletteTextKey(event: KeyboardEvent)");
    expect(commandPaletteSource).toContain("insertIntoCommandPaletteInput(event.key)");
    expect(commandPaletteSource).toContain("insertIntoCommandPaletteInput(text)");
    expect(commandPaletteSource).toContain(
      'window.addEventListener("keydown", handlePaletteKeyDown, { capture: true });',
    );
    expect(commandPaletteSource).toContain(
      'document.addEventListener("paste", handlePalettePaste, { capture: true });',
    );
  });

  test("keeps command-palette Action launch messages authority-only", () => {
    /*
     * CDXC:GPUICommandPane 2026-06-27-07:54:
     * Command Palette Action launches may use saved command metadata to pick
     * debug runMode, but the `runSidebarCommand` message must remain exactly
     * selector-shaped: command id, optional non-default runMode, and type.
     */
    const runProjectCommandStart = commandPaletteSource.indexOf("const runProjectCommand");
    const runProjectCommandEnd = commandPaletteSource.indexOf(
      "const focusCurrentSession",
      runProjectCommandStart,
    );
    expect(runProjectCommandStart).toBeGreaterThanOrEqual(0);
    expect(runProjectCommandEnd).toBeGreaterThan(runProjectCommandStart);
    const runProjectCommandSource = commandPaletteSource.slice(
      runProjectCommandStart,
      runProjectCommandEnd,
    );
    const postMessageStart = runProjectCommandSource.indexOf("vscode.postMessage({");
    const postMessageEnd = runProjectCommandSource.indexOf("});", postMessageStart);
    expect(postMessageStart).toBeGreaterThanOrEqual(0);
    expect(postMessageEnd).toBeGreaterThan(postMessageStart);
    const postMessageSource = runProjectCommandSource.slice(
      postMessageStart,
      postMessageEnd + "});".length,
    );

    expect(runProjectCommandSource).toContain("getSidebarCommandRunModeForClick(");
    expect(runProjectCommandSource).toContain("commandRunStates[command.commandId]");
    expect(postMessageSource.trim()).toBe(`vscode.postMessage({
      commandId: command.commandId,
      ...(runMode === "default" ? {} : { runMode }),
      type: "runSidebarCommand",
    });`);
  });

  test("keeps command-palette focused-pane hotkey messages authority-only", () => {
    /*
     * CDXC:GPUICommandPane 2026-06-26-05:34:
     * Command Palette focused-pane commands are shared Ghostex hotkey actions.
     * Selecting them may identify only the chosen action id and fixed
     * runGhostexHotkeyAction message type; renderer-owned session ids, command
     * text, cwd/env, paths, URLs, close-on-exit, output, logs, and launch
     * metadata must stay out of the posted payload.
     */
    const paneActionIdsStart = commandPaletteSource.indexOf("const PANE_ACTION_COMMAND_IDS");
    const paneActionIdsEnd = commandPaletteSource.indexOf(
      "const COMMAND_PALETTE_PREVIOUS_SESSIONS_LIMIT",
      paneActionIdsStart,
    );
    expect(paneActionIdsStart).toBeGreaterThanOrEqual(0);
    expect(paneActionIdsEnd).toBeGreaterThan(paneActionIdsStart);
    const paneActionIdsSource = commandPaletteSource.slice(paneActionIdsStart, paneActionIdsEnd);

    const paneActionCommandsStart = commandPaletteSource.indexOf("const paneActionCommands");
    const paneActionCommandsEnd = commandPaletteSource.indexOf(
      "const projectCommands",
      paneActionCommandsStart,
    );
    expect(paneActionCommandsStart).toBeGreaterThanOrEqual(0);
    expect(paneActionCommandsEnd).toBeGreaterThan(paneActionCommandsStart);
    const paneActionCommandsSource = commandPaletteSource.slice(
      paneActionCommandsStart,
      paneActionCommandsEnd,
    );

    const hotkeyMessageStart = commandPaletteSource.indexOf(
      "vscode.postMessage({\n      actionId: command.definition.id",
    );
    const hotkeyMessageEnd = commandPaletteSource.indexOf(
      "  };\n\n  const runProjectCommand",
      hotkeyMessageStart,
    );
    expect(hotkeyMessageStart).toBeGreaterThanOrEqual(0);
    expect(hotkeyMessageEnd).toBeGreaterThan(hotkeyMessageStart);
    const hotkeyMessageSource = commandPaletteSource.slice(hotkeyMessageStart, hotkeyMessageEnd);

    expect(paneActionIdsSource).toContain('"sleepFocusedSession"');
    expect(paneActionIdsSource).toContain('"wakeFocusedSession"');
    expect(paneActionIdsSource).toContain('"closeFocusedSession"');
    expect(paneActionIdsSource).toContain('"closeAfterDone"');
    expect(paneActionCommandsSource).toContain(".map(createBuiltInCommand)");
    expect(hotkeyMessageSource.trim()).toBe(`vscode.postMessage({
      actionId: command.definition.id,
      type: "runGhostexHotkeyAction",
    });`);
  });

  test("keeps sidebar native hotkey bounce and forwarding authority-only", () => {
    /*
     * CDXC:HotkeyRouting 2026-06-26-23:04:
     * Sidebar DOM hotkey dispatch must delegate Rename Active Session, Open
     * Commands Panel, Start Action slots, Focus Previous/Next Group,
     * Directional Focus, and Split Sideways/Downwards to the same native-owned
     * runGhostexHotkeyAction bridge used by command-palette selection. The
     * payload may identify only the action id and message type; native resolves
     * authority state without renderer session ids, titles, paths, command text,
     * URLs, or launch metadata.
     *
     * CDXC:HotkeyRouting 2026-06-26-23:20:
     * GPUI can safely bounce numbered Focus Session slot hotkeys to SidebarApp
     * because the renderer owns rendered slot order. Native-owned forwarding
     * remains authority-only for other actions, with the payload limited to
     * action id and bridge type.
     *
     * CDXC:GPUIProjectHotkeys 2026-06-26-23:42:
     * GPUI project slot hotkeys use a separate host message so SidebarApp can
     * resolve rendered Projects row order locally. That message must not call
     * runGhostexHotkeyAction, while SidebarApp DOM jumpToProject actions stay
     * in the ordinary native-forwarding branch.
     *
     * CDXC:HotkeyRouting 2026-06-26-23:58:
     * setViewMode is native-owned when present in the shared action union.
     * Source coverage verifies SidebarApp forwards the action kind without
     * inventing concrete hotkey ids or handling View Mode locally.
     */
    const contractMessageStart = sessionGridContractSource.indexOf(
      "export type SidebarGpuiProjectSlotHotkeyMessage",
    );
    const contractMessageEnd = sessionGridContractSource.indexOf(
      "export type ExtensionToSidebarMessage",
      contractMessageStart,
    );
    expect(contractMessageStart).toBeGreaterThanOrEqual(0);
    expect(contractMessageEnd).toBeGreaterThan(contractMessageStart);
    const contractMessageSource = sessionGridContractSource.slice(
      contractMessageStart,
      contractMessageEnd,
    );
    const extensionMessageStart = sessionGridContractSource.indexOf(
      "export type ExtensionToSidebarMessage",
    );
    const extensionMessageEnd = sessionGridContractSource.indexOf(
      "export type SidebarToExtensionMessage",
      extensionMessageStart,
    );
    expect(extensionMessageStart).toBeGreaterThanOrEqual(0);
    expect(extensionMessageEnd).toBeGreaterThan(extensionMessageStart);
    const extensionMessageSource = sessionGridContractSource.slice(
      extensionMessageStart,
      extensionMessageEnd,
    );

    const handleWindowMessageStart = sidebarAppSource.indexOf(
      "const handleWindowMessage = useEffectEvent",
    );
    const handleWindowMessageEnd = sidebarAppSource.indexOf(
      '    if (event.data.type === "playCompletionSound")',
      handleWindowMessageStart,
    );
    expect(handleWindowMessageStart).toBeGreaterThanOrEqual(0);
    expect(handleWindowMessageEnd).toBeGreaterThan(handleWindowMessageStart);
    const handleWindowMessageSource = sidebarAppSource.slice(
      handleWindowMessageStart,
      handleWindowMessageEnd,
    );

    const runHotkeyStart = sidebarAppSource.indexOf(
      "const runGhostexHotkeyAction = useEffectEvent",
    );
    const runHotkeyEnd = sidebarAppSource.indexOf("  });\n  useLayoutEffect", runHotkeyStart);
    expect(runHotkeyStart).toBeGreaterThanOrEqual(0);
    expect(runHotkeyEnd).toBeGreaterThan(runHotkeyStart);
    const runHotkeySource = sidebarAppSource.slice(runHotkeyStart, runHotkeyEnd);

    const gpuiProjectSlotResolverStart = sidebarAppSource.indexOf(
      "const resolveGpuiProjectSlotHotkey = useEffectEvent",
    );
    const gpuiProjectSlotResolverEnd = sidebarAppSource.indexOf(
      "  });\n  useEffect(() => {\n    const handleProjectJumpEvent",
      gpuiProjectSlotResolverStart,
    );
    expect(gpuiProjectSlotResolverStart).toBeGreaterThanOrEqual(0);
    expect(gpuiProjectSlotResolverEnd).toBeGreaterThan(gpuiProjectSlotResolverStart);
    const gpuiProjectSlotResolverSource = sidebarAppSource.slice(
      gpuiProjectSlotResolverStart,
      gpuiProjectSlotResolverEnd,
    );

    const gpuiProjectMessageStart = handleWindowMessageSource.indexOf(
      'event.data.type === "gpuiProjectSlotHotkey"',
    );
    const nativeHotkeyMessageStart = handleWindowMessageSource.indexOf(
      'event.data.type === "nativeHotkey"',
    );
    expect(gpuiProjectMessageStart).toBeGreaterThanOrEqual(0);
    expect(nativeHotkeyMessageStart).toBeGreaterThan(gpuiProjectMessageStart);
    const forwardingBranchStart = runHotkeySource.indexOf(
      'action.kind === "focusAdjacentGroup"',
    );
    const localSessionSlotBranchStart = runHotkeySource.indexOf(
      'action.kind === "focusSessionSlot"',
    );
    const createSessionBranchStart = runHotkeySource.indexOf(
      'action.kind === "createSession"',
      localSessionSlotBranchStart,
    );
    const hotkeyMessageStart = runHotkeySource.indexOf(
      'vscode.postMessage({ actionId: action.id, type: "runGhostexHotkeyAction" });',
      forwardingBranchStart,
    );
    expect(localSessionSlotBranchStart).toBeGreaterThanOrEqual(0);
    expect(createSessionBranchStart).toBeGreaterThan(localSessionSlotBranchStart);
    expect(forwardingBranchStart).toBeGreaterThanOrEqual(0);
    expect(forwardingBranchStart).toBeGreaterThan(localSessionSlotBranchStart);
    expect(hotkeyMessageStart).toBeGreaterThan(forwardingBranchStart);
    const localHandledSource = runHotkeySource.slice(0, forwardingBranchStart);
    const localSessionSlotBranchSource = runHotkeySource.slice(
      localSessionSlotBranchStart,
      createSessionBranchStart,
    );
    const forwardingBranchSource = runHotkeySource.slice(
      forwardingBranchStart,
      hotkeyMessageStart,
    );
    const hotkeyMessageEnd = runHotkeySource.indexOf("\n    }", hotkeyMessageStart);
    expect(hotkeyMessageEnd).toBeGreaterThan(hotkeyMessageStart);
    const hotkeyMessageSource = runHotkeySource.slice(hotkeyMessageStart, hotkeyMessageEnd);

    expect(contractMessageSource).toContain('type: "gpuiProjectSlotHotkey";');
    expect(contractMessageSource).toContain("slotNumber: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;");
    expect(extensionMessageSource).toContain("| SidebarNativeHotkeyMessage");
    expect(extensionMessageSource).toContain("| SidebarGpuiProjectSlotHotkeyMessage");
    expect(handleWindowMessageSource).toContain(`if (event.data.type === "gpuiProjectSlotHotkey") {
      resolveGpuiProjectSlotHotkey(event.data.slotNumber);
      return;
    }`);
    expect(handleWindowMessageSource).toContain(`if (event.data.type === "nativeHotkey") {
      runGhostexHotkeyAction(event.data.actionId);
      return;
    }`);
    expect(gpuiProjectSlotResolverSource).toContain("Number.isInteger(slotNumber)");
    expect(gpuiProjectSlotResolverSource).toContain(
      "displayedReferenceProjectGroupIds[ slotNumber - 1 ]",
    );
    expect(gpuiProjectSlotResolverSource).toContain(
      "groupsById[ groupId ]?.projectContext?.editor.projectId",
    );
    expect(gpuiProjectSlotResolverSource).toContain("handleSidebarProjectJump({");
    expect(gpuiProjectSlotResolverSource).toContain(
      "expandCollapsedProject: effectiveSettings.expandCollapsedProjectsOnJump",
    );
    expect(gpuiProjectSlotResolverSource).toContain(
      "showLessAfterExpand: effectiveSettings.showLessForExpandedProjectJumps",
    );
    expect(gpuiProjectSlotResolverSource).toContain("revealFocusedSession: true");
    expect(gpuiProjectSlotResolverSource).toContain(
      "displayedWorkspaceSessionIdsByGroup[ groupId ] ?? []",
    );
    expect(gpuiProjectSlotResolverSource).toContain(
      "sessionsById[ sessionId ]?.isFocused === true",
    );
    expect(gpuiProjectSlotResolverSource).toContain(
      "focusSidebarSessionFromNavigation(groupId, targetSessionId);",
    );
    expect(gpuiProjectSlotResolverSource).toContain(`vscode.postMessage({
      sessionId: targetSessionId,
      type: "focusSession",
    });`);
    expect(gpuiProjectSlotResolverSource).not.toContain('type: "focusGroup"');
    expect(gpuiProjectSlotResolverSource).not.toContain("runGhostexHotkeyAction");
    expect(localSessionSlotBranchSource).toContain('action.kind === "focusSessionSlot"');
    expect(localSessionSlotBranchSource).toContain(
      'dismissAppModalForSidebarNavigation("SettingsDismissal:focusSessionHotkey");',
    );
    expect(localSessionSlotBranchSource).toContain("focusSidebarSessionSlot(action.slotNumber);");
    expect(localSessionSlotBranchSource).toContain("return;");
    expect(localSessionSlotBranchSource).not.toContain("vscode.postMessage");
    expect(forwardingBranchSource).toContain('action.kind === "focusAdjacentGroup"');
    expect(forwardingBranchSource).toContain('action.kind === "focusDirection"');
    expect(forwardingBranchSource).toContain('action.kind === "focusedPaneAction"');
    expect(forwardingBranchSource).toContain('action.kind === "jumpToProject"');
    expect(forwardingBranchSource).toContain('action.kind === "openCommandsPanel"');
    expect(forwardingBranchSource).toContain('action.kind === "renameActiveSession"');
    expect(forwardingBranchSource).toContain('action.kind === "runActionSlot"');
    expect(forwardingBranchSource).toContain('action.kind === "setViewMode"');
    expect(forwardingBranchSource).toContain('action.kind === "splitFocusedPane"');
    expect(forwardingBranchSource).toContain('action.kind === "switchWorkareaView"');
    expect(localHandledSource).not.toContain('action.kind === "setViewMode"');
    expect(forwardingBranchSource).not.toContain('action.kind === "focusSessionSlot"');
    expect(hotkeyMessageSource.trim()).toBe(
      'vscode.postMessage({ actionId: action.id, type: "runGhostexHotkeyAction" });',
    );
  });

  test("routes GPUI Open Commands Panel through open/focus instead of modal or toggle fallback", () => {
    /*
     * CDXC:GPUICommandPalette 2026-06-27-08:11:
     * The shared Open Commands Panel command-palette row must stay an authority-only `runGhostexHotkeyAction` selector while GPUI routes `openCommandsPanel` to the command-pane open/focus path. This route must not collapse an already-visible command pane, must not carry renderer session/focus/path fields, and must not disturb the Settings app-modal hotkey route.
     */
    const runBuiltInCommandStart = commandPaletteSource.indexOf("const runBuiltInCommand");
    const runBuiltInCommandEnd = commandPaletteSource.indexOf(
      "  const runProjectCommand",
      runBuiltInCommandStart,
    );
    expect(runBuiltInCommandStart).toBeGreaterThanOrEqual(0);
    expect(runBuiltInCommandEnd).toBeGreaterThan(runBuiltInCommandStart);
    const runBuiltInCommandSource = commandPaletteSource.slice(
      runBuiltInCommandStart,
      runBuiltInCommandEnd,
    );
    const builtInHotkeyMessageStart = runBuiltInCommandSource.indexOf(
      "vscode.postMessage({\n      actionId: command.definition.id",
    );
    const builtInHotkeyMessageEnd = runBuiltInCommandSource.indexOf(
      "  };\n",
      builtInHotkeyMessageStart,
    );
    expect(builtInHotkeyMessageStart).toBeGreaterThanOrEqual(0);
    expect(builtInHotkeyMessageEnd).toBeGreaterThan(builtInHotkeyMessageStart);
    const builtInHotkeyMessageSource = runBuiltInCommandSource.slice(
      builtInHotkeyMessageStart,
      builtInHotkeyMessageEnd,
    );

    const focusedPaneMapperStart = gpuiMainSource.indexOf(
      "fn gpui_focused_pane_hotkey_action",
    );
    const focusedPaneMapperEnd = gpuiMainSource.indexOf(
      "fn gpui_command_palette_switch_workarea_hotkey_mode",
      focusedPaneMapperStart,
    );
    expect(focusedPaneMapperStart).toBeGreaterThanOrEqual(0);
    expect(focusedPaneMapperEnd).toBeGreaterThan(focusedPaneMapperStart);
    const focusedPaneMapperSource = gpuiMainSource.slice(
      focusedPaneMapperStart,
      focusedPaneMapperEnd,
    );

    const gpuiHotkeyBranchStart = gpuiMainSource.indexOf('"runGhostexHotkeyAction" => {');
    const gpuiHotkeyBranchEnd = gpuiMainSource.indexOf(
      '"refreshDaemonSessions" => {',
      gpuiHotkeyBranchStart,
    );
    expect(gpuiHotkeyBranchStart).toBeGreaterThanOrEqual(0);
    expect(gpuiHotkeyBranchEnd).toBeGreaterThan(gpuiHotkeyBranchStart);
    const gpuiHotkeyBranchSource = gpuiMainSource.slice(
      gpuiHotkeyBranchStart,
      gpuiHotkeyBranchEnd,
    );
    const openCommandsRouteStart = gpuiHotkeyBranchSource.indexOf(
      "Some(GpuiFocusedPaneHotkeyAction::OpenCommandsPanel)",
    );
    const openBrowserRouteStart = gpuiHotkeyBranchSource.indexOf(
      "Some(GpuiFocusedPaneHotkeyAction::OpenBrowserPane)",
      openCommandsRouteStart,
    );
    const modalFallbackStart = gpuiHotkeyBranchSource.indexOf(
      "gpui_app_modal_kind_for_hotkey_action_id",
      openCommandsRouteStart,
    );
    expect(openCommandsRouteStart).toBeGreaterThanOrEqual(0);
    expect(openBrowserRouteStart).toBeGreaterThan(openCommandsRouteStart);
    expect(modalFallbackStart).toBeGreaterThan(openCommandsRouteStart);
    const openCommandsRouteSource = gpuiHotkeyBranchSource.slice(
      openCommandsRouteStart,
      openBrowserRouteStart,
    );

    const paletteOpenStart = gpuiMainSource.indexOf("fn open_command_pane_from_command_palette");
    const paletteOpenEnd = gpuiMainSource.indexOf(
      "    fn handle_command_pane_control_action",
      paletteOpenStart,
    );
    expect(paletteOpenStart).toBeGreaterThanOrEqual(0);
    expect(paletteOpenEnd).toBeGreaterThan(paletteOpenStart);
    const paletteOpenSource = gpuiMainSource.slice(paletteOpenStart, paletteOpenEnd);

    const appModalMapperStart = gpuiMainSource.indexOf(
      "fn gpui_app_modal_kind_for_hotkey_action_id",
    );
    const appModalMapperEnd = gpuiMainSource.indexOf(
      "enum GpuiKeepAwakeRuntimeSource",
      appModalMapperStart,
    );
    expect(appModalMapperStart).toBeGreaterThanOrEqual(0);
    expect(appModalMapperEnd).toBeGreaterThan(appModalMapperStart);
    const appModalMapperSource = gpuiMainSource.slice(appModalMapperStart, appModalMapperEnd);

    expect(runBuiltInCommandSource).toContain('type: "runGhostexHotkeyAction"');
    expect(builtInHotkeyMessageSource.trim()).toBe(`vscode.postMessage({
      actionId: command.definition.id,
      type: "runGhostexHotkeyAction",
    });`);
    expect(builtInHotkeyMessageSource).not.toContain("sessionId");
    expect(builtInHotkeyMessageSource).not.toContain("focusedSessionId");
    expect(builtInHotkeyMessageSource).not.toContain("projectId");
    expect(builtInHotkeyMessageSource).not.toContain("path");
    expect(focusedPaneMapperSource).toContain(
      '"openCommandsPanel" => Some(GpuiFocusedPaneHotkeyAction::OpenCommandsPanel)',
    );
    expect(openCommandsRouteSource).toContain("self.open_command_pane_from_command_palette(window, cx);");
    expect(openCommandsRouteSource).toContain("return;");
    expect(openCommandsRouteSource).not.toContain("open_gpui_app_modal_window");
    expect(openCommandsRouteSource).not.toContain("toggle_command_pane_from_keyboard");
    expect(paletteOpenSource).toContain("command_pane_palette_open_decision");
    expect(paletteOpenSource).toContain("CommandPanePaletteOpenDecision::OpenAndFocus");
    expect(paletteOpenSource).toContain("CommandPanePaletteOpenDecision::FocusVisible");
    expect(paletteOpenSource).toContain("self.open_command_pane_from_shared_settings(window)");
    expect(paletteOpenSource).toContain("self.focus_command_pane();");
    expect(paletteOpenSource).toContain("self.persist_shell_layout_state();");
    expect(paletteOpenSource).toContain("self.refresh_sidebar_command_pane_sessions_if_changed(cx);");
    expect(paletteOpenSource).not.toContain("toggle_command_pane_from_keyboard");
    expect(appModalMapperSource).toContain(
      '"openSettings" => Some(GpuiAppModalKind::Settings)',
    );
    expect(appModalMapperSource).not.toContain('"openCommandsPanel"');
  });

  test("exposes global app modals and main-window actions in command mode", () => {
    /*
     * CDXC:CommandPalette 2026-06-18-03:32:
     * Cmd+Shift+P should open global app surfaces directly from command mode,
     * including Previous Sessions plus the Features, Setup, and
     * Changelog actions from the Tips header.
     *
     * CDXC:CommandPalette 2026-06-18-04:53:
     * The setup command should render as Setup while search metadata keeps
     * Ghostex setup and onboarding discoverable.
     *
     * CDXC:GhostexTutorialVideo 2026-06-18-04:49:
     * Command mode should include the dedicated tutorial video entry so users
     * can open the one-video walkthrough without replacing the Features tour.
     *
     * CDXC:CommandPalette 2026-06-18-03:46:
     * Main-window buttons Add Project, Search by Text, Quick Terminal, Quick
     * Browser Tab, Automations, Open Current Project in Finder, and visible
     * Open In targets should be command-palette rows too. Mobile, Discord,
     * Recent Projects, and section collapse controls are intentionally omitted.
     *
     * CDXC:Hotkeys 2026-06-19-00:35:
     * Hotkeys is now supplied by the shared openHotkeys command so it can show
     * Cmd+. as a real configurable shortcut instead of a duplicate no-shortcut
     * app-modal entry.
     */
    expect(commandPaletteSource).toContain("const APP_MODAL_PALETTE_COMMANDS");
    expect(commandPaletteSource).toContain("Previous Sessions");
    expect(commandPaletteSource).toContain("Pinned Prompts");
    expect(commandPaletteSource).toContain("Running Sessions");
    expect(commandPaletteSource).toContain("Scratch Pad");
    expect(commandPaletteSource).toContain("Agents Hub");
    expect(commandPaletteSource).toContain("Configure Agents");
    expect(commandPaletteSource).toContain("Actions");
    expect(commandPaletteSource).toContain("Open Targets");
    expect(commandPaletteSource).toContain('action.kind === "openHotkeys"');
    expect(commandPaletteSource).not.toContain('commandId: "hotkeys"');
    /*
     * CDXC:FocusedSessionActions 2026-06-19-15:43:
     * Focused session sleep/wake/close/timer commands belong in the command
     * palette Pane Actions group even when only Sleep has a default shortcut.
     */
    expect(commandPaletteSource).toContain('"sleepFocusedSession"');
    expect(commandPaletteSource).toContain('"wakeFocusedSession"');
    expect(commandPaletteSource).toContain('"closeFocusedSession"');
    expect(commandPaletteSource).toContain('"closeAfterDone"');
    expect(commandPaletteSource).toContain("Sleep, Wake, Close, and Close After Done");
    expect(commandPaletteSource).toContain("Features");
    expect(commandPaletteSource).toContain("Tutorial Video");
    expect(commandPaletteSource).toContain('title: "Setup"');
    expect(commandPaletteSource).toContain("Changelog");
    expect(commandPaletteSource).toContain("Add Project");
    expect(commandPaletteSource).toContain("Search by Text");
    expect(commandPaletteSource).toContain("Quick Terminal");
    expect(commandPaletteSource).toContain("Quick Browser Tab");
    expect(commandPaletteSource).toContain("Automations");
    expect(commandPaletteSource).toContain("Open Current Project in Finder");
    expect(commandPaletteSource).toContain("function createOpenTargetPaletteCommands");
    expect(commandPaletteSource).toContain("Open In: ${target.label}");
    expect(commandPaletteSource).toContain('openAppModal({ modal: command.modal, type: "open" });');
    expect(commandPaletteSource).toContain("vscode.postMessage(command.message);");
    expect(commandPaletteSource).toContain('message: { type: "pickWorkspaceFolder" }');
    expect(commandPaletteSource).toContain('message: { type: "searchPreviousSessionsByText" }');
    expect(commandPaletteSource).toContain('message: { type: "createChat" }');
    expect(commandPaletteSource).toContain('message: { type: "openBrowserChat" }');
    expect(commandPaletteSource).toContain('message: { type: "openAutomationsPage" }');
    expect(commandPaletteSource).toContain('message: { type: "openCurrentProjectInFinder" }');
    expect(commandPaletteSource).toContain('message: { type: "openGhostexTutorialVideo" }');
    expect(commandPaletteSource).toContain('message: { type: "openWorkspaceWelcome" }');
    expect(commandPaletteSource).toContain(
      'message: { type: "openBrowserPane", url: GHOSTEX_CHANGELOG_URL }',
    );
    expect(commandPaletteSource).toContain('type: "openCurrentProjectInTarget"');
    expect(commandPaletteSource).toContain("function getBuiltInCommandKey");
    expect(modalHostSource).toContain("openTargetSettings={settings}");
    expect(sessionGridContractSource).toContain('type: "openCurrentProjectInFinder"');
    expect(sessionGridContractSource).toContain('type: "openGhostexTutorialVideo"');
    expect(sessionGridContractSource).toContain('type: "openCurrentProjectInTarget"');
    expect(nativeSidebarSource).toContain("function openCurrentProjectInFinderFromCommandPalette()");
    expect(nativeSidebarSource).toContain("function openCurrentProjectInTargetFromCommandPalette");
    expect(nativeSidebarSource).toContain('case "openCurrentProjectInFinder":');
    expect(nativeSidebarSource).toContain('case "openCurrentProjectInTarget":');
  });

  test("keeps session search copy and single-row selection styling scoped", () => {
    /*
     * CDXC:CommandPalette 2026-06-13-22:22:
     * Session search mode must invite typing `>` for commands, and live
     * focused/visible session state must not make multiple rows look hovered
     * inside the command palette.
    */
    expect(commandPaletteSource).toContain("Search sessions or write > for commands...");
    expect(commandPaletteSource).toContain("openRequestSequence");
    expect(commandPaletteSource).toContain("pendingModeSwitchSelectionRef");
    expect(commandPaletteSource).toContain('data-ghostex-command-palette-input="true"');
    expect(commandPaletteSearchSource).toContain('heading: "Current Project"');
    expect(commandPaletteSearchSource).toContain('heading: "Other Active Projects"');
    expect(commandPaletteSearchSource).toContain('heading: "Collapsed Projects"');
    expect(commandPaletteSearchSource).not.toContain("Current Sessions");
    expect(commandPaletteSource.match(/data-focused="false"/g)?.length ?? 0).toBeGreaterThanOrEqual(
      2,
    );
    expect(commandPaletteSource.match(/data-visible="false"/g)?.length ?? 0).toBeGreaterThanOrEqual(
      2,
    );
    expect(sidebarStylesSource).toContain("CDXC:CommandPalette 2026-06-13-22:22:");
    expect(sidebarStylesSource).toContain(
      '.ghostex-command-palette-session-item[data-slot="command-item"]',
    );
    expect(sidebarStylesSource).toContain(".ghostex-command-palette-session-row::after");
  });
});

function createSession(
  overrides: Pick<SidebarSessionItem, "alias" | "detail" | "sessionId"> &
    Partial<
      Pick<
        SidebarSessionItem,
        "displayTitle" | "isFocused" | "lastInteractionAt" | "primaryTitle" | "terminalTitle"
      >
    >,
): SidebarSessionItem {
  return {
    activity: "idle",
    alias: overrides.alias,
    column: 0,
    detail: overrides.detail,
    displayTitle: overrides.displayTitle,
    isFocused: overrides.isFocused ?? false,
    isRunning: true,
    isVisible: true,
    lastInteractionAt: overrides.lastInteractionAt,
    primaryTitle: overrides.primaryTitle,
    row: 0,
    sessionId: overrides.sessionId,
    shortcutLabel: "",
    terminalTitle: overrides.terminalTitle,
  };
}

function createPreviousSession(
  overrides: Pick<SidebarPreviousSessionItem, "closedAt" | "historyId" | "sessionId"> &
    Partial<
      Pick<
        SidebarPreviousSessionItem,
        | "alias"
        | "displayTitle"
        | "lastInteractionAt"
        | "primaryTitle"
        | "projectPath"
        | "terminalTitle"
      >
    >,
): SidebarPreviousSessionItem {
  return {
    ...createSession({
      alias: overrides.alias ?? overrides.sessionId,
      detail: "Terminal",
      displayTitle: overrides.displayTitle,
      lastInteractionAt: overrides.lastInteractionAt,
      primaryTitle: overrides.primaryTitle,
      sessionId: overrides.sessionId,
      terminalTitle: overrides.terminalTitle,
    }),
    closedAt: overrides.closedAt,
    historyId: overrides.historyId,
    isGeneratedName: false,
    isRestorable: true,
    projectPath: overrides.projectPath,
  };
}
