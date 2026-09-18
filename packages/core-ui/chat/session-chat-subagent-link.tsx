import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { SessionChatSubagentInfo } from '@/packages/shared/session-chat';
import { AppTooltip } from '../app-tooltip';
import {
  isSessionChatSubagentSelf,
  sessionChatToolSubagent,
  type SessionChatSubagentTarget,
} from '@/packages/shared/session-chat-presentation/subagent';

export { sessionChatToolSubagent, type SessionChatSubagentTarget };

export const SessionChatSubagentContext = createContext<{
  open: (target: SessionChatSubagentTarget) => void;
  readInfo?: (selector: string) => Promise<SessionChatSubagentInfo>;
  agentPath?: string;
} | null>(null);

/** CDXC:Tooltips 2026-09-12 DECISION: User: subagent transcript links use the same styled tooltip as chat skill references, with no model name; agent types use the regular action font. Codex fleet rows now show the name/path in the status column instead of the tooltip. */
export function SessionChatSubagentLink({
  selector,
  name,
  agentType,
  task,
  model,
  effort,
  showAgentType = true,
  children,
}: SessionChatSubagentTarget & { children?: ReactNode; showAgentType?: boolean }) {
  const viewer = useContext(SessionChatSubagentContext);
  const [hovered, setHovered] = useState(false);
  const [info, setInfo] = useState<SessionChatSubagentInfo | null>(null);
  const readInfo = viewer?.readInfo;
  useEffect(() => {
    if (!showAgentType || !hovered || !readInfo) return;
    let cancelled = false;
    setInfo(null);
    void readInfo(selector).then(
      (next) => {
        if (!cancelled) setInfo(next);
      },
      () => {
        if (!cancelled) setInfo(null);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [hovered, readInfo, selector, showAgentType]);
  if (!viewer || isSessionChatSubagentSelf(selector, viewer.agentPath)) return <>{children ?? name}</>;
  return (
    <AppTooltip
      content={
        <div className='space-y-2'>
          {showAgentType ? <div>{info?.agentType ?? agentType ?? name}</div> : null}
          <div>View subagent transcript</div>
        </div>
      }
      onOpenChange={setHovered}
      side='top'
    >
      <button
        className='ghostex-chat-subagent-link'
        type='button'
        aria-haspopup='dialog'
        aria-label={`View ${name}'s transcript`}
        onClick={(event) => {
          event.stopPropagation();
          viewer.open({ name, selector, agentType, task, model, effort });
        }}
      >
        {children ?? name}
      </button>
    </AppTooltip>
  );
}
