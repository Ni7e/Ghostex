/**
 * The subagent transcript viewer behind GPUI chat: the navigation stack, the
 * page reads with their gap fill and poll, and the projection the native viewer
 * paints (`apps/desktop/src/app/native_chat/subagent_view.rs`).
 *
 * CDXC:SessionChat 2026-09-18 SEE-ALSO:
 * React runs the same viewer through `packages/core-ui/chat/use-session-chat-subagent.ts`
 * and `session-chat-subagent-viewer.tsx`. How a page is read, gap-filled, merged,
 * labelled or settled belongs to both surfaces, never to one renderer.
 */

import type { GxserverReadSessionChatResult, SessionChatMessage } from '../session-chat';
import { subagentModelLabel } from '../session-chat-presentation/agent-fleet';
import type { SessionChatSubagentTarget } from '../session-chat-presentation/subagent';
import { SESSION_CHAT_SETTLE_HOLD_MS } from '../session-chat-presentation/working-hold';
import { NativeChatPresentation } from './native-presentation';

export type NativeSubagentRead = (params: {
  subagent: string;
  limit?: number;
  beforeOffset?: number;
}) => Promise<GxserverReadSessionChatResult>;

/** Messages per page read, the size React's viewer asks for. */
const PAGE_LIMIT = 300;
/** How often an open viewer re-reads its newest page. */
const POLL_MS = 2_000;
/** A child transcript has no deferred-work rows of its own to merge. */
const NO_DEFERRED_WORK = new Map<string, SessionChatMessage[]>();

/** One opened target's reads. A new target (or a back step) cancels the previous one, the way React's keyed remount does. */
interface SubagentRead {
  cancelled: boolean;
  busy: boolean;
  page: GxserverReadSessionChatResult | null;
  timer?: ReturnType<typeof setTimeout>;
}

function label(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export class NativeSubagentViewer {
  private stack: SessionChatSubagentTarget[] = [];
  private active: SubagentRead | null = null;
  private error: string | null = null;
  private loadingEarlier = false;
  private presentation = this.projector();
  private items: unknown[] = [];
  /** The settle hold React's `useSessionChatWorkingHold` applies to the viewer's list. */
  private working = false;
  private holdTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly read: () => NativeSubagentRead | undefined,
    private readonly changed: () => void
  ) {}

  /** Every viewer command is pure view state: none of them clears a send error. */
  command(command: { type: string; [key: string]: unknown }): boolean {
    switch (command.type) {
      case 'openSubagent':
        this.open(command);
        return true;
      case 'subagentBack':
        if (this.stack.length > 1) {
          this.stack.pop();
          this.restart();
        }
        return true;
      case 'subagentClose':
        this.stack = [];
        this.restart();
        return true;
      case 'subagentRetry':
        void this.request(false);
        return true;
      case 'subagentLoadEarlier':
        void this.request(true);
        return true;
      default:
        return false;
    }
  }

  /** The viewer's transcript items, spliced across the bridge on their own channel. */
  transcriptItems(): unknown[] {
    return this.items;
  }

  /** True while the viewer is the pane's modal, which is when nothing behind it takes an event. */
  isOpen(): boolean {
    return this.stack.length > 0;
  }

  /** Null when the viewer is closed, which is what hides the native modal. */
  projection() {
    const target = this.stack[this.stack.length - 1];
    if (!target || !this.read()) return null;
    const page = this.active?.page ?? null;
    const info = page?.subagent ?? target;
    const loadingModel = !page && !target.model && !this.error;
    const unavailable = Boolean(this.error && !page && !target.model);
    return {
      selector: target.selector,
      /** The header's compact model and effort label; agent types stay in the tooltip. */
      title: loadingModel ? 'Loading…' : unavailable ? 'Model unavailable' : subagentModelLabel(info),
      tooltip: page?.subagent?.agentType ?? target.agentType ?? target.name,
      description: target.task ?? 'Subagent transcript',
      canBack: this.stack.length > 1,
      error: this.error,
      loading: !page && !this.error,
      empty: page?.messages.length === 0,
      hasMore: Boolean(page?.hasMore) && !this.error,
      loadingEarlier: this.loadingEarlier,
    };
  }

  private projector(): NativeChatPresentation {
    const presentation = new NativeChatPresentation();
    presentation.onBackfill = () => {
      this.project();
      this.changed();
    };
    return presentation;
  }

  private open(command: { [key: string]: unknown }): void {
    const selector = label(command.selector);
    if (!selector || !this.read()) return;
    this.stack.push({
      selector,
      name: label(command.name) ?? selector,
      agentType: label(command.agentType),
      task: label(command.task),
      model: label(command.model),
      effort: label(command.effort),
    });
    this.restart();
  }

  /** Cancel the open target's reads and start the one now on top of the stack. */
  private restart(): void {
    if (this.active) {
      this.active.cancelled = true;
      clearTimeout(this.active.timer);
    }
    clearTimeout(this.holdTimer);
    this.holdTimer = undefined;
    this.error = null;
    this.loadingEarlier = false;
    this.working = false;
    this.presentation = this.projector();
    this.active = this.stack.length ? { cancelled: false, busy: false, page: null } : null;
    this.project();
    this.changed();
    if (this.active) void this.request(false);
  }

  private project(): void {
    const page = this.active?.page;
    if (!page) {
      this.items = [];
      return;
    }
    // A nested selector is read against the transcript being shown, so a row pointing back at it is not a link.
    const name = page.subagent?.name ?? '';
    this.presentation.setAgentPath(name.startsWith('/') ? name : '/root');
    // A subagent transcript is always read in normal mode, with verbose and summarized off.
    this.items = this.presentation.update(page.messages, this.working, false, NO_DEFERRED_WORK, 0).items;
  }

  /** Going working is applied at once; settling waits out the hold, exactly as the React hook does. */
  private settle(live: boolean): void {
    if (live) {
      clearTimeout(this.holdTimer);
      this.holdTimer = undefined;
      this.working = true;
      return;
    }
    if (!this.working || this.holdTimer !== undefined) return;
    this.holdTimer = setTimeout(() => {
      this.holdTimer = undefined;
      this.working = false;
      this.project();
      this.changed();
    }, SESSION_CHAT_SETTLE_HOLD_MS);
  }

  private async request(earlier: boolean): Promise<void> {
    const active = this.active;
    const read = this.read();
    const target = this.stack[this.stack.length - 1];
    if (!active || !read || !target || active.busy || (earlier && !active.page?.hasMore)) return;
    active.busy = true;
    clearTimeout(active.timer);
    if (earlier) {
      this.loadingEarlier = true;
      this.changed();
    }
    try {
      const current = active.page;
      const next = await read({
        subagent: current?.subagent?.id ?? target.selector,
        limit: PAGE_LIMIT,
        ...(earlier && current ? { beforeOffset: current.beforeOffset } : {}),
      });
      // A daemon predating child reads must never paint the main conversation in the viewer.
      if (!next.subagent) throw new Error('This server needs an update to read subagent transcripts.');
      if (!earlier && current) {
        const lastOffset = current.messages[current.messages.length - 1]?.byteOffset;
        let cursor = next.beforeOffset;
        let hasMore = next.hasMore;
        while (!active.cancelled && lastOffset !== undefined && hasMore && cursor > lastOffset) {
          const gap = await read({ subagent: next.subagent.id, limit: PAGE_LIMIT, beforeOffset: cursor });
          if (gap.beforeOffset >= cursor) break;
          next.messages = [...gap.messages, ...next.messages];
          cursor = gap.beforeOffset;
          hasMore = gap.hasMore;
        }
        next.beforeOffset = cursor;
        next.hasMore = hasMore;
      }
      if (active.cancelled) return;
      if (earlier && current) {
        const ids = new Set(current.messages.map((message) => message.id));
        active.page = {
          ...current,
          beforeOffset: next.beforeOffset,
          hasMore: next.hasMore,
          messages: [...next.messages.filter((message) => !ids.has(message.id)), ...current.messages],
        };
      } else {
        const older = next.hasMore
          ? (current?.messages.filter((message) => (message.byteOffset ?? Infinity) < next.beforeOffset) ?? [])
          : [];
        active.page = {
          ...next,
          ...(older.length && current ? { beforeOffset: current.beforeOffset, hasMore: current.hasMore } : {}),
          messages: [...older, ...next.messages],
        };
      }
      this.error = null;
      this.settle(active.page.lifecycle?.state === 'working');
      this.project();
    } catch (error) {
      if (!active.cancelled) this.error = error instanceof Error ? error.message : String(error);
    } finally {
      active.busy = false;
      if (!active.cancelled) {
        this.loadingEarlier = false;
        active.timer = setTimeout(() => {
          void this.request(false);
        }, POLL_MS);
      }
      this.changed();
    }
  }
}
