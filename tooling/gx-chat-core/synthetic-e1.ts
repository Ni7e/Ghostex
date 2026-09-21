/**
 * A second synthetic recording, for the parts of family e1 the first one never reaches.
 *
 * Usage: `bun tooling/gx-chat-core/synthetic-e1.ts`, then
 * `bun tooling/gx-chat-core/replay-typescript.ts /tmp/gx-chat/synthetic-e1.jsonl` and
 * `cargo run --example e1_check -- /tmp/gx-chat/synthetic-e1.jsonl` from `packages/gx-chat-core`.
 *
 * `synthetic-recording.ts` drives a Codex session with no draft agents, no account switch and
 * Hide emails off, which leaves five of family e1's rules unexercised. This one walks the other
 * side of each of them and nothing else:
 *
 * - the Claude option catalog (a `command` model and effort, the Shift+Tab permission-mode
 *   cycler, and the Fast toggle) instead of Codex's model-picker catalog,
 * - a draft session, so the model menu grows its Switch Agent CLI submenu,
 * - `pendingModelSelection` present, which is the daemon capability probe that turns
 *   `canPickModel` on and changes every menu row it gates,
 * - an account switch walked through `switching`, `resuming` and `success`, which is the whole
 *   switch card, its steps, its clock and its send hold,
 * - Hide emails on, which masks every account label the panel and the card print.
 *
 * Like the first recording, the world is scripted rather than sampled: a fixed clock step, a
 * seeded random source and counted ids, so two generations produce the same bytes. The account
 * switch is fed through the snapshot rather than through the preview backend's own
 * `switchAccount`, because that one walks its phases on real `setTimeout` and would not reproduce.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

import { ChatPreviewBackend } from '@/packages/shared/session-chat-preview/backend';
import { DEFAULT_CHAT_PREVIEW } from '@/packages/shared/session-chat-preview/fixture';
import { previewStamp, previewTextRow, PREVIEW_START_MS } from '@/packages/shared/session-chat-preview/message';
import type { GxserverReadSessionChatResult } from '@/packages/shared/session-chat';
import {
  nativeChatReplayHash,
  type NativeChatReplayDriver,
  type NativeChatReplayKind,
} from '@/packages/shared/session-chat-controller/native-host-replay';
import { loadChatBrain, settle } from './brain';
import { RECORDING_ROOT, serializeHeader, serializeRecord, type ReplayRecord } from './recording';

const CLOCK_START = PREVIEW_START_MS;
const CLOCK_STEP_MS = 25;
const PROJECT_ID = 'gx-synthetic-e1-project';
const SESSION_ID = 'gx-synthetic-e1-session';

/** Records every call the way the app's recorder does, from a world with no clock and no entropy. */
class SyntheticWorld implements NativeChatReplayDriver {
  readonly lines: string[] = [];
  private open: ReplayRecord | null = null;
  private sequence = 0;
  private ms = CLOCK_START;
  private randomState = 0x2f6e2b1;
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

  /** The invented clock, for the script's own stamps. */
  get now(): number {
    return this.ms;
  }
}

/** A short Claude conversation; the transcript is not what this recording is about. */
function baseSnapshot(): GxserverReadSessionChatResult {
  return {
    messages: [
      previewTextRow('e1', 'user', 10, 'Switch me to the other account when this one runs out.'),
      previewTextRow('e2', 'assistant', 20, 'Understood. I will keep going on whichever login is available.'),
    ],
    hasMore: false,
    beforeOffset: 0,
    epoch: 1,
    seq: 1,
    status: 'ready',
    agent: 'claude',
    sessionAgentId: 'claude-custom',
    agentSessionId: 'gx-synthetic-e1',
    screenProbed: true,
    working: false,
    // A draft session: the model pill grows its Switch Agent CLI submenu, and the option storage
    // key latches the draft's agent id.
    availableAgents: [
      { agentId: 'claude-custom', name: 'Reviewer', icon: 'claude', baseAgentId: 'claude' },
      { agentId: 'codex', name: 'Codex', icon: 'codex' },
    ],
    // Present, which is the daemon capability probe `canPickModel` reads.
    pendingModelSelection: null,
    selectedOptions: {
      detectedAt: previewStamp(0),
      model: { value: 'sonnet', label: 'Sonnet', source: 'terminal' },
      effort: { value: 'high', label: 'High', source: 'terminal' },
      mode: { value: 'plan', label: 'Plan', source: 'terminal' },
    },
    queue: [],
  } as GxserverReadSessionChatResult;
}

interface Step {
  label: string;
  run(): Promise<void> | void;
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

  const backend = new ChatPreviewBackend({ ...DEFAULT_CHAT_PREVIEW, scenario: 'conversation' });
  backend.snapshot = baseSnapshot();

  let revision = 0;
  let subscribed = false;

  const crossing = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T;

  const publish = async (): Promise<void> => {
    if (!subscribed) return;
    backend.snapshot.seq += 1;
    host.event(
      crossing({
        ...backend.snapshot,
        type: 'sessionChatSnapshot',
        protocolVersion: 1,
        serverId: 'gx-synthetic-e1',
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
      })
    );
    await settle();
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
      if (request.kind === 'rpc') value = await world.outside(() => backend.rpc(request.method, request.params));
      else if (request.method === 'composer') {
        const composer = (request.params.composer ?? {}) as Record<string, unknown> & { operation: string };
        const { operation, ...rest } = composer;
        value = await world.outside(() => backend.composer(operation, rest));
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

  /** One switch phase, stamped from the invented clock so the card's "recent" rule is exercised. */
  const switchPhase = async (phase: string, extra: Record<string, unknown> = {}): Promise<void> => {
    backend.snapshot.accountSwitch = {
      id: 'e1-switch-1',
      provider: 'claude',
      source: 'automatic',
      phase,
      fromAccountId: 'work',
      toAccountId: 'personal',
      updatedAt: new Date(world.now).toISOString(),
      ...extra,
    } as never;
    await publish();
    await pump();
  };

  const steps: Step[] = [
    {
      label: 'boot a draft Claude session',
      run: async () => {
        host.start({ clientId: 'gx-synthetic-e1-client', projectId: PROJECT_ID });
        await settle();
        await pump();
      },
    },
    {
      label: 'hide account emails',
      run: async () => {
        host.brokerMessage({
          kind: 'chatSettings',
          settings: { title: 'Sample conversation', hideAccountEmails: true },
        });
        await settle();
        await pump();
      },
    },
    {
      label: 'the agent starts working, which disables the rows the pills gate on it',
      run: async () => {
        backend.snapshot.working = true;
        await publish();
        await pump();
        backend.snapshot.working = false;
        await publish();
        await pump();
      },
    },
    {
      label: 'an automatic account switch, phase by phase',
      run: async () => {
        await switchPhase('switching');
        await switchPhase('resuming');
        await switchPhase('continuing');
        await switchPhase('success');
      },
    },
    {
      label: 'the agent reports a different model, which outranks the local values',
      run: async () => {
        backend.snapshot.selectedOptions = {
          detectedAt: new Date(world.now).toISOString(),
          model: { value: 'opus', label: 'Opus', source: 'terminal' },
          effort: { value: 'medium', label: 'Medium', source: 'terminal' },
          mode: { value: 'auto', label: 'Auto', source: 'statusline' },
          fast: true,
        } as never;
        await publish();
        await pump();
      },
    },
    {
      label: 'the draft is promoted, which drops the agent switcher and latches the storage key',
      run: async () => {
        delete (backend.snapshot as Record<string, unknown>).availableAgents;
        await publish();
        await pump();
      },
    },
  ];

  for (const step of steps) await step.run();
  await pump();
  world.flush();

  mkdirSync(RECORDING_ROOT, { recursive: true, mode: 0o700 });
  const path = `${RECORDING_ROOT}/synthetic-e1.jsonl`;
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
