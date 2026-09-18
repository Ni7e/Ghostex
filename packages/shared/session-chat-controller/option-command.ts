import type { SessionChatDraftVersion } from '../session-chat-queue';

export async function sendSessionChatOptionAware(
  text: string,
  version: SessionChatDraftVersion | undefined,
  target: {
    reconcileTypedCommand(text: string): unknown;
    send(text: string, version?: SessionChatDraftVersion): Promise<void>;
    isDraft: boolean;
    refresh(): void;
  }
): Promise<void> {
  target.reconcileTypedCommand(text);
  await target.send(text, version);
  if (target.isDraft) target.refresh();
}
