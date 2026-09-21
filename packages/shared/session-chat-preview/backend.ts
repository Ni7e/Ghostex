import { listProjectMarkdownDocumentPaths, saveProjectMarkdownDocument } from '../project-docs';
import {
  pendingSessionChatAsyncQuestions,
  sessionChatAsyncAnswerPrefix,
} from '../session-chat-presentation/async-questions';
import type { GxserverSessionChatEvent, GxserverReadSessionChatResult } from '../session-chat';
import type { SessionChatTransport } from '@/packages/core-ui/chat/session-chat-transport';
import { normalizeSessionChatContextDetailsPreferences } from '../session-chat-presentation/context-details';
import { currentAgentModelCatalog } from '../agent-model-catalog-state';
import type { AgentAccountsRequest } from '../agent-accounts';
import { chatPreviewAccounts, chatPreviewSnapshot, previewMessage, type ChatPreviewConfig } from './fixture';
import {
  chatPreviewForkBranches,
  chatPreviewHistoryPage,
  chatPreviewSubagentPage,
  PREVIEW_IMAGE_FILES,
} from './scenarios';

const PREVIEW_PROJECT_ROOT = '/sample/project';

/**
 * The sample project the composer's `@` popup walks, and the skills its `$` popup lists. Without
 * them both chats open an empty picker, so neither popup can be compared. The list deliberately
 * holds more "session-chat" namesakes than either picker shows at once, a path with a space, and
 * deeply nested namesakes, so ranking, scrolling and truncation can be compared side by side.
 */
function chatPreviewFiles() {
  return {
    rootPath: PREVIEW_PROJECT_ROOT,
    generatedAt: new Date().toISOString(),
    files: [
      'AGENTS.md',
      'README.md',
      'package.json',
      'apps/desktop/src/app/native_chat/transcript.rs',
      'apps/desktop/src/app/native_chat/composer.rs',
      'apps/desktop/src/app/native_chat/suggestions/render.rs',
      'apps/desktop/src/app/native_chat/suggestions/window.rs',
      'apps/mobile/views/chat/session-chat-main.tsx',
      'apps/web/src/chat/session-chat-transport.ts',
      'packages/core-ui/chat/session-chat-view.tsx',
      'packages/core-ui/chat/session-chat-composer.tsx',
      'packages/core-ui/chat/session-chat-composer-trigger.ts',
      'packages/core-ui/chat/session-chat-slash-commands.ts',
      'packages/core-ui/chat/session-chat-lexical-input.tsx',
      'packages/core-ui/chat/session-chat-plain-input.tsx',
      'packages/core-ui/chat/session-chat-file-paths.ts',
      'packages/core-ui/styles/chat.css',
      'packages/shared/session-chat.ts',
      'packages/shared/session-chat-presentation/composer-suggestions.ts',
      'packages/shared/session-chat-presentation/references.ts',
      'packages/shared/session-chat-controller/native-suggestions.ts',
      'packages/shared/session-chat-controller/controller.ts',
      'server/src/session_chat_files.rs',
      'server/src/session_chat_skills.rs',
      'src/chat.ts',
      'src/notes/meeting notes.md',
      'src/notes/archive/2026/session chat parity notes.md',
      'tooling/release-notes.md',
    ],
    truncated: false,
  };
}

function chatPreviewSkills() {
  return {
    agentId: 'codex',
    generatedAt: new Date().toISOString(),
    skills: [
      { name: 'ghostex-help', sourceKind: 'global' as const, root: '/sample/home/.ghostex/skills' },
      { name: 'code-review', sourceKind: 'global' as const, root: '/sample/home/.ghostex/skills' },
      { name: 'release-notes', sourceKind: 'repository' as const, root: `${PREVIEW_PROJECT_ROOT}/skills` },
      { name: 'ux-mockups', sourceKind: 'repository' as const, root: `${PREVIEW_PROJECT_ROOT}/skills` },
      // A plugin-cache skill whose folder is far too long for the second column, so both pickers
      // can be compared on where they truncate it.
      {
        name: 'session-chat-parity-review',
        sourceKind: 'pluginCache' as const,
        root: '/sample/home/.claude/plugins/cache/ghostex-plugins-official/chat-parity/9f3c1d2b4a5e/skills',
      },
    ].map(({ root, ...skill }) => ({
      ...skill,
      directoryPath: `${root}/${skill.name}`,
      skillFilePath: `${root}/${skill.name}/SKILL.md`,
    })),
  };
}

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
  private accounts = chatPreviewAccounts();
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
        result =
          typeof params.subagent === 'string' && params.subagent
            ? chatPreviewSubagentPage(params.subagent)
            : typeof params.beforeOffset === 'number' && params.beforeOffset > 0
              ? chatPreviewHistoryPage(params.beforeOffset)
              : this.snapshot;
        break;
      case 'readSessionChatImage': {
        const file = PREVIEW_IMAGE_FILES[params.path];
        if (!file) throw new Error(`${params.path} is not part of the sample conversation.`);
        result = { ...file, bytes: Math.ceil((file.base64Data.length * 3) / 4) };
        break;
      }
      /*
      Only the history scenario has a fork family. Every other sample answers with the single
      session that asked, which is what an unforked conversation looks like: the switcher stays
      hidden instead of showing a one-row menu.
      */
      case 'sessionForkBranches':
        result = this.config.scenario === 'history' ? chatPreviewForkBranches() : { branches: [] };
        break;
      case 'readSessionChatSkills':
        result = chatPreviewSkills();
        break;
      case 'readSessionChatFiles':
        result = chatPreviewFiles();
        break;
      case 'agentAccounts':
        result = this.accountsRequest(params);
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
  private accountsRequest(params: AgentAccountsRequest) {
    const session = this.accounts.session!;
    if (params.operation === 'sessionPolicy') session.override = params.policy;
    if (params.operation === 'stopRecovery') delete session.recovery;
    if (params.operation === 'select' && params.accountId) this.switchAccount(params.accountId);
    return JSON.parse(JSON.stringify(this.accounts));
  }
  /** Walks the switch card through gxserver's phases; the spare account fails to sign in. */
  private switchAccount(toAccountId: string) {
    const session = this.accounts.session!;
    const progress = {
      id: `preview-switch-${++this.counter}`,
      provider: 'codex' as const,
      source: 'manual' as const,
      fromAccountId: session.accountId,
      toAccountId,
    };
    const fails = toAccountId === 'spare';
    const phases = [
      ['switching', 0],
      ['resuming', 2500],
      [fails ? 'failed' : 'success', 5000],
    ] as const;
    for (const [phase, delay] of phases) {
      setTimeout(() => {
        if (phase === 'success') session.accountId = toAccountId;
        this.snapshot.accountSwitch = {
          ...progress,
          phase,
          updatedAt: new Date().toISOString(),
          ...(phase === 'failed'
            ? { reason: 'We couldn’t confirm the spare@example.com login. Sign in again in Settings.' }
            : {}),
        };
        this.publish();
      }, delay);
    }
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
      case 'modelFavorites':
      case 'modelFavoriteToggle':
        return [];
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
      read: (params) => this.rpc('readSessionChat', params),
      readHistory: (params) => this.rpc('readSessionChat', params),
      readSubagent: (params) => this.rpc('readSessionChat', params),
      forkBranches: () => this.rpc('sessionForkBranches'),
      loadImage: (params) => this.rpc('readSessionChatImage', params),
      readFiles: () => this.rpc('readSessionChatFiles'),
      readSkills: () => this.rpc('readSessionChatSkills'),
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
      accounts: (params) => this.rpc('agentAccounts', params),
    };
  }
}
