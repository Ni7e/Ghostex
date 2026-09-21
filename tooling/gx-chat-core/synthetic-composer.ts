/**
 * Writes `/tmp/gx-chat/synthetic-composer.jsonl`: family d's own query coverage.
 *
 * Usage: `bun tooling/gx-chat-core/synthetic-composer.ts`
 *
 * `synthetic-recording.ts` walks the brain through a whole conversation and asks each of the five
 * pure helpers exactly once. The composer port needs many more cases than that, and they do not
 * need a conversation at all: `composerReferences`, `composerKeyIntent`, `referenceMenu`,
 * `transcriptMenu` and `sendBlockedToast` hold no state, so this generator loads the same shipped
 * rules and asks them directly. The recording it writes is a header plus `query` records, which is
 * a valid recording that the Rust `examples/composer_check.rs` reads the same way as the main one.
 *
 * Every input is invented: paths under `/sample`, labels from the fixtures' vocabulary, and the
 * keystrokes a keyboard sends. Nothing here reads a real project, a real draft or a real chat.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

import {
  nativeChatReplayHash,
  type NativeChatReplayDriver,
  type NativeChatReplayKind,
} from '@/packages/shared/session-chat-controller/native-host-replay';
import { loadChatBrain } from './brain';
import { RECORDING_ROOT, serializeHeader, serializeRecord, type ReplayRecord } from './recording';

/** The invented clock. The queries never read it; it is here so the records are well formed. */
const CLOCK_START = 1_789_632_000_000;

/** Records the five pure helpers. No clock, random or id read can happen inside one. */
class QueryWorld implements NativeChatReplayDriver {
  readonly lines: string[] = [];
  private open: ReplayRecord | null = null;
  private sequence = 0;

  begin(kind: NativeChatReplayKind, method: string, args: readonly unknown[]): void {
    this.flush();
    this.sequence += 1;
    this.open = { n: this.sequence, k: kind, m: method, ms: CLOCK_START, a: [...args] };
  }

  clock(): number {
    return CLOCK_START;
  }

  random(): number {
    throw new Error('A pure query must not read the random source.');
  }

  uuid(): string {
    throw new Error('A pure query must not read an id.');
  }

  result(hash: string, length: number): void {
    if (!this.open) return;
    this.open.hash = hash;
    this.open.len = length;
  }

  flush(): void {
    if (!this.open) return;
    this.lines.push(serializeRecord(this.open));
    this.open = null;
  }
}

type KeyEvent = { alt: boolean; control: boolean; key: string; platform: boolean; shift: boolean };

function key(key: string, modifiers: Partial<KeyEvent> = {}): KeyEvent {
  return { alt: false, control: false, key, platform: false, shift: false, ...modifiers };
}

/** Drafts whose reference pills cover every kind, every escape and every refusal. */
const DRAFTS = [
  '',
  'plain text with no references at all',
  'See [File #1](/sample/project/src/chat.ts) and [Image #2](/sample/shot.png) here.',
  'A folder: [Folder #1](/sample/project/src/) and a skill [$review](/sample/skills/review/SKILL.md).',
  'A link [the docs](https://example.test/guide) and an inert one [mail](mailto:nobody@example.test).',
  'Escapes: [a\\]b #3](/sample/a.txt) and an image ![not a pill](/sample/shot.png).',
  'Angled <> destination [notes #4](</sample/my notes/plan one.md>) stays one pill.',
  'Coordinates [chat.ts #5](/sample/project/src/chat.ts:12:8) and a range [x #6](/sample/x.ts:12-40).',
  'A windows path [win #7](C:\\sample\\project\\main.rs) and a bare name [Makefile #8](/sample/Makefile).',
  'An anchor [top](#heading) and an empty one [blank]() are skipped.',
  'Wide label [a very long descriptive label indeed #9](/sample/project/deeply/nested/file.ts).',
  'An emoji \u{1f600} before [File #10](/sample/after-emoji.ts) moves every later offset.',
  'A dotfile [.gitignore #11](/sample/project/.gitignore) is a file, not a folder.',
  'Reveal marker [File #12\u00b7](/sample/revealed.ts) is plain text again.',
];

/** Hrefs whose menus cover the web, file, Docs, folder and inert branches. */
const HREFS = [
  'https://example.test/guide',
  'http://example.test/',
  'file:///sample/project/src/chat.ts',
  'file:///sample/project/docs/plan.md',
  '/sample/project/src/',
  '/sample/project/README',
  '/sample/project/notes.excalidraw',
  '/sample/project/src/chat.ts:12',
  '/sample/project/src/chat.ts:12:8',
  '/sample/project/src/chat.ts:12-40',
  'C:\\sample\\project\\main.rs',
  'mailto:nobody@example.test',
  '#heading',
  '',
  '/sample/my%20notes/plan%20one.md',
];

/** Selections and reference combinations for the transcript menu. */
const TRANSCRIPT_MENUS: { href: string | null; selection: string; questionActive: boolean }[] = [
  { href: null, selection: '', questionActive: false },
  { href: null, selection: 'normalizeChatTranscript', questionActive: false },
  { href: null, selection: 'normalizeChatTranscript', questionActive: true },
  { href: '/sample/project/src/chat.ts', selection: '', questionActive: false },
  { href: '/sample/project/src/chat.ts', selection: 'one line', questionActive: false },
  { href: 'https://example.test/guide', selection: 'two\nlines\n\nand a blank', questionActive: true },
  { href: 'mailto:nobody@example.test', selection: '', questionActive: false },
  { href: null, selection: 'carriage\r\nreturns\rand\nnewlines', questionActive: false },
];

/** Every reason `sessionChatSendBlockedReason` can answer with, plus the degenerate ones. */
const BLOCKED_REASONS = [
  '',
  '   ',
  'Input is held by another device.',
  'Wait for the account switch to complete.',
  'This conversation is open elsewhere. Use Continue here or close it in the other app and retry.',
  'Answer the question above first.',
  'Your answer is still being applied. Try again in a moment.',
  'Claude is still switching mode. Try again in a moment.',
  'Message not sent',
  'message not sent!',
];

/** The keystrokes the chat background can catch, on each platform the renderer reports. */
const KEYSTROKES: KeyEvent[] = [
  key('left'),
  key('right', { shift: true }),
  key('up'),
  key('down', { platform: true }),
  key('left', { alt: true }),
  key('right', { control: true }),
  key('left', { alt: true, control: true }),
  key('a', { control: true }),
  key('e', { control: true }),
  key('u', { control: true }),
  key('k', { control: true }),
  key('y', { control: true }),
  key('a', { platform: true }),
  key('c', { platform: true }),
  key('x', { platform: true }),
  key('v', { platform: true }),
  key('z', { platform: true }),
  key('z', { platform: true, shift: true }),
  key('y', { platform: true }),
  key('backspace', { platform: true }),
  key('delete', { platform: true }),
  key('backspace', { alt: true }),
  key('delete', { alt: true }),
  key('backspace', { shift: true, platform: true }),
  key('enter'),
  key('tab'),
  key('escape'),
  key('f5'),
];

async function main(): Promise<number> {
  const world = new QueryWorld();
  const host = await loadChatBrain(world);

  for (const draft of DRAFTS) (host.composerReferences as (text: string) => unknown)(draft);
  for (const href of HREFS) (host.referenceMenu as (href: string) => unknown)(href);
  for (const request of TRANSCRIPT_MENUS) (host.transcriptMenu as (request: unknown) => unknown)(request);
  for (const reason of BLOCKED_REASONS) (host.sendBlockedToast as (reason: string) => unknown)(reason);
  for (const platform of ['mac', 'windows', 'linux'] as const)
    for (const keystroke of KEYSTROKES)
      (host.composerKeyIntent as (event: KeyEvent, platform: string) => unknown)(keystroke, platform);
  world.flush();

  mkdirSync(RECORDING_ROOT, { recursive: true, mode: 0o700 });
  const path = `${RECORDING_ROOT}/synthetic-composer.jsonl`;
  const body = [serializeHeader(CLOCK_START), ...world.lines].join('\n');
  writeFileSync(path, `${body}\n`, { mode: 0o600 });

  console.log(`records     ${world.lines.length} queries`);
  console.log(`fingerprint ${nativeChatReplayHash(body)}`);
  console.log(`recording   ${path}`);
  return world.lines.length > 0 ? 0 : 1;
}

process.exitCode = await main();
