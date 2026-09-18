import { emitKeypressEvents, type Key } from 'node:readline';
import { PassThrough } from 'node:stream';

export const enableMouse = '\x1b[?1000h\x1b[?1006h';
export const disableMouse = '\x1b[?1000l\x1b[?1006l';
export type MouseInput = { button: number; x: number; y: number; release: boolean };

/** CDXC:Terminal 2026-09-17 DECISION:
 * User: mouse interaction must work in ghostex-debug.
 * Decode mouse reports before readline so their coordinates cannot become search text or keyboard shortcuts.
 */
export class TerminalInput {
  private keyboard = new PassThrough();
  private pending: Buffer = Buffer.alloc(0);
  private timer?: ReturnType<typeof setTimeout>;
  private active = false;
  constructor(
    onKey: (text: string, key: Key) => void,
    private onMouse: (event: MouseInput) => void
  ) {
    emitKeypressEvents(this.keyboard);
    this.keyboard.on('keypress', onKey);
  }
  start() {
    this.active = true;
    process.stdin.on('data', this.onData);
  }
  stop() {
    this.active = false;
    process.stdin.off('data', this.onData);
    if (this.timer) clearTimeout(this.timer);
    this.pending = Buffer.alloc(0);
  }
  private waitForEscape() {
    this.timer = setTimeout(() => {
      const pending = this.pending;
      this.pending = Buffer.alloc(0);
      if (this.active) this.keyboard.write(pending);
    }, 40);
  }
  private onData = (chunk: Buffer | string) => {
    if (!this.active) return;
    if (this.timer) clearTimeout(this.timer);
    this.pending = Buffer.concat([this.pending, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    while (this.active && this.pending.length) {
      const escape = this.pending.indexOf(27);
      if (escape !== 0) {
        const count = escape < 0 ? this.pending.length : escape;
        const text = this.pending.subarray(0, count);
        this.pending = this.pending.subarray(count);
        this.keyboard.write(text);
        continue;
      }
      if (this.pending.length === 1 || (this.pending.length === 2 && this.pending[1] === 91)) {
        this.waitForEscape();
        return;
      }
      const prefix = this.pending.subarray(0, 3).toString();
      if (prefix === '\x1b[<') {
        const text = this.pending.toString();
        const report = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/.exec(text);
        if (report) {
          this.pending = this.pending.subarray(report[0].length);
          this.onMouse({
            button: Number(report[1]),
            x: Number(report[2]),
            y: Number(report[3]),
            release: report[4] === 'm',
          });
          continue;
        }
        if (this.pending.length < 64 && /^\x1b\[<[\d;]*$/.test(text)) {
          // Once identified, a mouse report must survive delayed reads without leaking its suffix as keys.
          return;
        }
        // Consume malformed mouse input through its terminator, keeping following keys separate.
        const end = text.slice(3).search(/[^\d;]/);
        this.pending = this.pending.subarray(end < 0 ? this.pending.length : end + 4);
        continue;
      }
      if (prefix === '\x1b[M') {
        if (this.pending.length < 6) {
          return;
        }
        const button = this.pending[3]! - 32;
        const event = {
          button,
          x: this.pending[4]! - 32,
          y: this.pending[5]! - 32,
          release: (button & 3) === 3,
        };
        this.pending = this.pending.subarray(6);
        this.onMouse(event);
        continue;
      }
      this.pending = this.pending.subarray(1);
      this.keyboard.write('\x1b');
    }
  };
}
