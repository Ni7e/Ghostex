/*
CDXC:SessionChat 2026-09-18 SEE-ALSO:
The transcript's per-message actions for GPUI chat: Rewind (the confirmation in front of
`/api/rewindSessionChat`, React's session-chat-rewind-dialog.tsx) and Save prompt (React's
session-chat-save-prompt-button.tsx). The wording, the refusal handling, and the "put the prompt
back in the composer" rule have to match those two files; only the rendering differs.
*/

import type { GxserverRewindSessionChatResult } from '../gxserver-protocol';
import { gxserverRpcErrorCode } from '../gxserver-rpc-error';

const PREVIEW_LINE_LIMIT = 3;

/** The first few lines of the prompt, so the quote stays a glance and not a re-read. */
function promptPreview(prompt: string): string {
  const lines = prompt.replace(/\s+$/u, '').split(/\r?\n/u);
  return lines.slice(0, PREVIEW_LINE_LIMIT).join('\n') + (lines.length > PREVIEW_LINE_LIMIT ? '\n…' : '');
}

export type NativeSavePromptStatus = 'saving' | 'saved' | 'error';

export interface NativeRewindProjection {
  messageId: string;
  preview: string;
  description: string;
  busy: boolean;
  completed: boolean;
  synchronizationPending: boolean;
  error: string | null;
  submitLabel: string;
  cancelLabel: string;
}

export class NativeChatMessageActions {
  private rewind: {
    messageId: string;
    prompt: string;
    agent: string;
    busy: boolean;
    completed: boolean;
    synchronizationPending: boolean;
    error: string | null;
  } | null = null;
  private prompts = new Map<string, NativeSavePromptStatus>();

  constructor(
    private readonly options: {
      rewind: (params: { messageId: string }) => Promise<GxserverRewindSessionChatResult>;
      savePrompt: (content: string) => Promise<unknown>;
      /** Hands the rewound prompt back to the composer so the reader edits it instead of retyping it. */
      restore: (prompt: string) => void;
      changed: () => void;
    }
  ) {}

  open(messageId: string, prompt: string, agent: string | null | undefined): void {
    this.rewind = {
      messageId,
      prompt,
      agent: agent ?? '',
      busy: false,
      completed: false,
      synchronizationPending: false,
      error: null,
    };
    this.options.changed();
  }

  close(): void {
    if (this.rewind === null || this.rewind.busy) {
      return;
    }
    this.rewind = null;
    this.options.changed();
  }

  async submit(): Promise<void> {
    const request = this.rewind;
    if (request === null || request.busy || request.completed) {
      return;
    }
    request.busy = true;
    request.error = null;
    this.options.changed();
    try {
      const result = await this.options.rewind({ messageId: request.messageId });
      if (this.rewind !== request) return;
      // CDXC:SessionChat 2026-09-11 DECISION: User approved Retry synchronization after Codex confirms rewind; preserve the dialog and draft while the server reconnects to that branch.
      if (result.synchronizationPending) {
        request.synchronizationPending = true;
        request.error = result.warning ?? 'The rewind needs synchronization.';
        request.busy = false;
        this.options.changed();
        return;
      }
      request.busy = false;
      this.options.restore(request.prompt);
      if (result.warning) {
        request.error = result.warning;
        request.completed = true;
      } else {
        this.rewind = null;
      }
      this.options.changed();
    } catch (failure) {
      if (this.rewind !== request) return;
      request.busy = false;
      /** CDXC:SessionChat 2026-09-16 DECISION:
       * User: if Rewind finds that the message was never accepted, put its text back in the composer instead of showing an error.
       */
      if (gxserverRpcErrorCode(failure) === 'messageNotFound') {
        this.rewind = null;
        this.options.restore(request.prompt);
        this.options.changed();
        return;
      }
      // The daemon's own sentence names what it verified on the screen and why it stopped.
      request.error = failure instanceof Error ? failure.message : 'The conversation could not be rewound.';
      this.options.changed();
    }
  }

  async save(messageId: string, prompt: string): Promise<void> {
    if (this.prompts.get(messageId) === 'saving' || prompt.trim().length === 0) {
      return;
    }
    this.prompts.set(messageId, 'saving');
    this.options.changed();
    try {
      await this.options.savePrompt(prompt);
      this.prompts.set(messageId, 'saved');
    } catch {
      this.prompts.set(messageId, 'error');
    }
    this.options.changed();
  }

  savedPrompts(): Record<string, NativeSavePromptStatus> {
    return Object.fromEntries(this.prompts);
  }

  projection(): NativeRewindProjection | null {
    const request = this.rewind;
    if (request === null) {
      return null;
    }
    return {
      messageId: request.messageId,
      preview: promptPreview(request.prompt),
      description:
        request.agent === 'codex'
          ? 'Codex continues in a new conversation from this point and puts this message back in the composer for editing.'
          : 'We only rewind using "Restore conversation" in the Chat View currently. Switch to Terminal View and use /rewind to resume using another option.',
      busy: request.busy,
      completed: request.completed,
      synchronizationPending: request.synchronizationPending,
      error: request.error,
      submitLabel: request.synchronizationPending
        ? request.busy
          ? 'Synchronizing'
          : 'Retry synchronization'
        : request.busy
          ? 'Rewinding'
          : 'Rewind',
      cancelLabel: request.completed || request.synchronizationPending ? 'Close' : 'Cancel',
    };
  }
}
