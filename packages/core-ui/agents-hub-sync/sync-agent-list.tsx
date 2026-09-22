import { useState } from 'react';
import { IconCheck, IconChevronDown, IconChevronRight, IconLayoutGrid, IconPlus } from '@tabler/icons-react';
import { SegmentedControl, SegmentedControlItem } from '@/packages/components/ui/segmented-control';
import { cn } from '@/packages/components/utils';
import type { AgentSyncAgentReport, AgentSyncReport } from '../../shared/agent-sync';
import { agentSyncIssueCount, agentSyncWorstTone } from '../../shared/agent-sync';
import { AgentLogo } from './shared';

export type SyncAgentFilter = 'fix' | 'synced' | 'all';

type AgentGroup = {
  agent: AgentSyncAgentReport;
  profiles: AgentSyncAgentReport[];
};

const toneRank = { err: 0, warn: 1, ok: 2 } as const;

/** Profiles (`claude-code:work`) nest under their agent, so one agent is one row until it is opened. */
function groupAgents(agents: AgentSyncAgentReport[]): AgentGroup[] {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const groups = new Map<string, AgentGroup>();
  for (const agent of agents) {
    const parentId = agent.kind === 'profile' ? agent.id.split(':')[0] : undefined;
    const parent = parentId ? byId.get(parentId) : undefined;
    if (parent) {
      const group = groups.get(parent.id) ?? { agent: parent, profiles: [] };
      group.profiles.push(agent);
      groups.set(parent.id, group);
    } else if (!groups.has(agent.id)) {
      groups.set(agent.id, { agent, profiles: [] });
    }
  }
  return [...groups.values()];
}

function groupIssues(group: AgentGroup): number {
  return [group.agent, ...group.profiles].reduce((sum, agent) => sum + agentSyncIssueCount(agent), 0);
}

function groupTone(group: AgentGroup): 'ok' | 'warn' | 'err' {
  const tones = [group.agent, ...group.profiles].map(agentSyncWorstTone);
  return tones.includes('err') ? 'err' : tones.includes('warn') ? 'warn' : 'ok';
}

function RowStatus({ issues, tone }: { issues: number; tone: 'ok' | 'warn' | 'err' }) {
  if (issues === 0) {
    return (
      <span aria-label='In sync' className='agents-hub-sync-row-status is-ok'>
        <IconCheck size={13} stroke={2.2} />
      </span>
    );
  }
  return (
    <span className={cn('agents-hub-sync-row-status', `is-${tone === 'ok' ? 'warn' : tone}`)}>{issues} to fix</span>
  );
}

function profileLabel(profile: AgentSyncAgentReport): string {
  return profile.id.split(':').slice(1).join(':');
}

export function SyncAgentList({
  onSelect,
  onToggleHidden,
  query,
  report,
  selectedId,
  showHidden,
}: {
  onSelect: (id: string) => void;
  onToggleHidden: () => void;
  query: string;
  report: AgentSyncReport;
  selectedId: string;
  showHidden: boolean;
}) {
  const needsFixing = report.agents.filter((agent) => agent.status === 'attention').length;
  const inSync = report.agents.filter((agent) => agent.status === 'linked').length;
  const [filter, setFilter] = useState<SyncAgentFilter>(needsFixing > 0 ? 'fix' : 'all');
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());

  const needle = query.trim().toLowerCase();
  const matches = (agent: AgentSyncAgentReport) =>
    needle.length === 0 || agent.displayName.toLowerCase().includes(needle) || agent.id.toLowerCase().includes(needle);
  const installed = report.agents.filter((agent) => agent.status !== 'notInstalled');
  const hidden = report.agents.filter((agent) => agent.status === 'notInstalled' && matches(agent));
  const groups = groupAgents(installed)
    .filter((group) => [group.agent, ...group.profiles].some(matches))
    .filter((group) => {
      if (needle.length > 0 || filter === 'all') {
        return true;
      }
      return filter === 'fix' ? groupIssues(group) > 0 : groupIssues(group) === 0;
    })
    .sort((a, b) => toneRank[groupTone(a)] - toneRank[groupTone(b)]);

  const toggleOpen = (id: string) =>
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  return (
    <div className='agents-hub-sync-list'>
      {needle.length === 0 ? (
        <>
          <button
            className={cn('agents-hub-sync-agent-row is-overview', selectedId === 'all' && 'is-active')}
            onClick={() => onSelect('all')}
            type='button'
          >
            <IconLayoutGrid size={16} />
            <span className='agents-hub-sync-agent-name'>Overview</span>
          </button>
          <SegmentedControl
            aria-label='Filter agents'
            className='agents-hub-sync-filter'
            onValueChange={(value) => setFilter(value as SyncAgentFilter)}
            size='sm'
            stretch
            value={filter}
          >
            <SegmentedControlItem value='fix'>
              To fix <span className='n'>{needsFixing}</span>
            </SegmentedControlItem>
            <SegmentedControlItem value='synced'>
              In sync <span className='n'>{inSync}</span>
            </SegmentedControlItem>
            <SegmentedControlItem value='all'>
              All <span className='n'>{installed.length}</span>
            </SegmentedControlItem>
          </SegmentedControl>
        </>
      ) : null}
      {groups.length === 0 ? (
        <div className='agents-hub-sync-list-empty'>
          {needle.length > 0
            ? 'No agent matches your search.'
            : filter === 'fix'
              ? 'Nothing to fix.'
              : 'No agents are in sync yet.'}
        </div>
      ) : null}
      {groups.map((group) => {
        const hasProfiles = group.profiles.length > 0;
        const isOpen =
          hasProfiles &&
          (openIds.has(group.agent.id) ||
            needle.length > 0 ||
            group.profiles.some((profile) => profile.id === selectedId));
        return (
          <div className='agents-hub-sync-agent-group' key={group.agent.id}>
            <div className={cn('agents-hub-sync-agent-row', selectedId === group.agent.id && 'is-active')}>
              <button className='agents-hub-sync-agent-select' onClick={() => onSelect(group.agent.id)} type='button'>
                <AgentLogo agent={group.agent} size={20} />
                <span className='agents-hub-sync-agent-name'>{group.agent.displayName}</span>
              </button>
              {hasProfiles ? (
                <button
                  aria-expanded={isOpen}
                  className='agents-hub-sync-profiles-chip'
                  onClick={() => toggleOpen(group.agent.id)}
                  type='button'
                >
                  {group.profiles.length + 1} profiles
                  {isOpen ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
                </button>
              ) : null}
              <RowStatus
                issues={isOpen ? agentSyncIssueCount(group.agent) : groupIssues(group)}
                tone={isOpen ? agentSyncWorstTone(group.agent) : groupTone(group)}
              />
            </div>
            {isOpen
              ? group.profiles.map((profile) => (
                  <button
                    className={cn('agents-hub-sync-profile-row', selectedId === profile.id && 'is-active')}
                    key={profile.id}
                    onClick={() => onSelect(profile.id)}
                    type='button'
                  >
                    <span className='agents-hub-sync-agent-name'>{profileLabel(profile)}</span>
                    <RowStatus issues={agentSyncIssueCount(profile)} tone={agentSyncWorstTone(profile)} />
                  </button>
                ))
              : null}
          </div>
        );
      })}
      {hidden.length > 0 && (filter === 'all' || needle.length > 0) ? (
        <>
          <div className='agents-hub-sync-caption'>
            Not installed <span>({hidden.length})</span>
          </div>
          {showHidden ? (
            hidden.map((agent) => (
              <div className={cn('agents-hub-sync-agent-row', selectedId === agent.id && 'is-active')} key={agent.id}>
                <button className='agents-hub-sync-agent-select' onClick={() => onSelect(agent.id)} type='button'>
                  <AgentLogo agent={agent} size={20} />
                  <span className='agents-hub-sync-agent-name'>{agent.displayName}</span>
                </button>
              </div>
            ))
          ) : (
            <button className='agents-hub-sync-agent-row is-muted' onClick={onToggleHidden} type='button'>
              <span aria-hidden='true' className='agents-hub-sync-logo agents-hub-sync-logo-letter'>
                <IconPlus size={12} />
              </span>
              <span className='agents-hub-sync-agent-name'>Show agents without a config folder</span>
            </button>
          )}
        </>
      ) : null}
    </div>
  );
}
