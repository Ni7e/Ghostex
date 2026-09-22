/**
 * Writes the send path's own recording to `/tmp/gx-chat/synthetic-send.jsonl`.
 *
 * Usage: `bun tooling/gx-chat-core/synthetic-send.ts`
 *
 * `synthetic-recording.ts` queues exactly one prompt and sends nothing; neither of the other two
 * recordings touches the composer's delivery at all. This one is the send family's ground: a plain
 * send, a send refused by gxserver and put back, a slash command that leaves a "Ran /x" marker, a
 * compact, prompts queued while the agent is working, the queue reordered, a row removed, a row
 * sent now, a row retried after an error, a startup send arriving on the queue, Escape while a turn
 * is running, an option whose delivery types a command into the agent, an option the daemon
 * swallows, a draft handed to the terminal, and a draft arriving from another client.
 *
 * Like the other two it is built from the Chat Lab fixtures
 * (`packages/shared/session-chat-preview/`), so it holds no user data, it can be regenerated
 * anywhere, and two generations produce the same bytes: the clock advances a fixed step per call,
 * the random source is seeded and the ids are a counter.
 *
 * Two answer tables stand behind it. `ChatPreviewBackend` is gxserver, except for the two calls it
 * does not model (`acknowledgeSessionChatDraftHandoff`, and one deliberately refused send). The
 * draft operations are answered here rather than by the Chat Lab, because the double keeps one
 * entry with no revision rules where the shipped host
 * (`apps/desktop/sidebar/session-chat-runtime/native-composer.ts`) reuses a stored revision only
 * when the entry is neither submitted nor parked, and has no `park` or `receive` at all.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

import { ChatPreviewBackend } from '@/packages/shared/session-chat-preview/backend';
import { DEFAULT_CHAT_PREVIEW } from '@/packages/shared/session-chat-preview/fixture';
import { previewStamp, previewTextRow, PREVIEW_START_MS } from '@/packages/shared/session-chat-preview/message';
import type { GxserverReadSessionChatResult, SessionChatMessage } from '@/packages/shared/session-chat';
import type { SessionChatDraftVersion } from '@/packages/shared/session-chat-queue';
import {
  nativeChatReplayHash,
  type NativeChatReplayDriver,
  type NativeChatReplayKind,
} from '@/packages/shared/session-chat-controller/native-host-replay';
import { classifyDraftHandoff } from '@/packages/shared/session-chat-controller/draft-handoff';
import { loadChatBrain, settle } from './brain';
import { composerAnswer, RECORDING_ROOT, serializeHeader, serializeRecord, type ReplayRecord } from './recording';

const CLOCK_START = PREVIEW_START_MS;
/** How far the invented clock moves between two calls, enough for the rules' short timers. */
const CLOCK_STEP_MS = 25;
const PROJECT_ID = 'gx-send-project';
const SESSION_ID = 'gx-send-session';

/* -------------------------------------------------------------------------- the invented world */

/** The same recorder the other two synthetic recordings use: no clock, no entropy, no disk. */
class SyntheticWorld implements NativeChatReplayDriver {
  readonly lines: string[] = [];
  private open: ReplayRecord | null = null;
  private sequence = 0;
  private ms = CLOCK_START;
  private randomState = 0x2f6e2b1;
  private uuidCount = 0;
  private suspended = 0;

  /** Runs the generator's own work with its reads left out of the open record. */
  async outside<T>(work: () => Promise<T> | T): Promise<T> {
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
}

/* ---------------------------------------------------------------- the shipped host's draft store */

interface StoredEntry {
  text: string;
  updatedAt: number;
  version?: SessionChatDraftVersion;
  submitted?: boolean;
  parked?: boolean;
}

/**
 * What `nativeComposerRequest` does for the draft operations, without client storage.
 *
 * The version rule is load bearing and is the one the Chat Lab double does not have: a stored
 * revision is reused only when the entry is neither submitted nor parked, else a fresh one is
 * issued (`native-composer.ts`, with its CDXC note).
 */
class HostDraftStorage {
  private entry: StoredEntry | null = null;
  private sent: string[] = [];
  private revision = 0;

  constructor(private readonly now: () => number) {}

  private nextVersion(): SessionChatDraftVersion {
    this.revision += 1;
    return { draftId: `gx-send-draft-${this.revision}`, revision: 1 };
  }

  handle(operation: string, params: Record<string, any>): unknown {
    switch (operation) {
      // The catalog, the chat settings and the context preferences stay the Chat Lab's, because
      // they are not the draft store's; the caller merges this over that answer.
      case 'read': {
        const stored = this.entry;
        const version = stored?.version && !stored.submitted && !stored.parked ? stored.version : this.nextVersion();
        return {
          sessionKey: `${PROJECT_ID}:${SESSION_ID}`,
          clientId: 'gx-send-client',
          entry: { ...stored, version },
          nextVersion: this.nextVersion(),
          optionStates: {},
          modelOutboxes: {},
          dismissedNotice: null,
          summaryMode: false,
          verboseOverride: null,
        };
      }
      case 'write':
        this.entry = {
          text: String(params.text ?? ''),
          updatedAt: this.now(),
          version: params.version,
          submitted: params.submitted === true,
        };
        return this.entry;
      case 'flush':
        return true;
      case 'submitted': {
        const text = String(params.text ?? '');
        if (this.entry && this.entry.text === text) this.entry = null;
        this.sent.unshift(text);
        return { nextVersion: this.nextVersion() };
      }
      case 'park': {
        const entry = this.entry;
        if (
          !entry ||
          entry.text !== params.text ||
          entry.version?.draftId !== params.version?.draftId ||
          entry.version?.revision !== params.version?.revision
        )
          throw new Error('The draft changed during transfer. It has been kept in Chat.');
        this.entry = { ...entry, parked: true, submitted: false };
        return {
          handoffId: 'gx-send-handoff-out',
          content: entry.text,
          draftVersion: entry.version,
          nextVersion: this.nextVersion(),
        };
      }
      case 'receive': {
        const stored = this.entry;
        const version = params.version ?? this.nextVersion();
        const disposition = classifyDraftHandoff({
          current: String(params.current ?? ''),
          content: String(params.text ?? ''),
          version: params.version,
          stored: stored ?? undefined,
          parked: stored?.parked === true,
        });
        if (disposition === 'accept') this.entry = { text: String(params.text ?? ''), updatedAt: this.now(), version };
        return { disposition, entry: this.entry, version };
      }
      case 'history':
        return [...this.sent];
      default:
        return undefined;
    }
  }
}

/* ------------------------------------------------------------------------ the sample transcript */

function transcript(): SessionChatMessage[] {
  return [
    previewTextRow('d1', 'user', 10, 'Walk the composer through every way a prompt can leave it.'),
    previewTextRow('d2', 'assistant', 20, 'Ready. Send, queue, reorder, interrupt, hand off.'),
  ];
}

function baseSnapshot(): GxserverReadSessionChatResult {
  return {
    messages: transcript(),
    hasMore: false,
    beforeOffset: 0,
    epoch: 1,
    seq: 1,
    status: 'ready',
    agent: 'codex',
    sessionAgentId: 'codex',
    agentSessionId: 'gx-send',
    screenProbed: true,
    working: false,
    selectedOptions: {
      detectedAt: previewStamp(0),
      model: { value: 'gpt-5', label: 'GPT 5' },
      effort: { value: 'high', label: 'High' },
    },
    // Present and empty: that is the daemon's queue capability probe.
    queue: [],
  };
}

/* ---------------------------------------------------------------------------------- the script */

interface Step {
  /** A short label for the report; it never names a record's contents. */
  label: string;
  run(): Promise<void> | void;
}

async function main(): Promise<number> {
  const world = new SyntheticWorld();
  const host = await loadChatBrain(world);
  const drafts = new HostDraftStorage(() => Date.now());

  const backend = new ChatPreviewBackend({ ...DEFAULT_CHAT_PREVIEW, scenario: 'conversation' });
  backend.snapshot = baseSnapshot();

  let revision = 0;
  let subscribed = false;
  /** Refuses the next send, so the composer's put-back path is on the record. */
  let refuseNextSend = false;

  const crossing = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T;

  const publish = async (): Promise<void> => {
    if (!subscribed) return;
    backend.snapshot.seq += 1;
    host.event(
      crossing({
        ...backend.snapshot,
        type: 'sessionChatSnapshot',
        protocolVersion: 1,
        serverId: 'gx-send',
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
      })
    );
    await settle();
  };

  interface HostRequest {
    id?: number;
    kind: string;
    method: string;
    params: Record<string, unknown>;
  }

  /** The two gxserver calls the Chat Lab does not model, plus the one deliberate refusal. */
  const rpc = async (method: string, params: any): Promise<unknown> => {
    if (method === 'acknowledgeSessionChatDraftHandoff') return { acknowledged: true };
    if (method === 'sendSessionChatMessage' && refuseNextSend) {
      refuseNextSend = false;
      throw new Error('The agent is not accepting input right now.');
    }
    return backend.rpc(method, params);
  };

  const answer = async (request: HostRequest): Promise<void> => {
    if (request.kind === 'broker' && request.method === 'subscribe') {
      subscribed = true;
      await publish();
      return;
    }
    if (request.kind === 'broker' && request.method === 'unsubscribe') {
      subscribed = false;
      return;
    }
    if (request.id === undefined) return;
    try {
      let value: unknown;
      if (request.kind === 'rpc') value = await world.outside(() => rpc(request.method, request.params));
      else if (request.method === 'composer') {
        const composer = (request.params.composer ?? {}) as Record<string, any> & { operation: string };
        const { operation, ...rest } = composer;
        const mine = await world.outside(() => drafts.handle(operation, rest));
        const theirs =
          mine === undefined || operation === 'read'
            ? await world.outside(() => composerAnswer(backend, operation, rest))
            : undefined;
        value =
          mine === undefined ? theirs : operation === 'read' ? { ...(theirs as object), ...(mine as object) } : mine;
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

  const pump = async (rounds = 24): Promise<void> => {
    let quiet = 0;
    for (let round = 0; round < rounds; round += 1) {
      host.tick();
      await settle();
      const document = host.take(revision);
      await settle();
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

  const act = async (command: Record<string, unknown>): Promise<void> => {
    void Promise.resolve(host.action(command)).catch(() => {
      // A refused action is part of the recording; the rules report it through the document.
    });
    await settle();
    await pump();
  };

  /** The queue as gxserver currently holds it, for the row ids the mutations name. */
  const queueIds = (): string[] => (backend.snapshot.queue ?? []).map((row) => row.id);

  const working = async (value: boolean): Promise<void> => {
    backend.snapshot.working = value;
    await publish();
    await pump();
  };

  const version = (revision: number): SessionChatDraftVersion => ({ draftId: 'gx-send-draft', revision });

  const steps: Step[] = [
    {
      label: 'boot',
      run: async () => {
        host.start({ clientId: 'gx-send-client', projectId: PROJECT_ID });
        await settle();
        await pump();
      },
    },
    {
      label: 'a plain send',
      run: async () => {
        await act({ type: 'editDraft', text: 'Compare the composer rules next.' });
        await act({ type: 'send', text: 'Compare the composer rules next.', draftVersion: version(1) });
      },
    },
    {
      label: 'a send the agent refuses, and the text put back',
      run: async () => {
        refuseNextSend = true;
        await act({ type: 'send', text: 'This one does not leave.', draftVersion: version(2) });
        await act({ type: 'restoreSubmission', text: 'This one does not leave.', current: '' });
      },
    },
    {
      label: 'a slash command and a compact',
      run: async () => {
        await act({ type: 'send', text: '/clear', draftVersion: version(3) });
        await act({ type: 'compact', text: 'Keep the transcript rules in mind.', draftVersion: version(4) });
      },
    },
    {
      label: 'queue three prompts while the agent works, then reorder and remove',
      run: async () => {
        await working(true);
        await act({ type: 'queue', text: 'First queued prompt.', draftVersion: version(5) });
        await act({ type: 'queue', text: 'Second queued prompt.', draftVersion: version(6) });
        await act({ type: 'queue', text: 'Third queued prompt.', draftVersion: version(7) });
        const ids = queueIds();
        if (ids.length >= 3) {
          await act({ type: 'moveQueue', promptId: ids[2], targetId: ids[0] });
          await act({ type: 'reorderQueue', promptIds: [ids[1], ids[0], ids[2]] });
          await act({ type: 'retryQueue', promptId: ids[1] });
          await act({ type: 'removeQueue', promptId: ids[1] });
        }
      },
    },
    {
      label: 'Escape while the turn runs',
      run: async () => {
        await act({ type: 'interrupt' });
        await working(false);
      },
    },
    {
      label: 'send a queued row now',
      run: async () => {
        const ids = queueIds();
        if (ids.length) await act({ type: 'sendQueue', promptId: ids[0] });
      },
    },
    {
      label: 'a startup send arrives on the queue',
      run: async () => {
        const stamp = previewStamp(300);
        backend.snapshot.queue = [
          ...(backend.snapshot.queue ?? []),
          {
            id: 'queued-startup',
            text: 'The prompt the session started with.',
            state: 'queued',
            createdAt: stamp,
            updatedAt: stamp,
            startupSend: true,
          } as any,
        ];
        await publish();
        await pump();
      },
    },
    {
      label: 'an option that types a command, and one the daemon swallows',
      run: async () => {
        await act({ type: 'selectOption', descriptorId: 'effort', value: 'medium' });
        await act({ type: 'selectOption', descriptorId: 'fastMode', value: 'on' });
      },
    },
    {
      label: 'hand the draft to the terminal, then receive one back',
      run: async () => {
        await act({ type: 'editDraft', text: 'Take this to the terminal.' });
        await act({ type: 'handoff', text: 'Take this to the terminal.', draftVersion: version(8) });
        await act({
          type: 'receiveHandoff',
          handoffId: 'gx-send-handoff-in',
          content: 'And bring this one back.',
          current: '',
          draftVersion: version(9),
        });
        // The same transfer twice is a no-op: the second one must not re-apply it.
        await act({
          type: 'receiveHandoff',
          handoffId: 'gx-send-handoff-in',
          content: 'And bring this one back.',
          current: '',
          draftVersion: version(9),
        });
        // A transfer that would overwrite text typed after the switch is offered, not taken.
        await act({ type: 'editDraft', text: 'Typed here in the meantime.' });
        await act({
          type: 'receiveHandoff',
          handoffId: 'gx-send-handoff-conflict',
          content: 'A different draft entirely.',
          current: 'Typed here in the meantime.',
          draftVersion: version(10),
        });
        await act({ type: 'useIncomingDraft' });
      },
    },
    {
      /*
      Up-arrow recall, which only has anything to walk once prompts have been sent. The ring is
      read LAZILY, on the first Up with no entry showing (`native-host.ts:1209`), and the arm
      awaits that read; `ComposerHistory::entries` had no writer at all until 2026-09-22, so this
      is what grades the read, the recall state machine and `historyActive`.
      */
      label: 'up-arrow recall: up, up, down, an edit that drops out of it, and down again',
      run: async () => {
        await act({ type: 'editDraft', text: '' });
        await act({ type: 'recallHistory', direction: 'up' });
        await act({ type: 'recallHistory', direction: 'up' });
        await act({ type: 'recallHistory', direction: 'down' });
        // Any manual edit resets the cursor and keeps the ring, so the next Up re-reads it.
        await act({ type: 'editDraft', text: 'typed over the recalled prompt' });
        await act({ type: 'recallHistory', direction: 'up' });
        // Walking forward past the newest entry leaves a blank composer rather than an entry.
        await act({ type: 'recallHistory', direction: 'down' });
        // And a Down with nothing showing is a no-op, not a read.
        await act({ type: 'recallHistory', direction: 'down' });
      },
    },
  ];

  for (const step of steps) await step.run();
  // One last document, so the recording ends on a published state rather than an input.
  await pump();
  world.flush();

  mkdirSync(RECORDING_ROOT, { recursive: true, mode: 0o700 });
  const path = `${RECORDING_ROOT}/synthetic-send.jsonl`;
  const body = [serializeHeader(CLOCK_START), ...world.lines].join('\n');
  writeFileSync(path, `${body}\n`, { mode: 0o600 });

  const documents = world.lines.filter((line) => line.includes('"k":"doc"')).length;
  console.log(`steps       ${steps.length}`);
  console.log(`records     ${world.lines.length} (${documents} documents)`);
  console.log(`fingerprint ${nativeChatReplayHash(body)}`);
  console.log(`recording   ${path}`);
  return world.lines.length && documents ? 0 : 1;
}

process.exitCode = await main();
