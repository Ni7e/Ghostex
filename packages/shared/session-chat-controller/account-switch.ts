import type { AccountSwitchProgress } from '../agent-accounts';
import type { ChatLifecycle } from './lifecycle';

/**
 * CDXC:AgentProviders 2026-09-15 DECISION:
 * User: the account-switch card must not go away until the switch is actually complete and the second account is ready.
 * gxserver's `success` phase only proves the new CLI process is up, so the chat keeps the card, blocks sends, and shows the last step as active until the caller reports `ready`: the session's account read names the target account and no queued model change is still pending.
 * Only the brief success acknowledgement uses a timer, and it starts once `ready` holds; every in-flight step comes from gxserver.
 */
export function computeAccountSwitchStatus(
  progress: AccountSwitchProgress | null,
  sessionKey: string | undefined,
  ready: boolean,
  lifecycle: Pick<ChatLifecycle, 'useState' | 'useRef' | 'useEffect'>
) {
  const { useState, useRef, useEffect } = lifecycle;
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const observed = useRef<string | null>(null);
  useEffect(() => {
    setDismissed(null);
    observed.current = null;
  }, [sessionKey]);
  useEffect(() => {
    if (!progress) return;
    if (progress.phase !== 'success') {
      observed.current = progress.id;
      return;
    }
    // An old completed switch must not reappear when reopening a conversation.
    const recent = Date.now() - Date.parse(progress.updatedAt) < 5000;
    if (observed.current !== progress.id && !recent) {
      setDismissed(progress.id);
      return;
    }
    if (!ready) return;
    const timer = setTimeout(() => setDismissed(progress.id), 1800);
    return () => clearTimeout(timer);
  }, [progress?.id, progress?.phase, progress?.updatedAt, ready]);
  const visible =
    progress &&
    progress.phase !== 'cancelled' &&
    dismissed !== progress.id &&
    (progress.phase !== 'success' ||
      observed.current === progress.id ||
      Date.now() - Date.parse(progress.updatedAt) < 5000)
      ? progress
      : null;
  useEffect(() => {
    if (!visible) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, [visible?.id]);
  const busy =
    !!progress &&
    (['switching', 'resuming', 'continuing'].includes(progress.phase) ||
      (progress.phase === 'success' && !ready && visible !== null));
  return { visible, now, busy };
}
