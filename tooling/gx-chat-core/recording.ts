/**
 * The recording file the chat replay gate reads and writes.
 *
 * One JSONL file per session under `/tmp/gx-chat/`: a header line, then one line per call that
 * reached the chat brain, in the order the brain saw them. The format is produced by
 * `packages/shared/session-chat-controller/native-host-replay.ts`; this module only parses it,
 * so the two stay one definition apart.
 *
 * Recordings hold the conversation itself. Nothing here prints a record's arguments, and the
 * gate reports differences by JSON pointer and count, never by value.
 */
import { NATIVE_CHAT_REPLAY_FORMAT } from '@/packages/shared/session-chat-controller/native-host-replay';

/**
 * `GX_CHAT_ROOT` moves the whole gate (recordings, expected, actual, reports) to a private directory,
 * so an agent grading a snapshot of a live recording is not rewritten by another agent's gate run.
 * `GX_CHAT_ACTUAL_DIR` moves only the Rust side's output, as `examples/replay.rs` reads it.
 */
export const RECORDING_ROOT = process.env.GX_CHAT_ROOT || '/tmp/gx-chat';
export const EXPECTED_ROOT = `${RECORDING_ROOT}/expected`;
export const ACTUAL_ROOT = process.env.GX_CHAT_ACTUAL_DIR || `${RECORDING_ROOT}/actual`;

export interface ReplayHeader {
  v: number;
  k: 'header';
  startedAtMs: number;
}

export interface ReplayRecord {
  /** 1-based position in the recording. */
  n: number;
  /** `in` changes state, `doc` is a published document, `query` is a pure helper. */
  k: 'in' | 'doc' | 'query';
  /** The `nativeChat` method that was called. */
  m: string;
  /** `Date.now()` as the recorder read it immediately before the call. */
  ms: number;
  /** The call's arguments, as they crossed the boundary. */
  a: unknown[];
  /** Clock values the brain read during this call, in order. */
  c?: number[];
  /** `Math.random()` values the brain read during this call, in order. */
  r?: number[];
  /** `crypto.randomUUID()` values the brain read during this call, in order. */
  u?: string[];
  /** Fingerprint of the document or query answer this call produced. */
  hash?: string;
  /** Serialized length of that answer. The answer itself is never recorded. */
  len?: number;
}

/**
 * One run of the brain: a header and the records that followed it until the next header.
 *
 * The app writes a header each time it starts a chat runtime for the session, and a runtime is a
 * fresh QuickJS context: module state, timers and the record counter (`n` restarts at 1) all begin
 * again. A recording of a session whose chat was reopened therefore holds several runs, and each
 * one must be replayed into a fresh brain, on both sides.
 */
export interface ReplayRun {
  /** 1-based position of the run in the file, which the output lines carry as `run`. */
  index: number;
  header: ReplayHeader;
  records: ReplayRecord[];
}

export interface Recording {
  /** The first run's header. */
  header: ReplayHeader;
  /** Every record of every run, in file order, for a reader that does not care about runs. */
  records: ReplayRecord[];
  /** The runs that hold at least one record. */
  runs: ReplayRun[];
  /** Headers with no record after them: the app was closed before the brain saw a call. */
  emptyRuns: number;
  /** The recording's own name, used for the expected and actual file names. */
  name: string;
}

export class RecordingError extends Error {}

/**
 * Parses a recording. Throws on a format this build predates or a missing first header.
 *
 * A half-written final line is skipped: a record reaches disk only when the next call begins, so
 * a recording ends one record short and its last line may be cut mid-way by the app closing. A
 * header with nothing after it (the app closed right after the runtime started) is counted, not
 * replayed.
 */
export function parseRecording(text: string, name: string): Recording {
  const lines = text.split('\n').filter((line) => line.length > 0);
  if (!lines.length) throw new RecordingError('The recording is empty.');
  const runs: ReplayRun[] = [];
  let current: ReplayRun | null = null;
  let emptyRuns = 0;
  const openRun = (header: ReplayHeader): void => {
    if (header.v !== NATIVE_CHAT_REPLAY_FORMAT)
      throw new RecordingError(
        `The recording is format ${header.v}; this harness reads format ${NATIVE_CHAT_REPLAY_FORMAT}.`
      );
    if (current && current.records.length === 0) emptyRuns += 1;
    current = { index: runs.length + emptyRuns + 1, header, records: [] };
    runs.push(current);
  };
  for (let index = 0; index < lines.length; index += 1) {
    let parsed: ReplayHeader | ReplayRecord;
    try {
      parsed = JSON.parse(lines[index]!) as ReplayHeader | ReplayRecord;
    } catch {
      if (index === 0) throw new RecordingError('The recording does not start with a header line.');
      if (index === lines.length - 1) break;
      throw new RecordingError(`Record ${index} is not valid JSON.`);
    }
    if (parsed.k === 'header') {
      openRun(parsed);
      continue;
    }
    if (!current) throw new RecordingError('The recording does not start with a header line.');
    const record = parsed;
    if (record.k !== 'in' && record.k !== 'doc' && record.k !== 'query')
      throw new RecordingError(`Record ${index} has an unknown kind.`);
    current.records.push(record);
  }
  if (!current) throw new RecordingError('The recording does not start with a header line.');
  const kept = runs.filter((run) => run.records.length > 0);
  emptyRuns = runs.length - kept.length;
  return {
    header: runs[0]!.header,
    records: kept.flatMap((run) => run.records),
    runs: kept,
    emptyRuns,
    name,
  };
}

/** Serializes one record the way the recorder writes it, so a generator and the app agree. */
export function serializeRecord(record: ReplayRecord): string {
  const line: Record<string, unknown> = { n: record.n, k: record.k, m: record.m, ms: record.ms, a: record.a };
  if (record.c?.length) line.c = record.c;
  if (record.r?.length) line.r = record.r;
  if (record.u?.length) line.u = record.u;
  if (record.hash !== undefined) {
    line.hash = record.hash;
    line.len = record.len;
  }
  return JSON.stringify(line);
}

/**
 * What a `composer(...)` operation answers in a recording.
 *
 * `ChatPreviewBackend` is the Chat Lab's double and answers a bare `true` for `summary` and
 * `verbose`, where the desktop host answers the flag it wrote (`native-composer.ts`:
 * `writeStoredSessionChatSummary(sessionKey, request.enabled === true); return request.enabled
 * === true`). `native-host.ts` assigns that answer straight to its own module variable
 * (`summaryMode = await composer('summary', …)`), so grading against the stub grades the double:
 * a SECOND `toggleSummary` comes back ON and the mode never turns off. Every generator answers
 * those two here instead, so the recordings hold what the product does.
 */
export async function composerAnswer(
  backend: { composer(operation: string, params: Record<string, unknown>): Promise<unknown> },
  operation: string,
  params: Record<string, unknown>
): Promise<unknown> {
  if (operation === 'summary' || operation === 'verbose') return params.enabled === true;
  return backend.composer(operation, params);
}

export function serializeHeader(startedAtMs: number): string {
  return JSON.stringify({ v: NATIVE_CHAT_REPLAY_FORMAT, k: 'header', startedAtMs });
}

/**
 * One line of the expected (or actual) document sequence. Keeping the document verbatim makes a
 * plain JSON diff of the two files the whole gate. `run` is the 1-based run the document belongs
 * to and `n` the record number inside that run, which restarts at 1 with every header.
 */
export function documentLine(
  run: number,
  n: number,
  lastRevision: unknown,
  hash: string,
  documentJson: string
): string {
  return `{"run":${run},"n":${n},"lastRevision":${JSON.stringify(lastRevision ?? null)},"hash":${JSON.stringify(hash)},"document":${documentJson}}`;
}
