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

export const RECORDING_ROOT = '/tmp/gx-chat';
export const EXPECTED_ROOT = `${RECORDING_ROOT}/expected`;
export const ACTUAL_ROOT = `${RECORDING_ROOT}/actual`;

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

export interface Recording {
  header: ReplayHeader;
  records: ReplayRecord[];
  /** The recording's own name, used for the expected and actual file names. */
  name: string;
}

export class RecordingError extends Error {}

/** Parses a recording. Throws on a format this build predates or a truncated header. */
export function parseRecording(text: string, name: string): Recording {
  const lines = text.split('\n').filter((line) => line.length > 0);
  if (!lines.length) throw new RecordingError('The recording is empty.');
  let header: ReplayHeader;
  try {
    header = JSON.parse(lines[0]!) as ReplayHeader;
  } catch {
    throw new RecordingError('The recording does not start with a header line.');
  }
  if (header.k !== 'header') throw new RecordingError('The recording does not start with a header line.');
  if (header.v !== NATIVE_CHAT_REPLAY_FORMAT)
    throw new RecordingError(
      `The recording is format ${header.v}; this harness reads format ${NATIVE_CHAT_REPLAY_FORMAT}.`
    );
  const records: ReplayRecord[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    let record: ReplayRecord;
    try {
      record = JSON.parse(lines[index]!) as ReplayRecord;
    } catch {
      // A recording ends when the app does, so a half-written final line is normal.
      if (index === lines.length - 1) break;
      throw new RecordingError(`Record ${index} is not valid JSON.`);
    }
    if (record.k !== 'in' && record.k !== 'doc' && record.k !== 'query')
      throw new RecordingError(`Record ${index} has an unknown kind.`);
    records.push(record);
  }
  return { header, records, name };
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

export function serializeHeader(startedAtMs: number): string {
  return JSON.stringify({ v: NATIVE_CHAT_REPLAY_FORMAT, k: 'header', startedAtMs });
}

/**
 * One line of the expected (or actual) document sequence. Keeping the document verbatim makes a
 * plain JSON diff of the two files the whole gate.
 */
export function documentLine(n: number, lastRevision: unknown, hash: string, documentJson: string): string {
  return `{"n":${n},"lastRevision":${JSON.stringify(lastRevision ?? null)},"hash":${JSON.stringify(hash)},"document":${documentJson}}`;
}
