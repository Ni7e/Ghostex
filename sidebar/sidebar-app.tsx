import { Cursor, KeyboardSensor, PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom";
import { move } from "@dnd-kit/helpers";
import { DragDropProvider, type DragDropEventHandlers } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import {
  IconArrowLeft,
  IconArrowRight,
  IconArrowsDiagonal2,
  IconArrowsDiagonalMinimize,
  IconCaretRightFilled,
  IconChevronDown,
  IconChevronRight,
  IconCheck,
  IconClock,
  IconCopy,
  IconDownload,
  IconEdit,
  IconDeviceMobile,
  IconFilter2,
  IconFileSearch,
  IconFolder,
  IconFolderOpen,
  IconGitBranch,
  IconHistory,
  IconHistoryToggle,
  IconLayoutSidebar,
  IconPlus,
  IconPlusFilled,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconTerminal2,
  IconTrash,
  IconUsersGroup,
  IconWorld,
  IconX,
  type TablerIcon,
} from "@tabler/icons-react";
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import {
  MAX_GROUP_COUNT,
  type SidebarActiveSessionsSortMode,
  type ExtensionToSidebarMessage,
  type SidebarPreviousSessionItem,
  type SidebarRecentProject,
} from "../shared/session-grid-contract";
import {
  getWorkspaceThemeForeground,
  normalizeWorkspaceThemeColor,
} from "../shared/workspace-project-appearance";
import {
  moveProjectsWithWorktrees,
  type ProjectWorktreeOrderItem,
} from "../shared/project-worktree-order";
import { playCompletionSound, prepareCompletionSoundPlayback } from "./completion-sound-player";
import { GitCommitModal } from "./git-commit-modal";
import {
  SidebarPreviousSessionsSearchGroup,
  SidebarSessionSearchField,
} from "./sidebar-session-search-overlay";
import { SidebarContextMenuPortal } from "./sidebar-context-menu-portal";
import {
  createSidebarSessionSearchResults,
  createSidebarSessionSearchSelection,
  getNextSidebarSessionSearchSelection,
  isSidebarSessionSearchSelectionMatch,
  type SidebarSessionSearchSelection,
} from "./sidebar-session-search";
import { logSidebarDebug } from "./sidebar-debug";
import {
  createSidebarRefreshDebugInstanceId,
  postSidebarRefreshDebugLog,
  summarizeSidebarRefreshMessage,
} from "./sidebar-refresh-debug-log";
import {
  hashSidebarCollapseDebugId,
  SIDEBAR_COLLAPSE_STATE_DEBUG_EVENT_PREFIX,
  summarizeSidebarCollapseDebugGroupIds,
} from "./sidebar-collapse-state-debug";
import { postSidebarOrderReproLog } from "./sidebar-order-repro-log";
import { scrollElementIntoViewIfNeeded } from "./scroll-into-view-if-needed";
import { resetSidebarStore, useSidebarStore } from "./sidebar-store";
import {
  createRemoteMachineDragData,
  getClientPoint,
  getSidebarGroupDropTargetAtPoint,
  getSidebarGroupDropTargetFromEvent,
  getSidebarDropData,
  getSidebarSessionDropTarget,
  moveGroupIdsByDropTarget,
  type SidebarGroupDropTarget,
  type SidebarSessionDropTarget,
  getSidebarSessionDropTargetFromEvent,
  getSidebarSessionDropTargetAtPoint,
  moveSessionIdsByDropTarget,
} from "./sidebar-dnd";
import {
  getAutoCollapseGroupIds,
  getSessionCountsByGroup,
  reconcileCollapsedGroupsById,
} from "./group-collapse";
import { SessionGroupSection } from "./session-group-section";
import { isEditableKeyboardTarget } from "./text-input-keyboard";
import { TOOLTIP_DELAY_MS } from "./tooltip-delay";
import {
  AppTooltip,
  dismissSidebarTooltips,
  setSidebarTooltipsSuppressedForDrag,
  TooltipProvider,
} from "./app-tooltip";
import { useScrollGlowState } from "./use-scroll-glow-state";
import type { WebviewApi } from "./webview-api";
import { createDisplaySessionLayout } from "../shared/active-sessions-sort";
import {
  filterDefaultNamedSessionSearchItems,
  filterPreviousSessions,
  filterSidebarSessionItems,
} from "./previous-session-search";
import {
  getEffectiveSessionTag,
  getSidebarSessionTagLabel,
  SessionTagIcon,
  type SidebarSessionTag,
} from "./session-tag-ui";
import {
  getEnabledVisibleSidebarSessionTags,
  normalizeSidebarSessionTagListItems,
  type SidebarSessionTagListItem,
} from "../shared/session-tags";
import { filterRecentProjects } from "./recent-project-search";
import { isEmptySidebarDoubleClick } from "./empty-sidebar-double-click";
import { closeAppModal, openAppModal } from "./app-modal-host-bridge";
import { formatSidebarHotkeyLabel } from "./hotkey-label";
import {
  GHOSTEX_HOTKEY_DEFINITIONS,
  getghostexHotkeyActionById,
  getghostexHotkeyActionIdForKey,
  normalizeHotkeyText,
  normalizeghostexHotkeySettings,
  type ghostexHotkeySettings,
} from "../shared/ghostex-hotkeys";
import {
  DEFAULT_ghostex_SETTINGS,
  getSidebarTitlebarForegroundForBackground,
  getSidebarTitlebarGradientColors,
  type RemoteMachineSettings,
} from "../shared/ghostex-settings";
import {
  SIDEBAR_PROJECT_JUMP_EVENT,
  type SidebarProjectJumpEventDetail,
} from "../shared/sidebar-project-jump";
import type { SidebarAgentButton } from "../shared/sidebar-agents";
import {
  readRenderedSidebarSessionSlotIds,
  readRenderedSidebarSessionSlots,
  resolveAdjacentRenderedSidebarSessionSlotId,
  resolveVisibleSidebarSessionSlotId,
} from "./sidebar-visible-session-slots";
import {
  PRIMARY_AGENT_LAUNCHER_CHANGED_EVENT,
  readPrimaryAgentLauncherId,
  writePrimaryAgentLauncherId,
  type PrimaryAgentLauncherChangedEvent,
} from "./primary-agent-launcher";
import {
  readProjectSessionListCollapsedState,
  writeProjectSessionListCollapsedState,
} from "./project-session-list-toggle";
import { ProjectAgentLauncherIcon } from "./project-agent-launcher-icon";

type SidebarEventSource = Pick<Window, "addEventListener" | "removeEventListener">;

export type SidebarAppProps = {
  messageSource?: SidebarEventSource;
  nativeHostEventSource?: SidebarEventSource | null;
  vscode: WebviewApi;
};

type SessionIdsByGroup = Record<string, string[]>;
type SidebarStoreState = ReturnType<typeof useSidebarStore.getState>;
type SidebarGroupsById = SidebarStoreState[ "groupsById" ];
type SidebarSessionsById = SidebarStoreState[ "sessionsById" ];
type RemoteMachineRuntimeStatus = Extract<ExtensionToSidebarMessage, { type: "remoteMachineStatus"; }>;
type RemoteMachineRuntimeStatuses = Record<string, RemoteMachineRuntimeStatus[ "state" ]>;
type HeaderSortMenuPosition = {
  left: number;
  top: number;
};

const REFERENCE_SECTION_AGENT_MENU_WIDTH_PX = 220;

type RecentProjectContextMenuPosition = {
  projectId: string;
  x: number;
  y: number;
};
type PointerViewportPoint = {
  clientX: number;
  clientY: number;
};

type NativeModifierStateHostEvent = {
  isCommandPressed: boolean;
  type: "nativeModifierState";
};

const SIDEBAR_HOTKEY_OVERLAY_ENABLED = false;
/*
 * CDXC:Hotkeys 2026-06-15-02:33:
 * Temporarily disable the Cmd-hold sidebar hotkey overlay while keeping the
 * hook, renderer, styles, and native modifier bridge in source for near-term
 * re-enable. Holding Cmd must not show the overlay from sidebar DOM focus or
 * native terminal/browser/titlebar focus while this flag is false.
 */

type SidebarGroupDragPreview = {
  groupId: string;
  icon: "branch" | "closed" | "open";
  isCollapsed: boolean;
  left: number;
  pointerOffsetY: number;
  themeColor?: string;
  title: string;
  top: number;
  width: number;
};

function useCommandHotkeyOverlay(): boolean {
  const [ isVisible, setIsVisible ] = useState(false);
  const isCommandPressedRef = useRef(false);
  const showTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!SIDEBAR_HOTKEY_OVERLAY_ENABLED) {
      return;
    }

    const clearOverlayTimer = () => {
      if (showTimerRef.current !== undefined) {
        window.clearTimeout(showTimerRef.current);
        showTimerRef.current = undefined;
      }
    };
    const hideOverlay = () => {
      isCommandPressedRef.current = false;
      clearOverlayTimer();
      setIsVisible(false);
    };
    const showOverlayAfterDelay = () => {
      if (isCommandPressedRef.current || showTimerRef.current !== undefined) {
        return;
      }
      isCommandPressedRef.current = true;
      /**
       * CDXC:Hotkeys 2026-05-11-09:26
       * Holding Cmd for one second should reveal an in-sidebar cheat sheet of
       * the current effective hotkeys. Delay the overlay so normal Cmd chords
       * do not flash UI while still making discovery available from the key the
       * simplified keymap now centers on.
       *
       * CDXC:Hotkeys 2026-06-14-19:40:
       * Native terminal, browser, and titlebar focus can hold Cmd without
       * delivering a WebKit keydown to the sidebar. Keep this dormant path wired
       * to native modifier host events so the cheat sheet can be restored by
       * flipping SIDEBAR_HOTKEY_OVERLAY_ENABLED.
       *
       * CDXC:Hotkeys 2026-06-15-02:33:
       * SIDEBAR_HOTKEY_OVERLAY_ENABLED intentionally short-circuits this effect
       * before listeners attach, so holding Cmd must not show this overlay until
       * the temporary disable is removed.
       */
      showTimerRef.current = window.setTimeout(() => {
        showTimerRef.current = undefined;
        if (isCommandPressedRef.current) {
          setIsVisible(true);
        }
      }, 1_000);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Meta") {
        return;
      }
      showOverlayAfterDelay();
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Meta" || !event.metaKey) {
        hideOverlay();
      }
    };
    const handleNativeHostEvent = (event: Event) => {
      if (!(event instanceof CustomEvent) || !isNativeModifierStateHostEvent(event.detail)) {
        return;
      }
      if (event.detail.isCommandPressed) {
        showOverlayAfterDelay();
      } else {
        hideOverlay();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("ghostex-native-host-event", handleNativeHostEvent);
    window.addEventListener("blur", hideOverlay);
    return () => {
      clearOverlayTimer();
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("ghostex-native-host-event", handleNativeHostEvent);
      window.removeEventListener("blur", hideOverlay);
    };
  }, []);

  return SIDEBAR_HOTKEY_OVERLAY_ENABLED && isVisible;
}

function isNativeModifierStateHostEvent(value: unknown): value is NativeModifierStateHostEvent {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as NativeModifierStateHostEvent).type === "nativeModifierState" &&
    typeof (value as NativeModifierStateHostEvent).isCommandPressed === "boolean"
  );
}

function SidebarHotkeyOverlay({ hotkeys }: { hotkeys?: ghostexHotkeySettings; }) {
  const normalizedHotkeys = normalizeghostexHotkeySettings(hotkeys);
  const rows = getSidebarHotkeyOverlayRows(normalizedHotkeys);

  return (
    <>
      <div aria-hidden="true" className="sidebar-hotkey-overlay-backdrop" />
      <aside aria-label="Keyboard shortcuts" className="sidebar-hotkey-overlay">
        <div className="sidebar-hotkey-overlay-title">Hotkeys</div>
        <div className="sidebar-hotkey-overlay-grid">
          {rows.map((row) => (
            <div className="sidebar-hotkey-overlay-row" key={`${row.title}-${row.hotkey}`}>
              <span className="sidebar-hotkey-overlay-action">{row.title}</span>
              <kbd className="sidebar-hotkey-overlay-key">{formatSidebarHotkeyLabel(row.hotkey)}</kbd>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}

function ProjectGroupDragGhost({ preview }: { preview: SidebarGroupDragPreview; }) {
  const style = {
    left: `${preview.left}px`,
    top: `${preview.top}px`,
    width: `${preview.width}px`,
    ...(preview.themeColor ? { "--workspace-project-theme-color": preview.themeColor } : {}),
  } as CSSProperties;

  return (
    <div aria-hidden="true" className="project-drag-ghost" style={style}>
      <div className="group-title-row">
        <span
          aria-hidden="true"
          className="group-collapse-button section-titlebar-toggle"
          data-collapsed={String(preview.isCollapsed)}
          data-empty-project="false"
          data-has-idle-icon="true"
          data-static-icon="false"
        >
          <span
            aria-hidden="true"
            className="group-collapse-icon group-collapse-idle-icon section-titlebar-toggle-icon section-titlebar-toggle-idle-icon"
          >
            {preview.icon === "open" ? (
              <IconFolderOpen size={16} stroke={1.8} />
            ) : preview.icon === "branch" ? (
              <IconGitBranch size={16} stroke={1.8} />
            ) : (
              <IconFolder size={16} stroke={1.8} />
            )}
          </span>
        </span>
        <div className="group-title-handle" data-draggable="true">
          <button
            aria-disabled="false"
            aria-expanded={!preview.isCollapsed}
            aria-label={preview.title}
            className="group-title-button"
            data-empty-project="false"
            tabIndex={-1}
            type="button"
          >
            <span className="group-title section-titlebar-label">{preview.title}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function getSidebarHotkeyOverlayRows(hotkeys: ghostexHotkeySettings) {
  const rows: Array<{ hotkey: string; title: string; }> = [];
  for (const definition of GHOSTEX_HOTKEY_DEFINITIONS) {
    if (definition.id === "jumpToProject1") {
      const hotkey = normalizeHotkeyText(hotkeys.jumpToProject1 ?? "");
      if (hotkey) {
        rows.push({
          hotkey: formatNumberedHotkeyExample(hotkey),
          title: "Jump to Project N",
        });
      }
      continue;
    }
    if (definition.id === "focusSessionSlot1") {
      const hotkey = normalizeHotkeyText(hotkeys.focusSessionSlot1 ?? "");
      if (hotkey) {
        rows.push({
          hotkey: formatNumberedHotkeyExample(hotkey),
          title: "Focus Session N",
        });
      }
      continue;
    }
    if (
      /^jumpToProject[2-9]$/u.test(definition.id) ||
      /^focusSessionSlot[2-9]$/u.test(definition.id)
    ) {
      continue;
    }
    const hotkey = normalizeHotkeyText(hotkeys[ definition.id ] ?? "");
    if (hotkey) {
      rows.push({ hotkey, title: definition.title });
    }
  }
  return rows;
}

function formatNumberedHotkeyExample(hotkey: string): string {
  /**
   * CDXC:Hotkeys 2026-05-11-09:36
   * The Cmd-hold overlay should not list every numbered session or group slot.
   * Show one N-based example derived from slot 1 so user rebinds still explain
   * the whole numbered family without crowding the cheat sheet.
   */
  return hotkey.replace(/(^|[+ ])1(?=$| )/u, "$1n");
}

type SidebarPointerDownSessionTarget = {
  groupId: string;
  point: {
    x: number;
    y: number;
  };
  sessionId: string;
};

type SidebarSessionPointerDragState = {
  didMove: boolean;
  startPoint?: {
    x: number;
    y: number;
  };
};

type SidebarUiCollapseState = {
  collapsedGroupsById: Record<string, true>;
  collapsedRemoteMachineSectionsById: Record<string, true>;
  isRecentProjectsOpen: boolean;
  isReferenceChatsCollapsed: boolean;
  isReferenceProjectsCollapsed: boolean;
};

type SidebarUiCollapseStateReadResult = {
  reason?: "invalid-shape" | "missing" | "parse-error" | "storage-unavailable";
  state: SidebarUiCollapseState;
  storedByteLength?: number;
};

type SidebarUiCollapseStateWriteResult = {
  ok: boolean;
  reason?: "storage-error" | "storage-unavailable";
  storedByteLength?: number;
};

type SidebarProjectGroupOrderItem = ProjectWorktreeOrderItem & {
  orderId: string;
};

type SidebarProjectGroupLookup = Record<
  string,
  | {
    projectContext?: {
      path?: string;
      editor: {
        projectId: string;
      };
      worktree?: {
        parentProjectId: string;
      };
    };
  }
  | undefined
>;

type ReferenceSidebarSectionId = "projects" | "quick" | "remote";

const REFERENCE_SECTION_CHILD_ANIMATION_RESET_MS = 420;

const sensors = [
  PointerSensor.configure({
    activationConstraints(event) {
      if (event.pointerType === "touch") {
        return [ new PointerActivationConstraints.Delay({ tolerance: 5, value: 250 }) ];
      }

      return [ new PointerActivationConstraints.Distance({ value: 6 }) ];
    },
  }),
  KeyboardSensor,
];

const SIDEBAR_STARTUP_INTERACTION_BLOCK_MS = 1500;
const SIDEBAR_STARTUP_REPRO_WINDOW_MS = 15_000;
const RECENT_PROJECTS_TOOLTIP_SCROLL_SETTLE_MS = 180;
const SIDEBAR_POINTER_DRAG_REORDER_THRESHOLD_PX = 8;
const SIDEBAR_GXSERVER_UNAVAILABLE_GROUP_ID = "gxserver-unavailable";
const SIDEBAR_GXSERVER_UNAVAILABLE_EMPTY_STATE_DELAY_MS = 20_000;
const SIDEBAR_UI_COLLAPSE_STATE_STORAGE_KEY = "ghostex-sidebar-ui-collapse-state";
const MIN_SESSION_SEARCH_QUERY_LENGTH = 2;
const COMPLETION_FLASH_DURATION_MS = 3_000;
const DEBUG_BUILD_STAMP_STYLE: CSSProperties = {
  position: "fixed",
  right: "10px",
  bottom: "8px",
  zIndex: 20,
  padding: 0,
  border: "none",
  background: "transparent",
  color: "var(--vscode-foreground)",
  fontFamily: "var(--vscode-font-family)",
  fontSize: "10px",
  lineHeight: 1.2,
  fontVariantNumeric: "tabular-nums",
  opacity: 0.72,
};

function createDefaultSidebarUiCollapseState(): SidebarUiCollapseState {
  return {
    collapsedGroupsById: {},
    collapsedRemoteMachineSectionsById: {},
    isRecentProjectsOpen: false,
    isReferenceChatsCollapsed: false,
    isReferenceProjectsCollapsed: false,
  };
}

function readSidebarUiCollapseState(): SidebarUiCollapseStateReadResult {
  if (typeof window === "undefined") {
    return {
      reason: "storage-unavailable",
      state: createDefaultSidebarUiCollapseState(),
    };
  }

  try {
    const storedValue = window.localStorage.getItem(SIDEBAR_UI_COLLAPSE_STATE_STORAGE_KEY);
    if (storedValue === null) {
      return {
        reason: "missing",
        state: createDefaultSidebarUiCollapseState(),
      };
    }

    const candidate = JSON.parse(storedValue);
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return {
        reason: "invalid-shape",
        state: createDefaultSidebarUiCollapseState(),
        storedByteLength: storedValue.length,
      };
    }

    return {
      state: {
        collapsedGroupsById: normalizeStoredCollapsedGroupsById(
          (candidate as Partial<SidebarUiCollapseState>).collapsedGroupsById,
        ),
        collapsedRemoteMachineSectionsById: normalizeStoredCollapsedGroupsById(
          (candidate as Partial<SidebarUiCollapseState>).collapsedRemoteMachineSectionsById,
        ),
        isRecentProjectsOpen:
          (candidate as Partial<SidebarUiCollapseState>).isRecentProjectsOpen === true,
        isReferenceChatsCollapsed:
          (candidate as Partial<SidebarUiCollapseState>).isReferenceChatsCollapsed === true,
        isReferenceProjectsCollapsed:
          (candidate as Partial<SidebarUiCollapseState>).isReferenceProjectsCollapsed === true,
      },
      storedByteLength: storedValue.length,
    };
  } catch {
    return {
      reason: "parse-error",
      state: createDefaultSidebarUiCollapseState(),
    };
  }
}

function normalizeStoredCollapsedGroupsById(candidate: unknown): Record<string, true> {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return {};
  }

  const collapsedGroupsById: Record<string, true> = {};
  for (const [ groupId, collapsed ] of Object.entries(candidate)) {
    if (collapsed === true) {
      collapsedGroupsById[ groupId ] = true;
    }
  }
  return collapsedGroupsById;
}

function summarizeSidebarUiCollapseState(state: SidebarUiCollapseState): Record<string, unknown> {
  return {
    collapsedGroupCount: Object.keys(state.collapsedGroupsById).length,
    collapsedRemoteMachineSectionCount: Object.keys(state.collapsedRemoteMachineSectionsById)
      .length,
    isRecentProjectsOpen: state.isRecentProjectsOpen,
    isReferenceChatsCollapsed: state.isReferenceChatsCollapsed,
    isReferenceProjectsCollapsed: state.isReferenceProjectsCollapsed,
  };
}

function summarizeSidebarUiCollapseRead(
  result: SidebarUiCollapseStateReadResult,
): Record<string, unknown> {
  return {
    ...summarizeSidebarUiCollapseState(result.state),
    readReason: result.reason ?? "stored",
    storedByteLength: result.storedByteLength ?? 0,
  };
}

function writeSidebarUiCollapseState(
  state: SidebarUiCollapseState,
): SidebarUiCollapseStateWriteResult {
  if (typeof window === "undefined") {
    return { ok: false, reason: "storage-unavailable" };
  }

  try {
    const serialized = JSON.stringify(state);
    window.localStorage.setItem(SIDEBAR_UI_COLLAPSE_STATE_STORAGE_KEY, serialized);
    return { ok: true, storedByteLength: serialized.length };
  } catch {
    // Ignore storage failures; the in-memory collapse state should still update.
    return { ok: false, reason: "storage-error" };
  }
}

function readSidebarProjectJumpEventDetail(event: Event): SidebarProjectJumpEventDetail | undefined {
  const detail = (event as CustomEvent<unknown>).detail;
  if (!detail || typeof detail !== "object") {
    return undefined;
  }
  const candidate = detail as Partial<SidebarProjectJumpEventDetail>;
  if (
    typeof candidate.groupId !== "string" ||
    typeof candidate.projectId !== "string" ||
    typeof candidate.expandCollapsedProject !== "boolean" ||
    typeof candidate.showLessAfterExpand !== "boolean" ||
    (
      candidate.revealFocusedSession !== undefined &&
      typeof candidate.revealFocusedSession !== "boolean"
    )
  ) {
    return undefined;
  }
  return {
    expandCollapsedProject: candidate.expandCollapsedProject,
    groupId: candidate.groupId,
    projectId: candidate.projectId,
    revealFocusedSession: candidate.revealFocusedSession === true ? true : undefined,
    showLessAfterExpand: candidate.showLessAfterExpand,
  };
}

export function SidebarApp({
  messageSource = window,
  nativeHostEventSource = window,
  vscode,
}: SidebarAppProps) {
  const [ initialUiCollapseStateRead ] = useState(readSidebarUiCollapseState);
  const initialUiCollapseState = initialUiCollapseStateRead.state;
  const [ isStartupInteractionBlocked, setIsStartupInteractionBlocked ] = useState(true);
  const [ autoEditingGroupId, setAutoEditingGroupId ] = useState<string>();
  const [ agentCreateRequestId, setAgentCreateRequestId ] = useState(0);
  const [ isDaemonSessionsOpen, setIsDaemonSessionsOpen ] = useState(false);
  const [ isPinnedPromptsOpen, setIsPinnedPromptsOpen ] = useState(false);
  const [ isPreviousSessionsOpen, setIsPreviousSessionsOpen ] = useState(false);
  const [ isRecentProjectsOpen, setIsRecentProjectsOpen ] = useState(
    initialUiCollapseState.isRecentProjectsOpen,
  );
  const [ isReferenceChatsCollapsed, setIsReferenceChatsCollapsed ] = useState(
    initialUiCollapseState.isReferenceChatsCollapsed,
  );
  const [ isReferenceProjectsCollapsed, setIsReferenceProjectsCollapsed ] = useState(
    initialUiCollapseState.isReferenceProjectsCollapsed,
  );
  const [ isScratchPadOpen, setIsScratchPadOpen ] = useState(false);
  const [ isSettingsOpen, setIsSettingsOpen ] = useState(false);
  const [ isSessionSearchOpen, setIsSessionSearchOpen ] = useState(false);
  const showCommandHotkeyOverlay = useCommandHotkeyOverlay();
  const [ completionFlashNonceBySessionId, setCompletionFlashNonceBySessionId ] = useState<
    Record<string, number>
  >({});
  const [ collapsedGroupsById, setCollapsedGroupsById ] = useState<Record<string, true>>(
    initialUiCollapseState.collapsedGroupsById,
  );
  const [ collapsedRemoteMachineSectionsById, setCollapsedRemoteMachineSectionsById ] = useState<
    Record<string, true>
  >(initialUiCollapseState.collapsedRemoteMachineSectionsById);
  const [ referenceSectionChildAnimations, setReferenceSectionChildAnimations ] = useState<
    Record<ReferenceSidebarSectionId, boolean>
  >({
    projects: false,
    quick: false,
    remote: false,
  });
  const previousExpandedReferenceProjectGroupIdsRef = useRef<string[]>([]);
  const [ recentProjectsQuery, setRecentProjectsQuery ] = useState("");
  const [ isRecentProjectsListScrolling, setIsRecentProjectsListScrolling ] = useState(false);
  const [ sessionSearchQuery, setSessionSearchQuery ] = useState("");
  const [ selectedSessionTagFilters, setSelectedSessionTagFilters ] = useState<
    SidebarSessionTag[]
  >([]);
  const [ remoteSessionSearchPreviousSessions, setRemoteSessionSearchPreviousSessions ] =
    useState<SidebarPreviousSessionItem[] | undefined>(undefined);
  const [ groupDropIndicator, setGroupDropIndicator ] = useState<SidebarGroupDropTarget>();
  const [ groupDragPreview, setGroupDragPreview ] = useState<SidebarGroupDragPreview>();
  const [ pinnedSessionDropIndicator, setPinnedSessionDropIndicator ] =
    useState<SidebarSessionDropTarget>();
  const [ sessionDropIndicator, setSessionDropIndicator ] = useState<SidebarSessionDropTarget>();
  const [ isSessionSearchSelectionVisible, setIsSessionSearchSelectionVisible ] = useState(false);
  const [ focusedSessionRevealRequestId, setFocusedSessionRevealRequestId ] = useState(0);
  const [ showGxserverUnavailableEmptyState, setShowGxserverUnavailableEmptyState ] =
    useState(false);
  const [ selectedSessionSearchResult, setSelectedSessionSearchResult ] =
    useState<SidebarSessionSearchSelection>();
  const pendingCreateGroupRef = useRef(false);
  const didResetStoreRef = useRef(false);
  const sessionGroupsPanelRef = useRef<HTMLElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const recentProjectsSearchInputRef = useRef<HTMLInputElement>(null);
  const recentProjectsPointerPointRef = useRef<PointerViewportPoint | undefined>(undefined);
  const recentProjectsScrollIdleTimeoutRef = useRef<number | undefined>(undefined);
  const groupIdsRef = useRef<string[]>([]);
  const sessionIdsByGroupRef = useRef<SessionIdsByGroup>({});
  const pinnedSessionDropTargetLogKeyRef = useRef<string | undefined>(undefined);
  const previousSessionCountsByGroupRef = useRef<Record<string, number>>({});
  const latestSessionSearchPreviousRequestIdRef = useRef<string | undefined>(undefined);
  const didApplyStartupEmptyChatsCollapseRef = useRef(false);
  const hasEstablishedStartupGroupCollapseBaselineRef = useRef(false);
  const previousNormalizedSessionSearchQueryRef = useRef("");
  const refreshDebugInstanceIdRef = useRef(createSidebarRefreshDebugInstanceId());
  const [ recentProjectContextMenuPosition, setRecentProjectContextMenuPosition ] =
    useState<RecentProjectContextMenuPosition>();
  const pointerDownSessionTargetRef = useRef<SidebarPointerDownSessionTarget | undefined>(
    undefined,
  );
  const sessionPointerDragStateRef = useRef<SidebarSessionPointerDragState | undefined>(undefined);
  const completionFlashTimeoutBySessionIdRef = useRef<Map<string, number>>(new Map());
  const referenceSectionAnimationTimeoutsRef = useRef<
    Partial<Record<ReferenceSidebarSectionId, number>>
  >({});
  const sessionGroupsContentRef = useRef<HTMLDivElement>(null);
  const sidebarStartupStartedAtRef = useRef(getSidebarStartupNow());
  const hasAppliedHydrateRef = useRef(false);
  const firstHydrateRevisionRef = useRef<number | undefined>(undefined);
  const lastSidebarStartupRenderStateKeyRef = useRef<string | undefined>(undefined);
  const didLogRefreshInstanceObservedRef = useRef(false);
  const didLogInitialUiCollapseStateReadRef = useRef(false);
  const collapseStateHydrateLogCountRef = useRef(0);
  const lastCollapseStateHydrateShapeRef = useRef<string | undefined>(undefined);
  const focusedSessionScrollLogSequenceRef = useRef(0);

  if (!didResetStoreRef.current) {
    resetSidebarStore();
    didResetStoreRef.current = true;
  }

  useEffect(() => {
    return () => {
      if (recentProjectsScrollIdleTimeoutRef.current !== undefined) {
        window.clearTimeout(recentProjectsScrollIdleTimeoutRef.current);
      }
      setSidebarTooltipsSuppressedForDrag(false);
    };
  }, []);

  const applyLocalFocus = useSidebarStore((state) => state.applyLocalFocus);
  const applyCommandRunStateClearedMessage = useSidebarStore(
    (state) => state.applyCommandRunStateClearedMessage,
  );
  const applyCommandRunStateMessage = useSidebarStore((state) => state.applyCommandRunStateMessage);
  const applyGroupsChangedMessage = useSidebarStore((state) => state.applyGroupsChangedMessage);
  const applyHudChangedMessage = useSidebarStore((state) => state.applyHudChangedMessage);
  const applyOrderSyncResultMessage = useSidebarStore((state) => state.applyOrderSyncResultMessage);
  const applySessionPresentationMessage = useSidebarStore(
    (state) => state.applySessionPresentationMessage,
  );
  const applySidebarMessage = useSidebarStore((state) => state.applySidebarMessage);
  const setDaemonSessionsState = useSidebarStore((state) => state.setDaemonSessionsState);
  const setGitCommitDraft = useSidebarStore((state) => state.setGitCommitDraft);
  const setGitFileDiffDraft = useSidebarStore((state) => state.setGitFileDiffDraft);
  const {
    activeSessionsSortMode,
    agentManagerZoomPercent,
    agents,
    createSessionOnSidebarDoubleClick,
    customThemeColor,
    debuggingMode,
    groupOrder,
    groupsById,
    previousSessions,
    recentProjects,
    settings,
    revision,
    sessionsById,
    theme,
    workspaceGroupIds,
  } = useSidebarStore(
    useShallow((state) => ({
      activeSessionsSortMode: state.hud.activeSessionsSortMode,
      agentManagerZoomPercent: state.hud.agentManagerZoomPercent,
      agents: state.hud.agents,
      createSessionOnSidebarDoubleClick: state.hud.createSessionOnSidebarDoubleClick,
      customThemeColor: state.hud.customThemeColor,
      debuggingMode: state.hud.debuggingMode,
      groupOrder: state.groupOrder,
      groupsById: state.groupsById,
      previousSessions: state.previousSessions,
      recentProjects: state.hud.recentProjects,
      revision: state.revision,
      settings: state.hud.settings,
      sessionsById: state.sessionsById,
      theme: state.hud.theme,
      workspaceGroupIds: state.workspaceGroupIds,
    })),
  );
  const gitCommitDraft = useSidebarStore((state) => state.gitCommitDraft);
  const gitFileDiffDraft = useSidebarStore((state) => state.gitFileDiffDraft);
  const authoritativeSessionIdsByGroup = useSidebarStore((state) => state.sessionIdsByGroup);
  const [ remoteMachineRuntimeStatuses, setRemoteMachineRuntimeStatuses ] =
    useState<RemoteMachineRuntimeStatuses>({});
  const [ primaryAgentLauncherId, setPrimaryAgentLauncherId ] = useState(readPrimaryAgentLauncherId);
  const buildStamp = useSidebarStore((state) =>
    state.hud.debuggingMode ? state.hud.buildStamp : undefined,
  );
  const hasGxserverUnavailablePlaceholder = Boolean(
    groupsById[ SIDEBAR_GXSERVER_UNAVAILABLE_GROUP_ID ],
  );

  useEffect(() => {
    if (!hasGxserverUnavailablePlaceholder) {
      setShowGxserverUnavailableEmptyState(false);
      return;
    }

    /*
     * CDXC:GxserverPresentation 2026-06-16-09:35:
     * When gxserver is off or missing during startup, the sidebar must not show
     * the raw synthetic status project row. Keep the Projects body blank while
     * startup can still recover, then after 20 seconds show the two-line restart
     * guidance using the exact reference-sidebar empty-state typography shared
     * with "No projects."
     */
    setShowGxserverUnavailableEmptyState(false);
    const timeoutId = window.setTimeout(() => {
      setShowGxserverUnavailableEmptyState(true);
    }, SIDEBAR_GXSERVER_UNAVAILABLE_EMPTY_STATE_DELAY_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [ hasGxserverUnavailablePlaceholder ]);

  const effectiveSettings = settings ?? DEFAULT_ghostex_SETTINGS;
  const sidebarSessionTagListItems = useMemo(
    () => normalizeSidebarSessionTagListItems(effectiveSettings.sidebarSessionTagListItems),
    [ effectiveSettings.sidebarSessionTagListItems ],
  );
  const enabledVisibleSidebarSessionTagSet = useMemo(
    () => new Set(getEnabledVisibleSidebarSessionTags(sidebarSessionTagListItems)),
    [ sidebarSessionTagListItems ],
  );
  const activeSelectedSessionTagFilters = useMemo(
    () =>
      selectedSessionTagFilters.filter((tag) => enabledVisibleSidebarSessionTagSet.has(tag)),
    [ enabledVisibleSidebarSessionTagSet, selectedSessionTagFilters ],
  );

  useEffect(() => {
    /*
     * CDXC:SessionTagFilters 2026-06-13-17:50:
     * If a selected sidebar tag filter becomes hidden or disabled from
     * Settings, drop it from the active filter state so sessions are not
     * invisibly filtered by a tag the sidebar menu no longer lets users choose.
     */
    setSelectedSessionTagFilters((current) => {
      const next = current.filter((tag) => enabledVisibleSidebarSessionTagSet.has(tag));
      return next.length === current.length ? current : next;
    });
  }, [ enabledVisibleSidebarSessionTagSet ]);

  useEffect(() => {
    const refreshPrimaryAgentLauncher = (event: Event) => {
      const changedEvent = event as PrimaryAgentLauncherChangedEvent;
      setPrimaryAgentLauncherId(
        typeof changedEvent.detail?.agentId === "string"
          ? changedEvent.detail.agentId
          : readPrimaryAgentLauncherId(),
      );
    };

    window.addEventListener(PRIMARY_AGENT_LAUNCHER_CHANGED_EVENT, refreshPrimaryAgentLauncher);
    return () => {
      window.removeEventListener(PRIMARY_AGENT_LAUNCHER_CHANGED_EVENT, refreshPrimaryAgentLauncher);
    };
  }, []);

  const postSidebarDebugLog = useEffectEvent((event: string, details: unknown) => {
    if (!debuggingMode) {
      return;
    }

    logSidebarDebug(debuggingMode, event, details);
    vscode.postMessage({
      details,
      event,
      type: "sidebarDebugLog",
    });
  });

  const postSidebarCollapseStateLog = useEffectEvent(
    (
      event: string,
      details: Record<string, unknown>,
      options: { enabled?: boolean; } = {},
    ) => {
      /*
       * CDXC:SidebarCollapseDiagnostics 2026-06-02-23:52:
       * Sidebar restart repros need a dedicated low-volume trace for localStorage
       * collapse-state reads, writes, hydrate timing, and user toggles. Keep the
       * payload privacy-safe by recording counts, booleans, revisions, elapsed
       * timings, and hashed group identifiers instead of project names or paths.
       */
      if (!(options.enabled ?? debuggingMode)) {
        return;
      }

      vscode.postMessage({
        details: {
          ...details,
          elapsedMs: getSidebarStartupElapsedMs(sidebarStartupStartedAtRef.current),
          firstHydrateRevision: firstHydrateRevisionRef.current,
          hasEstablishedStartupGroupCollapseBaseline:
            hasEstablishedStartupGroupCollapseBaselineRef.current,
          hasHydrate: hasAppliedHydrateRef.current,
          instanceId: refreshDebugInstanceIdRef.current,
          revision,
        },
        event: `${SIDEBAR_COLLAPSE_STATE_DEBUG_EVENT_PREFIX}${event}`,
        type: "sidebarDebugLog",
      });
    },
  );

  const postPinnedSessionReorderLog = useEffectEvent((event: string, details: unknown) => {
    /*
     * CDXC:PinnedSessions 2026-05-28-15:33:
     * Pinned reorder failures need click-scoped repro breadcrumbs even when
     * broad Debugging Mode is off. Keep these events low-volume and explicit
     * so a user drag can reveal which guard prevented syncSessionOrder.
     */
    vscode.postMessage({
      details,
      event: `repro.pinnedSessionReorder.${event}`,
      type: "sidebarDebugLog",
    });
  });

  const postSidebarStartupReproLog = useEffectEvent((event: string, details: unknown) => {
    if (
      getSidebarStartupElapsedMs(sidebarStartupStartedAtRef.current) >
      SIDEBAR_STARTUP_REPRO_WINDOW_MS
    ) {
      return;
    }

    vscode.postMessage({
      details,
      event: `repro.sidebarStartup.${event}`,
      type: "sidebarDebugLog",
    });
  });

  const postSidebarRefreshLifecycleLog = useEffectEvent(
    (event: string, details: Record<string, unknown>) => {
      postSidebarRefreshDebugLog(
        useSidebarStore.getState().hud.debuggingMode,
        vscode,
        event,
        details,
      );
    },
  );

  useLayoutEffect(() => {
    if (!hasAppliedHydrateRef.current) {
      return;
    }

    const autoCollapseGroupIds = getAutoCollapseGroupIds({
      groupsById,
      workspaceGroupIds,
    });
    const nextSessionCountsByGroup = getSessionCountsByGroup({
      groupIds: groupOrder,
      sessionIdsByGroup: authoritativeSessionIdsByGroup,
    });
    const isEstablishingStartupGroupCollapseBaseline =
      !hasEstablishedStartupGroupCollapseBaselineRef.current;
    const hasGxserverUnavailablePlaceholder = groupOrder.includes(
      SIDEBAR_GXSERVER_UNAVAILABLE_GROUP_ID,
    );
    const visibleGroupIds = new Set(groupOrder);
    const unknownCollapsedGroupCount = Object.keys(collapsedGroupsById).filter(
      (groupId) => !visibleGroupIds.has(groupId),
    ).length;
    const preserveUnknownCollapsedGroups =
      isEstablishingStartupGroupCollapseBaseline && hasGxserverUnavailablePlaceholder;
    const sessionCountIncreaseGroupIds = isEstablishingStartupGroupCollapseBaseline
      ? []
      : groupOrder.filter((groupId) => {
        const previousCount = previousSessionCountsByGroupRef.current[ groupId ];
        return (
          previousCount !== undefined &&
          (authoritativeSessionIdsByGroup[ groupId ] ?? []).length > previousCount
        );
      });

    if (preserveUnknownCollapsedGroups && unknownCollapsedGroupCount > 0) {
      postSidebarCollapseStateLog("startupPartialHydratePreserved", {
        groupCount: groupOrder.length,
        placeholderGroupPresent: true,
        unknownCollapsedGroupCount,
      });
    }

    setCollapsedGroupsById((previous) =>
      reconcileCollapsedGroupsById({
        autoCollapseGroupIds,
        expandOnSessionCountIncreaseGroupIds: groupOrder,
        groupIds: groupOrder,
        preserveUnknownCollapsedGroups,
        previousSessionCountsByGroup: previousSessionCountsByGroupRef.current,
        previousCollapsedGroupsById: previous,
        sessionIdsByGroup: authoritativeSessionIdsByGroup,
        skipExpandOnSessionCountIncrease: isEstablishingStartupGroupCollapseBaseline,
      }),
    );

    /**
     * CDXC:SidebarReference 2026-05-08-11:09
     * When creating a chat, terminal, browser pane, or agent session inside a
     * collapsed Combined sidebar area, expand the owning Chats/Projects section
     * as soon as the host hydrates the added session so the user sees the
     * result of the action.
     * CDXC:SidebarReference 2026-05-20-12:00
     * Do not expand Chats/Projects section headers on the first post-hydrate
     * baseline pass after restart. Restored session counts are not new sessions.
     */
    if (sessionCountIncreaseGroupIds.some((groupId) => groupsById[ groupId ]?.isChatCollection)) {
      postSidebarCollapseStateLog("sectionAutoExpanded", {
        reason: "session-count-increase",
        section: "quick",
        sessionCountIncreaseGroupCount: sessionCountIncreaseGroupIds.length,
      });
      setIsReferenceChatsCollapsed(false);
    }

    if (sessionCountIncreaseGroupIds.some((groupId) => !groupsById[ groupId ]?.isChatCollection)) {
      postSidebarCollapseStateLog("sectionAutoExpanded", {
        reason: "session-count-increase",
        section: "projects",
        sessionCountIncreaseGroupCount: sessionCountIncreaseGroupIds.length,
      });
      setIsReferenceProjectsCollapsed(false);
    }

    previousSessionCountsByGroupRef.current = nextSessionCountsByGroup;
    if (isEstablishingStartupGroupCollapseBaseline && !hasGxserverUnavailablePlaceholder) {
      postSidebarCollapseStateLog("startupBaselineEstablished", {
        groupCount: groupOrder.length,
        sessionCount: Object.keys(sessionsById).length,
      });
      hasEstablishedStartupGroupCollapseBaselineRef.current = true;
    }
  }, [
    authoritativeSessionIdsByGroup,
    collapsedGroupsById,
    groupOrder,
    groupsById,
    sessionsById,
    workspaceGroupIds,
  ]);

  const isSidebarInteractionBlocked = isStartupInteractionBlocked;

  const setGroupCollapsed = (groupId: string, collapsed: boolean) => {
    const wasCollapsed = collapsedGroupsById[ groupId ] === true;
    const collapsedGroupCountBefore = Object.keys(collapsedGroupsById).length;
    postSidebarCollapseStateLog("groupToggle", {
      changed: wasCollapsed !== collapsed,
      collapsed,
      collapsedGroupCountBefore,
      collapsedGroupCountExpectedAfter:
        collapsedGroupCountBefore + (wasCollapsed === collapsed ? 0 : collapsed ? 1 : -1),
      groupHash: hashSidebarCollapseDebugId(groupId),
      groupIndex: groupOrder.indexOf(groupId),
      wasCollapsed,
    });
    setCollapsedGroupsById((previous) => {
      if (collapsed) {
        if (previous[ groupId ]) {
          return previous;
        }

        return {
          ...previous,
          [ groupId ]: true,
        };
      }

      if (!previous[ groupId ]) {
        return previous;
      }

      const next = { ...previous };
      delete next[ groupId ];
      return next;
    });
  };

  const setGroupsCollapsed = (groupIds: readonly string[], collapsed: boolean) => {
    const targetGroupSet = new Set(groupIds);
    const collapsedGroupCountBefore = Object.keys(collapsedGroupsById).length;
    const changedGroupCount = groupIds.filter(
      (groupId) => collapsedGroupsById[ groupId ] !== (collapsed ? true : undefined),
    ).length;
    postSidebarCollapseStateLog("groupsBulkToggle", {
      changedGroupCount,
      collapsed,
      collapsedGroupCountBefore,
      collapsedGroupCountExpectedAfter:
        collapsedGroupCountBefore + (collapsed ? changedGroupCount : -changedGroupCount),
      groupHashes: summarizeSidebarCollapseDebugGroupIds(groupIds),
      targetGroupCount: targetGroupSet.size,
    });
    setCollapsedGroupsById((previous) => {
      if (collapsed) {
        const next = { ...previous };
        let changed = false;
        for (const groupId of groupIds) {
          if (!next[ groupId ]) {
            next[ groupId ] = true;
            changed = true;
          }
        }
        return changed ? next : previous;
      }

      let next: Record<string, true> | undefined;
      for (const groupId of groupIds) {
        if (previous[ groupId ]) {
          next ??= { ...previous };
          delete next[ groupId ];
        }
      }
      return next ?? previous;
    });
  };

  const setRemoteMachineSectionCollapsed = (machineId: string, collapsed: boolean) => {
    const wasCollapsed = collapsedRemoteMachineSectionsById[ machineId ] === true;
    postSidebarCollapseStateLog("remoteMachineSectionToggle", {
      changed: wasCollapsed !== collapsed,
      collapsed,
      machineHash: hashSidebarCollapseDebugId(machineId),
      wasCollapsed,
    });
    /*
     * CDXC:RemoteMachines 2026-06-09-19:02:
     * Remote machine sections are peers of Quick and Projects in the reference
     * sidebar. Persist their collapsed state by saved machine id so each machine
     * can collapse independently without affecting local project groups.
     */
    setCollapsedRemoteMachineSectionsById((previous) => {
      if (collapsed) {
        if (previous[ machineId ]) {
          return previous;
        }

        return {
          ...previous,
          [ machineId ]: true,
        };
      }

      if (!previous[ machineId ]) {
        return previous;
      }

      const next = { ...previous };
      delete next[ machineId ];
      return next;
    });
  };

  const dismissAppModalForSidebarNavigation = (area: string) => {
    /*
     * CDXC:SettingsDismissal 2026-06-15-14:07:
     * Settings is a workspace-scoped app modal, but sidebar navigation should
     * always return users to the live workspace. Dismiss the native app-modal
     * host before session focus, session creation, sidebar nav buttons,
     * top-level modals, and direct previous-session text search.
     */
    setIsSettingsOpen(false);
    if (!window.webkit?.messageHandlers?.ghostexAppModalHost) {
      return;
    }
    closeAppModal(area);
  };

  const focusSidebarSessionFromNavigation = (groupId: string, sessionId: string) => {
    dismissAppModalForSidebarNavigation("SettingsDismissal:focusSession");
    applyLocalFocus(groupId, sessionId);
  };

  const requestNewSession = () => {
    if (isSidebarInteractionBlocked) {
      return;
    }

    dismissAppModalForSidebarNavigation("SettingsDismissal:createSession");
    vscode.postMessage({ type: "createSession" });
  };

  const handleSidebarDoubleClick = (event: ReactMouseEvent<HTMLElement>) => {
    if (!createSessionOnSidebarDoubleClick) {
      return;
    }

    if (!isEmptySidebarDoubleClick(event)) {
      return;
    }

    event.preventDefault();
    requestNewSession();
  };

  const handleSidebarClickCapture = (event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (!target.closest(".session")) {
      return;
    }
    dismissAppModalForSidebarNavigation("SettingsDismissal:sessionClick");
  };

  const handleWindowMessage = useEffectEvent((event: MessageEvent<ExtensionToSidebarMessage>) => {
    if (!event.data) {
      return;
    }

    if (event.data.type === "nativeHotkey") {
      runGhostexHotkeyAction(event.data.actionId);
      return;
    }

    if (event.data.type === "playCompletionSound") {
      const sessionId = event.data.sessionId;
      postSidebarDebugLog("completionSound.messageReceived", {
        sound: event.data.sound,
        sessionId,
      });
      if (sessionId) {
        const existingTimeout = completionFlashTimeoutBySessionIdRef.current.get(sessionId);
        if (existingTimeout !== undefined) {
          window.clearTimeout(existingTimeout);
        }
        setCompletionFlashNonceBySessionId((previous) => ({
          ...previous,
          [ sessionId ]: (previous[ sessionId ] ?? 0) + 1,
        }));
        const timeout = window.setTimeout(() => {
          completionFlashTimeoutBySessionIdRef.current.delete(sessionId);
          setCompletionFlashNonceBySessionId((previous) => {
            if (!(sessionId in previous)) {
              return previous;
            }

            const next = { ...previous };
            delete next[ sessionId ];
            return next;
          });
        }, COMPLETION_FLASH_DURATION_MS);
        completionFlashTimeoutBySessionIdRef.current.set(sessionId, timeout);
      }
      void playCompletionSound(event.data.sound, (soundEvent, details) => {
        postSidebarDebugLog(soundEvent, details);
      });
      return;
    }

    if (event.data.type === "sessionPresentationChanged") {
      applySessionPresentationMessage(event.data);
      return;
    }

    if (event.data.type === "sidebarGroupsChanged") {
      applyGroupsChangedMessage(event.data);
      return;
    }

    if (event.data.type === "sidebarHudChanged") {
      applyHudChangedMessage(event.data);
      return;
    }

    if (event.data.type === "sidebarCommandRunStateChanged") {
      applyCommandRunStateMessage(event.data);
      return;
    }

    if (event.data.type === "sidebarCommandRunStateCleared") {
      applyCommandRunStateClearedMessage(event.data);
      return;
    }

    if (event.data.type === "sidebarOrderSyncResult") {
      postSidebarOrderReproLog(vscode, "repro.sidebarOrder.webview.syncResultReceived", {
        itemIds: event.data.itemIds,
        kind: event.data.kind,
        requestId: event.data.requestId,
        status: event.data.status,
      });
      applyOrderSyncResultMessage(event.data);
      return;
    }

    if (event.data.type === "daemonSessionsState") {
      setDaemonSessionsState(event.data);
      return;
    }

    if (event.data.type === "promptGitCommit") {
      setGitCommitDraft(event.data);
      return;
    }

    if (event.data.type === "previousSessionsResult") {
      if (event.data.requestId !== latestSessionSearchPreviousRequestIdRef.current) {
        return;
      }
      setRemoteSessionSearchPreviousSessions(event.data.previousSessions);
      return;
    }

    if (event.data.type === "remoteMachineStatus") {
      const remoteMachineStatus = event.data as RemoteMachineRuntimeStatus;
      setRemoteMachineRuntimeStatuses((current) => ({
        ...current,
        [ remoteMachineStatus.machineId ]: remoteMachineStatus.state,
      }));
      return;
    }

    if (event.data.type === "showT3BrowserAccess") {
      /**
       * CDXC:T3RemoteAccess 2026-05-02-00:57
       * Remote Access is launched from sidebar session actions, but the QR
       * modal must render in the app-level host so it is centered over the
       * whole workspace instead of being constrained to the sidebar.
       */
      openAppModal({
        access: event.data,
        modal: "t3BrowserAccess",
        type: "open",
      });
      return;
    }

    if (event.data.type === "showSessionRenameModal") {
      dismissAppModalForSidebarNavigation("SettingsDismissal:renameSession");
      openAppModal({
        initialTitle: event.data.initialTitle,
        modal: "renameSession",
        sessionId: event.data.sessionId,
        type: "open",
      });
      return;
    }

    if (event.data.type === "showT3ThreadIdModal") {
      openAppModal({
        modal: "t3ThreadId",
        sessionId: event.data.sessionId,
        threadId: event.data.currentThreadId,
        type: "open",
      });
      return;
    }

    if (event.data.type !== "hydrate" && event.data.type !== "sessionState") {
      return;
    }

    postSidebarOrderReproLog(vscode, "repro.sidebarOrder.webview.messageReceived", {
      agentIds: event.data.hud.agents.map((agent) => agent.agentId),
      commandIds: event.data.hud.commands.map((command) => command.commandId),
      groupCount: event.data.groups.length,
      groupIds: event.data.groups.map((group) => group.groupId),
      messageType: event.data.type,
      revision: event.data.revision,
    });
    postSidebarStartupReproLog("messageReceived", {
      elapsedMs: getSidebarStartupElapsedMs(sidebarStartupStartedAtRef.current),
      groupCount: event.data.groups.length,
      hasHydrateBeforeMessage: hasAppliedHydrateRef.current,
      firstHydrateRevision: firstHydrateRevisionRef.current,
      messageType: event.data.type,
      previousRevision: revision,
      revision: event.data.revision,
      sessionCount: countSidebarSessions(event.data.groups),
      stale: event.data.revision < revision,
      startupInteractionBlocked: isStartupInteractionBlocked,
    });
    postSidebarRefreshDebugLog(event.data.hud.debuggingMode, vscode, "messageReceived", {
      ...summarizeSidebarRefreshMessage(event.data, revision),
      hasHydrateBeforeMessage: hasAppliedHydrateRef.current,
      instanceId: refreshDebugInstanceIdRef.current,
    });
    const sidebarCollapseMessageSessionCount = countSidebarSessions(event.data.groups);
    const sidebarCollapseMessageShape = [
      event.data.type,
      event.data.groups.length,
      sidebarCollapseMessageSessionCount,
      event.data.revision < revision ? "stale" : "fresh",
    ].join(":");
    const shouldLogSidebarCollapseHydrateMessage =
      event.data.hud.debuggingMode &&
      getSidebarStartupElapsedMs(sidebarStartupStartedAtRef.current) <=
      SIDEBAR_STARTUP_REPRO_WINDOW_MS &&
      (collapseStateHydrateLogCountRef.current < 8 ||
        lastCollapseStateHydrateShapeRef.current !== sidebarCollapseMessageShape);
    if (shouldLogSidebarCollapseHydrateMessage) {
      /**
       * CDXC:SidebarCollapseDiagnostics 2026-06-02-22:18:
       * Collapse-state startup logs need the first hydrate sequence and shape
       * changes, not every repeated gxserver presentation refresh. Limit the
       * high-frequency message logs so support bundles stay readable while
       * still capturing partial 2-group startup hydrates.
       */
      collapseStateHydrateLogCountRef.current += 1;
      lastCollapseStateHydrateShapeRef.current = sidebarCollapseMessageShape;
      postSidebarCollapseStateLog(
        "messageReceived",
        {
          collapsedGroupCount: Object.keys(collapsedGroupsById).length,
          groupCount: event.data.groups.length,
          isRecentProjectsOpen,
          isReferenceChatsCollapsed,
          isReferenceProjectsCollapsed,
          messageRevision: event.data.revision,
          messageType: event.data.type,
          sessionCount: sidebarCollapseMessageSessionCount,
          stale: event.data.revision < revision,
        },
        { enabled: true },
      );
    }
    if (event.data.hud.debuggingMode && !didLogRefreshInstanceObservedRef.current) {
      didLogRefreshInstanceObservedRef.current = true;
      postSidebarRefreshDebugLog(event.data.hud.debuggingMode, vscode, "appInstanceObserved", {
        elapsedMs: getSidebarStartupElapsedMs(sidebarStartupStartedAtRef.current),
        instanceId: refreshDebugInstanceIdRef.current,
        messageType: event.data.type,
        revision: event.data.revision,
      });
    }
    if (event.data.type === "sessionState" && !hasAppliedHydrateRef.current) {
      postSidebarStartupReproLog("sessionStateBeforeHydrate", {
        elapsedMs: getSidebarStartupElapsedMs(sidebarStartupStartedAtRef.current),
        previousRevision: revision,
        revision: event.data.revision,
        sessionCount: countSidebarSessions(event.data.groups),
      });
    }
    /*
     * CDXC:AgentDetection 2026-04-27-07:29
     * Agent-icon debugging must verify the message boundary, not the CSS layer:
     * log whether native-projected agentIcon values reach the sidebar webview
     * and survive the Zustand store apply step.
     */
    postSidebarAgentIconBoundaryLog(vscode, "sidebar.agentIcon.messageReceived", {
      messageType: event.data.type,
      revision: event.data.revision,
      summary: summarizeSidebarAgentIconsFromGroups(event.data.groups),
    });

    if (pendingCreateGroupRef.current) {
      const nextGroupId = findCreatedGroupId(
        groupOrder,
        event.data.groups.map((group) => group.groupId),
      );
      if (nextGroupId) {
        setAutoEditingGroupId(nextGroupId);
        pendingCreateGroupRef.current = false;
      }
    }

    applySidebarMessage(event.data);
    postSidebarRefreshDebugLog(event.data.hud.debuggingMode, vscode, "messageApplied", {
      ...summarizeSidebarRefreshMessage(event.data, revision),
      hasHydrateAfterApply: hasAppliedHydrateRef.current,
      instanceId: refreshDebugInstanceIdRef.current,
      storeRevisionAfterApply: useSidebarStore.getState().revision,
      storeSessionCountAfterApply: Object.keys(useSidebarStore.getState().sessionsById).length,
    });
    postSidebarAgentIconBoundaryLog(vscode, "sidebar.agentIcon.messageApplied", {
      messageType: event.data.type,
      revision: event.data.revision,
      summary: summarizeSidebarAgentIconsFromStore(useSidebarStore.getState().sessionsById),
    });
    if (event.data.type === "hydrate" && !hasAppliedHydrateRef.current) {
      hasAppliedHydrateRef.current = true;
      firstHydrateRevisionRef.current = event.data.revision;
    }
    if (shouldLogSidebarCollapseHydrateMessage) {
      postSidebarCollapseStateLog(
        "messageApplied",
        {
          collapsedGroupCount: Object.keys(collapsedGroupsById).length,
          groupCount: event.data.groups.length,
          isRecentProjectsOpen,
          isReferenceChatsCollapsed,
          isReferenceProjectsCollapsed,
          messageRevision: event.data.revision,
          messageType: event.data.type,
          sessionCount: sidebarCollapseMessageSessionCount,
          storeCollapsedGroupCount: Object.keys(collapsedGroupsById).length,
          storeRevisionAfterApply: useSidebarStore.getState().revision,
        },
        { enabled: true },
      );
    }
    postSidebarStartupReproLog("messageApplied", {
      elapsedMs: getSidebarStartupElapsedMs(sidebarStartupStartedAtRef.current),
      groupCount: event.data.groups.length,
      hasHydrateAfterApply: hasAppliedHydrateRef.current,
      firstHydrateRevision: firstHydrateRevisionRef.current,
      messageType: event.data.type,
      previousRevision: revision,
      revision: event.data.revision,
      sessionCount: countSidebarSessions(event.data.groups),
      stale: event.data.revision < revision,
      startupInteractionBlocked: isStartupInteractionBlocked,
    });
  });

  useEffect(() => {
    /*
    CDXC:SidebarRefreshDiagnostics 2026-06-06-23:18:
    The mount/unmount diagnostic must describe the React app lifetime only. Including effect-event callbacks in this dependency list made every hydrate render look like an app remount in persistent logs, hiding the real refresh cadence and adding avoidable Debugging Mode noise.
    */
    const instanceId = refreshDebugInstanceIdRef.current;
    postSidebarStartupReproLog("appMounted", {
      elapsedMs: getSidebarStartupElapsedMs(sidebarStartupStartedAtRef.current),
      startupInteractionBlockMs: SIDEBAR_STARTUP_INTERACTION_BLOCK_MS,
    });
    postSidebarRefreshLifecycleLog("appMounted", {
      elapsedMs: getSidebarStartupElapsedMs(sidebarStartupStartedAtRef.current),
      instanceId,
      revision: useSidebarStore.getState().revision,
      sessionCount: Object.keys(useSidebarStore.getState().sessionsById).length,
    });

    return () => {
      postSidebarStartupReproLog("appUnmounted", {
        elapsedMs: getSidebarStartupElapsedMs(sidebarStartupStartedAtRef.current),
        finalRevision: useSidebarStore.getState().revision,
      });
      postSidebarRefreshLifecycleLog("appUnmounted", {
        elapsedMs: getSidebarStartupElapsedMs(sidebarStartupStartedAtRef.current),
        finalRevision: useSidebarStore.getState().revision,
        instanceId,
        sessionCount: Object.keys(useSidebarStore.getState().sessionsById).length,
      });
    };
  }, []);

  useEffect(() => {
    if (!debuggingMode || didLogInitialUiCollapseStateReadRef.current) {
      return;
    }

    didLogInitialUiCollapseStateReadRef.current = true;
    postSidebarCollapseStateLog("initialRead", {
      ...summarizeSidebarUiCollapseRead(initialUiCollapseStateRead),
      currentCollapsedGroupCount: Object.keys(collapsedGroupsById).length,
      groupCount: groupOrder.length,
      sessionCount: Object.keys(sessionsById).length,
      workspaceGroupCount: workspaceGroupIds.length,
    });
  }, [
    collapsedGroupsById,
    debuggingMode,
    groupOrder,
    initialUiCollapseStateRead,
    sessionsById,
    workspaceGroupIds,
  ]);

  useEffect(() => {
    const renderState = {
      elapsedMs: getSidebarStartupElapsedMs(sidebarStartupStartedAtRef.current),
      firstHydrateRevision: firstHydrateRevisionRef.current,
      groupCount: groupOrder.length,
      hasHydrate: hasAppliedHydrateRef.current,
      revision,
      sessionCount: Object.keys(sessionsById).length,
      startupInteractionBlocked: isStartupInteractionBlocked,
      workspaceGroupCount: workspaceGroupIds.length,
    };
    const renderStateKey = JSON.stringify(renderState);
    if (lastSidebarStartupRenderStateKeyRef.current === renderStateKey) {
      return;
    }

    lastSidebarStartupRenderStateKeyRef.current = renderStateKey;
    postSidebarStartupReproLog("renderState", renderState);
    postSidebarRefreshDebugLog(debuggingMode, vscode, "renderStateChanged", {
      ...renderState,
      instanceId: refreshDebugInstanceIdRef.current,
    });
    if (hasAppliedHydrateRef.current && renderState.sessionCount === 0) {
      postSidebarStartupReproLog("emptyStateAfterHydrate", renderState);
      postSidebarRefreshDebugLog(debuggingMode, vscode, "emptyStateAfterHydrate", {
        ...renderState,
        instanceId: refreshDebugInstanceIdRef.current,
      });
    }
  }, [
    debuggingMode,
    groupOrder,
    isStartupInteractionBlocked,
    postSidebarStartupReproLog,
    revision,
    sessionsById,
    vscode,
    workspaceGroupIds,
  ]);

  useEffect(() => {
    const handleMessage = (event: Event) => {
      if (event instanceof MessageEvent) {
        handleWindowMessage(event);
      }
    };

    messageSource.addEventListener("message", handleMessage);

    return () => {
      messageSource.removeEventListener("message", handleMessage);
    };
  }, [ handleWindowMessage, messageSource ]);

  useEffect(() => {
    if (!nativeHostEventSource) {
      return;
    }

    const handleNativeHostEvent = (event: Event) => {
      if (!(event instanceof CustomEvent)) {
        return;
      }

      handleWindowMessage(
        new MessageEvent<ExtensionToSidebarMessage>("message", {
          data: event.detail,
        }),
      );
    };

    /**
     * CDXC:Hotkeys 2026-06-05-21:17:
     * Native macOS shortcuts arrive through the Ghostex host custom event, while extension-style traffic arrives through postMessage. Route both into the same sidebar action handler so Cmd+number uses the visible-row slot resolver consistently.
     *
     * CDXC:Hotkeys 2026-06-12-12:33:
     * The native sidebar wrapper owns typed nativeHotkey host events. Allow that wrapper to disable this shared listener so Cmd+T creates one terminal tab instead of running both the wrapper action and the shared SidebarApp createSession bridge.
     */
    nativeHostEventSource.addEventListener("ghostex-native-host-event", handleNativeHostEvent);

    return () => {
      nativeHostEventSource.removeEventListener("ghostex-native-host-event", handleNativeHostEvent);
    };
  }, [ handleWindowMessage, nativeHostEventSource ]);

  useEffect(() => {
    return () => {
      for (const timeout of completionFlashTimeoutBySessionIdRef.current.values()) {
        window.clearTimeout(timeout);
      }
      completionFlashTimeoutBySessionIdRef.current.clear();

      for (const timeoutId of Object.values(referenceSectionAnimationTimeoutsRef.current)) {
        if (timeoutId !== undefined) {
          window.clearTimeout(timeoutId);
        }
      }
      referenceSectionAnimationTimeoutsRef.current = {};
    };
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      postSidebarStartupReproLog("interactionBlockReleased", {
        elapsedMs: getSidebarStartupElapsedMs(sidebarStartupStartedAtRef.current),
        revision: useSidebarStore.getState().revision,
      });
      setIsStartupInteractionBlocked(false);
    }, SIDEBAR_STARTUP_INTERACTION_BLOCK_MS);

    return () => {
      window.clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    document.body.dataset.sidebarTheme = theme;
    const normalizedThemeColor = normalizeWorkspaceThemeColor(customThemeColor);
    const customSidebarTitlebarColorsEnabled =
      effectiveSettings.customSidebarTitlebarColorsEnabled === true;
    const customSidebarTitlebarForegroundColor = getSidebarTitlebarForegroundForBackground(
      effectiveSettings.customSidebarTitlebarBackgroundColor,
    );
    const customSidebarTitlebarGradientColors = getSidebarTitlebarGradientColors(
      effectiveSettings.customSidebarTitlebarBackgroundColor,
    );
    if (normalizedThemeColor) {
      /**
       * CDXC:WorkspaceTheme 2026-05-05-02:58
       * Custom workspace colors are active-project sidebar theme overrides:
       * keep the preset data-sidebar-theme as fallback, but publish validated
       * CSS variables so the app-level theme surfaces derive from the color.
       */
      document.body.dataset.sidebarCustomTheme = "true";
      document.body.style.setProperty("--workspace-sidebar-theme-color", normalizedThemeColor);
      document.body.style.setProperty(
        "--workspace-sidebar-theme-foreground",
        getWorkspaceThemeForeground(normalizedThemeColor),
      );
    } else {
      delete document.body.dataset.sidebarCustomTheme;
      document.body.style.removeProperty("--workspace-sidebar-theme-color");
      document.body.style.removeProperty("--workspace-sidebar-theme-foreground");
    }

    if (customSidebarTitlebarColorsEnabled) {
      /**
       * CDXC:SidebarTitlebarColors 2026-06-15-11:24:
       * Custom sidebar/titlebar colors are an experimental chrome override.
       * Publish dedicated CSS variables instead of mutating app theme tokens so
       * Settings modals, sidebar dropdowns, and other overlay surfaces continue
       * to resolve their normal Dark Gray/Dark 2 colors.
       *
       * CDXC:SidebarTitlebarColors 2026-06-15-13:22:
       * The foreground is derived from the selected background at apply time.
       * Do not preserve older stored foreground choices in the sidebar DOM.
       *
       * CDXC:SidebarTitlebarColors 2026-06-19-12:33:
       * The sidebar custom chrome background is a fixed-strength vertical
       * gradient derived from the selected tint-adjusted background. Publish
       * explicit gradient stop variables while keeping the solid background
       * token for row/card contrast calculations.
       */
      document.body.dataset.customSidebarTitlebarColors = "true";
      document.body.style.setProperty(
        "--custom-sidebar-titlebar-foreground-color",
        customSidebarTitlebarForegroundColor,
      );
      document.body.style.setProperty(
        "--custom-sidebar-titlebar-background-color",
        effectiveSettings.customSidebarTitlebarBackgroundColor,
      );
      document.body.style.setProperty(
        "--custom-sidebar-titlebar-gradient-top-color",
        customSidebarTitlebarGradientColors.sidebarTop,
      );
      document.body.style.setProperty(
        "--custom-sidebar-titlebar-gradient-bottom-color",
        customSidebarTitlebarGradientColors.sidebarBottom,
      );
    } else {
      delete document.body.dataset.customSidebarTitlebarColors;
      document.body.style.removeProperty("--custom-sidebar-titlebar-foreground-color");
      document.body.style.removeProperty("--custom-sidebar-titlebar-background-color");
      document.body.style.removeProperty("--custom-sidebar-titlebar-gradient-top-color");
      document.body.style.removeProperty("--custom-sidebar-titlebar-gradient-bottom-color");
    }

    return () => {
      delete document.body.dataset.sidebarTheme;
      delete document.body.dataset.sidebarCustomTheme;
      delete document.body.dataset.customSidebarTitlebarColors;
      document.body.style.removeProperty("--workspace-sidebar-theme-color");
      document.body.style.removeProperty("--workspace-sidebar-theme-foreground");
      document.body.style.removeProperty("--custom-sidebar-titlebar-foreground-color");
      document.body.style.removeProperty("--custom-sidebar-titlebar-background-color");
      document.body.style.removeProperty("--custom-sidebar-titlebar-gradient-top-color");
      document.body.style.removeProperty("--custom-sidebar-titlebar-gradient-bottom-color");
    };
  }, [
    customThemeColor,
    effectiveSettings.customSidebarTitlebarBackgroundColor,
    effectiveSettings.customSidebarTitlebarColorsEnabled,
    theme,
  ]);

  useEffect(() => {
    document.body.style.setProperty("--ghostex-agent-manager-zoom", `${agentManagerZoomPercent}%`);

    return () => {
      document.body.style.removeProperty("--ghostex-agent-manager-zoom");
    };
  }, [ agentManagerZoomPercent ]);

  const closeGitCommitModal = useEffectEvent((requestId: string) => {
    setGitCommitDraft(undefined);
    setGitFileDiffDraft(undefined);
    vscode.postMessage({
      requestId,
      type: "cancelSidebarGitCommit",
    });
  });

  useEffect(() => {
    if (!sessionGroupsPanelRef.current) {
      return;
    }

    sessionGroupsPanelRef.current.inert = isSidebarInteractionBlocked;
  }, [ isSidebarInteractionBlocked ]);

  const triggerReferenceSectionChildAnimation = (section: ReferenceSidebarSectionId) => {
    /**
     * CDXC:SidebarSessions 2026-05-17-00:11:
     * Reference-sidebar child entrance motion is only for explicit section
     * expansion. Session open/close hydration must not leave a durable CSS
     * state that replays the project/session "loading in" animation.
     */
    setReferenceSectionChildAnimations((previous) =>
      previous[ section ] ? previous : { ...previous, [ section ]: true },
    );

    const existingTimeoutId = referenceSectionAnimationTimeoutsRef.current[ section ];
    if (existingTimeoutId !== undefined) {
      window.clearTimeout(existingTimeoutId);
    }

    referenceSectionAnimationTimeoutsRef.current[ section ] = window.setTimeout(() => {
      setReferenceSectionChildAnimations((previous) =>
        previous[ section ] ? { ...previous, [ section ]: false } : previous,
      );
      delete referenceSectionAnimationTimeoutsRef.current[ section ];
    }, REFERENCE_SECTION_CHILD_ANIMATION_RESET_MS);
  };

  const isManualActiveSessionsSort = activeSessionsSortMode === "manual";
  /**
   * CDXC:SidebarLayout 2026-05-13-08:11
   * The reference sidebar replaces the old visible Actions/Agents grids with
   * app-modal entries, titlebar modes, and project header controls. Do not
   * mount the obsolete hidden panels in the sidebar tree.
   */
  const { groupIds: effectiveGroupIds, sessionIdsByGroup: effectiveSessionIdsByGroup } = useMemo(
    () =>
      createDisplaySessionLayout({
        sessionIdsByGroup: createWorkspaceSessionIdsByGroup(
          workspaceGroupIds,
          authoritativeSessionIdsByGroup,
        ),
        sessionsById,
        sortMode: activeSessionsSortMode,
        workspaceGroupIds,
      }),
    [ activeSessionsSortMode, authoritativeSessionIdsByGroup, sessionsById, workspaceGroupIds ],
  );
  const normalizedSessionSearchQuery = sessionSearchQuery.trim();
  const isSessionSearchFiltering =
    isSessionSearchOpen && normalizedSessionSearchQuery.length >= MIN_SESSION_SEARCH_QUERY_LENGTH;
  useEffect(() => {
    if (!isSessionSearchFiltering) {
      latestSessionSearchPreviousRequestIdRef.current = undefined;
      setRemoteSessionSearchPreviousSessions(undefined);
      return;
    }
    const timeoutId = window.setTimeout(() => {
      const requestId = `sidebar-search-previous-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      latestSessionSearchPreviousRequestIdRef.current = requestId;
      /*
      CDXC:GxserverPresentationSearch 2026-06-01-15:08:
      Main sidebar search must show active-session matches immediately from the hydrated presentation snapshot, then query gxserver for previous/history metadata with a 200ms debounce. Do not depend on startup-hydrated previousSessions after the hard cutover.
      */
      vscode.postMessage({
        limit: 20,
        query: normalizedSessionSearchQuery,
        requestId,
        type: "requestPreviousSessions",
      });
    }, 200);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [ isSessionSearchFiltering, normalizedSessionSearchQuery, vscode ]);
  /**
   * CDXC:ProjectBrowserTabs 2026-05-16-12:59:
   * Do not render a standalone Browsers group in the sidebar. Browser pane
   * sessions belong in their project group, and the shared workspace display
   * layout orders those project browser sessions before terminals/agents.
   */
  const displayedWorkspaceSessionIdsByGroup = useMemo(
    () =>
      createDisplayedSessionIdsByGroup({
        groupIds: effectiveGroupIds,
        query: normalizedSessionSearchQuery,
        selectedSessionTags: activeSelectedSessionTagFilters,
        sessionIdsByGroup: effectiveSessionIdsByGroup,
        sessionsById,
        shouldFilter: isSessionSearchFiltering,
      }),
    [
      effectiveGroupIds,
      effectiveSessionIdsByGroup,
      activeSelectedSessionTagFilters,
      isSessionSearchFiltering,
      normalizedSessionSearchQuery,
      sessionsById,
    ],
  );
  const displayedWorkspaceGroupIds = useMemo(
    () =>
      createDisplayedGroupIds(
        effectiveGroupIds,
        displayedWorkspaceSessionIdsByGroup,
        isSessionSearchFiltering || activeSelectedSessionTagFilters.length > 0,
      ),
    [
      activeSelectedSessionTagFilters.length,
      displayedWorkspaceSessionIdsByGroup,
      effectiveGroupIds,
      isSessionSearchFiltering,
    ],
  );
  const displayedReferenceChatGroupIds = useMemo(
    () =>
      displayedWorkspaceGroupIds.filter((groupId) => groupsById[ groupId ]?.isChatCollection),
    [ displayedWorkspaceGroupIds, groupsById ],
  );
  const displayedReferenceProjectGroupIds = useMemo(
    () =>
      displayedWorkspaceGroupIds.filter(
        (groupId) =>
          groupId !== SIDEBAR_GXSERVER_UNAVAILABLE_GROUP_ID &&
          !groupsById[ groupId ]?.isChatCollection &&
          !groupsById[ groupId ]?.remoteMachineContext,
      ),
    [ displayedWorkspaceGroupIds, groupsById ],
  );
  const remoteProjectGroupIdsByMachineId = useMemo(() => {
    const next: Record<string, string[]> = {};
    for (const groupId of displayedWorkspaceGroupIds) {
      const remoteMachineContext = groupsById[ groupId ]?.remoteMachineContext;
      if (!remoteMachineContext) {
        continue;
      }
      next[ remoteMachineContext.machineId ] ??= [];
      next[ remoteMachineContext.machineId ].push(groupId);
    }
    return next;
  }, [ displayedWorkspaceGroupIds, groupsById ]);
  const remoteMachines = settings?.remoteMachines ?? [];
  useEffect(() => {
    const remoteMachineIds = new Set(remoteMachines.map((machine) => machine.id));
    setCollapsedRemoteMachineSectionsById((previous) => {
      let next: Record<string, true> | undefined;
      for (const machineId of Object.keys(previous)) {
        if (!remoteMachineIds.has(machineId)) {
          next ??= { ...previous };
          delete next[ machineId ];
        }
      }
      return next ?? previous;
    });
  }, [ remoteMachines ]);
  const moveRemoteMachineSection = useEffectEvent(
    (sourceRemoteMachineId: string, targetRemoteMachineId: string) => {
      if (!settings || sourceRemoteMachineId === targetRemoteMachineId) {
        return;
      }
      const sourceIndex = settings.remoteMachines.findIndex(
        (machine) => machine.id === sourceRemoteMachineId,
      );
      const targetIndex = settings.remoteMachines.findIndex(
        (machine) => machine.id === targetRemoteMachineId,
      );
      if (sourceIndex < 0 || targetIndex < 0) {
        return;
      }
      const nextRemoteMachines = [ ...settings.remoteMachines ];
      const [ movedMachine ] = nextRemoteMachines.splice(sourceIndex, 1);
      if (!movedMachine) {
        return;
      }
      nextRemoteMachines.splice(targetIndex, 0, movedMachine);
      /*
       * CDXC:RemoteMachines 2026-06-03-00:18:
       * Remote machine sidebar sections are user-orderable peers of Projects.
       * Persist the order in Settings.remoteMachines so app restart and the
       * Remote settings tab show the same section order.
       */
      vscode.postMessage({
        settings: {
          ...settings,
          remoteMachines: nextRemoteMachines,
        },
        type: "updateSettings",
      });
    },
  );
  const filteredPreviousSessions = useMemo(
    () => {
      if (!isSessionSearchFiltering) {
        return [];
      }
      const searchResults =
        remoteSessionSearchPreviousSessions ??
        filterPreviousSessions(previousSessions, normalizedSessionSearchQuery);
      return filterDefaultNamedSessionSearchItems(searchResults);
    },
    [
      isSessionSearchFiltering,
      normalizedSessionSearchQuery,
      previousSessions,
      remoteSessionSearchPreviousSessions,
    ],
  );
  const filteredRecentProjects = useMemo(
    () => filterRecentProjects(recentProjects, recentProjectsQuery),
    [ recentProjects, recentProjectsQuery ],
  );

  const handleRecentProjectsListPointerMove = (
    event: ReactPointerEvent<HTMLDivElement>,
  ): void => {
    recentProjectsPointerPointRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
    };
  };

  const handleRecentProjectsListPointerLeave = (): void => {
    recentProjectsPointerPointRef.current = undefined;
    dismissSidebarTooltips();
  };

  const handleRecentProjectsListScroll = (): void => {
    /*
     * CDXC:RecentProjects 2026-06-14-15:45:
     * Recent Project path tooltips should be dismissed as soon as the drawer scroll area receives scroll input. Do not reopen on scroll idle; the next normal hover should create a fresh tooltip for the row currently under the pointer.
     */
    dismissSidebarTooltips();
    setIsRecentProjectsListScrolling(true);
    if (recentProjectsScrollIdleTimeoutRef.current !== undefined) {
      window.clearTimeout(recentProjectsScrollIdleTimeoutRef.current);
    }
    recentProjectsScrollIdleTimeoutRef.current = window.setTimeout(() => {
      recentProjectsScrollIdleTimeoutRef.current = undefined;
      setIsRecentProjectsListScrolling(false);
    }, RECENT_PROJECTS_TOOLTIP_SCROLL_SETTLE_MS);
  };

  useEffect(() => {
    if (isRecentProjectsOpen) {
      return;
    }
    if (recentProjectsScrollIdleTimeoutRef.current !== undefined) {
      window.clearTimeout(recentProjectsScrollIdleTimeoutRef.current);
      recentProjectsScrollIdleTimeoutRef.current = undefined;
    }
    recentProjectsPointerPointRef.current = undefined;
    setIsRecentProjectsListScrolling(false);
    dismissSidebarTooltips();
  }, [ isRecentProjectsOpen ]);

  const hasExpandedReferenceProjects = useMemo(
    () =>
      displayedReferenceProjectGroupIds.some((groupId) => collapsedGroupsById[ groupId ] !== true),
    [ collapsedGroupsById, displayedReferenceProjectGroupIds ],
  );
  const handleSidebarProjectJump = useEffectEvent((detail: SidebarProjectJumpEventDetail) => {
    const shouldRevealFocusedSession = detail.revealFocusedSession === true;
    const requestFocusedSessionReveal = () => {
      if (!shouldRevealFocusedSession) {
        return;
      }
      setFocusedSessionRevealRequestId((requestId) => requestId + 1);
    };

    if (
      !detail.expandCollapsedProject ||
      !displayedReferenceProjectGroupIds.includes(detail.groupId)
    ) {
      requestFocusedSessionReveal();
      return;
    }

    const wasProjectCollapsed = collapsedGroupsById[ detail.groupId ] === true;
    const wasSectionCollapsed = isReferenceProjectsCollapsed;
    if (!wasProjectCollapsed && !wasSectionCollapsed) {
      requestFocusedSessionReveal();
      return;
    }

    /**
     * CDXC:ProjectHotkeys 2026-06-15-11:12:
     * Jump to Project shortcuts are navigation in the visible Projects sidebar area. When configured, a keyboard jump must reveal a collapsed target row immediately through React state, and the optional Show less write is only applied when that project row was actually expanded by the jump.
     *
     * CDXC:SidebarSessionReveal 2026-06-16-07:55:
     * Project/worktree creation can ask this same event to retry focused-row
     * scrolling after the target project has been expanded, because a new
     * gxserver row may arrive after the first focus hydrate.
     */
    postSidebarCollapseStateLog("projectJumpAutoExpand", {
      projectGroupCount: displayedReferenceProjectGroupIds.length,
      groupHash: hashSidebarCollapseDebugId(detail.groupId),
      revealFocusedSession: shouldRevealFocusedSession,
      showLessAfterExpand: detail.showLessAfterExpand,
      wasProjectCollapsed,
      wasSectionCollapsed,
    });
    if (wasSectionCollapsed) {
      triggerReferenceSectionChildAnimation("projects");
      setIsReferenceProjectsCollapsed(false);
    }
    if (wasProjectCollapsed) {
      setGroupCollapsed(detail.groupId, false);
      if (detail.showLessAfterExpand) {
        writeProjectSessionListCollapsedState({
          ...readProjectSessionListCollapsedState(),
          [ detail.projectId ]: true,
        });
      }
    }
    requestFocusedSessionReveal();
  });
  useEffect(() => {
    const handleProjectJumpEvent = (event: Event) => {
      const detail = readSidebarProjectJumpEventDetail(event);
      if (detail) {
        handleSidebarProjectJump(detail);
      }
    };
    window.addEventListener(SIDEBAR_PROJECT_JUMP_EVENT, handleProjectJumpEvent);
    return () => {
      window.removeEventListener(SIDEBAR_PROJECT_JUMP_EVENT, handleProjectJumpEvent);
    };
  }, [ handleSidebarProjectJump ]);
  const focusedSessionId = useMemo(
    () => Object.values(sessionsById).find((session) => session.isFocused)?.sessionId,
    [ sessionsById ],
  );
  const postSidebarWakeScrollLog = useEffectEvent(
    (event: string, targetSessionId: string, details: Record<string, unknown>) => {
      postSidebarDebugLog(`repro.sidebarWakeScroll.${event}`, {
        ...details,
        ...summarizeSidebarWakeScrollOrderState({
          activeSessionsSortMode,
          displayedWorkspaceGroupIds,
          displayedWorkspaceSessionIdsByGroup,
          focusedSessionId: targetSessionId,
          groupsById,
          revision,
          sessionsById,
        }),
        ...summarizeSidebarWakeScrollRenderedSlots(
          sessionGroupsContentRef.current ?? document,
          targetSessionId,
        ),
      });
    },
  );
  const focusSidebarSessionSlot = useEffectEvent((slotNumber: number) => {
    /*
     * CDXC:Hotkeys 2026-06-05-20:53:
     * Cmd+1..9 must target sessions by the order of rows currently shown in the sidebar. Flatten the rendered Quick, Projects, and Remote project rows after group collapse and project Show less state so collapsed-project sessions are ignored instead of being selected from hidden inventory order.
     *
     * CDXC:Hotkeys 2026-06-05-21:17:
     * A user repro showed the state-derived slot list could reserve a number for a hidden row, so Cmd+5 selected the sixth visible session and Cmd+6 jumped much lower. Resolve the slot list from the rendered session-card DOM rows at key time so numbering follows the sidebar exactly as shown.
     */
    const root = sessionGroupsContentRef.current ?? document;
    const sessionId =
      slotNumber === 0 || slotNumber === -1
        ? resolveAdjacentRenderedSidebarSessionSlotId({
          direction: slotNumber === 0 ? 1 : -1,
          focusedSessionId,
          slots: readRenderedSidebarSessionSlots(root),
        })
        : resolveVisibleSidebarSessionSlotId({
          focusedSessionId,
          slotNumber,
          visibleSessionIds: readRenderedSidebarSessionSlotIds(root),
        });
    if (!sessionId) {
      return;
    }

    const groupId = findSessionGroupId(displayedWorkspaceSessionIdsByGroup, sessionId);
    if (groupId) {
      applyLocalFocus(groupId, sessionId);
    }
    vscode.postMessage({
      sessionId,
      type: "focusSession",
    });
  });
  const runGhostexHotkeyAction = useEffectEvent((actionId: string) => {
    const action = getghostexHotkeyActionById(actionId);
    if (!action) {
      return;
    }

    if (action.kind === "focusSessionSlot") {
      dismissAppModalForSidebarNavigation("SettingsDismissal:focusSessionHotkey");
      focusSidebarSessionSlot(action.slotNumber);
      return;
    }

    if (action.kind === "createSession") {
      requestNewSession();
      return;
    }

    if (action.kind === "openCommandPalette") {
      openCommandPalette(">");
      return;
    }

    if (action.kind === "openSessionSearchPalette") {
      openCommandPalette("");
      return;
    }

    if (action.kind === "openSettings") {
      openSidebarSettings();
      return;
    }

    if (action.kind === "openHotkeys") {
      openHotkeys();
      return;
    }

    if (action.kind === "moveSidebar") {
      moveSidebar();
      return;
    }

    if (action.kind === "toggleSidebarCollapsed") {
      toggleSidebarCollapsed();
      return;
    }

    if (
      action.kind === "focusedPaneAction" ||
      action.kind === "jumpToProject" ||
      action.kind === "switchWorkareaView"
    ) {
      vscode.postMessage({ actionId: action.id, type: "runGhostexHotkeyAction" });
    }
  });
  useLayoutEffect(() => {
    if (
      didApplyStartupEmptyChatsCollapseRef.current ||
      !hasAppliedHydrateRef.current
    ) {
      return;
    }

    didApplyStartupEmptyChatsCollapseRef.current = true;
    const hasChatSessions = displayedReferenceChatGroupIds.some(
      (groupId) => (authoritativeSessionIdsByGroup[ groupId ] ?? []).length > 0,
    );
    if (!hasChatSessions) {
      postSidebarCollapseStateLog("sectionAutoCollapsed", {
        reason: "startup-empty-quick",
        section: "quick",
      });
      /**
       * CDXC:SidebarReference 2026-05-10-15:51
       * Startup restores the user's section/group collapse state, except an empty
       * Combined Chats section must always begin collapsed so a project-only
       * workspace does not waste vertical space on an empty chat container.
       */
      setIsReferenceChatsCollapsed(true);
    }
  }, [ authoritativeSessionIdsByGroup, displayedReferenceChatGroupIds ]);

  useEffect(() => {
    /**
     * CDXC:SidebarReference 2026-05-10-15:51
     * Combined section headers, Recent Projects, and per-group collapse state are
     * UI navigation state. Persist them in the sidebar webview so restarting
     * ghostex keeps collapsed items collapsed and expanded items expanded.
     * CDXC:SidebarReference 2026-05-20-12:00
     * The first post-hydrate group-collapse reconcile seeds session-count baseline
     * without expand-on-count-increase so restored projects do not reopen on launch.
     *
     * CDXC:RemoteMachines 2026-06-09-19:02:
     * Remote machine section collapse belongs to the same UI navigation state as
     * Quick and Projects. Persist each machine independently by saved machine id.
     */
    const nextCollapseState = {
      collapsedGroupsById,
      collapsedRemoteMachineSectionsById,
      isRecentProjectsOpen,
      isReferenceChatsCollapsed,
      isReferenceProjectsCollapsed,
    };
    const writeResult = writeSidebarUiCollapseState(nextCollapseState);
    postSidebarCollapseStateLog("write", {
      ...summarizeSidebarUiCollapseState(nextCollapseState),
      groupCount: groupOrder.length,
      storedByteLength: writeResult.storedByteLength ?? 0,
      writeOk: writeResult.ok,
      writeReason: writeResult.reason ?? "stored",
    });
  }, [
    collapsedGroupsById,
    collapsedRemoteMachineSectionsById,
    isRecentProjectsOpen,
    isReferenceChatsCollapsed,
    isReferenceProjectsCollapsed,
  ]);

  const shouldShowSessionSearchEmptyState =
    isSessionSearchFiltering &&
    displayedWorkspaceGroupIds.length === 0 &&
    filteredPreviousSessions.length === 0;
  /**
   * CDXC:SidebarSearch 2026-05-08-11:26
   * A no-match search is its own result state. Hide the normal Chats and
   * Projects sections while it is visible so the empty placeholder has the
   * same visual role as the existing "No Quick Sessions" group placeholder.
   */
  const shouldHideReferenceSectionsForSearchEmptyState = shouldShowSessionSearchEmptyState;
  /**
   * CDXC:SidebarProjectsEmptyState 2026-06-18-06:01:
   * A sidebar with zero rendered project groups should guide first-time setup from the same left-aligned Projects empty-state block as the previous "No projects" placeholder. Tie the copy to the visible Projects label and its hover plus action instead of adding a separate card or fallback surface.
   */
  const hasAnySidebarProjectGroups =
    displayedReferenceProjectGroupIds.length > 0 ||
    Object.values(remoteProjectGroupIdsByMachineId).some((projectGroupIds) => projectGroupIds.length > 0);
  const referenceProjectsEmptyState = showGxserverUnavailableEmptyState ? (
    <div className="reference-sidebar-empty-state">
      Unable to load sessions.
      <br />
      Restart Ghostex to try again.
    </div>
  ) : hasGxserverUnavailablePlaceholder ? null : (
    <div className="reference-sidebar-empty-state">
      {hasAnySidebarProjectGroups ? (
        "No projects"
      ) : (
        <>
          No Projects Added.
          <br />
          <br />
          {"Hover over the Projects label and click on the plus button to add your first project and get started!"}
        </>
      )}
    </div>
  );
  const {
    hasOverflow: sessionGroupsHaveScrollableOverflow,
    showBottomGlow: showSessionGroupsBottomGlow,
    showTopGlow: showSessionGroupsTopGlow,
  } = useScrollGlowState(sessionGroupsContentRef);
  const sidebarSessionSearchResults = useMemo(
    () =>
      createSidebarSessionSearchResults({
        displayedWorkspaceGroupIds,
        displayedWorkspaceSessionIdsByGroup,
        filteredPreviousSessions,
      }),
    [
      displayedWorkspaceGroupIds,
      displayedWorkspaceSessionIdsByGroup,
      filteredPreviousSessions,
    ],
  );
  useEffect(() => {
    groupIdsRef.current = displayedReferenceProjectGroupIds;
  }, [ displayedReferenceProjectGroupIds ]);

  useEffect(() => {
    sessionIdsByGroupRef.current = displayedWorkspaceSessionIdsByGroup;
  }, [ displayedWorkspaceSessionIdsByGroup ]);

  useEffect(() => {
    const queryChanged =
      previousNormalizedSessionSearchQueryRef.current !== normalizedSessionSearchQuery;
    previousNormalizedSessionSearchQueryRef.current = normalizedSessionSearchQuery;

    if (
      !isSessionSearchOpen ||
      normalizedSessionSearchQuery.length === 0 ||
      sidebarSessionSearchResults.length === 0 ||
      queryChanged
    ) {
      setIsSessionSearchSelectionVisible(false);
    }

    setSelectedSessionSearchResult((previous) => {
      if (!isSessionSearchOpen || normalizedSessionSearchQuery.length === 0) {
        return previous;
      }

      if (sidebarSessionSearchResults.length === 0) {
        return undefined;
      }

      if (queryChanged) {
        return createSidebarSessionSearchSelection(sidebarSessionSearchResults[ 0 ]);
      }

      if (!previous) {
        return undefined;
      }

      return sidebarSessionSearchResults.some((result) =>
        isSidebarSessionSearchSelectionMatch(result, previous),
      )
        ? previous
        : createSidebarSessionSearchSelection(sidebarSessionSearchResults[ 0 ]);
    });
  }, [ isSessionSearchOpen, normalizedSessionSearchQuery, sidebarSessionSearchResults ]);

  useEffect(() => {
    if (!isSessionSearchSelectionVisible || !selectedSessionSearchResult) {
      return;
    }

    const selectedElement =
      selectedSessionSearchResult.kind === "session"
        ? document.querySelector<HTMLElement>(
          `[data-sidebar-session-id="${selectedSessionSearchResult.sessionId}"]`,
        )
        : document.querySelector<HTMLElement>(
          `[data-sidebar-history-id="${selectedSessionSearchResult.historyId}"]`,
        );
    selectedElement?.scrollIntoView({
      block: "nearest",
    });
  }, [ isSessionSearchSelectionVisible, selectedSessionSearchResult ]);

  useEffect(() => {
    if (!focusedSessionId || !sessionGroupsContentRef.current) {
      return;
    }

    /*
     * CDXC:SidebarWakeScrollDiagnostics 2026-06-16-02:20:
     * Wake-scroll repros need to prove whether the sidebar jumped because focus-following issued scrollIntoView or because the focused row moved in the displayed order. Log only session IDs, row indexes, sort mode, and geometry metrics while Debugging Mode is enabled.
     */
    let afterAnimationFrameId: number | undefined;
    let afterSettledTimeoutId: number | undefined;
    const sequence = ++focusedSessionScrollLogSequenceRef.current;
    const animationFrameId = window.requestAnimationFrame(() => {
      const scrollViewport = sessionGroupsContentRef.current;
      if (!scrollViewport) {
        postSidebarWakeScrollLog("focusedRowScrollSkipped", focusedSessionId, {
          reason: "missing-scroll-viewport",
          sequence,
        });
        return;
      }

      const focusedSessionElement = document.querySelector<HTMLElement>(
        `[data-sidebar-session-id="${focusedSessionId}"]`,
      );
      if (!focusedSessionElement) {
        postSidebarWakeScrollLog("focusedRowScrollSkipped", focusedSessionId, {
          reason: "missing-focused-row",
          sequence,
        });
        return;
      }

      const beforeScrollTop = scrollViewport.scrollTop;
      const beforeGeometry = summarizeSidebarWakeScrollGeometry(
        focusedSessionElement,
        scrollViewport,
      );
      const scrollIssued = scrollElementIntoViewIfNeeded(focusedSessionElement, scrollViewport);
      postSidebarWakeScrollLog("focusedRowScrollDecision", focusedSessionId, {
        beforeGeometry,
        scrollIssued,
        sequence,
      });

      if (!scrollIssued) {
        return;
      }

      afterAnimationFrameId = window.requestAnimationFrame(() => {
        const nextScrollViewport = sessionGroupsContentRef.current;
        const nextFocusedSessionElement = document.querySelector<HTMLElement>(
          `[data-sidebar-session-id="${focusedSessionId}"]`,
        );
        postSidebarWakeScrollLog("focusedRowScrollAfterFrame", focusedSessionId, {
          afterGeometry: nextScrollViewport && nextFocusedSessionElement
            ? summarizeSidebarWakeScrollGeometry(nextFocusedSessionElement, nextScrollViewport)
            : undefined,
          scrollDeltaTop: nextScrollViewport ? nextScrollViewport.scrollTop - beforeScrollTop : undefined,
          sequence,
        });
      });
      afterSettledTimeoutId = window.setTimeout(() => {
        const settledScrollViewport = sessionGroupsContentRef.current;
        const settledFocusedSessionElement = document.querySelector<HTMLElement>(
          `[data-sidebar-session-id="${focusedSessionId}"]`,
        );
        postSidebarWakeScrollLog("focusedRowScrollAfterSettled", focusedSessionId, {
          afterGeometry: settledScrollViewport && settledFocusedSessionElement
            ? summarizeSidebarWakeScrollGeometry(settledFocusedSessionElement, settledScrollViewport)
            : undefined,
          scrollDeltaTop: settledScrollViewport
            ? settledScrollViewport.scrollTop - beforeScrollTop
            : undefined,
          sequence,
        });
      }, 350);
    });

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      if (afterAnimationFrameId !== undefined) {
        window.cancelAnimationFrame(afterAnimationFrameId);
      }
      if (afterSettledTimeoutId !== undefined) {
        window.clearTimeout(afterSettledTimeoutId);
      }
    };
  }, [ focusedSessionId, focusedSessionRevealRequestId ]);

  const unlockCompletionSoundPlayback = useEffectEvent(() => {
    void prepareCompletionSoundPlayback((soundEvent, details) => {
      postSidebarDebugLog(soundEvent, details);
    });
  });

  const recordPointerDownSessionTarget = useEffectEvent((event: PointerEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      pointerDownSessionTargetRef.current = undefined;
      return;
    }

    const sessionElement = target.closest<HTMLElement>("[data-sidebar-session-id]");
    const groupElement = target.closest<HTMLElement>("[data-sidebar-group-id]");
    const sessionId = sessionElement?.dataset.sidebarSessionId;
    const groupId = groupElement?.dataset.sidebarGroupId;
    if (!sessionId || !groupId) {
      pointerDownSessionTargetRef.current = undefined;
      return;
    }

    pointerDownSessionTargetRef.current = {
      groupId,
      point: {
        x: event.clientX,
        y: event.clientY,
      },
      sessionId,
    };

    if (sessionsById[ sessionId ]?.isPinned === true) {
      /*
       * CDXC:PinnedSessions 2026-06-02-19:53:
       * Pinned project-session reorder regressions can fail before dnd-kit
       * emits a session drag. Persist one pointer-down breadcrumb for pinned
       * rows so support can distinguish "drag never started" from "drop guard
       * skipped sync" without logging titles, paths, commands, or user text.
       */
      postPinnedSessionReorderLog("pointerDown", {
        groupCollapsed: collapsedGroupsById[ groupId ] === true,
        pointer: summarizePointerEventForPinnedReorder(event),
        state: createPinnedSessionReorderDebugState(
          { groupId, kind: "session", sessionId },
          sessionIdsByGroupRef.current,
          effectiveSessionIdsByGroup,
          authoritativeSessionIdsByGroup,
          sessionsById,
        ),
        targetDom: createPinnedSessionDomDebugState(groupId, sessionId),
      });
    }
  });

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      recordPointerDownSessionTarget(event);
      unlockCompletionSoundPlayback();
    };
    const handleKeyDown = () => {
      pointerDownSessionTargetRef.current = undefined;
      unlockCompletionSoundPlayback();
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [ recordPointerDownSessionTarget, unlockCompletionSoundPlayback ]);

  const updateSessionDropIndicator = useEffectEvent(
    (event: Parameters<NonNullable<DragDropEventHandlers[ "onDragOver" ]>>[ 0 ]) => {
      const sourceData = getSidebarDropData(event.operation.source);
      if (sourceData?.kind === "group") {
        setPinnedSessionDropIndicator(undefined);
        setSessionDropIndicator(undefined);
        const resolvedGroupDropTarget = resolveGroupDropTargetFromPoint(
          getDragNativeEvent(event),
          groupIdsRef.current,
          groupsById,
          getSidebarDropData(event.operation.target),
          sourceData,
        );
        setGroupDropIndicator((previous) =>
          areSameGroupDropTarget(previous, resolvedGroupDropTarget)
            ? previous
            : resolvedGroupDropTarget,
        );
        return;
      }

      setGroupDropIndicator(undefined);
      if (sourceData?.kind !== "session") {
        setPinnedSessionDropIndicator(undefined);
        setSessionDropIndicator(undefined);
        return;
      }

      if (sessionsById[ sourceData.sessionId ]?.isPinned === true) {
        setSessionDropIndicator(undefined);
        const resolvedPinnedSessionDropTarget = resolvePinnedSessionDropTargetFromPoint(
          getDragNativeEvent(event),
          sourceData,
          sessionIdsByGroupRef.current,
          sessionsById,
        );
        const pinnedTargetLogKey = createPinnedSessionDropTargetLogKey(
          sourceData,
          resolvedPinnedSessionDropTarget,
        );
        if (pinnedSessionDropTargetLogKeyRef.current !== pinnedTargetLogKey) {
          pinnedSessionDropTargetLogKeyRef.current = pinnedTargetLogKey;
          postPinnedSessionReorderLog("targetChanged", {
            point: getClientPoint(getDragNativeEvent(event)),
            resolvedPinnedSessionDropTarget,
            sourceData,
            state: createPinnedSessionReorderDebugState(
              sourceData,
              sessionIdsByGroupRef.current,
              effectiveSessionIdsByGroup,
              authoritativeSessionIdsByGroup,
              sessionsById,
            ),
          });
        }
        setPinnedSessionDropIndicator((previous) =>
          areSameSessionDropTarget(previous, resolvedPinnedSessionDropTarget)
            ? previous
            : resolvedPinnedSessionDropTarget,
        );
        return;
      }

      setPinnedSessionDropIndicator(undefined);
      const resolvedSessionDropTarget = resolveSessionDropTargetFromPoint(
        getDragNativeEvent(event),
        sessionIdsByGroupRef.current,
        getSidebarDropData(event.operation.target),
        sourceData,
      );

      /*
       * CDXC:SidebarDragDrop 2026-06-19-11:12:
       * Manual session sorting should always show an insertion line while the
       * pointer is over another session row: above the row midpoint means
       * before, below the midpoint means after. Store the resolved drop target
       * directly instead of only highlighting a target project so the visual
       * indicator does not disappear when dnd-kit reports the broader group.
       */
      setSessionDropIndicator((previous) =>
        areSameSessionDropTarget(previous, resolvedSessionDropTarget ?? undefined)
          ? previous
          : resolvedSessionDropTarget ?? undefined,
      );
    },
  );

  const handleDragStart = ((event) => {
    setSidebarTooltipsSuppressedForDrag(true);
    const nativeEvent = getDragNativeEvent(event);
    const sourceData = getSidebarDropData(event.operation.source);
    const pointerDownSessionTarget = pointerDownSessionTargetRef.current;
    if (sourceData?.kind === "group") {
      const point = getClientPoint(nativeEvent);
      const group = groupsById[ sourceData.groupId ];
      const headerMetrics = point
        ? getProjectGroupDragHeaderMetrics(sourceData.groupId, point)
        : undefined;
      /**
       * CDXC:ProjectDragPreview 2026-05-21-11:45:
       * Project drag ghosts should be anchored to the live cursor and should
       * render only the project header, even when the source project is expanded.
       * Keep the source row in the list as the faint placeholder instead of
       * cloning the whole expanded project into the moving preview.
       *
       * CDXC:ProjectDragPreview 2026-05-28-12:35:
       * The project drag ghost should preserve the grabbed header button's
       * exact left edge and width, then move only on the vertical axis. Capture
       * the header row bounds at drag start and keep the pointer's initial
       * vertical offset so horizontal pointer drift never shifts the ghost.
       */
      setGroupDragPreview(
        point && headerMetrics && group?.projectContext
          ? {
            groupId: sourceData.groupId,
            icon: group.projectContext.worktree
              ? "branch"
              : collapsedGroupsById[ sourceData.groupId ] === true ||
                (authoritativeSessionIdsByGroup[ sourceData.groupId ] ?? []).length === 0
                ? "closed"
                : "open",
            isCollapsed: collapsedGroupsById[ sourceData.groupId ] === true,
            left: headerMetrics.left,
            pointerOffsetY: headerMetrics.pointerOffsetY,
            themeColor: group.projectContext.themeColor,
            title: group.title,
            top: headerMetrics.top,
            width: headerMetrics.width,
          }
          : undefined,
      );
    } else {
      setGroupDragPreview(undefined);
    }
    sessionPointerDragStateRef.current =
      sourceData?.kind === "session"
        ? createSessionPointerDragState(sourceData, pointerDownSessionTarget, nativeEvent)
        : undefined;
    pinnedSessionDropTargetLogKeyRef.current = undefined;
    setGroupDropIndicator(undefined);
    setPinnedSessionDropIndicator(undefined);
    setSessionDropIndicator(undefined);
    if (
      pointerDownSessionTarget &&
      sessionsById[ pointerDownSessionTarget.sessionId ]?.isPinned === true &&
      !(
        sourceData?.kind === "session" &&
        sourceData.groupId === pointerDownSessionTarget.groupId &&
        sourceData.sessionId === pointerDownSessionTarget.sessionId
      )
    ) {
      postPinnedSessionReorderLog("dragStartSourceMismatch", {
        point: getClientPoint(nativeEvent),
        pointerDownSessionTarget,
        sourceData,
        sourceKind: sourceData?.kind,
        state: createPinnedSessionReorderDebugState(
          {
            groupId: pointerDownSessionTarget.groupId,
            kind: "session",
            sessionId: pointerDownSessionTarget.sessionId,
          },
          sessionIdsByGroupRef.current,
          effectiveSessionIdsByGroup,
          authoritativeSessionIdsByGroup,
          sessionsById,
        ),
        targetData: getSidebarDropData(event.operation.target),
      });
    }
    if (sourceData?.kind === "session" && sessionsById[ sourceData.sessionId ]?.isPinned === true) {
      postPinnedSessionReorderLog("dragStart", {
        point: getClientPoint(nativeEvent),
        pointerDownSessionTarget,
        sourceData,
        state: createPinnedSessionReorderDebugState(
          sourceData,
          sessionIdsByGroupRef.current,
          effectiveSessionIdsByGroup,
          authoritativeSessionIdsByGroup,
          sessionsById,
        ),
        targetData: getSidebarDropData(event.operation.target),
      });
    }
    postSidebarDebugLog("session.dragStart", {
      nativeEventType: nativeEvent?.type,
      pointerDragState: sessionPointerDragStateRef.current,
      point: getClientPoint(nativeEvent),
      sourceData,
      targetData: getSidebarDropData(event.operation.target),
    });
  }) satisfies DragDropEventHandlers[ "onDragStart" ];

  const handleDragMove = ((event) => {
    const nativeEvent = getDragNativeEvent(event);
    updateGroupDragPreviewFromEvent(setGroupDragPreview, nativeEvent);
    updateSessionPointerDragState(sessionPointerDragStateRef.current, nativeEvent);
    updateSessionDropIndicator(event);
  }) satisfies DragDropEventHandlers[ "onDragMove" ];

  const handleDragOver = ((event) => {
    const nativeEvent = getDragNativeEvent(event);
    updateGroupDragPreviewFromEvent(setGroupDragPreview, nativeEvent);
    updateSessionPointerDragState(sessionPointerDragStateRef.current, nativeEvent);
    updateSessionDropIndicator(event);
  }) satisfies DragDropEventHandlers[ "onDragOver" ];

  const handleDragEnd = ((event) => {
    setSidebarTooltipsSuppressedForDrag(false);
    setGroupDropIndicator(undefined);
    setGroupDragPreview(undefined);
    setPinnedSessionDropIndicator(undefined);
    setSessionDropIndicator(undefined);
    const currentGroupIds = groupIdsRef.current;
    const currentSessionIdsByGroup = sessionIdsByGroupRef.current;
    const authoritativeGroupIds = workspaceGroupIds;
    const previousSessionIdsByGroup = effectiveSessionIdsByGroup;

    const nativeEvent = getDragNativeEvent(event);
    const sourceData = getSidebarDropData(event.operation.source);
    const targetData = getSidebarDropData(event.operation.target);
    const sessionPointerDragState = sessionPointerDragStateRef.current;
    updateSessionPointerDragState(sessionPointerDragState, nativeEvent);
    sessionPointerDragStateRef.current = undefined;
    const resolvedSessionDropTarget =
      sourceData?.kind === "session"
        ? resolveSessionDropTargetFromPoint(
          nativeEvent,
          currentSessionIdsByGroup,
          targetData,
          sourceData,
        )
        : undefined;
    postSidebarDebugLog("session.dragEnd", {
      canceled: event.canceled,
      nativeEventType: nativeEvent?.type,
      pointerDragState: sessionPointerDragState,
      point: getClientPoint(nativeEvent),
      resolvedSessionDropTarget,
      sourceData,
      targetData,
    });
    if (!sourceData) {
      return;
    }

    if (sourceData.kind === "remote-machine") {
      if (event.canceled || targetData?.kind !== "remote-machine") {
        return;
      }
      moveRemoteMachineSection(sourceData.remoteMachineId, targetData.remoteMachineId);
      return;
    }

    if (sourceData.kind === "group") {
      if (event.canceled) {
        return;
      }

      const resolvedGroupDropTarget = resolveGroupDropTargetFromPoint(
        nativeEvent,
        currentGroupIds,
        groupsById,
        targetData,
        sourceData,
      );
      const isProjectGroupOrder =
        createProjectGroupOrderItems(currentGroupIds, groupsById).length === currentGroupIds.length;
      const nextGroupIds = resolvedGroupDropTarget
        ? moveGroupIdsByProjectDropTarget(
          currentGroupIds,
          sourceData.groupId,
          resolvedGroupDropTarget,
          groupsById,
        )
        : targetData?.kind === "group" && !isProjectGroupOrder
          ? move(currentGroupIds, event)
          : currentGroupIds;
      if (haveSameSessionOrder(authoritativeGroupIds, nextGroupIds)) {
        return;
      }

      vscode.postMessage({
        groupIds: nextGroupIds,
        type: "syncGroupOrder",
      });
      return;
    }

    if (sourceData.kind !== "session") {
      return;
    }

    if (sessionPointerDragState?.startPoint && !sessionPointerDragState.didMove) {
      if (sessionsById[ sourceData.sessionId ]?.isPinned === true) {
        postPinnedSessionReorderLog("dragEndIgnoredWithoutPointerMovement", {
          point: getClientPoint(nativeEvent),
          pointerDragState: sessionPointerDragState,
          sourceData,
        });
      }
      postSidebarDebugLog("session.dragEndIgnoredWithoutPointerMovement", {
        point: getClientPoint(nativeEvent),
        sourceData,
      });
      return;
    }

    if (event.canceled) {
      if (sessionsById[ sourceData.sessionId ]?.isPinned === true) {
        postPinnedSessionReorderLog("dragEndCanceled", {
          point: getClientPoint(nativeEvent),
          sourceData,
          targetData,
        });
      }
      return;
    }

    if (sessionsById[ sourceData.sessionId ]?.isPinned === true) {
      const resolvedPinnedSessionDropTarget = resolvePinnedSessionDropTargetFromPoint(
        nativeEvent,
        sourceData,
        currentSessionIdsByGroup,
        sessionsById,
      );
      postPinnedSessionReorderLog("dragEndResolved", {
        point: getClientPoint(nativeEvent),
        resolution: createPinnedSessionDropResolutionDebugState(
          nativeEvent,
          sourceData,
          currentSessionIdsByGroup,
          sessionsById,
        ),
        resolvedPinnedSessionDropTarget,
        resolvedSessionDropTarget,
        sourceData,
        state: createPinnedSessionReorderDebugState(
          sourceData,
          currentSessionIdsByGroup,
          previousSessionIdsByGroup,
          authoritativeSessionIdsByGroup,
          sessionsById,
        ),
        targetData,
      });
      if (!resolvedPinnedSessionDropTarget) {
        postPinnedSessionReorderLog("dragEndSkipped", {
          reason: "noPinnedDropTarget",
          sourceData,
          targetData,
        });
        return;
      }

      const previousPinnedSessionIds = (previousSessionIdsByGroup[ sourceData.groupId ] ?? []).filter(
        (sessionId) => sessionsById[ sessionId ]?.isPinned === true,
      );
      const nextPinnedSessionIds = movePinnedSessionIdsByDropTarget(
        previousPinnedSessionIds,
        sourceData.sessionId,
        resolvedPinnedSessionDropTarget,
      );
      if (
        haveSameSessionOrder(previousPinnedSessionIds, nextPinnedSessionIds) ||
        !haveSameSessionSet(previousPinnedSessionIds, nextPinnedSessionIds)
      ) {
        postPinnedSessionReorderLog("dragEndSkipped", {
          nextPinnedSessionIds,
          previousPinnedSessionIds,
          reason: haveSameSessionOrder(previousPinnedSessionIds, nextPinnedSessionIds)
            ? "samePinnedOrder"
            : "pinnedSetMismatch",
          resolvedPinnedSessionDropTarget,
          sourceData,
        });
        return;
      }

      /**
       * CDXC:PinnedSessions 2026-05-28-14:29:
       * Dropping a pinned project session must persist exactly the row slot
       * indicated during drag. Resolve pinned drops from pointer position
       * against the pinned partition, then save pinned rows first while leaving
       * non-pinned project sessions in their authoritative order.
       */
      const nextSessionIds = createPinnedFirstSessionOrder(
        (authoritativeSessionIdsByGroup[ sourceData.groupId ] ?? []).length > 0
          ? (authoritativeSessionIdsByGroup[ sourceData.groupId ] ?? [])
          : (previousSessionIdsByGroup[ sourceData.groupId ] ?? []),
        nextPinnedSessionIds,
        sessionsById,
      );
      vscode.postMessage({
        groupId: sourceData.groupId,
        sessionIds: nextSessionIds,
        type: "syncSessionOrder",
      });
      postPinnedSessionReorderLog("syncSessionOrderPosted", {
        nextPinnedSessionIds,
        nextSessionIds,
        previousPinnedSessionIds,
        resolvedPinnedSessionDropTarget,
        sourceData,
      });
      return;
    }

    if (resolvedSessionDropTarget === null) {
      return;
    }

    if (!targetData && resolvedSessionDropTarget === undefined) {
      return;
    }

    const nextSessionIdsByGroup =
      resolvedSessionDropTarget !== undefined
        ? moveSessionIdsByDropTarget(
          currentSessionIdsByGroup,
          sourceData.sessionId,
          resolvedSessionDropTarget,
        )
        : move(currentSessionIdsByGroup, event);
    const nextListedSessionIds = new Set(Object.values(nextSessionIdsByGroup).flat());
    const omittedSessionIds = Object.values(currentSessionIdsByGroup)
      .flat()
      .filter((sessionId) => !nextListedSessionIds.has(sessionId));
    postSidebarDebugLog("session.dragComputedOrder", {
      currentSessionIdsByGroup,
      nextSessionIdsByGroup,
      omittedSessionIds,
      resolvedSessionDropTarget,
      sourceData,
      targetData,
    });
    const previousGroupId = findSessionGroupId(previousSessionIdsByGroup, sourceData.sessionId);
    const nextGroupId = findSessionGroupId(nextSessionIdsByGroup, sourceData.sessionId);
    if (!previousGroupId || !nextGroupId) {
      return;
    }

    if (previousGroupId !== nextGroupId) {
      if (sessionsById[ sourceData.sessionId ]?.isPinned === true) {
        /**
         * CDXC:PinnedSessions 2026-05-28-12:04:
         * Project pinned sessions are only reorderable inside their owning
         * project. A pinned drag that lands over another project must not turn
         * into a cross-project move just because pinned cards are draggable in
         * the reference sidebar.
         */
        return;
      }

      const targetIndex = nextSessionIdsByGroup[ nextGroupId ]?.indexOf(sourceData.sessionId);
      if (targetIndex == null || targetIndex < 0) {
        return;
      }

      vscode.postMessage({
        groupId: nextGroupId,
        sessionId: sourceData.sessionId,
        targetIndex,
        type: "moveSessionToGroup",
      });
      return;
    }

    if (!isManualActiveSessionsSort) {
      if (sessionsById[ sourceData.sessionId ]?.isPinned === true) {
        const authoritativeSessionIds = authoritativeSessionIdsByGroup[ nextGroupId ] ?? [];
        const previousSessionIds = previousSessionIdsByGroup[ nextGroupId ] ?? [];
        const nextDisplaySessionIds = nextSessionIdsByGroup[ nextGroupId ] ?? [];
        const nextPinnedSessionIds = nextDisplaySessionIds.filter(
          (sessionId) => sessionsById[ sessionId ]?.isPinned === true,
        );
        const previousPinnedSessionIds = previousSessionIds.filter(
          (sessionId) => sessionsById[ sessionId ]?.isPinned === true,
        );
        if (
          !haveSameSessionOrder(previousPinnedSessionIds, nextPinnedSessionIds) &&
          haveSameSessionSet(previousPinnedSessionIds, nextPinnedSessionIds)
        ) {
          /**
           * CDXC:PinnedSessions 2026-05-28-12:04:
           * Last-activity mode still needs pinned rows to be manually
           * rearrangeable within a project. Persist only the pinned partition
           * order, then keep non-pinned sessions in their authoritative order
           * so activity sorting remains display-only for the rest of the group.
           */
          vscode.postMessage({
            groupId: nextGroupId,
            sessionIds: createPinnedFirstSessionOrder(
              authoritativeSessionIds.length > 0 ? authoritativeSessionIds : previousSessionIds,
              nextPinnedSessionIds,
              sessionsById,
            ),
            type: "syncSessionOrder",
          });
        }
      }
      return;
    }

    const previousSessionIds = previousSessionIdsByGroup[ nextGroupId ] ?? [];
    const nextSessionIds = nextSessionIdsByGroup[ nextGroupId ] ?? [];
    if (haveSameSessionOrder(previousSessionIds, nextSessionIds)) {
      return;
    }

    vscode.postMessage({
      groupId: nextGroupId,
      sessionIds: nextSessionIds,
      type: "syncSessionOrder",
    });
  }) satisfies DragDropEventHandlers[ "onDragEnd" ];

  const openSidebarSettings = () => {
    setIsPinnedPromptsOpen(false);
    if (!settings) {
      vscode.postMessage({ type: "openSettings" });
      return;
    }
    setIsPreviousSessionsOpen(false);
    setIsDaemonSessionsOpen(false);
    setIsScratchPadOpen(false);
    setIsSessionSearchSelectionVisible(false);
    setIsSessionSearchOpen(false);
    setSessionSearchQuery("");
    openAppModal({ modal: "settings", type: "open" });
  };

  const openHotkeys = () => {
    /*
     * CDXC:Hotkeys 2026-06-19-00:35:
     * Cmd+. is the advertised Hotkeys shortcut in the far-right titlebar Settings menu. Route it to the same full-window app-modal host as Settings and Command Palette, closing transient sidebar drawers first so the shortcut opens one focused Hotkeys surface.
     */
    setIsPinnedPromptsOpen(false);
    setIsPreviousSessionsOpen(false);
    setIsDaemonSessionsOpen(false);
    setIsScratchPadOpen(false);
    setIsSessionSearchSelectionVisible(false);
    setIsSessionSearchOpen(false);
    setSessionSearchQuery("");
    openAppModal({ modal: "hotkeys", type: "open" });
  };

  const openCommandPalette = (initialQuery = ">") => {
    /**
     * CDXC:CommandPalette 2026-06-13-10:26:
     * Cmd+Shift+P should open the full-window app-modal command palette,
     * matching Settings instead of rendering a dialog inside the narrow
     * sidebar. Close transient sidebar drawers first so the centered palette is
     * the only active command surface.
     *
     * CDXC:CommandPalette 2026-06-13-22:18:
     * The shared palette searches sessions unless the input starts with `>`.
     * Launchers pass the initial query so Cmd+Shift+P and the Commands menu
     * open command-finding mode while Cmd+P opens session-search mode.
     *
     * CDXC:CommandPalette 2026-06-13-22:48:
     * Session-search mode mirrors project visibility: current project, active
     * projects, collapsed projects, then previous sessions. Include the
     * sidebar collapse map with each open request so the native modal host does
     * not have to infer UI-only state from rendered DOM.
   */
    setIsPinnedPromptsOpen(false);
    setIsPreviousSessionsOpen(false);
    setIsDaemonSessionsOpen(false);
    setIsScratchPadOpen(false);
    setIsSessionSearchSelectionVisible(false);
    setIsSessionSearchOpen(false);
    setSessionSearchQuery("");
    openAppModal({
      collapsedGroupsById: { ...collapsedGroupsById },
      initialQuery,
      modal: "commandPalette",
      type: "open",
    });
  };

  const closeSessionSearch = () => {
    setIsSessionSearchSelectionVisible(false);
    setIsSessionSearchOpen(false);
    setSessionSearchQuery("");
  };

  const closeTopmostSidebarOverlay = useEffectEvent(() => {
    if (gitCommitDraft) {
      closeGitCommitModal(gitCommitDraft.requestId);
      return true;
    }

    if (isDaemonSessionsOpen) {
      setIsDaemonSessionsOpen(false);
      return true;
    }

    if (isSettingsOpen) {
      setIsSettingsOpen(false);
      return true;
    }

    if (isPreviousSessionsOpen) {
      setIsPreviousSessionsOpen(false);
      return true;
    }

    if (isPinnedPromptsOpen) {
      setIsPinnedPromptsOpen(false);
      return true;
    }

    if (isScratchPadOpen) {
      setIsScratchPadOpen(false);
      return true;
    }

    if (isSessionSearchOpen) {
      closeSessionSearch();
      return true;
    }

    return false;
  });

  const toggleSessionSearch = () => {
    dismissAppModalForSidebarNavigation("SettingsDismissal:sidebarSearch");
    setIsDaemonSessionsOpen(false);
    setIsPinnedPromptsOpen(false);
    setIsPreviousSessionsOpen(false);
    setIsScratchPadOpen(false);
    setIsSessionSearchOpen((previous) => {
      if (previous) {
        setIsSessionSearchSelectionVisible(false);
        setSessionSearchQuery("");
      }

      return !previous;
    });
  };

  const restoreSearchedPreviousSession = (historyId: string) => {
    vscode.postMessage({
      historyId,
      type: "restorePreviousSession",
    });
    closeSessionSearch();
  };

  const deleteSearchedPreviousSession = (historyId: string) => {
    vscode.postMessage({
      historyId,
      type: "deletePreviousSession",
    });
  };

  const activateSelectedSessionSearchResult = useEffectEvent(() => {
    if (!selectedSessionSearchResult) {
      return false;
    }

    if (selectedSessionSearchResult.kind === "previous") {
      restoreSearchedPreviousSession(selectedSessionSearchResult.historyId);
      return true;
    }

    const selectedResult = sidebarSessionSearchResults.find((result) =>
      isSidebarSessionSearchSelectionMatch(result, selectedSessionSearchResult),
    );
    if (!selectedResult || selectedResult.kind !== "session") {
      return false;
    }

    dismissAppModalForSidebarNavigation("SettingsDismissal:sessionSearchActivate");
    applyLocalFocus(selectedResult.groupId, selectedResult.sessionId);
    vscode.postMessage({
      sessionId: selectedResult.sessionId,
      type: "focusSession",
    });
    return true;
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      const searchInput = searchInputRef.current;
      const isSearchInputTarget = searchInput !== null && target === searchInput;
      const recentProjectsSearchInput = recentProjectsSearchInputRef.current;
      const isRecentProjectsSearchInputTarget =
        recentProjectsSearchInput !== null && target === recentProjectsSearchInput;

      if (event.key === "Escape") {
        if (isSearchInputTarget && sessionSearchQuery.length > 0) {
          event.preventDefault();
          event.stopPropagation();
          setSessionSearchQuery("");
          searchInput.focus();
          return;
        }
        if (isRecentProjectsSearchInputTarget && recentProjectsQuery.length > 0) {
          event.preventDefault();
          event.stopPropagation();
          setRecentProjectsQuery("");
          recentProjectsSearchInput.focus();
          return;
        }
        if (!closeTopmostSidebarOverlay()) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        return;
      }

      const commandPaletteHotkeyActionId = getCommandPaletteHotkeyActionId(
        event,
        settings?.hotkeys,
      );
      if (commandPaletteHotkeyActionId && !hasActiveSidebarHotkeyRecorder()) {
        event.preventDefault();
        event.stopPropagation();
        openCommandPalette(commandPaletteHotkeyActionId === "openCommandPalette" ? ">" : "");
        return;
      }

      if (
        event.defaultPrevented ||
        gitCommitDraft !== undefined ||
        isDaemonSessionsOpen ||
        isPreviousSessionsOpen ||
        isScratchPadOpen ||
        (isEditableSidebarKeyboardTarget(target) && !isSearchInputTarget)
      ) {
        return;
      }

      if (
        isSessionSearchOpen &&
        isSidebarSessionSearchNavigationKey(event) &&
        (isSearchInputTarget || !isEditableSidebarKeyboardTarget(target))
      ) {
        const nextSelection = getNextSidebarSessionSearchSelection({
          currentSelection: selectedSessionSearchResult,
          direction: getSidebarSessionSearchNavigationDirection(event),
          results: sidebarSessionSearchResults,
        });
        if (!nextSelection) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        setSelectedSessionSearchResult(nextSelection);
        setIsSessionSearchSelectionVisible(true);
        return;
      }

      if (
        isSessionSearchOpen &&
        event.key === "Enter" &&
        (isSearchInputTarget || !isEditableSidebarKeyboardTarget(target))
      ) {
        if (!activateSelectedSessionSearchResult()) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        setIsSessionSearchSelectionVisible(false);
        return;
      }

      if (isSearchInputTarget) {
        return;
      }

      /*
       * CDXC:SidebarKeyboard 2026-05-26-15:29:
       * Ordinary typing while focus is on sidebar chrome should not open or edit session search.
       * Leave non-editable sidebar keypresses unhandled so the host can provide its default invalid-key feedback instead of capturing the user's text in the sidebar.
       */
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [
    activateSelectedSessionSearchResult,
    closeTopmostSidebarOverlay,
    gitCommitDraft,
    isDaemonSessionsOpen,
    isPreviousSessionsOpen,
    isScratchPadOpen,
    isSessionSearchOpen,
    recentProjectsQuery,
    selectedSessionSearchResult,
    sessionSearchQuery,
    sidebarSessionSearchResults,
  ]);

  const restoreRecentProject = (projectId: string) => {
    setRecentProjectsQuery("");
    setIsRecentProjectsOpen(false);
    setRecentProjectContextMenuPosition(undefined);
    vscode.postMessage({
      projectId,
      type: "restoreRecentProject",
    });
  };

  const openRecentProjectContextMenu = (
    event: ReactMouseEvent<HTMLElement>,
    projectId: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setRecentProjectContextMenuPosition({
      projectId,
      x: event.clientX,
      y: event.clientY,
    });
  };

  const copyRecentProjectPath = (projectId: string) => {
    setRecentProjectContextMenuPosition(undefined);
    vscode.postMessage({ projectId, type: "copyRecentProjectPath" });
  };

  const openRecentProjectInFinder = (projectId: string) => {
    setRecentProjectContextMenuPosition(undefined);
    vscode.postMessage({ projectId, type: "openRecentProjectInFinder" });
  };

  const removeRecentProject = (projectId: string) => {
    setRecentProjectContextMenuPosition(undefined);
    vscode.postMessage({ projectId, type: "removeRecentProject" });
  };

  const setActiveSessionsSortMode = (sortMode: SidebarActiveSessionsSortMode) => {
    vscode.postMessage({
      manualSessionIdsByGroup:
        sortMode === "manual" && activeSessionsSortMode !== "manual"
          ? Object.fromEntries(
            workspaceGroupIds.map((groupId) => [
              groupId,
              [ ...(effectiveSessionIdsByGroup[ groupId ] ?? []) ],
            ]),
          )
          : undefined,
      sortMode,
      type: "setActiveSessionsSortMode",
    });
  };

  const toggleActiveSessionsSortMode = () => {
    setActiveSessionsSortMode(
      activeSessionsSortMode === "manual" ? "lastActivity" : "manual",
    );
  };

  const toggleSessionTagFilter = (sessionTag: SidebarSessionTag) => {
    if (!enabledVisibleSidebarSessionTagSet.has(sessionTag)) {
      return;
    }
    setSelectedSessionTagFilters((current) =>
      current.includes(sessionTag)
        ? current.filter((tag) => tag !== sessionTag)
        : [ ...current, sessionTag ],
    );
  };

  const moveSidebar = () => {
    dismissAppModalForSidebarNavigation("SettingsDismissal:moveSidebar");
    vscode.postMessage({ type: "moveSidebarToOtherSide" });
  };

  const toggleSidebarCollapsed = () => {
    dismissAppModalForSidebarNavigation("SettingsDismissal:toggleSidebar");
    /**
     * CDXC:SidebarCollapse 2026-06-12-02:23:
     * Sidebar collapse is native chrome state. React requests the toggle, while
     * AppKit owns hiding the sidebar WebView, divider, and workspace border.
     */
    vscode.postMessage({ type: "toggleSidebarCollapsed" });
  };

  const pickWorkspaceFolder = () => {
    dismissAppModalForSidebarNavigation("SettingsDismissal:pickWorkspaceFolder");
    vscode.postMessage({ type: "pickWorkspaceFolder" });
  };

  const createFullWidthTerminalPane = () => {
    dismissAppModalForSidebarNavigation("SettingsDismissal:commandsPane");
    /**
     * CDXC:CommandsPanel 2026-05-13-17:02:
     * The legacy createFullWidthTerminalPane message is now the Commands panel toggle.
     *
     * CDXC:CommandsPanel 2026-06-18-23:28:
     * The Commands panel shortcut lives on the Recent Projects header after Settings moved out of the sidebar footer. Keep the same native command so the host behavior does not fork by launcher.
     */
    setIsPinnedPromptsOpen(false);
    setIsPreviousSessionsOpen(false);
    setIsDaemonSessionsOpen(false);
    setIsScratchPadOpen(false);
    setIsSessionSearchSelectionVisible(false);
    setIsSessionSearchOpen(false);
    setSessionSearchQuery("");
    vscode.postMessage({ type: "createFullWidthTerminalPane" });
  };

  const createReferenceChat = () => {
    dismissAppModalForSidebarNavigation("SettingsDismissal:createQuickTerminal");
    vscode.postMessage({ type: "createChat" });
  };

  const createReferenceBrowserChat = () => {
    dismissAppModalForSidebarNavigation("SettingsDismissal:createQuickBrowser");
    /**
     * CDXC:Chats 2026-05-08-11:53
     * The reference-style Chats section header owns its own hover actions,
     * separate from per-chat group rows. Its browser action must start a new
     * projectless browser chat instead of targeting the active code project.
     */
    vscode.postMessage({ type: "openBrowserChat" });
  };

  const createReferenceAgentChat = (agent: SidebarAgentButton) => {
    const quickGroupId = displayedReferenceChatGroupIds[ 0 ];
    if (!quickGroupId) {
      return;
    }

    dismissAppModalForSidebarNavigation("SettingsDismissal:createQuickAgent");
    /**
     * CDXC:QuickAgents 2026-06-08-18:25:
     * The Quick section header should expose the same selected-agent split picker as project headers. Launch through runSidebarAgent with the synthetic Quick group id so native creates a new projectless agent chat instead of targeting the active code project.
     */
    setPrimaryAgentLauncherId(agent.agentId);
    writePrimaryAgentLauncherId(agent.agentId);
    vscode.postMessage({
      agentId: agent.agentId,
      groupId: quickGroupId,
      type: "runSidebarAgent",
    });
  };

  const openConfigureAgentsModal = () => {
    dismissAppModalForSidebarNavigation("SettingsDismissal:configureAgents");
    openAppModal({ modal: "configureAgents", type: "open" });
  };

  const openReferenceAutomations = () => {
    dismissAppModalForSidebarNavigation("SettingsDismissal:automations");
    vscode.postMessage({ type: "showAutomationsComingSoonToast" });
  };

  const openReferenceMobile = () => {
    dismissAppModalForSidebarNavigation("SettingsDismissal:mobile");
    vscode.postMessage({ type: "openMobileBrowserChat" });
  };

  const openReferenceAgentsHub = () => {
    dismissAppModalForSidebarNavigation("SettingsDismissal:agentsHub");
    openAppModal({ modal: "agentsHub", type: "open" });
  };

  const togglePinnedPrompts = () => {
    dismissAppModalForSidebarNavigation("SettingsDismissal:pinnedPrompts");
    setIsDaemonSessionsOpen(false);
    setIsPreviousSessionsOpen(false);
    setIsScratchPadOpen(false);
    setIsSessionSearchSelectionVisible(false);
    setIsSessionSearchOpen(false);
    setSessionSearchQuery("");
    openAppModal({ modal: "pinnedPrompts", type: "open" });
  };

  const openPreviousSessions = () => {
    dismissAppModalForSidebarNavigation("SettingsDismissal:previousSessions");
    setIsPinnedPromptsOpen(false);
    setIsDaemonSessionsOpen(false);
    setIsScratchPadOpen(false);
    setIsSessionSearchSelectionVisible(false);
    setIsSessionSearchOpen(false);
    setSessionSearchQuery("");
    openAppModal({ modal: "previousSessions", type: "open" });
  };

  const searchPreviousSessionsByText = () => {
    dismissAppModalForSidebarNavigation("SettingsDismissal:previousSessionsTextSearch");
    setIsPinnedPromptsOpen(false);
    setIsDaemonSessionsOpen(false);
    setIsScratchPadOpen(false);
    setIsSessionSearchSelectionVisible(false);
    setIsSessionSearchOpen(false);
    setSessionSearchQuery("");
    vscode.postMessage({ type: "searchPreviousSessionsByText" });
  };

  return (
    <TooltipProvider delayDuration={TOOLTIP_DELAY_MS}>
      <div className="sidebar-reference-layout" data-reference-sidebar="true">
        {showCommandHotkeyOverlay ? <SidebarHotkeyOverlay hotkeys={settings?.hotkeys} /> : null}
        <SidebarReferenceTopChrome
          isSessionSearchOpen={isSessionSearchOpen}
          onCloseSearch={closeSessionSearch}
          onOpenAgentsHub={openReferenceAgentsHub}
          onOpenAutomations={openReferenceAutomations}
          onOpenMobile={openReferenceMobile}
          onOpenPreviousSessions={openPreviousSessions}
          onSearchPreviousSessionsByText={searchPreviousSessionsByText}
          onSearch={toggleSessionSearch}
          searchInputRef={searchInputRef}
          sessionSearchQuery={sessionSearchQuery}
          showBetaFeatures={settings?.showBetaFeatures === true}
          setSessionSearchQuery={setSessionSearchQuery}
        />
        <div
          className="stack"
          data-dimmed={String(isStartupInteractionBlocked)}
          data-sidebar-custom-theme={String(Boolean(normalizeWorkspaceThemeColor(customThemeColor)))}
          data-sidebar-theme={theme}
          onClickCapture={handleSidebarClickCapture}
          onDoubleClick={handleSidebarDoubleClick}
        >
          <section className="session-groups-panel" ref={sessionGroupsPanelRef}>
            <div className="session-groups-top">
              {null}
            </div>
            {/*
            CDXC:SidebarScroll 2026-06-19-13:28:
            Match Codex Desktop's sidebar by applying the bottom edge fade to
            the scroll container itself. Do not render a separate bottom shadow
            overlay; custom gradient sidebar colors make painted overlays read
            as gray.

            CDXC:SidebarScroll 2026-06-19-13:55:
            The Codex-style mask needs to apply at both scroll edges. Drive
            top and bottom fade availability from measured scroll state so
            transparent sticky project headers do not expose a painted shadow
            or unfaded overlap at the viewport edges.
          */}
            <div
              className="session-groups-scroll-shell"
              data-scroll-glow-bottom={String(showSessionGroupsBottomGlow)}
              data-scroll-glow-top={String(showSessionGroupsTopGlow)}
              data-scrollable-y={String(sessionGroupsHaveScrollableOverflow)}
            >
              <div
                className="session-groups-content vertical-scroll-fade-mask"
                data-scrollable-y={String(sessionGroupsHaveScrollableOverflow)}
                ref={sessionGroupsContentRef}
              >
                {/*
                CDXC:SidebarSessions 2026-05-17-00:11:
                Opening or closing one session must not remount every sidebar
                project. Keep DragDropProvider stable so sortable/droppable hooks
                update the dnd registry without forcing all project rows to
                replay their entrance animation.
              */}
                <DragDropProvider
                  onDragEnd={handleDragEnd}
                  onDragMove={handleDragMove}
                  onDragOver={handleDragOver}
                  onDragStart={handleDragStart}
                  plugins={(plugins) => plugins.filter((plugin) => plugin !== Cursor)}
                  sensors={sensors}
                >
                  {!shouldHideReferenceSectionsForSearchEmptyState &&
                    displayedReferenceChatGroupIds.length > 0 ? (
                    <>
                      {/* CDXC:QuickSessions 2026-05-16-12:55: The projectless chat collection is user-facing as Quick in the reference sidebar while internal chat group semantics stay unchanged. */}
                      <SidebarReferenceSectionHeader
                        activeSessionsSortMode={activeSessionsSortMode}
                        agents={agents}
                        collapsed={isReferenceChatsCollapsed}
                        onCreateBrowserChat={createReferenceBrowserChat}
                        onCreateChat={createReferenceChat}
                        onConfigureAgents={openConfigureAgentsModal}
                        onFilterChats={toggleSessionSearch}
                        onRunAgent={createReferenceAgentChat}
                        onSetActiveSessionsSortMode={setActiveSessionsSortMode}
                        onToggleSessionTagFilter={toggleSessionTagFilter}
                        onToggleCollapsed={() => {
                          const nextCollapsed = !isReferenceChatsCollapsed;
                          postSidebarCollapseStateLog("sectionToggle", {
                            childGroupCount: displayedReferenceChatGroupIds.length,
                            collapsed: nextCollapsed,
                            section: "quick",
                          });
                          if (isReferenceChatsCollapsed) {
                            triggerReferenceSectionChildAnimation("quick");
                          }
                          setIsReferenceChatsCollapsed((previous) => !previous);
                        }}
                        primaryAgentId={primaryAgentLauncherId}
                        sectionKey="quick"
                        selectedSessionTagFilters={activeSelectedSessionTagFilters}
                        sessionTagListItems={sidebarSessionTagListItems}
                        title="Quick"
                      />
                      <div
                        aria-hidden={isReferenceChatsCollapsed}
                        className="group-list workspace-group-list reference-chat-group-list reference-sidebar-collapsible-body"
                        data-animate-children={String(referenceSectionChildAnimations.quick)}
                        data-collapsed={String(isReferenceChatsCollapsed)}
                      >
                        {displayedReferenceChatGroupIds.map((groupId, groupIndex) => (
                          <SessionGroupSection
                            autoEdit={autoEditingGroupId === groupId}
                            canClose={effectiveGroupIds.length > 1}
                            completionFlashNonceBySessionId={completionFlashNonceBySessionId}
                            draggingDisabled={!isManualActiveSessionsSort}
                            groupDropIndicator={groupDropIndicator}
                            groupId={groupId}
                            index={groupIndex}
                            isGroupDragPreviewSource={groupDragPreview?.groupId === groupId}
                            isCollapsed={false}
                            key={groupId}
                            onAutoEditHandled={() => setAutoEditingGroupId(undefined)}
                            onCollapsedChange={setGroupCollapsed}
                            onFocusRequested={focusSidebarSessionFromNavigation}
                            orderedSessionIds={displayedWorkspaceSessionIdsByGroup[ groupId ] ?? []}
                            pinnedSessionDropIndicator={pinnedSessionDropIndicator}
                            selectedSearchSessionId={
                              isSessionSearchSelectionVisible &&
                                selectedSessionSearchResult?.kind === "session"
                                ? selectedSessionSearchResult.sessionId
                                : undefined
                            }
                            enableProjectSessionListToggle={!isSessionSearchFiltering}
                            sessionDropIndicator={sessionDropIndicator}
                            sessionDraggingDisabled={!isManualActiveSessionsSort}
                            sessionTagListItems={sidebarSessionTagListItems}
                            showHeaderActions={true}
                            showSessionDropPositionIndicators={isManualActiveSessionsSort}
                            vscode={vscode}
                          />
                        ))}
                      </div>
                    </>
                  ) : null}
                  {!shouldHideReferenceSectionsForSearchEmptyState ? (
                    <SidebarReferenceSectionHeader
                      activeSessionsSortMode={activeSessionsSortMode}
                      actionsAlwaysVisible={displayedReferenceProjectGroupIds.length === 0}
                      bulkActionLabel={
                        displayedReferenceProjectGroupIds.length > 0
                          ? hasExpandedReferenceProjects
                            ? "Collapse All"
                            : "Expand Previous"
                          : undefined
                      }
                      collapsed={isReferenceProjectsCollapsed}
                      onAddRepository={() => {
                        dismissAppModalForSidebarNavigation("SettingsDismissal:addRepository");
                        openAppModal({ modal: "addRepository", type: "open" });
                      }}
                      onAddProject={pickWorkspaceFolder}
                      onBulkProjectToggle={
                        displayedReferenceProjectGroupIds.length > 0
                          ? () => {
                            postSidebarCollapseStateLog("projectBulkCommand", {
                              expandedProjectGroupCount:
                                displayedReferenceProjectGroupIds.length -
                                Object.keys(collapsedGroupsById).filter((groupId) =>
                                  displayedReferenceProjectGroupIds.includes(groupId),
                                ).length,
                              mode: hasExpandedReferenceProjects
                                ? "collapse-all"
                                : "expand-previous",
                              previousExpandedGroupCount:
                                previousExpandedReferenceProjectGroupIdsRef.current.length,
                              projectGroupCount: displayedReferenceProjectGroupIds.length,
                            });
                            if (isReferenceProjectsCollapsed && !hasExpandedReferenceProjects) {
                              triggerReferenceSectionChildAnimation("projects");
                            }
                            setIsReferenceProjectsCollapsed(false);
                            if (hasExpandedReferenceProjects) {
                              previousExpandedReferenceProjectGroupIdsRef.current =
                                displayedReferenceProjectGroupIds.filter(
                                  (groupId) => collapsedGroupsById[ groupId ] !== true,
                                );
                              setGroupsCollapsed(displayedReferenceProjectGroupIds, true);
                              return;
                            }

                            const previousExpandedProjectGroupIds =
                              previousExpandedReferenceProjectGroupIdsRef.current.filter(
                                (groupId) => displayedReferenceProjectGroupIds.includes(groupId),
                              );
                            setGroupsCollapsed(
                              previousExpandedProjectGroupIds.length > 0
                                ? previousExpandedProjectGroupIds
                                : displayedReferenceProjectGroupIds,
                              false,
                            );
                          }
                          : undefined
                      }
                      onSetActiveSessionsSortMode={setActiveSessionsSortMode}
                      onToggleSessionTagFilter={toggleSessionTagFilter}
                      onToggleCollapsed={() => {
                        const nextCollapsed = !isReferenceProjectsCollapsed;
                        postSidebarCollapseStateLog("sectionToggle", {
                          childGroupCount: displayedReferenceProjectGroupIds.length,
                          collapsed: nextCollapsed,
                          section: "projects",
                        });
                        if (isReferenceProjectsCollapsed) {
                          triggerReferenceSectionChildAnimation("projects");
                        }
                        setIsReferenceProjectsCollapsed((previous) => !previous);
                      }}
                      sectionKey="projects"
                      selectedSessionTagFilters={activeSelectedSessionTagFilters}
                      sessionTagListItems={sidebarSessionTagListItems}
                      title="Projects"
                    />
                  ) : null}
                  {!shouldHideReferenceSectionsForSearchEmptyState ? (
                    <div
                      aria-hidden={isReferenceProjectsCollapsed}
                      className="group-list workspace-group-list reference-project-group-list reference-sidebar-collapsible-body"
                      data-animate-children={String(referenceSectionChildAnimations.projects)}
                      data-collapsed={String(isReferenceProjectsCollapsed)}
                    >
                      {displayedReferenceProjectGroupIds.length > 0 ? (
                        displayedReferenceProjectGroupIds.map((groupId, groupIndex) => (
                          <SessionGroupSection
                            autoEdit={autoEditingGroupId === groupId}
                            canClose={effectiveGroupIds.length > 1}
                            completionFlashNonceBySessionId={completionFlashNonceBySessionId}
                            draggingDisabled={isSessionSearchOpen}
                            groupDropIndicator={groupDropIndicator}
                            groupId={groupId}
                            index={groupIndex}
                            isGroupDragPreviewSource={groupDragPreview?.groupId === groupId}
                            isCollapsed={collapsedGroupsById[ groupId ] === true}
                            key={groupId}
                            onAutoEditHandled={() => setAutoEditingGroupId(undefined)}
                            onCollapsedChange={setGroupCollapsed}
                            onFocusRequested={focusSidebarSessionFromNavigation}
                            orderedSessionIds={displayedWorkspaceSessionIdsByGroup[ groupId ] ?? []}
                            allowPinnedSessionReorder={!isManualActiveSessionsSort}
                            pinnedSessionDropIndicator={pinnedSessionDropIndicator}
                            selectedSearchSessionId={
                              isSessionSearchSelectionVisible &&
                                selectedSessionSearchResult?.kind === "session"
                                ? selectedSessionSearchResult.sessionId
                                : undefined
                            }
                            enableProjectSessionListToggle={!isSessionSearchFiltering}
                            sessionDropIndicator={sessionDropIndicator}
                            sessionDraggingDisabled={!isManualActiveSessionsSort}
                            sessionTagListItems={sidebarSessionTagListItems}
                            showHeaderActions={true}
                            showSessionDropPositionIndicators={true}
                            vscode={vscode}
                          />
                        ))
                      ) : (
                        referenceProjectsEmptyState
                      )}
                    </div>
                  ) : null}
                  {!shouldHideReferenceSectionsForSearchEmptyState && remoteMachines.length > 0 ? (
                    <div className="reference-remote-section-list">
                      {/*
	                     * CDXC:RemoteMachines 2026-06-02-23:47:
	                     * Saved Remote machines render as peer sidebar sections beside local Projects. Until the SSH/gxserver connection is active, each machine remains visible and exposes Reload instead of Add Project or Clone Repository.
	                     *
	                     * CDXC:RemoteMachines 2026-06-09-19:02:
	                     * Remote machine section rows must collapse like Quick and Projects and use the same section-header styling, including the visible chevron and hover actions.
	                     */}
                      {remoteMachines.map((machine, index) => (
                        <RemoteMachineSidebarSection
                          collapsed={collapsedRemoteMachineSectionsById[ machine.id ] === true}
                          index={index}
                          key={machine.id}
                          machine={machine}
                          onAddProject={() => {
                            dismissAppModalForSidebarNavigation("SettingsDismissal:remoteAddProject");
                            openAppModal({
                              modal: "remoteProjectPicker",
                              remoteMachineId: machine.id,
                              remoteMachineName: machine.name,
                              type: "open",
                            });
                          }}
                          onCloneRepository={() => {
                            dismissAppModalForSidebarNavigation("SettingsDismissal:remoteCloneRepository");
                            vscode.postMessage({
                              remoteMachineId: machine.id,
                              type: "openRemoteCloneRepository",
                            });
                          }}
                          onEdit={() => {
                            dismissAppModalForSidebarNavigation("SettingsDismissal:remoteEditSettings");
                            openAppModal({
                              initialRemoteMachineId: machine.id,
                              initialTab: "remote",
                              modal: "settings",
                              type: "open",
                            });
                          }}
                          onReconnect={() => {
                            dismissAppModalForSidebarNavigation("SettingsDismissal:remoteReconnect");
                            vscode.postMessage({
                              remoteMachineId: machine.id,
                              type: "reconnectRemoteMachine",
                            });
                          }}
                          projectGroupIds={remoteProjectGroupIdsByMachineId[ machine.id ] ?? []}
                          renderProjectGroup={(groupId, groupIndex) => (
                            <SessionGroupSection
                              autoEdit={false}
                              canClose={false}
                              completionFlashNonceBySessionId={completionFlashNonceBySessionId}
                              draggingDisabled={true}
                              groupId={groupId}
                              index={groupIndex}
                              isCollapsed={collapsedGroupsById[ groupId ] === true}
                              key={groupId}
                              onAutoEditHandled={() => undefined}
                              onCollapsedChange={setGroupCollapsed}
                              onFocusRequested={() => undefined}
                              orderedSessionIds={displayedWorkspaceSessionIdsByGroup[ groupId ] ?? []}
                              enableProjectSessionListToggle={!isSessionSearchFiltering}
                              projectHeaderActions="terminal-only"
                              sessionDraggingDisabled={true}
                              sessionTagListItems={sidebarSessionTagListItems}
                              showHeaderActions={true}
                              showSessionDropPositionIndicators={false}
                              vscode={vscode}
                            />
                          )}
                          onToggleCollapsed={() => {
                            const nextCollapsed =
                              collapsedRemoteMachineSectionsById[ machine.id ] !== true;
                            if (!nextCollapsed) {
                              triggerReferenceSectionChildAnimation("remote");
                            }
                            setRemoteMachineSectionCollapsed(machine.id, nextCollapsed);
                          }}
                          status={remoteMachineRuntimeStatuses[ machine.id ] ?? "disconnected"}
                        />
                      ))}
                    </div>
                  ) : null}
                  {groupDragPreview && typeof document !== "undefined"
                    ? createPortal(
                      <ProjectGroupDragGhost preview={groupDragPreview} />,
                      document.body,
                    )
                    : null}
                </DragDropProvider>
                {isSessionSearchFiltering ? (
                  <SidebarPreviousSessionsSearchGroup
                    onDeletePreviousSession={deleteSearchedPreviousSession}
                    onRestorePreviousSession={restoreSearchedPreviousSession}
                    previousSessions={filteredPreviousSessions}
                    selectedHistoryId={
                      isSessionSearchSelectionVisible &&
                        selectedSessionSearchResult?.kind === "previous"
                        ? selectedSessionSearchResult.historyId
                        : undefined
                    }
                    showDebugSessionNumbers={debuggingMode}
                  />
                ) : null}
                {shouldShowSessionSearchEmptyState ? (
                  <div
                    className="group-empty-drop-target session-search-empty-drop-target"
                    data-empty-space-blocking="true"
                  >
                    <div className="group-empty-state session-search-empty-state">
                      No current or previous sessions match that search.
                    </div>
                  </div>
                ) : displayedWorkspaceGroupIds.every(
                  (groupId) => (displayedWorkspaceSessionIdsByGroup[ groupId ] ?? []).length === 0,
                ) &&
                  !isSessionSearchOpen ? (
                  <div className="empty" data-empty-space-blocking="true"></div>
                ) : null}
              </div>
            </div>
          </section>
          {recentProjects.length > 0 ? (
            <section
              aria-label="Recent Projects"
              className="recent-projects-drawer"
              data-open={String(isRecentProjectsOpen)}
            >
              {/*
             * CDXC:RecentProjects 2026-05-04-14:25
             * Combined mode parks projects without surfaced sessions in a
             * bottom drawer. Clicking a row asks native to restore the full
             * project and only create a blank terminal when no sessions were
             * preserved.
             */}
              <div className="recent-projects-drawer-header reference-sidebar-nav-item">
                <button
                  aria-expanded={isRecentProjectsOpen}
                  className="recent-projects-drawer-toggle group-head"
                  data-collapsible="true"
                  onClick={() => {
                    postSidebarCollapseStateLog("sectionToggle", {
                      collapsed: !isRecentProjectsOpen,
                      recentProjectCount: recentProjects.length,
                      section: "recent-projects",
                    });
                    setRecentProjectContextMenuPosition(undefined);
                    setIsRecentProjectsOpen((previous) => !previous);
                  }}
                  type="button"
                >
                  <span className="group-title-wrap">
                    <span className="group-title-row">
                      <span
                        aria-hidden="true"
                        className="group-collapse-button section-titlebar-toggle"
                        data-collapsed={String(!isRecentProjectsOpen)}
                        data-has-idle-icon="true"
                      >
                        <span className="group-collapse-icon group-collapse-idle-icon section-titlebar-toggle-icon section-titlebar-toggle-idle-icon">
                          <IconHistory size={16} stroke={1.8} />
                        </span>
                        <IconCaretRightFilled
                          aria-hidden="true"
                          className="group-collapse-icon group-collapse-chevron-icon section-titlebar-toggle-icon section-titlebar-toggle-chevron-icon"
                          size={16}
                        />
                      </span>
                      <span className="group-title-handle">
                        <span className="recent-projects-drawer-title group-title section-titlebar-label">
                          Recent Projects
                        </span>
                      </span>
                    </span>
                  </span>
                </button>
                {/*
                  CDXC:CommandsPanel 2026-06-18-23:28:
                  Move the Commands Pane launcher from the removed sidebar Settings footer onto the Recent Projects header as a sibling hover action so the header toggle keeps valid button semantics.
                */}
                <button
                  aria-label="Show Commands Pane"
                  className="reference-sidebar-hover-action reference-sidebar-hover-action-tooltip reference-sidebar-commands-pane-action"
                  data-tooltip="Commands Pane"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    createFullWidthTerminalPane();
                  }}
                  type="button"
                >
                  <IconTerminal2 aria-hidden="true" size={15} stroke={1.9} />
                </button>
              </div>
              <div
                aria-hidden={!isRecentProjectsOpen}
                className="recent-projects-drawer-body"
                data-collapsed={String(!isRecentProjectsOpen)}
              >
                {/*
               * CDXC:SidebarSearch 2026-05-15-18:13:
               * Recent Projects search must reuse the same shell, input, and
               * icon classes as Search sessions so both boxes stay identical
               * in typography, border, radius, padding, and icon placement.
               */}
                <SidebarSessionSearchField
                  ariaLabel="Search recent projects"
                  autoComplete="off"
                  clearLabel="Clear recent projects search"
                  inputRef={recentProjectsSearchInputRef}
                  placeholder="Search projects"
                  query={recentProjectsQuery}
                  setQuery={setRecentProjectsQuery}
                  shellClassName="recent-projects-search"
                />
                <div
                  className="recent-projects-list vertical-scroll-fade-mask"
                  onPointerEnter={handleRecentProjectsListPointerMove}
                  onPointerLeave={handleRecentProjectsListPointerLeave}
                  onPointerMove={handleRecentProjectsListPointerMove}
                  onScrollCapture={handleRecentProjectsListScroll}
                  onWheelCapture={handleRecentProjectsListScroll}
                >
                  {filteredRecentProjects.length > 0 ? (
                    filteredRecentProjects.map((project) => (
                      <RecentProjectRow
                        isContextMenuOpen={
                          recentProjectContextMenuPosition?.projectId === project.projectId
                        }
                        isScrolling={isRecentProjectsListScrolling}
                        key={project.projectId}
                        onContextMenu={openRecentProjectContextMenu}
                        onRestore={restoreRecentProject}
                        pointerPointRef={recentProjectsPointerPointRef}
                        project={project}
                      />
                    ))
                  ) : (
                    <div className="recent-projects-empty">No projects match that search.</div>
                  )}
                </div>
              </div>
              {recentProjectContextMenuPosition ? (
                <SidebarContextMenuPortal
                  menuStyle={{
                    left: `${recentProjectContextMenuPosition.x}px`,
                    top: `${recentProjectContextMenuPosition.y}px`,
                  }}
                  onDismiss={() => setRecentProjectContextMenuPosition(undefined)}
                  vscode={vscode}
                >
                  {/*
                 * CDXC:RecentProjects 2026-05-27-07:04:
                 * Right-clicking a Recent Projects row should expose only the
                 * parked-project actions: Copy Path, Open Folder, then a
                 * separator before Remove Project.
                 *
                 * CDXC:RecentProjects 2026-06-04-13:39:
                 * User-facing filesystem actions should use Open Folder instead of Finder-specific wording while preserving the existing native reveal behavior.
                 */}
                  <button
                    className="session-context-menu-item"
                    onClick={() =>
                      copyRecentProjectPath(recentProjectContextMenuPosition.projectId)
                    }
                    role="menuitem"
                    type="button"
                  >
                    <IconCopy aria-hidden="true" className="session-context-menu-icon" size={14} />
                    Copy Path
                  </button>
                  <button
                    className="session-context-menu-item"
                    onClick={() =>
                      openRecentProjectInFinder(recentProjectContextMenuPosition.projectId)
                    }
                    role="menuitem"
                    type="button"
                  >
                    <IconFolderOpen
                      aria-hidden="true"
                      className="session-context-menu-icon"
                      size={14}
                    />
                    Open Folder
                  </button>
                  <div className="session-context-menu-divider" role="separator" />
                  <button
                    className="session-context-menu-item session-context-menu-item-danger"
                    onClick={() =>
                      removeRecentProject(recentProjectContextMenuPosition.projectId)
                    }
                    role="menuitem"
                    type="button"
                  >
                    <IconTrash aria-hidden="true" className="session-context-menu-icon" size={14} />
                    Remove Project
                  </button>
                </SidebarContextMenuPortal>
              ) : null}
            </section>
          ) : null}
          <GitCommitModal
            agents={agents}
            draft={
              gitCommitDraft ?? {
                confirmLabel: "Commit",
                description: "",
                changedFiles: [],
                requestId: "",
                showCommitMessage: true,
                suggestedBody: undefined,
                suggestedSubject: "",
              }
            }
            isOpen={gitCommitDraft !== undefined}
            fileDiffDraft={gitFileDiffDraft}
            onCancel={(requestId) => {
              closeGitCommitModal(requestId);
            }}
            onConfirm={(requestId, message, options) => {
              setGitCommitDraft(undefined);
              setGitFileDiffDraft(undefined);
              vscode.postMessage({
                agentId: options.agentId,
                commitOnNewRef: options.commitOnNewRef,
                deleteWorktreeAfter: options.deleteWorktreeAfter,
                filePaths: options.filePaths,
                message,
                requestId,
                type: "confirmSidebarGitCommit",
              });
            }}
            onDirectMerge={(requestId, message, options) => {
              setGitCommitDraft(undefined);
              setGitFileDiffDraft(undefined);
              vscode.postMessage({
                agentId: options.agentId,
                deleteWorktreeAfter: options.deleteWorktreeAfter,
                filePaths: options.filePaths,
                message,
                requestId,
                type: "confirmSidebarGitDirectMerge",
              });
            }}
            onMultipleCommits={(requestId, agentId) => {
              setGitCommitDraft(undefined);
              setGitFileDiffDraft(undefined);
              vscode.postMessage({ agentId, requestId, type: "runSidebarGitMultipleCommits" });
            }}
            onOpenFileDiff={(filePath, requestId) => {
              vscode.postMessage({ filePath, requestId, type: "openSidebarGitChangedFileDiff" });
            }}
            theme={theme}
          />
          {buildStamp ? (
            <AppTooltip content="Copy build stamp">
              <button
                aria-label={`Copy build stamp ${buildStamp}`}
                className="copy-cursor"
                onClick={() => {
                  void navigator.clipboard.writeText(buildStamp).catch(() => { });
                }}
                style={DEBUG_BUILD_STAMP_STYLE}
                type="button"
              >
                {buildStamp}
              </button>
            </AppTooltip>
          ) : null}
        </div>
      </div>
    </TooltipProvider>
  );
}

function SidebarReferenceTopChrome({
  isSessionSearchOpen,
  onCloseSearch,
  onOpenAgentsHub,
  onOpenAutomations,
  onOpenMobile,
  onOpenPreviousSessions,
  onSearchPreviousSessionsByText,
  onSearch,
  searchInputRef,
  sessionSearchQuery,
  showBetaFeatures,
  setSessionSearchQuery,
}: {
  isSessionSearchOpen: boolean;
  onCloseSearch: () => void;
  onOpenAgentsHub: () => void;
  onOpenAutomations: () => void;
  onOpenMobile: () => void;
  onOpenPreviousSessions: () => void;
  onSearchPreviousSessionsByText: () => void;
  onSearch: () => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  sessionSearchQuery: string;
  showBetaFeatures: boolean;
  setSessionSearchQuery: (query: string) => void;
}) {
  /**
   * CDXC:SidebarReference 2026-05-08-09:11
   * Combined mode should visually match the provided app sidebar: native-style
   * window dots, disabled back/forward chrome, and large primary rows such as
   * Agents Hub, Automations, Mobile, and Search.
   *
   * CDXC:TitlebarActions 2026-05-11-02:46
   * Actions moved out of the sidebar header into the native titlebar beside
   * Open In. Keep this top chrome focused on navigation/search so the action
   * menu has one home and one split-button UX.
   *
   * CDXC:AgentsHub 2026-05-12-09:59
   * Agents Hub should remain the first primary sidebar destination so agent
   * configuration content is reached before secondary reference surfaces.
   *
   * CDXC:Mobile 2026-06-16-00:45:
   * The primary sidebar needs a Mobile entry near other reference/setup
   * navigation. It should launch through the same fixed browser-chat path as
   * Plugins so mobile setup docs open outside the active code project.
   *
   * CDXC:Mobile 2026-06-16-01:23:
   * Mobile should open the Ghostex download page, not the GitHub README anchor,
   * because the product site now owns mobile download routing.
   *
   * CDXC:Automations 2026-06-16-00:47:
   * Automations should sit above Mobile in the primary sidebar.
   * Until the feature is ready, clicking it shows a native app toast instead of
   * opening another surface.
   *
   * CDXC:SidebarReference 2026-06-16-01:23:
   * Plugins should no longer consume a primary sidebar row.
   *
   * CDXC:Plugins 2026-06-16-01:29:
   * Hide the Plugins sidebar affordance for now instead of keeping it as an
   * Agents Hub secondary action.
   *
   * CDXC:AgentsHub 2026-06-16-19:35:
   * Agents Hub is beta-only, so the primary sidebar entry should appear only
   * after Enable beta settings is enabled.
   *
   * CDXC:TitlebarSettingsMenu 2026-06-18-23:28:
   * Global Settings, Commands, Hotkeys, pet, prompt, scratch, Running, and Discord actions live in the far-right native titlebar menu. Keep the sidebar primary nav free of More/overflow controls.
   */
  return (
    <header className="reference-sidebar-top">
      <div aria-hidden="true" className="reference-sidebar-window-row">
        <span className="reference-sidebar-window-dot" data-window-dot="close" />
        <span className="reference-sidebar-window-dot" data-window-dot="minimize" />
        <span className="reference-sidebar-window-dot" data-window-dot="zoom" />
        <IconLayoutSidebar className="reference-sidebar-window-icon" size={16} stroke={1.9} />
        <IconArrowLeft className="reference-sidebar-window-icon" size={17} stroke={1.9} />
        <IconArrowRight className="reference-sidebar-window-icon" size={17} stroke={1.9} />
      </div>
      <nav aria-label="Sidebar primary navigation" className="reference-sidebar-primary-nav">
        {showBetaFeatures ? (
          <SidebarReferenceNavButton
            icon={IconUsersGroup}
            label="Agents Hub"
            onClick={onOpenAgentsHub}
          />
        ) : (
          <SidebarReferenceNavButton
            icon={IconClock}
            label="Automations"
            onClick={onOpenAutomations}
          />
        )}
        {showBetaFeatures ? (
          <SidebarReferenceNavButton
            icon={IconClock}
            label="Automations"
            onClick={onOpenAutomations}
          />
        ) : null}
        <SidebarReferenceNavButton
          icon={IconDeviceMobile}
          label="Mobile"
          onClick={onOpenMobile}
        />
        <SidebarReferenceSearchNavItem
          inputRef={searchInputRef}
          isOpen={isSessionSearchOpen}
          onCloseSearch={onCloseSearch}
          onOpenPreviousSessions={onOpenPreviousSessions}
          onSearchPreviousSessionsByText={onSearchPreviousSessionsByText}
          onSearch={onSearch}
          query={sessionSearchQuery}
          setQuery={setSessionSearchQuery}
        />
      </nav>
    </header>
  );
}

function SidebarReferenceSearchNavItem({
  inputRef,
  isOpen,
  onCloseSearch,
  onOpenPreviousSessions,
  onSearchPreviousSessionsByText,
  onSearch,
  query,
  setQuery,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  isOpen: boolean;
  onCloseSearch: () => void;
  onOpenPreviousSessions: () => void;
  onSearchPreviousSessionsByText: () => void;
  onSearch: () => void;
  query: string;
  setQuery: (query: string) => void;
}) {
  const hasQuery = query.length > 0;
  const clearQueryAndFocus = () => {
    setQuery("");
    inputRef.current?.focus();
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(query.length, query.length);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [ inputRef, isOpen, query.length ]);

  return (
    <div className="reference-sidebar-search-slot" data-active={String(isOpen)}>
      {isOpen ? (
        <div className="reference-sidebar-nav-item" data-inline-search="true">
          {/*
           * CDXC:SidebarSearch 2026-06-19-13:52:
           * The top Search row should not swap into a boxed search bar. When
           * active, the nav label itself becomes a transparent input with the
           * Search text as its placeholder so typing happens in-place.
           */}
          <div
            className="reference-sidebar-nav-button reference-sidebar-inline-search-row"
            onClick={() => {
              inputRef.current?.focus();
            }}
          >
            <IconSearch
              aria-hidden="true"
              className="reference-sidebar-nav-icon"
              size={15}
              stroke={1.9}
            />
            <input
              aria-label="Search current and previous sessions"
              className="reference-sidebar-inline-search-input"
              onBlur={() => {
                if (query.trim().length === 0) {
                  onCloseSearch();
                }
              }}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              placeholder="Search"
              ref={inputRef}
              spellCheck={false}
              type="text"
              value={query}
            />
            {hasQuery ? (
              <button
                aria-label="Clear session search"
                className="reference-sidebar-hover-action reference-sidebar-inline-search-clear"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  clearQueryAndFocus();
                }}
                type="button"
              >
                <IconX aria-hidden="true" size={15} stroke={1.9} />
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="reference-sidebar-nav-item">
          <SidebarReferenceNavButton icon={IconSearch} label="Search" onClick={onSearch} />
          <button
            aria-label="Search by Text"
            className="reference-sidebar-hover-action reference-sidebar-hover-action-tooltip reference-sidebar-text-search-button"
            data-tooltip="Search by Text"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onSearchPreviousSessionsByText();
            }}
            type="button"
          >
            {/*
             * CDXC:SidebarSearch 2026-06-07-12:37:
             * The Search row needs a second hover action immediately left of
             * Previous Sessions so users can launch direct previous-session
             * text search without opening the full history modal first.
             */}
            <IconFileSearch aria-hidden="true" size={15} stroke={1.9} />
          </button>
          <button
            aria-label="Previous Sessions"
            className="reference-sidebar-hover-action reference-sidebar-hover-action-tooltip reference-sidebar-previous-sessions-button"
            data-tooltip="Previous Sessions"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onOpenPreviousSessions();
            }}
            type="button"
          >
            {/*
             * CDXC:PreviousSessions 2026-05-09-17:49
             * The Search row's hover action uses IconHistoryToggle so the
             * affordance reads as opening historical sessions instead of a
             * generic list.
             */}
            <IconHistoryToggle aria-hidden="true" size={15} stroke={1.9} />
          </button>
        </div>
      )}
    </div>
  );
}

function SidebarReferenceNavButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: TablerIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      className="reference-sidebar-nav-button"
      onClick={onClick}
      size="sm"
      type="button"
      variant="ghost"
    >
      <Icon
        aria-hidden="true"
        className="reference-sidebar-nav-icon"
        data-icon="inline-start"
        size={15}
        stroke={1.9}
      />
      <span className="reference-sidebar-nav-label">{label}</span>
    </Button>
  );
}

function isNode(value: EventTarget | null): value is Node {
  return value instanceof Node;
}

function SidebarReferenceSectionHeader({
  activeSessionsSortMode,
  actionsAlwaysVisible,
  agents = [],
  bulkActionLabel,
  collapsed,
  onAddProject,
  onAddRepository,
  onBulkProjectToggle,
  onConfigureAgents,
  onCreateBrowserChat,
  onCreateChat,
  onEdit,
  onFilterChats,
  onReconnect,
  onRunAgent,
  onSetActiveSessionsSortMode,
  onToggleSessionTagFilter,
  onToggleCollapsed,
  primaryAgentId,
  sectionKey,
  selectedSessionTagFilters = [],
  sessionTagListItems,
  title,
}: {
  activeSessionsSortMode?: SidebarActiveSessionsSortMode;
  actionsAlwaysVisible?: boolean;
  agents?: readonly SidebarAgentButton[];
  bulkActionLabel?: string;
  collapsed: boolean;
  onAddProject?: () => void;
  onAddRepository?: () => void;
  onBulkProjectToggle?: () => void;
  onConfigureAgents?: () => void;
  onCreateBrowserChat?: () => void;
  onCreateChat?: () => void;
  onEdit?: () => void;
  onFilterChats?: () => void;
  onReconnect?: () => void;
  onRunAgent?: (agent: SidebarAgentButton) => void;
  onSetActiveSessionsSortMode?: (sortMode: SidebarActiveSessionsSortMode) => void;
  onToggleSessionTagFilter?: (tag: SidebarSessionTag) => void;
  onToggleCollapsed: () => void;
  primaryAgentId?: string;
  sectionKey: ReferenceSidebarSectionId;
  selectedSessionTagFilters?: readonly SidebarSessionTag[];
  sessionTagListItems?: readonly SidebarSessionTagListItem[];
  title: string;
}) {
  /**
   * CDXC:SidebarReference 2026-05-08-01:41
   * Reference-mode Chats and Projects are collapsible section headers. Chats
   * exposes browser-chat and new-chat controls on hover, while Projects expose
   * clone-repository, add-project, and expand/collapse-all controls on hover so the compact
   * Codex.app-style list keeps management actions nearby.
   *
   * CDXC:AddRepository 2026-05-29-11:45:
   * The Projects header needs a Download-icon Clone Repository action immediately
   * to the left of Add Project. It opens the full-window clone dialog while the
   * existing plus button remains the native folder picker for local projects.
   *
   * CDXC:SidebarReference 2026-05-08-02:21
   * The project bulk control is one stateful text button: "Collapse All" while
   * any project is expanded, then "Expand Previous" after it collapses the
   * previously expanded projects.
   *
   * CDXC:SidebarReference 2026-05-08-02:56
   * The bulk project button stays icon-only in the visible UI: use
   * IconArrowsDiagonal2 for Collapse All and IconArrowsDiagonalMinimize for
   * Expand Previous, while preserving the text labels for tooltips and
   * accessibility.
   *
   * CDXC:Tooltips 2026-05-20-10:05:
   * Quick and Projects section-header actions use the same local left-side
   * tooltip treatment as the reference-sidebar hover icons because portaled
   * Radix tooltips mis-anchor in the native sidebar webview. Quick exposes
   * filter, browser, terminal, and agent-picker actions beside the section label.
   *
   * CDXC:SidebarStickyHeaders 2026-05-20-09:55:
   * Section headers need a stable section key in the DOM so spacing can be
   * tuned for Projects and Quick independently without depending on visible
   * label text or adjacent markup shape.
   *
   * CDXC:ManualSessionSorting 2026-06-05-12:30:
   * Quick and Projects expose the same filter-shaped sort control in their
   * section headers. Last Active Sorting remains the default, while Manual
   * Sorting preserves the first visible last-active snapshot and later
   * user-defined row order.
   *
   * CDXC:QuickAgents 2026-06-08-18:25:
   * Quick exposes the same selected-agent split picker as project headers, with
   * Browser and Terminal as separate section-header actions to its left. Keep
   * the agent picker at the far right of the Quick header cluster so it aligns
   * with project-header agent placement. The main agent half launches the
   * selected provider and the chevron opens the shared agent list plus Configure.
   *
   * CDXC:RemoteMachines 2026-06-10-09:54:
   * Remote machine headers need a Tabler edit action immediately to the right
   * of Reload so users can jump from a machine section to that machine's saved
   * Settings -> Remote fields without using the global Settings entry point.
   *
   * CDXC:SidebarSortFilter 2026-06-15-21:24:
   * The section-header filter icon should use the stable hover label "Sort & Filter" even when the accessible label continues to expose the current sort mode and selected tag-filter count.
   */
  const [ sortMenuPosition, setSortMenuPosition ] = useState<HeaderSortMenuPosition>();
  const [ agentMenuPosition, setAgentMenuPosition ] = useState<HeaderSortMenuPosition>();
  const BulkProjectIcon =
    bulkActionLabel === "Collapse All" ? IconArrowsDiagonalMinimize : IconArrowsDiagonal2;
  const primaryAgent = agents.find((agent) => agent.agentId === primaryAgentId) ?? agents[ 0 ];
  const primaryAgentLabel = primaryAgent?.name ?? "Agent";
  const normalizedSessionTagListItems = useMemo(
    () => normalizeSidebarSessionTagListItems(sessionTagListItems),
    [ sessionTagListItems ],
  );
  const hasTagFilters = selectedSessionTagFilters.length > 0;
  const hasActions =
    onAddProject ||
    onAddRepository ||
    onBulkProjectToggle ||
    onConfigureAgents ||
    onCreateBrowserChat ||
    onCreateChat ||
    onEdit ||
    onFilterChats ||
    onReconnect ||
    onRunAgent ||
    onSetActiveSessionsSortMode ||
    onToggleSessionTagFilter;
  const sortModeLabel =
    activeSessionsSortMode === "manual" ? "Manual Sorting" : "Last Active Sorting";
  const filterLabel = hasTagFilters
    ? `${sortModeLabel}, ${selectedSessionTagFilters.length} tag filter${selectedSessionTagFilters.length === 1 ? "" : "s"
    }`
    : sortModeLabel;

  const openSortMenu = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    setAgentMenuPosition(undefined);
    setSortMenuPosition({
      left: bounds.left,
      top: bounds.bottom + 4,
    });
  };

  const openAgentMenu = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    setSortMenuPosition(undefined);
    setAgentMenuPosition({
      left: bounds.right - REFERENCE_SECTION_AGENT_MENU_WIDTH_PX,
      top: bounds.bottom + 6,
    });
  };

  const selectSortMode = (sortMode: SidebarActiveSessionsSortMode) => {
    setSortMenuPosition(undefined);
    onSetActiveSessionsSortMode?.(sortMode);
  };

  const runAgent = (agent: SidebarAgentButton | undefined) => {
    setAgentMenuPosition(undefined);
    if (!agent) {
      onConfigureAgents?.();
      return;
    }
    onRunAgent?.(agent);
  };

  return (
    <div
      className="reference-sidebar-section-row"
      data-actions-always-visible={String(actionsAlwaysVisible === true)}
      data-reference-section={sectionKey}
    >
      <button
        aria-expanded={!collapsed}
        className="reference-sidebar-section-heading"
        onClick={onToggleCollapsed}
        type="button"
      >
        <span className="reference-sidebar-section-title">{title}</span>
        <IconCaretRightFilled
          aria-hidden="true"
          className="reference-sidebar-section-chevron"
          size={13}
        />
      </button>
      {hasActions ? (
        <div className="reference-sidebar-section-actions">
          {onSetActiveSessionsSortMode || onToggleSessionTagFilter ? (
            <button
              aria-expanded={sortMenuPosition !== undefined}
              aria-haspopup="menu"
              aria-label={`Filter sessions: ${filterLabel}`}
              className="reference-sidebar-section-action reference-sidebar-section-sort-action reference-sidebar-hover-action-tooltip"
              data-selected={String(activeSessionsSortMode === "manual" || hasTagFilters)}
              data-tooltip="Sort & Filter"
              onClick={openSortMenu}
              type="button"
            >
              <IconFilter2 aria-hidden="true" size={14} stroke={1.9} />
            </button>
          ) : null}
          {onCreateBrowserChat ? (
            <button
              aria-label="Quick Browser Tab"
              className="reference-sidebar-section-action reference-sidebar-hover-action-tooltip"
              data-tooltip="Quick Browser Tab"
              onClick={onCreateBrowserChat}
              type="button"
            >
              <IconWorld aria-hidden="true" size={15} stroke={1.9} />
            </button>
          ) : null}
          {onCreateChat ? (
            <button
              aria-label="Quick Terminal"
              className="reference-sidebar-section-action reference-sidebar-hover-action-tooltip"
              data-tooltip="Quick Terminal"
              onClick={onCreateChat}
              type="button"
            >
              <IconTerminal2 aria-hidden="true" size={14} stroke={2} />
            </button>
          ) : null}
          {onRunAgent || onConfigureAgents ? (
            <div
              className="group-agent-split-button reference-sidebar-section-agent-picker"
              data-open={String(agentMenuPosition !== undefined)}
            >
              <button
                aria-label={`Create ${primaryAgentLabel}`}
                className="group-agent-main-button reference-sidebar-hover-action-tooltip"
                data-tooltip={`Create ${primaryAgentLabel}`}
                onClick={() => runAgent(primaryAgent)}
                type="button"
              >
                <ProjectAgentLauncherIcon agent={primaryAgent} />
              </button>
              <button
                aria-expanded={agentMenuPosition !== undefined}
                aria-haspopup="menu"
                aria-label="Select agent"
                className="group-agent-toggle-button reference-sidebar-hover-action-tooltip"
                data-open={String(agentMenuPosition !== undefined)}
                data-tooltip="Select Agent"
                onClick={openAgentMenu}
                type="button"
              >
                <IconChevronDown aria-hidden="true" size={13} stroke={2} />
              </button>
            </div>
          ) : null}
          {onBulkProjectToggle && bulkActionLabel ? (
            <button
              aria-label={bulkActionLabel}
              className="reference-sidebar-section-action reference-sidebar-section-bulk-project-action reference-sidebar-hover-action-tooltip"
              data-tooltip={bulkActionLabel}
              onClick={onBulkProjectToggle}
              type="button"
            >
              <BulkProjectIcon aria-hidden="true" size={14} stroke={1.9} />
            </button>
          ) : null}
          {onReconnect ? (
            <button
              aria-label={`Reload ${title}`}
              className="reference-sidebar-section-action reference-sidebar-hover-action-tooltip"
              data-tooltip="Reload"
              onClick={onReconnect}
              type="button"
            >
              <IconRefresh aria-hidden="true" size={14} stroke={1.9} />
            </button>
          ) : null}
          {onEdit ? (
            <button
              aria-label={`Edit ${title}`}
              className="reference-sidebar-section-action reference-sidebar-hover-action-tooltip"
              data-tooltip="Edit"
              onClick={onEdit}
              type="button"
            >
              <IconEdit aria-hidden="true" size={14} stroke={1.9} />
            </button>
          ) : null}
          {onAddRepository ? (
            <button
              aria-label="Clone Repository"
              className="reference-sidebar-section-action reference-sidebar-hover-action-tooltip"
              data-tooltip="Clone Repository"
              onClick={onAddRepository}
              type="button"
            >
              <IconDownload aria-hidden="true" size={14} stroke={2} />
            </button>
          ) : null}
          {onAddProject ? (
            <button
              aria-label="Add project"
              className="reference-sidebar-section-action reference-sidebar-hover-action-tooltip"
              data-tooltip="Add project"
              onClick={onAddProject}
              type="button"
            >
              <IconPlus aria-hidden="true" size={14} stroke={2} />
            </button>
          ) : null}
        </div>
      ) : null}
      {sortMenuPosition ? (
        <SidebarContextMenuPortal
          menuClassName="session-context-menu reference-sidebar-sort-menu"
          menuStyle={{
            left: sortMenuPosition.left,
            top: sortMenuPosition.top,
          }}
          onDismiss={() => setSortMenuPosition(undefined)}
        >
          {onSetActiveSessionsSortMode ? (
            <>
              <button
                aria-checked={activeSessionsSortMode !== "manual"}
                className="session-context-menu-item"
                onClick={() => selectSortMode("lastActivity")}
                role="menuitemradio"
                type="button"
              >
                <IconCheck
                  aria-hidden="true"
                  className="session-context-menu-icon"
                  data-visible={String(activeSessionsSortMode !== "manual")}
                  size={14}
                  stroke={2}
                />
                Last Active Sorting
              </button>
              <button
                aria-checked={activeSessionsSortMode === "manual"}
                className="session-context-menu-item"
                onClick={() => selectSortMode("manual")}
                role="menuitemradio"
                type="button"
              >
                <IconCheck
                  aria-hidden="true"
                  className="session-context-menu-icon"
                  data-visible={String(activeSessionsSortMode === "manual")}
                  size={14}
                  stroke={2}
                />
                Manual Sorting
              </button>
            </>
          ) : null}
          {onSetActiveSessionsSortMode && onToggleSessionTagFilter ? (
            <div className="session-context-menu-divider" role="separator" />
          ) : null}
          {onToggleSessionTagFilter
            ? normalizedSessionTagListItems.map((item) => {
              if (!item.visible) {
                return null;
              }
              if (item.type === "separator") {
                return item.enabled ? (
                  <div className="session-context-menu-divider" key={item.id} role="separator" />
                ) : null;
              }

              const isSelected = selectedSessionTagFilters.includes(item.tag);
              return (
                <button
                  aria-checked={isSelected}
                  className="session-context-menu-item reference-sidebar-tag-filter-item"
                  data-selected={String(isSelected)}
                  disabled={!item.enabled}
                  key={item.id}
                  onClick={() => onToggleSessionTagFilter(item.tag)}
                  role="menuitemcheckbox"
                  type="button"
                >
                  <SessionTagIcon
                    className="session-context-menu-icon session-tag-colored-icon"
                    fillFavorite
                    size={14}
                    stroke={1.8}
                    tag={item.tag}
                  />
                  {getSidebarSessionTagLabel(item.tag)}
                  <IconCheck
                    aria-hidden="true"
                    className="session-context-menu-trailing-icon reference-sidebar-tag-filter-check"
                    data-visible={String(isSelected)}
                    size={14}
                    stroke={2}
                  />
                </button>
              );
            })
            : null}
        </SidebarContextMenuPortal>
      ) : null}
      {agentMenuPosition ? (
        <SidebarContextMenuPortal
          menuClassName="session-context-menu group-agent-menu reference-sidebar-agent-menu"
          menuStyle={{
            left: `${agentMenuPosition.left}px`,
            top: `${agentMenuPosition.top}px`,
            width: `${REFERENCE_SECTION_AGENT_MENU_WIDTH_PX}px`,
          }}
          onDismiss={() => setAgentMenuPosition(undefined)}
        >
          {agents.map((agent) => (
            <button
              aria-pressed={primaryAgent?.agentId === agent.agentId}
              className="session-context-menu-item group-control-menu-item group-agent-menu-item"
              data-selected={String(primaryAgent?.agentId === agent.agentId)}
              key={agent.agentId}
              onClick={() => runAgent(agent)}
              role="menuitem"
              type="button"
            >
              <ProjectAgentLauncherIcon agent={agent} colorMode="brand" />
              <span className="group-agent-menu-label">{agent.name}</span>
              {primaryAgent?.agentId === agent.agentId ? (
                <IconCheck aria-hidden="true" className="session-context-menu-icon" size={14} />
              ) : null}
            </button>
          ))}
          {agents.length > 0 ? (
            <div className="session-context-menu-divider" role="separator" />
          ) : null}
          <button
            className="session-context-menu-item group-control-menu-item group-agent-menu-item"
            onClick={() => {
              setAgentMenuPosition(undefined);
              onConfigureAgents?.();
            }}
            role="menuitem"
            type="button"
          >
            <IconSettings aria-hidden="true" className="session-context-menu-icon" size={14} />
            <span className="group-agent-menu-label">Configure</span>
          </button>
        </SidebarContextMenuPortal>
      ) : null}
    </div>
  );
}

function RemoteMachineSidebarSection({
  collapsed,
  index,
  machine,
  onAddProject,
  onCloneRepository,
  onEdit,
  onReconnect,
  onToggleCollapsed,
  projectGroupIds,
  renderProjectGroup,
  status,
}: {
  collapsed: boolean;
  index: number;
  machine: RemoteMachineSettings;
  onAddProject: () => void;
  onCloneRepository: () => void;
  onEdit: () => void;
  onReconnect: () => void;
  onToggleCollapsed: () => void;
  projectGroupIds: readonly string[];
  renderProjectGroup: (groupId: string, groupIndex: number) => ReactNode;
    status: RemoteMachineRuntimeStatus[ "state" ];
}) {
  const isConnected = status === "connected";
  const sortable = useSortable({
    accept: "remote-machine",
    data: createRemoteMachineDragData(machine.id),
    id: `remote-machine:${machine.id}`,
    index,
    type: "remote-machine",
  });

  return (
    <div
      className="reference-remote-machine-section"
      data-disconnected={String(!isConnected)}
      data-dragging={String(Boolean(sortable.isDragging))}
      data-sidebar-remote-machine-id={machine.id}
      ref={sortable.ref}
    >
      <SidebarReferenceSectionHeader
        actionsAlwaysVisible={false}
        collapsed={collapsed}
        onAddProject={isConnected ? onAddProject : undefined}
        onAddRepository={isConnected ? onCloneRepository : undefined}
        onEdit={onEdit}
        onReconnect={isConnected ? undefined : onReconnect}
        onToggleCollapsed={onToggleCollapsed}
        sectionKey="remote"
        title={machine.name}
      />
      {isConnected ? (
        <div
          aria-hidden={collapsed}
          className="group-list workspace-group-list reference-project-group-list reference-sidebar-collapsible-body"
          data-animate-children="false"
          data-collapsed={String(collapsed)}
          data-sidebar-remote-project-list="true"
        >
          {projectGroupIds.length > 0 ? (
            projectGroupIds.map((groupId, groupIndex) => renderProjectGroup(groupId, groupIndex))
          ) : (
            <div className="reference-sidebar-empty-state">No projects</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function isRecentProjectRowUnderPointer(
  button: HTMLButtonElement | null,
  pointerPoint: PointerViewportPoint | undefined,
): boolean {
  if (!button || !pointerPoint) {
    return false;
  }
  const pointerElement = document.elementFromPoint(pointerPoint.clientX, pointerPoint.clientY);
  return pointerElement !== null && button.contains(pointerElement);
}

type RecentProjectRowProps = {
  isContextMenuOpen: boolean;
  isScrolling: boolean;
  onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>, projectId: string) => void;
  onRestore: (projectId: string) => void;
  pointerPointRef: RefObject<PointerViewportPoint | undefined>;
  project: SidebarRecentProject;
};

function RecentProjectRow({
  isContextMenuOpen,
  isScrolling,
  onContextMenu,
  onRestore,
  pointerPointRef,
  project,
}: RecentProjectRowProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [ isTooltipOpen, setIsTooltipOpen ] = useState(false);

  const setRecentProjectTooltipOpen = (nextOpen: boolean) => {
    if (
      nextOpen &&
      (isScrolling || !isRecentProjectRowUnderPointer(buttonRef.current, pointerPointRef.current))
    ) {
      return;
    }
    setIsTooltipOpen(nextOpen);
  };

  useEffect(() => {
    if (isScrolling) {
      setIsTooltipOpen(false);
    }
  }, [ isScrolling ]);

  return (
    <AppTooltip
      content={project.path}
      onOpenChange={setRecentProjectTooltipOpen}
      open={isTooltipOpen}
    >
      <button
        className="recent-projects-row group-head"
        data-context-menu-open={String(isContextMenuOpen)}
        onClick={() => onRestore(project.projectId)}
        onContextMenu={(event) => onContextMenu(event, project.projectId)}
        onPointerLeave={() => setIsTooltipOpen(false)}
        ref={buttonRef}
        type="button"
      >
        {/*
         * CDXC:RecentProjects 2026-06-14-15:45:
         * Recent Project rows show their path tooltip only during a normal hover. Scrolling closes the current tooltip immediately and never reopens it from stale pointer state.
         */}
        <span className="group-title-wrap">
          <span className="group-title-row">
            <span
              aria-hidden="true"
              className="recent-projects-row-icon group-collapse-button section-titlebar-toggle"
            >
              <IconFolder size={16} stroke={1.8} />
            </span>
            <span className="group-title-handle">
              <span className="recent-projects-row-title group-title section-titlebar-label">
                {project.title}
              </span>
            </span>
            <span className="group-title-spacer" />
            <span
              aria-label={`${project.sessionCount} preserved sessions`}
              className="recent-projects-session-count group-add-button"
            >
              {project.sessionCount}
            </span>
          </span>
        </span>
      </button>
    </AppTooltip>
  );
}

function createWorkspaceSessionIdsByGroup(
  workspaceGroupIds: readonly string[],
  sessionIdsByGroup: SessionIdsByGroup,
): SessionIdsByGroup {
  return Object.fromEntries(
    workspaceGroupIds.map((groupId) => [ groupId, sessionIdsByGroup[ groupId ] ?? [] ]),
  );
}

function findSessionGroupId(
  sessionIdsByGroup: SessionIdsByGroup,
  sessionId: string,
): string | undefined {
  return Object.entries(sessionIdsByGroup).find(([ , sessionIds ]) =>
    sessionIds.includes(sessionId),
  )?.[ 0 ];
}

function summarizeSidebarWakeScrollOrderState({
  activeSessionsSortMode,
  displayedWorkspaceGroupIds,
  displayedWorkspaceSessionIdsByGroup,
  focusedSessionId,
  groupsById,
  revision,
  sessionsById,
}: {
  activeSessionsSortMode: SidebarActiveSessionsSortMode;
  displayedWorkspaceGroupIds: readonly string[];
  displayedWorkspaceSessionIdsByGroup: SessionIdsByGroup;
  focusedSessionId: string;
  groupsById: SidebarGroupsById;
  revision: number;
  sessionsById: SidebarSessionsById;
}): Record<string, unknown> {
  const groupId = findSessionGroupId(displayedWorkspaceSessionIdsByGroup, focusedSessionId);
  const groupSessionIds = groupId ? displayedWorkspaceSessionIdsByGroup[ groupId ] ?? [] : [];
  const groupIndex = groupId ? displayedWorkspaceGroupIds.indexOf(groupId) : -1;
  const targetIndexInGroup = groupSessionIds.indexOf(focusedSessionId);
  const group = groupId ? groupsById[ groupId ] : undefined;
  const session = sessionsById[ focusedSessionId ];
  return {
    activeSessionsSortMode,
    displayedGroupCount: displayedWorkspaceGroupIds.length,
    firstSessionIdInGroup: groupSessionIds[ 0 ],
    focusedSessionId,
    groupId,
    groupIndex,
    groupIsChatCollection: group?.isChatCollection === true,
    groupIsProject: Boolean(group?.projectContext),
    groupIsRemote: Boolean(group?.remoteMachineContext),
    groupSessionCount: groupSessionIds.length,
    lastSessionIdInGroup: groupSessionIds.at(-1),
    revision,
    sessionActivity: session?.activity,
    sessionIsFocused: session?.isFocused,
    sessionIsLive: session?.isLive,
    sessionIsPinned: session?.isPinned,
    sessionIsSleeping: session?.isSleeping,
    sessionIsVisible: session?.isVisible,
    sessionKind: session?.sessionKind ?? session?.kind,
    sessionLastInteractionAt: session?.lastInteractionAt,
    sessionLifecycleState: session?.lifecycleState,
    sessionNativePaneState: session?.nativePaneState,
    sessionProviderSessionState: session?.providerSessionState,
    targetIndexInGroup,
    targetWindowSessionIds: createSidebarWakeScrollSessionIdWindow(
      groupSessionIds,
      targetIndexInGroup,
    ),
  };
}

function summarizeSidebarWakeScrollRenderedSlots(
  root: ParentNode,
  focusedSessionId: string,
): Record<string, unknown> {
  const slots = readRenderedSidebarSessionSlots(root);
  const renderedSessionIds = slots.map((slot) => slot.sessionId);
  const renderedIndex = renderedSessionIds.indexOf(focusedSessionId);
  return {
    renderedAwakeSlotCount: slots.filter((slot) => !slot.isSleeping).length,
    renderedFirstSessionId: renderedSessionIds[ 0 ],
    renderedIndex,
    renderedLastSessionId: renderedSessionIds.at(-1),
    renderedSleepingSlotCount: slots.filter((slot) => slot.isSleeping).length,
    renderedSlotCount: slots.length,
    renderedWindowSessionIds: createSidebarWakeScrollSessionIdWindow(
      renderedSessionIds,
      renderedIndex,
    ),
  };
}

function summarizeSidebarWakeScrollGeometry(
  focusedSessionElement: HTMLElement,
  scrollViewport: HTMLElement,
): Record<string, unknown> {
  const rowBounds = focusedSessionElement.getBoundingClientRect();
  const viewportBounds = scrollViewport.getBoundingClientRect();
  return {
    clientHeight: roundSidebarWakeScrollMetric(scrollViewport.clientHeight),
    isAboveViewport: rowBounds.top < viewportBounds.top,
    isBelowViewport: rowBounds.bottom > viewportBounds.bottom,
    isOutsideViewport: rowBounds.top < viewportBounds.top || rowBounds.bottom > viewportBounds.bottom,
    rowBottomRelativeToViewport: roundSidebarWakeScrollMetric(rowBounds.bottom - viewportBounds.top),
    rowHeight: roundSidebarWakeScrollMetric(rowBounds.height),
    rowTopRelativeToViewport: roundSidebarWakeScrollMetric(rowBounds.top - viewportBounds.top),
    scrollHeight: roundSidebarWakeScrollMetric(scrollViewport.scrollHeight),
    scrollTop: roundSidebarWakeScrollMetric(scrollViewport.scrollTop),
    viewportHeight: roundSidebarWakeScrollMetric(viewportBounds.height),
  };
}

function createSidebarWakeScrollSessionIdWindow(
  sessionIds: readonly string[],
  targetIndex: number,
  radius = 3,
): string[] {
  if (targetIndex < 0) {
    return [];
  }
  return sessionIds.slice(
    Math.max(0, targetIndex - radius),
    Math.min(sessionIds.length, targetIndex + radius + 1),
  );
}

function roundSidebarWakeScrollMetric(value: number): number {
  return Math.round(value * 100) / 100;
}

function haveSameSessionOrder(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((sessionId, index) => sessionId === right[ index ]);
}

function haveSameSessionSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const rightIds = new Set(right);
  return left.every((sessionId) => rightIds.has(sessionId));
}

function createPinnedFirstSessionOrder(
  previousSessionIds: readonly string[],
  pinnedSessionIds: readonly string[],
  sessionsById: Record<string, { isPinned?: boolean; } | undefined>,
): string[] {
  const pinnedSessionIdSet = new Set(pinnedSessionIds);
  const unpinnedSessionIds = previousSessionIds.filter(
    (sessionId) => sessionsById[ sessionId ]?.isPinned !== true,
  );

  return [
    ...pinnedSessionIds.filter((sessionId) => pinnedSessionIdSet.has(sessionId)),
    ...unpinnedSessionIds,
  ];
}

function movePinnedSessionIdsByDropTarget(
  previousPinnedSessionIds: readonly string[],
  sourceSessionId: string,
  target: SidebarSessionDropTarget,
): string[] {
  if (target.kind !== "session") {
    return [ ...previousPinnedSessionIds ];
  }

  return (
    moveSessionIdsByDropTarget(
      {
        [ target.groupId ]: [ ...previousPinnedSessionIds ],
      },
      sourceSessionId,
      target,
    )[ target.groupId ] ?? [ ...previousPinnedSessionIds ]
  );
}

function createPinnedSessionDropTargetLogKey(
  sourceData: Extract<ReturnType<typeof getSidebarDropData>, { kind: "session"; }>,
  target: SidebarSessionDropTarget | undefined,
): string {
  if (!target) {
    return `${sourceData.groupId}:${sourceData.sessionId}:none`;
  }

  if (target.kind === "group") {
    return `${sourceData.groupId}:${sourceData.sessionId}:${target.groupId}:group:${target.position}`;
  }

  return `${sourceData.groupId}:${sourceData.sessionId}:${target.groupId}:${target.sessionId}:${target.position}`;
}

function createPinnedSessionReorderDebugState(
  sourceData: Extract<ReturnType<typeof getSidebarDropData>, { kind: "session"; }>,
  currentSessionIdsByGroup: SessionIdsByGroup,
  effectiveSessionIdsByGroup: SessionIdsByGroup,
  authoritativeSessionIdsByGroup: SessionIdsByGroup,
  sessionsById: Record<
    string,
    { isPinned?: boolean; sessionId?: string; } | undefined
  >,
): Record<string, unknown> {
  const currentSessionIds = currentSessionIdsByGroup[ sourceData.groupId ] ?? [];
  const effectiveSessionIds = effectiveSessionIdsByGroup[ sourceData.groupId ] ?? [];
  const authoritativeSessionIds = authoritativeSessionIdsByGroup[ sourceData.groupId ] ?? [];
  const currentPinnedSessionIds = currentSessionIds.filter(
    (sessionId) => sessionsById[ sessionId ]?.isPinned === true,
  );
  const effectivePinnedSessionIds = effectiveSessionIds.filter(
    (sessionId) => sessionsById[ sessionId ]?.isPinned === true,
  );

  return {
    authoritativeSessionIds,
    currentPinnedSessionIds,
    currentSessionIds,
    effectivePinnedSessionIds,
    effectiveSessionIds,
    pinnedCount: currentPinnedSessionIds.length,
    sourceCurrentIndex: currentSessionIds.indexOf(sourceData.sessionId),
    sourceCurrentPinnedIndex: currentPinnedSessionIds.indexOf(sourceData.sessionId),
    sourceEffectiveIndex: effectiveSessionIds.indexOf(sourceData.sessionId),
    sourceEffectivePinnedIndex: effectivePinnedSessionIds.indexOf(sourceData.sessionId),
    sourceIsPinned: sessionsById[ sourceData.sessionId ]?.isPinned === true,
  };
}

function summarizePointerEventForPinnedReorder(event: PointerEvent): Record<string, unknown> {
  return {
    button: event.button,
    buttons: event.buttons,
    clientX: event.clientX,
    clientY: event.clientY,
    isPrimary: event.isPrimary,
    pointerType: event.pointerType,
  };
}

function createPinnedSessionDomDebugState(
  groupId: string,
  sessionId: string,
): Record<string, unknown> {
  const groupElement = getSidebarGroupElementById(groupId);
  const sessionElement = getTargetSessionElement(sessionId, undefined);
  const frameElement = sessionElement?.closest<HTMLElement>(".session-frame");

  return {
    group: {
      collapsed: groupElement?.dataset.collapsed,
      dragging: groupElement?.dataset.dragging,
      found: Boolean(groupElement),
      rect: summarizeElementRectForPinnedReorder(groupElement),
    },
    session: {
      dragging: sessionElement?.dataset.dragging,
      found: Boolean(sessionElement),
      frameFound: Boolean(frameElement),
      pinned: sessionElement?.dataset.pinned,
      rect: summarizeElementRectForPinnedReorder(sessionElement),
      visible: sessionElement?.dataset.visible,
    },
  };
}

function createPinnedSessionDropResolutionDebugState(
  nativeEvent: Event | undefined,
  sourceData: Extract<ReturnType<typeof getSidebarDropData>, { kind: "session"; }>,
  sessionIdsByGroup: SessionIdsByGroup,
  sessionsById: Record<string, { isPinned?: boolean; } | undefined>,
): Record<string, unknown> {
  const point = getClientPoint(nativeEvent);
  const groupElement = getSidebarGroupElementById(sourceData.groupId);
  const groupBounds = groupElement?.getBoundingClientRect();
  const groupSessionIds = sessionIdsByGroup[ sourceData.groupId ] ?? [];
  const pinnedSessionIds = groupSessionIds.filter(
    (sessionId) => sessionsById[ sessionId ]?.isPinned === true,
  );
  const targetMetrics = pinnedSessionIds
    .filter((sessionId) => sessionId !== sourceData.sessionId)
    .map((sessionId) => {
      const element = getTargetSessionElement(sessionId, point);
      const bounds = element?.getBoundingClientRect();
      return {
        elementFound: Boolean(element),
        height: bounds?.height,
        midpointY: bounds ? bounds.top + bounds.height / 2 : undefined,
        pinnedIndex: pinnedSessionIds.indexOf(sessionId),
        pointBeforeMidpoint:
          bounds && point ? point.y <= bounds.top + bounds.height / 2 : undefined,
        top: bounds?.top,
      };
    });
  const pointInsideGroup =
    point !== undefined &&
    groupBounds !== undefined &&
    point.y >= groupBounds.top &&
    point.y <= groupBounds.bottom;

  return {
    groupElementFound: Boolean(groupElement),
    groupRect: summarizeElementRectForPinnedReorder(groupElement),
    groupSessionCount: groupSessionIds.length,
    hasPoint: Boolean(point),
    pinnedCount: pinnedSessionIds.length,
    point,
    pointInsideGroup,
    sourceInPinnedSet: pinnedSessionIds.includes(sourceData.sessionId),
    sourcePinnedIndex: pinnedSessionIds.indexOf(sourceData.sessionId),
    targetMetricCount: targetMetrics.filter((metric) => metric.elementFound).length,
    targetMetrics,
  };
}

function summarizeElementRectForPinnedReorder(
  element: Element | null | undefined,
): Record<string, number> | undefined {
  if (!element) {
    return undefined;
  }

  const bounds = element.getBoundingClientRect();
  return {
    bottom: bounds.bottom,
    height: bounds.height,
    top: bounds.top,
  };
}

function findCreatedGroupId(
  previousGroups: readonly string[],
  nextGroups: readonly string[],
): string | undefined {
  const previousGroupIds = new Set(previousGroups);
  return nextGroups.find((groupId) => !previousGroupIds.has(groupId));
}

function resolveSessionDropTargetFromPoint(
  nativeEvent: Event | undefined,
  sessionIdsByGroup: SessionIdsByGroup,
  targetData: ReturnType<typeof getSidebarDropData>,
  sourceData: Extract<ReturnType<typeof getSidebarDropData>, { kind: "session"; }> | undefined,
) {
  const point = getClientPoint(nativeEvent);
  /*
   * CDXC:SidebarDragDrop 2026-06-19-11:12:
   * Prefer current pointer hit testing over dnd-kit's reported target so the
   * insertion line follows the hovered row midpoint continuously, including
   * the exact center of a session row.
   */
  const candidates = [
    point ? getSidebarSessionDropTargetAtPoint(document, point.x, point.y) : undefined,
    getSidebarSessionDropTargetFromEvent(nativeEvent),
    getSidebarSessionDropTargetFromDropData(targetData, point),
    getSidebarSessionDropTarget(targetData),
  ];

  for (const candidate of candidates) {
    if (!candidate || isSourceSessionDropTarget(candidate, sourceData)) {
      continue;
    }

    const groupSessionIds = sessionIdsByGroup[ candidate.groupId ];
    if (!groupSessionIds) {
      continue;
    }

    if (candidate.kind === "session" && !groupSessionIds.includes(candidate.sessionId)) {
      continue;
    }

    return candidate;
  }

  return null;
}

function resolvePinnedSessionDropTargetFromPoint(
  nativeEvent: Event | undefined,
  sourceData: Extract<ReturnType<typeof getSidebarDropData>, { kind: "session"; }>,
  sessionIdsByGroup: SessionIdsByGroup,
  sessionsById: Record<string, { isPinned?: boolean; } | undefined>,
): SidebarSessionDropTarget | undefined {
  const point = getClientPoint(nativeEvent);
  if (!point) {
    return undefined;
  }

  const groupElement = getSidebarGroupElementById(sourceData.groupId);
  const groupBounds = groupElement?.getBoundingClientRect();
  if (!groupBounds || point.y < groupBounds.top || point.y > groupBounds.bottom) {
    return undefined;
  }

  const groupSessionIds = sessionIdsByGroup[ sourceData.groupId ] ?? [];
  const pinnedSessionIds = groupSessionIds.filter(
    (sessionId) => sessionsById[ sessionId ]?.isPinned === true,
  );
  if (pinnedSessionIds.length < 2 || !pinnedSessionIds.includes(sourceData.sessionId)) {
    return undefined;
  }

  const targetSessionMetrics = pinnedSessionIds
    .filter((sessionId) => sessionId !== sourceData.sessionId)
    .flatMap((sessionId) => {
      const element = getTargetSessionElement(sessionId, point);
      return element
        ? [
          {
            bounds: element.getBoundingClientRect(),
            sessionId,
          },
        ]
        : [];
    });
  if (targetSessionMetrics.length === 0) {
    return undefined;
  }

  /*
   * CDXC:PinnedSessions 2026-05-28-14:29:
   * Pinned session drag feedback should be a stable insertion line within the
   * pinned partition. Base the active slot on pinned row midpoints only, not on
   * whichever full-project or unpinned-row droppable dnd-kit reports while the
   * pointer crosses row gaps.
   *
   * CDXC:SidebarDragDrop 2026-06-19-11:12:
   * The exact midpoint belongs to the lower half so a session row always shows
   * an insertion line: center/down is after, center/up is before.
   */
  for (const target of targetSessionMetrics) {
    if (point.y < target.bounds.top + target.bounds.height / 2) {
      return {
        groupId: sourceData.groupId,
        kind: "session",
        position: "before",
        sessionId: target.sessionId,
      };
    }
  }

  const lastTarget = targetSessionMetrics[ targetSessionMetrics.length - 1 ];
  return {
    groupId: sourceData.groupId,
    kind: "session",
    position: "after",
    sessionId: lastTarget.sessionId,
  };
}

function resolveGroupDropTargetFromPoint(
  nativeEvent: Event | undefined,
  groupIds: readonly string[],
  groupsById: SidebarProjectGroupLookup,
  targetData: ReturnType<typeof getSidebarDropData>,
  sourceData: Extract<ReturnType<typeof getSidebarDropData>, { kind: "group"; }> | undefined,
): SidebarGroupDropTarget | undefined {
  const point = getClientPoint(nativeEvent);
  const candidates = [
    getSidebarGroupDropTargetFromDropData(targetData, point),
    point ? getSidebarGroupDropTargetAtPoint(document, point.x, point.y) : undefined,
    getSidebarGroupDropTargetFromEvent(nativeEvent),
  ];

  for (const candidate of candidates) {
    if (!candidate || candidate.groupId === sourceData?.groupId) {
      continue;
    }

    if (!groupIds.includes(candidate.groupId)) {
      continue;
    }

    if (
      sourceData &&
      isNoOpGroupDropTarget(groupIds, sourceData.groupId, candidate, groupsById)
    ) {
      continue;
    }

    return candidate;
  }

  return undefined;
}

function areSameGroupDropTarget(
  left: SidebarGroupDropTarget | undefined,
  right: SidebarGroupDropTarget | undefined,
): boolean {
  return left?.groupId === right?.groupId && left?.position === right?.position;
}

function areSameSessionDropTarget(
  left: SidebarSessionDropTarget | undefined,
  right: SidebarSessionDropTarget | undefined,
): boolean {
  if (!left || !right || left.kind !== right.kind || left.groupId !== right.groupId) {
    return left === right;
  }

  if (left.kind === "session" && right.kind === "session") {
    return left.sessionId === right.sessionId && left.position === right.position;
  }

  return left.position === right.position;
}

function isSourceSessionDropTarget(
  candidate: SidebarSessionDropTarget,
  sourceData: Extract<ReturnType<typeof getSidebarDropData>, { kind: "session"; }> | undefined,
): boolean {
  return Boolean(
    sourceData &&
    candidate.kind === "session" &&
    candidate.groupId === sourceData.groupId &&
    candidate.sessionId === sourceData.sessionId,
  );
}

function getSidebarSessionDropTargetFromDropData(
  targetData: ReturnType<typeof getSidebarDropData>,
  point: ReturnType<typeof getClientPoint>,
): SidebarSessionDropTarget | undefined {
  if (targetData?.kind === "session") {
    const sessionElement = getTargetSessionElement(targetData.sessionId, point);
    if (!sessionElement) {
      return undefined;
    }

    const bounds = sessionElement.getBoundingClientRect();
    const relativeY = point?.y ?? bounds.top + bounds.height / 2;
    /*
     * CDXC:SidebarDragDrop 2026-06-19-11:12:
     * Dnd-kit may report a broad target while the pointer is around a row
     * midpoint. Resolve the explicit target with the same center/down-after
     * rule as point-based row hit testing so the line stays visible.
     */
    const position: "after" | "before" =
      relativeY >= bounds.top + bounds.height / 2 ? "after" : "before";
    return {
      groupId: targetData.groupId,
      kind: "session",
      position,
      sessionId: targetData.sessionId,
    };
  }

  if (targetData?.kind === "group") {
    const groupElement = document.querySelector<HTMLElement>(
      `[data-sidebar-group-id="${targetData.groupId}"]`,
    );
    if (!groupElement) {
      return undefined;
    }

    const bounds = groupElement.getBoundingClientRect();
    const relativeY = point?.y ?? bounds.top;
    const position: "end" | "start" = relativeY > bounds.top + bounds.height / 2 ? "end" : "start";
    return {
      groupId: targetData.groupId,
      kind: "group",
      position,
    };
  }

  return undefined;
}

function getSidebarGroupDropTargetFromDropData(
  targetData: ReturnType<typeof getSidebarDropData>,
  point: ReturnType<typeof getClientPoint>,
): SidebarGroupDropTarget | undefined {
  if (targetData?.kind !== "group") {
    return undefined;
  }

  const groupElement = getTargetGroupElement(targetData.groupId, point);
  if (!groupElement) {
    return undefined;
  }

  /*
   * CDXC:ProjectReorder 2026-05-22-22:18:
   * Dnd-kit target data can point at an expanded project container. Use the
   * same header-row bounds as point-based hit testing so the drop line does not
   * jump between above and below while the pointer moves through session rows.
   */
  const boundsElement = getSidebarGroupDropBoundsElement(groupElement);
  const bounds = boundsElement.getBoundingClientRect();
  const relativeY = point?.y ?? bounds.top + bounds.height / 2;
  return {
    groupId: targetData.groupId,
    position: relativeY > bounds.top + bounds.height / 2 ? "after" : "before",
  };
}

function isNoOpGroupDropTarget(
  groupIds: readonly string[],
  sourceGroupId: string,
  target: SidebarGroupDropTarget,
  groupsById: SidebarProjectGroupLookup,
): boolean {
  /*
   * CDXC:ProjectReorder 2026-05-22-22:18:
   * Do not show an insertion line for adjacent before/after targets that would
   * leave the project order unchanged on drop. The preview should only mark
   * committed position changes.
   *
   * CDXC:WorktreeProjectOrder 2026-05-25-12:38:
   * Worktree projects cannot be dropped outside their main-project family, and
   * a main-project drag is computed as a family move so its worktrees stay
   * directly underneath it in the same order.
   */
  return haveSameSessionOrder(
    groupIds,
    moveGroupIdsByProjectDropTarget(groupIds, sourceGroupId, target, groupsById),
  );
}

function moveGroupIdsByProjectDropTarget(
  groupIds: readonly string[],
  sourceGroupId: string,
  target: SidebarGroupDropTarget,
  groupsById: SidebarProjectGroupLookup,
): string[] {
  const projectGroupItems = createProjectGroupOrderItems(groupIds, groupsById);
  if (projectGroupItems.length !== groupIds.length) {
    return moveGroupIdsByDropTarget(groupIds, sourceGroupId, target);
  }

  return moveProjectsWithWorktrees(projectGroupItems, sourceGroupId, {
    orderId: target.groupId,
    position: target.position,
  }).map((project) => project.orderId);
}

function createProjectGroupOrderItems(
  groupIds: readonly string[],
  groupsById: SidebarProjectGroupLookup,
): SidebarProjectGroupOrderItem[] {
  return groupIds.flatMap((groupId) => {
    const projectContext = groupsById[ groupId ]?.projectContext;
    if (!projectContext) {
      return [];
    }

    return [
      {
        orderId: groupId,
        projectId: projectContext.editor.projectId,
        worktree: projectContext.worktree
          ? { parentProjectId: projectContext.worktree.parentProjectId }
          : undefined,
      },
    ];
  });
}

function getSidebarGroupDropBoundsElement(groupElement: HTMLElement): HTMLElement {
  return groupElement.querySelector<HTMLElement>(".group-head") ?? groupElement;
}

function getTargetSessionElement(
  sessionId: string,
  point: ReturnType<typeof getClientPoint>,
): HTMLElement | undefined {
  const selector = `[data-sidebar-session-id="${sessionId}"]`;
  if (point) {
    for (const element of document.elementsFromPoint(point.x, point.y)) {
      const sessionElement = element.closest<HTMLElement>(selector);
      if (sessionElement && sessionElement.dataset.dragging !== "true") {
        return sessionElement;
      }
    }
  }

  return Array.from(document.querySelectorAll<HTMLElement>(selector)).find(
    (sessionElement) => sessionElement.dataset.dragging !== "true",
  );
}

function getSidebarGroupElementById(groupId: string): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-sidebar-group-id]")).find(
    (groupElement) => groupElement.dataset.sidebarGroupId === groupId,
  );
}

function getTargetGroupElement(
  groupId: string,
  point: ReturnType<typeof getClientPoint>,
): HTMLElement | undefined {
  const selector = `[data-sidebar-group-id="${groupId}"]`;
  if (point) {
    for (const element of document.elementsFromPoint(point.x, point.y)) {
      const groupElement = element.closest<HTMLElement>(selector);
      if (groupElement && groupElement.dataset.dragging !== "true") {
        return groupElement;
      }
    }
  }

  return Array.from(document.querySelectorAll<HTMLElement>(selector)).find(
    (groupElement) => groupElement.dataset.dragging !== "true",
  );
}

function getDragNativeEvent(value: unknown): Event | undefined {
  return isObjectRecord(value) && value.nativeEvent instanceof Event
    ? value.nativeEvent
    : undefined;
}

function updateGroupDragPreviewFromEvent(
  setGroupDragPreview: (
    updater: (
      previous: SidebarGroupDragPreview | undefined,
    ) => SidebarGroupDragPreview | undefined,
  ) => void,
  nativeEvent: Event | undefined,
): void {
  const point = getClientPoint(nativeEvent);
  if (!point) {
    return;
  }

  setGroupDragPreview((previous) =>
    previous
      ? {
        ...previous,
        top: point.y - previous.pointerOffsetY,
      }
      : previous,
  );
}

function getProjectGroupDragHeaderMetrics(
  groupId: string,
  point: { x: number; y: number; },
): { left: number; pointerOffsetY: number; top: number; width: number; } | undefined {
  const groupElement = Array.from(
    document.querySelectorAll<HTMLElement>("[data-sidebar-group-id]"),
  ).find(
    (candidate) =>
      candidate.dataset.sidebarGroupId === groupId && candidate.dataset.dragging !== "true",
  );
  const headerElement = groupElement?.querySelector<HTMLElement>(".group-head");
  const headerRect = headerElement?.getBoundingClientRect();
  if (!headerRect) {
    return undefined;
  }

  return {
    left: headerRect.left,
    pointerOffsetY: point.y - headerRect.top,
    top: headerRect.top,
    width: headerRect.width,
  };
}

function createSessionPointerDragState(
  sourceData: Extract<ReturnType<typeof getSidebarDropData>, { kind: "session"; }>,
  pointerDownSessionTarget: SidebarPointerDownSessionTarget | undefined,
  nativeEvent: Event | undefined,
): SidebarSessionPointerDragState {
  const startPoint =
    pointerDownSessionTarget &&
      pointerDownSessionTarget.groupId === sourceData.groupId &&
      pointerDownSessionTarget.sessionId === sourceData.sessionId
      ? pointerDownSessionTarget.point
      : undefined;

  return {
    didMove: hasPointerDragMovedPastThreshold(startPoint, getClientPoint(nativeEvent)),
    startPoint,
  };
}

function updateSessionPointerDragState(
  pointerDragState: SidebarSessionPointerDragState | undefined,
  nativeEvent: Event | undefined,
): void {
  if (!pointerDragState || pointerDragState.didMove) {
    return;
  }

  pointerDragState.didMove = hasPointerDragMovedPastThreshold(
    pointerDragState.startPoint,
    getClientPoint(nativeEvent),
  );
}

function hasPointerDragMovedPastThreshold(
  startPoint: { x: number; y: number; } | undefined,
  currentPoint: { x: number; y: number; } | undefined,
): boolean {
  if (!startPoint || !currentPoint) {
    return false;
  }

  return (
    Math.hypot(currentPoint.x - startPoint.x, currentPoint.y - startPoint.y) >=
    SIDEBAR_POINTER_DRAG_REORDER_THRESHOLD_PX
  );
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getSidebarStartupNow(): number {
  if (typeof performance !== "undefined") {
    return performance.now();
  }

  return Date.now();
}

function getSidebarStartupElapsedMs(startedAt: number): number {
  return Math.round(getSidebarStartupNow() - startedAt);
}

function countSidebarSessions(groups: readonly { sessions: readonly unknown[]; }[]): number {
  return groups.reduce((total, group) => total + group.sessions.length, 0);
}

function postSidebarAgentIconBoundaryLog(
  vscode: WebviewApi,
  event: string,
  details: Record<string, unknown>,
): void {
  vscode.postMessage({
    details,
    event,
    type: "sidebarDebugLog",
  });
}

function summarizeSidebarAgentIconsFromGroups(
  groups: readonly {
    groupId: string;
    sessions: readonly {
      agentIcon?: string;
      sessionId: string;
      sessionKind?: string;
    }[];
  }[],
) {
  const sessions = groups.flatMap((group) =>
    group.sessions.map((session) => ({
      agentIcon: session.agentIcon,
      groupId: group.groupId,
      sessionId: session.sessionId,
      sessionKind: session.sessionKind,
    })),
  );

  return summarizeSidebarAgentIconSessions(sessions);
}

function summarizeSidebarAgentIconsFromStore(
  sessionsById: ReturnType<typeof useSidebarStore.getState>[ "sessionsById" ],
) {
  return summarizeSidebarAgentIconSessions(
    Object.values(sessionsById).map((session) => ({
      agentIcon: session.agentIcon,
      sessionId: session.sessionId,
      sessionKind: session.sessionKind,
    })),
  );
}

function summarizeSidebarAgentIconSessions(
  sessions: readonly {
    agentIcon?: string;
    groupId?: string;
    sessionId: string;
    sessionKind?: string;
  }[],
) {
  const agentSessions = sessions.filter((session) => Boolean(session.agentIcon));
  return {
    agentIconSessionCount: agentSessions.length,
    agentSessions: agentSessions.slice(0, 10),
    sessionCount: sessions.length,
  };
}

function createDisplayedSessionIdsByGroup({
  groupIds,
  query,
  selectedSessionTags,
  sessionIdsByGroup,
  sessionsById,
  shouldFilter,
}: {
  groupIds: readonly string[];
  query: string;
  selectedSessionTags: readonly SidebarSessionTag[];
  sessionIdsByGroup: SessionIdsByGroup;
    sessionsById: ReturnType<typeof useSidebarStore.getState>[ "sessionsById" ];
  shouldFilter: boolean;
}): SessionIdsByGroup {
  const displayedSessionIdsByGroup: SessionIdsByGroup = {};

  for (const groupId of groupIds) {
    const sessionIds = sessionIdsByGroup[ groupId ] ?? [];
    const queryFilteredSessionIds = !shouldFilter
      ? [ ...sessionIds ]
      : filterSessionIdsByQuery(sessionIds, sessionsById, query);
    displayedSessionIdsByGroup[ groupId ] = filterSessionIdsByTags(
      queryFilteredSessionIds,
      sessionsById,
      selectedSessionTags,
    );
  }

  return displayedSessionIdsByGroup;
}

function filterSessionIdsByTags(
  sessionIds: readonly string[],
  sessionsById: ReturnType<typeof useSidebarStore.getState>[ "sessionsById" ],
  selectedSessionTags: readonly SidebarSessionTag[],
): string[] {
  if (selectedSessionTags.length === 0) {
    return [ ...sessionIds ];
  }

  const selectedTagSet = new Set(selectedSessionTags);
  return sessionIds.filter((sessionId) => {
    const session = sessionsById[ sessionId ];
    const sessionTag = session ? getEffectiveSessionTag(session) : undefined;
    return sessionTag ? selectedTagSet.has(sessionTag) : false;
  });
}

function filterSessionIdsByQuery(
  sessionIds: readonly string[],
  sessionsById: ReturnType<typeof useSidebarStore.getState>[ "sessionsById" ],
  query: string,
): string[] {
  const sessions = sessionIds.flatMap((sessionId) => {
    const session = sessionsById[ sessionId ];
    return session ? [ session ] : [];
  });
  const matchedSessionIds = new Set(
    filterSidebarSessionItems(sessions, query).map((session) => session.sessionId),
  );

  return sessionIds.filter((sessionId) => matchedSessionIds.has(sessionId));
}

function createDisplayedGroupIds(
  groupIds: readonly string[],
  sessionIdsByGroup: SessionIdsByGroup,
  shouldFilter: boolean,
): string[] {
  if (!shouldFilter) {
    return [ ...groupIds ];
  }

  return groupIds.filter((groupId) => (sessionIdsByGroup[ groupId ] ?? []).length > 0);
}

function getCommandPaletteHotkeyActionId(
  event: KeyboardEvent,
  hotkeys: ghostexHotkeySettings | undefined,
): "openCommandPalette" | "openSessionSearchPalette" | undefined {
  const hotkeyText = keyboardEventToSidebarHotkeyText(event);
  if (!hotkeyText) {
    return undefined;
  }
  const actionId = getghostexHotkeyActionIdForKey(
    normalizeghostexHotkeySettings(hotkeys),
    hotkeyText,
  );
  return actionId === "openCommandPalette" || actionId === "openSessionSearchPalette"
    ? actionId
    : undefined;
}

function keyboardEventToSidebarHotkeyText(event: KeyboardEvent): string | undefined {
  const key = normalizeSidebarHotkeyKey(event.key);
  if (!key) {
    return undefined;
  }
  const parts = [
    event.metaKey ? "cmd" : "",
    event.ctrlKey ? "ctrl" : "",
    event.altKey ? "alt" : "",
    event.shiftKey ? "shift" : "",
    key,
  ].filter(Boolean);
  return normalizeHotkeyText(parts.length > 1 ? parts.join("+") : key);
}

function normalizeSidebarHotkeyKey(key: string): string | undefined {
  if (key.length === 1) {
    return key.toLowerCase();
  }
  switch (key) {
    case "ArrowUp":
      return "up";
    case "ArrowRight":
      return "right";
    case "ArrowDown":
      return "down";
    case "ArrowLeft":
      return "left";
    case "Alt":
    case "Control":
    case "Meta":
    case "Shift":
      return undefined;
    default:
      return key.toLowerCase();
  }
}

function hasActiveSidebarHotkeyRecorder(): boolean {
  return Boolean(document.querySelector("[data-hotkey-recorder='true'][data-recording='true']"));
}

function isSidebarSessionSearchNavigationKey(event: KeyboardEvent): boolean {
  return (
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Tab")
  );
}

function getSidebarSessionSearchNavigationDirection(event: KeyboardEvent): -1 | 1 {
  return event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey) ? -1 : 1;
}

function isEditableSidebarKeyboardTarget(target: Node): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return Boolean(target.closest("input, textarea, select, [contenteditable]"));
}
