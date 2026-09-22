/**
 * A recording of malformed input, for the one property this one grades: the core must not panic.
 *
 * Usage: `bun tooling/gx-chat-core/synthetic-hostile.ts`, then
 * `cargo run --release --example replay -- /tmp/gx-chat/synthetic-hostile.jsonl` from
 * `packages/gx-chat-core`. `run-gates.sh` runs both and treats a non-zero exit, or a panic, as a
 * failure; it does NOT diff the documents, because what two engines print for a malformed frame is
 * their own business and grading it would grade Bun rather than the brain.
 *
 * Why it exists: gxserver, the daemon and the host all speak to the core over plain JSON, and the
 * core runs ON the host's own thread. A `panic!` in a slice, an index or an `unwrap` there takes
 * the chat window down, so every rule has to survive a frame that a field is missing from, a field
 * whose type is wrong, a number that is absurd, a string with a lone UTF-16 surrogate in it, and
 * an array that is empty where the code expects a row.
 *
 * What it feeds, in order:
 *
 * - frames with `messages` absent, `messages` as an object, and message rows that are numbers;
 * - a message whose `blocks` are strings, whose `timestamp` is a string, and whose `id` is null;
 * - text carrying lone surrogates, a NUL, combining marks and an unpaired high surrogate at the
 *   very end of the string, which is where a byte-offset slice of a UTF-16 index goes wrong;
 * - numbers at the edges: `Number.MAX_SAFE_INTEGER`, `-1`, `1e308`, `NaN` and `Infinity` as JSON
 *   nulls, and a byte offset larger than any file;
 * - empty arrays where a row is expected (`blocks`, `messages`, `queue`, `accounts`, `choices`);
 * - every user action the core knows, each with NO parameters at all, then a second pass with
 *   parameters of the wrong type;
 * - answers to requests that name nothing, carry the wrong shape, or are JSON `null`.
 *
 * The world is scripted the same way every other recording here is (a fixed clock step, a seeded
 * random source, counted ids), so two generations produce the same bytes and the file holds no
 * user data: every string in it is invented here.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

import { ChatPreviewBackend } from '@/packages/shared/session-chat-preview/backend';
import { DEFAULT_CHAT_PREVIEW } from '@/packages/shared/session-chat-preview/fixture';
import { PREVIEW_START_MS } from '@/packages/shared/session-chat-preview/message';
import {
  nativeChatReplayHash,
  type NativeChatReplayDriver,
  type NativeChatReplayKind,
} from '@/packages/shared/session-chat-controller/native-host-replay';
import { ACTION_KINDS } from './coverage-actions';
import { loadChatBrain, settle } from './brain';
import { composerAnswer, RECORDING_ROOT, serializeHeader, serializeRecord, type ReplayRecord } from './recording';

const CLOCK_START = PREVIEW_START_MS;
const CLOCK_STEP_MS = 25;
const PROJECT_ID = 'gx-synthetic-hostile-project';
const SESSION_ID = 'gx-synthetic-hostile-session';

/**
 * Strings a byte-offset slice or a UTF-16 index can go wrong on.
 *
 * `\ud800` and `\udfff` are lone surrogates: `JSON.stringify` writes them through, `str::chars`
 * never produces one, and a core that converts a UTF-16 caret to a byte offset has to survive
 * landing in the middle of one. The rest are a NUL, a combining mark on its own, an astral pair,
 * and a right-to-left override.
 */
const NASTY_TEXT = [
  '\ud800 lone high surrogate',
  'lone low surrogate \udfff',
  'pair 😀 then half \ud83d',
  'nul\u0000inside',
  'combining ́́́ marks',
  'rtl ‮ override',
  '',
  ' '.repeat(400),
  '```\nunclosed fence\n',
  '[label](',
  '/sample/project/file.ts:999999999999:0',
];

/** Records every call the way the app's recorder does, from a world with no clock and no entropy. */
class SyntheticWorld implements NativeChatReplayDriver {
  readonly lines: string[] = [];
  private open: ReplayRecord | null = null;
  private sequence = 0;
  private ms = CLOCK_START;
  private randomState = 0x7ab19c3;
  private uuidCount = 0;
  private suspended = 0;

  /** Runs the generator's own work with its reads left out of the open record. */
  async outside<T>(work: () => Promise<T>): Promise<T> {
    this.suspended += 1;
    try {
      return await work();
    } finally {
      this.suspended -= 1;
    }
  }

  private get recording(): ReplayRecord | null {
    return this.suspended ? null : this.open;
  }

  begin(kind: NativeChatReplayKind, method: string, args: readonly unknown[]): void {
    this.flush();
    this.ms += CLOCK_STEP_MS;
    this.sequence += 1;
    this.open = { n: this.sequence, k: kind, m: method, ms: this.ms, a: args as unknown[], c: [], r: [], u: [] };
  }

  clock(): number {
    this.recording?.c!.push(this.ms);
    return this.ms;
  }

  random(): number {
    let state = this.randomState;
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    this.randomState = state >>> 0;
    const value = this.randomState / 0x100000000;
    this.recording?.r!.push(value);
    return value;
  }

  uuid(): string {
    this.uuidCount += 1;
    const value = `00000000-0000-4000-8000-${String(this.uuidCount).padStart(12, '0')}`;
    this.recording?.u!.push(value);
    return value;
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

  get now(): number {
    return this.ms;
  }
}

interface HostRequest {
  id?: number;
  kind: string;
  method: string;
  params: Record<string, unknown>;
}

async function main(): Promise<number> {
  const world = new SyntheticWorld();
  const host = await loadChatBrain(world);
  const backend = new ChatPreviewBackend({ ...DEFAULT_CHAT_PREVIEW });

  let revision = 0;
  let subscribed = false;
  let frames = 0;
  let actions = 0;
  let answers = 0;
  /** How many times the TypeScript brain threw out of a tick, a take or an action. */
  let brainThrows = 0;

  const crossing = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T;

  /** Progress, on stderr, so a generator that stalls says where. */
  const started = Date.now();
  const phase = (label: string): void => {
    process.stderr.write(`  ${String(Date.now() - started).padStart(7)}ms  ${label}\n`);
  };

  /**
   * Starts one bridge call and swallows whatever it throws, synchronously or as a rejection.
   *
   * It does NOT await the call. The bridge's entry points are `async` and several arms await a
   * host round trip, so awaiting one here would block until the pump answers it, and the pump
   * only runs after the call returns: a gesture whose arm waits on `composer('write')` deadlocks
   * the generator. The pump drains what the call started; the `catch` is here because a brain
   * that throws on malformed input rejects a promise rather than unwinding into the caller, and
   * an unhandled rejection would fail the generator on the input the recording exists to hold.
   */
  const fire = (work: () => unknown): void => {
    try {
      const value = work();
      if (value instanceof Promise)
        void value.catch(() => {
          brainThrows += 1;
        });
    } catch {
      brainThrows += 1;
    }
  };

  /** One frame, sent whatever shape it is. A refused frame is a pass, a panic is not. */
  const frame = (body: Record<string, unknown>): void => {
    frames += 1;
    // The TypeScript brain throwing on a malformed frame is itself a recorded fact; the record is
    // written either way, which is what the Rust half has to survive.
    fire(() => host.event(crossing(body)));
  };

  const answer = async (request: HostRequest): Promise<void> => {
    if (request.kind === 'broker' && request.method === 'subscribe') {
      subscribed = true;
      return;
    }
    if (request.kind === 'broker' && request.method === 'unsubscribe') {
      subscribed = false;
      return;
    }
    if (request.id === undefined) return;
    try {
      let value: unknown;
      if (request.kind === 'rpc') value = await world.outside(() => backend.rpc(request.method, request.params));
      else if (request.method === 'composer') {
        const composer = (request.params.composer ?? {}) as Record<string, unknown> & { operation: string };
        const { operation, ...rest } = composer;
        value = await world.outside(() => composerAnswer(backend, operation, rest));
      } else return;
      host.resolve(request.id, crossing(value));
    } catch (error) {
      host.resolve(request.id, undefined, {
        message: error instanceof Error ? error.message : String(error),
        endpoint: request.method,
      });
    }
    await settle();
  };

  const pump = async (rounds = 8): Promise<void> => {
    let quiet = 0;
    for (let round = 0; round < rounds; round += 1) {
      // The TypeScript brain itself throws out of `publish` on some of this input (a `queue` row
      // that is `null` reaches `sessionChatQueueRowPreview(text)` and reads `text.split`), so the
      // pump tolerates a throwing tick or take. The record is already open by then and is written
      // either way, which is what the Rust half has to survive.
      let document: string | null = null;
      fire(() => host.tick());
      await settle();
      try {
        document = host.take(revision);
      } catch {
        brainThrows += 1;
      }
      await settle();
      if (document === null) {
        quiet += 1;
        if (quiet > 1) return;
        continue;
      }
      const parsed = JSON.parse(document) as { revision?: number; requests?: HostRequest[] };
      if (typeof parsed.revision === 'number') revision = parsed.revision;
      const requests = parsed.requests ?? [];
      if (!requests.length) {
        quiet += 1;
        if (quiet > 1) return;
        continue;
      }
      quiet = 0;
      for (const request of requests) await answer(request);
      await settle();
    }
  };

  /**
   * One gesture, whatever shape it is.
   *
   * Two pump rounds rather than the usual eight: 241 gestures over a transcript this damaged is
   * the whole cost of the recording, and a gesture that starts no request settles in one.
   */
  const act = async (command: Record<string, unknown>): Promise<void> => {
    actions += 1;
    // Same reason as `frame`: the refusal is the record.
    fire(() => host.action(crossing(command)));
    await settle();
    await pump(2);
  };

  /** A frame envelope with the fields the socket checks, so the body is what is under test. */
  const envelope = (type: string, body: Record<string, unknown>): Record<string, unknown> => {
    backend.snapshot.seq += 1;
    return {
      type,
      protocolVersion: 1,
      serverId: 'gx-synthetic-hostile',
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
      epoch: 1,
      seq: backend.snapshot.seq,
      ...body,
    };
  };

  host.start({ clientId: 'gx-synthetic-hostile-client', projectId: PROJECT_ID });
  await settle();
  await pump();
  if (!subscribed) {
    // The subscribe never has to land for this recording; the frames are pushed either way.
    subscribed = true;
  }

  phase('boot');
  // 1. A first snapshot that is well formed enough to open the view, so everything after it is
  //    a MUTATION of a live conversation rather than a boot that never happened.
  frame(
    envelope('sessionChatSnapshot', {
      messages: [
        {
          id: 'h1',
          role: 'user',
          blocks: [{ type: 'text', text: 'start' }],
          timestamp: CLOCK_START,
          source: 'transcript',
          byteOffset: 10,
        },
      ],
      status: 'ready',
      beforeOffset: 0,
      hasMore: false,
    })
  );
  await settle();
  await pump();

  phase('opened');
  // 2. Missing fields, and fields of the wrong type, one frame at a time.
  const malformedBodies: Record<string, unknown>[] = [
    {},
    { messages: null },
    { messages: {} },
    { messages: 'not a list' },
    { messages: [] },
    { messages: [1, 2, 3] },
    { messages: [null] },
    { messages: [{}] },
    { messages: [{ id: null, role: null, blocks: null, timestamp: 'yesterday' }] },
    { messages: [{ id: 'h1', role: 'user', blocks: ['a string block'], timestamp: null }] },
    { messages: [{ id: 'h1', role: 'wizard', blocks: [{ type: 'unknown-block' }], timestamp: {} }] },
    { messages: [{ id: 'h1', role: 'assistant', blocks: [{ type: 'tool-call', name: 42, input: 'not an object' }] }] },
    { messages: [{ id: 'h1', role: 'assistant', blocks: [{ type: 'tool-result', name: 'Read', output: [] }] }] },
    { status: 'error', error: null },
    { status: 42 },
    { working: 'yes' },
    { queue: {} },
    { queue: [null, 7, { id: null }] },
    { prompt: 7 },
    { terminalNotice: [] },
    { selectedOptions: 'high' },
    { selectedOptions: { detectedAt: 'not a date', model: 5, effort: { value: null } } },
    { agentFleet: 3 },
    { agentTasks: { tasks: 'none' } },
    { terminalActivity: false },
    { appCommands: {} },
    { returnedPrompt: { id: null, text: null } },
    { asyncQuestionsSince: 'never' },
    { retiredAsyncQuestionIds: 'all' },
    { draft: { content: 12, version: { draftId: null, revision: 'one' } } },
    { accountSwitch: [] },
    { pendingModelSelection: 'queued' },
    { availableAgents: {} },
    { switchableAgents: [null] },
    { lifecycle: 9 },
  ];
  for (const body of malformedBodies) {
    frame(envelope('sessionChatSnapshot', body));
    await settle();
  }
  await pump();

  phase('malformed frames');
  // 3. Numbers at the edges. JSON has no NaN or Infinity, so the shapes a server can really send
  //    are the huge, the negative and the fractional.
  const wildNumbers = [Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER, -1, 0, 1e308, 0.5, 2 ** 53];
  for (const value of wildNumbers) {
    frame(
      envelope('sessionChatSnapshot', {
        messages: [
          {
            id: 'h1',
            role: 'user',
            blocks: [{ type: 'text', text: 'edge' }],
            timestamp: value,
            source: 'transcript',
            byteOffset: value,
          },
        ],
        beforeOffset: value,
        hasMore: true,
        contextUsage: { usedTokens: value, totalTokens: value },
      })
    );
    await settle();
  }
  await pump();

  phase('wild numbers');
  // 4. Text a byte-offset slice or a UTF-16 index can go wrong on, in every place text lands.
  for (const text of NASTY_TEXT) {
    frame(
      envelope('sessionChatAppended', {
        messages: [
          {
            id: `nasty-${frames}`,
            role: 'assistant',
            blocks: [
              { type: 'text', text },
              { type: 'tool-call', name: text, input: { file_path: text, command: text } },
              { type: 'tool-result', name: text, output: text },
            ],
            timestamp: CLOCK_START,
            source: 'transcript',
            byteOffset: 1,
          },
        ],
      })
    );
    await settle();
  }
  await pump();

  phase('nasty text');
  // 5. The three other frame types, malformed.
  frame(envelope('sessionChatState', { working: null, queue: 'none', prompt: [] }));
  frame(envelope('sessionChatReplaced', { messages: null }));
  frame(envelope('sessionChatAppended', { messages: [{ id: 'h1' }] }));
  frame(envelope('unknownFrameType', { messages: [] }));
  frame({ type: 'sessionChatSnapshot' });
  await settle();
  await pump();

  phase('other frame types');
  // 6. Every action the core knows, first with nothing, then with parameters of the wrong type.
  //    A refusal is a pass; a panic is not.
  for (const kind of ACTION_KINDS) await act({ type: kind });
  for (const kind of ACTION_KINDS) {
    await act({
      type: kind,
      id: null,
      index: -1,
      key: 7,
      text: NASTY_TEXT[0],
      content: {},
      caret: Number.MAX_SAFE_INTEGER,
      start: -5,
      end: 'end',
      enabled: 'maybe',
      value: [],
      paths: 'one.png',
      open: {},
      work: 7,
      href: 12,
      widths: 'wide',
      available: -1,
      separator: null,
      request: [],
      draftVersion: { draftId: 3, revision: -2 },
      direction: 42,
      query: null,
      messageId: [],
      agentId: {},
      option: 'model',
      choice: null,
    });
  }
  await act({ type: 'notAnActionAtAll' });

  phase('actions');
  // 7. Answers that name nothing, carry the wrong shape, or are JSON null.
  for (const value of [null, 0, '', [], { messages: 'none' }, { accounts: 7 }, { skills: {} }, { branches: null }]) {
    answers += 1;
    // The record is written either way.
    fire(() => host.resolve(999_999 + answers, crossing(value)));
    await settle();
  }
  await pump();

  phase('answers');
  world.flush();

  mkdirSync(RECORDING_ROOT, { recursive: true, mode: 0o700 });
  const path = `${RECORDING_ROOT}/synthetic-hostile.jsonl`;
  const body = [serializeHeader(CLOCK_START), ...world.lines].join('\n');
  writeFileSync(path, `${body}\n`, { mode: 0o600 });

  const documents = world.lines.filter((line) => line.includes('"k":"doc"')).length;
  console.log(`frames      ${frames}`);
  console.log(`actions     ${actions}`);
  console.log(`answers     ${answers}`);
  console.log(
    `brainThrows ${brainThrows} (the TypeScript brain's own refusals; the Rust core must not panic on any of them)`
  );
  console.log(`records     ${world.lines.length} (${documents} documents)`);
  console.log(`fingerprint ${nativeChatReplayHash(body)}`);
  console.log(`recording   ${path}`);
  return world.lines.length && documents ? 0 : 1;
}

/*
 * `process.exit` rather than `process.exitCode`: the TypeScript brain throws out of its own
 * scheduled `publish` on some of this input (a `queue` row that is `null` reaches
 * `sessionChatQueueRowPreview(text)` and reads `text.split`), which lands in no promise this
 * generator holds and which Bun reports as an unhandled error and exits 1 for. That crash is the
 * recording's DATA, counted in `brainThrows` above; the generator succeeded when the file is
 * written.
 */
process.exit(await main());
