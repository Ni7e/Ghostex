/*
 * What the synthetic recordings never exercise.
 *
 *   bun tooling/gx-chat-core/coverage.ts
 *   bun tooling/gx-chat-core/coverage.ts --covered   # the other half of the list
 *
 * The replay gate is only as good as what the recordings reach: a rule no recording touches is
 * graded by nothing at all. This walks every `/tmp/gx-chat/*.jsonl` and reports which of the
 * core's inputs never appear.
 *
 * Three inventories, each read from the source of truth rather than restated here:
 *
 *  - user actions, from `ActionKind` in `packages/gx-chat-core/src/action.rs`;
 *  - gxserver frame types, from `CHAT_FRAME_TYPES` in `packages/gx-chat-core/src/wire/frames.rs`;
 *  - the bridge's own methods and the broker message kinds, from
 *    `docs/2026-09-21/rust-chat/SEAM.md` section 0 and 1g.
 *
 * Recordings hold the user's conversation. This prints kind names and counts, never an argument.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { actionKinds } from './coverage-actions';

const ROOT = join(import.meta.dir, '..', '..');
const RECORDINGS = process.env.GX_CHAT_ROOT || '/tmp/gx-chat';

/** The wire spellings of an enum written with the crate's `kinds!`-style table. */
function wireSpellings(source: string, from: string, to: string): string[] {
  const start = source.indexOf(from);
  if (start < 0) {
    return [];
  }
  const body = source.slice(start, to ? source.indexOf(to, start) : undefined);
  return [...body.matchAll(/=>\s*"([^"]+)"/g)].map((match) => match[1]!);
}

function frameTypes(): string[] {
  const source = readFileSync(join(ROOT, 'packages/gx-chat-core/src/wire/frames.rs'), 'utf8');
  const table = source.match(/CHAT_FRAME_TYPES[^=]*=\s*\[([^\]]*)\]/s);
  return table ? [...table[1]!.matchAll(/"([^"]+)"/g)].map((match) => match[1]!) : [];
}

/** The seven `brokerMessage` kinds (`SEAM.md` section 1g) and the six bridge methods. */
const BROKER_KINDS = ['chunk', 'reset', 'chatSettings', 'contextPreferences', 'catalog', 'event', 'response'];
const BRIDGE_METHODS = ['start', 'action', 'brokerMessage', 'event', 'resolve', 'tick', 'take'];
const QUERY_METHODS = [
  'composerReferences',
  'composerKeyIntent',
  'referenceMenu',
  'transcriptMenu',
  'sendBlockedToast',
];

interface Seen {
  actions: Map<string, number>;
  frames: Map<string, number>;
  broker: Map<string, number>;
  methods: Map<string, number>;
}

function bump(into: Map<string, number>, key: string | undefined): void {
  if (typeof key !== 'string' || !key) {
    return;
  }
  into.set(key, (into.get(key) ?? 0) + 1);
}

function walk(seen: Seen): string[] {
  const names: string[] = [];
  for (const entry of readdirSync(RECORDINGS)) {
    if (!entry.endsWith('.jsonl')) {
      continue;
    }
    names.push(entry.replace(/\.jsonl$/, ''));
    for (const line of readFileSync(join(RECORDINGS, entry), 'utf8').split('\n')) {
      if (!line.trim()) {
        continue;
      }
      let record: any;
      try {
        record = JSON.parse(line);
      } catch {
        continue; // The last line of a live recording may be truncated.
      }
      if (record.k === 'header') {
        continue;
      }
      bump(seen.methods, record.m);
      if (record.m === 'action') {
        bump(seen.actions, record.a?.[0]?.type);
      } else if (record.m === 'event') {
        bump(seen.frames, record.a?.[0]?.type);
      } else if (record.m === 'brokerMessage') {
        bump(seen.broker, record.a?.[0]?.kind);
      }
    }
  }
  return names;
}

function report(label: string, inventory: string[], seen: Map<string, number>, covered: boolean): void {
  const missing = inventory.filter((name) => !seen.has(name));
  const present = inventory.filter((name) => seen.has(name));
  const shown = covered ? present : missing;
  console.log(`\n${label}  ${present.length}/${inventory.length} exercised`);
  if (shown.length === 0) {
    console.log('  (none)');
    return;
  }
  for (const name of shown) {
    console.log(covered ? `  ${name}  x${seen.get(name)}` : `  ${name}`);
  }
  const unknown = [...seen.keys()].filter((name) => !inventory.includes(name));
  if (unknown.length) {
    console.log(`  not in the inventory: ${unknown.join(', ')}`);
  }
}

function main(): void {
  const covered = process.argv.includes('--covered');
  const seen: Seen = { actions: new Map(), frames: new Map(), broker: new Map(), methods: new Map() };
  const names = walk(seen);
  console.log(`recordings      ${names.length} (${names.join(', ')})`);
  report(covered ? 'user actions exercised' : 'user actions NOT exercised', actionKinds(), seen.actions, covered);
  report(covered ? 'frame types exercised' : 'frame types NOT exercised', frameTypes(), seen.frames, covered);
  report(covered ? 'broker kinds exercised' : 'broker kinds NOT exercised', BROKER_KINDS, seen.broker, covered);
  report(
    covered ? 'bridge methods exercised' : 'bridge methods NOT exercised',
    [...BRIDGE_METHODS, ...QUERY_METHODS],
    seen.methods,
    covered
  );
}

main();
