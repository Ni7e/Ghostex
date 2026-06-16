import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import type {
  SidebarPreviousSessionItem,
  SidebarSessionItem,
} from "../shared/session-grid-contract";
import {
  createCommandPaletteSessionSections,
  filterCommandPaletteCurrentSessionItems,
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
const commandPaletteSearchSource = readFileSync(
  new URL("./command-palette-session-search.ts", import.meta.url),
  "utf8",
);
const commandInputSource = readFileSync(
  new URL("../components/ui/command.tsx", import.meta.url),
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

  test("filters current sessions by session metadata and project label", () => {
    const reviewSession = createSession({
      alias: "Claude Review",
      detail: "Terminal",
      sessionId: "session-review",
    });
    const sourceSession = createSession({
      alias: "Source Shell",
      detail: "Terminal",
      sessionId: "session-source",
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
        groupId: "group-docs",
        groupIsActive: false,
        projectLabel: "Docs",
        searchText: "Source Shell Docs",
        session: sourceSession,
      },
    ];

    expect(filterCommandPaletteCurrentSessionItems(items, "claude")).toEqual([items[0]]);
    expect(filterCommandPaletteCurrentSessionItems(items, "docs")).toEqual([items[1]]);
    expect(filterCommandPaletteCurrentSessionItems(items, "")).toEqual(items);
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
     * Session search sections are ordered Current Project, Active Projects,
     * Collapsed Projects, then Previous sessions in render. Each area sorts
     * its rows by Last Active descending instead of inheriting workspace order.
     */
    const sections = createCommandPaletteSessionSections(items, {
      collapsedGroupsById: { "group-collapsed": true },
    });

    expect(sections.map((section) => section.heading)).toEqual([
      "Current Project",
      "Active Projects",
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
    ).toEqual(["Active Projects"]);
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
    expect(commandPaletteSearchSource).toContain('heading: "Active Projects"');
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
    Partial<Pick<SidebarSessionItem, "isFocused" | "lastInteractionAt">>,
): SidebarSessionItem {
  return {
    activity: "idle",
    alias: overrides.alias,
    column: 0,
    detail: overrides.detail,
    isFocused: overrides.isFocused ?? false,
    isRunning: true,
    isVisible: true,
    lastInteractionAt: overrides.lastInteractionAt,
    row: 0,
    sessionId: overrides.sessionId,
    shortcutLabel: "",
  };
}

function createPreviousSession(
  overrides: Pick<SidebarPreviousSessionItem, "closedAt" | "historyId" | "sessionId"> &
    Partial<Pick<SidebarPreviousSessionItem, "lastInteractionAt">>,
): SidebarPreviousSessionItem {
  return {
    ...createSession({
      alias: overrides.sessionId,
      detail: "Terminal",
      lastInteractionAt: overrides.lastInteractionAt,
      sessionId: overrides.sessionId,
    }),
    closedAt: overrides.closedAt,
    historyId: overrides.historyId,
    isGeneratedName: false,
    isRestorable: true,
  };
}
