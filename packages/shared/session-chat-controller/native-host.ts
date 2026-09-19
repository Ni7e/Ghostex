import { SessionChatMarkdownSaveController } from './save-markdown';
import { listProjectMarkdownDocumentPaths, saveProjectMarkdownDocument } from '../project-docs';
import { nativeContextTitle } from './native-context';
import { COLLAPSED_CHOICE_COUNT, collapsedChoiceLabel } from '../session-chat-presentation/notice-choices';
import { classifySessionChatLinkHref, sessionChatFilePositionFromHref } from '../session-chat-presentation/links';
import { SessionChatAsyncQuestionsController } from './async-questions';
import { canCollapseSessionChatComposer } from '../session-chat-presentation/composer-scroll';
import {
  COMPOSER_SCROLL_RESET_MS,
  COMPOSER_SCROLL_THRESHOLD_PX,
  COMPOSER_BOTTOM_THRESHOLD_PX,
  createSessionChatComposerScrollGesture,
  resetSessionChatComposerScrollGesture,
  recordSessionChatComposerScrollGesture,
  suppressSessionChatComposerScrollGesture,
} from '../session-chat-presentation/composer-scroll';
import { ChatPreviewBackend } from '../session-chat-preview/backend';
import type { ChatPreviewConfig } from '../session-chat-preview/fixture';
import { computeSessionChatActivity } from './activity';
import { computeSessionChatWorkingStrip } from './working-strip';
import { NativeComposerSuggestions } from './native-suggestions';
import { computeSessionChatSkills } from './skills';
import { computeSessionChatFiles } from './files';
import { balancedRowStarts } from '../session-chat-presentation/status-line-layout';
import { nativeContextEditor, nativeContextEditorCommand } from './native-context-editor';
import { adoptNativeChatSettings, adoptNativeContextPreferences, computeNativeChatContext } from './native-context';
import { dispatchSessionChatOption, queueSessionChatOption } from './option-dispatch';
import { sendSessionChatOptionAware } from './option-command';
import { NativeModelPicker } from './native-model-picker';
import { currentAgentModelCatalog } from '../agent-model-catalog-state';
import { createModelPickerRequest } from '../session-chat-presentation/model-picker-request';
import { modelSelectionUnchanged } from './model-selection';
import { modelScopeForPills } from '../session-chat-presentation/model-picker';
import { adoptAgentModelCatalog } from '../agent-model-catalog-state';
import { computeNativeChatOptions, nativeOptionPersistence } from './native-options';
import {
  dismissedNoticeState,
  isNoticeDismissed,
  sessionChatTerminalNoticeDismissKey,
  type DismissedNotice,
} from './notice-state';
import {
  terminalDialogPresentation,
  terminalNoticeActionAnswer,
  terminalNoticeChoiceAnswer,
} from '../session-chat-presentation/terminal-prompts';
import { fitChatComposerControls } from '../session-chat-presentation/composer-layout';
import { computeNativeChatControls } from './native-controls';
import {
  SESSION_CHAT_STOP_BUTTON_COOLDOWN_MS,
  sessionChatSendBlockedReason,
  sessionChatComposerPlaceholder,
  DESKTOP_SESSION_CHAT_PLACEHOLDER,
} from './composer-policy';
import { NativeChatPresentation } from './native-presentation';
import { NativeSubagentViewer } from './native-subagent';
import { NativeChatPanels } from './native-panels';
import { NativeChatSearch } from './native-search';
import { NativeTerminalTail } from './native-terminal-tail';
import { NativeForkBranches } from './native-fork-branches';
import { NativeChatMessageActions } from './native-message-actions';
import { sessionChatAgentSupportsRewind } from '../session-chat-presentation/message-rewind';
import { deliverChatSubmission, editQueuedChatPrompt, restoreUndeliveredChatText } from './submission';
import {
  SESSION_CHAT_QUEUE_LONG_PRESS_MS,
  isSessionChatQueueRowBusy,
  sessionChatQueueRowPreview,
  moveSessionChatQueueRow,
  sessionChatQueuePromptIds,
} from './queue';
import {
  EMPTY_SESSION_CHAT_COMPOSER_HISTORY,
  recallPreviousSessionChatDraft,
  recallNextSessionChatDraft,
  resetSessionChatComposerHistoryIndex,
} from '@/packages/core-ui/chat/session-chat-composer-state';
import { GxserverRpcError, gxserverRpcErrorCode } from '../gxserver-rpc-error';
import type { GxserverRpcErrorCode } from '../gxserver-protocol';
import {
  sessionChatCardDismissKey,
  selectQuestionOption,
  questionAnswerControls,
  type QuestionDraft,
} from '../session-chat-presentation/interactive';
import {
  chatHostActionDefinitions,
  COMPOSER_MENU_EXCLUDED_HOST_ACTION_IDS,
  AGENT_HOST_ACTION_IDS,
} from '../session-chat-presentation/actions';
import { insertChatReference, nativePathReference, removeChatReference } from '../session-chat-presentation/references';
import { nativeComposerKeyIntent } from '../session-chat-presentation/native-composer-keys';
import { sessionChatReferenceMenuRows } from '../session-chat-presentation/reference-menu';
import {
  sessionChatAppendDraftText,
  sessionChatTranscriptMenuRows,
} from '../session-chat-presentation/transcript-menu';
import { sessionChatSendBlockedToastRequest } from '../session-chat-presentation/send-blocked';
import { NativeComposerChrome } from './native-composer-chrome';
import {
  sessionChatComposerReferences,
  sessionChatReferencePillText,
} from '../session-chat-presentation/reference-pills';
import { flushSessionNote } from './note';
import { sessionChatEmptyStateCopy } from '@/packages/core-ui/chat/session-chat-empty-state';
import {
  SESSION_CHAT_LOADING_INDICATOR_DELAY_MS,
  SESSION_CHAT_LOADING_RETRY_DELAY_MS,
  sessionChatNewSessionWelcomeTitle,
  sessionChatShowsNewSessionWelcome,
  sessionChatWelcomeAgentIcon,
  sessionChatWelcomeAgentName,
  type SessionChatLoadingStage,
} from '../session-chat-presentation/new-session-welcome';
import { ChatTransfers } from './transfers';
import { computeSessionChat } from './controller';
import { ChatComputation } from './lifecycle';
import { readWork } from '../session-chat-presentation/deferred-work';
import type { SessionChatTransport } from '@/packages/core-ui/chat/session-chat-transport';
import type { UseSessionChatResult } from '@/packages/core-ui/chat/use-session-chat/state';
import { createSessionChatPresentationStore } from '@/packages/core-ui/chat/session-chat-presentation-cache';
import type { GxserverSessionChatEvent, SessionChatMessage } from '../session-chat';

type HostRequest = { id?: number; kind: string; method: string; params: Record<string, unknown> };
const requests: HostRequest[] = [];
let preview: ChatPreviewBackend | undefined;
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
const timers = new Map<number, { at: number; interval: number; callback: () => void }>();
let sequence = 0;
let revision = 0;
let snapshot: unknown;
let transcriptItems: unknown[] = [];
let sentTranscriptItems: unknown[] | undefined;
/** The minimap's dashes, shipped only when they change so the rail costs nothing on a live status frame. */
let minimapMarkers: readonly unknown[] = [];
let sentMinimapMarkers: readonly unknown[] | undefined;
/** The subagent viewer's own transcript, shipped on its own splice channel so opening it never redraws the main list. */
let subagentItems: unknown[] = [];
let sentSubagentItems: unknown[] | undefined;
const presentation = new NativeChatPresentation();
presentation.onBackfill = () => {
  if (controller) publish(controller.current());
};
const subagentViewer = new NativeSubagentViewer(
  () => transport?.readSubagent,
  () => {
    if (controller) publish(controller.current());
  }
);
const panels = new NativeChatPanels(() => {
  if (controller) publish(controller.current());
});
const search = new NativeChatSearch();
const terminalTail = new NativeTerminalTail(
  () => rpc('readSessionTerminalTail'),
  () => {
    if (controller) publish(controller.current());
  }
);
const forkBranches = new NativeForkBranches(
  () => rpc('sessionForkBranches'),
  () => {
    if (controller) publish(controller.current());
  }
);
const suggestions = new NativeComposerSuggestions();
const composerScrollGesture = createSessionChatComposerScrollGesture();
let composerCollapsed = false;
let detailRevision = 0;
type NativeChatState = {
  workingStrip: ReturnType<typeof computeSessionChatWorkingStrip> & {
    presentation: ReturnType<typeof computeSessionChatActivity>;
  };
} & UseSessionChatResult &
  ReturnType<typeof computeNativeChatControls> &
  ReturnType<typeof computeNativeChatOptions> &
  ReturnType<typeof computeNativeChatContext> &
  ReturnType<typeof computeSessionChatSkills> &
  ReturnType<typeof computeSessionChatFiles>;
let optionPersistence: ReturnType<typeof nativeOptionPersistence>;
let controller: ChatComputation<NativeChatState>;
let retiredNoticeKey: string | null = null;
let answeredNoticeKey: string | null = null;
let activeNoticeKey: string | null = null;
let dismissedNotice: DismissedNotice | null = null;
let bootConfig: { clientId: string; projectId: string; initialSnapshot?: any; initialPresentation?: any };
let booting = false;
let eventListener: ((event: GxserverSessionChatEvent) => void) | undefined;
let transport: SessionChatTransport;
let operationError: string | undefined;
/** The refusal's own code, so the composer can render the `composerNotReady` card instead of a plain error line. */
let operationErrorCode: GxserverRpcErrorCode | null | undefined;
let noticeError: string | undefined;
let pendingAttachments = 0;
/**
 * The pictures already in the draft, which hold the composer open the way React's `pastedImages`
 * do (composer-scroll.ts). Rust owns the draft text, so every path that carries it reports here.
 */
let draftAttachmentCount = 0;
let optionDispatchId: string | null = null;
let optionSwitching = false;
let modelPicker: NativeModelPicker | null = null;
let promptKey: string | null = null;
let dismissedPrompt: string | null = null;
let questionIndex = 0;
let questionContentKey: string | null = null;
let questionDraftsLoading = false;
let questionTransition = false;
let questionDrafts: QuestionDraft[] = [];
let answering = false;
const asyncQuestions = new SessionChatAsyncQuestionsController({
  read: () => composer('asyncQuestionRead'),
  write: async (answers) => {
    await composer('asyncQuestionWrite', { answers });
  },
  retire: async (questionId, answers) => {
    await composer('asyncQuestionRetire', { questionId, answers });
  },
});
asyncQuestions.subscribe(() => {
  if (controller) publish(controller.current());
});
let submissionAttempt: { cancelled: boolean } | undefined;
let incomingDraft: any = null;
let summaryMode = false;
let verboseOverride: boolean | null = null;
let composerOverflow: ReturnType<typeof fitChatComposerControls> = { overflowed: [], optionsOverflowed: false };
let contextStatusRows = [0];
let composerHistory = EMPTY_SESSION_CHAT_COMPOSER_HISTORY;
const note = { open: false, value: '', saved: '', edited: false, loading: false };
const composerChrome = new NativeComposerChrome(
  {
    listStashedPrompts: () => rpc('listStashedPrompts', { includeRecovery: false, includeDelivered: false }),
    readSessionNote: () => rpc('readSessionAgentNote'),
  },
  () => {
    if (controller) publish(controller.current());
  }
);
const receivingHandoffs = new Set<string>();
const receivedHandoffs = new Set<string>();
const deferred = new Map<string, SessionChatMessage[]>();
/** Per completed-work row: the read is in flight, or it failed and offers a retry (React: `DeferredWorkLoading`). */
const deferredWork = new Map<string, { loading: boolean; error?: string }>();

const markdownSave = new SessionChatMarkdownSaveController({
  list: () =>
    listProjectMarkdownDocumentPaths(bootConfig.projectId, (_, request) => rpc('runProjectDocsAction', request)),
  save: (params) =>
    saveProjectMarkdownDocument({ ...params, projectId: bootConfig.projectId }, (_, request) =>
      rpc('runProjectDocsAction', request)
    ),
  saved: (path) => {
    requests.push({ kind: 'markdownSaved', method: 'save', params: { path } });
  },
});
markdownSave.subscribe(() => {
  if (controller) publish(controller.current());
});

/** Rewind and Save prompt, the transcript's own per-message actions (native-message-actions.ts). */
const messageActions = new NativeChatMessageActions({
  rewind: (params) => rpc('rewindSessionChat', params),
  savePrompt: (content) => rpc('saveStashedPrompt', { content }),
  restore: (prompt) => {
    requests.push({ kind: 'composer', method: 'insert', params: { content: prompt, caret: prompt.length } });
  },
  changed: () => {
    if (controller) publish(controller.current());
  },
});

function schedule(callback: () => void, delay = 0, interval = 0): number {
  const id = ++sequence;
  timers.set(id, { at: Date.now() + delay, interval, callback });
  return id;
}

Object.assign(globalThis, {
  setTimeout: (callback: () => void, delay: number) => schedule(callback, delay),
  clearTimeout: (id: number) => timers.delete(id),
  setInterval: (callback: () => void, delay: number) => schedule(callback, delay, delay),
  clearInterval: (id: number) => timers.delete(id),
});

function rpc<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  if (preview) return preview.rpc<T>(method, params);
  const id = ++sequence;
  requests.push({ id, kind: 'rpc', method, params });
  return new Promise<T>((resolve, reject) => pending.set(id, { resolve, reject }));
}

function composer(operation: string, params: Record<string, unknown> = {}): Promise<any> {
  if (preview) return preview.composer(operation, params);
  const id = ++sequence;
  requests.push({ id, kind: 'broker', method: 'composer', params: { composer: { operation, ...params } } });
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

function noticeVisible(state: NativeChatState): boolean {
  return (
    state.terminalNotice !== null &&
    sessionChatTerminalNoticeDismissKey(state.terminalNotice) !== answeredNoticeKey &&
    !isNoticeDismissed(state.terminalNotice, dismissedNotice)
  );
}

function sendBlockedReason(state: NativeChatState): string | null {
  const notice = state.terminalNotice;
  const terminalChoicePending =
    !!notice &&
    !!(notice.choices?.length || notice.dialog || notice.conversationLock) &&
    `${notice.kind}:${notice.detectedAt}` !== retiredNoticeKey;
  return sessionChatSendBlockedReason({
    canSend: true,
    accountSwitchBusy: state.accountStatus.busy,
    conversationLocked: !!notice?.conversationLock,
    terminalChoicePending,
    noticeCardVisible: noticeVisible(state),
    sessionOptionSwitching: optionSwitching,
  });
}

function asyncQuestionsCanSend(state: NativeChatState): boolean {
  const notice = state.terminalNotice;
  const terminalChoicePending =
    !!notice &&
    !!(notice.choices?.length || notice.dialog || notice.conversationLock) &&
    `${notice.kind}:${notice.detectedAt}` !== retiredNoticeKey;
  return (
    !terminalChoicePending &&
    !optionSwitching &&
    !state.accountStatus.busy &&
    !(state.prompt?.kind === 'question' && promptKey !== dismissedPrompt) &&
    state.status !== 'error' &&
    state.status !== 'loading'
  );
}

/*
CDXC:SessionChat 2026-09-18 WHY:
React advances the empty region through the shared loading stages (skeleton at once since the
2026-09-19 decision in new-session-welcome.ts, Retry later) on timers of its own. GPUI chat renders
whatever the snapshot says, so the same stages have to be computed here to match.
*/
let loadingStage: SessionChatLoadingStage = 'blank';
let loadingStageTimers: ReturnType<typeof setTimeout>[] = [];
let loadingStageActive = false;

function trackTranscriptLoading(loading: boolean): void {
  if (loading === loadingStageActive) return;
  loadingStageActive = loading;
  for (const timer of loadingStageTimers) clearTimeout(timer);
  loadingStageTimers = [];
  loadingStage = 'blank';
  if (!loading) return;
  const advance = (stage: SessionChatLoadingStage) => () => {
    loadingStage = stage;
    if (controller) publish(controller.current());
  };
  loadingStageTimers = [
    setTimeout(advance('indicator'), SESSION_CHAT_LOADING_INDICATOR_DELAY_MS),
    setTimeout(advance('retry'), SESSION_CHAT_LOADING_RETRY_DELAY_MS),
  ];
}

function publish(state: NativeChatState): void {
  forkBranches.ensure();
  const nextNoticeKey = sessionChatTerminalNoticeDismissKey(state.terminalNotice);
  if (activeNoticeKey !== nextNoticeKey) {
    activeNoticeKey = nextNoticeKey;
    answeredNoticeKey = null;
    noticeError = undefined;
  }
  const nextPromptKey = sessionChatCardDismissKey(state.prompt);
  if (nextPromptKey !== promptKey) {
    promptKey = nextPromptKey;
    dismissedPrompt = null;
  }
  const nextContentKey = state.prompt === null ? null : `interactive:${JSON.stringify(state.prompt)}`;
  if (nextContentKey !== questionContentKey) {
    questionContentKey = nextContentKey;
    questionIndex = 0;
    questionTransition = false;
    answering = false;
    questionDrafts =
      state.prompt?.kind === 'question' ? state.prompt.questions.map(() => ({ indices: [], other: '' })) : [];
    questionDraftsLoading = state.prompt?.kind === 'question';
    if (questionDraftsLoading)
      void composer('questionRead', { promptKey: nextContentKey })
        .then((answers) => {
          if (questionContentKey !== nextContentKey) return;
          questionDrafts = questionDrafts.map((empty, index) => answers[index] ?? empty);
          questionDraftsLoading = false;
          publish(controller.current());
        })
        .catch((error) => {
          if (questionContentKey !== nextContentKey) return;
          questionDraftsLoading = false;
          operationError = error instanceof Error ? error.message : String(error);
          publish(controller.current());
        });
  }
  presentation.setWorkingDirectory(transport?.presentation?.getSnapshot().workingDirectory);
  const projection = presentation.update(state.messages, state.workingSignal, summaryMode, deferred, detailRevision);
  transcriptItems = projection.items;
  minimapMarkers = projection.minimap;
  subagentItems = subagentViewer.transcriptItems();
  if (operationErrorCode !== 'composerNotReady') terminalTail.retire();
  const {
    messages: _messages,
    skills: _skills,
    files: _files,
    requestSkills: _requestSkills,
    requestFiles: _requestFiles,
    ...viewState
  } = state;
  const composerSuggestions = suggestions.projection(state);
  const composerCollapseEligible = canCollapseSessionChatComposer({
    maximized: false,
    noteOpen: note.open,
    suggestionsOpen: composerSuggestions !== null,
    hasError: !!operationError,
    attachmentCount: draftAttachmentCount,
    pendingAttachments,
    queuedPrompts: state.queue.prompts.length,
  });
  if (!composerCollapseEligible || (state.prompt?.kind === 'question' && promptKey !== dismissedPrompt))
    composerCollapsed = false;
  trackTranscriptLoading(state.view.kind === 'loading');
  /*
  The agent identity the welcome greets the user with. A draft's own row wins over the
  transcript family, because a project custom agent built on Claude reports `claude` there
  and would otherwise greet the user as its base family.
  */
  const draftAgentRow = state.availableAgents?.find((row) => row.agentId === state.sessionAgentId) ?? null;
  const welcomeAgentName = draftAgentRow?.name ?? sessionChatWelcomeAgentName(state.agent);
  const welcomeAgentIcon = sessionChatWelcomeAgentIcon(state.agent, draftAgentRow?.icon);
  const questionCardVisible =
    promptKey !== null &&
    promptKey !== dismissedPrompt &&
    !(
      state.prompt?.kind === 'approval' &&
      state.terminalNotice?.kind === 'permissionPrompt' &&
      (!!state.terminalNotice.choices?.length || !!state.terminalNotice.dialog) &&
      `${state.terminalNotice.kind}:${state.terminalNotice.detectedAt}` !== retiredNoticeKey
    );
  // The welcome drops its headline once a notice or question card takes the space below it.
  const bottomCardVisible = noticeVisible(state) || questionCardVisible;
  snapshot = {
    ...viewState,
    composerCollapseEligible,
    ...(preview
      ? {
          previewSettings: {
            sessionChatTheme: preview.config.theme,
            sessionChatZoomPercent: preview.config.zoom,
            sessionChatVerboseMode: preview.config.verbose,
            sessionChatSimpleMode: preview.config.simple,
          },
        }
      : {}),
    modelPicker: modelPicker?.projection() ?? null,
    contextStatusRows,
    suggestions: composerSuggestions,
    composerCommand: suggestions.nativeCommand(state),
    contextEditor: nativeContextEditor(state, state.accounts),
    saveMarkdown: markdownSave.getSnapshot(),
    ...panels.project(state.agentFleet, state.agentTasks, state.agent),
    transcriptSearch: search.project(transcriptItems),
    subagent: subagentViewer.projection(),
    terminalTail: terminalTail.project(),
    forkBranches: forkBranches.project(),
    /*
    The user rail's own actions. `rewindAvailable` is React's `rewindToMessage` gate (a host that
    can reach `/api/rewindSessionChat` and an agent whose rewind Ghostex drives); `rewindEnabled`
    is its live `canRewind` gate, the same condition that lets the composer send, because the
    daemon types the rewind into that same pane. A preview backend answers no rewind route at all,
    which is why the Chat Lab offers the action in neither chat.
    */
    rewindAvailable: !preview && sessionChatAgentSupportsRewind(state.agent),
    rewindEnabled: sendBlockedReason(state) === null,
    rewind: messageActions.projection(),
    savedPrompts: messageActions.savedPrompts(),
    queue: {
      ...state.queue,
      prompts: state.queue.prompts.map((prompt) => ({
        ...prompt,
        preview: sessionChatQueueRowPreview(prompt.text),
        busy: isSessionChatQueueRowBusy(prompt),
      })),
    },
    hostActions: chatHostActionDefinitions
      .filter((action) => !COMPOSER_MENU_EXCLUDED_HOST_ACTION_IDS.has(action.id))
      .map((action) => ({
        ...action,
        group: AGENT_HOST_ACTION_IDS.has(action.id) ? 'agent' : 'session',
      })),
    /*
    Which composer controls the host can actually serve, the gate React applies by only passing the
    handler it has (`onSessionNote`, `onStash`, `onAttach`, the Terminal View switch). A preview
    backend has no session note, no stash bridge, no attachment picker and no terminal to switch to,
    so those controls stay out of the toolbar instead of doing nothing when clicked.
    */
    composerActions: {
      summary: true,
      note: !!transport?.readSessionNote && !!transport?.saveSessionNote && state.agentSessionId !== null,
      stash: !preview,
      attach: !preview,
      terminal: !preview,
    },
    // React picks this copy from the view, not the agent status (session-chat-view.tsx `emptyKind`).
    emptyState: sessionChatEmptyStateCopy(state.view.kind === 'ready' ? 'empty' : state.view.kind, state.agent),
    /*
    The new-session welcome, projected for GPUI chat the same way React renders it: a
    `starting` or `empty` transcript greets the user with the agent mark and headline
    instead of falling through to the `emptyState` loading copy.
    */
    newSessionWelcome: sessionChatShowsNewSessionWelcome(state.view.kind)
      ? {
          agentName: welcomeAgentName,
          icon: welcomeAgentIcon ?? null,
          showTitle: !bottomCardVisible,
          title: sessionChatNewSessionWelcomeTitle(welcomeAgentName),
        }
      : null,
    loadingStage: state.view.kind === 'loading' ? loadingStage : null,
    noticeVisible: noticeVisible(state),
    noticeError,
    terminalNotice: state.terminalNotice
      ? {
          ...state.terminalNotice,
          collapsedChoiceCount: COLLAPSED_CHOICE_COUNT,
          dialog: state.terminalNotice.dialog
            ? { ...state.terminalNotice.dialog, presentation: terminalDialogPresentation(state.terminalNotice.dialog) }
            : undefined,
          choices: state.terminalNotice.choices
            ?.filter((choice) => choice.label.trim())
            .map((choice) => ({
              ...choice,
              collapsedLabel: collapsedChoiceLabel(
                state.terminalNotice?.dialog?.rows[choice.index]?.label ?? choice.label
              ),
              answer: terminalNoticeChoiceAnswer(state.terminalNotice, choice.index),
            })),
          actions: state.terminalNotice.actions?.flatMap((action) => {
            const answer = terminalNoticeActionAnswer(state.terminalNotice!, action);
            return action.kind === 'switchToTerminal' || answer ? [{ ...action, answer }] : [];
          }),
        }
      : null,
    operationError,
    operationErrorCode: operationErrorCode ?? null,
    pendingAttachments,
    optionDispatchId,
    sendBlockedReason: sendBlockedReason(state),
    composerPlaceholder:
      sessionChatComposerPlaceholder({
        canSend: true,
        terminalChoicePending:
          !!state.terminalNotice &&
          !!(
            state.terminalNotice.choices?.length ||
            state.terminalNotice.dialog ||
            state.terminalNotice.conversationLock
          ) &&
          `${state.terminalNotice.kind}:${state.terminalNotice.detectedAt}` !== retiredNoticeKey,
        controlsOnly: state.terminalNotice?.dialog?.rows.length === 0,
        noticeCardVisible: noticeVisible(state),
        sessionOptionSwitching: optionSwitching,
      }) ?? DESKTOP_SESSION_CHAT_PLACEHOLDER,
    summaryMode,
    verboseOverride,
    composerOverflow,
    composerCollapsed,
    historyActive: composerHistory.index !== null,
    interaction: {
      queueLongPressMs: SESSION_CHAT_QUEUE_LONG_PRESS_MS,
      stopButtonCooldownMs: SESSION_CHAT_STOP_BUTTON_COOLDOWN_MS,
    },
    incomingDraft,
    note: { ...note },
    composerChrome: composerChrome.projection(note, summaryMode, state.agentSessionId),
    asyncQuestions: asyncQuestions.project(
      state.messages,
      asyncQuestionsCanSend(state),
      state.working,
      state.retiredAsyncQuestionIds
    ),
    questionCard: {
      visible: questionCardVisible,
      questionIndex,
      controls: questionAnswerControls(
        questionDrafts,
        questionIndex,
        state.prompt?.kind === 'question' ? state.prompt.questions.length : 0,
        answering
      ),
      drafts: questionDrafts,
      answering,
      busy: answering || questionTransition,
      loading: questionDraftsLoading,
    },
    finalIds: projection.finalIds,
    deferredWork: Object.fromEntries(deferredWork),
  };
  revision++;
}

function start(config: {
  clientId: string;
  projectId: string;
  initialSnapshot?: any;
  initialPresentation?: any;
  preview?: ChatPreviewConfig;
}): void {
  if (config.preview) preview = new ChatPreviewBackend(config.preview);
  bootConfig = config;
  if (booting) return;
  booting = true;
  void composer('read')
    .then((result) => {
      controller?.dispose();
      adoptAgentModelCatalog(result.modelCatalog);
      adoptNativeContextPreferences(result.contextPreferences);
      adoptNativeChatSettings(result.chatSettings);
      optionPersistence = nativeOptionPersistence(result, composer, (error) => {
        operationError = error instanceof Error ? error.message : String(error);
        if (controller) publish(controller.current());
      });
      requests.push({ kind: 'composerInit', method: 'restore', params: result });
      dismissedNotice = result.dismissedNotice ?? null;
      summaryMode = result.summaryMode === true;
      verboseOverride = result.verboseOverride ?? null;
      startController({ ...config, clientId: result.clientId });
      void asyncQuestions.load();
    })
    .catch((error) => {
      transcriptItems = [];
      snapshot = { status: 'error', error: String(error) };
      revision++;
    })
    .finally(() => {
      booting = false;
    });
}

function onUnconfirmedOptions(): void {
  operationError = 'The agent did not confirm the selection. The controls now reflect the latest detected settings.';
}

function startController(config: { clientId: string; initialSnapshot?: any; initialPresentation?: any }): void {
  transport = {
    getCachedSnapshot: () => preview?.snapshot ?? config.initialSnapshot ?? undefined,
    presentation: createSessionChatPresentationStore(config.initialPresentation ?? undefined, (state) =>
      requests.push({ kind: 'broker', method: 'presentation', params: { state } })
    ),
    read: (params) => rpc('readSessionChat', params),
    readSkills: () => rpc('readSessionChatSkills'),
    readFiles: () => rpc('readSessionChatFiles'),
    readHistory: (params) => rpc('readSessionChat', { ...params, historyMode: params.detail ? 'detail' : 'turns' }),
    readSubagent: (params) => rpc('readSessionChat', params),
    subscribe: ({ onEvent, currentLimit }) => {
      eventListener = onEvent;
      if (preview) return preview.subscribe(onEvent);
      requests.push({ kind: 'broker', method: 'subscribe', params: { limit: currentLimit?.() ?? 120, catalog: true } });
      return () => {
        eventListener = undefined;
        requests.push({ kind: 'broker', method: 'unsubscribe', params: {} });
      };
    },
    reconnect: () => requests.push({ kind: 'broker', method: 'reconnect', params: {} }),
    send: (text, imagePaths, draftVersion) => rpc('sendSessionChatMessage', { text, imagePaths, draftVersion }),
    sendKey: (key) => rpc('sendSessionChatMessage', { key }),
    interrupt: () => rpc('interruptSessionChat'),
    answerPrompt: (params) => rpc('answerSessionChatPrompt', params),
    queuePrompt: (params) => rpc('queueSessionChatPrompt', params),
    updateQueuedPrompt: (params) => rpc('updateSessionChatQueuedPrompt', params),
    removeQueuedPrompt: (params) => rpc('removeSessionChatQueuedPrompt', params),
    reorderQueue: (params) => rpc('reorderSessionChatQueue', params),
    sendQueuedPrompt: (params) => rpc('sendSessionChatQueuedPrompt', params),
    setDraft: (params) => rpc('setSessionChatDraft', params),
    rewindSessionChat: (params) => rpc('rewindSessionChat', params),
    loadImage: (params) => rpc('readSessionChatImage', params),
  };
  controller = new ChatComputation((lifecycle) => {
    const chat = computeSessionChat(
      {
        transport,
        clientId: config.clientId,
        onDeliveredDrafts: (deliveries) => {
          if (deliveries.length) void composer('deliveries', { deliveries }).catch(() => {});
        },
      },
      lifecycle
    );
    const controls = computeNativeChatControls(chat, rpc, lifecycle);
    const options = computeNativeChatOptions(
      chat,
      optionPersistence,
      rpc,
      onUnconfirmedOptions,
      controls.accounts,
      lifecycle
    );
    lifecycle.useEffect(() => {
      if (chat.returnedPrompt) void action({ type: 'restoreReturned', returned: chat.returnedPrompt });
    }, [chat.returnedPrompt?.id]);
    const context = computeNativeChatContext(
      chat,
      options.sessionOptions.catalog?.modelIcon,
      controls.accounts,
      lifecycle
    );
    const skills = computeSessionChatSkills(transport, chat.sessionAgentId, lifecycle);
    const files = computeSessionChatFiles(transport, lifecycle);
    const strip = computeSessionChatWorkingStrip(
      !controls.accountStatus.busy && chat.sessionWorking,
      controls.accountStatus.busy ? null : chat.terminalActivity,
      lifecycle
    );
    const workingStrip = { ...strip, presentation: computeSessionChatActivity(strip.activity, lifecycle) };
    return { ...chat, ...controls, ...options, ...context, ...skills, ...files, workingStrip };
  }, publish);
  controller.run();
}

async function action(command: { type: string; [key: string]: any }): Promise<void> {
  if (!controller) {
    if (command.type === 'retry') start(bootConfig);
    return;
  }
  const chat = controller.current();
  if (command.type === 'composerScroll' || command.type === 'composerExpand') {
    // The subagent transcript is modal: a wheel over it is not a composer gesture.
    if (subagentViewer.isOpen()) return;
    const now = Date.now();
    const previous = composerCollapsed;
    if (now - composerScrollGesture.lastEventAt > COMPOSER_SCROLL_RESET_MS)
      resetSessionChatComposerScrollGesture(composerScrollGesture);
    if (command.type === 'composerExpand') {
      if (command.editor)
        suppressSessionChatComposerScrollGesture(composerScrollGesture, now, COMPOSER_SCROLL_RESET_MS);
      composerCollapsed = false;
    } else {
      const atBottom = command.distanceToEnd <= COMPOSER_BOTTOM_THRESHOLD_PX;
      if (
        recordSessionChatComposerScrollGesture(composerScrollGesture, {
          now,
          deltaPx: Math.abs(command.delta),
          collapseThresholdPx: COMPOSER_SCROLL_THRESHOLD_PX,
          collapseEligible: command.eligible && !composerCollapsed,
          canScrollInGestureDirection: command.canScroll,
          scrollsTowardLogicalEnd: command.delta < 0 && atBottom,
        })
      )
        composerCollapsed = true;
      if (!command.eligible || (command.delta < 0 && atBottom)) composerCollapsed = false;
    }
    if (previous !== composerCollapsed) publish(chat);
    return;
  }
  // Panel folds, transcript search, terminal-tail reads and the subagent viewer are pure view state: they never clear a send error.
  if (
    panels.command(command) ||
    search.command(command) ||
    terminalTail.command(command) ||
    subagentViewer.command(command)
  ) {
    publish(chat);
    return;
  }
  const clearedError = operationError !== undefined;
  if (
    ![
      'restoreSubmission',
      'composerSelection',
      'suggestionHighlight',
      'measureComposer',
      'measureContextStatus',
    ].includes(command.type)
  ) {
    operationError = undefined;
    operationErrorCode = undefined;
  }
  try {
    switch (command.type) {
      case 'completeComposerCommand': {
        const content = suggestions.nativeCommand(chat);
        if (content !== null)
          requests.push({ kind: 'composer', method: 'insert', params: { content, caret: content.length } });
        break;
      }
      case 'composerSelection':
        suggestions.update(command.text, command.caret);
        break;
      case 'suggestionKey':
      case 'suggestionPick':
      case 'suggestionHighlight':
      case 'suggestionRetry':
      case 'suggestionDismiss': {
        const completion = suggestions.command(command, chat);
        if (completion && 'content' in completion)
          requests.push({ kind: 'composer', method: 'insert', params: completion });
        break;
      }
      // The branch switcher's pick. The app shell owns the switch: a stopped branch is woken in place first.
      case 'selectForkBranch':
        requests.push({
          kind: 'host',
          method: 'selectForkBranch',
          params: {
            projectId: command.projectId,
            sessionId: command.sessionId,
            lifecycleState: command.lifecycleState,
          },
        });
        break;
      case 'markdownSaveOpen':
        markdownSave.open(nativeContextTitle() ?? '', command.markdown);
        break;
      case 'markdownSaveFolder':
        markdownSave.folder(command.value);
        break;
      case 'markdownSaveName':
        markdownSave.fileName(command.value);
        break;
      case 'markdownSaveCancel':
        markdownSave.close();
        break;
      case 'markdownSaveSubmit':
        await markdownSave.submit();
        break;
      case 'contextEdit':
      case 'contextCancel':
      case 'contextQuery':
      case 'contextShown':
      case 'contextStar':
      case 'contextReorder':
      case 'contextReset':
      case 'contextSave':
        await nativeContextEditorCommand(
          command,
          chat.sessionOptions.catalog?.modelIcon === 'codex' ? 'codex' : 'claude',
          (agent, preferences) => composer('contextSave', { agent, preferences }),
          () => publish(controller.current())
        );
        break;
      case 'measureContextStatus':
        if (command.available > 0)
          contextStatusRows = balancedRowStarts(command.widths, command.available, command.separator);
        break;
      case 'contextCompact':
        if (!chat.working) await chat.send('/compact');
        break;
      // Switch Account panel and switch-card requests (select, refresh, policy, stop recovery, retry).
      case 'accounts':
        await chat.requestAccounts(command.request);
        break;
      case 'switchDraftAgent': {
        if (
          !chat.availableAgents?.some((agent) => agent.agentId === command.agentId) ||
          chat.sessionAgentId === command.agentId
        )
          break;
        await composer('flush');
        try {
          await rpc('switchDraftAgent', { agentId: command.agentId });
        } finally {
          chat.refresh();
          for (const delay of [2000, 6000]) schedule(() => chat.refresh(), delay);
        }
        break;
      }
      case 'selectOption': {
        const options = chat.sessionOptions;
        const descriptor = [options.catalog?.model, ...options.optionDescriptors].find(
          (entry) => entry?.id === command.descriptorId
        );
        if (!descriptor) break;
        if (command.value !== undefined && options.state[descriptor.id]?.value === command.value) break;
        const delivery = command.exitPlan
          ? { ...descriptor, dispatch: { kind: 'key' as const, key: 'shift-tab' as const, marker: '' } }
          : descriptor;
        if (
          queueSessionChatOption(delivery, command.value, {
            catalog: options.catalog,
            state: options.state,
            queuedControls: options.catalog?.modelIcon === 'codex' || options.catalog?.modelIcon === 'claude',
            quickPicker: !!chat.modelProvider,
            picker: chat.modelSelection,
            scope: modelScopeForPills(chat.modelProvider, chat.modelSelection.alsoSetDefault),
          })
        )
          break;
        if (optionDispatchId || chat.working) break;
        optionDispatchId = descriptor.id;
        publish(chat);
        try {
          await dispatchSessionChatOption(delivery, command.value, {
            ...options,
            onDispatchCommand: async (text) => {
              options.reconcileTypedCommand(text);
              await chat.send(text);
              if (chat.availableAgents) chat.refresh();
            },
            onDispatchKey: async (key, marker) => {
              await chat.sendKey?.(key, marker);
            },
            onPickModel:
              chat.agent === 'codex'
                ? async (selection) => {
                    await rpc('selectSessionChatModel', { ...selection });
                  }
                : undefined,
            onSwitchToTerminal: () => requests.push({ kind: 'host', method: 'switchToTerminal', params: {} }),
            onSwitchingChange: (switching) => {
              optionSwitching = switching;
              publish(controller.current());
            },
          });
        } finally {
          optionDispatchId = null;
        }
        break;
      }
      case 'toggleModelPicker': {
        if (modelPicker) {
          modelPicker.finish(false);
          break;
        }
        if (!chat.modelProvider) break;
        const desired = chat.modelSelection.desired;
        const request = createModelPickerRequest(
          currentAgentModelCatalog(),
          chat.modelProvider,
          desired?.model || chat.sessionOptions.state.model?.value,
          desired?.effort || chat.sessionOptions.state.effort?.value
        );
        if (!request) break;
        const sessionKey = chat.sessionOptions.sessionKey;
        modelPicker = new NativeModelPicker(
          request,
          () => publish(controller.current()),
          (selection, scope) => {
            const current = controller.current();
            if (
              selection &&
              current.sessionOptions.sessionKey === sessionKey &&
              !modelSelectionUnchanged(
                selection,
                current.modelSelection.desired,
                {
                  model: current.sessionOptions.state.model?.value,
                  effort: current.sessionOptions.state.effort?.value,
                },
                request,
                scope
              )
            ) {
              current.modelSelection.select(selection, undefined, scope);
            }
            modelPicker?.dispose();
            modelPicker = null;
            publish(controller.current());
          }
        );
        if (command.size) modelPicker.measure(command.size);
        break;
      }
      case 'modelPickerMeasure':
        modelPicker?.measure(command.size);
        break;
      case 'modelPickerPane':
        modelPicker?.pane(command.size);
        break;
      case 'modelPickerKey':
        modelPicker?.key(command.key);
        break;
      case 'modelPickerKeyUp':
        modelPicker?.release(command.key);
        break;
      case 'modelPickerBlur':
        modelPicker?.blur();
        break;
      case 'modelPickerControl':
        modelPicker?.navigate(command.control);
        break;
      case 'modelPickerScroll':
        modelPicker?.scroll(command.input);
        break;
      case 'modelPickerModel':
        modelPicker?.chooseModel(command.index, command.save, command.pointer);
        break;
      case 'modelPickerEffort':
        modelPicker?.chooseEffort(command.index, command.save);
        break;
      case 'modelPickerCancel':
        modelPicker?.finish(false);
        break;
      case 'setModelScopeDefault':
        controller.current().modelSelection.setAlsoSetDefault(command.value);
        break;
      case 'measureComposer':
        composerOverflow = fitChatComposerControls(command.measurements);
        break;
      case 'toggleSummary':
        summaryMode = await composer('summary', { enabled: !summaryMode });
        break;
      case 'setVerbose':
        verboseOverride = await composer('verbose', { enabled: command.enabled });
        break;
      case 'toggleNote': {
        if (note.open) {
          await flushSessionNote(note, note.value, (value) => rpc('saveSessionAgentNote', { note: value }));
          note.open = false;
        } else {
          note.open = true;
          note.loading = true;
          note.edited = false;
          publish(chat);
          try {
            const result = await rpc<{ note?: string }>('readSessionAgentNote');
            note.saved = (result.note ?? '').trim();
            if (!note.edited) note.value = result.note ?? '';
          } finally {
            note.loading = false;
          }
        }
        break;
      }
      case 'editNote':
        note.edited = true;
        note.value = command.text;
        break;
      case 'clearNote':
        note.edited = true;
        note.value = '';
      case 'saveNote':
        await flushSessionNote(note, note.value, (value) => rpc('saveSessionAgentNote', { note: value }));
        break;
      case 'attachmentsStarted':
        pendingAttachments++;
        break;
      case 'attachmentsFinished':
        pendingAttachments = Math.max(0, pendingAttachments - 1);
        if (command.error) operationError = command.error;
        if (command.paths?.length)
          requests.push({ kind: 'attachmentReferences', method: 'insert', params: { paths: command.paths } });
        break;
      case 'attachPaths': {
        pendingAttachments++;
        publish(chat);
        try {
          const paths = await rpc<string[]>('importNativeAttachments', { paths: command.paths });
          requests.push({ kind: 'attachmentReferences', method: 'insert', params: { paths } });
        } finally {
          pendingAttachments--;
        }
        break;
      }
      case 'insertAttachments': {
        let text = command.text as string;
        let caret = command.start as number;
        let end = command.end as number;
        for (const path of command.paths as string[]) {
          const result = insertChatReference(text, nativePathReference(path, text), caret, end);
          text = result.text;
          caret = result.caret;
          end = caret;
        }
        requests.push({ kind: 'composer', method: 'insert', params: { content: text, caret } });
        break;
      }
      case 'removeAttachment': {
        const result = removeChatReference(command.text as string, command.start as number, command.end as number);
        requests.push({ kind: 'composer', method: 'insert', params: { content: result.text, caret: result.caret } });
        break;
      }
      case 'appendToDraft': {
        // The transcript menu's Add to Chat, appended the way React's `appendText` does, caret at the end.
        const content = sessionChatAppendDraftText(command.draft as string, command.text as string);
        requests.push({ kind: 'composer', method: 'insert', params: { content, caret: content.length } });
        break;
      }
      case 'refreshComposerChrome':
        await composerChrome.refresh(command.sessionId ?? null);
        break;
      case 'stash': {
        if (!command.text?.trim()) break;
        await rpc('saveStashedPrompt', { content: command.text });
        requests.push({ kind: 'composerClearExpected', method: 'stash', params: { text: command.text } });
        void composerChrome.refresh();
        break;
      }
      case 'restoreReturned': {
        if (await composer('claimReturned', { returnedId: command.returned.id }))
          requests.push({ kind: 'returnedPrompt', method: 'restore', params: { text: command.returned.text } });
        break;
      }
      case 'applyReturned': {
        const content = command.current.includes(command.text)
          ? command.current
          : restoreUndeliveredChatText(command.text, command.current);
        requests.push({ kind: 'composer', method: 'insert', params: { content } });
        break;
      }
      case 'editDraft': {
        trackDraftAttachments(command.text);
        const historyChanged = !command.history && composerHistory.index !== null;
        if (!command.history) composerHistory = resetSessionChatComposerHistoryIndex(composerHistory);
        await composer('write', { text: command.text, version: command.draftVersion });
        if (!clearedError && !historyChanged) return;
        break;
      }
      case 'recallHistory': {
        if (command.direction === 'up' && composerHistory.index === null)
          composerHistory = { entries: await composer('history'), index: null };
        const recalled =
          command.direction === 'up'
            ? recallPreviousSessionChatDraft(composerHistory)
            : recallNextSessionChatDraft(composerHistory);
        if (recalled) {
          composerHistory = recalled.history;
          suggestions.recall(recalled.draft);
          requests.push({ kind: 'composer', method: 'history', params: { content: recalled.draft } });
        }
        break;
      }
      case 'send':
      case 'queue':
      case 'compact': {
        const blocked = sendBlockedReason(chat);
        if (blocked) {
          requests.push({ kind: 'submissionFailed', method: command.type, params: { text: command.text } });
          throw new Error(blocked);
        }
        const attempt = { cancelled: false };
        // The draft leaves with its pictures; a refusal re-inserts the text and counts them again.
        draftAttachmentCount = 0;
        submissionAttempt = attempt;
        try {
          try {
            await composer('write', { text: command.text, version: command.draftVersion, submitted: true });
            await composer('flush');
            await deliverChatSubmission({
              text: command.text,
              version: command.draftVersion,
              mode: command.type,
              push: chat.draft.canSync ? chat.draft.push : undefined,
              send: (text, version) =>
                sendSessionChatOptionAware(text, version, {
                  reconcileTypedCommand: chat.sessionOptions.reconcileTypedCommand,
                  send: (text, version) => chat.send(text, command.imagePaths, version),
                  isDraft: chat.availableAgents !== null,
                  refresh: chat.refresh,
                }),
              queue: chat.queue.queuePrompt,
              cancelled: () => attempt.cancelled,
            });
          } catch (error) {
            requests.push({ kind: 'submissionFailed', method: command.type, params: { text: command.text } });
            throw error;
          }
          requests.push({
            kind: 'draftSubmitted',
            method: command.type,
            params: { text: command.text, version: command.draftVersion },
          });
          await composer('submitted', { text: command.text, version: command.draftVersion });
        } finally {
          submissionAttempt = undefined;
        }
        break;
      }
      case 'restoreSubmission':
        requests.push({
          kind: 'composer',
          method: 'insert',
          params: { content: restoreUndeliveredChatText(command.text, command.current) },
        });
        break;
      case 'handoff': {
        await composer('write', { text: command.text, version: command.draftVersion });
        await chat.draft.push(command.text, command.draftVersion);
        const handoff = await composer('park', { text: command.text, version: command.draftVersion });
        requests.push({
          kind: 'draftSubmitted',
          method: 'handoff',
          params: { ...handoff, text: command.text, version: command.draftVersion },
        });
        requests.push({ kind: 'host', method: 'draftHandoffToTerminalComplete', params: handoff });
        break;
      }
      case 'receiveHandoff': {
        if (receivingHandoffs.has(command.handoffId)) return;
        receivingHandoffs.add(command.handoffId);
        try {
          const consumed =
            command.draftVersion &&
            chat.draft.synced?.consumedDrafts?.some(
              (receipt) =>
                receipt.draftId === command.draftVersion.draftId && receipt.revision >= command.draftVersion.revision
            );
          if (!receivedHandoffs.has(command.handoffId) && !consumed) {
            const result = await composer('receive', {
              text: command.content,
              version: command.draftVersion,
              current: command.current,
            });
            if (result.disposition === 'conflict')
              incomingDraft = { content: command.content, version: result.version };
            else if (result.disposition === 'accept')
              requests.push({
                kind: 'draftReceived',
                method: 'handoff',
                params: { content: command.content, version: result.entry.version, previous: command.current },
              });
            receivedHandoffs.add(command.handoffId);
          }
          await rpc('acknowledgeSessionChatDraftHandoff', { handoffId: command.handoffId });
          requests.push({
            kind: 'host',
            method: 'draftHandoffToChatComplete',
            params: { handoffId: command.handoffId },
          });
        } finally {
          receivingHandoffs.delete(command.handoffId);
        }
        break;
      }
      case 'dismissIncomingDraft':
        incomingDraft = null;
        break;
      case 'useIncomingDraft':
        if (incomingDraft)
          requests.push({ kind: 'composer', method: 'insert', params: { content: incomingDraft.content } });
        incomingDraft = null;
        break;
      case 'interrupt':
        if (submissionAttempt) submissionAttempt.cancelled = true;
        await chat.interrupt();
        break;
      case 'dismissNotice':
        if (chat.terminalNotice && !chat.terminalNotice.choices?.length && !chat.terminalNotice.dialog) {
          dismissedNotice = dismissedNoticeState(chat.terminalNotice);
          publish(chat);
          dismissedNotice = await composer('dismissNotice', { notice: chat.terminalNotice });
        }
        break;
      case 'noticePrimary':
      case 'noticeSecondary': {
        if (!noticeVisible(chat)) break;
        const choices = chat.terminalNotice!.choices?.filter((choice) => choice.label.trim()) ?? [];
        const choice = choices[command.type === 'noticePrimary' ? 0 : 1];
        const noticeAction = chat
          .terminalNotice!.actions?.map((action) => terminalNoticeActionAnswer(chat.terminalNotice!, action))
          .find(Boolean);
        const answer = choice
          ? terminalNoticeChoiceAnswer(chat.terminalNotice, choice.index)
          : command.type === 'noticePrimary'
            ? noticeAction
            : null;
        if (answer) await action({ type: 'answer', answer });
        break;
      }
      case 'answer':
        if (answering) break;
        answering = true;
        noticeError = undefined;
        if (
          command.answer.kind === 'terminalChoice' ||
          (command.answer.kind === 'terminalDialog' && typeof command.answer.choiceIndex === 'number')
        )
          answeredNoticeKey = activeNoticeKey;
        publish(chat);
        try {
          const key = promptKey;
          await chat.answerPrompt(command.answer);
          if (
            command.answer.kind === 'approval' ||
            command.answer.kind === 'question' ||
            chat.terminalNotice?.kind === 'permissionPrompt'
          )
            dismissedPrompt = key;
        } catch (error) {
          answeredNoticeKey = null;
          if (command.answer.kind === 'terminalChoice' && chat.terminalNotice && !chat.terminalNotice.dialog)
            retiredNoticeKey = `${chat.terminalNotice.kind}:${chat.terminalNotice.detectedAt}`;
          throw error;
        } finally {
          answering = false;
        }
        break;
      case 'asyncQuestionToggle':
        asyncQuestions.toggle();
        break;
      case 'asyncQuestionNavigate': {
        const state = asyncQuestions.project(
          chat.messages,
          asyncQuestionsCanSend(chat),
          chat.working,
          chat.retiredAsyncQuestionIds
        );
        asyncQuestions.navigate(command.direction === 'previous' ? state.previousKey : state.nextKey);
        break;
      }
      case 'asyncQuestionText':
        asyncQuestions.edit(command.key, () => command.text);
        break;
      case 'asyncQuestionOption': {
        const state = asyncQuestions.project(
          chat.messages,
          asyncQuestionsCanSend(chat),
          chat.working,
          chat.retiredAsyncQuestionIds
        );
        if (
          !state.disabled &&
          state.question?.key === command.key &&
          state.question.options?.[command.index] !== undefined
        )
          asyncQuestions.select(command.key, command.index);
        break;
      }
      case 'asyncQuestionSend':
      case 'asyncQuestionSkip':
        await asyncQuestions.submit(
          chat.messages,
          asyncQuestionsCanSend(chat),
          command.type === 'asyncQuestionSkip',
          (questionId, text, skip) =>
            chat.answerPrompt(
              skip ? { kind: 'dismissAsyncQuestion', questionId } : { kind: 'asyncQuestion', questionId, text }
            ),
          chat.retiredAsyncQuestionIds
        );
        break;
      case 'questionText': {
        if (answering || questionTransition || questionDraftsLoading || !questionDrafts[questionIndex]) break;
        questionDrafts[questionIndex] = { ...questionDrafts[questionIndex]!, other: command.text };
        publish(chat);
        await composer('questionWrite', {
          promptKey: questionContentKey,
          answers: Object.fromEntries(questionDrafts.map((draft, index) => [index, draft])),
        });
        break;
      }
      case 'questionBack':
        if (!answering && !questionTransition && !questionDraftsLoading) questionIndex = Math.max(0, questionIndex - 1);
        break;
      case 'questionOption':
      case 'questionNext': {
        if (chat.prompt?.kind !== 'question' || answering || questionTransition || questionDraftsLoading) break;
        const question = chat.prompt.questions[questionIndex]!;
        const contentKey = questionContentKey;
        if (command.type === 'questionOption') {
          if (!question.options[command.index]) break;
          questionDrafts = selectQuestionOption(questionDrafts, questionIndex, question.multiSelect, command.index);
          const answers = Object.fromEntries(questionDrafts.map((draft, index) => [index, draft]));
          questionTransition = true;
          publish(chat);
          try {
            await composer('questionWrite', { promptKey: contentKey, answers });
          } finally {
            if (questionContentKey === contentKey) questionTransition = false;
          }
          if (questionContentKey !== contentKey || question.multiSelect) break;
        }
        if (questionIndex < chat.prompt.questions.length - 1) questionIndex++;
        else {
          if (!questionDrafts.some((draft) => draft.indices.length || draft.other.trim())) break;
          answering = true;
          const key = promptKey;
          const drafts = questionDrafts;
          publish(chat);
          try {
            await chat.answerPrompt({
              kind: 'question',
              selections: drafts.map((draft) => ({
                indices: draft.indices,
                ...(draft.other.trim() ? { other: draft.other.trim() } : {}),
              })),
            });
            dismissedPrompt = key;
            await composer('questionClear', {
              promptKey: contentKey,
              answers: Object.fromEntries(drafts.map((draft, index) => [index, draft])),
            });
          } finally {
            if (questionContentKey === contentKey) answering = false;
          }
        }
        break;
      }
      case 'questionCancel': {
        if (answering || questionTransition || questionDraftsLoading) break;
        dismissedPrompt = promptKey;
        if (questionContentKey)
          await composer('questionClear', {
            promptKey: questionContentKey,
            answers: Object.fromEntries(questionDrafts.map((draft, index) => [index, draft])),
          });
        await chat.interrupt();
        break;
      }
      case 'loadImage': {
        /*
        The picture behind an "[Image #N](path)" reference lives on the session's machine, so GPUI
        chat cannot open it directly either: the bytes come back over the same transport React reads
        them through, and Chat Lab's preview backend answers the same call. A file that has gone
        reports back as unreadable rather than raising the composer's error bar.
        */
        try {
          const image = await transport.loadImage!({ path: command.path });
          requests.push({
            kind: 'chatImage',
            method: 'loaded',
            params: { path: command.path, base64Data: image.base64Data, mediaType: image.mediaType },
          });
        } catch {
          requests.push({ kind: 'chatImage', method: 'failed', params: { path: command.path } });
        }
        break;
      }
      case 'rewindOpen':
        messageActions.open(command.messageId, command.prompt, chat.agent);
        break;
      case 'rewindCancel':
        messageActions.close();
        break;
      case 'rewindSubmit':
        await messageActions.submit();
        break;
      case 'savePrompt':
        await messageActions.save(command.messageId, command.prompt);
        break;
      case 'sendKey':
        await chat.sendKey?.(command.key, command.marker ?? '');
        break;
      case 'openMarkdownLink': {
        const target = classifySessionChatLinkHref(command.href);
        if (target.kind === 'file')
          requests.push({
            kind: 'host',
            method: 'openFile',
            params: { path: target.path, ...sessionChatFilePositionFromHref(command.href) },
          });
        else if (target.kind === 'url')
          requests.push({
            kind: 'host',
            method: 'openLink',
            params: { url: target.url, external: command.external === true },
          });
        break;
      }
      case 'openComposerReference': {
        // React's composer (`use-session-chat-reference-interactions.ts`) opens a pill only when its destination is a local file; a web link pill is inert.
        const target = classifySessionChatLinkHref(command.href);
        if (target.kind === 'file')
          requests.push({
            kind: 'host',
            method: 'openFile',
            params: { path: target.path, ...sessionChatFilePositionFromHref(command.href) },
          });
        break;
      }
      case 'retry':
        chat.retry();
        break;
      case 'refresh':
        chat.refresh();
        break;
      case 'loadEarlier':
        chat.loadEarlier();
        break;
      case 'retryQueue':
        await chat.queue.retryPrompt(command.promptId);
        break;
      case 'removeQueue': {
        if (command.edit) {
          const original = chat.queue.prompts.find((prompt) => prompt.id === command.promptId);
          if (!original || !chat.queue.capabilities.canEdit || isSessionChatQueueRowBusy(original)) break;
          const content = await editQueuedChatPrompt({
            original: original.text,
            remove: () => chat.queue.removePrompt(command.promptId),
            readCurrent: () => rpc<string>('readNativeComposer'),
            queue: chat.queue.queuePrompt,
          });
          requests.push({ kind: 'composer', method: 'insert', params: { content } });
        } else await chat.queue.removePrompt(command.promptId);
        break;
      }
      case 'sendQueue':
        await chat.queue.sendNow(command.promptId);
        break;
      case 'reorderQueue':
        await chat.queue.reorder(command.promptIds);
        break;
      case 'moveQueue': {
        const prompts = chat.queue.prompts;
        const from = prompts.findIndex((prompt) => prompt.id === command.promptId);
        const to = prompts.findIndex((prompt) => prompt.id === command.targetId);
        if (from >= 0 && to >= 0 && !isSessionChatQueueRowBusy(prompts[from]!)) {
          await chat.queue.reorder(sessionChatQueuePromptIds(moveSessionChatQueueRow(prompts, from, to)));
        }
        break;
      }
      case 'saveDraft':
        trackDraftAttachments(command.content);
        await chat.draft.push(command.content, command.draftVersion);
        break;
      case 'loadWork': {
        // The failure belongs to the row that asked for it, not to the composer's error bar, so it never reaches the outer handler.
        deferredWork.set(command.id, { loading: true });
        publish(controller.current());
        try {
          deferred.set(command.id, await readWork(transport.readHistory!, command.work));
          deferredWork.delete(command.id);
        } catch (error) {
          deferredWork.set(command.id, {
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        detailRevision++;
        break;
      }
      default:
        throw new Error(`Unknown chat action: ${command.type}`);
    }
    requests.push({
      kind: 'actionComplete',
      method: command.type,
      params: { requestId: command.requestId, text: command.text },
    });
  } catch (error) {
    operationErrorCode = gxserverRpcErrorCode(error);
    operationError =
      operationErrorCode === 'sendCancelled' ? undefined : error instanceof Error ? error.message : String(error);
    if (
      command.type === 'answer' &&
      (command.answer.kind === 'terminalChoice' || command.answer.kind === 'terminalDialog')
    ) {
      noticeError = operationError;
      operationError = undefined;
    }
    if (command.type === 'handoff')
      requests.push({ kind: 'host', method: 'draftHandoffToTerminalFailed', params: { error: operationError } });
    requests.push({
      kind: 'actionError',
      method: command.type,
      params: { requestId: command.requestId, error: operationError ?? noticeError },
    });
  }
  publish(controller.current());
}

const transfers = new ChatTransfers((reason) => {
  operationError = reason;
  if (controller) controller.current().retry();
  else start(bootConfig);
});

function brokerMessage(message: any): void {
  if (message.kind === 'chunk') {
    const assembled = transfers.accept(message);
    if (assembled) brokerMessage(assembled);
  } else if (message.kind === 'reset') {
    transfers.clear();
    if (controller) controller.current().retry();
    else start(bootConfig);
  } else if (message.kind === 'chatSettings') {
    adoptNativeChatSettings(message.settings);
  } else if (message.kind === 'contextPreferences') {
    adoptNativeContextPreferences(message.preferences);
  } else if (message.kind === 'catalog') {
    adoptAgentModelCatalog(message.catalog);
  } else if (message.kind === 'event') {
    eventListener?.(message.event);
  } else if (message.kind === 'response') {
    const call = pending.get(Number(message.requestId));
    if (call) {
      pending.delete(Number(message.requestId));
      if (message.error) call.reject(new Error(message.error));
      else call.resolve(message.result ?? message.snapshot);
    }
  }
}

/**
 * CDXC:SessionChat 2026-09-18 DECISION:
 * User: the GPUI composer shows `[Image #1](/path)` as the same clickable reference pill the React
 * composer shows. Both read this one projection so a pill's kind, label, and width cannot drift.
 * Offsets count UTF-16 code units, which is what a JS string index is; the host converts them.
 */
function trackDraftAttachments(text: unknown): void {
  if (typeof text !== 'string') return;
  draftAttachmentCount = sessionChatComposerReferences(text).filter((reference) => reference.kind === 'image').length;
}

function composerReferences(text: string) {
  return sessionChatComposerReferences(text).map((reference) => ({
    start: reference.start,
    end: reference.end,
    kind: reference.kind,
    label: reference.label,
    path: reference.path,
    pill: sessionChatReferencePillText(reference.label, reference.kind),
  }));
}

/**
 * CDXC:SessionChat 2026-09-18 WHY:
 * A live status row changes once a second, and shipping the whole transcript for it cost about 1MB of JSON per frame on a 139-message session, serialized in QuickJS and parsed again in Rust on the UI thread.
 * Unchanged items keep their identity (native-presentation.ts), so only the changed window crosses the bridge; GPUI splices its item list and list state the same way.
 * SEE-ALSO: apps/desktop/src/app/native_chat/state.rs (pump).
 */
function itemsSplice(
  previous: unknown[] | undefined,
  next: unknown[]
): { start: number; deleteCount: number; items: unknown[]; length: number } | undefined {
  if (previous === next) return undefined;
  if (!previous) return { start: 0, deleteCount: 0, items: next, length: next.length };
  const limit = Math.min(previous.length, next.length);
  let start = 0;
  while (start < limit && previous[start] === next[start]) start++;
  let end = 0;
  while (end < limit - start && previous[previous.length - 1 - end] === next[next.length - 1 - end]) end++;
  return {
    start,
    deleteCount: previous.length - start - end,
    items: next.slice(start, next.length - end),
    length: next.length,
  };
}

function transcriptItemsSplice() {
  const splice = itemsSplice(sentTranscriptItems, transcriptItems);
  sentTranscriptItems = transcriptItems;
  return splice;
}

function subagentItemsSplice() {
  const splice = itemsSplice(sentSubagentItems, subagentItems);
  sentSubagentItems = subagentItems;
  return splice;
}

Object.assign(globalThis, {
  nativeChat: {
    brokerMessage,
    start,
    action,
    composerReferences,
    composerKeyIntent: nativeComposerKeyIntent,
    referenceMenu: sessionChatReferenceMenuRows,
    transcriptMenu: sessionChatTranscriptMenuRows,
    sendBlockedToast: sessionChatSendBlockedToastRequest,
    event: (event: GxserverSessionChatEvent) => eventListener?.(event),
    resolve(id: number, value: unknown, error?: { code?: GxserverRpcErrorCode; message: string; endpoint: string }) {
      const call = pending.get(id);
      if (!call) return;
      pending.delete(id);
      if (error)
        call.reject(
          error.code ? new GxserverRpcError(error.code, error.message, error.endpoint) : new Error(error.message)
        );
      else call.resolve(value);
    },
    tick() {
      const now = Date.now();
      for (const [id, timer] of [...timers]) {
        if (timer.at > now) continue;
        if (timer.interval) timer.at = now + timer.interval;
        else timers.delete(id);
        timer.callback();
      }
    },
    take: (lastRevision: number) => {
      return JSON.stringify({
        itemsSplice: transcriptItemsSplice(),
        minimap: sentMinimapMarkers === minimapMarkers ? undefined : (sentMinimapMarkers = minimapMarkers),
        subagentSplice: subagentItemsSplice(),
        revision,
        snapshot: lastRevision === revision ? undefined : snapshot,
        requests: requests.splice(0),
        nextWakeMs: timers.size
          ? Math.max(0, Math.min(...[...timers.values()].map((timer) => timer.at)) - Date.now())
          : null,
      });
    },
  },
});
