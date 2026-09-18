import {
  sessionChatMinimapPreview,
  sessionChatMinimapVisible,
  type SessionChatMinimapMarker,
} from '../session-chat-presentation/minimap';
import { sameSessionChatMessage } from '@/packages/core-ui/chat/session-chat-message-equality';
import type { SummaryModeTurn } from '../session-chat-presentation/turns';
import type { SessionChatMessage } from '../session-chat';

function sameMarker(left: SessionChatMinimapMarker, right: SessionChatMinimapMarker): boolean {
  return left.id === right.id && left.item === right.item && left.prompt === right.prompt && left.reply === right.reply;
}

/**
 * CDXC:SessionChat 2026-09-18 WHY:
 * React reads the minimap's previews straight off the turns it already rendered, but the native rail gets them over the bridge, and a working session publishes a frame a second.
 * Previews are cached per message and the whole row list keeps its identity while nothing changed, so an unchanged rail costs one shallow comparison per turn and ships no bytes.
 */
export class NativeChatMinimap {
  private previews = new Map<string, { source: SessionChatMessage; text: string }>();
  private markers: SessionChatMinimapMarker[] = [];

  private preview(message: SessionChatMessage | null | undefined): string {
    if (!message) return '';
    const cached = this.previews.get(message.id);
    if (cached && (cached.source === message || sameSessionChatMessage(cached.source, message))) return cached.text;
    const text = sessionChatMinimapPreview(message);
    this.previews.set(message.id, { source: message, text });
    return text;
  }

  /** One row per genuine user prompt, pointing at the transcript row that renders it. */
  project(
    turns: readonly SummaryModeTurn[],
    itemIndex: ReadonlyMap<string, number>
  ): readonly SessionChatMinimapMarker[] {
    if (!sessionChatMinimapVisible(turns.length)) {
      this.previews.clear();
      if (this.markers.length > 0) this.markers = [];
      return this.markers;
    }
    const next = turns.map((turn) => ({
      id: turn.user.id,
      item: itemIndex.get(turn.user.id) ?? 0,
      prompt: this.preview(turn.user) || 'User message',
      reply: this.preview(turn.final),
    }));
    if (this.previews.size > turns.length * 4 + 64) {
      const live = new Set(turns.flatMap((turn) => (turn.final ? [turn.user.id, turn.final.id] : [turn.user.id])));
      for (const id of [...this.previews.keys()]) if (!live.has(id)) this.previews.delete(id);
    }
    if (
      next.length === this.markers.length &&
      next.every((marker, index) => sameMarker(marker, this.markers[index]!))
    ) {
      return this.markers;
    }
    this.markers = next;
    return next;
  }
}
