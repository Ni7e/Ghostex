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
import { adoptAgentModelCatalog } from '../agent-model-catalog-state';
import { computeNativeChatOptions, nativeOptionPersistence } from './native-options';
import { dismissedNoticeState, isNoticeDismissed, sessionChatTerminalNoticeDismissKey, type DismissedNotice } from './notice-state';
import { terminalDialogPresentation, terminalNoticeActionAnswer, terminalNoticeChoiceAnswer } from '../session-chat-presentation/terminal-prompts';
import { fitChatComposerControls } from '../session-chat-presentation/composer-layout';
import { computeNativeChatControls } from './native-controls';
import { SESSION_CHAT_STOP_BUTTON_COOLDOWN_MS, sessionChatSendBlockedReason } from './composer-policy';
import { NativeChatPresentation } from './native-presentation';
import { deliverChatSubmission, editQueuedChatPrompt, restoreUndeliveredChatText } from './submission';
import { SESSION_CHAT_QUEUE_LONG_PRESS_MS, isSessionChatQueueRowBusy, sessionChatQueueRowPreview, moveSessionChatQueueRow, sessionChatQueuePromptIds } from './queue';
import { EMPTY_SESSION_CHAT_COMPOSER_HISTORY, recallPreviousSessionChatDraft, recallNextSessionChatDraft, resetSessionChatComposerHistoryIndex } from '@/packages/core-ui/chat/session-chat-composer-state';
import { GxserverRpcError, gxserverRpcErrorCode } from '../gxserver-rpc-error';
import type { GxserverRpcErrorCode } from '../gxserver-protocol';
import { sessionChatCardDismissKey, selectQuestionOption, type QuestionDraft } from '../session-chat-presentation/interactive';
import { chatHostActionDefinitions, COMPOSER_MENU_EXCLUDED_HOST_ACTION_IDS, AGENT_HOST_ACTION_IDS } from '../session-chat-presentation/actions';
import { insertChatReference, nativePathReference } from '../session-chat-presentation/references';
import { flushSessionNote } from './note';
import { sessionChatEmptyStateCopy } from '@/packages/core-ui/chat/session-chat-empty-state';
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
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
const timers = new Map<number, { at: number; interval: number; callback: () => void }>();
let sequence = 0;
let revision = 0;
let snapshot: unknown;
let transcriptItems: unknown[] = [];
let sentTranscriptItems: unknown[] | undefined;
const presentation = new NativeChatPresentation();
const suggestions = new NativeComposerSuggestions();
let detailRevision = 0;
type NativeChatState = UseSessionChatResult & ReturnType<typeof computeNativeChatControls> & ReturnType<typeof computeNativeChatOptions> & ReturnType<typeof computeNativeChatContext> & ReturnType<typeof computeSessionChatSkills> & ReturnType<typeof computeSessionChatFiles>;
let optionPersistence: ReturnType<typeof nativeOptionPersistence>;
let controller: ChatComputation<NativeChatState>;
let retiredNoticeKey: string | null = null;
let answeredNoticeKey: string | null = null;
let activeNoticeKey: string | null = null;
let dismissedNotice: DismissedNotice | null = null;
let bootConfig: { clientId: string; initialSnapshot?: any; initialPresentation?: any };
let booting = false;
let eventListener: ((event: GxserverSessionChatEvent) => void) | undefined;
let transport: SessionChatTransport;
let operationError: string | undefined;
let pendingAttachments = 0;
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
let submissionAttempt: { cancelled: boolean } | undefined;
let incomingDraft: any = null;
let summaryMode = false;
let verboseOverride: boolean | null = null;
let composerOverflow: ReturnType<typeof fitChatComposerControls> = { overflowed: [], optionsOverflowed: false };
let contextStatusRows = [0];
let composerHistory = EMPTY_SESSION_CHAT_COMPOSER_HISTORY;
const note = { open: false, value: '', saved: '', edited: false, loading: false };
const receivingHandoffs = new Set<string>();
const receivedHandoffs = new Set<string>();
const deferred = new Map<string, SessionChatMessage[]>();

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
  const id = ++sequence;
  requests.push({ id, kind: 'rpc', method, params });
  return new Promise<T>((resolve, reject) => pending.set(id, { resolve, reject }));
}

function composer(operation: string, params: Record<string, unknown> = {}): Promise<any> {
  const id = ++sequence;
  requests.push({ id, kind: 'broker', method: 'composer', params: { composer: { operation, ...params } } });
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}


function noticeVisible(state: NativeChatState): boolean {
  return state.terminalNotice !== null && sessionChatTerminalNoticeDismissKey(state.terminalNotice) !== answeredNoticeKey && !isNoticeDismissed(state.terminalNotice, dismissedNotice);
}

function sendBlockedReason(state: NativeChatState): string | null {
  const notice = state.terminalNotice;
  const terminalChoicePending = !!notice && !!(notice.choices?.length || notice.dialog || notice.conversationLock) && `${notice.kind}:${notice.detectedAt}` !== retiredNoticeKey;
  return sessionChatSendBlockedReason({ canSend: true, accountSwitchBusy: state.accountStatus.busy, conversationLocked: !!notice?.conversationLock,
    terminalChoicePending, noticeCardVisible: noticeVisible(state), sessionOptionSwitching: optionSwitching });
}

function publish(state: NativeChatState): void {
  const nextNoticeKey = sessionChatTerminalNoticeDismissKey(state.terminalNotice);
  if (activeNoticeKey !== nextNoticeKey) { activeNoticeKey = nextNoticeKey; answeredNoticeKey = null; }
  const nextPromptKey = sessionChatCardDismissKey(state.prompt);
  if (nextPromptKey !== promptKey) { promptKey = nextPromptKey; dismissedPrompt = null; }
  const nextContentKey = state.prompt === null ? null : `interactive:${JSON.stringify(state.prompt)}`;
  if (nextContentKey !== questionContentKey) {
    questionContentKey = nextContentKey;
    questionIndex = 0;
    questionTransition = false;
    answering = false;
    questionDrafts = state.prompt?.kind === 'question' ? state.prompt.questions.map(() => ({ indices: [], other: '' })) : [];
    questionDraftsLoading = state.prompt?.kind === 'question';
    if (questionDraftsLoading) void composer('questionRead', { promptKey: nextContentKey }).then((answers) => {
      if (questionContentKey !== nextContentKey) return;
      questionDrafts = questionDrafts.map((empty,index) => answers[index] ?? empty);
      questionDraftsLoading = false;
      publish(controller.current());
    }).catch((error) => {
      if (questionContentKey !== nextContentKey) return;
      questionDraftsLoading = false;
      operationError = error instanceof Error ? error.message : String(error);
      publish(controller.current());
    });
  }
  const projection = presentation.update(state.messages, state.workingSignal, summaryMode, deferred, detailRevision);
  transcriptItems = projection.items;
  const { messages: _messages, skills: _skills, files: _files, requestSkills: _requestSkills, requestFiles: _requestFiles, ...viewState } = state;
  snapshot = {
    ...viewState,
    modelPicker: modelPicker?.projection() ?? null,
    contextStatusRows,
    suggestions: suggestions.projection(state),
    composerCommand: suggestions.nativeCommand(state),
    contextEditor: nativeContextEditor(state,state.accounts),
    queue: { ...state.queue, prompts: state.queue.prompts.map(prompt => ({...prompt, preview: sessionChatQueueRowPreview(prompt.text), busy: isSessionChatQueueRowBusy(prompt) })) },
    hostActions: chatHostActionDefinitions.filter(action => !COMPOSER_MENU_EXCLUDED_HOST_ACTION_IDS.has(action.id)).map(action => ({
      ...action, group: AGENT_HOST_ACTION_IDS.has(action.id) ? 'agent' : 'session',
    })),
    emptyState: sessionChatEmptyStateCopy(state.status === "working" || state.status === "ready" ? "empty" : state.status, state.agent),
    noticeVisible: noticeVisible(state),
    terminalNotice: state.terminalNotice ? { ...state.terminalNotice, dialog: state.terminalNotice.dialog ? { ...state.terminalNotice.dialog, presentation: terminalDialogPresentation(state.terminalNotice.dialog) } : undefined, choices: state.terminalNotice.choices?.filter(choice => choice.label.trim()).map(choice => ({ ...choice, answer: terminalNoticeChoiceAnswer(state.terminalNotice, choice.index) })), actions: state.terminalNotice.actions?.flatMap(action => { const answer = terminalNoticeActionAnswer(state.terminalNotice!, action); return action.kind === 'switchToTerminal' || answer ? [{ ...action, answer }] : []; }) } : null,
    operationError,
    pendingAttachments,
    optionDispatchId,
    sendBlockedReason: sendBlockedReason(state),
    summaryMode,
    verboseOverride,
    composerOverflow,
    historyActive: composerHistory.index !== null,
    interaction: { queueLongPressMs: SESSION_CHAT_QUEUE_LONG_PRESS_MS, stopButtonCooldownMs: SESSION_CHAT_STOP_BUTTON_COOLDOWN_MS },
    incomingDraft,
    note: { ...note },
    questionCard: { visible: promptKey !== null && promptKey !== dismissedPrompt && !(state.prompt?.kind === 'approval' && state.terminalNotice?.kind === 'permissionPrompt' && (!!state.terminalNotice.choices?.length || !!state.terminalNotice.dialog) && `${state.terminalNotice.kind}:${state.terminalNotice.detectedAt}` !== retiredNoticeKey), questionIndex, drafts: questionDrafts, answering, busy: answering || questionTransition, loading: questionDraftsLoading },
    finalIds: projection.finalIds,
  };
  revision++;
}

function start(config: { clientId: string; initialSnapshot?: any; initialPresentation?: any }): void {
  bootConfig = config;
  if (booting) return;
  booting = true;
  void composer('read').then((result) => {
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
  }).catch((error) => {
    transcriptItems = [];
    snapshot = { status: 'error', error: String(error) };
    revision++;
  }).finally(() => { booting = false; });
}

function onUnconfirmedOptions(): void {
  operationError = 'The agent did not confirm the selection. The controls now reflect the latest detected settings.';
}

function startController(config: { clientId: string; initialSnapshot?: any; initialPresentation?: any }): void {
  transport = {
    getCachedSnapshot: () => config.initialSnapshot ?? undefined,
    presentation: createSessionChatPresentationStore(config.initialPresentation ?? undefined, (state) => requests.push({ kind: 'broker', method: 'presentation', params: { state } })),
    read: (params) => rpc('readSessionChat', params),
    readSkills: () => rpc('readSessionChatSkills'),
    readFiles: () => rpc('readSessionChatFiles'),
    readHistory: (params) => rpc('readSessionChat', { ...params, historyMode: params.detail ? 'detail' : 'turns' }),
    subscribe: ({ onEvent, currentLimit }) => {
      eventListener = onEvent;
      requests.push({ kind: 'broker', method: 'subscribe', params: { limit: currentLimit?.() ?? 120, catalog: true } });
      return () => { eventListener = undefined; requests.push({ kind: 'broker', method: 'unsubscribe', params: {} }); };
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
  };
  controller = new ChatComputation((lifecycle) => {
    const chat = computeSessionChat({ transport, clientId: config.clientId, onDeliveredDrafts: (deliveries) => {
      if (deliveries.length) void composer('deliveries', { deliveries }).catch(() => {});
    } }, lifecycle);
    const controls = computeNativeChatControls(chat, rpc, lifecycle);
    const options = computeNativeChatOptions(chat, optionPersistence, rpc, onUnconfirmedOptions, lifecycle);
    lifecycle.useEffect(() => {
      if (chat.returnedPrompt) void action({ type: 'restoreReturned', returned: chat.returnedPrompt });
    }, [chat.returnedPrompt?.id]);
    const context = computeNativeChatContext(chat, options.sessionOptions.catalog?.modelIcon, controls.accounts, lifecycle);
    const skills = computeSessionChatSkills(transport, chat.sessionAgentId, lifecycle);
    const files = computeSessionChatFiles(transport, lifecycle);
    return { ...chat, ...controls, ...options, ...context, ...skills, ...files };
  }, publish);
  controller.run();
}

async function action(command: { type: string; [key: string]: any }): Promise<void> {
  if (!controller) { if (command.type === 'retry') start(bootConfig); return; }
  const chat = controller.current();
  const clearedError = operationError !== undefined;
  if (!['restoreSubmission','composerSelection','suggestionHighlight','measureComposer','measureContextStatus'].includes(command.type)) operationError = undefined;
  try {
    switch (command.type) {
      case 'completeComposerCommand': {
        const content = suggestions.nativeCommand(chat);
        if (content !== null) requests.push({ kind: 'composer', method: 'insert', params: { content, caret: content.length } });
        break;
      }
      case 'composerSelection': suggestions.update(command.text, command.caret); break;
      case 'suggestionKey': case 'suggestionPick': case 'suggestionHighlight': case 'suggestionRetry': case 'suggestionDismiss': {
        const completion = suggestions.command(command, chat);
        if (completion && 'content' in completion) requests.push({ kind: 'composer', method: 'insert', params: completion });
        break;
      }
      case 'contextEdit': case 'contextCancel': case 'contextQuery': case 'contextShown': case 'contextStar': case 'contextReorder': case 'contextReset': case 'contextSave':
        await nativeContextEditorCommand(command, chat.sessionOptions.catalog?.modelIcon === 'codex' ? 'codex' : 'claude', (agent,preferences) => composer('contextSave',{agent,preferences}), () => publish(controller.current()));
        break;
      case 'measureContextStatus': if (command.available > 0) contextStatusRows = balancedRowStarts(command.widths,command.available,command.separator); break;
      case 'contextCompact': if (!chat.working) await chat.send('/compact'); break;
      case 'switchDraftAgent': {
        if (!chat.availableAgents?.some(agent => agent.agentId === command.agentId) || chat.sessionAgentId === command.agentId) break;
        await composer('flush');
        try { await rpc('switchDraftAgent', { agentId: command.agentId }); }
        finally { chat.refresh(); for (const delay of [2000,6000]) schedule(() => chat.refresh(), delay); }
        break;
      }
      case 'selectOption': {
        const options = chat.sessionOptions;
        const descriptor = [options.catalog?.model, ...options.optionDescriptors].find(entry => entry?.id === command.descriptorId);
        if (!descriptor) break;
        if (command.value !== undefined && options.state[descriptor.id]?.value === command.value) break;
        const delivery = command.exitPlan ? { ...descriptor, dispatch: { kind: 'key' as const, key: 'shift-tab' as const, marker: '' } } : descriptor;
        if (queueSessionChatOption(delivery, command.value, { catalog: options.catalog, state: options.state,
          queuedControls: options.catalog?.modelIcon === 'codex' || options.catalog?.modelIcon === 'claude',
          quickPicker: !!chat.modelProvider, picker: chat.modelSelection })) break;
        if (optionDispatchId || chat.working) break;
        optionDispatchId = descriptor.id;
        publish(chat);
        try {
          await dispatchSessionChatOption(delivery, command.value, { ...options,
            onDispatchCommand: async text => {
              options.reconcileTypedCommand(text);
              await chat.send(text);
              if (chat.availableAgents) chat.refresh();
            },
            onDispatchKey: async (key, marker) => { await chat.sendKey?.(key, marker); },
            onPickModel: chat.agent === 'codex' ? async selection => { await rpc('selectSessionChatModel', { ...selection }); } : undefined,
            onSwitchToTerminal: () => requests.push({ kind: 'host', method: 'switchToTerminal', params: {} }),
            onSwitchingChange: switching => { optionSwitching = switching; publish(controller.current()); },
          });
        } finally { optionDispatchId = null; }
        break;
      }
      case 'toggleModelPicker': {
        if (modelPicker) { modelPicker.finish(false); break; }
        if (!chat.modelProvider) break;
        const desired = chat.modelSelection.desired;
        const request = createModelPickerRequest(currentAgentModelCatalog(), chat.modelProvider,
          desired?.model || chat.sessionOptions.state.model?.value, desired?.effort || chat.sessionOptions.state.effort?.value);
        if (!request) break;
        const sessionKey = chat.sessionOptions.sessionKey;
        modelPicker = new NativeModelPicker(request, () => publish(controller.current()), selection => {
          const current = controller.current();
          if (selection && current.sessionOptions.sessionKey === sessionKey && !modelSelectionUnchanged(selection,
            current.modelSelection.desired, { model: current.sessionOptions.state.model?.value, effort: current.sessionOptions.state.effort?.value }, request)) {
            current.modelSelection.select(selection);
          }
          modelPicker?.dispose();
          modelPicker = null;
          publish(controller.current());
        });
        if (command.size) modelPicker.measure(command.size);
        break;
      }
      case 'modelPickerMeasure': modelPicker?.measure(command.size); break;
      case 'modelPickerKey': modelPicker?.key(command.key); break;
      case 'modelPickerKeyUp': modelPicker?.release(command.key); break;
      case 'modelPickerBlur': modelPicker?.blur(); break;
      case 'modelPickerControl': modelPicker?.navigate(command.control); break;
      case 'modelPickerScroll': modelPicker?.scroll(command.input); break;
      case 'modelPickerModel': modelPicker?.chooseModel(command.index, command.save, command.pointer); break;
      case 'modelPickerEffort': modelPicker?.chooseEffort(command.index, command.save); break;
      case 'modelPickerCancel': modelPicker?.finish(false); break;
      case 'measureComposer': composerOverflow = fitChatComposerControls(command.measurements); break;
      case 'reportSendBlocked': operationError = sendBlockedReason(chat) ?? undefined; break;
      case 'toggleSummary': summaryMode = await composer('summary', { enabled: !summaryMode }); break;
      case 'setVerbose': verboseOverride = await composer('verbose', { enabled: command.enabled }); break;
      case 'toggleNote': {
        if (note.open) {
          await flushSessionNote(note, note.value, value => rpc('saveSessionAgentNote', { note: value }));
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
          } finally { note.loading = false; }
        }
        break;
      }
      case 'editNote': note.edited = true; note.value = command.text; break;
      case 'clearNote': note.edited = true; note.value = '';
      case 'saveNote': await flushSessionNote(note, note.value, value => rpc('saveSessionAgentNote', { note: value })); break;
      case 'attachmentsStarted': pendingAttachments++; break;
      case 'attachmentsFinished':
        pendingAttachments = Math.max(0, pendingAttachments - 1);
        if (command.error) operationError = command.error;
        if (command.paths?.length) requests.push({ kind: 'attachmentReferences', method: 'insert', params: { paths: command.paths } });
        break;
      case 'attachPaths': {
        pendingAttachments++;
        publish(chat);
        try {
          const paths = await rpc<string[]>('importNativeAttachments', { paths: command.paths });
          requests.push({ kind: 'attachmentReferences', method: 'insert', params: { paths } });
        } finally { pendingAttachments--; }
        break;
      }
      case 'insertAttachments': {
        let text = command.text as string;
        let caret = command.start as number;
        let end = command.end as number;
        for (const path of command.paths as string[]) {
          const result = insertChatReference(text, nativePathReference(path, text), caret, end);
          text = result.text; caret = result.caret; end = caret;
        }
        requests.push({ kind: 'composer', method: 'insert', params: { content: text, caret } });
        break;
      }
      case 'stash': {
        if (!command.text?.trim()) break;
        await rpc('saveStashedPrompt', { content: command.text });
        requests.push({ kind: 'composerClearExpected', method: 'stash', params: { text: command.text } });
        break;
      }
      case 'restoreReturned': {
        if (await composer('claimReturned', { returnedId: command.returned.id })) requests.push({ kind: 'returnedPrompt', method: 'restore', params: { text: command.returned.text } });
        break;
      }
      case 'applyReturned': {
        const content = command.current.includes(command.text) ? command.current : restoreUndeliveredChatText(command.text, command.current);
        requests.push({ kind: 'composer', method: 'insert', params: { content } });
        break;
      }
      case 'editDraft': {
        const historyChanged = !command.history && composerHistory.index !== null;
        if (!command.history) composerHistory = resetSessionChatComposerHistoryIndex(composerHistory);
        await composer('write', { text: command.text, version: command.draftVersion });
        if (!clearedError && !historyChanged) return;
        break;
      }
      case 'recallHistory': {
        if (command.direction === 'up' && composerHistory.index === null) composerHistory = { entries: await composer('history'), index: null };
        const recalled = command.direction === 'up' ? recallPreviousSessionChatDraft(composerHistory) : recallNextSessionChatDraft(composerHistory);
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
        submissionAttempt = attempt;
        try {
          try {
            await composer('write', { text: command.text, version: command.draftVersion, submitted: true });
            await composer('flush');
            await deliverChatSubmission({
              text: command.text, version: command.draftVersion, mode: command.type,
              push: chat.draft.canSync ? chat.draft.push : undefined,
              send: (text, version) => sendSessionChatOptionAware(text, version, {
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
          requests.push({ kind: 'draftSubmitted', method: command.type, params: { text: command.text, version: command.draftVersion } });
          await composer('submitted', { text: command.text, version: command.draftVersion });
        } finally { submissionAttempt = undefined; }
        break;
      }
      case 'restoreSubmission':
        requests.push({ kind: 'composer', method: 'insert', params: { content: restoreUndeliveredChatText(command.text, command.current) } });
        break;
      case 'handoff': {
        await composer('write', { text: command.text, version: command.draftVersion });
        await chat.draft.push(command.text, command.draftVersion);
        const handoff = await composer('park', { text: command.text, version: command.draftVersion });
        requests.push({ kind: 'draftSubmitted', method: 'handoff', params: { ...handoff, text: command.text, version: command.draftVersion } });
        requests.push({ kind: 'host', method: 'draftHandoffToTerminalComplete', params: handoff });
        break;
      }
      case 'receiveHandoff': {
        if (receivingHandoffs.has(command.handoffId)) return;
        receivingHandoffs.add(command.handoffId);
        try {
          const consumed = command.draftVersion && chat.draft.synced?.consumedDrafts?.some(receipt => receipt.draftId === command.draftVersion.draftId && receipt.revision >= command.draftVersion.revision);
          if (!receivedHandoffs.has(command.handoffId) && !consumed) {
            const result = await composer('receive', { text: command.content, version: command.draftVersion, current: command.current });
            if (result.disposition === 'conflict') incomingDraft = { content: command.content, version: result.version };
            else if (result.disposition === 'accept') requests.push({ kind: 'draftReceived', method: 'handoff', params: { content: command.content, version: result.entry.version, previous: command.current } });
            receivedHandoffs.add(command.handoffId);
          }
          await rpc('acknowledgeSessionChatDraftHandoff', { handoffId: command.handoffId });
          requests.push({ kind: 'host', method: 'draftHandoffToChatComplete', params: { handoffId: command.handoffId } });
        } finally { receivingHandoffs.delete(command.handoffId); }
        break;
      }
      case 'dismissIncomingDraft': incomingDraft = null; break;
      case 'useIncomingDraft':
        if (incomingDraft) requests.push({ kind: 'composer', method: 'insert', params: { content: incomingDraft.content } });
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
        const choices = chat.terminalNotice!.choices?.filter(choice => choice.label.trim()) ?? [];
        const choice = choices[command.type === 'noticePrimary' ? 0 : 1];
        const noticeAction = chat.terminalNotice!.actions?.map(action => terminalNoticeActionAnswer(chat.terminalNotice!, action)).find(Boolean);
        const answer = choice ? terminalNoticeChoiceAnswer(chat.terminalNotice, choice.index) : command.type === 'noticePrimary' ? noticeAction : null;
        if (answer) await action({ type: 'answer', answer });
        break;
      }
      case 'answer':
        if (answering) break;
        answering = true;
        if (command.answer.kind === 'terminalChoice' || (command.answer.kind === 'terminalDialog' && typeof command.answer.choiceIndex === 'number')) answeredNoticeKey = activeNoticeKey;
        publish(chat);
        try {
          const key = promptKey;
          await chat.answerPrompt(command.answer);
          if (command.answer.kind === 'approval' || command.answer.kind === 'question' || chat.terminalNotice?.kind === 'permissionPrompt') dismissedPrompt = key;
        } catch (error) {
          answeredNoticeKey = null;
          if (command.answer.kind === 'terminalChoice' && chat.terminalNotice) retiredNoticeKey = `${chat.terminalNotice.kind}:${chat.terminalNotice.detectedAt}`;
          throw error;
        } finally { answering = false; }
        break;
      case 'questionText': {
        if (answering || questionTransition || questionDraftsLoading || !questionDrafts[questionIndex]) break;
        questionDrafts[questionIndex] = { ...questionDrafts[questionIndex]!, other: command.text };
        publish(chat);
        await composer('questionWrite', { promptKey: questionContentKey, answers: Object.fromEntries(questionDrafts.map((draft,index) => [index,draft])) });
        break;
      }
      case 'questionBack': if (!answering && !questionTransition && !questionDraftsLoading) questionIndex = Math.max(0, questionIndex - 1); break;
      case 'questionOption':
      case 'questionNext': {
        if (chat.prompt?.kind !== 'question' || answering || questionTransition || questionDraftsLoading) break;
        const question = chat.prompt.questions[questionIndex]!;
        const contentKey = questionContentKey;
        if (command.type === 'questionOption') {
          if (!question.options[command.index]) break;
          questionDrafts = selectQuestionOption(questionDrafts, questionIndex, question.multiSelect, command.index);
          const answers = Object.fromEntries(questionDrafts.map((draft,index) => [index,draft]));
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
          if (!questionDrafts.some(draft => draft.indices.length || draft.other.trim())) break;
          answering = true;
          const key = promptKey;
          const drafts = questionDrafts;
          publish(chat);
          try {
            await chat.answerPrompt({ kind: 'question', selections: drafts.map((draft) => ({ indices: draft.indices, ...(draft.other.trim() ? { other: draft.other.trim() } : {}) })) });
            dismissedPrompt = key;
            await composer('questionClear', { promptKey: contentKey, answers: Object.fromEntries(drafts.map((draft,index) => [index,draft])) });
          } finally { if (questionContentKey === contentKey) answering = false; }
        }
        break;
      }
      case 'questionCancel': {
        if (answering || questionTransition || questionDraftsLoading) break;
        dismissedPrompt = promptKey;
        if (questionContentKey) await composer('questionClear', { promptKey: questionContentKey, answers: Object.fromEntries(questionDrafts.map((draft,index) => [index,draft])) });
        await chat.interrupt();
        break;
      }
      case 'sendKey': await chat.sendKey?.(command.key, command.marker ?? ''); break;
      case 'retry': chat.retry(); break;
      case 'refresh': chat.refresh(); break;
      case 'loadEarlier': chat.loadEarlier(); break;
      case 'retryQueue': await chat.queue.retryPrompt(command.promptId); break;
      case 'removeQueue': {
        if (command.edit) {
          const original = chat.queue.prompts.find(prompt => prompt.id === command.promptId);
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
      case 'sendQueue': await chat.queue.sendNow(command.promptId); break;
      case 'reorderQueue': await chat.queue.reorder(command.promptIds); break;
      case 'moveQueue': {
        const prompts = chat.queue.prompts;
        const from = prompts.findIndex(prompt => prompt.id === command.promptId);
        const to = prompts.findIndex(prompt => prompt.id === command.targetId);
        if (from >= 0 && to >= 0 && !isSessionChatQueueRowBusy(prompts[from]!)) {
          await chat.queue.reorder(sessionChatQueuePromptIds(moveSessionChatQueueRow(prompts,from,to)));
        }
        break;
      }
      case 'saveDraft': await chat.draft.push(command.content, command.draftVersion); break;
      case 'loadWork': deferred.set(command.id, await readWork(transport.readHistory!, command.work)); detailRevision++; break;
      default: throw new Error(`Unknown chat action: ${command.type}`);
    }
    requests.push({ kind: 'actionComplete', method: command.type, params: { requestId: command.requestId, text: command.text } });
  } catch (error) {
    operationError = gxserverRpcErrorCode(error) === 'sendCancelled' ? undefined : error instanceof Error ? error.message : String(error);
    if (command.type === 'handoff') requests.push({ kind: 'host', method: 'draftHandoffToTerminalFailed', params: { error: operationError } });
    requests.push({ kind: 'actionError', method: command.type, params: { requestId: command.requestId, error: operationError } });
  }
  publish(controller.current());
}

const transfers = new ChatTransfers((reason) => {
  operationError = reason;
  if (controller) controller.current().retry(); else start(bootConfig);
});

function brokerMessage(message: any): void {
  if (message.kind === 'chunk') {
    const assembled = transfers.accept(message);
    if (assembled) brokerMessage(assembled);
  } else if (message.kind === 'reset') {
    transfers.clear();
    if (controller) controller.current().retry(); else start(bootConfig);
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
      if (message.error) call.reject(new Error(message.error)); else call.resolve(message.result ?? message.snapshot);
    }
  }
}

Object.assign(globalThis, { nativeChat: {
  brokerMessage,
  start,
  action,
  event: (event: GxserverSessionChatEvent) => eventListener?.(event),
  resolve(id: number, value: unknown, error?: { code?: GxserverRpcErrorCode; message: string; endpoint: string }) {
    const call = pending.get(id);
    if (!call) return;
    pending.delete(id);
    if (error) call.reject(error.code ? new GxserverRpcError(error.code, error.message, error.endpoint) : new Error(error.message)); else call.resolve(value);
  },
  tick() {
    const now = Date.now();
    for (const [id, timer] of [...timers]) {
      if (timer.at > now) continue;
      if (timer.interval) timer.at = now + timer.interval; else timers.delete(id);
      timer.callback();
    }
  },
  take: (lastRevision: number) => {
    const items = sentTranscriptItems === transcriptItems ? undefined : transcriptItems;
    sentTranscriptItems = transcriptItems;
    return JSON.stringify({
    items,
    revision, snapshot: lastRevision === revision ? undefined : snapshot, requests: requests.splice(0),
    nextWakeMs: timers.size ? Math.max(0, Math.min(...[...timers.values()].map(timer => timer.at)) - Date.now()) : null,
    });
  },
} });
