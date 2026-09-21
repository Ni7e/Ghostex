/**
 * The replay seam for the chat brain: one place that sees every input reaching
 * `globalThis.nativeChat` and every document leaving it.
 *
 * CDXC:SessionChat 2026-09-22 WHY:
 * The Rust port of the chat rules (`packages/gx-chat-core`) is graded by replaying recorded
 * inputs through both brains and diffing the produced document. That only works when the
 * recording is complete, so the hooks sit on the host object itself rather than on any
 * individual controller: `start`, `action`, `brokerMessage`, `event`, `resolve` and `tick`
 * are every way state enters, `take` is the only way the document leaves, and the clock,
 * `Math.random` and `crypto.randomUUID` are the only values the rules read from nowhere.
 * Record mode and replay mode share these wrappers on purpose: the order in which the
 * non-deterministic reads are written is by construction the order in which they are handed
 * back, so no separate agreement between recorder and harness can drift.
 *
 * Nothing here runs until a host calls `installNativeChatReplayHooks`. With the diagnostic
 * scenario off the shipped functions are untouched.
 */

/** The four ways a record is shaped in the JSONL recording. */
export type NativeChatReplayKind = 'in' | 'doc' | 'query';

/** What a host must provide to observe or to feed the seam. */
export interface NativeChatReplayDriver {
  /** A call is starting. Every read reported after this belongs to it, until the next `begin`. */
  begin(kind: NativeChatReplayKind, method: string, args: readonly unknown[]): void;
  /** The clock the rules read (`Date.now()` and no-argument `new Date()`). */
  clock(): number;
  random(): number;
  uuid(): string;
  /** A `take` or a pure query answered. `length` is the serialized length, never the text. */
  result(hash: string, length: number): void;
}

/** The inputs wrapped as state changes. `take` and the pure queries are wrapped separately. */
const INPUT_METHODS = ['start', 'action', 'brokerMessage', 'event', 'resolve', 'tick'] as const;

/**
 * The synchronous helpers the renderer asks for a single gesture. They hold no state, but a
 * ported implementation has to answer them identically, so the recording carries their hash.
 */
const QUERY_METHODS = [
  'composerReferences',
  'composerKeyIntent',
  'referenceMenu',
  'transcriptMenu',
  'sendBlockedToast',
] as const;

const FNV_PRIME = 0x01000193;
const FNV_OFFSET_A = 0x811c9dc5;
const FNV_OFFSET_B = 0x0f1bbcd9;

function fnv1a32(text: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    hash = Math.imul(hash ^ (unit & 0xff), FNV_PRIME) >>> 0;
    hash = Math.imul(hash ^ (unit >>> 8), FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

/**
 * The document fingerprint the gate compares. Two 32-bit FNV-1a passes over the UTF-16 code
 * units, low byte then high byte, so a Rust port reproduces it from `str::encode_utf16`
 * without a unicode table or a wide-integer type.
 */
export function nativeChatReplayHash(text: string): string {
  const high = fnv1a32(text, FNV_OFFSET_A).toString(16).padStart(8, '0');
  const low = fnv1a32(text, FNV_OFFSET_B).toString(16).padStart(8, '0');
  return `${high}${low}`;
}

/** The recording file name for a session, so no project or session identity reaches the path. */
export function nativeChatReplayDigest(projectId: string, sessionId: string): string {
  return nativeChatReplayHash(`${projectId}\u0000${sessionId}`);
}

let installed = false;

/**
 * Routes every `nativeChat` entry point, the clock, `Math.random` and `crypto.randomUUID`
 * through `driver`. Idempotent; the first driver wins.
 */
export function installNativeChatReplayHooks(driver: NativeChatReplayDriver): void {
  if (installed) return;
  installed = true;
  const globals = globalThis as Record<string, unknown>;
  const host = globals.nativeChat as Record<string, unknown> | undefined;
  if (!host) throw new Error('The chat host is not ready for replay hooks.');

  for (const method of INPUT_METHODS) {
    const original = host[method];
    if (typeof original !== 'function') continue;
    const shipped = original as (...args: unknown[]) => unknown;
    host[method] = (...args: unknown[]) => {
      driver.begin('in', method, args);
      return shipped.apply(host, args);
    };
  }

  const shippedTake = host.take as ((lastRevision: number) => string) | undefined;
  if (shippedTake) {
    host.take = (lastRevision: number) => {
      driver.begin('doc', 'take', [lastRevision]);
      const document = shippedTake.call(host, lastRevision);
      driver.result(nativeChatReplayHash(document), document.length);
      return document;
    };
  }

  for (const method of QUERY_METHODS) {
    const original = host[method];
    if (typeof original !== 'function') continue;
    const shipped = original as (...args: unknown[]) => unknown;
    host[method] = (...args: unknown[]) => {
      driver.begin('query', method, args);
      const value = shipped.apply(host, args);
      const serialized = JSON.stringify(value ?? null) ?? 'null';
      driver.result(nativeChatReplayHash(serialized), serialized.length);
      return value;
    };
  }

  const ShippedDate = globals.Date as DateConstructor;
  class ReplayDate extends ShippedDate {
    constructor(...args: unknown[]) {
      // Only the "what time is it now" constructor is a non-deterministic read. Every other
      // form parses a value the rules already hold, so it stays exactly as it shipped.
      if (args.length === 0) super(driver.clock());
      else super(...(args as ConstructorParameters<DateConstructor>));
    }

    static override now(): number {
      return driver.clock();
    }
  }
  globals.Date = ReplayDate;

  const shippedRandom = Math.random;
  Math.random = () => driver.random();
  void shippedRandom;

  const cryptoHost = globals.crypto as { randomUUID?: () => string } | undefined;
  if (cryptoHost?.randomUUID) cryptoHost.randomUUID = () => driver.uuid();
}

/**
 * The recording driver the desktop host installs: it writes one JSON line per call to the
 * sink the Rust runtime provides.
 *
 * A record is written when the next one begins, so the reads a call makes in its own
 * continuations (an awaited request resolving, a promise callback) are attributed to the call
 * that caused them. The replay harness drives the brain the same way, one record at a time
 * with the microtask queue drained in between, so the attribution matches. The cost is that
 * the newest record reaches disk only once another input arrives; a recording therefore ends
 * one record short of the moment the app closed.
 */
export function createNativeChatRecordingDriver(append: (line: string) => void): NativeChatReplayDriver {
  // Captured before the hooks replace them, so the recorder's own reads never enter a record.
  const realNow = Date.now.bind(Date);
  const realRandom = Math.random;
  const realUuid = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID;

  type Open = {
    n: number;
    k: NativeChatReplayKind;
    m: string;
    ms: number;
    a: readonly unknown[];
    c: number[];
    r: number[];
    u: string[];
    hash?: string;
    len?: number;
  };
  let open: Open | null = null;
  let sequence = 0;

  const flush = (): void => {
    if (!open) return;
    const record = open;
    open = null;
    const line: Record<string, unknown> = { n: record.n, k: record.k, m: record.m, ms: record.ms, a: record.a };
    if (record.c.length) line.c = record.c;
    if (record.r.length) line.r = record.r;
    if (record.u.length) line.u = record.u;
    if (record.hash !== undefined) {
      line.hash = record.hash;
      line.len = record.len;
    }
    try {
      append(JSON.stringify(line));
    } catch {
      // A recording that cannot be written must never disturb the chat it is observing.
    }
  };

  return {
    begin(kind, method, args) {
      flush();
      sequence += 1;
      open = { n: sequence, k: kind, m: method, ms: realNow(), a: args, c: [], r: [], u: [] };
    },
    clock() {
      const value = realNow();
      open?.c.push(value);
      return value;
    },
    random() {
      const value = realRandom();
      open?.r.push(value);
      return value;
    },
    uuid() {
      const value = realUuid ? realUuid() : '00000000-0000-4000-8000-000000000000';
      open?.u.push(value);
      return value;
    },
    result(hash, length) {
      if (!open) return;
      open.hash = hash;
      open.len = length;
    },
  };
}

/** The header line every recording starts with, so a reader can reject a format it predates. */
export const NATIVE_CHAT_REPLAY_FORMAT = 1;

/**
 * What the desktop host calls once, before `start`, when the `native.chat.replay` diagnostic
 * scenario is on: writes the header and routes the seam into the sink.
 */
export function startNativeChatRecording(append: (line: string) => void): void {
  append(JSON.stringify({ v: NATIVE_CHAT_REPLAY_FORMAT, k: 'header', startedAtMs: Date.now() }));
  installNativeChatReplayHooks(createNativeChatRecordingDriver(append));
}
