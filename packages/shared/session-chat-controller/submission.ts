import type { SessionChatDraftVersion } from '../session-chat-queue';
import { GxserverRpcError } from '../gxserver-rpc-error';

export type ChatSubmissionMode = 'send' | 'queue' | 'compact';

/** CDXC:Drafts 2026-09-17 DECISION:
 * User: preserve unsent messages and retire sent drafts by identity and revision, including older copies containing deleted text.
 * Await the submitted revision before delivery; typing after submission belongs to a new identity.
 */
export async function deliverChatSubmission(options: {
  text: string;
  version?: SessionChatDraftVersion;
  mode: ChatSubmissionMode;
  push?: (text: string, version?: SessionChatDraftVersion) => Promise<void>;
  send: (text: string, version?: SessionChatDraftVersion) => void | Promise<void>;
  queue?: (text: string, version?: SessionChatDraftVersion) => Promise<unknown>;
  cancelled?: () => boolean;
  phase?: (phase: 'saveDraft' | 'deliverMessage' | 'queueAfterCompact') => void;
}): Promise<void> {
  const checkCancelled = () => {
    if (options.cancelled?.()) throw new GxserverRpcError('sendCancelled', 'The session chat send was cancelled.', '/api/sendSessionChatMessage');
  };
  options.phase?.('saveDraft');
  await options.push?.(options.text, options.version);
  /** CDXC:SessionChat 2026-09-17 WHY:
   * Escape can arrive while a draft save is pending, before the daemon has a send to cancel.
   * Both renderers must cancel here as well so the recovered draft is not delivered after the interrupt.
   */
  checkCancelled();
  options.phase?.('deliverMessage');
  if (options.mode === 'compact') {
    await options.send('/compact');
    checkCancelled();
    options.phase?.('queueAfterCompact');
  }
  if (options.mode !== 'send') {
    if (!options.queue) throw new Error('This session cannot queue prompts.');
    await options.queue(options.mode === 'queue' ? options.text.trim() : options.text, options.version);
  } else {
    await options.send(options.text, options.version);
  }
}

export function restoreUndeliveredChatText(submitted: string, current: string): string {
  return current === '' || current === submitted ? submitted : `${submitted}\n${current}`;
}

export async function editQueuedChatPrompt(options: {
  original: string;
  remove: () => Promise<{ text: string } | null | undefined>;
  readCurrent: () => string | Promise<string>;
  queue: (text: string) => Promise<unknown>;
}): Promise<string> {
  const removed = await options.remove();
  const current = await options.readCurrent();
  if (current.trim() !== '') await options.queue(current);
  return removed?.text ?? options.original;
}
