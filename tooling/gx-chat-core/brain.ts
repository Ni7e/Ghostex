/**
 * Loads the real chat brain outside QuickJS.
 *
 * `packages/shared/session-chat-controller/native-host.ts` is the whole bundle the desktop app
 * runs: importing it defines `globalThis.nativeChat` and replaces the global timer functions
 * with the brain's own map, exactly as it does inside the engine. Nothing is reimplemented
 * here, and nothing is stubbed, so a difference the gate reports is a difference between the
 * shipped rules and the port.
 *
 * The import is deliberately dynamic and late: the timer swap has to happen after this module
 * has kept a reference to the real one, and the replay hooks have to be installed before
 * `start` so the boot is part of the run.
 */
import type { NativeChatReplayDriver } from '@/packages/shared/session-chat-controller/native-host-replay';

/** Captured before the brain replaces the globals, so the harness can still yield to the loop. */
const realSetTimeout = globalThis.setTimeout.bind(globalThis);

export interface ChatBrain {
  start(config: Record<string, unknown>): void;
  action(command: Record<string, unknown>): Promise<void> | void;
  brokerMessage(message: unknown): void;
  event(event: unknown): void;
  resolve(id: number, value: unknown, error?: { code?: string; message: string; endpoint: string }): void;
  tick(): void;
  take(lastRevision: number): string;
  replay(append: (line: string) => void): void;
  [method: string]: unknown;
}

/**
 * Imports the brain and routes its seam into `driver`. The engine installs `crypto` itself, so
 * a host that has none gets the one the runtime would have provided.
 */
export async function loadChatBrain(driver: NativeChatReplayDriver): Promise<ChatBrain> {
  const globals = globalThis as Record<string, unknown>;
  if (!globals.crypto) globals.crypto = { randomUUID: () => '00000000-0000-4000-8000-000000000000' };
  await import('@/packages/shared/session-chat-controller/native-host');
  const host = globals.nativeChat as ChatBrain | undefined;
  if (!host) throw new Error('The chat brain did not install its host object.');
  const { installNativeChatReplayHooks } = await import('@/packages/shared/session-chat-controller/native-host-replay');
  installNativeChatReplayHooks(driver);
  return host;
}

/**
 * Runs the promise jobs a call left behind, the way the engine's own job pump does between two
 * host calls. Chat work is promise work: the brain's timers are its own map and only `tick`
 * fires them, so a bounded number of microtask turns settles everything a call started.
 */
export async function settle(turns = 24): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) await Promise.resolve();
  await new Promise<void>((resolve) => realSetTimeout(resolve, 0));
  for (let turn = 0; turn < turns; turn += 1) await Promise.resolve();
}
