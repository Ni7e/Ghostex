import type {
  GxserverReadSessionChatResult,
  SessionChatBlock,
  SessionChatMessage,
  SessionChatToolCallBlock,
  SessionChatToolResultBlock,
} from '../session-chat';

/**
 * Every preview fixture counts from one fixed moment (2026-09-17T08:00:00Z), so
 * a scenario's rows always order the same way and a "Worked for" label never
 * changes between two runs of the comparison app.
 */
export const PREVIEW_START_MS = 1_789_632_000_000;

/** What one scenario contributes on top of the shared sample read result. */
export type PreviewScenarioSnapshot = Partial<GxserverReadSessionChatResult> & {
  messages: SessionChatMessage[];
};

export function previewMessage(
  id: string,
  role: SessionChatMessage['role'],
  text: string,
  timestamp?: number
): SessionChatMessage {
  return {
    id,
    role,
    blocks: [{ type: 'text', text }],
    timestamp: timestamp ?? PREVIEW_START_MS + Number(id.replace(/\D/g, '') || 0) * 1000,
    source: 'transcript',
  };
}

/** One transcript row, `seconds` after the fixed preview start. */
export function previewRow(
  id: string,
  role: SessionChatMessage['role'],
  seconds: number,
  blocks: SessionChatBlock[],
  extra: Partial<SessionChatMessage> = {}
): SessionChatMessage {
  return {
    id,
    role,
    blocks,
    timestamp: PREVIEW_START_MS + seconds * 1000,
    source: 'transcript',
    ...extra,
  };
}

export function previewTextRow(
  id: string,
  role: SessionChatMessage['role'],
  seconds: number,
  text: string,
  extra: Partial<SessionChatMessage> = {}
): SessionChatMessage {
  return previewRow(id, role, seconds, [{ type: 'text', text }], extra);
}

export function previewCall(name: string, input: unknown): SessionChatToolCallBlock {
  return { type: 'tool-call', name, input };
}

export function previewResult(output: string, isError = false): SessionChatToolResultBlock {
  return isError ? { type: 'tool-result', output, isError: true } : { type: 'tool-result', output };
}

/** ISO-8601 millis `seconds` after the fixed preview start, for the fields gxserver sends as stamps. */
export function previewStamp(seconds: number): string {
  return new Date(PREVIEW_START_MS + seconds * 1000).toISOString();
}
