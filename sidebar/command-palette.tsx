import {
  IconArrowLeft,
  IconArrowRight,
  IconArrowsDiagonal2,
  IconBrandGithub,
  IconBrowser,
  IconChecklist,
  IconClock,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconDownload,
  IconEdit,
  IconExternalLink,
  IconFolderOpen,
  IconFolderPlus,
  IconGitFork,
  IconHistory,
  IconKeyboard,
  IconLayoutSidebarRightExpand,
  IconLayoutDashboard,
  IconLayoutSidebar,
  IconListDetails,
  IconMoon,
  IconNotebook,
  IconPlayerPlay,
  IconPlus,
  IconPinned,
  IconRefresh,
  IconRotateClockwise,
  IconSearch,
  IconServer,
  IconSettings,
  IconSettingsAutomation,
  IconStars,
  IconTerminal2,
  IconWindowMaximize,
  IconX,
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
import { DEFAULT_SIDEBAR_COMMAND_ICON } from "../shared/sidebar-command-icons";
import type { ghostexSettings } from "../shared/ghostex-settings";
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
  SidebarToExtensionMessage,
} from "../shared/session-grid-contract";
import { BUILT_IN_WORKSPACE_OPEN_TARGETS } from "../shared/workspace-open-targets";
import { openAppModal } from "./app-modal-host-bridge";
import { getSidebarCommandRunModeForClick } from "./command-run-feedback";
import { SidebarCommandIconGlyph } from "./sidebar-command-icon";
import { formatSidebarHotkeyLabel } from "./hotkey-label";
import { filterPreviousSessionsModalItems } from "./previous-session-search";
import {
  createCommandPaletteCurrentSessionItems,
  createCommandPaletteSessionSections,
  createPreviousSessionSearchText,
  filterCommandPaletteCurrentSessionItems,
  filterCommandPaletteItems,
  filterCommandPalettePreviousSessions,
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
  openTargetSettings?: CommandPaletteOpenTargetSettings;
  petOverlayEnabled?: boolean;
  vscode: WebviewApi;
};

type CommandPaletteOpenTargetSettings = Pick<
  ghostexSettings,
  "customWorkspaceOpenTargets" | "workspaceOpenTargetAvailability" | "workspaceOpenTargetHiddenIds"
>;

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
      commandId: AppModalPaletteCommandId;
      hotkey: "";
      kind: "appModal";
      modal: AppModalPaletteModal;
      searchText: string;
      title: string;
    }
  | {
      commandId: SidebarMessagePaletteCommandId;
      hotkey: "";
      kind: "sidebarMessage";
      message: PaletteSidebarMessage;
      searchText: string;
      title: string;
    }
  | {
      commandId: string;
      hotkey: "";
      kind: "openTarget";
      searchText: string;
      targetId: string;
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

type AppModalPaletteCommandId =
  | "actions"
  | "agentsHub"
  | "configureAgents"
  | "openTargets"
  | "pinnedPrompts"
  | "previousSessions"
  | "runningSessions"
  | "scratchPad";

type AppModalPaletteModal =
  | "agentsHub"
  | "configureActions"
  | "configureAgents"
  | "daemonSessions"
  | "hotkeys"
  | "openTargets"
  | "pinnedPrompts"
  | "previousSessions"
  | "scratchPad";

type SidebarMessagePaletteCommandId =
  | "addProject"
  | "automations"
  | "changelog"
  | "features"
  | "openCurrentProjectInFinder"
  | "quickBrowserTab"
  | "quickTerminal"
  | "searchByText"
  | "setupGhostex"
  | "tutorialVideo";

type PaletteSidebarMessage =
  | Extract<SidebarToExtensionMessage, { type: "createChat" }>
  | Extract<SidebarToExtensionMessage, { type: "openBrowserChat" }>
  | Extract<SidebarToExtensionMessage, { type: "openBrowserPane" }>
  | Extract<SidebarToExtensionMessage, { type: "openCurrentProjectInFinder" }>
  | Extract<SidebarToExtensionMessage, { type: "openGhostexTutorialVideo" }>
  | Extract<SidebarToExtensionMessage, { type: "openHighlightedFeatures" }>
  | Extract<SidebarToExtensionMessage, { type: "openWorkspaceWelcome" }>
  | Extract<SidebarToExtensionMessage, { type: "pickWorkspaceFolder" }>
  | Extract<SidebarToExtensionMessage, { type: "searchPreviousSessionsByText" }>
  | Extract<SidebarToExtensionMessage, { type: "openAutomationsPage" }>;

const PANE_ACTION_COMMAND_IDS = [
  "openBrowserPane",
  "splitMore",
  "splitMoreDown",
  "rotatePanesClockwise",
  "mergeAllTabs",
  "renameActiveSession",
  "delayedSend",
  "closeAfterDone",
  "forkSession",
  "reloadSession",
  "sleepFocusedSession",
  "wakeFocusedSession",
  "closeFocusedSession",
  "popOutPane",
] as const satisfies readonly ghostexHotkeyDefinition["id"][];

const COMMAND_PALETTE_PREVIOUS_SESSIONS_LIMIT = 20;
const COMMAND_PALETTE_PREVIOUS_SESSIONS_QUERY_DEBOUNCE_MS = 200;
const COMMAND_PALETTE_INPUT_SELECTOR = '[data-ghostex-command-palette-input="true"]';
const GHOSTEX_CHANGELOG_URL = "https://github.com/maddada/ghostex/releases";

const APP_MODAL_PALETTE_COMMANDS = [
  {
    commandId: "previousSessions",
    hotkey: "",
    kind: "appModal",
    modal: "previousSessions",
    searchText: "Reopen a Session history restore previous sessions old sessions",
    title: "Reopen a Session",
  },
  {
    commandId: "pinnedPrompts",
    hotkey: "",
    kind: "appModal",
    modal: "pinnedPrompts",
    searchText: "Pinned Prompts prompt library saved prompts modal",
    title: "Pinned Prompts",
  },
  {
    commandId: "runningSessions",
    hotkey: "",
    kind: "appModal",
    modal: "daemonSessions",
    searchText: "Running Sessions daemon sessions runtimes modal",
    title: "Running Sessions",
  },
  {
    commandId: "scratchPad",
    hotkey: "",
    kind: "appModal",
    modal: "scratchPad",
    searchText: "Scratch Pad notes modal",
    title: "Scratch Pad",
  },
  {
    commandId: "agentsHub",
    hotkey: "",
    kind: "appModal",
    modal: "agentsHub",
    searchText: "Agents Hub agents profiles skills prompts modal",
    title: "Agents Hub",
  },
  {
    commandId: "configureAgents",
    hotkey: "",
    kind: "appModal",
    modal: "configureAgents",
    searchText: "Configure Agents agents settings modal",
    title: "Configure Agents",
  },
  {
    commandId: "actions",
    hotkey: "",
    kind: "appModal",
    modal: "configureActions",
    searchText: "Actions configure project actions settings modal",
    title: "Actions",
  },
  {
    commandId: "openTargets",
    hotkey: "",
    kind: "appModal",
    modal: "openTargets",
    searchText: "Open Targets open in editors settings modal",
    title: "Open Targets",
  },
] as const satisfies readonly BuiltInPaletteCommand[];

const SIDEBAR_MESSAGE_PALETTE_COMMANDS = [
  {
    commandId: "addProject",
    hotkey: "",
    kind: "sidebarMessage",
    message: { type: "pickWorkspaceFolder" },
    searchText: "Add Project pick workspace folder projects",
    title: "Add Project",
  },
  {
    commandId: "searchByText",
    hotkey: "",
    kind: "sidebarMessage",
    message: { type: "searchPreviousSessionsByText" },
    searchText: "Search by Text previous sessions gx f",
    title: "Search by Text",
  },
  {
    commandId: "quickTerminal",
    hotkey: "",
    kind: "sidebarMessage",
    message: { type: "createChat" },
    searchText: "Quick Terminal new chat terminal",
    title: "Quick Terminal",
  },
  {
    commandId: "quickBrowserTab",
    hotkey: "",
    kind: "sidebarMessage",
    message: { type: "openBrowserChat" },
    searchText: "Quick Browser Tab browser chat",
    title: "Quick Browser Tab",
  },
  {
    commandId: "automations",
    hotkey: "",
    kind: "sidebarMessage",
    message: { type: "openAutomationsPage" },
    searchText: "Automations schedules recurring agents",
    title: "Automations",
  },
  {
    commandId: "openCurrentProjectInFinder",
    hotkey: "",
    kind: "sidebarMessage",
    message: { type: "openCurrentProjectInFinder" },
    searchText: "Open Current Project in Finder open folder workspace",
    title: "Open Current Project in Finder",
  },
  {
    commandId: "features",
    hotkey: "",
    kind: "sidebarMessage",
    message: { type: "openGhostexTutorialVideo" },
    /*
     * CDXC:GhostexTutorialVideo 2026-06-18-05:31:
     * The command-palette Features row should open the tutorial video modal so
     * the old Highlighted Features modal remains unused.
     *
     * CDXC:GhostexTutorialVideo 2026-06-18-05:49:
     * The tutorial video now uses Loom and the Ghostty-focused title, so search
     * metadata should match the current walkthrough terms.
     */
    searchText: "Features Ghostty Loom tutorial video walkthrough modal",
    title: "Features",
  },
  {
    commandId: "tutorialVideo",
    hotkey: "",
    kind: "sidebarMessage",
    message: { type: "openGhostexTutorialVideo" },
    searchText: "Ghostty Loom tutorial video walkthrough how to use watch 1.5x",
    title: "Tutorial Video",
  },
  {
    commandId: "setupGhostex",
    hotkey: "",
    kind: "sidebarMessage",
    message: { type: "openWorkspaceWelcome" },
    /*
     * CDXC:CommandPalette 2026-06-18-04:53:
     * User-facing setup actions should use the shorter "Setup" label while
     * search text keeps Ghostex and onboarding terms discoverable.
     */
    searchText: "Ghostex setup onboarding first launch guide modal",
    title: "Setup",
  },
  {
    commandId: "changelog",
    hotkey: "",
    kind: "sidebarMessage",
    message: { type: "openBrowserPane", url: GHOSTEX_CHANGELOG_URL },
    searchText: "Changelog release notes releases github browser",
    title: "Changelog",
  },
] as const satisfies readonly BuiltInPaletteCommand[];

function createOpenTargetPaletteCommands(
  settings: CommandPaletteOpenTargetSettings | undefined,
): BuiltInPaletteCommand[] {
  if (!settings) {
    return [];
  }
  /*
   * CDXC:CommandPalette 2026-06-18-03:46:
   * Open In rows should mirror the main titlebar menu: show installed and
   * visible built-in editor targets plus custom targets, but keep Finder as the
   * separate Open Current Project in Finder command so it reads as a project
   * action instead of another editor target.
   */
  const hiddenTargetIds = new Set(settings.workspaceOpenTargetHiddenIds);
  const availableTargetIds = new Set(settings.workspaceOpenTargetAvailability.availableTargetIds);
  const builtInTargets = BUILT_IN_WORKSPACE_OPEN_TARGETS.filter(
    (target) =>
      target.id !== "finder" &&
      !hiddenTargetIds.has(target.id) &&
      availableTargetIds.has(target.id),
  ).map(
    (target): BuiltInPaletteCommand => ({
      commandId: `openTarget:${target.id}`,
      hotkey: "",
      kind: "openTarget",
      searchText: `Open In ${target.label} current project workspace editor target`,
      targetId: target.id,
      title: `Open In: ${target.label}`,
    }),
  );
  const customTargets = settings.customWorkspaceOpenTargets.map(
    (target): BuiltInPaletteCommand => ({
      commandId: `openTarget:${target.id}`,
      hotkey: "",
      kind: "openTarget",
      searchText: `Open In ${target.label} current project workspace custom target`,
      targetId: target.id,
      title: `Open In: ${target.label}`,
    }),
  );
  return [...builtInTargets, ...customTargets];
}

function findCommandPaletteInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>(COMMAND_PALETTE_INPUT_SELECTOR);
}

function isCommandPaletteTextKey(event: KeyboardEvent): boolean {
  return (
    event.key.length === 1 &&
    event.key !== "Dead" &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.isComposing
  );
}

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
  openTargetSettings,
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
  const commandRunStates = useSidebarStore((state) => state.commandRunStates);
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
      const openTargetCommands = createOpenTargetPaletteCommands(openTargetSettings);
      /*
       * CDXC:CommandPalette 2026-06-18-03:32:
       * Cmd+Shift+P must expose the global app-modal launchers users can reach
       * from sidebar and titlebar chrome, including Previous Sessions and the
       * Tips header actions Features, Setup, and Changelog.
       *
       * CDXC:CommandPalette 2026-06-18-03:46:
       * The palette also needs the main-window command buttons Add Project,
       * Search by Text, Quick Terminal, Quick Browser Tab, Automations, Open
       * Current Project in Finder, and visible Open In editor targets. Keep
       * context-dependent modals out of this list unless their required
       * session, draft, file, or target payload is available.
       */
      return [
        ...hotkeyCommands,
        cloneRepositoryCommand,
        ...APP_MODAL_PALETTE_COMMANDS,
        ...SIDEBAR_MESSAGE_PALETTE_COMMANDS,
        ...openTargetCommands,
        petCommand,
      ];
    },
    [normalizedHotkeys, openTargetSettings, petOverlayEnabled],
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
        filterCommandPalettePreviousSessions(modalPreviousSessions, sessionQuery),
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

  const focusCommandPaletteInput = () => {
    const input = findCommandPaletteInput();
    input?.focus();
    return input;
  };

  const insertIntoCommandPaletteInput = (text: string) => {
    if (text.length === 0) {
      return;
    }
    const input = focusCommandPaletteInput();
    if (!input) {
      return;
    }
    const selectionStart = input.selectionStart ?? input.value.length;
    const selectionEnd = input.selectionEnd ?? input.value.length;
    const nextValue =
      input.value.slice(0, selectionStart) + text + input.value.slice(selectionEnd);
    const nextSelection = selectionStart + text.length;
    setInputValue(nextValue);
    window.requestAnimationFrame(() => {
      const focusedInput = focusCommandPaletteInput();
      focusedInput?.setSelectionRange(nextSelection, nextSelection);
    });
  };

  useLayoutEffect(() => {
    const selection = pendingModeSwitchSelectionRef.current;
    if (!selection) {
      return;
    }
    pendingModeSwitchSelectionRef.current = undefined;
    const input = focusCommandPaletteInput();
    input?.focus();
    input?.setSelectionRange(selection.start, selection.end);
  }, [inputValue]);

  useLayoutEffect(() => {
    if (!isOpen || isPrewarm) {
      return;
    }
    /*
     * CDXC:CommandPalette 2026-06-16-19:24:
     * When the native macOS command-palette child window is open, every plain
     * text input should target the palette search field. Focus the field after
     * each visible open request and after WebKit/AppKit focus handoffs so a
     * visible palette never leaves typing behind on the terminal or dialog body.
     */
    focusCommandPaletteInput();
    const animationFrameId = window.requestAnimationFrame(focusCommandPaletteInput);
    const timeoutIds = [0, 50, 150].map((delay) =>
      window.setTimeout(focusCommandPaletteInput, delay),
    );
    return () => {
      window.cancelAnimationFrame(animationFrameId);
      for (const timeoutId of timeoutIds) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [isOpen, isPrewarm, openRequestSequence]);

  useEffect(() => {
    if (!isOpen || isPrewarm) {
      return;
    }

    const focusAfterCurrentEvent = () => {
      window.setTimeout(focusCommandPaletteInput, 0);
    };
    const handlePaletteKeyDown = (event: KeyboardEvent) => {
      const input = findCommandPaletteInput();
      if (!input || document.activeElement === input) {
        return;
      }
      focusCommandPaletteInput();
      if (!isCommandPaletteTextKey(event)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      insertIntoCommandPaletteInput(event.key);
    };
    const handlePalettePaste = (event: ClipboardEvent) => {
      const input = findCommandPaletteInput();
      if (!input || document.activeElement === input) {
        return;
      }
      const text = event.clipboardData?.getData("text") ?? "";
      if (!text) {
        focusCommandPaletteInput();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      insertIntoCommandPaletteInput(text);
    };

    window.addEventListener("focus", focusAfterCurrentEvent);
    window.addEventListener("focusin", focusAfterCurrentEvent);
    window.addEventListener("keydown", handlePaletteKeyDown, { capture: true });
    document.addEventListener("paste", handlePalettePaste, { capture: true });
    return () => {
      window.removeEventListener("focus", focusAfterCurrentEvent);
      window.removeEventListener("focusin", focusAfterCurrentEvent);
      window.removeEventListener("keydown", handlePaletteKeyDown, { capture: true });
      document.removeEventListener("paste", handlePalettePaste, { capture: true });
    };
  }, [isOpen, isPrewarm]);

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
    if (command.kind === "appModal") {
      onOpenChange(false);
      openAppModal({ modal: command.modal, type: "open" });
      return;
    }
    if (command.kind === "sidebarMessage") {
      onOpenChange(false);
      vscode.postMessage(command.message);
      return;
    }
    if (command.kind === "openTarget") {
      onOpenChange(false);
      vscode.postMessage({
        targetId: command.targetId,
        type: "openCurrentProjectInTarget",
      });
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
    /*
    CDXC:GPUICommandPane 2026-06-26-05:11:
    Command Palette Action launches may read saved command metadata to derive the click runMode, including debug reruns for close-on-exit terminal Actions. The runSidebarCommand payload stays an authority selector: commandId plus non-default runMode only. Native and GPUI hosts resolve command text, URLs, close-on-exit, cwd/env, paths, output, and other launch details from trusted saved/HUD state.
    */
    const runMode = getSidebarCommandRunModeForClick(
      command,
      commandRunStates[command.commandId],
    );
    onOpenChange(false);
    vscode.postMessage({
      commandId: command.commandId,
      ...(runMode === "default" ? {} : { runMode }),
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

          CDXC:FocusedSessionActions 2026-06-19-15:43:
          Sleep, Wake, Close, and Close After Done are focused-session commands
          even when only Sleep has a default shortcut. Keep them in the Pane
          Actions group so users can run them from the palette and bind them in
          Hotkeys without needing a sidebar row context.

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
                      key={getBuiltInCommandKey(command)}
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
                  <CommandGroup heading="Reopen a Session">
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
  if (command.kind === "appModal") {
    return <AppModalCommandIcon modal={command.modal} />;
  }
  if (command.kind === "sidebarMessage") {
    return <SidebarMessageCommandIcon commandId={command.commandId} />;
  }
  if (command.kind === "openTarget") {
    return <IconExternalLink aria-hidden="true" />;
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
  if (action.kind === "openHotkeys") {
    return <IconKeyboard aria-hidden="true" />;
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

function AppModalCommandIcon({ modal }: { modal: AppModalPaletteModal }) {
  if (modal === "previousSessions") {
    return <IconHistory aria-hidden="true" />;
  }
  if (modal === "pinnedPrompts") {
    return <IconPinned aria-hidden="true" />;
  }
  if (modal === "daemonSessions") {
    return <IconServer aria-hidden="true" />;
  }
  if (modal === "scratchPad") {
    return <IconNotebook aria-hidden="true" />;
  }
  if (modal === "agentsHub" || modal === "configureAgents") {
    return <IconSettingsAutomation aria-hidden="true" />;
  }
  if (modal === "configureActions") {
    return <IconListDetails aria-hidden="true" />;
  }
  if (modal === "openTargets") {
    return <IconExternalLink aria-hidden="true" />;
  }
  return <IconKeyboard aria-hidden="true" />;
}

function SidebarMessageCommandIcon({
  commandId,
}: {
  commandId: SidebarMessagePaletteCommandId;
}) {
  if (commandId === "addProject") {
    return <IconFolderPlus aria-hidden="true" />;
  }
  if (commandId === "searchByText") {
    return <IconSearch aria-hidden="true" />;
  }
  if (commandId === "quickTerminal") {
    return <IconTerminal2 aria-hidden="true" />;
  }
  if (commandId === "quickBrowserTab") {
    return <IconBrowser aria-hidden="true" />;
  }
  if (commandId === "automations") {
    return <IconSettingsAutomation aria-hidden="true" />;
  }
  if (commandId === "openCurrentProjectInFinder") {
    return <IconFolderOpen aria-hidden="true" />;
  }
  if (commandId === "features") {
    return <IconStars aria-hidden="true" />;
  }
  if (commandId === "tutorialVideo") {
    return <IconPlayerPlay aria-hidden="true" />;
  }
  if (commandId === "setupGhostex") {
    return <IconChecklist aria-hidden="true" />;
  }
  return <IconBrandGithub aria-hidden="true" />;
}

function getBuiltInCommandKey(command: BuiltInPaletteCommand): string {
  if (command.kind === "hotkey") {
    return command.definition.id;
  }
  if (command.kind === "appModal" || command.kind === "sidebarMessage") {
    return command.commandId;
  }
  if (command.kind === "openTarget") {
    return command.commandId;
  }
  return command.kind;
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
  if (action === "closeAfterDone") {
    return <IconClock aria-hidden="true" />;
  }
  if (action === "forkSession") {
    return <IconGitFork aria-hidden="true" />;
  }
  if (action === "reloadSession") {
    return <IconRefresh aria-hidden="true" />;
  }
  if (action === "sleepFocusedSession") {
    return <IconMoon aria-hidden="true" />;
  }
  if (action === "wakeFocusedSession") {
    return <IconPlayerPlay aria-hidden="true" />;
  }
  if (action === "closeFocusedSession") {
    return <IconX aria-hidden="true" />;
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
