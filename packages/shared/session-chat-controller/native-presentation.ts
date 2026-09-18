import { sessionChatSimpleEditLabel, sessionChatToolCountLabel } from '../session-chat-presentation/simple';
import { answeredSessionChatQuestionExchange } from '../session-chat-presentation/questions';
import {
  normalizeUserMessageMarkdown,
  splitReasoningHeadline,
  userTurnCopyMarkdown,
} from '../session-chat-presentation/message-text';
import {
  parseSessionChatAgentMessage,
  parseSessionChatInterAgentMessage,
  agentDisplayName,
} from '../session-chat-presentation/agent-message';
import { completedChatWork, projectChatTranscript } from '../session-chat-presentation/transcript';
import {
  sessionChatMessageText,
  sessionChatSuppressedTurnPresentation,
} from '@/packages/core-ui/chat/session-chat-noise';
import { splitSessionChatBlocks, pairSessionChatToolBlocks } from '@/packages/core-ui/chat/session-chat-tool-fold';
import { splitSessionChatFileChanges } from '@/packages/core-ui/chat/session-chat-file-changes';
import {
  formatSessionChatToolInput,
  summarizeSessionChatToolInput,
  summarizeSessionChatCommandInput,
} from '@/packages/core-ui/chat/session-chat-tool-summary';
import { partitionCompletedChatWork, workedDurationLabel } from '../session-chat-presentation/turns';
import type { SessionChatMessage } from '../session-chat';
import { sessionChatMessageActionContent } from '../session-chat-presentation/message-actions';
import { sessionChatMarkdownReferences } from '../session-chat-presentation/markdown-links';
import { sameSessionChatMessage } from '@/packages/core-ui/chat/session-chat-message-equality';

function projectMessage(message: SessionChatMessage) {
  const { tools, prose } = splitSessionChatBlocks(message.blocks);
  const images = prose.filter((block) => block.type === 'image-ref');
  const body = sessionChatMessageText(message);
  const displayedBody = message.role === 'user' ? normalizeUserMessageMarkdown(body) : body;
  const agentMessage = parseSessionChatAgentMessage(body);
  const changes = splitSessionChatFileChanges(tools);
  return {
    ...message,
    text: displayedBody,
    copyText: message.role === 'user' ? userTurnCopyMarkdown(displayedBody, images) : body,
    actionContent: sessionChatMessageActionContent(body),
    markdownReferences: sessionChatMarkdownReferences(displayedBody),
    reasoning: splitReasoningHeadline(body),
    agentMessage: agentMessage ? { ...agentMessage, name: agentDisplayName(agentMessage.sender) } : null,
    interAgentMessage: message.role === 'user' ? parseSessionChatInterAgentMessage(body) : null,
    questions: pairSessionChatToolBlocks(tools).map(answeredSessionChatQuestionExchange).filter(Boolean),
    images,
    suppressed: sessionChatSuppressedTurnPresentation(message),
    files: changes.changes,
    simpleFileLabel: sessionChatSimpleEditLabel(new Set(changes.changes.map((change) => change.path)).size),
    simpleToolLabel: sessionChatToolCountLabel(
      pairSessionChatToolBlocks(changes.tools).filter((pair) => pair.call).length
    ),
    tools: pairSessionChatToolBlocks(changes.tools).map((pair) => ({
      ...pair,
      preview: pair.call
        ? /exec|command|shell|terminal|bash/i.test(pair.call.name)
          ? summarizeSessionChatCommandInput(pair.call.input)
          : summarizeSessionChatToolInput(pair.call.input)
        : '',
      input: pair.call ? formatSessionChatToolInput(pair.call.input) : '',
    })),
  };
}

type ProjectedMessage = ReturnType<typeof projectMessage>;
type TranscriptItem = Record<string, unknown> & { kind: string };

function transcriptItemKey(item: TranscriptItem): string {
  return `${item.kind}:${item.kind === 'message' ? (item.message as ProjectedMessage).id : item.id}`;
}

/** Two projected items with the same key are interchangeable when every field is the same object or the same list of objects. */
function sameTranscriptItem(previous: TranscriptItem, next: TranscriptItem): boolean {
  const keys = Object.keys(next);
  if (keys.length !== Object.keys(previous).length) return false;
  return keys.every((key) => {
    const left = previous[key];
    const right = next[key];
    if (Object.is(left, right)) return true;
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => Object.is(value, right[index]))
    );
  });
}

export class NativeChatPresentation {
  private models = new WeakMap<SessionChatMessage, ProjectedMessage>();
  /**
   * CDXC:SessionChat 2026-09-18 WHY:
   * Transcript normalization recreates every user turn object on each controller run, and a working session publishes a state frame once a second.
   * Keyed by identity alone, the cache re-parsed the markdown of every user turn per frame (about 380ms of QuickJS time on a 139-message transcript, on the UI thread).
   * A recreated message that is data-identical keeps its projection, the same rule React's memoized rows apply, and unchanged items keep their identity so the host only ships the changed window.
   */
  private modelsById = new Map<string, { source: SessionChatMessage; model: ProjectedMessage }>();
  private messages?: readonly SessionChatMessage[];
  private working?: boolean;
  private summary?: boolean;
  private detailRevision = -1;
  private projection?: ReturnType<typeof projectChatTranscript>;
  private result?: { items: unknown[]; finalIds: string[] };

  private message = (message: SessionChatMessage) => {
    let result = this.models.get(message);
    if (result) return result;
    const cached = this.modelsById.get(message.id);
    result = cached && sameSessionChatMessage(cached.source, message) ? cached.model : projectMessage(message);
    this.models.set(message, result);
    this.modelsById.set(message.id, { source: message, model: result });
    return result;
  };

  private reuseItems(items: TranscriptItem[]): TranscriptItem[] {
    const previous = new Map<string, TranscriptItem>();
    for (const item of (this.result?.items ?? []) as TranscriptItem[]) previous.set(transcriptItemKey(item), item);
    return items.map((item) => {
      const candidate = previous.get(transcriptItemKey(item));
      return candidate && sameTranscriptItem(candidate, item) ? candidate : item;
    });
  }

  private pruneModels(messages: readonly SessionChatMessage[], deferred: ReadonlyMap<string, SessionChatMessage[]>) {
    if (this.modelsById.size <= messages.length * 2 + 64) return;
    const live = new Set(messages.map((message) => message.id));
    for (const rows of deferred.values()) for (const row of rows) live.add(row.id);
    for (const id of [...this.modelsById.keys()]) if (!live.has(id)) this.modelsById.delete(id);
  }

  update(
    messages: readonly SessionChatMessage[],
    working: boolean,
    summary: boolean,
    deferred: ReadonlyMap<string, SessionChatMessage[]>,
    detailRevision: number
  ) {
    const changed = messages !== this.messages || working !== this.working;
    if (changed || !this.projection) {
      this.messages = messages;
      this.working = working;
      this.projection = projectChatTranscript(messages, working);
    }
    if (changed || summary !== this.summary || detailRevision !== this.detailRevision || !this.result) {
      this.summary = summary;
      this.detailRevision = detailRevision;
      const projection = this.projection;
      const items: TranscriptItem[] = summary
        ? projection.summaryTurns.map((turn) => ({
            kind: 'summary',
            id: turn.user.id,
            user: this.message(turn.user),
            final: turn.final ? this.message(turn.final) : null,
            active: turn.active,
            work: turn.activeWork.map(this.message),
          }))
        : projection.items.map((item) => {
            if (item.kind === 'message') return { kind: item.kind, message: this.message(item.message) };
            const { collapsedWork, visibleArtifacts } = partitionCompletedChatWork(
              completedChatWork(item.turn, deferred.get(item.turn.user.id))
            );
            return {
              kind: item.kind,
              id: item.turn.user.id,
              label: workedDurationLabel(
                item.turn.user.timestamp,
                item.turn.final?.timestamp ?? item.turn.user.deferredWork?.completedAt ?? null
              ),
              expandable: collapsedWork.length > 0 || Boolean(item.turn.user.deferredWork),
              deferred: item.turn.user.deferredWork,
              work: collapsedWork.map(this.message),
              artifacts: visibleArtifacts.map(this.message),
              final: item.turn.final ? this.message(item.turn.final) : undefined,
            };
          });
      this.result = { items: this.reuseItems(items), finalIds: projection.finalIds };
      this.pruneModels(messages, deferred);
    }
    return this.result;
  }
}
