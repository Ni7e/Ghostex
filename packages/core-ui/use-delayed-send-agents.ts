import { useMemo } from 'react';
import type { DelayedSendAgentOption } from '@/packages/shared/delayed-send';
import { parseGxserverPresentationProjectSessionId } from '@/packages/shared/gxserver-presentation-sidebar-projection';
import { parseRemoteTerminalSessionId } from '@/packages/shared/remote-terminal-selection';
import { getSidebarSessionLifecycleState } from '@/packages/shared/session-grid-contract';
import { useSidebarStore } from './sidebar-store';

function machineId(sessionId: string): string {
  return parseRemoteTerminalSessionId(sessionId)?.machineId ?? 'local';
}

/**
 * CDXC:DelayedSend 2026-09-14 DECISION:
 * User: "When a specific agent finishes" offers currently Awake sessions, not sleeping ones.
 * The receiving session's daemon owns the watcher, so candidates belong to that same computer.
 */
export function useDelayedSendAgents(targetSessionId: string | undefined): DelayedSendAgentOption[] {
  const sessions = useSidebarStore((state) => state.sessionsById);
  return useMemo(() => {
    if (!targetSessionId) return [];
    return Object.values(sessions)
      .flatMap((session) => {
        if (
          session.sessionKind === 'browser' ||
          session.isSleeping ||
          getSidebarSessionLifecycleState(session) !== 'running' ||
          machineId(session.sessionId) !== machineId(targetSessionId)
        )
          return [];
        const reference =
          parseRemoteTerminalSessionId(session.sessionId) ??
          parseGxserverPresentationProjectSessionId(session.sessionId);
        if (!reference) return [];
        const title = session.displayTitle || session.primaryTitle || session.alias || reference.sessionId;
        return [{ ...reference, label: `${title} (${session.sessionNumber || reference.sessionId})` }];
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [sessions, targetSessionId]);
}
