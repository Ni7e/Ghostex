// Autoscroll geometry helpers (orca §11.2 port).

export const SESSION_CHAT_BOTTOM_THRESHOLD_PX = 48;

export interface SessionChatScrollGeometry {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
}

export function sessionChatDistanceFromBottom(g: SessionChatScrollGeometry): number {
  return Math.max(0, g.scrollHeight - g.clientHeight - g.scrollTop);
}

export function isSessionChatNearBottom(
  g: SessionChatScrollGeometry,
  threshold: number = SESSION_CHAT_BOTTOM_THRESHOLD_PX,
): boolean {
  return sessionChatDistanceFromBottom(g) <= threshold;
}

export function shouldShowSessionChatJumpToLatest(
  isStuck: boolean,
  g: SessionChatScrollGeometry,
  threshold: number = SESSION_CHAT_BOTTOM_THRESHOLD_PX,
): boolean {
  return !isStuck && sessionChatDistanceFromBottom(g) > threshold;
}
