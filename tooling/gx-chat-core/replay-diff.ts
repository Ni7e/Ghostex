/*
 * Compares the TypeScript brain's document sequence with the Rust core's.
 *
 *   bun tooling/gx-chat-core/replay-diff.ts [name]
 *   bun tooling/gx-chat-core/replay-diff.ts --keys view,status,working
 *   bun tooling/gx-chat-core/replay-diff.ts --expected a.jsonl --actual b.jsonl
 *
 * Reads /tmp/gx-chat/expected/<name>.jsonl and /tmp/gx-chat/actual/<name>.jsonl, which
 * docs/2026-09-21/rust-chat/REPLAY.md defines, and reports counts and JSON pointers only. The
 * recordings are the user's conversation: no value from either side is ever printed, and nothing
 * here writes outside /tmp.
 *
 * `--keys` restricts the comparison to a list of top-level document keys, so one port family can
 * gate on its own keys while the others are still empty. A key is matched inside `snapshot` as
 * well as at the top level of the take payload, because that is where the document's own keys
 * live.
 *
 * `--records` prints one line per differing record: the record number the recording gave it, which
 * side published a snapshot, and the pointers that differ there. It is how a publish-timing gap is
 * told apart from a content gap: `expected-only` and `actual-only` are the reactive-versus-
 * imperative publish difference, `both` is a real disagreement about a value.
 *
 * `--ignore` drops whole pointer prefixes from the comparison. `tooling/gx-chat-core/run-gates.sh`
 * passes `/requests`, which is the QuickJS bridge's wire form and not part of the Rust core's
 * contract at all: client storage rides on it there (`composer('read')`, `composer('summary')`)
 * and is an `Effect` here, and its ids come off a counter the TypeScript shares with its timers.
 * The Rust host consumes `Vec<Effect>` and builds no `requests` array.
 *
 * `--summary` prints, after the usual report, one machine-readable line with the four numbers the
 * gate wants from ONE pass over the files: `summary matched=a/b strict=c/b wake=d/b revision=e/b`.
 * `matched` honours `--ignore`, `strict` ignores nothing, and `wake` and `revision` count the
 * lines on which `/nextWakeMs` and `/revision` agree. A real recording's expected file runs to
 * hundreds of megabytes, so reading it four times to get four numbers is what this replaces.
 */

import { readFileSync } from 'node:fs';

interface Options {
  expected: string;
  actual: string;
  keys: string[] | null;
  /** Pointer prefixes dropped from the comparison, with the reason printed in the report. */
  ignore: string[];
  limit: number;
  /** Print one line per differing record: its `n`, and which side published a document. */
  records: boolean;
  /** Print the four gate numbers from one pass (see the file comment). */
  summary: boolean;
}

function parseOptions(argv: readonly string[]): Options {
  let name = 'synthetic';
  let expected = '';
  let actual = '';
  let keys: string[] | null = null;
  const ignore: string[] = [];
  let limit = 40;
  let records = false;
  let summary = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = argv[index + 1];
    if (argument === '--keys' && next) {
      keys = next
        .split(',')
        .map((key) => key.trim())
        .filter(Boolean);
      index += 1;
    } else if (argument === '--ignore' && next) {
      ignore.push(
        ...next
          .split(',')
          .map((pointer) => pointer.trim())
          .filter(Boolean)
      );
      index += 1;
    } else if (argument === '--expected' && next) {
      expected = next;
      index += 1;
    } else if (argument === '--actual' && next) {
      actual = next;
      index += 1;
    } else if (argument === '--limit' && next) {
      limit = Number(next) || limit;
      index += 1;
    } else if (argument === '--records') {
      records = true;
    } else if (argument === '--summary') {
      summary = true;
    } else if (argument && !argument.startsWith('--')) {
      name = argument;
    }
  }
  return {
    actual: actual || `/tmp/gx-chat/actual/${name}.jsonl`,
    expected: expected || `/tmp/gx-chat/expected/${name}.jsonl`,
    keys,
    ignore,
    limit,
    records,
    summary,
  };
}

function readLines(path: string): unknown[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return null;
      }
    })
    .filter((value): value is unknown => value !== null);
}

/** The document half of one recorded line, restricted to the keys under comparison. */
function documentOf(line: unknown, keys: string[] | null): unknown {
  const record = line as { document?: unknown };
  const document = record.document ?? line;
  if (!keys || typeof document !== 'object' || document === null) {
    return document;
  }
  const source = document as Record<string, unknown>;
  const snapshot = (source.snapshot ?? null) as Record<string, unknown> | null;
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    if (Object.hasOwn(source, key)) {
      picked[key] = source[key];
    } else if (snapshot && Object.hasOwn(snapshot, key)) {
      picked[`snapshot/${key}`] = snapshot[key];
    }
  }
  return picked;
}

function pointerEscape(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

/** Collects the JSON pointers at which two values differ. Values are never recorded. */
function collectPointers(left: unknown, right: unknown, at: string, into: string[]): void {
  if (Object.is(left, right)) {
    return;
  }
  const bothObjects = typeof left === 'object' && left !== null && typeof right === 'object' && right !== null;
  if (!bothObjects) {
    if (left !== right) {
      into.push(at || '/');
    }
    return;
  }
  if (Array.isArray(left) !== Array.isArray(right)) {
    into.push(at || '/');
    return;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      into.push(`${at}/length`);
    }
    const shared = Math.min(left.length, right.length);
    for (let index = 0; index < shared; index += 1) {
      collectPointers(left[index], right[index], `${at}/${index}`, into);
    }
    return;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  for (const key of new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])) {
    const hasLeft = Object.hasOwn(leftRecord, key);
    const hasRight = Object.hasOwn(rightRecord, key);
    const pointer = `${at}/${pointerEscape(key)}`;
    if (hasLeft !== hasRight) {
      into.push(pointer);
      continue;
    }
    collectPointers(leftRecord[key], rightRecord[key], pointer, into);
  }
}

/** The recording's own record number for a line, as `run:n` when the line names its run. */
function recordLabel(line: unknown): string | null {
  const record = line as { n?: unknown; run?: unknown } | null;
  if (typeof record?.n !== 'number') return null;
  return typeof record.run === 'number' ? `${record.run}:${record.n}` : String(record.n);
}

/**
 * Which side published a snapshot on this record.
 *
 * A document ships whenever the publishing brain's revision moved, so `snapshot` is present on the
 * side that decided to publish and absent on the side that did not. That is the whole of the
 * reactive-versus-imperative gap, and it is worth telling apart from a content difference.
 */
function snapshotSide(expected: unknown, actual: unknown): string {
  const has = (line: unknown): boolean => {
    const document = (line as { document?: unknown } | null)?.document ?? line;
    if (typeof document !== 'object' || document === null) {
      return false;
    }
    const snapshot = (document as Record<string, unknown>).snapshot;
    return snapshot !== undefined && snapshot !== null;
  };
  const left = has(expected);
  const right = has(actual);
  if (left && right) {
    return 'both';
  }
  if (left) {
    return 'expected-only';
  }
  if (right) {
    return 'actual-only';
  }
  return 'neither';
}

function main(): void {
  const options = parseOptions(process.argv.slice(2));
  const expected = readLines(options.expected);
  const actual = readLines(options.actual);
  const compared = Math.min(expected.length, actual.length);
  const counts = new Map<string, number>();
  const differing: { label: string | null; side: string; pointers: string[] }[] = [];
  let matched = 0;
  let strict = 0;
  let wake = 0;
  let revision = 0;
  const under = (pointer: string, prefix: string): boolean => pointer === prefix || pointer.startsWith(`${prefix}/`);

  for (let index = 0; index < compared; index += 1) {
    const found: string[] = [];
    collectPointers(documentOf(expected[index], options.keys), documentOf(actual[index], options.keys), '', found);
    if (found.length === 0) strict += 1;
    if (!found.some((pointer) => under(pointer, '/nextWakeMs'))) wake += 1;
    if (!found.some((pointer) => under(pointer, '/revision'))) revision += 1;
    const pointers = found.filter((pointer) => !options.ignore.some((prefix) => under(pointer, prefix)));
    if (pointers.length === 0) {
      matched += 1;
      continue;
    }
    for (const pointer of pointers) {
      counts.set(pointer, (counts.get(pointer) ?? 0) + 1);
    }
    if (options.records) {
      differing.push({
        label: recordLabel(expected[index]) ?? recordLabel(actual[index]),
        side: snapshotSide(expected[index], actual[index]),
        pointers,
      });
    }
  }

  console.log(`expected        ${expected.length} documents (${options.expected})`);
  console.log(`actual          ${actual.length} documents (${options.actual})`);
  console.log(`compared        ${compared} documents${options.keys ? ` on ${options.keys.length} keys` : ''}`);
  if (options.ignore.length) {
    console.log(`ignored         ${options.ignore.join(', ')}`);
  }
  console.log(`matched         ${matched}/${compared}`);
  if (expected.length !== actual.length) {
    console.log(`length          the two runs published a different number of documents`);
  }
  if (counts.size === 0) {
    console.log('differences     0');
  } else {
    const ranked = [...counts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
    console.log(`differences     ${ranked.length} pointers`);
    for (const [pointer, count] of ranked.slice(0, options.limit)) {
      console.log(`  ${pointer}  x${count}`);
    }
    if (ranked.length > options.limit) {
      console.log(`  ... and ${ranked.length - options.limit} more pointers`);
    }
  }
  if (options.records) {
    console.log('');
    console.log(`${'record'.padEnd(8)} ${'snapshot'.padEnd(13)} pointers`);
    for (const entry of differing) {
      const label = entry.label ?? '?';
      console.log(`${label.padEnd(8)} ${entry.side.padEnd(13)} ${entry.pointers.slice(0, 6).join(' ')}`);
    }
  }
  if (options.summary) {
    console.log(
      `summary         matched=${matched}/${compared} strict=${strict}/${compared} wake=${wake}/${compared} revision=${revision}/${compared} expected=${expected.length} actual=${actual.length}`
    );
  }
  process.exit(counts.size === 0 && expected.length === actual.length ? 0 : 1);
}

main();
