import type { SessionChatMessage } from '../session-chat';
import { pendingSessionChatAsyncQuestions } from '../session-chat-presentation/async-questions';
import type { AnswerDrafts } from './question-drafts';

export interface AsyncQuestionPersistence {
  read(): Promise<{ drafts: AnswerDrafts; retired: string[] }>;
  write(drafts: AnswerDrafts): Promise<void>;
  retire(key: string, submitted: AnswerDrafts): Promise<void>;
}

/** CDXC:SessionChat 2026-09-17 SEE-ALSO: React and QuickJS share async question selection, explicit submission, retirement and draft persistence through this controller. */
export class SessionChatAsyncQuestionsController {
  private drafts: AnswerDrafts = {};
  private messages: readonly SessionChatMessage[] | undefined;
  private pending: ReturnType<typeof pendingSessionChatAsyncQuestions> = [];
  private retired = new Set<string>();
  private activeKey: string | null = null;
  private collapsed = false;
  private submitting = false;
  private loading = true;
  private savingImages = false;
  private error: string | null = null;
  private saveError = '';
  private listeners = new Set<() => void>();
  private revision = 0;
  private writes: Promise<void> = Promise.resolve();
  private loadTask?: Promise<void>;
  constructor(private readonly persistence: AsyncQuestionPersistence) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  version = (): number => this.revision;
  private changed(): void {
    this.revision++;
    for (const listener of this.listeners) listener();
  }
  load(): Promise<void> {
    return (this.loadTask ??= this.persistence
      .read()
      .then(({ drafts, retired }) => {
        this.drafts = drafts;
        this.retired = new Set(retired);
      })
      .catch(() => {
        this.saveError = 'Your saved answers could not be restored. Keep this view open until saving succeeds.';
      })
      .finally(() => {
        this.loading = false;
        this.changed();
      }));
  }
  project(
    messages: readonly SessionChatMessage[],
    canSend: boolean,
    working: boolean,
    retiredIds: readonly string[] = []
  ) {
    if (this.messages !== messages) {
      this.messages = messages;
      this.pending = pendingSessionChatAsyncQuestions(messages);
    }
    // CDXC:SessionChat 2026-09-18 WHY:
    // Codex can accept an answer into its own queue before writing the user transcript. Server retirement must reach React and native chat, including another client or a remounted card.
    const pending = this.pending.filter(
      (question) => !this.retired.has(question.key) && !retiredIds.includes(question.key)
    );
    const index = Math.max(
      0,
      pending.findIndex((question) => question.key === this.activeKey)
    );
    const question = pending[index];
    const draft = question ? (this.drafts[question.key] ?? { indices: [0], other: '' }) : { indices: [], other: '' };
    const answer = draft.other.trim() || question?.options?.[draft.indices[0] ?? 0] || '';
    const disabled = !canSend || this.submitting || this.savingImages || this.loading;
    return {
      question,
      draft,
      index,
      count: pending.length,
      answer,
      disabled,
      canSend,
      working,
      collapsed: this.collapsed,
      submitting: this.submitting,
      loading: this.loading,
      error: this.error || this.saveError,
      previousDisabled: this.submitting || this.savingImages || this.loading || index === 0,
      nextDisabled: this.submitting || this.savingImages || this.loading || index === pending.length - 1,
      selected: draft.other.trim() ? [] : draft.indices,
      previousKey: pending[index - 1]?.key,
      nextKey: pending[index + 1]?.key,
    };
  }
  toggle(): void {
    this.collapsed = !this.collapsed;
    this.changed();
  }
  navigate(key: string | undefined): void {
    if (!key || this.submitting || this.savingImages || this.loading) return;
    this.activeKey = key;
    this.error = null;
    this.changed();
  }
  imagesPending(value: boolean): void {
    this.savingImages = value;
    this.changed();
  }
  edit(key: string, update: (text: string) => string): void {
    if (this.submitting || this.loading) return;
    const draft = this.drafts[key] ?? { indices: [], other: '' };
    this.save({ ...this.drafts, [key]: { ...draft, other: update(draft.other) } });
  }
  select(key: string, index: number): void {
    if (this.submitting || this.savingImages || this.loading) return;
    this.save({ ...this.drafts, [key]: { indices: [index], other: '' } });
  }
  private save(drafts: AnswerDrafts): void {
    this.drafts = drafts;
    this.changed();
    this.writes = this.writes
      .then(() => this.persistence.write(drafts))
      .then(() => {
        this.saveError = '';
        this.changed();
      })
      .catch(() => {
        this.saveError = 'Your answer could not be saved on this computer. Keep this view open until saving succeeds.';
        this.changed();
      });
  }
  async submit(
    messages: readonly SessionChatMessage[],
    canSend: boolean,
    skip: boolean,
    deliver: (key: string, answer: string, skip: boolean) => Promise<void>,
    retiredIds: readonly string[] = []
  ): Promise<void> {
    const state = this.project(messages, canSend, false, retiredIds);
    if (!state.question || state.disabled || (!skip && !state.answer.trim())) return;
    const key = state.question.key;
    const submitted = this.drafts[key] ? { [key]: this.drafts[key]! } : {};
    this.submitting = true;
    this.error = null;
    this.changed();
    try {
      await deliver(key, state.answer.trim(), skip);
      this.retired.add(key);
      const { [key]: _submittedDraft, ...remaining } = this.drafts;
      this.drafts = remaining;
      // Delivery already succeeded. A storage failure must not offer to send it twice.
      await this.writes;
      try {
        await this.persistence.retire(key, submitted);
      } catch {
        /* Retain retirement in this controller. */
      }
    } catch (reason) {
      this.error =
        reason instanceof Error
          ? reason.message
          : skip
            ? 'Could not skip this question. Please try again.'
            : 'Could not send your answer. Please try again.';
    } finally {
      this.submitting = false;
      this.changed();
    }
  }
}
