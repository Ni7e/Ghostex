import { listProjectMarkdownDocumentPaths, saveProjectMarkdownDocument } from '../project-docs';
import {
  pendingSessionChatAsyncQuestions,
  sessionChatAsyncAnswerPrefix,
} from '../session-chat-presentation/async-questions';
import type { GxserverSessionChatEvent, GxserverReadSessionChatResult } from '../session-chat';
import type { SessionChatTransport } from '@/packages/core-ui/chat/session-chat-transport';
import { normalizeSessionChatContextDetailsPreferences } from '../session-chat-presentation/context-details';
import { currentAgentModelCatalog } from '../agent-model-catalog-state';
import { chatPreviewSnapshot, previewMessage, type ChatPreviewConfig } from './fixture';

export class ChatPreviewBackend {
  snapshot: GxserverReadSessionChatResult;
  private listeners = new Set<(event: GxserverSessionChatEvent) => void>();
  private entry: any = { text: '', version: { draftId: 'preview-draft', revision: 1 } };
  private history: string[] = [];
  private questionAnswers = {};
  private asyncAnswers = {};
  private retiredQuestions: string[] = [];
  private note = '';
  private counter = 100;
  private markdownDocuments = new Map<string, string>();
  constructor(readonly config: ChatPreviewConfig) {
    this.snapshot = chatPreviewSnapshot(config);
  }
  subscribe = (listener: (event: GxserverSessionChatEvent) => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish() {
    this.snapshot.seq++;
    const event: GxserverSessionChatEvent = {
      ...this.snapshot,
      type: 'sessionChatSnapshot',
      protocolVersion: 1,
      serverId: 'preview',
      projectId: 'preview',
      sessionId: 'preview',
    };
    for (const listener of this.listeners) listener(event);
  }
  async rpc<T = any>(method: string, params: any = {}): Promise<T> {
    let result: unknown;
    switch (method) {
      case 'runProjectDocsAction': {
        const base = { action: params.action, requestId: params.requestId };
        if (params.action === 'list')
          result = { ...base, entries: [...this.markdownDocuments.keys()].map((path) => ({ kind: 'file', path })) };
        else if (params.action === 'save') {
          this.markdownDocuments.set(params.path, params.content);
          result = { ...base, file: { path: params.path } };
        } else if (params.action === 'copyFullPath') result = { ...base, fullPath: `/sample/project/${params.path}` };
        else throw new Error('That Docs action is unavailable in the sample.');
        break;
      }
      case 'readSessionChat':
        result = this.snapshot;
        break;
      case 'readSessionChatSkills':
        result = { skills: [] };
        break;
      case 'readSessionChatFiles':
        result = { files: [], truncated: false };
        break;
      case 'agentAccounts':
        result = {
          accounts: [],
          helpers: [],
          sessions: [],
          policy: { enabled: false, atLimit: 'wait', priority: 'soonestReset', retryErrors: false },
        };
        break;
      case 'sendSessionChatMessage':
        if (!params.text) break;
        this.history.unshift(params.text);
        this.snapshot.messages = [
          ...this.snapshot.messages,
          previewMessage(String(++this.counter), 'user', params.text, Date.now()),
          previewMessage(
            String(++this.counter),
            'assistant',
            'This is a simulated reply from the comparison app. No agent was contacted. You can reset this conversation or choose another scenario above.',
            Date.now() + 1
          ),
        ];
        this.snapshot.working = false;
        this.snapshot.terminalActivity = undefined;
        this.publish();
        break;
      case 'interruptSessionChat':
        this.snapshot.working = false;
        this.snapshot.terminalActivity = undefined;
        this.publish();
        break;
      case 'answerSessionChatPrompt':
        if (
          params.kind === 'terminalChoice' ||
          (params.kind === 'terminalDialog' && typeof params.choiceIndex === 'number')
        ) {
          const choice = this.snapshot.terminalNotice?.choices?.find((choice) => choice.index === params.choiceIndex);
          if (!choice) throw new Error('That sample choice is no longer available.');
          if (this.config.scenario === 'update-error' && params.choiceIndex === 0)
            throw new Error("Codex's dialog changed. Review the current choices and try again.");
          this.snapshot.messages = [
            ...this.snapshot.messages,
            previewMessage(
              String(++this.counter),
              'assistant',
              `Sample choice: ${choice.label}. No update was installed.`
            ),
          ];
          this.snapshot.terminalNotice = undefined;
        } else if (params.kind === 'asyncQuestion' || params.kind === 'dismissAsyncQuestion') {
          const question = pendingSessionChatAsyncQuestions(this.snapshot.messages).find(
            (question) => question.key === params.questionId
          );
          if (!question) throw new Error('That sample question is no longer available.');
          if (params.kind === 'asyncQuestion')
            this.snapshot.messages = [
              ...this.snapshot.messages,
              previewMessage(
                String(++this.counter),
                'user',
                sessionChatAsyncAnswerPrefix(question.title) + params.text,
                Date.now()
              ),
            ];
        } else this.snapshot.prompt = undefined;
        this.publish();
        break;
      case 'setSessionChatDraft':
        this.snapshot.draft = {
          content: params.content,
          version: params.draftVersion,
          originClientId: params.clientId ?? 'preview',
          updatedAt: new Date().toISOString(),
        };
        result = { draft: this.snapshot.draft };
        break;
      case 'queueSessionChatPrompt': {
        const stamp = new Date().toISOString();
        const prompt = {
          id: `queued-${++this.counter}`,
          text: params.text,
          state: 'queued' as const,
          createdAt: stamp,
          updatedAt: stamp,
        };
        this.snapshot.queue = [...(this.snapshot.queue ?? []), prompt];
        this.publish();
        result = { prompt, queue: this.snapshot.queue };
        break;
      }
      case 'removeSessionChatQueuedPrompt':
      case 'sendSessionChatQueuedPrompt': {
        const prompt = this.snapshot.queue?.find((row) => row.id === params.promptId);
        this.snapshot.queue = this.snapshot.queue?.filter((row) => row.id !== params.promptId);
        if (method === 'sendSessionChatQueuedPrompt' && prompt)
          await this.rpc('sendSessionChatMessage', { text: prompt.text });
        this.publish();
        result = { prompt, queue: this.snapshot.queue };
        break;
      }
      case 'updateSessionChatQueuedPrompt':
        this.snapshot.queue = this.snapshot.queue?.map((row) =>
          row.id === params.promptId ? { ...row, text: params.text ?? row.text, state: 'queued' as const } : row
        );
        this.publish();
        result = { queue: this.snapshot.queue };
        break;
      case 'reorderSessionChatQueue':
        this.snapshot.queue?.sort((a, b) => params.promptIds.indexOf(a.id) - params.promptIds.indexOf(b.id));
        this.publish();
        result = { queue: this.snapshot.queue };
        break;
      case 'selectSessionChatModel':
        this.snapshot.selectedOptions = {
          detectedAt: new Date().toISOString(),
          model: { value: params.model, label: params.model },
          effort: { value: params.effort, label: params.effort },
        };
        this.publish();
        result = { selectedOptions: this.snapshot.selectedOptions };
        break;
      default:
        throw new Error(`${method} is not available in the sample conversation.`);
    }
    return result as T;
  }
  async composer(operation: string, params: any = {}): Promise<any> {
    switch (operation) {
      case 'read':
        return {
          sessionKey: 'preview',
          clientId: 'preview',
          entry: this.entry,
          optionStates: {},
          modelOutboxes: {},
          modelCatalog: currentAgentModelCatalog(),
          contextPreferences: {
            claude: normalizeSessionChatContextDetailsPreferences(null, 'claude'),
            codex: normalizeSessionChatContextDetailsPreferences(null, 'codex'),
          },
          chatSettings: { title: 'Sample conversation', hideAccountEmails: false },
        };
      case 'write':
        this.entry = { text: params.text, version: params.version };
        return this.entry;
      case 'submitted':
        this.entry = { text: '', version: { draftId: `preview-${++this.counter}`, revision: 1 } };
        return this.entry.version;
      case 'history':
        return this.history;
      case 'asyncQuestionRead':
        return { drafts: this.asyncAnswers, retired: this.retiredQuestions };
      case 'asyncQuestionWrite':
        this.asyncAnswers = params.answers;
        return true;
      case 'asyncQuestionRetire':
        this.retiredQuestions.push(params.questionId);
        return true;
      case 'questionRead':
        return this.questionAnswers;
      case 'questionWrite':
        this.questionAnswers = params.answers;
        return true;
      case 'questionClear':
        this.questionAnswers = {};
        return true;
      case 'noteRead':
        return this.note;
      case 'noteWrite':
        this.note = params.value ?? params.text ?? '';
        return true;
      case 'flush':
      case 'deliveries':
      case 'optionWrite':
      case 'modelWrite':
      case 'modelAck':
      case 'contextPreferences':
      case 'summary':
      case 'verbose':
      case 'dismissNotice':
        return true;
      default:
        throw new Error(`${operation} is not available in the sample conversation.`);
    }
  }
  transport(): SessionChatTransport {
    return {
      listMessageMarkdownPaths: () =>
        listProjectMarkdownDocumentPaths('preview', (_, params) => this.rpc('runProjectDocsAction', params)),
      saveMessageMarkdown: (params) =>
        saveProjectMarkdownDocument({ ...params, projectId: 'preview' }, (_, request) =>
          this.rpc('runProjectDocsAction', request)
        ),
      getCachedSnapshot: () => this.snapshot,
      read: () => this.rpc('readSessionChat'),
      subscribe: ({ onEvent }) => this.subscribe(onEvent),
      send: (text) => this.rpc('sendSessionChatMessage', { text }),
      interrupt: () => this.rpc('interruptSessionChat'),
      answerPrompt: (params) => this.rpc('answerSessionChatPrompt', params),
      queuePrompt: (params) => this.rpc('queueSessionChatPrompt', params),
      removeQueuedPrompt: (params) => this.rpc('removeSessionChatQueuedPrompt', params),
      updateQueuedPrompt: (params) => this.rpc('updateSessionChatQueuedPrompt', params),
      sendQueuedPrompt: (params) => this.rpc('sendSessionChatQueuedPrompt', params),
      reorderQueue: (params) => this.rpc('reorderSessionChatQueue', params),
      setDraft: (params) => this.rpc('setSessionChatDraft', params),
      selectSessionChatModel: (params) => this.rpc('selectSessionChatModel', params),
    };
  }
}
