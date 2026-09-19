import { sessionChatSimpleEditLabel, sessionChatToolCountLabel } from '../session-chat-presentation/simple';
import { sessionChatToolRunShowsAllRows } from '../session-chat-presentation/tool-rows';
import { sessionChatMessageQuestionExchanges } from '../session-chat-presentation/question-hoisting';
import { sessionChatImageSource } from '../session-chat-presentation/images';
import { sessionChatMessageCanRewind } from '../session-chat-presentation/message-rewind';
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
import { sessionChatSuppressedTurnPresentation } from '@/packages/core-ui/chat/session-chat-noise';
import { sessionChatProseMarkdown } from '../session-chat-presentation/prose-blocks';
import { classifySessionChatSystemCard } from '../session-chat-presentation/system-cards';
import { splitSessionChatBlocks, pairSessionChatToolBlocks } from '@/packages/core-ui/chat/session-chat-tool-fold';
import { splitSessionChatFileChanges } from '@/packages/core-ui/chat/session-chat-file-changes';
import {
  nativeChatFileRows,
  nativeChatTerminalTool,
  nativeChatToolFold,
  nativeChatToolRows,
} from './native-transcript-rows';
import { partitionCompletedChatWork, workedDurationLabel } from '../session-chat-presentation/turns';
import type { SessionChatMessage } from '../session-chat';
import { sessionChatMessageActionContent } from '../session-chat-presentation/message-actions';
import { sessionChatMarkdownReferences } from '../session-chat-presentation/markdown-links';
import { sessionChatNativeMarkdown } from '../session-chat-presentation/native-markdown';
import { sameSessionChatMessage } from '@/packages/core-ui/chat/session-chat-message-equality';
import { NativeChatMinimap } from './native-minimap';
import type { SessionChatMinimapMarker } from '../session-chat-presentation/minimap';

/** The session's directory, which shortens the paths on file-change cards. */
let workingDirectory: string | undefined;

function projectMessage(message: SessionChatMessage, agentPath: string) {
  const { tools, prose } = splitSessionChatBlocks(message.blocks);
  const images = prose.filter((block) => block.type === 'image-ref');
  const body = sessionChatProseMarkdown(message.blocks).trim();
  const displayedBody = message.role === 'user' ? normalizeUserMessageMarkdown(body) : body;
  const agentMessage = parseSessionChatAgentMessage(body);
  const changes = splitSessionChatFileChanges(tools);
  const toolPairs = pairSessionChatToolBlocks(changes.tools);
  const copyText = message.role === 'user' ? userTurnCopyMarkdown(displayedBody, images) : body;
  /** Code-block headers, GitHub alerts, and typed file paths, marked for the native renderer. */
  const nativeBody = sessionChatNativeMarkdown(displayedBody, message.role === 'user');
  const suppressed = sessionChatSuppressedTurnPresentation(message);
  const toolRows = nativeChatToolRows(toolPairs, agentPath);
  const systemCard = classifySessionChatSystemCard(message, displayedBody);
  return {
    ...message,
    text: nativeBody,
    copyText,
    canRewind: sessionChatMessageCanRewind(message, copyText, suppressed),
    actionContent: sessionChatMessageActionContent(body),
    markdownReferences: sessionChatMarkdownReferences(nativeBody),
    reasoning: splitReasoningHeadline(body),
    agentMessage: agentMessage ? { ...agentMessage, name: agentDisplayName(agentMessage.sender) } : null,
    interAgentMessage: message.role === 'user' ? parseSessionChatInterAgentMessage(body) : null,
    questions: sessionChatMessageQuestionExchanges(message),
    images: images.map(sessionChatImageSource),
    suppressed,
    /* The expanded subagent-message card renders its body as Markdown (React's session-chat-agent-message-card.tsx), so it needs the same marks and reference links the turn's own body gets; the collapsed clamp keeps the raw text React clamps. */
    systemCard:
      systemCard?.kind === 'agent-message'
        ? { ...systemCard, markdown: sessionChatNativeMarkdown(systemCard.body) }
        : systemCard,
    files: nativeChatFileRows(changes.changes, workingDirectory),
    simpleFileLabel: sessionChatSimpleEditLabel(new Set(changes.changes.map((change) => change.path)).size),
    /* React counts only the work rows for this label: an answered question is conversation, so its card sits outside the group and is not one of the "N tool calls". */
    simpleToolLabel: sessionChatToolCountLabel(toolRows.filter((row) => row.hasCall && !row.exchange).length),
    tools: toolRows,
    toolFold: nativeChatToolFold(toolPairs),
    toolsShowAllRows: sessionChatToolRunShowsAllRows(body.length > 0),
    terminalTool: nativeChatTerminalTool(message),
  };
}

type ProjectedMessage = ReturnType<typeof projectMessage>;
type TranscriptItem = Record<string, unknown> & { kind: string };

/** Items from the tail that are fully projected before the first publish; the rest backfill in batches of the same size. */
const EAGER_TAIL_ITEMS = 12;
const BACKFILL_BATCH = 24;

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
  private minimap = new NativeChatMinimap();
  private result?: { items: unknown[]; finalIds: string[]; minimap: readonly SessionChatMinimapMarker[] };
  /**
   * CDXC:SessionChat 2026-09-18 WHY:
   * Projecting a message parses its markdown twice (bare file paths, then references), and a 139-message transcript took about 800ms of QuickJS before its first item existed.
   * The transcript follows its tail, so only the newest items are projected before the first publish; older ones ship as plain-text placeholders and are backfilled in batches on the runtime's timer, newest first, each batch republishing.
   */
  private placeholders = new WeakMap<SessionChatMessage, ProjectedMessage>();
  private backfill: SessionChatMessage[] = [];
  private backfillTimer: ReturnType<typeof setTimeout> | undefined;
  private backfillRevision = 0;
  private appliedBackfill = 0;
  onBackfill?: () => void;

  /** The conversation these messages belong to: `/root` for the session, the child's own path inside the subagent viewer. */
  private agentPath = '/root';

  /** A viewer showing another conversation resolves its subagent rows against that conversation. */
  setAgentPath(agentPath: string) {
    if (agentPath === this.agentPath) return;
    this.agentPath = agentPath;
    this.models = new WeakMap();
    this.modelsById.clear();
    this.result = undefined;
  }

  /** Projected paths depend on it, so a late directory throws the cached projections away. */
  setWorkingDirectory(directory: string | undefined) {
    if (directory === workingDirectory) return;
    workingDirectory = directory;
    this.models = new WeakMap();
    this.modelsById.clear();
    this.result = undefined;
  }

  private message = (message: SessionChatMessage) => {
    let result = this.models.get(message);
    if (result) return result;
    const cached = this.modelsById.get(message.id);
    result =
      cached && sameSessionChatMessage(cached.source, message) ? cached.model : projectMessage(message, this.agentPath);
    this.models.set(message, result);
    this.modelsById.set(message.id, { source: message, model: result });
    return result;
  };

  private projected(message: SessionChatMessage): ProjectedMessage | undefined {
    const direct = this.models.get(message);
    if (direct) return direct;
    const cached = this.modelsById.get(message.id);
    return cached && sameSessionChatMessage(cached.source, message) ? this.message(message) : undefined;
  }

  /** The full projection when it is cheap or the row is near the tail; otherwise a stable plain-text stand-in queued for backfill. */
  private messageOrPlaceholder = (message: SessionChatMessage, eager: boolean): ProjectedMessage => {
    const projected = this.projected(message);
    if (projected || eager) return projected ?? this.message(message);
    let placeholder = this.placeholders.get(message);
    if (!placeholder) {
      const text = message.blocks
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('\n')
        .trim();
      placeholder = { ...message, text, copyText: text, pending: true } as unknown as ProjectedMessage;
      this.placeholders.set(message, placeholder);
    }
    this.backfill.push(message);
    return placeholder;
  };

  private scheduleBackfill() {
    if (this.backfillTimer !== undefined || this.backfill.length === 0) return;
    this.backfillTimer = setTimeout(() => {
      this.backfillTimer = undefined;
      for (const message of this.backfill.splice(-BACKFILL_BATCH)) this.message(message);
      this.backfillRevision++;
      this.onBackfill?.();
    }, 0);
  }

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
    if (
      changed ||
      summary !== this.summary ||
      detailRevision !== this.detailRevision ||
      this.appliedBackfill !== this.backfillRevision ||
      !this.result
    ) {
      this.summary = summary;
      this.detailRevision = detailRevision;
      this.appliedBackfill = this.backfillRevision;
      this.backfill = [];
      const projection = this.projection;
      const eagerFrom = (summary ? projection.summaryTurns.length : projection.items.length) - EAGER_TAIL_ITEMS;
      const items: TranscriptItem[] = summary
        ? projection.summaryTurns.map((turn, index) => {
            const eager = index >= eagerFrom;
            return {
              kind: 'summary',
              id: turn.user.id,
              user: this.messageOrPlaceholder(turn.user, eager),
              final: turn.final ? this.messageOrPlaceholder(turn.final, eager) : null,
              active: turn.active,
              work: turn.activeWork.map((message) => this.messageOrPlaceholder(message, eager)),
            };
          })
        : projection.items.map((item, index) => {
            const eager = index >= eagerFrom;
            const project = (message: SessionChatMessage) => this.messageOrPlaceholder(message, eager);
            if (item.kind === 'message') return { kind: item.kind, message: project(item.message) };
            const work = completedChatWork(item.turn, deferred.get(item.turn.user.id));
            const { collapsedWork, visibleArtifacts } = partitionCompletedChatWork(work);
            /*
            A finished turn's writes leave their rows and collect under one "N files changed" fold
            (the decision in session-chat-message-list/list.tsx). The rows come back through the
            per-message cache so an unchanged turn keeps the same card objects and ships nothing.
            */
            const files = [...work, ...(item.turn.final ? [item.turn.final] : [])].flatMap(
              (message) => project(message).files ?? []
            );
            const changedFiles = new Set([
              ...files.map((file) => file.path),
              ...(item.turn.user.deferredWork?.filePaths ?? []),
            ]).size;
            return {
              kind: item.kind,
              id: item.turn.user.id,
              label: workedDurationLabel(
                item.turn.user.timestamp,
                item.turn.final?.timestamp ?? item.turn.user.deferredWork?.completedAt ?? null
              ),
              files,
              filesLabel: `${changedFiles} ${changedFiles === 1 ? 'file' : 'files'} changed`,
              simpleFilesLabel: sessionChatSimpleEditLabel(changedFiles),
              expandable: collapsedWork.length > 0 || Boolean(item.turn.user.deferredWork),
              deferred: item.turn.user.deferredWork,
              work: collapsedWork.map(project),
              /* The turn's answered question cards, hoisted out of the fold (question-hoisting.ts). Read through the per-message cache so an unchanged turn keeps the same exchange objects and the host ships nothing. */
              questions: work.flatMap((row) => project(row).questions ?? []),
              artifacts: visibleArtifacts.map(project),
              final: item.turn.final ? project(item.turn.final) : undefined,
            };
          });
      const itemIndex = new Map<string, number>();
      items.forEach((item, index) => {
        const id = item.kind === 'message' ? (item.message as ProjectedMessage).id : (item.id as string);
        if (!itemIndex.has(id)) itemIndex.set(id, index);
      });
      this.result = {
        items: this.reuseItems(items),
        finalIds: projection.finalIds,
        minimap: this.minimap.project(projection.summaryTurns, itemIndex),
      };
      this.pruneModels(messages, deferred);
      this.scheduleBackfill();
    }
    return this.result;
  }
}
