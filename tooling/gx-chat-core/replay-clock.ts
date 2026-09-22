/**
 * Which code read each clock value of a recorded call, so a latched clock can be ported to the
 * read the TypeScript actually takes.
 *
 *   bun tooling/gx-chat-core/replay-clock.ts <recording.jsonl> 29,30        # every read of records 29 and 30
 *   bun tooling/gx-chat-core/replay-clock.ts <recording.jsonl> --site native-controls.ts:58
 *
 * The first form prints, for each clock read of the chosen records of the first run, its index in
 * the record's `c` queue and the four innermost frames of shipped code that made it. The second
 * replays the whole first run and prints, for every call in which `site` (a `file:line` substring)
 * read the clock, the sites of every read of that call up to and including it: that sequence is
 * what says which read index a rule latches (the core's `ChatContext::clock_read`).
 *
 * `native-host.ts:286` (`schedule`, the brain's own timer map) is skipped as a frame, so a timer's
 * read is named by the code that armed it.
 *
 * Recordings are the user's conversation. This prints record numbers, read indexes and code
 * locations only, never a clock value, an argument or a document.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { loadChatBrain, settle } from './brain';
import { parseRecording, type ReplayRecord } from './recording';

const path = process.argv[2];
const selector = process.argv[3];
if (!path || !selector) {
  console.error('usage: replay-clock.ts <recording.jsonl> <n,n,...> | --site <file:line>');
  process.exit(2);
}
const site = selector === '--site' ? process.argv[4] : undefined;
const wanted = new Set(site ? [] : selector.split(',').map(Number));
const recording = parseRecording(readFileSync(path, 'utf8'), basename(path));
const run = recording.runs[0];
if (!run) {
  console.error('the recording has no runs');
  process.exit(1);
}

/** The shipped-code frames of the current stack, innermost first, without the replay's own. */
function frames(): string[] {
  return (new Error().stack ?? '')
    .split('\n')
    .slice(3)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.includes('packages/') && !line.includes('native-host-replay') && !line.includes('native-host.ts:286')
    )
    .map((line) =>
      line
        .replace(/^at /, '')
        .replace(/\(?\/.*?packages\//, '(')
        .replace(/:\d+\)?$/, ')')
    );
}

let current = 0;
let sequence: string[] = [];
const clock = { record: null as ReplayRecord | null, at: 0 };
const world = {
  pending: null as ReplayRecord | null,
  begin() {
    clock.record = world.pending;
    world.pending = null;
    clock.at = 0;
  },
  clock(): number {
    const reads = clock.record?.c;
    const index = clock.at;
    const value = reads && index < reads.length ? reads[clock.at++]! : (clock.record?.ms ?? 0);
    const stack = frames();
    if (site) {
      sequence.push(stack[0] ?? '?');
      if (stack[0]?.includes(site)) console.log(`n=${current} m=${clock.record?.m} ${sequence.join(' | ')}`);
    } else if (wanted.has(current)) {
      console.log(`n=${current} read#${index} ${stack.slice(0, 4).join(' < ')}`);
    }
    return value;
  },
  random: () => 0,
  uuid: () => '00000000-0000-4000-8000-000000000000',
  result: () => {},
};

const host = (await loadChatBrain(world as never)) as unknown as Record<string, (...args: unknown[]) => unknown>;
const last = site ? Infinity : Math.max(...wanted);
for (const record of run.records) {
  current = record.n;
  sequence = [];
  world.pending = record;
  try {
    host[record.m]?.apply(host, record.a);
  } catch {
    // A refused input is the replay's own finding; this tool only names clock sites.
  }
  await settle();
  if (current > last) break;
}
