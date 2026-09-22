/*
 * Looks at ONE pointer across a replay's expected and actual document sequences, without printing
 * either value.
 *
 *   bun tooling/gx-chat-core/replay-probe.ts <name> /snapshot/accountPanel/session/name [--limit 5]
 *   bun tooling/gx-chat-core/replay-probe.ts <name> --record 2:415
 *
 * `replay-diff.ts` says WHERE the two brains disagree; this says HOW, in terms that carry none of
 * the conversation: the JSON type on each side, string lengths, the first index at which two
 * strings differ, whether they differ only in case or whitespace, and a character-class shape
 * (`a` letter, `9` digit, `_` space, punctuation kept) truncated to a few dozen characters. For an
 * object or an array it lists the differing keys or the two lengths. `--record` prints every
 * differing pointer of one record, with the same summary at each.
 *
 * Recordings are the user's conversation. Nothing here prints a value, and the shape is short
 * enough to identify a format (an ISO date, an email, a model id, a sentence) and nothing else.
 */

import { readFileSync } from 'node:fs';

interface Options {
  name: string;
  pointer: string | null;
  record: string | null;
  limit: number;
}

function parseOptions(argv: readonly string[]): Options {
  const options: Options = { name: 'synthetic', pointer: null, record: null, limit: 5 };
  let positional = 0;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    const next = argv[index + 1];
    if (argument === '--limit' && next) {
      options.limit = Number(next) || options.limit;
      index += 1;
    } else if (argument === '--record' && next) {
      options.record = next;
      index += 1;
    } else if (argument.startsWith('/')) {
      options.pointer = argument;
    } else if (!argument.startsWith('--')) {
      if (positional === 0) options.name = argument;
      positional += 1;
    }
  }
  return options;
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

function at(value: unknown, pointer: string): { present: boolean; value: unknown } {
  if (pointer === '' || pointer === '/') return { present: true, value };
  let current: unknown = value;
  for (const raw of pointer.split('/').slice(1)) {
    const segment = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return { present: false, value: undefined };
      current = current[index];
    } else if (typeof current === 'object' && current !== null) {
      if (!Object.hasOwn(current, segment)) return { present: false, value: undefined };
      current = (current as Record<string, unknown>)[segment];
    } else {
      return { present: false, value: undefined };
    }
  }
  return { present: true, value: current };
}

function shape(text: string, limit = 48): string {
  const masked = text
    .replace(/[A-Za-zÀ-ɏ]/g, 'a')
    .replace(/[0-9]/g, '9')
    .replace(/[ \t]/g, '_')
    .replace(/\n/g, '\\n');
  return masked.length > limit ? `${masked.slice(0, limit)}…(${masked.length})` : masked;
}

function kindOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array[${value.length}]`;
  if (typeof value === 'object') return `object{${Object.keys(value as object).length}}`;
  return typeof value;
}

function describe(left: { present: boolean; value: unknown }, right: { present: boolean; value: unknown }): string {
  if (!left.present || !right.present) {
    return `expected ${left.present ? kindOf(left.value) : 'absent'}, actual ${right.present ? kindOf(right.value) : 'absent'}`;
  }
  const a = left.value;
  const b = right.value;
  if (typeof a === 'string' && typeof b === 'string') {
    let first = 0;
    while (first < a.length && first < b.length && a[first] === b[first]) first += 1;
    const notes: string[] = [];
    if (a.toLowerCase() === b.toLowerCase()) notes.push('case only');
    if (a.replace(/\s+/g, '') === b.replace(/\s+/g, '')) notes.push('whitespace only');
    if (a.startsWith(b) || b.startsWith(a)) notes.push('one is a prefix of the other');
    if (a.trim() === b.trim()) notes.push('trim only');
    return `strings len ${a.length} vs ${b.length}, first difference at ${first}${notes.length ? ` (${notes.join(', ')})` : ''}; shapes: ${shape(a)} | ${shape(b)}`;
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return `numbers, actual - expected = ${b - a}${Number.isInteger(a) && Number.isInteger(b) ? '' : ' (fractional)'}`;
  }
  if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b) || (a === null) !== (b === null)) {
    return `types ${kindOf(a)} vs ${kindOf(b)}`;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return `arrays len ${a.length} vs ${b.length}`;
  }
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    const differing = [...keys].filter((key) => JSON.stringify(left[key]) !== JSON.stringify(right[key]));
    return `objects, differing keys: ${differing.join(', ') || '(none)'}`;
  }
  return `${kindOf(a)} vs ${kindOf(b)}`;
}

function pointerEscape(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

function collectPointers(left: unknown, right: unknown, prefix: string, into: string[]): void {
  if (Object.is(left, right)) return;
  const bothObjects = typeof left === 'object' && left !== null && typeof right === 'object' && right !== null;
  if (!bothObjects || Array.isArray(left) !== Array.isArray(right)) {
    if (left !== right) into.push(prefix || '/');
    return;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) into.push(`${prefix}/length`);
    for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
      collectPointers(left[index], right[index], `${prefix}/${index}`, into);
    }
    return;
  }
  const l = left as Record<string, unknown>;
  const r = right as Record<string, unknown>;
  for (const key of new Set([...Object.keys(l), ...Object.keys(r)])) {
    const pointer = `${prefix}/${pointerEscape(key)}`;
    if (Object.hasOwn(l, key) !== Object.hasOwn(r, key)) {
      into.push(pointer);
      continue;
    }
    collectPointers(l[key], r[key], pointer, into);
  }
}

function label(line: unknown): string {
  const record = line as { n?: unknown; run?: unknown } | null;
  return typeof record?.run === 'number' ? `${record.run}:${record?.n}` : String(record?.n);
}

function main(): void {
  const options = parseOptions(process.argv.slice(2));
  const expected = readLines(`/tmp/gx-chat/expected/${options.name}.jsonl`);
  const actual = readLines(`/tmp/gx-chat/actual/${options.name}.jsonl`);
  const compared = Math.min(expected.length, actual.length);
  const documentOf = (line: unknown): unknown => (line as { document?: unknown }).document ?? line;

  if (options.record) {
    for (let index = 0; index < compared; index += 1) {
      if (label(expected[index]) !== options.record) continue;
      const found: string[] = [];
      collectPointers(documentOf(expected[index]), documentOf(actual[index]), '', found);
      console.log(`record ${options.record}: ${found.length} pointers`);
      for (const pointer of found.slice(0, options.limit * 8)) {
        console.log(`  ${pointer}  ${describe(at(documentOf(expected[index]), pointer), at(documentOf(actual[index]), pointer))}`);
      }
      return;
    }
    console.log(`record ${options.record} not found`);
    return;
  }

  const pointer = options.pointer ?? '/';
  let shown = 0;
  let differing = 0;
  const summaries = new Map<string, number>();
  for (let index = 0; index < compared; index += 1) {
    const left = at(documentOf(expected[index]), pointer);
    const right = at(documentOf(actual[index]), pointer);
    if (JSON.stringify(left) === JSON.stringify(right)) continue;
    differing += 1;
    const summary = describe(left, right);
    summaries.set(summary.replace(/at \d+/, 'at N'), (summaries.get(summary.replace(/at \d+/, 'at N')) ?? 0) + 1);
    if (shown < options.limit) {
      console.log(`${label(expected[index]).padEnd(8)} ${summary}`);
      shown += 1;
    }
  }
  console.log(`differing       ${differing}/${compared} at ${pointer}`);
  for (const [summary, count] of [...summaries].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`  x${count}  ${summary}`);
  }
}

main();
