export interface NativeComposerChromeNote {
  edited: boolean;
  open: boolean;
  saved: string;
  value: string;
}

export interface NativeComposerChromeProjection {
  /** The stash button's count badge text, capped the way the React badge caps it. */
  stashBadge: string | null;
  notePresence: boolean;
  notePressed: boolean;
  summaryPressed: boolean;
}

interface StashedPromptRow {
  agentSessionId?: string | null;
  sessionId?: string | null;
}

/**
 * CDXC:SessionChat 2026-09-18 SEE-ALSO:
 * The React chrome is `packages/core-ui/chat/session-chat-composer-actions.tsx`: a stash count
 * badge, a session-note presence dot, and pressed Summary/Note buttons. `session-chat-view.tsx`
 * reads the same two sources; this keeps GPUI chat reading them through one projection.
 */
export class NativeComposerChrome {
  private agentSessionId: string | null = null;
  private generation = 0;
  private noteText = '';
  /** Once the note editor has opened, its own state is newer than the presence read. */
  private noteOwned = false;
  private sessionId: string | null = null;
  private stashedPromptCount = 0;

  constructor(
    private readonly reads: {
      listStashedPrompts: () => Promise<{ prompts?: readonly StashedPromptRow[] }>;
      readSessionNote: () => Promise<{ note?: string }>;
    },
    private readonly changed: () => void
  ) {}

  /** Re-reads both sources. Answers that land after the conversation moved on are discarded. */
  async refresh(sessionId?: string | null): Promise<void> {
    if (sessionId !== undefined) this.sessionId = sessionId;
    const generation = ++this.generation;
    const [prompts, note] = await Promise.all([
      this.reads.listStashedPrompts().catch(() => null),
      this.noteOwned ? Promise.resolve(null) : this.reads.readSessionNote().catch(() => null),
    ]);
    if (this.generation !== generation) return;
    if (prompts) {
      this.stashedPromptCount = (prompts.prompts ?? []).filter(
        (prompt) =>
          (this.agentSessionId !== null && prompt.agentSessionId === this.agentSessionId) ||
          (this.sessionId !== null && prompt.sessionId === this.sessionId)
      ).length;
    }
    if (note) this.noteText = note.note ?? '';
    this.changed();
  }

  projection(note: NativeComposerChromeNote, summaryMode: boolean, agentSessionId: string | null): NativeComposerChromeProjection {
    if (this.agentSessionId !== agentSessionId) {
      this.agentSessionId = agentSessionId;
    }
    if (note.open) this.noteOwned = true;
    const text = this.noteOwned ? (note.open || note.edited ? note.value : note.saved) : this.noteText;
    return {
      notePresence: text.trim() !== '',
      notePressed: note.open,
      stashBadge: this.stashedPromptCount > 0 ? String(Math.min(this.stashedPromptCount, 9)) : null,
      summaryPressed: summaryMode,
    };
  }
}
