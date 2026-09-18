import { IconPlus } from '@tabler/icons-react';
import { cn } from '@/packages/components/utils';
import type { AgentSyncAgentReport, AgentSyncReport } from '../../shared/agent-sync';
import { agentSyncHooksTone, agentSyncInstructionsTone, agentSyncSkillsTone } from '../../shared/agent-sync';
import { AgentLogo, StatusDot } from './shared';

function AgentRow({
  agent,
  isActive,
  onSelect,
}: {
  agent: AgentSyncAgentReport;
  isActive: boolean;
  onSelect: () => void;
}) {
  const subtitle =
    agent.kind === 'profile'
      ? agent.id.split(':').slice(1).join(':') + ' profile'
      : agent.skills?.dirState === 'wholeFolderLink'
        ? 'whole-folder link'
        : undefined;
  return (
    <button className={cn('agents-hub-sync-agent-row', isActive && 'is-active')} onClick={onSelect} type='button'>
      <AgentLogo agent={agent} />
      <span className='agents-hub-sync-agent-name'>
        {agent.kind === 'profile' ? agent.displayName.replace(/ [^ ]+ profile$/, '') : agent.displayName}
        {subtitle ? <small>{subtitle}</small> : null}
      </span>
      {agent.detected ? (
        <span className='agents-hub-sync-dots' aria-label='Skills, instructions, hooks'>
          <StatusDot tone={agentSyncSkillsTone(agent)} title='Skills' />
          <StatusDot tone={agentSyncInstructionsTone(agent)} title='Instructions' />
          <StatusDot tone={agentSyncHooksTone(agent)} title='Hook scripts' />
        </span>
      ) : null}
    </button>
  );
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
  const needle = query.trim().toLowerCase();
  const matches = (agent: AgentSyncAgentReport) =>
    needle.length === 0 || agent.displayName.toLowerCase().includes(needle) || agent.id.toLowerCase().includes(needle);
  const linked = report.agents.filter((agent) => agent.status === 'linked' && matches(agent));
  const attention = report.agents.filter((agent) => agent.status === 'attention' && matches(agent));
  const hidden = report.agents.filter((agent) => agent.status === 'notInstalled' && matches(agent));
  return (
    <div className='agents-hub-sync-list'>
      {needle.length === 0 ? (
        <button
          className={cn('agents-hub-sync-agent-row', selectedId === 'all' && 'is-active')}
          onClick={() => onSelect('all')}
          type='button'
        >
          <span aria-hidden='true' className='agents-hub-sync-logo agents-hub-sync-logo-letter'>
            ∑
          </span>
          <span className='agents-hub-sync-agent-name'>
            All agents<small>overview</small>
          </span>
          <span className='agents-hub-sync-count'>{report.summary.agentsDetected}</span>
        </button>
      ) : null}
      {linked.length > 0 ? (
        <>
          <div className='agents-hub-sync-caption'>Linked</div>
          {linked.map((agent) => (
            <AgentRow
              agent={agent}
              isActive={selectedId === agent.id}
              key={agent.id}
              onSelect={() => onSelect(agent.id)}
            />
          ))}
        </>
      ) : null}
      {attention.length > 0 ? (
        <>
          <div className='agents-hub-sync-caption'>Needs attention</div>
          {attention.map((agent) => (
            <AgentRow
              agent={agent}
              isActive={selectedId === agent.id}
              key={agent.id}
              onSelect={() => onSelect(agent.id)}
            />
          ))}
        </>
      ) : null}
      {hidden.length > 0 ? (
        <>
          <div className='agents-hub-sync-caption'>
            Not installed <span>({hidden.length})</span>
          </div>
          {showHidden ? (
            hidden.map((agent) => (
              <AgentRow
                agent={agent}
                isActive={selectedId === agent.id}
                key={agent.id}
                onSelect={() => onSelect(agent.id)}
              />
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
