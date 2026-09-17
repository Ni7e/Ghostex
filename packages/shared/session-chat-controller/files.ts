import type { SessionChatTransport } from '@/packages/core-ui/chat/session-chat-transport';
import type { ChatLifecycle } from './lifecycle';

export function computeSessionChatFiles(transport: SessionChatTransport, lifecycle: ChatLifecycle) {
  const [state, setState] = lifecycle.useState<
    { transport: SessionChatTransport; files?: readonly string[]; loading: boolean } | undefined
  >(undefined);
  const request = lifecycle.useRef<(() => void) | null>(null);
  const requestFiles = lifecycle.useCallback(() => request.current?.(), []);
  lifecycle.useEffect(() => {
    let active = true;
    let requested = false;
    request.current = () => {
      if (requested || !active) return;
      requested = true;
      if (!transport.readFiles) {
        setState({ transport, files: [], loading: false });
        return;
      }
      setState({ transport, loading: true });
      void transport
        .readFiles()
        .then((result) => {
          if (active) setState({ transport, files: result.files, loading: false });
        })
        .catch(() => {
          if (active) setState({ transport, files: [], loading: false });
        });
    };
    return () => {
      active = false;
      request.current = null;
    };
  }, [transport]);
  const current = state?.transport === transport ? state : undefined;
  return { files: current?.files, filesLoading: current?.loading ?? false, requestFiles };
}
