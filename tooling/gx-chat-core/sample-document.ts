/**
 * Writes sample chat documents for the `packages/gx-chat-core` round-trip example.
 *
 * It boots the real QuickJS chat brain (`packages/shared/session-chat-controller/native-host.ts`)
 * under Bun against the built-in Chat Lab preview backend, so every document is the exact JSON the
 * desktop app draws from, built from the synthetic sample transcript in
 * `packages/shared/session-chat-preview/`. Nothing here reads a real session, so the output carries
 * no private data and is safe to inspect and to diff.
 *
 * Usage: `bun tooling/gx-chat-core/sample-document.ts [outputDirectory]`
 * Default output directory: `/tmp/gx-chat/samples`.
 */

/** Captured before the brain replaces the global with its own manual timer queue. */
const hostTimeout = globalThis.setTimeout.bind(globalThis);
const sleep = (ms: number) => new Promise((resolve) => hostTimeout(resolve, ms));

const SCENARIOS = [
  'conversation',
  'markdown',
  'working',
  'question',
  'approval',
  'queue',
  'tools',
  'files',
  'system',
  'rich-markdown',
  'agents',
  'empty',
] as const;

const outputDirectory = process.argv[2] ?? '/tmp/gx-chat/samples';

await import('@/packages/shared/session-chat-controller/native-host');
const host = (globalThis as { nativeChat?: NativeChatHost }).nativeChat;
if (!host) throw new Error('The chat brain did not install its nativeChat host.');

interface NativeChatHost {
  start: (config: Record<string, unknown>) => void;
  action: (command: Record<string, unknown>) => Promise<void>;
  tick: () => void;
  take: (lastRevision: number) => string;
}

/** Runs the brain's timer queue until it settles, so late reads and backfill batches land. */
async function settle(rounds = 60): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    host.tick();
    await sleep(2);
  }
}

const written: string[] = [];
for (const scenario of SCENARIOS) {
  host.start({
    clientId: 'sample-client',
    projectId: 'sample-project',
    preview: { scenario, theme: 'dark', zoom: 100, verbose: false, simple: false, revision: 1 },
  });
  await settle();
  const path = `${outputDirectory}/${scenario}.json`;
  await Bun.write(path, `${JSON.stringify(JSON.parse(host.take(-1)), null, 2)}\n`);
  written.push(path);
  // The other transcript mode ships different item kinds, so both are worth a sample.
  await host.action({ type: 'toggleSummary' });
  await settle(20);
  const alternate = `${outputDirectory}/${scenario}-alt.json`;
  await Bun.write(alternate, `${JSON.stringify(JSON.parse(host.take(-1)), null, 2)}\n`);
  written.push(alternate);
}

for (const path of written) console.log(path);
