/**
 * The TypeScript half of the chat replay gate.
 *
 * Usage: `bun tooling/gx-chat-core/replay-typescript.ts [recording.jsonl]`
 * (default `/tmp/gx-chat/synthetic.jsonl`).
 *
 * Feeds a recording's inputs back into the shipped chat rules, in order, and writes the
 * documents they produce to `/tmp/gx-chat/expected/<name>.jsonl`. The Rust core writes the same
 * sequence to `/tmp/gx-chat/actual/<name>.jsonl`, and a plain JSON diff of the two files is the
 * whole gate.
 *
 * Nothing is stubbed: `packages/shared/session-chat-controller/` and
 * `packages/shared/session-chat-presentation/` run as they ship, without QuickJS. Only the
 * values the rules read from nowhere (the clock, `Math.random`, `crypto.randomUUID`) come from
 * the recording, which is what makes a run reproducible.
 *
 * The report counts records, documents, and matching fingerprints. It never prints a record's
 * arguments or a document's contents: a recording is the user's conversation.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

import {
  nativeChatReplayHash,
  type NativeChatReplayDriver,
  type NativeChatReplayKind,
} from '@/packages/shared/session-chat-controller/native-host-replay';
import { loadChatBrain, settle } from './brain';
import { documentLine, EXPECTED_ROOT, parseRecording, type ReplayRecord } from './recording';

/**
 * Hands the recorded non-deterministic reads back in the order they were taken. The hooks that
 * ask for them are the same ones that recorded them, so the two orders cannot drift.
 */
class RecordedWorld implements NativeChatReplayDriver {
  /** The record the harness is about to feed; the hooks adopt it when the call starts. */
  pending: ReplayRecord | null = null;
  private current: ReplayRecord | null = null;
  private clockAt = 0;
  private randomAt = 0;
  private uuidAt = 0;
  /** Reads the recording could not answer, which means the replay diverged from the live run. */
  underruns = { clock: 0, random: 0, uuid: 0 };
  /** The fingerprint the last `take` or query produced. */
  observed: { hash: string; length: number } | null = null;

  constructor(private readonly baseMs: number) {}

  begin(_kind: NativeChatReplayKind, _method: string, _args: readonly unknown[]): void {
    this.current = this.pending;
    this.pending = null;
    this.clockAt = 0;
    this.randomAt = 0;
    this.uuidAt = 0;
    this.observed = null;
  }

  clock(): number {
    const values = this.current?.c;
    if (values && this.clockAt < values.length) return values[this.clockAt++]!;
    this.underruns.clock += 1;
    return this.current?.ms ?? this.baseMs;
  }

  random(): number {
    const values = this.current?.r;
    if (values && this.randomAt < values.length) return values[this.randomAt++]!;
    this.underruns.random += 1;
    return 0;
  }

  uuid(): string {
    const values = this.current?.u;
    if (values && this.uuidAt < values.length) return values[this.uuidAt++]!;
    this.underruns.uuid += 1;
    return '00000000-0000-4000-8000-000000000000';
  }

  result(hash: string, length: number): void {
    this.observed = { hash, length };
  }
}

interface Totals {
  records: number;
  inputs: number;
  documents: number;
  queries: number;
  documentsMatched: number;
  queriesMatched: number;
  unknownMethods: number;
  threw: number;
}

async function main(): Promise<number> {
  const path = process.argv[2] ?? '/tmp/gx-chat/synthetic.jsonl';
  const name = basename(path).replace(/\.jsonl$/, '');
  const recording = parseRecording(readFileSync(path, 'utf8'), name);

  const world = new RecordedWorld(recording.header.startedAtMs);
  const host = await loadChatBrain(world);

  const totals: Totals = {
    records: recording.records.length,
    inputs: 0,
    documents: 0,
    queries: 0,
    documentsMatched: 0,
    queriesMatched: 0,
    unknownMethods: 0,
    threw: 0,
  };
  const lines: string[] = [];

  for (const record of recording.records) {
    const method = host[record.m];
    if (typeof method !== 'function') {
      totals.unknownMethods += 1;
      continue;
    }
    world.pending = record;
    try {
      if (record.k === 'doc') {
        const document = (method as (lastRevision: unknown) => string).call(host, record.a[0]);
        totals.documents += 1;
        const hash = nativeChatReplayHash(document);
        if (record.hash !== undefined && record.hash === hash) totals.documentsMatched += 1;
        lines.push(documentLine(record.n, record.a[0], hash, document));
      } else {
        (method as (...args: unknown[]) => unknown).apply(host, record.a);
        if (record.k === 'query') {
          totals.queries += 1;
          if (record.hash !== undefined && world.observed?.hash === record.hash) totals.queriesMatched += 1;
        } else {
          totals.inputs += 1;
        }
      }
    } catch {
      // A recorded input the rules refuse is itself a finding; the run continues so the report
      // covers the whole recording rather than stopping at the first divergence.
      totals.threw += 1;
      world.pending = null;
    }
    await settle();
  }

  mkdirSync(EXPECTED_ROOT, { recursive: true, mode: 0o700 });
  const output = `${EXPECTED_ROOT}/${name}.jsonl`;
  writeFileSync(output, lines.length ? `${lines.join('\n')}\n` : '', { mode: 0o600 });

  const hashed = recording.records.filter((record) => record.k === 'doc' && record.hash !== undefined).length;
  const hashedQueries = recording.records.filter((record) => record.k === 'query' && record.hash !== undefined).length;
  console.log(`recording       ${name} (format ${recording.header.v}, ${totals.records} records)`);
  console.log(`replayed        ${totals.inputs} inputs, ${totals.queries} queries, ${totals.documents} documents`);
  console.log(`documents       ${totals.documentsMatched}/${hashed} fingerprints matched the live run`);
  console.log(`queries         ${totals.queriesMatched}/${hashedQueries} fingerprints matched the live run`);
  console.log(
    `unrecorded      ${world.underruns.clock} clock, ${world.underruns.random} random, ${world.underruns.uuid} id reads`
  );
  console.log(`refused         ${totals.threw} inputs, ${totals.unknownMethods} unknown methods`);
  console.log(`expected        ${output}`);

  const clean =
    totals.threw === 0 &&
    totals.unknownMethods === 0 &&
    world.underruns.clock === 0 &&
    world.underruns.random === 0 &&
    world.underruns.uuid === 0 &&
    totals.documentsMatched === hashed &&
    totals.queriesMatched === hashedQueries;
  return clean ? 0 : 1;
}

process.exitCode = await main();
