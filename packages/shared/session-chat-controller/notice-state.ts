import { storageScope } from '@/packages/client-storage';
import type { SessionChatTerminalNotice } from '../session-chat';

const clientStorage = storageScope(['notices']);

export function sessionChatTerminalNoticeDismissKey(notice: SessionChatTerminalNotice | null): string | null {
  return notice ? `${notice.kind}:${notice.detectedAt}` : null;
}

/** What a notice says, independent of when it was detected. */
export function sessionChatTerminalNoticeIdentity(notice: SessionChatTerminalNotice): string {
  return `${notice.kind}:${notice.title}`;
}

/**
 * How long the same screen-state notice stays hidden after being dismissed,
 * even when it comes back under a new `detectedAt`. A usage limit or an expired
 * login lasts far longer than this, and a user who closed the card knows about
 * it; after this long a re-detection is worth mentioning again.
 */
export const NOTICE_REDISPLAY_COOLDOWN_MS = 30 * 60 * 1000;

export interface DismissedNotice {
  /** Exact detection dismissed: `kind:detectedAt`. */
  key: string;
  /** `kind:title` of the dismissed notice. */
  identity: string;
  /** Wall-clock millis of the dismissal. */
  dismissedAt: number;
  /** Whether the cooldown applies: only screen-state notices re-detect continuously. */
  fromScreen: boolean;
}

/**
 * True when `notice` is the detection the user dismissed, or the same
 * screen-state words re-detected within the cooldown.
 */
export function isNoticeDismissed(notice: SessionChatTerminalNotice, dismissed: DismissedNotice | null): boolean {
  if (!dismissed) {
    return false;
  }
  if (sessionChatTerminalNoticeDismissKey(notice) === dismissed.key) {
    return true;
  }
  if (!dismissed.fromScreen || notice.source !== 'screen') {
    return false;
  }
  if (sessionChatTerminalNoticeIdentity(notice) !== dismissed.identity) {
    return false;
  }
  const detectedAt = Date.parse(notice.detectedAt);
  return !Number.isFinite(detectedAt) || detectedAt < dismissed.dismissedAt + NOTICE_REDISPLAY_COOLDOWN_MS;
}

// Per-session dismissed notice (session-chat-verbose-override.ts is the
// pattern). Survives the card unmounting when the host switches surfaces.
const DISMISS_STORAGE_PREFIX = 'ghostex.sessionChat.noticeDismissed.';

export function readStoredDismissedNotice(sessionKey: string | undefined): DismissedNotice | null {
  if (!sessionKey) {
    return null;
  }
  try {
    const raw = clientStorage.getItem(`${DISMISS_STORAGE_PREFIX}${sessionKey}`);
    if (!raw) {
      return null;
    }
    if (!raw.startsWith('{')) {
      // Pre-2026-09-03 entries stored the bare key; they still hide that one detection.
      return { dismissedAt: 0, fromScreen: false, identity: '', key: raw };
    }
    const parsed = JSON.parse(raw) as Partial<DismissedNotice>;
    if (typeof parsed.key !== 'string' || typeof parsed.identity !== 'string') {
      return null;
    }
    return {
      dismissedAt: typeof parsed.dismissedAt === 'number' ? parsed.dismissedAt : 0,
      fromScreen: parsed.fromScreen === true,
      identity: parsed.identity,
      key: parsed.key,
    };
  } catch {
    // Storage disabled by the embedder: dismissal still works, just per-mount.
    return null;
  }
}

export function writeStoredDismissedNotice(sessionKey: string | undefined, dismissed: DismissedNotice): void {
  if (!sessionKey) {
    return;
  }
  try {
    clientStorage.setItem(`${DISMISS_STORAGE_PREFIX}${sessionKey}`, JSON.stringify(dismissed));
  } catch {
    // Quota/private-mode failures must not break the dismiss button.
  }
}

export function dismissedNoticeState(notice: SessionChatTerminalNotice): DismissedNotice {
  return {
    dismissedAt: Date.now(),
    fromScreen: notice.source === 'screen',
    identity: sessionChatTerminalNoticeIdentity(notice),
    key: sessionChatTerminalNoticeDismissKey(notice)!,
  };
}
