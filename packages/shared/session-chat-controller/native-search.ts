import {
  sessionChatSearchCountLabel,
  sessionChatTranscriptMatches,
  type SessionChatTranscriptMatch,
} from '../session-chat-presentation/transcript-search';

/**
 * Transcript search state for GPUI chat: what is typed, which occurrence is
 * selected, and which rows carry a match. Navigation bumps `revision` so the
 * renderer scrolls exactly once per explicit move; a transcript refresh keeps
 * the selected occurrence within its row instead of snapping back to the first
 * result (the rule React's search settled on, session-chat-search.tsx).
 */
export class NativeChatSearch {
  private open = false;
  private query = '';
  private activeIndex = 0;
  private activeKey: string | null = null;
  private revision = 0;
  private matches: SessionChatTranscriptMatch[] = [];

  /** Returns false when the command is not one of search's. */
  command(command: { type: string; query?: string }): boolean {
    switch (command.type) {
      case 'searchOpen':
        this.open = true;
        this.revision++;
        return true;
      case 'searchClose':
        this.open = false;
        this.query = '';
        this.activeIndex = 0;
        this.activeKey = null;
        this.matches = [];
        return true;
      case 'searchQuery': {
        const next = command.query ?? '';
        if (next !== this.query) {
          this.query = next;
          this.activeIndex = 0;
          this.activeKey = null;
          this.revision++;
        }
        return true;
      }
      case 'searchNext':
        this.move(1);
        return true;
      case 'searchPrevious':
        this.move(-1);
        return true;
      default:
        return false;
    }
  }

  project(items: readonly unknown[]) {
    if (!this.open) {
      return null;
    }
    this.matches = sessionChatTranscriptMatches(items, this.query);
    const retained = this.activeKey === null ? -1 : this.matches.findIndex((match) => match.key === this.activeKey);
    this.activeIndex = retained >= 0 ? retained : Math.max(0, Math.min(this.activeIndex, this.matches.length - 1));
    this.activeKey = this.matches[this.activeIndex]?.key ?? null;
    const active = this.matches[this.activeIndex];
    return {
      open: true,
      query: this.query,
      total: this.matches.length,
      activeIndex: this.activeIndex,
      activeItem: active?.itemIndex ?? null,
      /** Row indices to tint, deduplicated and in transcript order. */
      items: [...new Set(this.matches.map((match) => match.itemIndex))],
      label: sessionChatSearchCountLabel(this.query, this.matches.length, this.activeIndex),
      revision: this.revision,
    };
  }

  private move(offset: number): void {
    if (this.matches.length === 0) return;
    this.activeIndex = (this.activeIndex + offset + this.matches.length) % this.matches.length;
    this.activeKey = this.matches[this.activeIndex]?.key ?? null;
    this.revision++;
  }
}
