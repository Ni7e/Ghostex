import type { GxserverReadSessionTerminalTailResult } from '../gxserver-protocol';
import { formatSessionTerminalTailPreview } from '../session-chat-presentation/terminal-tail';

type Tail = GxserverReadSessionTerminalTailResult;

/**
 * The session's terminal screen, read only when the user asks for it: hovering
 * the Terminal View button, or expanding the `composerNotReady` refusal card.
 * Both readers are the React ones (use-session-terminal-tail.ts and
 * session-chat-composer-not-ready.tsx), with their two rules kept:
 * `unknown` is not "not ready", and a failed hover read keeps the last verdict.
 */
export class NativeTerminalTail {
  private hoverRequest = 0;
  private noticeRequest = 0;
  private tail: Tail | null = null;
  private noticeOpen = false;
  private noticeLoading = false;
  private noticeError: string | null = null;
  private noticeTail: Tail | null = null;

  constructor(
    private readonly read: () => Promise<Tail>,
    private readonly republish: () => void
  ) {}

  /** Returns false when the command is not one of this reader's. */
  command(command: { type: string }): boolean {
    if (command.type === 'terminalTailHover') {
      this.refresh();
      return true;
    }
    if (command.type === 'terminalTailToggle') {
      this.toggle();
      return true;
    }
    return false;
  }

  /** The refusal is gone, so the expanded excerpt under it goes with it. */
  retire(): void {
    if (!this.noticeOpen && this.noticeTail === null && this.noticeError === null) return;
    this.noticeOpen = false;
    this.noticeTail = null;
    this.noticeError = null;
    this.noticeLoading = false;
  }

  project() {
    const readiness = this.tail?.captured && this.tail.composerState !== 'unknown' ? this.tail.composerState : null;
    return {
      /*
      Only a MEASURED verdict tints the button: `unknown`, an uncaptured screen
      and the time before the first hover all stay neutral, because the daemon
      fails open on `unknown` and a red button there would accuse a session that
      sends fine.
      */
      readiness,
      preview: this.tail?.captured === true ? formatSessionTerminalTailPreview(this.tail.lines) : '',
      reason: readiness === 'notReady' ? (this.tail?.reason ?? null) : null,
      notice: {
        open: this.noticeOpen,
        loading: this.noticeLoading,
        error: this.noticeError,
        excerpt: excerptOf(this.noticeTail),
        empty: this.noticeOpen && !this.noticeLoading && this.noticeError === null ? emptyCopy(this.noticeTail) : null,
      },
    };
  }

  private refresh(): void {
    const request = ++this.hoverRequest;
    void this.read()
      .then((result) => {
        if (this.hoverRequest !== request) return;
        this.tail = result;
        this.republish();
      })
      .catch(() => {
        // Keep the last verdict; a failed read is "unknown", never "not ready".
      });
  }

  private toggle(): void {
    if (this.noticeOpen) {
      this.noticeOpen = false;
      return;
    }
    // Re-read on every expand: the whole point is the CURRENT screen, and by the
    // time a user re-opens it they have usually just tried something.
    this.noticeOpen = true;
    this.noticeLoading = true;
    this.noticeError = null;
    const request = ++this.noticeRequest;
    void this.read()
      .then((result) => {
        if (this.noticeRequest !== request) return;
        this.noticeTail = result;
      })
      .catch((error: unknown) => {
        if (this.noticeRequest !== request) return;
        this.noticeTail = null;
        this.noticeError = error instanceof Error ? error.message : 'The terminal screen could not be read.';
      })
      .finally(() => {
        if (this.noticeRequest !== request) return;
        this.noticeLoading = false;
        this.republish();
      });
  }
}

function excerptOf(tail: Tail | null): string {
  return !tail || !tail.captured || tail.lines.length === 0 ? '' : tail.lines.join('\n');
}

function emptyCopy(tail: Tail | null): string | null {
  if (excerptOf(tail) !== '') return null;
  return tail && !tail.captured
    ? 'Ghostex could not read this session’s terminal screen.'
    : 'The terminal screen is empty.';
}
