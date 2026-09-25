/**
 * The app runtime port's F2 fixture gate: the pure logic family F2 moved from the QuickJS runtime
 * into gx-core, run on the same inputs on both sides, diffed as JSON. Zero differences is the bar.
 *
 *   bun tooling/app-runtime-port/f2-parity.ts [--inject <mutation>] [--keep <dir>]
 *
 * The TypeScript half calls the functions the runtime called (or, where the runtime file is
 * deleted, the shared function it called plus the few lines of shaping it did, quoted below); the
 * Rust half is `packages/gx-core/examples/f2_parity.rs`. `--inject` mutates the Rust answer after
 * the fact and expects the gate to report differences, which proves it can fail.
 *
 * Mutations: feed-drop-item, feed-unread-count, feed-jump.
 *
 * Deleted with the runtime in step 3 (docs/2026-09-25/app-runtime-port/PLAN.md).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeNotificationFeedState } from '@/packages/shared/notification-feed/notification-feed-contract';

type Json = any;

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const inject = option('--inject');
const keep = option('--keep');
const root = fileURLToPath(new URL('../../', import.meta.url));

// ---------------------------------------------------------------- notification feed

const row = (id: string, extra: Record<string, unknown> = {}) => ({
  agentName: 'claude',
  body: `body ${id}`,
  createdAt: '2026-09-25T10:00:00.000Z',
  id,
  kind: 'finished',
  projectId: 'P1',
  read: false,
  sessionId: `S-${id}`,
  subtitle: 'Project',
  title: `Title ${id}`,
  ...extra,
});

function notificationFeedFixtures(): Json[] {
  return [
    { name: 'empty object', result: {}, deferred: null },
    { name: 'not an object', result: 'nope', deferred: null },
    { name: 'null', result: null, deferred: null },
    { name: 'array', result: [row('a')], deferred: null },
    {
      name: 'plain feed',
      result: { items: [row('a'), row('b', { read: true })], nextUnreadId: 'a', unreadCount: 1 },
      deferred: null,
    },
    {
      name: 'derived unread count',
      result: { items: [row('a'), row('b'), row('c', { read: true })] },
      deferred: null,
    },
    {
      name: 'bad unread counts',
      result: { items: [row('a')], unreadCount: -3, nextUnreadId: 'a' },
      deferred: null,
    },
    { name: 'fractional unread', result: { items: [row('a')], unreadCount: 2.7 }, deferred: null },
    { name: 'string unread', result: { items: [row('a')], unreadCount: '4' }, deferred: null },
    {
      name: 'rows dropped',
      result: {
        items: [
          row('a', { id: '' }),
          row('b', { projectId: 5 }),
          row('c', { kind: 'other' }),
          row('d', { createdAt: '' }),
          row('e', { sessionId: undefined }),
          'text',
          null,
          row('f', { agentName: '', body: 3, subtitle: null, title: undefined, read: 'true' }),
          row('g', { kind: 'needsInput' }),
          row('h', { kind: 'bell' }),
          row('i', { kind: 'custom', extra: 'ignored' }),
        ],
        nextUnreadId: 'g',
      },
      deferred: null,
    },
    { name: 'empty next id', result: { items: [row('a')], nextUnreadId: '' }, deferred: null },
    { name: 'next id not listed', result: { items: [row('a')], nextUnreadId: 'zz' }, deferred: null },
    { name: 'defer same session', result: { items: [row('a')], nextUnreadId: 'a' }, deferred: 'S-a' },
    { name: 'defer other session', result: { items: [row('a')], nextUnreadId: 'a' }, deferred: 'S-b' },
    {
      name: 'unsafe id passes normalize',
      result: { items: [row('a b')], nextUnreadId: 'a b' },
      deferred: null,
    },
  ];
}

/**
 * The deleted runtime's `postNotificationFeedState` message and its jump choice
 * (apps/desktop/sidebar/gxserver-runtime/notification-feed.ts, deleted 2026-09-25):
 *
 *   const message = { items: state.items, ...(state.nextUnreadId ? { nextUnreadId } : {}),
 *                     type: 'notificationFeedState', unreadCount: state.unreadCount };
 *   const item = state.items.find((entry) => entry.id === state.nextUnreadId);
 *   if (!item || item.sessionId === sessionId) return;
 */
function notificationFeedTypescript(cases: Json[]): Json[] {
  return cases.map((fixture) => {
    const state = normalizeNotificationFeedState(fixture.result);
    const message = {
      items: state.items,
      ...(state.nextUnreadId ? { nextUnreadId: state.nextUnreadId } : {}),
      type: 'notificationFeedState',
      unreadCount: state.unreadCount,
    };
    const item = state.nextUnreadId ? state.items.find((entry) => entry.id === state.nextUnreadId) : undefined;
    const deferred = fixture.deferred ?? undefined;
    const jump = !item || (deferred !== undefined && item.sessionId === deferred) ? null : item.id;
    return { jump, message, name: fixture.name };
  });
}

// ---------------------------------------------------------------- driver

function canonical(value: Json): Json {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])])
    );
  }
  return value;
}

function injectMutation(rust: Json): void {
  switch (inject) {
    case undefined:
      return;
    case 'feed-drop-item':
      rust.notificationFeed[4].message.items.pop();
      return;
    case 'feed-unread-count':
      rust.notificationFeed[5].message.unreadCount += 1;
      return;
    case 'feed-jump':
      rust.notificationFeed[12].jump = 'a';
      return;
    default:
      console.error(`Unknown mutation ${inject}.`);
      process.exit(2);
  }
}

const dir = keep ?? mkdtempSync(join(tmpdir(), 'f2-parity-'));
try {
  const fixtures = { notificationFeed: notificationFeedFixtures() };
  // JSON round trip first, so both halves read the same bytes (undefined fields vanish).
  writeFileSync(join(dir, 'fixtures.json'), JSON.stringify(fixtures));
  const read = JSON.parse(readFileSync(join(dir, 'fixtures.json'), 'utf8'));
  const typescript = { notificationFeed: notificationFeedTypescript(read.notificationFeed) };
  const cargo = spawnSync('cargo', ['run', '-q', '--example', 'f2_parity', '--', dir], {
    cwd: join(root, 'packages/gx-core'),
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  if (cargo.status !== 0) {
    console.error('The Rust half failed.');
    process.exit(2);
  }
  const rust = JSON.parse(readFileSync(join(dir, 'rust.json'), 'utf8'));
  injectMutation(rust);
  let differences = 0;
  let cases = 0;
  for (const family of Object.keys(typescript) as Array<keyof typeof typescript>) {
    const left = typescript[family] as Json[];
    const right = rust[family] as Json[];
    for (let index = 0; index < Math.max(left.length, right.length); index++) {
      cases++;
      const a = JSON.stringify(canonical(left[index]));
      const b = JSON.stringify(canonical(right[index]));
      if (a !== b) {
        differences++;
        console.log(`DIFF ${family} #${index} ${left[index]?.name ?? right[index]?.name}\n  ts:   ${a}\n  rust: ${b}`);
      }
    }
  }
  console.log(`F2 parity: ${cases} cases, ${differences} difference(s)${inject ? ` (injected ${inject})` : ''}.`);
  process.exit(inject ? (differences > 0 ? 0 : 1) : differences > 0 ? 1 : 0);
} finally {
  if (!keep) rmSync(dir, { force: true, recursive: true });
}
