import { createContext, type ReactNode } from 'react';
import { resolveSessionChatTranscriptAgent } from '../../shared/session-chat';
import {
  SessionChatFileChangePreviewContext,
  SessionChatSimpleModeChangeContext,
  SessionChatSimpleModeContext,
} from './session-chat-simple-mode';

/** CDXC:SessionChat 2026-09-17 WHY:
 * Pi, OMP, Hermes, Antigravity, and ZCode terminals preserve single newlines in assistant replies, including emoji glyph lists that CommonMark otherwise collapses into one paragraph; the ZCode TUI paints every soft-break newline as its own row.
 * Supersedes the 2026-09-14 wording, which predated ZCode becoming a chat agent family.
 * Apply this only to assistant prose, keeping reasoning normalization and user quote handling independent.
 */
export const SessionChatAgentLineBreaksContext = createContext(false);

/** CDXC:SessionChat 2026-09-17 DECISION:
 * User: ZCode joins the preserve list — its replies are written one row per line for the terminal, so chat must not collapse them.
 * User, 2026-09-14: Claude, Codex, Grok Build, and Cursor already look good; leave their newline rendering unchanged.
 */
export function sessionChatPreservesAgentLineBreaks(agent: string | null | undefined): boolean {
  const family = resolveSessionChatTranscriptAgent(agent);
  return family === 'pi' || family === 'hermes' || family === 'antigravity' || family === 'zcode';
}

export function SessionChatPresentationProvider({
  children,
  fileEditPreviews,
  simpleMode,
  onSimpleModeChange,
  preserveAgentLineBreaks = false,
}: {
  children: ReactNode;
  fileEditPreviews: boolean;
  simpleMode: boolean;
  onSimpleModeChange?: (enabled: boolean) => void;
  preserveAgentLineBreaks?: boolean;
}) {
  return (
    <SessionChatSimpleModeContext value={simpleMode}>
      <SessionChatSimpleModeChangeContext value={onSimpleModeChange}>
        <SessionChatFileChangePreviewContext value={fileEditPreviews}>
          <SessionChatAgentLineBreaksContext value={preserveAgentLineBreaks}>
            {children}
          </SessionChatAgentLineBreaksContext>
        </SessionChatFileChangePreviewContext>
      </SessionChatSimpleModeChangeContext>
    </SessionChatSimpleModeContext>
  );
}
