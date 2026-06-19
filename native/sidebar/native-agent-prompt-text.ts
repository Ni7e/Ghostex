/*
 * CDXC:PromptAgents 2026-05-31-07:35:
 * Cursor Agent collapses large clipboard pastes into a "[Pasted text #1 +N lines]" chip when a single injection exceeds roughly twenty lines.
 * Kanban Create & Start and Start Work stage bead prompts through Ghostty `writeTerminalText`, so native prompt automation must split prompts into at most fifteen lines per write and preserve original newlines between chunks.
 *
 * CDXC:PromptAgents 2026-06-10-12:00:
 * Reduce the per-chunk line limit from fifteen to thirteen so staged agent prompts stay under Cursor Agent paste-collapse thresholds more reliably.
 *
 * CDXC:PromptAgents 2026-06-19-16:57:
 * Git and project-board agent prompts must be staged in five-line writes because Cursor Agent can still collapse thirteen-line injections into a "[Pasted text #N +N lines]" chip before submit.
 */

export const AGENT_PROMPT_MAX_LINES_PER_CHUNK = 5;

/**
 * Splits prompt text into chunks of at most `maxLinesPerChunk` lines so agent TUIs
 * treat staged input as typed text instead of one large paste.
 */
export function splitAgentPromptTextIntoLineChunks(
  text: string,
  maxLinesPerChunk = AGENT_PROMPT_MAX_LINES_PER_CHUNK,
): string[] {
  if (!text) {
    return [];
  }
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length <= maxLinesPerChunk) {
    return [normalized];
  }
  const chunks: string[] = [];
  for (let index = 0; index < lines.length; index += maxLinesPerChunk) {
    chunks.push(lines.slice(index, index + maxLinesPerChunk).join("\n"));
  }
  return chunks;
}
