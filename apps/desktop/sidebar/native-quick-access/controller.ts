/**
 * The Quick Access controller: the runtime half of the native window.
 *
 * It owns exactly what the four React modals owned (data requests, filters, ranking, grouping, selection and every
 * command) and publishes one resolved snapshot per frame instead of rendering a tree.
 *
 * CDXC:AppModal 2026-09-20 SEE-ALSO:
 * packages/shared/native-quick-access.ts is the contract this publishes, and
 * apps/desktop/src/app/window/quick_access/window.rs is the window that paints it and sends the commands handled here.
 */
import { postAppModalHostMessage } from '@/packages/core-ui/app-modal-host-bridge';
import { formatSidebarHotkeyLabel } from '@/packages/core-ui/hotkey-label';
import { sidebarStore } from '@/packages/core-ui/sidebar-store-model';
import { removePreviousSessionByHistoryId } from '@/packages/core-ui/previous-session-search';
import { normalizeghostexHotkeySettings } from '@/packages/shared/ghostex-hotkeys';
import { GXSERVER_FAVORITE_PROMPT_TAG_ID } from '@/packages/shared/gxserver-protocol';
import { trimPromptEditorTrailingSpaces } from '@/packages/shared/prompt-editor-text';
import { dismissDraftRecovery, importDraftRecovery } from '@/packages/core-ui/chat/session-chat-draft-recovery';
import {
  deleteStoredSessionChatDraft,
  listRecoveredSessionChatDrafts,
  reconcileSessionChatDraftsFromServer,
} from '@/packages/core-ui/chat/session-chat-draft-storage';
import {
  deleteSentSessionChatMessage,
  listSentSessionChatMessages,
  recordDeliveredSessionChatDrafts,
} from '@/packages/core-ui/chat/session-chat-sent-history';
import type { ExtensionToSidebarMessage, SidebarToExtensionMessage } from '@/packages/shared/session-grid-contract';
import type {
  NativeQuickAccessBridge,
  QuickAccessCommand,
  QuickAccessMenuItem,
  QuickAccessSnapshot,
  QuickAccessTabId,
  QuickAccessToolbar,
} from '@/packages/shared/native-quick-access';
import type { createGpuiSidebarRuntime } from '../gxserver-runtime';
import { buildCommandGroups, runCommandRow } from './commands';
import {
  ACTION_SEPARATOR,
  ACTIVATE_ACTION_ID,
  QUICK_ACCESS_ACTION_HOTKEYS,
  actionForHotkey,
  actionItem,
  tidyActionItems,
} from './row-actions';
import {
  activateRecentProject,
  buildProjectGroups,
  findRecentProject,
  recentProjectMenuItems,
  removeRecentProject,
  type RecentProjectsData,
} from './projects';
import {
  buildPromptGroups,
  createPromptsTabState,
  applyPromptsLauncherContext,
  findPrompt,
  nextPromptTagIds,
  promptEditorState,
  promptsEmptyCopy,
  promptsProjectSelect,
  promptsTagSelect,
  promptTagMenuItems,
  promptActions,
  promptBelongsToSession,
  hasSessionScope,
  promptProjectNames,
  recoveredDraftAsPrompt,
  recoveredDraftSessionKey,
  ALL_PROJECTS_VALUE,
  ALL_TAGS_VALUE,
  CURRENT_SESSION_VALUE,
  NO_PROJECT_VALUE,
  NO_TAG_VALUE,
  STASHED_PROMPT_TAG_COLORS,
  type PromptsTabState,
  type PromptsView,
} from './prompts';
import {
  buildSessionGroups,
  createSessionsTabState,
  sessionProjectSelect,
  sessionTagSelect,
  sessionsEmptyCopy,
  sessionsLoadingCopy,
  sessionsQueryKey,
  SESSIONS_PAGE_SIZE,
  SESSIONS_VISIBLE_WINDOW_MS,
  SESSION_TRANSCRIPT_SIZE_BATCH_SIZE,
  visibleSessionItems,
  type SessionScope,
  type SessionsTabState,
} from './sessions';

const TABS: { id: QuickAccessTabId; label: string; hotkey: string }[] = [
  { id: 'commands', label: 'Commands', hotkey: 'cmd+1' },
  { id: 'recentProjects', label: 'Projects', hotkey: 'cmd+2' },
  { id: 'recentSessions', label: 'Sessions', hotkey: 'cmd+3' },
  { id: 'savedPrompts', label: 'Saved Prompts', hotkey: 'cmd+4' },
];

const PLACEHOLDERS: Record<QuickAccessTabId, string> = {
  commands: 'Search commands...',
  recentProjects: 'Search projects...',
  recentSessions: 'Search sessions...',
  savedPrompts: 'Search saved prompts...',
};

const SESSIONS_SCOPE_TOGGLE_HOTKEY = 'alt+c';
const SESSIONS_QUERY_DEBOUNCE_MS = 200;
const STASH_PROMPT_HINT = `Press ${formatSidebarHotkeyLabel('alt+s')} while you're using an agent to stash your prompt (Local only for now)`;

export function connectNativeQuickAccess(runtime: ReturnType<typeof createGpuiSidebarRuntime>): () => void {
  const bridge = window.ghostexGpui as typeof window.ghostexGpui & NativeQuickAccessBridge;
  if (!bridge?.postNativeQuickAccessSnapshot) {
    throw new Error('The native Quick Access snapshot bridge is not installed.');
  }
  const send = (payload: unknown) => bridge.postNativeQuickAccessSnapshot!(JSON.stringify(payload));
  /*
   * CDXC:AppModal 2026-09-20 WHY:
   * Quick Access commands keep the exact route the React modal host used: every one of them
   * (`requestRecentProjects`, `requestStashedPrompts`, `restorePreviousSession`, `runSidebarCommand`, …)
   * is answered by `handle_gpui_app_modal_sidebar_command` in Rust, not by this runtime's own
   * `handleSidebarMessage`, which has no branch for them and would drop them silently.
   */
  const post = (message: SidebarToExtensionMessage) => {
    try {
      postAppModalHostMessage({ message, type: 'sidebarCommand' }, 'QuickAccess:sidebarCommand');
    } catch {
      runtime.vscode.postMessage(message);
    }
  };

  let open = false;
  let tab: QuickAccessTabId = 'commands';
  let query = '';
  let queryRevision = 0;
  let selectedKey = '';
  let selectionSeq = 0;
  let machineId: string | undefined;
  let projects: RecentProjectsData | undefined;
  let sessions: SessionsTabState = createSessionsTabState();
  let prompts: PromptsTabState = createPromptsTabState();
  /** The row whose actions menu is showing; `menuItem` runs against it. */
  let menuRowKey: string | undefined;
  let menuPromptKey: string | undefined;
  let openedPromptScope: 'all' | 'project' | 'session' | undefined;
  let pendingPublish: number | undefined;
  let sessionsRequestTimeout: number | undefined;
  let sessionsRequestId: string | undefined;
  let sessionsRequestMode: 'replace' | 'append' = 'replace';
  let sessionsRequestQueryKey = '';
  let sessionsLoadingMore = false;
  let externalRefreshPending = false;
  const requestedFileSizeKeys = new Set<string>();
  const fileSizeRequestIds = new Set<string>();
  const promptRequestIds: { list?: string; recovered?: string; sent?: string; save?: string } = {};
  let pendingTagApplication: { name: string; promptId?: string } | undefined;
  let requestCounter = 0;

  const nextRequestId = (kind: string) => {
    requestCounter += 1;
    return `${kind}-${Date.now()}-${requestCounter}`;
  };

  const close = () => {
    open = false;
    send({ kind: 'close', version: 1 });
  };

  /** The pet row reflects the persisted overlay state, like the React palette's prop. */
  const petOverlayEnabled = () => sidebarStore.getState().hud.settings?.petOverlayEnabled === true;

  const buildGroups = () => {
    if (tab === 'commands') return buildCommandGroups(query, petOverlayEnabled());
    if (tab === 'recentProjects') return buildProjectGroups(projects, query);
    if (tab === 'recentSessions') return buildSessionGroups(sessions, query, Date.now());
    return buildPromptGroups(prompts, query);
  };

  const toolbar = (): QuickAccessToolbar => {
    if (tab === 'recentSessions') {
      return {
        kind: 'sessions',
        scope: sessions.scope,
        scopes: [
          { value: 'all', label: 'All' },
          { value: 'closed', label: 'Closed' },
          { value: 'external', label: 'External' },
        ],
        scopeHotkey: formatSidebarHotkeyLabel(SESSIONS_SCOPE_TOGGLE_HOTKEY),
        tagFilterActive: sessions.tagFilters.length > 0,
        tags: sessionTagSelect(sessions),
        projects: sessionProjectSelect(sessions),
      };
    }
    if (tab === 'savedPrompts') {
      return {
        kind: 'prompts',
        view: prompts.view,
        views: [
          { value: 'saved', label: 'Saved' },
          { value: 'recovered', label: 'Recovered' },
          { value: 'sent', label: 'Sent' },
        ],
        projects: promptsProjectSelect(prompts),
        tags: promptsTagSelect(prompts, query),
      };
    }
    return { kind: 'none' };
  };

  const loading = (): boolean => {
    if (tab === 'recentProjects') return projects === undefined;
    if (tab === 'recentSessions') {
      // `hasResolvedCurrentPreviousSessionsQuery`: the page answering this exact query.
      return sessions.resolvedQueryKey !== sessionsQueryKey(sessions, query);
    }
    if (tab === 'savedPrompts') return prompts.view === 'saved' && prompts.prompts === undefined;
    return false;
  };

  const emptyCopy = (): string => {
    if (tab === 'commands') return 'No commands found.';
    if (tab === 'recentProjects') return query.trim() ? 'No projects match that search.' : 'No projects yet.';
    if (tab === 'recentSessions') return sessionsEmptyCopy(sessions, query);
    return promptsEmptyCopy(prompts);
  };

  const loadingCopy = (): string => {
    if (tab === 'recentProjects') return 'Loading projects...';
    if (tab === 'recentSessions') return sessionsLoadingCopy(sessions);
    if (tab === 'savedPrompts') return 'Loading saved prompts...';
    return 'Loading commands...';
  };

  const findPromptsHotkey = (): string => {
    const hotkeys = normalizeghostexHotkeySettings(sidebarStore.getState().hud.settings?.hotkeys);
    return hotkeys.openFindPrompts ? formatSidebarHotkeyLabel(hotkeys.openFindPrompts) : '';
  };

  const snapshot = (): QuickAccessSnapshot => {
    const groups = buildGroups();
    const keys = groups.flatMap((group) => group.rows.map((row) => row.key));
    if (!keys.includes(selectedKey)) selectedKey = keys[0] ?? '';
    return {
      kind: 'snapshot',
      version: 1,
      revision: queryRevision,
      tab,
      tabs: TABS.map((entry) => ({ ...entry, hotkey: formatSidebarHotkeyLabel(entry.hotkey) })),
      placeholder: PLACEHOLDERS[tab],
      query,
      queryRevision,
      loading: loading(),
      loadingLabel: loadingCopy(),
      empty: emptyCopy(),
      groups,
      selectedKey,
      selectionSeq,
      toolbar: toolbar(),
      primaryAction: primaryActionLabel(),
      actionHotkeys: QUICK_ACCESS_ACTION_HOTKEYS,
      hint: tab === 'savedPrompts' && !prompts.editing ? STASH_PROMPT_HINT : '',
      editor: tab === 'savedPrompts' ? promptEditorState(prompts) : null,
      tagComposer:
        tab === 'savedPrompts' && prompts.composer
          ? {
              name: prompts.composer.name,
              color: prompts.composer.color,
              colors: [...STASHED_PROMPT_TAG_COLORS],
              error: prompts.tagError ?? '',
              anchor: prompts.composer.anchor,
            }
          : null,
    };
  };

  /*
   * CDXC:AppModal 2026-09-20 WHY:
   * `tickNativeTimers` runs every timer callback in one unguarded loop, so an exception raised here does
   * not just blank Quick Access: it escapes the tick and starves every later timer in it, including the
   * sidebar's own. Publishing therefore reports its own failures and never throws into the runtime.
   */
  const publish = () => {
    if (!open || pendingPublish !== undefined) return;
    pendingPublish = window.requestAnimationFrame(() => {
      pendingPublish = undefined;
      if (!open) return;
      try {
        send(snapshot());
        requestVisibleSessionSizes();
      } catch (error) {
        console.error(
          '[quick-access] building the snapshot failed',
          tab,
          error instanceof Error ? (error.stack ?? error.message) : String(error)
        );
      }
    });
  };

  // ---------------------------------------------------------------- requests

  const requestRecentProjects = () => {
    post({ machineId, type: 'requestRecentProjects' } as SidebarToExtensionMessage);
  };

  const requestSessionsPage = (mode: 'replace' | 'append', cursor?: string) => {
    if (mode === 'append' && (!cursor || sessionsLoadingMore)) return;
    const requestId = nextRequestId('previous-sessions');
    const refreshExternalSessions = mode === 'replace' && externalRefreshPending;
    if (refreshExternalSessions) {
      externalRefreshPending = false;
      sessions.resolvedQueryKey = undefined;
    }
    sessionsRequestId = requestId;
    sessionsRequestMode = mode;
    sessionsRequestQueryKey = sessionsQueryKey(sessions, query);
    if (mode === 'append') sessionsLoadingMore = true;
    else {
      sessionsLoadingMore = false;
      sessions.cursor = undefined;
    }
    post({
      cursor,
      limit: SESSIONS_PAGE_SIZE,
      query: query.trim() || undefined,
      requestId,
      sessionTags: sessions.tagFilters,
      projectId: sessions.projectId || undefined,
      externalOnly: sessions.scope === 'external',
      refreshExternalSessions,
      type: 'requestPreviousSessions',
    } as SidebarToExtensionMessage);
  };

  /*
   * CDXC:AppModal 2026-09-20 WHY:
   * The unfiltered list shows a rolling 14-day window, so the runtime keeps paging
   * gxserver until the oldest loaded session predates that cutoff. Without it the
   * first page can end inside the window and the list looks like it stops early.
   */
  const fillVisibleHistoryWindow = () => {
    if (tab !== 'recentSessions' || sessionsLoadingMore || !sessions.cursor) return;
    if (query.trim() || sessions.tagFilters.length > 0 || sessions.projectId || sessions.scope === 'external') {
      return;
    }
    const cutoff = sessions.historyAnchorMs - sessions.historyWindowCount * SESSIONS_VISIBLE_WINDOW_MS;
    const oldest = (sessions.remoteSessions ?? []).reduce((current, session) => {
      const closedAt = Date.parse(session.closedAt ?? '');
      return Number.isFinite(closedAt) && closedAt > 0 ? Math.min(current, closedAt) : current;
    }, Number.POSITIVE_INFINITY);
    if (oldest <= cutoff) return;
    requestSessionsPage('append', sessions.cursor);
  };

  const scheduleSessionsRequest = (immediate: boolean) => {
    if (sessionsRequestTimeout !== undefined) window.clearTimeout(sessionsRequestTimeout);
    sessionsRequestTimeout = window.setTimeout(
      () => {
        sessionsRequestTimeout = undefined;
        requestSessionsPage('replace');
      },
      immediate ? 0 : SESSIONS_QUERY_DEBOUNCE_MS
    );
  };

  /*
   * CDXC:AppModal 2026-09-20 WHY:
   * The React list used an IntersectionObserver to defer transcript sizes until a
   * row approached the viewport. The native list has no observer, so the sizes of
   * the rows the runtime is publishing are requested in the same bounded batches.
   */
  const requestVisibleSessionSizes = () => {
    if (tab !== 'recentSessions') return;
    const items = visibleSessionItems(sessions, query);
    const targets = items.flatMap((item) => {
      if (requestedFileSizeKeys.has(item.key)) return [];
      const target =
        item.kind === 'closed'
          ? { historyId: item.session.historyId, key: item.key }
          : item.session.sessionRoutingId
            ? { key: item.key, routingId: item.session.sessionRoutingId }
            : undefined;
      if (!target) return [];
      requestedFileSizeKeys.add(item.key);
      return [target];
    });
    for (let offset = 0; offset < targets.length; offset += SESSION_TRANSCRIPT_SIZE_BATCH_SIZE) {
      const requestId = nextRequestId('session-transcript-sizes');
      fileSizeRequestIds.add(requestId);
      post({
        requestId,
        sessions: targets.slice(offset, offset + SESSION_TRANSCRIPT_SIZE_BATCH_SIZE),
        type: 'requestSessionTranscriptSizes',
      } as SidebarToExtensionMessage);
    }
  };

  const requestPromptList = () => {
    const requestId = nextRequestId('stashed-prompts');
    promptRequestIds.list = requestId;
    prompts.resolvedDefaultScope = false;
    post({
      requestId,
      includeRecovery: false,
      includeDelivered: false,
      type: 'requestStashedPrompts',
    } as SidebarToExtensionMessage);
  };

  const requestPromptHistory = (view: Exclude<PromptsView, 'saved'>) => {
    if (promptRequestIds[view]) return;
    const requestId = nextRequestId(`stashed-prompts-${view}`);
    promptRequestIds[view] = requestId;
    post({
      requestId,
      includeRecovery: view === 'recovered',
      includeDelivered: view === 'sent',
      type: 'requestStashedPrompts',
    } as SidebarToExtensionMessage);
  };

  const refreshRecoveredPrompts = () => {
    const names = promptProjectNames(prompts);
    prompts.recovered = listRecoveredSessionChatDrafts().map((draft) => recoveredDraftAsPrompt(draft, names));
  };

  const refreshSentPrompts = () => {
    const names = promptProjectNames(prompts);
    prompts.sent = listSentSessionChatMessages().map((message) => ({
      ...message,
      projectName: (message.projectId && names.get(message.projectId)) || null,
    }));
  };

  const refreshTabData = () => {
    if (tab === 'recentProjects') requestRecentProjects();
    if (tab === 'recentSessions') scheduleSessionsRequest(true);
    if (tab === 'savedPrompts') {
      requestPromptList();
      if (prompts.view !== 'saved') requestPromptHistory(prompts.view);
    }
  };

  // ----------------------------------------------------------------- actions

  const activateRow = (key: string) => {
    if (tab === 'commands') {
      runCommandRow(key, petOverlayEnabled(), post, close);
      return;
    }
    if (tab === 'recentProjects') {
      const project = findRecentProject(projects, key);
      if (!project) return;
      activateRecentProject(project, post);
      close();
      return;
    }
    if (tab === 'recentSessions') {
      const item = visibleSessionItems(sessions, query).find((candidate) => candidate.key === key);
      if (!item) return;
      if (item.kind === 'open') {
        sidebarStore.getState().applyLocalFocus(item.groupId, item.session.sessionId);
        post({ sessionId: item.session.sessionId, type: 'focusSession' } as SidebarToExtensionMessage);
      } else {
        if (!item.session.isRestorable) return;
        post({ historyId: item.session.historyId, type: 'restorePreviousSession' } as SidebarToExtensionMessage);
      }
      close();
      return;
    }
    const prompt = findPrompt(prompts, key);
    if (!prompt) return;
    post({
      content: prompt.content,
      promptId: prompt.promptId,
      ...(prompts.sessionId ? { sessionId: prompts.sessionId } : {}),
      type: 'insertStashedPrompt',
    } as SidebarToExtensionMessage);
    close();
  };

  const removeRow = (key: string) => {
    if (tab === 'recentProjects') {
      const project = findRecentProject(projects, key);
      if (project) removeRecentProject(project, post);
      return;
    }
    if (tab === 'recentSessions') {
      const item = visibleSessionItems(sessions, query).find((candidate) => candidate.key === key);
      if (!item || item.kind !== 'closed') return;
      sessions.remoteSessions = removePreviousSessionByHistoryId(
        sessions.remoteSessions ?? sidebarStore.getState().previousSessions,
        item.session.historyId
      );
      post({ historyId: item.session.historyId, type: 'deletePreviousSession' } as SidebarToExtensionMessage);
    }
  };

  const setPromptTags = (promptId: string, tagIds: string[]) => {
    prompts.prompts = prompts.prompts?.map((candidate) =>
      candidate.promptId === promptId ? { ...candidate, tagIds } : candidate
    );
    post({
      promptId,
      requestId: nextRequestId('set-stashed-prompt-tags'),
      tagIds,
      type: 'setStashedPromptTags',
    } as SidebarToExtensionMessage);
  };

  const runPromptAction = (key: string, action: string) => {
    const prompt = findPrompt(prompts, key);
    if (!prompt) return;
    if (action === 'open') {
      post({
        ...(prompt.agentSessionId ? { agentSessionId: prompt.agentSessionId } : {}),
        ...(prompt.projectId ? { projectId: prompt.projectId } : {}),
        ...(prompt.sessionId ? { sessionId: prompt.sessionId } : {}),
        type: 'jumpToStashedPromptSession',
      } as SidebarToExtensionMessage);
      close();
      return;
    }
    if (action === 'favorite') {
      setPromptTags(prompt.promptId, nextPromptTagIds(prompt, GXSERVER_FAVORITE_PROMPT_TAG_ID));
      return;
    }
    if (action === 'copy') {
      /*
       * The runtime has no `navigator.clipboard`, so the copy goes through the host message the
       * rest of the app already uses; it writes the clipboard and plays the copy sound itself.
       */
      postAppModalHostMessage({ detailsText: prompt.content, type: 'copySessionDetails' }, 'QuickAccess:copyPrompt');
      return;
    }
    if (action === 'edit') {
      prompts.editing = {
        promptId: prompt.promptId,
        content: prompt.content,
        projectValue: prompt.projectId ? `project:${prompt.projectId}` : NO_PROJECT_VALUE,
        tagValue: (() => {
          const labelTagId = (prompt.tagIds ?? []).find((tagId) => tagId !== GXSERVER_FAVORITE_PROMPT_TAG_ID);
          return labelTagId ? `tag:${labelTagId}` : NO_TAG_VALUE;
        })(),
        isFavorite: (prompt.tagIds ?? []).includes(GXSERVER_FAVORITE_PROMPT_TAG_ID),
      };
      prompts.saveError = undefined;
      return;
    }
    if (action === 'save') {
      if (prompts.saving) return;
      const requestId = nextRequestId('save-stashed-prompt');
      promptRequestIds.save = requestId;
      prompts.saving = true;
      prompts.tagError = undefined;
      post({
        content: prompt.content,
        ...(prompt.projectId ? { projectId: prompt.projectId } : {}),
        requestId,
        ...(prompt.sessionId ? { sessionId: prompt.sessionId } : {}),
        tagIds: [],
        type: 'saveStashedPrompt',
      } as SidebarToExtensionMessage);
      return;
    }
    if (action === 'delete' || action === 'dismiss') {
      if (prompts.view === 'saved') {
        post({ promptId: prompt.promptId, type: 'deleteStashedPrompt' } as SidebarToExtensionMessage);
        prompts.prompts = prompts.prompts?.filter((candidate) => candidate.promptId !== prompt.promptId);
      } else if (prompts.view === 'sent') {
        deleteSentSessionChatMessage(prompt.promptId);
        refreshSentPrompts();
      } else {
        const sessionKey = recoveredDraftSessionKey(prompt.promptId);
        if (sessionKey.startsWith('history:')) dismissDraftRecovery(sessionKey.slice('history:'.length));
        else deleteStoredSessionChatDraft(sessionKey);
        refreshRecoveredPrompts();
      }
    }
  };

  const submitEditor = () => {
    const editing = prompts.editing;
    if (!editing || prompts.saving) return;
    const content = trimPromptEditorTrailingSpaces(editing.content);
    if (!content.trim()) return;
    const requestId = nextRequestId('save-stashed-prompt');
    promptRequestIds.save = requestId;
    prompts.saving = true;
    prompts.saveError = undefined;
    const selectedProjectId =
      editing.projectValue === NO_PROJECT_VALUE ? undefined : editing.projectValue.slice('project:'.length);
    const tagIds = [
      ...(editing.isFavorite ? [GXSERVER_FAVORITE_PROMPT_TAG_ID] : []),
      ...(editing.tagValue === NO_TAG_VALUE ? [] : [editing.tagValue.slice('tag:'.length)]),
    ];
    post({
      content,
      ...(editing.promptId ? { promptId: editing.promptId } : {}),
      ...(!editing.promptId && selectedProjectId ? { projectId: selectedProjectId } : {}),
      requestId,
      ...(!editing.promptId && selectedProjectId === prompts.rawProjectId && prompts.rawSessionId
        ? { sessionId: prompts.rawSessionId }
        : {}),
      tagIds,
      type: 'saveStashedPrompt',
    } as SidebarToExtensionMessage);
  };

  const startAddPrompt = () => {
    const defaultProjectId = prompts.scope === 'project' ? prompts.scopeProjectId : prompts.rawProjectId;
    prompts.editing = {
      content: '',
      projectValue: defaultProjectId ? `project:${defaultProjectId}` : NO_PROJECT_VALUE,
      tagValue:
        prompts.tagFilter.kind === 'tag' && prompts.tagFilter.tagId !== GXSERVER_FAVORITE_PROMPT_TAG_ID
          ? `tag:${prompts.tagFilter.tagId}`
          : NO_TAG_VALUE,
      isFavorite: prompts.tagFilter.kind === 'tag' && prompts.tagFilter.tagId === GXSERVER_FAVORITE_PROMPT_TAG_ID,
    };
    prompts.saveError = undefined;
  };

  /** Everything the row at `key` can do, Return's action first. An empty key lists what the tab offers without a row. */
  const rowActionItems = (key: string): QuickAccessMenuItem[] => {
    if (tab === 'commands') {
      return key ? [actionItem(ACTIVATE_ACTION_ID, 'Run Command', 'player-play')] : [];
    }
    if (tab === 'recentProjects') {
      const project = findRecentProject(projects, key);
      return project ? recentProjectMenuItems(project, machineId) : [];
    }
    if (tab === 'recentSessions') {
      const item = visibleSessionItems(sessions, query).find((candidate) => candidate.key === key);
      return tidyActionItems([
        ...(item
          ? [
              item.kind === 'open'
                ? actionItem(ACTIVATE_ACTION_ID, 'Focus Session', 'focus-2')
                : actionItem(ACTIVATE_ACTION_ID, 'Resume Session', 'player-play', {
                    disabled: item.session.isRestorable !== true,
                  }),
            ]
          : []),
        ACTION_SEPARATOR,
        actionItem('findPrompts', 'Search by Prompt', 'file-search', { hotkey: findPromptsHotkey() }),
        ACTION_SEPARATOR,
        ...(item?.kind === 'closed' ? [actionItem('remove', 'Delete Session', 'trash', { danger: true })] : []),
      ]);
    }
    const prompt = findPrompt(prompts, key);
    const offered = prompt ? promptActions(prompts, prompt) : [];
    const isFavorite = prompt ? (prompt.tagIds ?? []).includes(GXSERVER_FAVORITE_PROMPT_TAG_ID) : false;
    return tidyActionItems([
      ...(prompt ? [actionItem(ACTIVATE_ACTION_ID, 'Insert into Chat', 'arrow-back-up')] : []),
      ...(offered.includes('open') ? [actionItem('prompt:open', 'Open Source Session', 'arrow-up-right')] : []),
      ACTION_SEPARATOR,
      ...(offered.includes('favorite')
        ? [actionItem('prompt:favorite', isFavorite ? 'Remove Star' : 'Star', isFavorite ? 'star-filled' : 'star')]
        : []),
      ...(offered.includes('save') ? [actionItem('prompt:save', 'Save Prompt', 'device-floppy')] : []),
      ...(offered.includes('tag') ? [actionItem('prompt:tag', 'Tag…', 'tag')] : []),
      ...(offered.includes('copy') ? [actionItem('prompt:copy', 'Copy Text', 'copy')] : []),
      ...(offered.includes('edit') ? [actionItem('prompt:edit', 'Edit', 'pencil')] : []),
      ...(prompts.view === 'saved' ? [actionItem('addPrompt', 'New Prompt', 'plus')] : []),
      ACTION_SEPARATOR,
      ...(offered.includes('delete') ? [actionItem('prompt:delete', 'Delete', 'trash', { danger: true })] : []),
    ]);
  };

  /** The footer's name for Return: one word, because the footer also carries the four tabs. */
  const primaryActionLabel = (): string => {
    const first = rowActionItems(selectedKey)[0];
    if (first?.id !== ACTIVATE_ACTION_ID || first.disabled) return '';
    if (tab === 'commands') return 'Run';
    if (tab === 'savedPrompts') return 'Insert';
    if (tab === 'recentSessions') return first.label === 'Focus Session' ? 'Focus' : 'Resume';
    return first.label;
  };

  /** Runs one actions-menu item. Returns true when it already answered the window, so the caller skips its publish. */
  const runRowAction = (key: string, id: string): boolean => {
    if (id === ACTIVATE_ACTION_ID) {
      activateRow(key);
      return false;
    }
    if (id === 'remove') {
      removeRow(key);
      return false;
    }
    if (id === 'addPrompt') {
      startAddPrompt();
      return false;
    }
    if (id === 'findPrompts') {
      // Close first: the desktop close removes whichever app-modal window is
      // open, so opening Find before closing would take down its own window.
      close();
      post({ actionId: 'openFindPrompts', type: 'runGhostexHotkeyAction' } as SidebarToExtensionMessage);
      return true;
    }
    if (id === 'prompt:tag') {
      const prompt = findPrompt(prompts, key);
      if (!prompt) return false;
      menuPromptKey = key;
      send({ kind: 'menu', version: 1, items: promptTagMenuItems(prompts, prompt) });
      return true;
    }
    if (id.startsWith('prompt:')) {
      runPromptAction(key, id.slice('prompt:'.length));
      return false;
    }
    const project = findRecentProject(projects, key);
    if (!project) return false;
    if (id === 'copyPath') {
      post({ projectId: project.projectId, type: 'copyRecentProjectPath' } as SidebarToExtensionMessage);
    } else if (id === 'openLocation' || id === 'openTerminal') {
      post({
        projectId: project.projectId,
        type: machineId ? 'openRecentProjectTerminal' : 'openRecentProjectInFinder',
      } as SidebarToExtensionMessage);
      if (machineId) {
        close();
        return true;
      }
    }
    return false;
  };

  const cycleSessionsScope = () => {
    sessions.scope = sessions.scope === 'all' ? 'closed' : sessions.scope === 'closed' ? 'external' : 'all';
    if (sessions.scope === 'external') externalRefreshPending = true;
    scheduleSessionsRequest(true);
  };

  // ---------------------------------------------------------------- commands

  bridge.onNativeQuickAccessCommand = (command: QuickAccessCommand) => {
    switch (command.type) {
      case 'open': {
        const previousTab = tab;
        open = true;
        tab = command.tab;
        query = typeof command.query === 'string' ? command.query : '';
        queryRevision += 1;
        selectedKey = '';
        if (tab === 'recentProjects') {
          machineId = command.machineId;
          projects = undefined;
        }
        if (tab === 'recentSessions') {
          sessions = createSessionsTabState();
          sessions.projectId = command.projectId ?? '';
          sessions.scope = (command.scope as SessionScope) ?? 'all';
          externalRefreshPending = sessions.scope === 'external';
          requestedFileSizeKeys.clear();
        }
        if (tab === 'savedPrompts') {
          /*
           * CDXC:SavedPrompts 2026-09-11 (ported) WHY:
           * The saved library is retained across closes so reopening paints it
           * before the refresh lands; everything else about the tab resets.
           */
          const keptPrompts = prompts.prompts;
          const keptTags = prompts.tags;
          prompts = createPromptsTabState();
          prompts.prompts = keptPrompts;
          prompts.tags = keptTags;
          promptRequestIds.recovered = undefined;
          promptRequestIds.sent = undefined;
          openedPromptScope = command.promptScope;
          applyPromptsLauncherContext(prompts, command.promptProjectId, command.promptSessionId, command.promptScope);
        }
        refreshTabData();
        break;
      }
      case 'closed':
        open = false;
        menuRowKey = undefined;
        menuPromptKey = undefined;
        return;
      case 'close':
        close();
        return;
      case 'tab': {
        if (tab === command.tab) break;
        tab = command.tab;
        query = '';
        queryRevision += 1;
        selectedKey = '';
        refreshTabData();
        break;
      }
      case 'query': {
        query = command.query;
        selectedKey = '';
        if (tab === 'recentSessions') scheduleSessionsRequest(false);
        break;
      }
      case 'select':
        selectedKey = command.key;
        selectionSeq = command.seq;
        break;
      case 'activate':
        activateRow(command.key);
        break;
      case 'secondary': {
        menuPromptKey = undefined;
        menuRowKey = command.key;
        send({ kind: 'menu', version: 1, items: rowActionItems(command.key) });
        return;
      }
      case 'actionHotkey': {
        const item = actionForHotkey(rowActionItems(command.key), command.hotkey);
        if (item && runRowAction(command.key, item.id)) return;
        break;
      }
      case 'menuItem': {
        if (menuPromptKey !== undefined) {
          const key = menuPromptKey;
          menuPromptKey = undefined;
          if (command.id === 'tag:new') {
            prompts.composer = {
              name: '',
              color: STASHED_PROMPT_TAG_COLORS[prompts.tags.length % STASHED_PROMPT_TAG_COLORS.length],
              anchor: `row:${key}`,
              promptId: findPrompt(prompts, key)?.promptId,
            };
            prompts.tagError = undefined;
            break;
          }
          const prompt = findPrompt(prompts, key);
          if (prompt && command.id.startsWith('tag:')) {
            setPromptTags(prompt.promptId, nextPromptTagIds(prompt, command.id.slice('tag:'.length)));
          }
          break;
        }
        const key = menuRowKey ?? '';
        menuRowKey = undefined;
        if (runRowAction(key, command.id)) return;
        break;
      }
      case 'scope': {
        if (command.value === 'cycle') cycleSessionsScope();
        else {
          sessions.scope = command.value as SessionScope;
          if (sessions.scope === 'external') externalRefreshPending = true;
          scheduleSessionsRequest(true);
        }
        break;
      }
      case 'view': {
        prompts.view = command.value as PromptsView;
        if (prompts.view === 'recovered') {
          refreshRecoveredPrompts();
          requestPromptHistory('recovered');
        } else if (prompts.view === 'sent') {
          refreshSentPrompts();
          requestPromptHistory('sent');
        }
        break;
      }
      case 'project': {
        if (tab === 'recentSessions') {
          sessions.projectId = command.value;
          scheduleSessionsRequest(true);
        } else if (tab === 'savedPrompts') {
          if (command.value === ALL_PROJECTS_VALUE) prompts.scope = 'all';
          else if (command.value === CURRENT_SESSION_VALUE) prompts.scope = 'session';
          else {
            prompts.scope = 'project';
            prompts.scopeProjectId = command.value.slice('project:'.length);
          }
        }
        break;
      }
      case 'tagFilter': {
        if (tab === 'recentSessions') {
          sessions.tagFilters = sessions.tagFilters.includes(command.value)
            ? sessions.tagFilters.filter((tag) => tag !== command.value)
            : [...sessions.tagFilters, command.value];
          scheduleSessionsRequest(true);
        } else if (tab === 'savedPrompts') {
          if (command.value === 'tag:new') {
            prompts.composer = {
              name: '',
              color: STASHED_PROMPT_TAG_COLORS[prompts.tags.length % STASHED_PROMPT_TAG_COLORS.length],
              anchor: 'toolbar',
            };
            prompts.tagError = undefined;
          } else if (command.value === ALL_TAGS_VALUE) prompts.tagFilter = { kind: 'all' };
          else if (command.value === NO_TAG_VALUE) prompts.tagFilter = { kind: 'untagged' };
          else prompts.tagFilter = { kind: 'tag', tagId: command.value.slice('tag:'.length) };
        }
        break;
      }
      case 'loadMore': {
        if (tab !== 'recentSessions') break;
        if (!query.trim() && sessions.tagFilters.length === 0 && !sessions.projectId && sessions.scope !== 'external') {
          sessions.historyWindowCount += 1;
        } else if (sessions.cursor && !sessionsLoadingMore) {
          requestSessionsPage('append', sessions.cursor);
        }
        break;
      }
      case 'editorField': {
        if (!prompts.editing) break;
        if (command.field === 'content') prompts.editing.content = command.value;
        if (command.field === 'project') prompts.editing.projectValue = command.value;
        if (command.field === 'tag') prompts.editing.tagValue = command.value;
        break;
      }
      case 'editorFavorite':
        if (prompts.editing) prompts.editing.isFavorite = !prompts.editing.isFavorite;
        break;
      case 'editorSubmit':
        submitEditor();
        break;
      case 'editorCancel':
        if (!prompts.saving) {
          prompts.editing = undefined;
          prompts.saveError = undefined;
        }
        break;
      case 'tagComposerOpen': {
        const promptId = command.anchor.startsWith('row:')
          ? findPrompt(prompts, command.anchor.slice('row:'.length))?.promptId
          : undefined;
        prompts.composer = {
          name: '',
          color: STASHED_PROMPT_TAG_COLORS[prompts.tags.length % STASHED_PROMPT_TAG_COLORS.length],
          anchor: command.anchor,
          promptId,
        };
        prompts.tagError = undefined;
        break;
      }
      case 'tagComposerField': {
        if (!prompts.composer) break;
        if (command.field === 'name') prompts.composer.name = command.value;
        if (command.field === 'color') prompts.composer.color = command.value;
        break;
      }
      case 'tagComposerSubmit': {
        const composer = prompts.composer;
        if (!composer) break;
        const name = composer.name.trim().replace(/\s+/g, ' ');
        if (!name) break;
        pendingTagApplication = { name: name.toLowerCase(), promptId: composer.promptId };
        post({
          color: composer.color,
          name,
          requestId: nextRequestId('save-stashed-prompt-tag'),
          type: 'saveStashedPromptTag',
        } as SidebarToExtensionMessage);
        prompts.composer = undefined;
        break;
      }
      case 'tagComposerCancel':
        prompts.composer = undefined;
        break;
      default:
        break;
    }
    publish();
  };

  // ---------------------------------------------------------------- messages

  const receive = (event: Event) => {
    if (!(event instanceof MessageEvent)) return;
    const message = event.data as ExtensionToSidebarMessage;
    if (!message || typeof message !== 'object') return;
    switch (message.type) {
      case 'recentProjectsResult': {
        if (message.machineId !== machineId) return;
        projects = { machineId, projects: message.recentProjects };
        break;
      }
      case 'previousSessionsResult': {
        if (message.requestId !== sessionsRequestId) return;
        if (sessionsRequestMode === 'append') {
          const seen = new Set((sessions.remoteSessions ?? []).map((session) => session.historyId));
          sessions.remoteSessions = [
            ...(sessions.remoteSessions ?? []),
            ...message.previousSessions.filter((session) => !seen.has(session.historyId)),
          ];
        } else {
          sessions.remoteSessions = message.previousSessions;
          sessions.resolvedQueryKey = sessionsRequestQueryKey;
          if (sessionsRequestQueryKey === sessionsQueryKey(createSessionsTabState(), '')) {
            sessions.historyAnchorMs = Date.now();
            sessions.historyWindowCount = 1;
          }
        }
        if (message.projects) sessions.projectOptions = message.projects;
        sessions.cursor = message.cursor;
        sessionsLoadingMore = false;
        fillVisibleHistoryWindow();
        break;
      }
      case 'sessionTranscriptSizesResult': {
        if (!fileSizeRequestIds.delete(message.requestId)) return;
        for (const result of message.sizes) {
          sessions.fileSizesByKey[result.key] =
            typeof result.sizeBytes === 'number' && Number.isFinite(result.sizeBytes) && result.sizeBytes >= 0
              ? result.sizeBytes
              : null;
        }
        break;
      }
      case 'stashedPromptsResult': {
        if (message.requestId === promptRequestIds.recovered) {
          /*
           * The daemon answer seeds local recovery storage; the visible rows are
           * always read back from that storage so a local-only draft is listed too.
           */
          importDraftRecovery(message.recoveryDrafts ?? []);
          reconcileSessionChatDraftsFromServer(message.drafts ?? []);
          refreshRecoveredPrompts();
          break;
        }
        if (message.requestId === promptRequestIds.sent) {
          recordDeliveredSessionChatDrafts(message.deliveredDrafts ?? []);
          refreshSentPrompts();
          break;
        }
        if (message.requestId !== promptRequestIds.list) return;
        prompts.prompts = message.prompts;
        prompts.tags = message.tags ?? [];
        /*
         * CDXC:SavedPrompts 2026-08-24 (ported):
         * Without a launcher-pinned scope the tab opens on this session when it
         * has session context and that scope is not empty; the decision runs
         * once per open so a later refresh cannot yank the scope back.
         */
        if (!prompts.resolvedDefaultScope) {
          prompts.resolvedDefaultScope = true;
          if (openedPromptScope === undefined && hasSessionScope(prompts)) {
            const belongs = prompts.prompts.some((prompt) => promptBelongsToSession(prompt, prompts));
            if (belongs) prompts.scope = 'session';
          }
        }
        break;
      }
      case 'saveStashedPromptResult': {
        if (message.requestId !== promptRequestIds.save) return;
        prompts.saving = false;
        promptRequestIds.save = undefined;
        if (!message.ok || !message.prompt) {
          prompts.saveError = message.error ?? 'Could not save this prompt.';
          break;
        }
        const saved = message.prompt;
        prompts.prompts = [saved, ...(prompts.prompts ?? []).filter((item) => item.promptId !== saved.promptId)];
        prompts.editing = undefined;
        prompts.saveError = undefined;
        break;
      }
      case 'stashedPromptTagsResult': {
        if (!message.ok) {
          prompts.tagError = message.error ?? 'Could not update tags.';
          break;
        }
        prompts.tagError = undefined;
        prompts.tags = message.tags;
        const deletedTagId = message.deletedTagId;
        if (deletedTagId) {
          prompts.prompts = prompts.prompts?.map((prompt) =>
            (prompt.tagIds ?? []).includes(deletedTagId)
              ? { ...prompt, tagIds: (prompt.tagIds ?? []).filter((tagId) => tagId !== deletedTagId) }
              : prompt
          );
          if (prompts.tagFilter.kind === 'tag' && prompts.tagFilter.tagId === deletedTagId) {
            prompts.tagFilter = { kind: 'all' };
          }
        }
        /*
         * The daemon owns tag ids, so a tag created from a row's menu can only be
         * applied once the refreshed catalogue comes back naming it.
         */
        if (pendingTagApplication) {
          const created = prompts.tags.find((tag) => tag.name.toLowerCase() === pendingTagApplication!.name);
          if (created) {
            const pending = pendingTagApplication;
            pendingTagApplication = undefined;
            if (!pending.promptId) prompts.tagFilter = { kind: 'tag', tagId: created.tagId };
            else {
              const prompt = prompts.prompts?.find((candidate) => candidate.promptId === pending.promptId);
              if (prompt && !(prompt.tagIds ?? []).includes(created.tagId)) {
                setPromptTags(prompt.promptId, [
                  ...((prompt.tagIds ?? []).includes(GXSERVER_FAVORITE_PROMPT_TAG_ID)
                    ? [GXSERVER_FAVORITE_PROMPT_TAG_ID]
                    : []),
                  created.tagId,
                ]);
              }
            }
          }
        }
        break;
      }
      case 'setStashedPromptTagsResult': {
        if (!message.ok || !message.prompt) {
          prompts.tagError = message.error ?? "Could not update this prompt's tags.";
          break;
        }
        const tagged = message.prompt;
        prompts.tagError = undefined;
        prompts.prompts = prompts.prompts?.map((prompt) => (prompt.promptId === tagged.promptId ? tagged : prompt));
        break;
      }
      default:
        return;
    }
    publish();
  };

  runtime.messageSource.addEventListener('message', receive);
  const unsubscribe = sidebarStore.subscribe(publish);
  return () => {
    if (pendingPublish !== undefined) window.cancelAnimationFrame(pendingPublish);
    if (sessionsRequestTimeout !== undefined) window.clearTimeout(sessionsRequestTimeout);
    runtime.messageSource.removeEventListener('message', receive);
    unsubscribe();
    delete bridge.onNativeQuickAccessCommand;
  };
}
