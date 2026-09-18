import { sessionChatSimpleEditLabel, sessionChatToolCountLabel } from '../session-chat-presentation/simple';
import { answeredSessionChatQuestionExchange } from '../session-chat-presentation/questions';
import {
  normalizeUserMessageMarkdown,
  splitReasoningHeadline,
  userTurnCopyMarkdown,
} from '../session-chat-presentation/message-text';
import { parseSessionChatAgentMessage, agentDisplayName } from '../session-chat-presentation/agent-message';
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

function projectMessage(message: SessionChatMessage) {
  const { tools, prose } = splitSessionChatBlocks(message.blocks);
  const images = prose.filter((block) => block.type === 'image-ref');
  const body = sessionChatMessageText(message);
  const agentMessage = parseSessionChatAgentMessage(body);
  const changes = splitSessionChatFileChanges(tools);
  return {
    ...message,
    text: message.role === 'user' ? normalizeUserMessageMarkdown(body) : body,
    copyText: message.role === 'user' ? userTurnCopyMarkdown(normalizeUserMessageMarkdown(body), images) : body,
    actionContent: sessionChatMessageActionContent(body),
    reasoning: splitReasoningHeadline(body),
    agentMessage: agentMessage ? { ...agentMessage, name: agentDisplayName(agentMessage.sender) } : null,
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

export class NativeChatPresentation {
  private models = new WeakMap<SessionChatMessage, ReturnType<typeof projectMessage>>();
  private messages?: readonly SessionChatMessage[];
  private working?: boolean;
  private summary?: boolean;
  private detailRevision = -1;
  private projection?: ReturnType<typeof projectChatTranscript>;
  private result?: { items: unknown[]; finalIds: string[] };

  private message = (message: SessionChatMessage) => {
    let result = this.models.get(message);
    if (!result) {
      result = projectMessage(message);
      this.models.set(message, result);
    }
    return result;
  };

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
      const items = summary
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
      this.result = { items, finalIds: projection.finalIds };
    }
    return this.result;
  }
}
