import type { T3SessionMetadata } from "./session-grid-contract-core";
import { stableGhostexT3DraftThreadId } from "./t3-session-binding";

type LegacyT3SessionMetadata = Omit<T3SessionMetadata, "boundThreadId"> & {
  boundThreadId?: string;
};

function isLegacyT3PlaceholderThreadId(threadId: string): boolean {
  return threadId.startsWith("pending-") || threadId.startsWith("ghostex-draft-");
}

export function getT3SessionBoundThreadId(
  metadata: LegacyT3SessionMetadata,
  sessionId?: string,
): string {
  const normalizedBoundThreadId = metadata.boundThreadId?.trim();
  if (normalizedBoundThreadId && !isLegacyT3PlaceholderThreadId(normalizedBoundThreadId)) {
    return normalizedBoundThreadId;
  }

  const normalizedThreadId = metadata.threadId.trim();
  if (normalizedThreadId && !isLegacyT3PlaceholderThreadId(normalizedThreadId)) {
    return normalizedThreadId;
  }

  if (sessionId?.trim()) {
    return stableGhostexT3DraftThreadId(sessionId);
  }

  return normalizedBoundThreadId || normalizedThreadId;
}

export function normalizeT3SessionMetadata(
  metadata: LegacyT3SessionMetadata,
  sessionId?: string,
): T3SessionMetadata {
  /*
  CDXC:T3SessionOwnership 2026-07-01-02:17:
  Ghostex owns the visible T3 session row, so placeholder T3 ids cannot be durable bindings. When the caller has the Ghostex session id, normalize missing or legacy pending bindings to the stable `ghostex-thread-<ghostexSessionId>` id that T3 promotes on first send.
  */
  const boundThreadId = getT3SessionBoundThreadId(metadata, sessionId);
  return {
    ...metadata,
    boundThreadId,
    threadId: boundThreadId,
  };
}

export function setT3SessionBoundThreadId(
  metadata: LegacyT3SessionMetadata,
  boundThreadId: string,
  sessionId?: string,
): T3SessionMetadata {
  return normalizeT3SessionMetadata({
    ...metadata,
    boundThreadId,
    threadId: boundThreadId,
  }, sessionId);
}
