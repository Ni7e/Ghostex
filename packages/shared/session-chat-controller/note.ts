export interface SessionNoteWriteState { saved: string }

/** Blur, close, and view disposal can flush the same edit; acknowledge each body once. */
export async function flushSessionNote(state: SessionNoteWriteState, value: string, save: (note: string) => Promise<void>): Promise<void> {
  const previous = state.saved;
  const next = value.trim();
  if (next === previous) return;
  state.saved = next;
  try { await save(next); }
  catch (error) {
    if (state.saved === next) state.saved = previous;
    throw error;
  }
}
