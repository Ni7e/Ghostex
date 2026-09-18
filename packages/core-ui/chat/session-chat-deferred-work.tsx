import { createContext, useContext, useEffect, useState } from 'react';
import type { SessionChatDeferredWork, SessionChatMessage } from '@/packages/shared/session-chat';
import type { SessionChatTransport } from './session-chat-transport';

import { readWork, type HistoryReader } from '@/packages/shared/session-chat-presentation/deferred-work';
export { invalidateDeferredSessionChatWork } from '@/packages/shared/session-chat-presentation/deferred-work';
export const SessionChatHistoryReaderContext = createContext<HistoryReader | undefined>(undefined);

export function useDeferredSessionChatWork(work: SessionChatDeferredWork | undefined, enabled: boolean) {
  const read = useContext(SessionChatHistoryReaderContext);
  const [state, setState] = useState<{
    key?: SessionChatDeferredWork;
    messages?: SessionChatMessage[];
    error?: string;
  }>({});
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!work || !enabled) {
      setState({});
      return;
    }
    let active = true;
    setState({ key: work });
    if (!read) {
      setState({ key: work, error: 'This host cannot load deferred work.' });
      return;
    }
    void readWork(read, work).then(
      (messages) => {
        if (active) setState({ key: work, messages });
      },
      (error: unknown) => {
        if (active) setState({ key: work, error: error instanceof Error ? error.message : String(error) });
      }
    );
    return () => {
      active = false;
    };
  }, [read, work, enabled, attempt]);
  return { ...(state.key === work ? state : {}), retry: () => setAttempt((value) => value + 1) };
}

export function DeferredWorkLoading({ error, retry }: { error?: string; retry: () => void }) {
  return (
    <div role='status' className='px-3 py-2 text-sm text-muted-foreground'>
      {error ? (
        <>
          {error}{' '}
          <button type='button' className='underline' onClick={retry}>
            Retry
          </button>
        </>
      ) : (
        'Loading work details…'
      )}
    </div>
  );
}
