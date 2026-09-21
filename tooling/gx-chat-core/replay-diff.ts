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
 * `--ignore` drops whole pointer prefixes from the comparison. `tooling/gx-chat-core/run-gates.sh`
 * passes `/requests`, which is the QuickJS bridge's wire form and not part of the Rust core's
 * contract at all: client storage rides on it there (`composer('read')`, `composer('summary')`)
 * and is an `Effect` here, and its ids come off a counter the TypeScript shares with its timers.
 * The Rust host consumes `Vec<Effect>` and builds no `requests` array.
 */

import { readFileSync } from 'node:fs';

interface Options {
  expected: string;
  actual: string;
  keys: string[] | null;
  /** Pointer prefixes dropped from the comparison, with the reason printed in the report. */
  ignore: string[];
  limit: number;
}

function parseOptions(argv: readonly string[]): Options {
  let name = 'synthetic';
  let expected = '';
  let actual = '';
  let keys: string[] | null = null;
  const ignore: string[] = [];
  let limit = 40;
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

function main(): void {
  const options = parseOptions(process.argv.slice(2));
  const expected = readLines(options.expected);
  const actual = readLines(options.actual);
  const compared = Math.min(expected.length, actual.length);
  const counts = new Map<string, number>();
  let matched = 0;

  for (let index = 0; index < compared; index += 1) {
    const found: string[] = [];
    collectPointers(documentOf(expected[index], options.keys), documentOf(actual[index], options.keys), '', found);
    const pointers = found.filter(
      (pointer) => !options.ignore.some((prefix) => pointer === prefix || pointer.startsWith(`${prefix}/`))
    );
    if (pointers.length === 0) {
      matched += 1;
      continue;
    }
    for (const pointer of pointers) {
      counts.set(pointer, (counts.get(pointer) ?? 0) + 1);
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
  process.exit(counts.size === 0 && expected.length === actual.length ? 0 : 1);
}

main();
