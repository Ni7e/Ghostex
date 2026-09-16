import type { CSSProperties } from 'react';
import { cn } from '@/packages/components/utils';
import { getBrandAgentLogoStyle } from '../agent-logos';
import type { SidebarAgentIcon } from '../../shared/sidebar-agents';
import type { AgentSyncAgentReport, AgentSyncDotTone } from '../../shared/agent-sync';

/** Expand the report's `~/` display paths for native commands that need an absolute path. */
export function expandHomePath(path: string, home: string): string {
  if (path === '~') {
    return home;
  }
  return path.startsWith('~/') ? `${home}/${path.slice(2)}` : path;
}

export function AgentLogo({
  agent,
  size = 18,
}: {
  agent: Pick<AgentSyncAgentReport, 'displayName' | 'icon'>;
  size?: number;
}) {
  const style: CSSProperties = { height: size, width: size };
  if (agent.icon) {
    return (
      <span
        aria-hidden='true'
        className='agents-hub-agent-logo agents-hub-sync-logo'
        data-agent-icon={agent.icon}
        style={{ ...getBrandAgentLogoStyle(agent.icon as SidebarAgentIcon), ...style }}
      />
    );
  }
  return (
    <span aria-hidden='true' className='agents-hub-sync-logo agents-hub-sync-logo-letter' style={style}>
      {agent.displayName.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function StatusDot({ tone, title }: { tone: AgentSyncDotTone; title: string }) {
  return <span className={cn('agents-hub-sync-dot', `is-${tone}`)} title={title} />;
}

export function Pill({ children, tone }: { children: string; tone?: 'ok' | 'warn' | 'err' | 'info' }) {
  return <span className={cn('agents-hub-sync-pill', tone && `is-${tone}`)}>{children}</span>;
}
