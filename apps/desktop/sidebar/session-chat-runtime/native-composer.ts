import { asyncQuestionStorage } from '@/packages/shared/session-chat-controller/async-question-storage';
import { nativeChatSettings } from './native-chat-settings';
import { readSessionChatContextDetailsPreferences, writeSessionChatContextDetailsPreferences, type SessionChatContextDetailsPreferences } from '@/packages/shared/session-chat-presentation/context-details';
import { currentAgentModelCatalog } from '@/packages/shared/agent-model-catalog-state';
import { modelSelectionPersistence, storedModelSelectionKeys, type ModelSelectionIntent } from '@/packages/shared/session-chat-controller/model-selection';
import { readStoredSessionChatOptions, writeStoredSessionChatOptions, storedSessionChatOptionKeys, type SessionChatOptionState } from '@/packages/core-ui/chat/session-chat-session-options';
import { dismissedNoticeState, readStoredDismissedNotice, writeStoredDismissedNotice } from '@/packages/shared/session-chat-controller/notice-state';
import type { SessionChatTerminalNotice } from '@/packages/shared/session-chat';
import { questionDraftStorageKey, readQuestionDrafts, writeQuestionDrafts, remainingQuestionDrafts, type AnswerDrafts } from '@/packages/shared/session-chat-controller/question-drafts';
import { hasAppliedSessionChatReturnedPrompt, markSessionChatReturnedPromptApplied } from '@/packages/core-ui/chat/session-chat-returned-prompt';
import { flushClientStorage } from '@/packages/client-storage';
import {
  readStoredSessionChatDraftEntry,
  writeStoredSessionChatDraft,
  clearStoredSessionChatDraftIfUnchanged,
  nextSessionChatDraftVersion,
} from '@/packages/core-ui/chat/session-chat-draft-storage';
import { preserveDraftRevision } from '@/packages/core-ui/chat/session-chat-draft-recovery';
import { flushDraftSaves, persistDraftsForRelease } from '@/packages/core-ui/chat/session-chat-draft-outbox';
import { listSentSessionChatMessages, recordDeliveredSessionChatDrafts, recordSentSessionChatMessage } from '@/packages/core-ui/chat/session-chat-sent-history';
import { sessionChatDraftClientId } from '@/packages/shared/session-chat-controller/client-id';
import { classifyDraftHandoff } from '@/packages/shared/session-chat-controller/draft-handoff';
import { readStoredSessionChatSummary, writeStoredSessionChatSummary } from '@/packages/core-ui/chat/session-chat-summary-override';
import { readStoredSessionChatVerbose, writeStoredSessionChatVerbose } from '@/packages/core-ui/chat/session-chat-verbose-override';
import type { SessionChatDraftVersion, SessionChatDeliveredDraft } from '@/packages/shared/session-chat-queue';

export interface NativeComposerRequest {
  operation: 'asyncQuestionRead' | 'asyncQuestionWrite' | 'asyncQuestionRetire' | 'contextSave' | 'optionWrite' | 'modelWrite' | 'modelAck' | 'read' | 'write' | 'flush' | 'submitted' | 'park' | 'deliveries' | 'receive' | 'summary' | 'verbose' | 'history' | 'claimReturned' | 'questionRead' | 'questionWrite' | 'questionClear' | 'dismissNotice';
  agent?: 'claude' | 'codex';
  preferences?: SessionChatContextDetailsPreferences;
  optionKey?: string;
  optionState?: SessionChatOptionState;
  modelSelection?: ModelSelectionIntent;
  selectionId?: string;
  notice?: SessionChatTerminalNotice;
  promptKey?: string;
  questionId?: string;
  answers?: AnswerDrafts;
  returnedId?: string;
  enabled?: boolean;
  submitted?: boolean;
  current?: string;
  text?: string;
  version?: SessionChatDraftVersion;
  deliveries?: SessionChatDeliveredDraft[];
}

/** Both composers use the same durable draft index, outbox, recovery checkpoints and consumed receipts. */
export async function nativeComposerRequest(sessionKey: string, request: NativeComposerRequest): Promise<unknown> {
  switch (request.operation) {
    case 'contextSave': {
      if ((request.agent !== 'claude' && request.agent !== 'codex') || !request.preferences) throw new Error('Context preferences require an agent and rows.');
      writeSessionChatContextDetailsPreferences(request.preferences,request.agent);
      await flushClientStorage([request.agent === 'codex' ? 'codexContext' : 'claudeContext']);
      return true;
    }
    case 'optionWrite':
    case 'modelWrite':
    case 'modelAck': {
      const key = request.optionKey;
      if (!key || (key !== sessionKey && !key.startsWith(`${sessionKey}#`))) throw new Error('The option identity does not belong to this session.');
      if (request.operation === 'optionWrite') {
        if (!request.optionState) throw new Error('An option state is required.');
        writeStoredSessionChatOptions(key, request.optionState);
        await flushClientStorage(['sessionOptions']);
      } else if (request.operation === 'modelWrite') {
        if (!request.modelSelection) throw new Error('A model selection is required.');
        await modelSelectionPersistence.write(key, request.modelSelection);
        await flushClientStorage(['modelOutbox']);
      } else {
        if (!request.selectionId) throw new Error('A model selection identity is required.');
        await modelSelectionPersistence.acknowledge(key, request.selectionId);
        await flushClientStorage(['modelOutbox']);
      }
      return true;
    }
    case 'dismissNotice': {
      if (!request.notice) throw new Error('A notice identity is required for dismissal.');
      const dismissed = dismissedNoticeState(request.notice);
      writeStoredDismissedNotice(sessionKey, dismissed);
      await flushClientStorage(['notices']);
      return dismissed;
    }
    case 'asyncQuestionRead': return asyncQuestionStorage(sessionKey).read();
    case 'asyncQuestionWrite':
      await asyncQuestionStorage(sessionKey).write(request.answers ?? {});
      await flushClientStorage(['questionDrafts']);
      return true;
    case 'asyncQuestionRetire':
      if (!request.questionId) throw new Error('A question identity is required.');
      await asyncQuestionStorage(sessionKey).retire(request.questionId, request.answers ?? {});
      await flushClientStorage(['questionDrafts', 'retiredQuestions']);
      return true;
    case 'questionRead':
    case 'questionWrite':
    case 'questionClear': {
      if (!request.promptKey) throw new Error('Question drafts require the prompt identity.');
      const key = questionDraftStorageKey(sessionKey, request.promptKey)!;
      if (request.operation === 'questionRead') return readQuestionDrafts(key);
      const drafts = request.operation === 'questionClear' ? remainingQuestionDrafts(readQuestionDrafts(key), request.answers ?? {}) : request.answers ?? {};
      writeQuestionDrafts(key, drafts);
      await flushClientStorage(['questionDrafts']);
      return drafts;
    }
    case 'claimReturned': {
      if (!request.returnedId) throw new Error('A returned prompt requires its delivery identity.');
      if (hasAppliedSessionChatReturnedPrompt(request.returnedId)) return false;
      markSessionChatReturnedPromptApplied(request.returnedId);
      await flushClientStorage(['returnedPrompts']);
      return true;
    }
    case 'history': return listSentSessionChatMessages().map(message => message.content).reverse();
    case 'summary': writeStoredSessionChatSummary(sessionKey, request.enabled === true); return request.enabled === true;
    case 'verbose': writeStoredSessionChatVerbose(sessionKey, request.enabled === true); return request.enabled === true;
    case 'receive': {
      if (typeof request.text !== 'string' || typeof request.current !== 'string') throw new Error('A transfer requires the incoming and current drafts.');
      const stored = readStoredSessionChatDraftEntry(sessionKey);
      const version = request.version ?? nextSessionChatDraftVersion();
      preserveDraftRevision({ sessionKey, text: request.text, version, updatedAt: Date.now() });
      const disposition = classifyDraftHandoff({ current: request.current, content: request.text, version: request.version, stored, parked: stored?.parked === true });
      const entry = disposition === 'accept' ? writeStoredSessionChatDraft(sessionKey, request.text, undefined, version) : stored;
      await flushClientStorage(['drafts', 'recovery', 'draftOutbox']);
      await flushDraftSaves(sessionKey);
      return { disposition, entry, version };
    }
    case 'read': {
      const stored = readStoredSessionChatDraftEntry(sessionKey);
      /**
       * CDXC:Drafts 2026-09-19 WHY:
       * A parked draft was handed to the terminal, so the native composer opens empty. Reusing the parked revision made its blur save claim "" under the revision gxserver holds for the handed-off text, and every save failed with "Two editors changed the same draft revision". It starts a fresh draft, as the live handoff already does with nextVersion.
       */
      const version = stored?.version && !stored.submitted && !stored.parked ? stored.version : nextSessionChatDraftVersion();
      return { sessionKey, chatSettings: nativeChatSettings(sessionKey), contextPreferences: { claude: readSessionChatContextDetailsPreferences('claude'), codex: readSessionChatContextDetailsPreferences('codex') }, modelCatalog: currentAgentModelCatalog(),
        optionStates: Object.fromEntries(storedSessionChatOptionKeys(sessionKey).map(key => [key, readStoredSessionChatOptions(key)])),
        modelOutboxes: Object.fromEntries(storedModelSelectionKeys(sessionKey).map(key => [key, modelSelectionPersistence.read(key)])),
        dismissedNotice: readStoredDismissedNotice(sessionKey), clientId: sessionChatDraftClientId(), entry: { ...stored, version }, nextVersion: nextSessionChatDraftVersion(), summaryMode: readStoredSessionChatSummary(sessionKey), verboseOverride: readStoredSessionChatVerbose(sessionKey) };
    }
    case 'write': {
      if (typeof request.text !== 'string' || !request.version) throw new Error('A draft edit requires text and a revision.');
      const entry = writeStoredSessionChatDraft(sessionKey, request.text, undefined, request.version, request.submitted === true);
      await persistDraftsForRelease(sessionKey);
      return entry;
    }
    case 'flush': await flushDraftSaves(sessionKey); return true;
    case 'submitted': {
      clearStoredSessionChatDraftIfUnchanged(sessionKey, { text: request.text ?? '', version: request.version, updatedAt: Date.now() });
      recordSentSessionChatMessage(request.text ?? '', sessionKey);
      await flushClientStorage(['drafts', 'recovery', 'draftOutbox', 'sentHistory']);
      return { nextVersion: nextSessionChatDraftVersion() };
    }
    case 'park': {
      const entry = readStoredSessionChatDraftEntry(sessionKey);
      if (!entry || entry.text !== request.text || entry.version?.draftId !== request.version?.draftId || entry.version?.revision !== request.version?.revision) throw new Error('The draft changed during transfer. It has been kept in Chat.');
      await flushDraftSaves(sessionKey);
      preserveDraftRevision({ ...entry, sessionKey, updatedAt: entry.updatedAt ?? Date.now() });
      writeStoredSessionChatDraft(sessionKey, entry.text, entry.updatedAt, entry.version, false, true);
      await flushClientStorage(['drafts', 'recovery', 'draftOutbox']);
      return { handoffId: crypto.randomUUID(), content: entry.text, draftVersion: entry.version, nextVersion: nextSessionChatDraftVersion() };
    }
    case 'deliveries': recordDeliveredSessionChatDrafts(request.deliveries ?? []); return true;
  }
}
