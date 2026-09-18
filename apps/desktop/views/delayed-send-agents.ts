import { useEffect, useState } from 'react';
import { postAppModalHostMessage } from '@/packages/core-ui/app-modal-host-bridge';
import type { DelayedSendAgentOption, DelayedSendAgentReference } from '@/packages/shared/delayed-send';

type AgentsResult = {
  sessions: DelayedSendAgentOption[];
  active?: DelayedSendAgentReference;
  error?: string;
  loading?: boolean;
  targetSessionId?: string;
};

export function useDesktopDelayedSendAgents(sessionId: string | undefined): AgentsResult {
  const [result, setResult] = useState<AgentsResult>({ sessions: [] });
  useEffect(() => {
    setResult({ sessions: [], loading: Boolean(sessionId), targetSessionId: sessionId });
    if (!sessionId) return;
    let timer: ReturnType<typeof setTimeout>;
    let requestId: string;
    const request = () => {
      requestId = crypto.randomUUID();
      postAppModalHostMessage(
        { type: 'requestDelayedSendAgents', sessionId, requestId },
        'AppModals:delayedSendAgents'
      );
    };
    const receive = (event: Event) => {
      const message = (event as CustomEvent<{ type: string; requestId: string; result: AgentsResult }>).detail;
      if (message?.type !== 'delayedSendAgents' || message.requestId !== requestId) return;
      setResult({ ...message.result, loading: false, targetSessionId: sessionId });
      timer = setTimeout(request, 3_000);
    };
    window.addEventListener('ghostex-app-modal-host-message', receive);
    request();
    return () => {
      clearTimeout(timer);
      window.removeEventListener('ghostex-app-modal-host-message', receive);
    };
  }, [sessionId]);
  return result.targetSessionId === sessionId ? result : { sessions: [], loading: Boolean(sessionId) };
}
