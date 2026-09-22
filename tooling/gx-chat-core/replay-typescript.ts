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
 * A recording holds one RUN per header line: the app starts a fresh QuickJS context every time it
 * creates a chat runtime for the session, so every run is a fresh brain with its own module state,
 * timers and record counter. The shipped brain is a module with module-level state and Bun caches
 * a module for the life of the process, so each run is replayed in a child process of this same
 * script (`--run <index>`), which is the only way to give it the fresh context it had. The parent
 * concatenates the runs' document lines in file order and sums their reports.
 *
 * Nothing is stubbed: `packages/shared/session-chat-controller/` and
 * `packages/shared/session-chat-presentation/` run as they ship, without QuickJS. Only the
 * values the rules read from nowhere (the clock, `Math.random`, `crypto.randomUUID`) come from
 * the recording, which is what makes a run reproducible.
 *
 * The report counts records, documents, and matching fingerprints. It never prints a record's
 * arguments or a document's contents: a recording is the user's conversation.
 */
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

import {
  nativeChatReplayHash,
  type NativeChatReplayDriver,
  type NativeChatReplayKind,
} from '@/packages/shared/session-chat-controller/native-host-replay';
import { loadChatBrain, settle } from './brain';
import { documentLine, EXPECTED_ROOT, parseRecording, type ReplayRecord, type ReplayRun } from './recording';

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
  /** `doc` and `query` records that carry a fingerprint, so the matched counts have a denominator. */
  hashed: number;
  hashedQueries: number;
  documentsMatched: number;
  queriesMatched: number;
  unknownMethods: number;
  threw: number;
  underruns: { clock: number; random: number; uuid: number };
}

function emptyTotals(): Totals {
  return {
    records: 0,
    inputs: 0,
    documents: 0,
    queries: 0,
    hashed: 0,
    hashedQueries: 0,
    documentsMatched: 0,
    queriesMatched: 0,
    unknownMethods: 0,
    threw: 0,
    underruns: { clock: 0, random: 0, uuid: 0 },
  };
}

function addTotals(into: Totals, from: Totals): void {
  into.records += from.records;
  into.inputs += from.inputs;
  into.documents += from.documents;
  into.queries += from.queries;
  into.hashed += from.hashed;
  into.hashedQueries += from.hashedQueries;
  into.documentsMatched += from.documentsMatched;
  into.queriesMatched += from.queriesMatched;
  into.unknownMethods += from.unknownMethods;
  into.threw += from.threw;
  into.underruns.clock += from.underruns.clock;
  into.underruns.random += from.underruns.random;
  into.underruns.uuid += from.underruns.uuid;
}

/** Replays one run into the brain this process loaded, which must be fresh. */
async function replayRun(run: ReplayRun): Promise<{ totals: Totals; lines: string[] }> {
  const world = new RecordedWorld(run.header.startedAtMs);
  const host = await loadChatBrain(world);
  const totals = emptyTotals();
  totals.records = run.records.length;
  const lines: string[] = [];

  for (const record of run.records) {
    if (record.k === 'doc' && record.hash !== undefined) totals.hashed += 1;
    if (record.k === 'query' && record.hash !== undefined) totals.hashedQueries += 1;
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
        lines.push(documentLine(run.index, record.n, record.a[0], hash, document));
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
  totals.underruns = world.underruns;
  return { totals, lines };
}

/** The child's last stdout line, so a stray log from the brain cannot be mistaken for it. */
const TOTALS_PREFIX = '@totals ';

interface Options {
  path: string;
  /** Child mode: replay this one run (1-based index into the kept runs) and write its lines to `out`. */
  run: number | null;
  out: string | null;
}

function parseOptions(argv: readonly string[]): Options {
  const options: Options = { path: '/tmp/gx-chat/synthetic.jsonl', run: null, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    const next = argv[index + 1];
    if (argument === '--run' && next) {
      options.run = Number(next);
      index += 1;
    } else if (argument === '--out' && next) {
      options.out = next;
      index += 1;
    } else if (!argument.startsWith('--')) {
      options.path = argument;
    }
  }
  return options;
}

/** Child mode: one run, one fresh brain, lines to `out`, totals on the last stdout line. */
async function child(options: Options): Promise<number> {
  const name = basename(options.path).replace(/\.jsonl$/, '');
  const recording = parseRecording(readFileSync(options.path, 'utf8'), name);
  const run = recording.runs[(options.run ?? 1) - 1];
  if (!run) {
    console.log(`${TOTALS_PREFIX}${JSON.stringify(emptyTotals())}`);
    return 1;
  }
  const { totals, lines } = await replayRun(run);
  if (options.out) writeFileSync(options.out, lines.length ? `${lines.join('\n')}\n` : '', { mode: 0o600 });
  console.log(`${TOTALS_PREFIX}${JSON.stringify(totals)}`);
  return 0;
}

async function main(): Promise<number> {
  const options = parseOptions(process.argv.slice(2));
  if (options.run !== null) return child(options);

  const name = basename(options.path).replace(/\.jsonl$/, '');
  const recording = parseRecording(readFileSync(options.path, 'utf8'), name);
  mkdirSync(EXPECTED_ROOT, { recursive: true, mode: 0o700 });
  const output = `${EXPECTED_ROOT}/${name}.jsonl`;
  writeFileSync(output, '', { mode: 0o600 });

  const totals = emptyTotals();
  let failedRuns = 0;
  for (const run of recording.runs) {
    const part = `${EXPECTED_ROOT}/${name}.run${run.index}.part`;
    const result = Bun.spawnSync(
      [process.execPath, import.meta.path, options.path, '--run', String(recording.runs.indexOf(run) + 1), '--out', part],
      { stdout: 'pipe', stderr: 'inherit' }
    );
    const stdout = result.stdout.toString();
    const reported = stdout
      .split('\n')
      .filter((line) => line.startsWith(TOTALS_PREFIX))
      .pop();
    if (!reported || result.exitCode !== 0) {
      failedRuns += 1;
      console.log(`run ${run.index}       did not finish (exit ${result.exitCode})`);
    } else {
      addTotals(totals, JSON.parse(reported.slice(TOTALS_PREFIX.length)) as Totals);
    }
    try {
      writeFileSync(output, readFileSync(part), { flag: 'a' });
      unlinkSync(part);
    } catch {
      // A run that wrote nothing has no part file, which is what the report already says.
    }
  }

  console.log(
    `recording       ${name} (format ${recording.header.v}, ${recording.runs.length} runs, ${totals.records} records${
      recording.emptyRuns ? `, ${recording.emptyRuns} empty runs skipped` : ''
    })`
  );
  console.log(`replayed        ${totals.inputs} inputs, ${totals.queries} queries, ${totals.documents} documents`);
  console.log(`documents       ${totals.documentsMatched}/${totals.hashed} fingerprints matched the live run`);
  console.log(`queries         ${totals.queriesMatched}/${totals.hashedQueries} fingerprints matched the live run`);
  console.log(
    `unrecorded      ${totals.underruns.clock} clock, ${totals.underruns.random} random, ${totals.underruns.uuid} id reads`
  );
  console.log(`refused         ${totals.threw} inputs, ${totals.unknownMethods} unknown methods`);
  console.log(`expected        ${output}`);

  const clean =
    failedRuns === 0 &&
    totals.threw === 0 &&
    totals.unknownMethods === 0 &&
    totals.underruns.clock === 0 &&
    totals.underruns.random === 0 &&
    totals.underruns.uuid === 0 &&
    totals.documentsMatched === totals.hashed &&
    totals.queriesMatched === totals.hashedQueries;
  return clean ? 0 : 1;
}

process.exitCode = await main();
