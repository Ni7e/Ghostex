import { createContext, type ReactNode } from 'react';
import { resolveSessionChatTranscriptAgent } from '../../shared/session-chat';
import {
  SessionChatFileChangePreviewContext,
  SessionChatSimpleModeChangeContext,
  SessionChatSimpleModeContext,
} from './session-chat-simple-mode';

/** CDXC:SessionChat 2026-09-14 WHY:
 * Pi, OMP, Hermes, and Antigravity terminals preserve single newlines in assistant replies, including emoji lists that CommonMark otherwise collapses into one paragraph.
 * Apply this only to assistant prose, keeping reasoning normalization and user quote handling independent.
 */
export const SessionChatAgentLineBreaksContext = createContext(false);

/** CDXC:SessionChat 2026-09-14 DECISION:
 * User: Claude, Codex, Grok Build, and Cursor already look good; leave their newline rendering unchanged.
 */
export function sessionChatPreservesAgentLineBreaks(agent: string | null | undefined): boolean {
  const family = resolveSessionChatTranscriptAgent(agent);
  return family === 'pi' || family === 'hermes' || family === 'antigravity';
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
