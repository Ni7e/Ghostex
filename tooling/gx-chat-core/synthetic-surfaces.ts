/**
 * The surfaces no other recording opens, written to `/tmp/gx-chat/synthetic-surfaces.jsonl`.
 *
 * Usage: `bun tooling/gx-chat-core/synthetic-surfaces.ts`, then
 * `bun tooling/gx-chat-core/replay-typescript.ts /tmp/gx-chat/synthetic-surfaces.jsonl`.
 *
 * `bun tooling/gx-chat-core/coverage.ts` reports which of the core's 120 user actions, four frame
 * types and seven broker kinds the recordings reach. Before this file the answer was 33 actions,
 * one frame type and one broker kind: a whole family's rules were graded by nothing at all. This
 * walks the rest, in the order a person would:
 *
 * - the history scenario, whose sample has more than one page and a fork family, so `loadEarlier`,
 *   `selectForkBranch` and the subagent viewer all have something to read;
 * - the panels, transcript search, the terminal tail and the open-row list, which are the four
 *   sub-controllers plus `rowDetails`: pure view state, published on the spot;
 * - the composer's own gestures: the wheel, the expand, the measurements, history recall, the
 *   slash and `@` suggestions, attachments, the session note, and a raw key send;
 * - the model picker window and the model pill's menu, including a favorite and a trait;
 * - the context editor, its query, its stars and its reorder;
 * - the transcript's per-message actions: an image read, a Markdown link, Save to Markdown,
 *   Save prompt, rewind, and a completed turn's deferred work;
 * - the three frame types the other recordings never send (`sessionChatAppended`,
 *   `sessionChatState` and `sessionChatReplaced`) and the three broker kinds that carry settings;
 * - `retry` and `refresh` on a session the server has reported an error for.
 *
 * Like every recording here the world is scripted rather than sampled: a fixed clock step per
 * call, a seeded random source and counted ids, so two generations produce the same bytes and the
 * file holds no user data.
 *
 * Several of these gestures reach an endpoint `ChatPreviewBackend` does not answer (the session
 * note, the stash, the rewind, the terminal tail). That is deliberate: the refusal path is a rule
 * of its own and both brains have to take it the same way.
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
import { readSessionChatContextDetailsPreferences } from '@/packages/shared/session-chat-presentation/context-details';
import BUNDLED_MODEL_CATALOG from '@/agent-model-catalog.json';
import { loadChatBrain, settle } from './brain';
import { RECORDING_ROOT, serializeHeader, serializeRecord, type ReplayRecord } from './recording';

const CLOCK_START = PREVIEW_START_MS;
const CLOCK_STEP_MS = 25;
const PROJECT_ID = 'gx-synthetic-surfaces-project';
const SESSION_ID = 'gx-synthetic-surfaces-session';

/** Records every call the way the app's recorder does, from a world with no clock and no entropy. */
class SyntheticWorld implements NativeChatReplayDriver {
  readonly lines: string[] = [];
  private open: ReplayRecord | null = null;
  private sequence = 0;
  private ms = CLOCK_START;
  private randomState = 0x51f3a7d;
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

interface HostRequest {
  id?: number;
  kind: string;
  method: string;
  params: Record<string, unknown>;
}

interface Step {
  label: string;
  run(): Promise<void> | void;
}

async function main(): Promise<number> {
  const world = new SyntheticWorld();
  const host = await loadChatBrain(world);

  // The history scenario is the only sample with more than one page and a fork family.
  const backend = new ChatPreviewBackend({ ...DEFAULT_CHAT_PREVIEW, scenario: 'history' });

  let revision = 0;
  let subscribed = false;

  const crossing = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T;

  /** One frame of any of the four types, stamped from the invented clock. */
  const frame = async (type: string, body: Record<string, unknown>): Promise<void> => {
    if (!subscribed) return;
    backend.snapshot.seq += 1;
    host.event(
      crossing({
        type,
        protocolVersion: 1,
        serverId: 'gx-synthetic-surfaces',
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
        epoch: backend.snapshot.epoch,
        seq: backend.snapshot.seq,
        ...body,
      })
    );
    await settle();
  };

  const publish = async (): Promise<void> => {
    await frame('sessionChatSnapshot', backend.snapshot as unknown as Record<string, unknown>);
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

  /** One gesture plus the round trips it starts. */
  const act = async (command: Record<string, unknown>): Promise<void> => {
    host.action(crossing(command));
    await settle();
    await pump();
  };

  /** The id of the first user row, which is what the per-message actions name. */
  const firstUserId = (): string =>
    (backend.snapshot.messages.find((message) => message.role === 'user')?.id ?? '1') as string;

  const steps: Step[] = [
    {
      label: 'boot the multi-page history sample',
      run: async () => {
        host.start({ clientId: 'gx-synthetic-surfaces-client', projectId: PROJECT_ID });
        await settle();
        await pump();
      },
    },
    {
      label: 'the three settings channels the app runtime pushes',
      run: async () => {
        host.brokerMessage({
          kind: 'chatSettings',
          settings: { title: 'Surfaces', hideAccountEmails: false },
        });
        await settle();
        host.brokerMessage({
          kind: 'contextPreferences',
          preferences: {
            claude: readSessionChatContextDetailsPreferences('claude'),
            codex: readSessionChatContextDetailsPreferences('codex'),
          },
        });
        await settle();
        // The same bundled table the core reads with `include_str!`, so the two brains adopt the
        // identical catalog rather than one the double invented.
        host.brokerMessage({ kind: 'catalog', catalog: BUNDLED_MODEL_CATALOG });
        await settle();
        await pump();
      },
    },
    {
      label: 'the four sub-controllers and the open-row list',
      run: async () => {
        await act({ type: 'toggleAgentFleet' });
        await act({ type: 'toggleAgentTasks' });
        await act({ type: 'toggleAgentTasksCompleted' });
        await act({ type: 'terminalTailHover', hovering: true });
        await act({ type: 'terminalTailToggle' });
        await act({ type: 'terminalTailHover', hovering: false });
        await act({ type: 'rowDetails', open: [{ key: 'row-0', kind: 'tool', messageId: firstUserId(), index: 0 }] });
        await act({ type: 'rowDetails', open: [] });
      },
    },
    {
      label: 'transcript search, opened, typed into, stepped through and closed',
      run: async () => {
        await act({ type: 'searchOpen' });
        await act({ type: 'searchQuery', query: 'the' });
        await act({ type: 'searchNext' });
        await act({ type: 'searchNext' });
        await act({ type: 'searchPrevious' });
        await act({ type: 'searchQuery', query: '' });
        await act({ type: 'searchClose' });
      },
    },
    {
      label: 'the composer wheel, the expand, and the two measurements',
      run: async () => {
        await act({
          type: 'measureComposer',
          measurements: {
            available: 360,
            options: 120,
            actions: 200,
            footerGap: 8,
            clearance: 12,
            actionGap: 6,
            hasOverflowOptions: true,
            controls: [
              { id: 'attach', width: 40 },
              { id: 'stash', width: 40 },
              { id: 'note', width: 40 },
            ],
          },
        });
        await act({
          type: 'composerScroll',
          delta: -140,
          distanceToEnd: 400,
          eligible: true,
          canScroll: true,
        });
        await act({ type: 'composerExpand', editor: true });
        await act({
          type: 'measureContextStatus',
          widths: [120, 140, 110],
          available: 260,
          separator: 12,
        });
      },
    },
    {
      label: 'typing, the slash picker, the @ picker and history recall',
      run: async () => {
        await act({ type: 'editDraft', text: 'Look at ', draftVersion: null });
        await act({ type: 'composerSelection', text: 'Look at ', caret: 8 });
        await act({ type: 'editDraft', text: 'Look at @', draftVersion: null });
        await act({ type: 'suggestionHighlight', index: 0 });
        await act({ type: 'suggestionKey', key: 'down' });
        await act({ type: 'suggestionDismiss' });
        await act({ type: 'editDraft', text: '/', draftVersion: null });
        await act({ type: 'suggestionRetry' });
        await act({ type: 'suggestionPick', index: 0 });
        await act({ type: 'completeComposerCommand' });
        await act({ type: 'editDraft', text: '', draftVersion: null });
        await act({ type: 'recallHistory', direction: 'up' });
        await act({ type: 'recallHistory', direction: 'down' });
        await act({ type: 'appendToDraft', text: ' and this too', draft: '' });
        await act({ type: 'saveDraft', content: 'a saved draft', draftVersion: null });
        await act({ type: 'refreshComposerChrome' });
        await act({ type: 'openComposerReference', href: 'README.md#L12' });
      },
    },
    {
      label: 'attachments, picked and removed',
      run: async () => {
        await act({ type: 'attachmentsStarted' });
        await act({ type: 'attachPaths', paths: ['/sample/project/one.png'] });
        await act({ type: 'insertAttachments', paths: ['/sample/project/two.png'], text: '', start: 0, end: 0 });
        await act({ type: 'attachmentsFinished' });
        await act({ type: 'removeAttachment', text: '[Image #1](one.png)', start: 0, end: 19 });
      },
    },
    {
      label: 'the session note, which this backend refuses',
      run: async () => {
        await act({ type: 'toggleNote' });
        await act({ type: 'editNote', text: 'remember the flags' });
        await act({ type: 'saveNote' });
        await act({ type: 'clearNote' });
        await act({ type: 'toggleNote' });
      },
    },
    {
      label: 'the model picker window, opened, driven and cancelled',
      run: async () => {
        await act({ type: 'toggleModelPicker' });
        await act({ type: 'modelPickerMeasure', size: { width: 520, height: 320 } });
        await act({ type: 'modelPickerPane', size: { width: 260, height: 320 } });
        await act({
          type: 'modelPickerScroll',
          input: { deltaX: 0, deltaY: 40, height: 320, shiftKey: false, ctrlKey: false, metaKey: false, now: 10 },
        });
        await act({ type: 'modelPickerKey', key: { key: 'down', code: 'ArrowDown', shiftKey: false } });
        await act({ type: 'modelPickerKeyUp', key: 'down' });
        await act({ type: 'modelPickerControl', control: 'next' });
        await act({ type: 'modelPickerModel', index: 1, save: false, pointer: false });
        await act({ type: 'modelPickerEffort', index: 1, save: false });
        await act({ type: 'modelPickerCancel' });
        await act({ type: 'modelPickerBlur' });
      },
    },
    {
      label: 'the model pill menu, a favorite and a trait',
      run: async () => {
        await act({ type: 'modelMenuView', tab: 'claude' });
        await act({ type: 'modelMenuView', query: 'son' });
        await act({ type: 'modelMenuFavorite', key: 'claude:sonnet' });
        await act({ type: 'modelMenuPick', key: 'claude:sonnet', secondary: false });
        await act({ type: 'modelMenuTrait', trait: 'fast' });
        await act({ type: 'modelMenuView', tab: null, query: '' });
      },
    },
    {
      label: 'accounts, the fork family and a draft agent switch',
      run: async () => {
        await act({ type: 'accounts', request: { operation: 'session', refresh: true } });
        await act({ type: 'selectForkBranch', projectId: PROJECT_ID, sessionId: SESSION_ID });
        await act({ type: 'switchDraftAgent', agentId: 'codex' });
      },
    },
    {
      label: 'the context editor: opened, searched, starred, reordered, reset and saved',
      run: async () => {
        await act({ type: 'contextEdit' });
        await act({ type: 'contextQuery', query: 'token' });
        await act({ type: 'contextShown', id: 'totalInputTokens', shown: true });
        await act({ type: 'contextStar', id: 'totalInputTokens' });
        await act({ type: 'contextReorder', group: 'context', from: 'totalInputTokens', to: 'totalOutputTokens' });
        await act({ type: 'contextReset' });
        await act({ type: 'contextSave' });
        await act({ type: 'contextEdit' });
        await act({ type: 'contextCancel' });
        await act({ type: 'contextCompact' });
      },
    },
    {
      label: 'the transcript rails: an image, a link, Save to Markdown, Save prompt and rewind',
      run: async () => {
        await act({ type: 'loadImage', path: 'screenshot.png' });
        await act({ type: 'openMarkdownLink', href: 'https://example.invalid/docs', external: false });
        await act({ type: 'markdownSaveOpen', markdown: '# note' });
        await act({ type: 'markdownSaveFolder', value: 'notes' });
        await act({ type: 'markdownSaveName', value: 'surfaces' });
        await act({ type: 'markdownSaveSubmit' });
        await act({ type: 'markdownSaveOpen', markdown: '# note' });
        await act({ type: 'markdownSaveCancel' });
        await act({ type: 'savePrompt', messageId: firstUserId(), prompt: 'the first prompt' });
        await act({ type: 'rewindOpen', messageId: firstUserId(), prompt: 'the first prompt' });
        await act({ type: 'rewindSubmit' });
        await act({ type: 'rewindOpen', messageId: firstUserId(), prompt: 'the first prompt' });
        await act({ type: 'rewindCancel' });
      },
    },
    {
      label: 'the subagent viewer, opened, paged and closed',
      run: async () => {
        await act({ type: 'openSubagent', selector: 'explorer', name: '/explorer', agentType: 'explorer' });
        await act({ type: 'subagentLoadEarlier' });
        await act({ type: 'subagentRetry' });
        await act({ type: 'subagentBack' });
        await act({ type: 'openSubagent', selector: 'explorer', name: '/explorer', agentType: 'explorer' });
        await act({ type: 'subagentClose' });
      },
    },
    {
      label: 'pagination, a completed turn s work, and the summary modes',
      run: async () => {
        await act({ type: 'loadEarlier' });
        await act({ type: 'loadWork', id: firstUserId(), work: null });
        await act({ type: 'toggleSummary' });
        await act({ type: 'setVerbose', verbose: true });
        await act({ type: 'setVerbose', verbose: null });
        await act({ type: 'toggleSummary' });
      },
    },
    {
      label: 'the three frame types the other recordings never send',
      run: async () => {
        await frame('sessionChatAppended', {
          messages: [
            {
              id: 'surfaces-append-1',
              role: 'assistant',
              blocks: [{ type: 'text', text: 'One more line, appended.' }],
              timestamp: world.now,
              source: 'transcript',
            },
          ],
          status: 'ready',
        });
        await pump();
        await frame('sessionChatState', { status: 'working', working: true });
        await pump();
        await frame('sessionChatState', { status: 'ready', working: false });
        await pump();
        await frame('sessionChatReplaced', {
          messages: backend.snapshot.messages.slice(-4),
          hasMore: false,
          beforeOffset: 0,
          status: 'ready',
        });
        await pump();
      },
    },
    {
      label: 'a raw key, a stash and the two recovery gestures',
      run: async () => {
        await act({ type: 'sendKey', key: 'escape', marker: '' });
        await act({ type: 'stash', text: 'park this for later', draftVersion: null });
        await act({ type: 'restoreSubmission', text: 'came back', current: '' });
        await act({
          type: 'restoreReturned',
          returned: { id: 'surfaces-returned-1', text: 'the prompt the agent handed back' },
        });
        await act({ type: 'applyReturned', text: 'the prompt the agent handed back', current: '' });
        await act({ type: 'dismissIncomingDraft' });
      },
    },
    {
      label: 'an error, then retry and refresh',
      run: async () => {
        await frame('sessionChatState', { status: 'error', error: 'The session could not be read.' });
        await pump();
        await act({ type: 'retry' });
        await act({ type: 'refresh' });
      },
    },
  ];

  for (const step of steps) await step.run();
  await pump();
  world.flush();

  mkdirSync(RECORDING_ROOT, { recursive: true, mode: 0o700 });
  const path = `${RECORDING_ROOT}/synthetic-surfaces.jsonl`;
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
