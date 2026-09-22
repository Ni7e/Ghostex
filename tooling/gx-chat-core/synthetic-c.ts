/**
 * Writes family c's own recording to `/tmp/gx-chat/synthetic-c.jsonl`.
 *
 * Usage: `bun tooling/gx-chat-core/synthetic-c.ts`
 *
 * `synthetic-recording.ts` walks the transcript and the composer; it touches a question card and
 * a notice once each and never opens the async question strip at all. This one is the questions,
 * approvals and notices family's edge cases, the ones the port has to get right and the shared
 * recording does not reach: a multi-question set stepped forwards and backwards, a free-text
 * answer, a multi-select question that stays put while it is picked in, a cancelled card, the
 * async strip navigated, typed in, answered and skipped, and notices answered through their
 * primary and secondary buttons, dismissed, and re-detected after the dismissal.
 *
 * Like the shared recording it is built from the Chat Lab fixtures
 * (`packages/shared/session-chat-preview/`), so it holds no user data, it can be regenerated
 * anywhere, and two generations produce the same bytes: the clock advances a fixed step per call,
 * the random source is seeded and the ids are a counter.
 *
 * The Chat Lab's answer table stands in for gxserver, but NOT for the desktop host's own
 * question and notice storage: `ChatPreviewBackend` keeps one unkeyed bag of answers and returns
 * `true` from `dismissNotice`, while the shipped host
 * (`apps/desktop/sidebar/session-chat-runtime/native-composer.ts`) keys drafts by prompt and
 * answers with the dismissal record. Gating a port against the double's shortcuts would grade the
 * wrong thing, so those six operations are answered here the way the shipped host answers them.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

import { ChatPreviewBackend } from '@/packages/shared/session-chat-preview/backend';
import { DEFAULT_CHAT_PREVIEW } from '@/packages/shared/session-chat-preview/fixture';
import {
  previewRow,
  previewStamp,
  previewTextRow,
  PREVIEW_START_MS,
} from '@/packages/shared/session-chat-preview/message';
import type {
  GxserverReadSessionChatResult,
  SessionChatMessage,
  SessionChatTerminalNotice,
} from '@/packages/shared/session-chat';
import {
  nativeChatReplayHash,
  type NativeChatReplayDriver,
  type NativeChatReplayKind,
} from '@/packages/shared/session-chat-controller/native-host-replay';
import { dismissedNoticeState } from '@/packages/shared/session-chat-controller/notice-state';
import { remainingQuestionDrafts, type AnswerDrafts } from '@/packages/shared/session-chat-controller/question-drafts';
import { loadChatBrain, settle } from './brain';
import { composerAnswer, RECORDING_ROOT, serializeHeader, serializeRecord, type ReplayRecord } from './recording';

const CLOCK_START = PREVIEW_START_MS;
/** How far the invented clock moves between two calls, enough for the rules' short timers. */
const CLOCK_STEP_MS = 25;
const PROJECT_ID = 'gx-questions-project';
const SESSION_ID = 'gx-questions-session';

/* -------------------------------------------------------------------------- the invented world */

/** The same recorder the shared synthetic recording uses: no clock, no entropy, no file system. */
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

/* ------------------------------------------------------------- the shipped host's own storage */

/**
 * What `nativeComposerRequest` does for the six operations family c uses, without client storage.
 *
 * Question drafts are keyed by the prompt they belong to, a clear keeps an answer that was edited
 * after the send, an empty record is deleted rather than stored, retired async questions are a
 * first-seen-ordered set capped at the newest 1000, and a dismissal answers with the record it
 * wrote.
 */
class HostQuestionStorage {
  private questionDrafts = new Map<string, AnswerDrafts>();
  private asyncDrafts: AnswerDrafts = {};
  private retired: string[] = [];

  handle(operation: string, params: Record<string, any>): unknown {
    switch (operation) {
      case 'questionRead':
        return this.questionDrafts.get(String(params.promptKey)) ?? {};
      case 'questionWrite': {
        const drafts: AnswerDrafts = params.answers ?? {};
        this.write(String(params.promptKey), drafts);
        return drafts;
      }
      case 'questionClear': {
        const key = String(params.promptKey);
        const drafts = remainingQuestionDrafts(this.questionDrafts.get(key) ?? {}, params.answers ?? {});
        this.write(key, drafts);
        return drafts;
      }
      case 'asyncQuestionRead':
        return { drafts: this.asyncDrafts, retired: [...this.retired] };
      case 'asyncQuestionWrite':
        this.asyncDrafts = params.answers ?? {};
        return true;
      case 'asyncQuestionRetire':
        this.asyncDrafts = remainingQuestionDrafts(this.asyncDrafts, params.answers ?? {});
        if (!this.retired.includes(String(params.questionId))) this.retired.push(String(params.questionId));
        this.retired = this.retired.slice(-1000);
        return true;
      case 'dismissNotice':
        return dismissedNoticeState(params.notice as SessionChatTerminalNotice);
      default:
        return undefined;
    }
  }

  private write(key: string, drafts: AnswerDrafts): void {
    if (Object.keys(drafts).length) this.questionDrafts.set(key, drafts);
    else this.questionDrafts.delete(key);
  }
}

/* ------------------------------------------------------------------------- the sample transcript */

/** The rows the recording starts from: an ordinary turn plus two unanswered async questions. */
function transcript(): SessionChatMessage[] {
  return [
    previewTextRow('c1', 'user', 10, 'Review the question card rules and tell me what you need.'),
    previewTextRow('c2', 'reasoning', 20, 'Two details are unclear, so ask them without stopping the run.'),
    previewRow('c3', 'assistant', 30, [{ type: 'text', text: 'Two questions while I keep going.' }], {
      asyncQuestions: [
        { title: 'Which renderer should own the collapsed layout?', options: ['Native', 'React', 'Both'] },
        { title: 'Should a skipped question still be retired?', options: ['Yes', 'No'] },
      ],
    }),
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
    agentSessionId: 'gx-questions',
    screenProbed: true,
    working: false,
    selectedOptions: {
      detectedAt: previewStamp(0),
      model: { value: 'gpt-5', label: 'GPT 5' },
      effort: { value: 'high', label: 'High' },
    },
    queue: [],
  };
}

/** A three-question set: one of N, free text, and many of N. */
function questionSet() {
  return {
    kind: 'question' as const,
    questions: [
      {
        question: 'Which surface should we compare first?',
        header: 'Step 1',
        multiSelect: false,
        options: [
          { label: 'Question card', description: 'The blocking card above the composer.' },
          { label: 'Async strip', description: 'The questions a working agent collects.' },
          { label: 'Notices', description: 'The terminal state cards.' },
        ],
      },
      {
        question: 'Anything else the comparison should cover?',
        header: 'Step 2',
        multiSelect: false,
        options: [],
      },
      {
        question: 'Which renderers must match?',
        header: 'Step 3',
        multiSelect: true,
        options: [{ label: 'Native' }, { label: 'React' }, { label: 'Web' }],
      },
    ],
  };
}

/** A notice with an answerable picker whose labels carry the terminal's own key hints. */
function pickerNotice(seconds: number): SessionChatTerminalNotice {
  return {
    kind: 'resumePrompt',
    severity: 'warning',
    source: 'screen',
    detectedAt: previewStamp(seconds),
    title: 'Codex is asking how to resume.',
    detail: 'The agent is waiting on its own picker before it reads anything new.',
    choices: [
      { index: 0, label: 'Resume from summary (recommended)', selected: true },
      { index: 1, label: 'Resume full session as-is (default) (y)', selected: false },
      { index: 2, label: '   ', selected: false },
    ],
    screenTail: '> Resume from summary',
  };
}

/* ----------------------------------------------------------------------------------- the script */

interface Step {
  /** A short label for the report; it never names a record's contents. */
  label: string;
  run(): Promise<void> | void;
}

async function main(): Promise<number> {
  const world = new SyntheticWorld();
  const host = await loadChatBrain(world);
  const storage = new HostQuestionStorage();

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
        serverId: 'gx-questions',
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
        const composer = (request.params.composer ?? {}) as Record<string, any> & { operation: string };
        const { operation, ...rest } = composer;
        const mine = await world.outside(() => storage.handle(operation, rest));
        value = mine === undefined ? await world.outside(() => composerAnswer(backend, operation, rest)) : mine;
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

  const steps: Step[] = [
    {
      label: 'boot with two async questions open',
      run: async () => {
        host.start({ clientId: 'gx-questions-client', projectId: PROJECT_ID });
        await settle();
        await pump();
      },
    },
    {
      label: 'the async strip: navigate, type, pick, send',
      run: async () => {
        await act({ type: 'asyncQuestionNavigate', direction: 'next' });
        await act({ type: 'asyncQuestionNavigate', direction: 'previous' });
        await act({ type: 'asyncQuestionText', key: 'c3:0', text: '  ' });
        await act({ type: 'asyncQuestionText', key: 'c3:0', text: 'Native owns it, React follows.' });
        await act({ type: 'asyncQuestionOption', key: 'c3:0', index: 2 });
        // Out of range: the strip must ignore it rather than answer with nothing.
        await act({ type: 'asyncQuestionOption', key: 'c3:0', index: 9 });
        await act({ type: 'asyncQuestionToggle' });
        await act({ type: 'asyncQuestionToggle' });
        await act({ type: 'asyncQuestionSend' });
        await publish();
        await pump();
      },
    },
    {
      label: 'the async strip: skip the second question',
      run: async () => {
        await act({ type: 'asyncQuestionSkip' });
        await publish();
        await pump();
      },
    },
    {
      label: 'a three-question set stepped forwards and backwards',
      run: async () => {
        backend.snapshot.prompt = questionSet();
        await publish();
        await pump();
        // One of N: picking moves the card on by itself.
        await act({ type: 'questionOption', index: 1 });
        await act({ type: 'questionText', text: 'Compare the collapsed layouts too.' });
        await act({ type: 'questionBack' });
        await act({ type: 'questionBack' });
        await act({ type: 'questionNext' });
        await act({ type: 'questionNext' });
        // Many of N: picking keeps the card where it is, and picking again unpicks.
        await act({ type: 'questionOption', index: 2 });
        await act({ type: 'questionOption', index: 0 });
        await act({ type: 'questionOption', index: 2 });
        // Out of range, and then the send.
        await act({ type: 'questionOption', index: 7 });
        await act({ type: 'questionNext' });
        backend.snapshot.prompt = undefined;
        await publish();
        await pump();
      },
    },
    {
      label: 'a question set cancelled',
      run: async () => {
        backend.snapshot.prompt = {
          kind: 'question',
          questions: [
            {
              question: 'Should the cancelled answers be kept?',
              multiSelect: false,
              options: [{ label: 'Keep' }, { label: 'Drop' }],
            },
          ],
        };
        await publish();
        await pump();
        await act({ type: 'questionText', text: 'Keep them until the card is answered.' });
        await act({ type: 'questionCancel' });
        backend.snapshot.prompt = undefined;
        await publish();
        await pump();
      },
    },
    {
      label: 'a notice answered through its primary button',
      run: async () => {
        backend.snapshot.terminalNotice = pickerNotice(120);
        await publish();
        await pump();
        await act({ type: 'noticePrimary' });
        await publish();
        await pump();
      },
    },
    {
      label: 'a notice answered through its secondary button',
      run: async () => {
        backend.snapshot.terminalNotice = pickerNotice(180);
        await publish();
        await pump();
        await act({ type: 'noticeSecondary' });
        await publish();
        await pump();
      },
    },
    {
      label: 'a picker answer refused because the row moved',
      run: async () => {
        backend.snapshot.terminalNotice = pickerNotice(200);
        await publish();
        await pump();
        // The agent's own picker moved between the detection and the answer, which is the race
        // gxserver refuses rather than confirming whatever replaced the row. The brain still
        // holds the published notice, so it answers for a row the server no longer offers.
        backend.snapshot.terminalNotice = {
          ...backend.snapshot.terminalNotice,
          choices: [{ index: 7, label: 'Something else entirely', selected: true }],
        };
        await act({ type: 'noticePrimary' });
        backend.snapshot.terminalNotice = undefined;
        await publish();
        await pump();
      },
    },
    {
      label: 'a notice dismissed, then detected again',
      run: async () => {
        backend.snapshot.terminalNotice = {
          kind: 'usageLimit',
          severity: 'warning',
          source: 'screen',
          detectedAt: previewStamp(240),
          title: 'Codex has reached its usage limit.',
          detail: 'The limit resets later today. Nothing was lost.',
          screenTail: 'usage limit reached',
        };
        await publish();
        await pump();
        await act({ type: 'dismissNotice' });
        await publish();
        await pump();
        // The same words under a later detection stay hidden for the cooldown.
        backend.snapshot.terminalNotice = {
          ...backend.snapshot.terminalNotice!,
          detectedAt: previewStamp(300),
        };
        await publish();
        await pump();
      },
    },
    {
      label: 'a notice with nothing to answer',
      run: async () => {
        backend.snapshot.terminalNotice = {
          kind: 'agentExited',
          severity: 'error',
          source: 'watchdog',
          detectedAt: previewStamp(360),
          title: 'Codex exited.',
          detail: 'The agent is no longer running in this pane.',
          actions: [{ id: 'open', label: 'Open terminal', kind: 'switchToTerminal' }],
        };
        await publish();
        await pump();
        await act({ type: 'noticePrimary' });
        await act({ type: 'noticeSecondary' });
        await pump();
      },
    },
  ];

  for (const step of steps) await step.run();
  await pump();
  world.flush();

  mkdirSync(RECORDING_ROOT, { recursive: true, mode: 0o700 });
  const path = `${RECORDING_ROOT}/synthetic-c.jsonl`;
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
