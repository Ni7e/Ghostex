import {
  IconArrowLeft,
  IconArrowRight,
  IconArrowsDiagonal2,
  IconBrowser,
  IconClock,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconDownload,
  IconEdit,
  IconExternalLink,
  IconGitFork,
  IconKeyboard,
  IconLayoutSidebarRightExpand,
  IconLayoutDashboard,
  IconLayoutSidebar,
  IconMoon,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconRotateClockwise,
  IconSettings,
  IconTerminal2,
  IconWindowMaximize,
} from "@tabler/icons-react";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import type { SidebarCommandButton } from "../shared/sidebar-commands";
import {
  DEFAULT_SIDEBAR_COMMAND_ICON,
  DEFAULT_SIDEBAR_COMMAND_ICON_COLOR,
} from "../shared/sidebar-command-icons";
import {
  GHOSTEX_HOTKEY_DEFINITIONS,
  normalizeHotkeyText,
  normalizeghostexHotkeySettings,
  type ghostexFocusedPaneAction,
  type ghostexHotkeyDefinition,
  type ghostexHotkeySettings,
} from "../shared/ghostex-hotkeys";
import type {
  ExtensionToSidebarMessage,
  SidebarPreviousSessionItem,
  SidebarSessionItem,
} from "../shared/session-grid-contract";
import { openAppModal } from "./app-modal-host-bridge";
import { SidebarCommandIconGlyph } from "./sidebar-command-icon";
import { formatSidebarHotkeyLabel } from "./hotkey-label";
import { filterPreviousSessions, filterPreviousSessionsModalItems } from "./previous-session-search";
import {
  createCommandPaletteCurrentSessionItems,
  createCommandPaletteSessionSections,
  createPreviousSessionSearchText,
  filterCommandPaletteCurrentSessionItems,
  filterCommandPaletteItems,
  getCommandPaletteCommandQuery,
  getCommandPaletteModeSwitchSelectionRange,
  getCommandPaletteQueryForRequestedMode,
  getCommandPaletteCurrentGroupId,
  getPreviousSessionProjectLabel,
  isCommandPaletteCommandMode,
  sortCommandPalettePreviousSessionsByLastActive,
  type CommandPaletteCurrentSessionItem,
} from "./command-palette-session-search";
import {
  getSessionCardTitleTooltip,
  OverflowTooltipText,
  SessionCardContent,
  SessionFloatingAgentIcon,
  shouldShowTerminalSessionIcon,
} from "./session-card-content";
import { getEffectiveSessionTag } from "./session-tag-ui";
import { useSidebarStore } from "./sidebar-store";
import type { WebviewApi } from "./webview-api";

type CommandPaletteProps = {
  collapsedGroupsById?: Record<string, true>;
  commands: readonly SidebarCommandButton[];
  hotkeys?: ghostexHotkeySettings;
  initialQuery?: string;
  isOpen: boolean;
  isPrewarm?: boolean;
  onBrowserCommandRun?: () => void;
  onOpenChange: (isOpen: boolean) => void;
  openRequestSequence?: number;
  petOverlayEnabled?: boolean;
  vscode: WebviewApi;
};

type HotkeyPaletteCommand = {
  definition: ghostexHotkeyDefinition;
  hotkey: string;
  kind: "hotkey";
  searchText: string;
  title: string;
};

type BuiltInPaletteCommand =
  | HotkeyPaletteCommand
  | {
      hotkey: "";
      kind: "cloneRepository";
      searchText: string;
      title: string;
    }
  | {
      hotkey: "";
      kind: "pet";
      searchText: string;
      title: string;
    };

type ProjectPaletteCommand = {
  command: SidebarCommandButton;
  hotkey: string;
  slotNumber: number;
};

const PANE_ACTION_COMMAND_IDS = [
  "openBrowserPane",
  "splitMore",
  "splitMoreDown",
  "rotatePanesClockwise",
  "mergeAllTabs",
  "renameActiveSession",
  "delayedSend",
  "forkSession",
  "reloadSession",
  "popOutPane",
] as const satisfies readonly ghostexHotkeyDefinition["id"][];

const COMMAND_PALETTE_PREVIOUS_SESSIONS_LIMIT = 20;
const COMMAND_PALETTE_PREVIOUS_SESSIONS_QUERY_DEBOUNCE_MS = 200;

export function CommandPalette({
  collapsedGroupsById = {},
  commands,
  hotkeys,
  initialQuery = "",
  isOpen,
  isPrewarm = false,
  onBrowserCommandRun,
  onOpenChange,
  openRequestSequence = 0,
  petOverlayEnabled = false,
  vscode,
}: CommandPaletteProps) {
  const [inputValue, setInputValue] = useState(initialQuery);
  const [remotePreviousSessions, setRemotePreviousSessions] = useState<
    SidebarPreviousSessionItem[] | undefined
  >();
  const latestPreviousSessionsRequestIdRef = useRef<string | undefined>(undefined);
  const hasRequestedPreviousSessionsRef = useRef(false);
  const latestOpenRequestSequenceRef = useRef(openRequestSequence);
  const pendingModeSwitchSelectionRef = useRef<{ end: number; start: number } | undefined>(
    undefined,
  );
  const wasOpenRef = useRef(isOpen);
  const groupsById = useSidebarStore((state) => state.groupsById);
  const previousSessions = useSidebarStore((state) => state.previousSessions);
  const sessionIdsByGroup = useSidebarStore((state) => state.sessionIdsByGroup);
  const sessionsById = useSidebarStore((state) => state.sessionsById);
  const workspaceGroupIds = useSidebarStore((state) => state.workspaceGroupIds);
  const showDebugSessionNumbers = useSidebarStore((state) => state.hud.debuggingMode);
  const applyLocalFocus = useSidebarStore((state) => state.applyLocalFocus);
  const normalizedHotkeys = useMemo(() => normalizeghostexHotkeySettings(hotkeys), [hotkeys]);
  const isCommandMode = isCommandPaletteCommandMode(inputValue);
  const commandQuery = isCommandMode ? getCommandPaletteCommandQuery(inputValue) : "";
  const sessionQuery = isCommandMode ? "" : inputValue.trim();
  const createBuiltInCommand = (definition: ghostexHotkeyDefinition): HotkeyPaletteCommand => {
    const hotkey = normalizeHotkeyText(normalizedHotkeys[definition.id] ?? definition.defaultKey);
    return {
      definition,
      hotkey,
      kind: "hotkey",
      searchText: `${definition.title} ${definition.description} ${hotkey}`,
      title: definition.title,
    };
  };
  const builtInCommands = useMemo(
    () => {
      const paneActionIds = new Set<ghostexHotkeyDefinition["id"]>(PANE_ACTION_COMMAND_IDS);
      const hotkeyCommands: BuiltInPaletteCommand[] = GHOSTEX_HOTKEY_DEFINITIONS.filter(
        (definition) =>
          definition.id !== "openCommandPalette" &&
          definition.id !== "openSessionSearchPalette" &&
          definition.action.kind !== "runActionSlot" &&
          !paneActionIds.has(definition.id),
      ).map(createBuiltInCommand);
      const petTitle = petOverlayEnabled ? "Sleep Pet" : "Wake Pet";
      const petCommand: BuiltInPaletteCommand = {
        hotkey: "",
        kind: "pet",
        searchText: `${petTitle} pet overlay ${petOverlayEnabled ? "hide sleep" : "show wake"}`,
        title: petTitle,
      };
      const cloneRepositoryCommand: BuiltInPaletteCommand = {
        hotkey: "",
        kind: "cloneRepository",
        searchText: "Clone Repository add project git clone github codeberg repository",
        title: "Clone Repository",
      };
      return [...hotkeyCommands, cloneRepositoryCommand, petCommand];
    },
    [normalizedHotkeys, petOverlayEnabled],
  );
  const paneActionCommands = useMemo(() => {
    const definitionsById = new Map(
      GHOSTEX_HOTKEY_DEFINITIONS.map((definition) => [definition.id, definition]),
    );
    return PANE_ACTION_COMMAND_IDS.map((id) => definitionsById.get(id))
      .filter((definition): definition is ghostexHotkeyDefinition => definition !== undefined)
      .map(createBuiltInCommand);
  }, [normalizedHotkeys]);
  const projectCommands = useMemo(
    () =>
      commands
        .map((command, index): ProjectPaletteCommand => {
          const slotNumber = index + 1;
          const actionSlotId = getActionSlotHotkeyId(slotNumber);
          return {
            command,
            hotkey: actionSlotId
              ? normalizeHotkeyText(normalizedHotkeys[actionSlotId] ?? "")
              : "",
            slotNumber,
          };
        })
        .filter(({ command }) => isRunnableOrConfigurableCommand(command)),
    [commands, normalizedHotkeys],
  );
  const currentSessionItems = useMemo(
    () =>
      createCommandPaletteCurrentSessionItems({
        groupsById,
        sessionIdsByGroup,
        sessionsById,
        workspaceGroupIds,
      }),
    [groupsById, sessionIdsByGroup, sessionsById, workspaceGroupIds],
  );
  const filteredBuiltInCommands = useMemo(
    () => filterCommandPaletteItems(builtInCommands, commandQuery, (command) => command.searchText),
    [builtInCommands, commandQuery],
  );
  const filteredPaneActionCommands = useMemo(
    () =>
      filterCommandPaletteItems(paneActionCommands, commandQuery, (command) => command.searchText),
    [commandQuery, paneActionCommands],
  );
  const filteredProjectCommands = useMemo(
    () =>
      filterCommandPaletteItems(projectCommands, commandQuery, ({ command, hotkey, slotNumber }) =>
        `${getCommandTitle(command)} ${getCommandDescription(command)} ${hotkey} action ${slotNumber}`,
      ),
    [commandQuery, projectCommands],
  );
  const filteredCurrentSessionItems = useMemo(
    () => filterCommandPaletteCurrentSessionItems(currentSessionItems, sessionQuery),
    [currentSessionItems, sessionQuery],
  );
  const commandPaletteCurrentGroupId = useMemo(
    () => getCommandPaletteCurrentGroupId(currentSessionItems),
    [currentSessionItems],
  );
  const sessionSections = useMemo(
    () =>
      createCommandPaletteSessionSections(filteredCurrentSessionItems, {
        collapsedGroupsById,
        currentGroupId: commandPaletteCurrentGroupId,
      }),
    [collapsedGroupsById, commandPaletteCurrentGroupId, filteredCurrentSessionItems],
  );
  const modalPreviousSessions = useMemo(
    () => filterPreviousSessionsModalItems(remotePreviousSessions ?? previousSessions),
    [previousSessions, remotePreviousSessions],
  );
  const filteredPreviousSessions = useMemo(
    () =>
      sortCommandPalettePreviousSessionsByLastActive(
        filterPreviousSessions(modalPreviousSessions, sessionQuery),
      ).slice(0, COMMAND_PALETTE_PREVIOUS_SESSIONS_LIMIT),
    [modalPreviousSessions, sessionQuery],
  );
  const hasCommandResults =
    filteredBuiltInCommands.length > 0 ||
    filteredPaneActionCommands.length > 0 ||
    filteredProjectCommands.length > 0;
  const hasSessionResults =
    sessionSections.some((section) => section.items.length > 0) ||
    filteredPreviousSessions.length > 0;

  useLayoutEffect(() => {
    const selection = pendingModeSwitchSelectionRef.current;
    if (!selection) {
      return;
    }
    pendingModeSwitchSelectionRef.current = undefined;
    const input = document.querySelector<HTMLInputElement>(
      '[data-ghostex-command-palette-input="true"]',
    );
    input?.focus();
    input?.setSelectionRange(selection.start, selection.end);
  }, [inputValue]);

  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      latestOpenRequestSequenceRef.current = openRequestSequence;
      pendingModeSwitchSelectionRef.current = undefined;
      setInputValue(initialQuery);
      setRemotePreviousSessions(undefined);
      latestPreviousSessionsRequestIdRef.current = undefined;
      hasRequestedPreviousSessionsRef.current = false;
      return;
    }

    const isFollowUpOpenRequest =
      wasOpenRef.current && latestOpenRequestSequenceRef.current !== openRequestSequence;
    wasOpenRef.current = true;
    latestOpenRequestSequenceRef.current = openRequestSequence;
    if (!isFollowUpOpenRequest) {
      setInputValue(initialQuery);
      return;
    }

    setInputValue((currentValue) => {
      const nextValue = getCommandPaletteQueryForRequestedMode(currentValue, initialQuery);
      if (nextValue !== currentValue) {
        /*
         * CDXC:CommandPalette 2026-06-15-10:27:
         * Switching an already-open palette between files and commands keeps
         * the typed query, preserves the `>` mode marker when entering command
         * mode, and selects the editable query text so the next keystroke can
         * replace the old search.
         */
        pendingModeSwitchSelectionRef.current =
          getCommandPaletteModeSwitchSelectionRange(nextValue);
      }
      return nextValue;
    });
  }, [initialQuery, isOpen, openRequestSequence]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleMessage = (event: MessageEvent<ExtensionToSidebarMessage>) => {
      if (event.data.type !== "previousSessionsResult") {
        return;
      }
      if (event.data.requestId !== latestPreviousSessionsRequestIdRef.current) {
        return;
      }
      setRemotePreviousSessions(event.data.previousSessions);
    };
    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || isPrewarm || isCommandMode) {
      latestPreviousSessionsRequestIdRef.current = undefined;
      if (!isOpen || isCommandMode) {
        setRemotePreviousSessions(undefined);
        hasRequestedPreviousSessionsRef.current = false;
      }
      return;
    }

    const requestDelay = hasRequestedPreviousSessionsRef.current
      ? COMMAND_PALETTE_PREVIOUS_SESSIONS_QUERY_DEBOUNCE_MS
      : 0;
    const timeoutId = window.setTimeout(() => {
      const requestId = `command-palette-previous-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`;
      hasRequestedPreviousSessionsRef.current = true;
      latestPreviousSessionsRequestIdRef.current = requestId;
      /*
       * CDXC:CommandPalette 2026-06-13-22:18:
       * Session-search mode must include current sessions immediately and
       * gxserver previous sessions in a separate section. Query history on
       * demand like the Previous Sessions modal instead of reviving a startup
       * hydrated cache or adding a command-palette-only fallback source.
       */
      vscode.postMessage({
        limit: COMMAND_PALETTE_PREVIOUS_SESSIONS_LIMIT,
        query: sessionQuery || undefined,
        requestId,
        type: "requestPreviousSessions",
      });
    }, requestDelay);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isCommandMode, isOpen, isPrewarm, sessionQuery, vscode]);

  const runBuiltInCommand = (command: BuiltInPaletteCommand) => {
    if (command.kind === "pet") {
      onOpenChange(false);
      vscode.postMessage({
        type: "togglePetOverlay",
      });
      return;
    }
    if (command.kind === "cloneRepository") {
      onOpenChange(false);
      openAppModal({ modal: "addRepository", type: "open" });
      return;
    }
    onOpenChange(false);
    vscode.postMessage({
      actionId: command.definition.id,
      type: "runGhostexHotkeyAction",
    });
  };

  const runProjectCommand = (command: SidebarCommandButton) => {
    if (!isConfigured(command)) {
      /*
      CDXC:CommandPalette 2026-06-15-15:29:
      Selecting an unconfigured project action should take users to Settings > Actions, where the reusable command list now owns action setup instead of a standalone Configure Action modal.
      */
      onOpenChange(false);
      openAppModal({
        initialTab: "actions",
        modal: "settings",
        type: "open",
      });
      return;
    }

    if (command.actionType === "browser") {
      onBrowserCommandRun?.();
    }
    onOpenChange(false);
    vscode.postMessage({
      commandId: command.commandId,
      type: "runSidebarCommand",
    });
  };

  const focusCurrentSession = (item: CommandPaletteCurrentSessionItem) => {
    applyLocalFocus(item.groupId, item.session.sessionId);
    onOpenChange(false);
    vscode.postMessage({
      sessionId: item.session.sessionId,
      type: "focusSession",
    });
  };

  const restorePreviousSession = (session: SidebarPreviousSessionItem) => {
    if (!session.isRestorable) {
      return;
    }
    onOpenChange(false);
    vscode.postMessage({
      historyId: session.historyId,
      type: "restorePreviousSession",
    });
  };

  return (
    <CommandDialog
      className="ghostex-settings-shadcn ghostex-command-palette-dialog top-1/2 -translate-y-1/2"
      description="Search Ghostex commands and project actions."
      open={isOpen}
      showCloseButton={false}
      title="Command Palette"
      onOpenChange={onOpenChange}
    >
      {/* CDXC:CommandPalette 2026-06-13-10:26:
          Cmd+Shift+P opens a shadcn Base-style command palette that lists the
          current Ghostex hotkey actions plus the project Actions available
          from the active sidebar context. Hotkeys are right-aligned with
          CommandShortcut so discoverability stays inside the command surface.

          CDXC:CommandPalette 2026-05-16-08:18:
          The palette should not list itself as a command, Ghostex built-ins
          should be single-line rows without descriptions, and the pet row must
          reflect the current wake/sleep state before routing through the shared
          settings-owned pet toggle.

          CDXC:CommandPalette 2026-05-16-13:04:
          Command rows without assigned shortcuts should leave the right edge
          blank instead of showing "No hotkey" placeholder text so the palette
          only surfaces concrete accelerators.

          CDXC:ActionsHotkeys 2026-05-17-01:18:
          Project actions must stay in the same order as the Actions settings
          list. The first five rows display and execute positional action-slot
          hotkeys, so reordering actions changes which command Ctrl+Shift+N
          starts without changing the stored hotkey ids.

          CDXC:CommandPalette 2026-05-17-01:32:
          Focused pane-menu commands should appear together in the command
          palette, matching the pane menu order shown in native chrome while
          still using shared configurable hotkey definitions.

          CDXC:AddRepository 2026-05-29-11:45:
          Clone Repository should be available from the command palette as a Ghostex built-in command and open the same full-window clone modal as the Projects header button, without going through configurable project actions. */}
      <Command shouldFilter={false}>
        {/*
         * CDXC:CommandPalette 2026-06-11-09:14:
         * CommandInput sits inside InputGroup without an inline-start addon, so
         * add pl-3 so the query text aligns with command-row icons below.
         *
         * CDXC:CommandPalette 2026-06-13-22:18:
         * The input value is the mode switch. A trimmed leading `>` means
         * command fuzzy finding; no prefix means current-session and previous-
         * session search. Keep the prefix as actual input text so Cmd+Shift+P
         * opens with the caret immediately after `>`.
         *
         * CDXC:CommandPalette 2026-06-15-16:21:
         * Escape while the command palette is shown must always close the
         * palette. Do not let the shared CommandInput clear the query first;
         * close the modal directly from the palette-owned key handler.
         */}
        <CommandInput
          className="pl-3"
          clearOnEscape={false}
          clearLabel="Clear command palette search"
          data-ghostex-command-palette-input="true"
          onKeyDown={(event) => {
            if (event.key !== "Escape") {
              return;
            }

            event.preventDefault();
            event.stopPropagation();
            onOpenChange(false);
          }}
          placeholder={
            isCommandMode
              ? "Search Ghostex commands..."
              : "Search sessions or write > for commands..."
          }
          value={inputValue}
          onValueChange={setInputValue}
        />
        <CommandList className="ghostex-command-palette-list">
          {isCommandMode ? (
            <>
              {!hasCommandResults ? <CommandEmpty>No commands found.</CommandEmpty> : null}
              {filteredBuiltInCommands.length > 0 ? (
                <CommandGroup heading="Ghostex">
                  {filteredBuiltInCommands.map((command) => (
                    <CommandItem
                      key={command.kind === "hotkey" ? command.definition.id : command.kind}
                      value={command.searchText}
                      onSelect={() => runBuiltInCommand(command)}
                    >
                      <BuiltInCommandIcon command={command} />
                      <span className="ghostex-command-palette-copy">
                        <span className="ghostex-command-palette-title">{command.title}</span>
                      </span>
                      {command.hotkey ? (
                        <CommandShortcut>{formatSidebarHotkeyLabel(command.hotkey)}</CommandShortcut>
                      ) : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
              {filteredPaneActionCommands.length > 0 ? (
                <>
                  {filteredBuiltInCommands.length > 0 ? <CommandSeparator /> : null}
                  <CommandGroup heading="Pane Actions">
                    {filteredPaneActionCommands.map((command) => (
                      <CommandItem
                        key={command.definition.id}
                        value={command.searchText}
                        onSelect={() => runBuiltInCommand(command)}
                      >
                        <BuiltInCommandIcon command={command} />
                        <span className="ghostex-command-palette-copy">
                          <span className="ghostex-command-palette-title">{command.title}</span>
                        </span>
                        {command.hotkey ? (
                          <CommandShortcut>
                            {formatSidebarHotkeyLabel(command.hotkey)}
                          </CommandShortcut>
                        ) : null}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              ) : null}
              {filteredProjectCommands.length > 0 ? (
                <>
                  {filteredBuiltInCommands.length > 0 || filteredPaneActionCommands.length > 0 ? (
                    <CommandSeparator />
                  ) : null}
                  <CommandGroup heading="Project Actions">
                    {filteredProjectCommands.map(({ command, hotkey, slotNumber }) => (
                      <CommandItem
                        key={command.commandId}
                        value={`${getCommandTitle(command)} ${getCommandDescription(command)} ${hotkey} action ${slotNumber}`}
                        onSelect={() => runProjectCommand(command)}
                      >
                        <SidebarCommandIconGlyph
                          color={command.iconColor ?? DEFAULT_SIDEBAR_COMMAND_ICON_COLOR}
                          icon={command.icon ?? DEFAULT_SIDEBAR_COMMAND_ICON}
                          stroke={1.8}
                        />
                        <span className="ghostex-command-palette-copy">
                          <span className="ghostex-command-palette-title">
                            {getCommandTitle(command)}
                          </span>
                          <span className="ghostex-command-palette-description">
                            {getCommandDescription(command)}
                          </span>
                        </span>
                        {hotkey ? (
                          <CommandShortcut>{formatSidebarHotkeyLabel(hotkey)}</CommandShortcut>
                        ) : null}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              ) : null}
            </>
          ) : (
            <>
              {!hasSessionResults ? <CommandEmpty>No sessions found.</CommandEmpty> : null}
              {sessionSections.map((section, sectionIndex) => (
                <Fragment key={section.key}>
                  {sectionIndex > 0 ? <CommandSeparator /> : null}
                  <CommandGroup heading={section.heading}>
                    {section.items.map((item) => (
                      <CommandItem
                        className="ghostex-command-palette-session-item"
                        key={item.session.sessionId}
                        value={item.searchText}
                        onSelect={() => focusCurrentSession(item)}
                      >
                        <CommandPaletteSessionRow
                          projectLabel={item.projectLabel}
                          session={item.session}
                          showDebugSessionNumbers={showDebugSessionNumbers}
                          state="current"
                        />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </Fragment>
              ))}
              {filteredPreviousSessions.length > 0 ? (
                <>
                  {sessionSections.length > 0 ? <CommandSeparator /> : null}
                  <CommandGroup heading="Previous sessions">
                    {filteredPreviousSessions.map((session) => (
                      <CommandItem
                        className="ghostex-command-palette-session-item"
                        disabled={!session.isRestorable}
                        key={session.historyId}
                        value={createPreviousSessionSearchText(session)}
                        onSelect={() => restorePreviousSession(session)}
                      >
                        <CommandPaletteSessionRow
                          projectLabel={getPreviousSessionProjectLabel(session)}
                          session={session}
                          showDebugSessionNumbers={showDebugSessionNumbers}
                          state="previous"
                        />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              ) : null}
            </>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

function CommandPaletteSessionRow({
  projectLabel,
  session,
  showDebugSessionNumbers,
  state,
}: {
  projectLabel?: string;
  session: SidebarSessionItem;
  showDebugSessionNumbers: boolean;
  state: "current" | "previous";
}) {
  const aliasHeadingRef = useRef<HTMLDivElement>(null);
  const displaySession = getCommandPaletteDisplaySession(session);
  const sessionTitleTooltip = getSessionCardTitleTooltip({
    alwaysShowTitleTooltip: true,
    session: displaySession,
    showDebugSessionNumbers,
    showSessionDetails: true,
  });
  const effectiveSessionTag = getEffectiveSessionTag(session);
  const showTerminalSessionIcon = shouldShowTerminalSessionIcon(session);
  const hasSessionCardIcon =
    session.isPinned === true ||
    Boolean(effectiveSessionTag) ||
    Boolean(session.agentIcon) ||
    showTerminalSessionIcon ||
    session.isReloading === true;
  /*
   * CDXC:CommandPalette 2026-06-13-22:22:
   * Session-search rows can represent multiple currently visible panes, but
   * only the single cmdk-selected item should look highlighted. Keep live
   * focused/visible state out of the reused session-card chrome so mouse hover
   * and Arrow-key selection remain mutually exclusive through data-selected on
   * the outer CommandItem.
   */

  return (
    <OverflowTooltipText
      text={sessionTitleTooltip.headingText}
      textRef={aliasHeadingRef}
      tooltip={sessionTitleTooltip.tooltip}
      tooltipWhen={sessionTitleTooltip.tooltipWhen}
    >
      <div
        className="session-frame session-history-frame ghostex-command-palette-session-frame"
        data-focused="false"
        data-has-agent-icon={String(hasSessionCardIcon)}
        data-has-project-label={String(Boolean(projectLabel))}
        data-pinned={String(session.isPinned === true)}
        data-running={String(state === "current" && session.isRunning)}
        data-restorable="true"
        data-tagged={String(Boolean(effectiveSessionTag))}
        data-visible="false"
      >
        <div
          className="session session-history-card ghostex-command-palette-session-row"
          data-has-agent-icon={String(hasSessionCardIcon)}
          data-dragging="false"
          data-focused="false"
          data-pinned={String(session.isPinned === true)}
          data-running={String(state === "current" && session.isRunning)}
          data-search-selected="false"
          data-restorable="true"
          data-tagged={String(Boolean(effectiveSessionTag))}
          data-visible="false"
        >
          <SessionFloatingAgentIcon
            agentIcon={session.agentIcon}
            faviconDataUrl={session.faviconDataUrl}
            isFavorite={session.isFavorite}
            sessionTag={session.sessionTag}
            sessionPersistenceName={session.sessionPersistenceName}
            sessionPersistenceProvider={session.sessionPersistenceProvider}
            showTerminalIcon={showTerminalSessionIcon}
          />
          <SessionCardContent
            aliasHeadingRef={aliasHeadingRef}
            hideHeaderAgentIcon={true}
            session={displaySession}
            showDebugSessionNumbers={showDebugSessionNumbers}
            showCloseButton={false}
            showLastInteractionTime={true}
            trailingPrefix={
              projectLabel ? (
                <div className="session-history-project-label" aria-hidden="true">
                  {projectLabel}
                </div>
              ) : null
            }
          />
        </div>
      </div>
    </OverflowTooltipText>
  );
}

function getCommandPaletteDisplaySession(session: SidebarSessionItem): SidebarSessionItem {
  return session.displayTitle?.trim() || session.primaryTitle?.trim() || !session.terminalTitle?.trim()
    ? session
    : {
        ...session,
        primaryTitle: session.terminalTitle,
        terminalTitle: undefined,
      };
}

function BuiltInCommandIcon({ command }: { command: BuiltInPaletteCommand }) {
  if (command.kind === "cloneRepository") {
    return <IconDownload aria-hidden="true" />;
  }
  if (command.kind === "pet") {
    return command.title === "Sleep Pet" ? (
      <IconMoon aria-hidden="true" />
    ) : (
      <IconPlayerPlay aria-hidden="true" />
    );
  }

  const action = command.definition.action;
  if (action.kind === "createSession") {
    return <IconPlus aria-hidden="true" />;
  }
  if (action.kind === "openCommandsPanel") {
    return <IconTerminal2 aria-hidden="true" />;
  }
  if (action.kind === "openSettings") {
    return <IconSettings aria-hidden="true" />;
  }
  if (action.kind === "moveSidebar") {
    return <IconLayoutSidebarRightExpand aria-hidden="true" />;
  }
  if (action.kind === "toggleSidebarCollapsed") {
    return <IconLayoutSidebar aria-hidden="true" />;
  }
  if (action.kind === "renameActiveSession") {
    return <IconEdit aria-hidden="true" />;
  }
  if (action.kind === "focusedPaneAction") {
    return <FocusedPaneCommandIcon action={action.focusedPaneAction} />;
  }
  if (action.kind === "focusAdjacentGroup") {
    return action.direction < 0 ? (
      <IconChevronLeft aria-hidden="true" />
    ) : (
      <IconChevronRight aria-hidden="true" />
    );
  }
  if (action.kind === "focusDirection") {
    return getFocusDirectionIcon(action.direction);
  }
  if (action.kind === "splitFocusedPane") {
    return <IconArrowsDiagonal2 aria-hidden="true" />;
  }
  if (action.kind === "setViewMode") {
    return <IconLayoutDashboard aria-hidden="true" />;
  }
  return <IconKeyboard aria-hidden="true" />;
}

function FocusedPaneCommandIcon({ action }: { action: ghostexFocusedPaneAction }) {
  if (action === "openBrowserPane") {
    return <IconBrowser aria-hidden="true" />;
  }
  if (action === "rotatePanesClockwise") {
    return <IconRotateClockwise aria-hidden="true" />;
  }
  if (action === "mergeAllTabs") {
    return <IconWindowMaximize aria-hidden="true" />;
  }
  if (action === "delayedSend") {
    return <IconClock aria-hidden="true" />;
  }
  if (action === "forkSession") {
    return <IconGitFork aria-hidden="true" />;
  }
  if (action === "reloadSession") {
    return <IconRefresh aria-hidden="true" />;
  }
  if (action === "popOutPane") {
    return <IconExternalLink aria-hidden="true" />;
  }
  return <IconLayoutSidebarRightExpand aria-hidden="true" />;
}

function getFocusDirectionIcon(direction: "down" | "left" | "right" | "up") {
  if (direction === "up") {
    return <IconChevronUp aria-hidden="true" />;
  }
  if (direction === "right") {
    return <IconArrowRight aria-hidden="true" />;
  }
  if (direction === "down") {
    return <IconChevronDown aria-hidden="true" />;
  }
  return <IconArrowLeft aria-hidden="true" />;
}

function getActionSlotHotkeyId(slotNumber: number): ghostexHotkeyDefinition["id"] | undefined {
  if (slotNumber < 1 || slotNumber > 5) {
    return undefined;
  }
  return `runActionSlot${slotNumber}` as ghostexHotkeyDefinition["id"];
}

function isRunnableOrConfigurableCommand(command: SidebarCommandButton): boolean {
  return command.name.trim().length > 0 || command.icon !== undefined;
}

function isConfigured(command: SidebarCommandButton): boolean {
  return command.actionType === "browser" ? Boolean(command.url) : Boolean(command.command);
}

function getCommandTitle(command: SidebarCommandButton): string {
  const name = command.name.trim();
  if (name) {
    return name;
  }
  return command.actionType === "browser" ? "Untitled Webpage" : "Untitled Action";
}

function getCommandDescription(command: SidebarCommandButton): string {
  const target = getCommandTarget(command);
  const typeLabel = command.actionType === "browser" ? "Browser" : "Terminal";
  if (!target) {
    return `${typeLabel} - Not configured`;
  }
  return `${typeLabel} - ${target}`;
}

function getCommandTarget(command: SidebarCommandButton): string | undefined {
  const target = command.actionType === "browser" ? command.url?.trim() : command.command?.trim();
  if (!target) {
    return undefined;
  }
  return target.split("\n")[0] || undefined;
}
