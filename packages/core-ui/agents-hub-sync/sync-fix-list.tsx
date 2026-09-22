import { useState } from 'react';
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconFileText,
  IconFolder,
  IconLinkOff,
} from '@tabler/icons-react';
import { Button } from '@/packages/components/ui/button';
import { cn } from '@/packages/components/utils';
import type {
  AgentSyncPlanGroupKind,
  AgentSyncProblem,
  AgentSyncProblemKind,
  AgentSyncReport,
} from '../../shared/agent-sync';
import { agentSyncProblemFixGroups } from '../../shared/agent-sync';
import { problemAgents, problemCopy } from './problem-copy';
import { AgentLogo } from './shared';

const WHERE_LIMIT = 4;
const PATH_LIMIT = 3;

function ProblemIcon({ kind }: { kind: AgentSyncProblemKind }) {
  switch (kind) {
    case 'danglingLinks':
    case 'sourceBrokenLinks':
      return <IconLinkOff size={15} />;
    case 'copiedFolders':
      return <IconCopy size={15} />;
    case 'wholeFolderLinks':
      return <IconFolder size={15} />;
    case 'missingPointers':
      return <IconFileText size={15} />;
    default:
      return <IconAlertTriangle size={15} />;
  }
}

function FixRow({
  isOpen,
  onFix,
  onSelectAgent,
  onToggle,
  problem,
  report,
}: {
  isOpen: boolean;
  onFix: (groups: AgentSyncPlanGroupKind[]) => void;
  onSelectAgent: (id: string) => void;
  onToggle: () => void;
  problem: AgentSyncProblem;
  report: AgentSyncReport;
}) {
  const [showAllAgents, setShowAllAgents] = useState(false);
  const [showAllPaths, setShowAllPaths] = useState(false);
  const copy = problemCopy(problem, report);
  const agents = problemAgents(problem, report);
  const groups = agentSyncProblemFixGroups(problem.kind);
  const shownAgents = showAllAgents ? agents : agents.slice(0, WHERE_LIMIT);
  const shownPaths = showAllPaths ? problem.items : problem.items.slice(0, PATH_LIMIT);
  return (
    <>
      <div className={cn('agents-hub-sync-fix-row', isOpen && 'is-open')}>
        <button aria-expanded={isOpen} className='agents-hub-sync-fix-toggle' onClick={onToggle} type='button'>
          <span className={cn('agents-hub-sync-icon-tile', `is-${copy.tone}`)}>
            <ProblemIcon kind={problem.kind} />
          </span>
          <span className='agents-hub-sync-fix-text'>
            <span className='agents-hub-sync-fix-title'>{copy.title}</span>
            <span className='agents-hub-sync-fix-sub'>{copy.sub}</span>
          </span>
          <span className='agents-hub-sync-fix-agents'>
            {agents.length > 0 ? (
              <>
                <span className='agents-hub-sync-logo-stack'>
                  {agents.slice(0, 3).map(({ agent }) => (
                    <AgentLogo agent={agent} key={agent.id} size={18} />
                  ))}
                </span>
                {agents.length} {agents.length === 1 ? 'agent' : 'agents'}
              </>
            ) : (
              'Shared folder'
            )}
          </span>
        </button>
        <Button onClick={() => onFix(groups)} size='sm' type='button' variant='outline'>
          {isOpen ? 'Review fix…' : 'Fix…'}
        </Button>
        <button
          aria-label={isOpen ? 'Hide details' : 'Show details'}
          className='agents-hub-sync-fix-chevron'
          onClick={onToggle}
          type='button'
        >
          {isOpen ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
        </button>
      </div>
      {isOpen ? (
        <div className='agents-hub-sync-fix-detail'>
          <div className='agents-hub-sync-fix-detail-col'>
            <span className='agents-hub-sync-fix-detail-label'>Where</span>
            {agents.length === 0 ? (
              <span className='agents-hub-sync-where-row is-static'>In your shared folder, {report.source.path}</span>
            ) : (
              shownAgents.map(({ agent, count, unit }) => (
                <button
                  className='agents-hub-sync-where-row'
                  key={agent.id}
                  onClick={() => onSelectAgent(agent.id)}
                  type='button'
                >
                  <AgentLogo agent={agent} size={18} />
                  <span className='name'>{agent.displayName}</span>
                  {unit ? (
                    <span className='cnt'>
                      {count} {count === 1 ? unit : `${unit}s`}
                    </span>
                  ) : null}
                </button>
              ))
            )}
            {agents.length > shownAgents.length ? (
              <button className='agents-hub-sync-link' onClick={() => setShowAllAgents(true)} type='button'>
                and {agents.length - shownAgents.length} more{' '}
                {agents.length - shownAgents.length === 1 ? 'agent' : 'agents'}
              </button>
            ) : null}
          </div>
          <div className='agents-hub-sync-fix-detail-col'>
            <span className='agents-hub-sync-fix-detail-label'>What the fix does</span>
            <ul className='agents-hub-sync-fix-steps'>
              {copy.steps.map((step) => (
                <li key={step}>
                  <IconCheck size={14} stroke={2.2} />
                  <span>{step}</span>
                </li>
              ))}
            </ul>
            {problem.items.length > 0 ? (
              <div className='agents-hub-sync-fix-paths'>
                {shownPaths.map((item) => (
                  <div key={item} title={item}>
                    {item}
                  </div>
                ))}
              </div>
            ) : null}
            {problem.items.length > shownPaths.length ? (
              <button className='agents-hub-sync-link' onClick={() => setShowAllPaths(true)} type='button'>
                Show all {problem.items.length}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

/** One row per problem, one open at a time, so the list never turns back into a wall of text. */
export function SyncFixList({
  onFix,
  onSelectAgent,
  problems,
  report,
}: {
  onFix: (groups: AgentSyncPlanGroupKind[]) => void;
  onSelectAgent: (id: string) => void;
  problems: AgentSyncProblem[];
  report: AgentSyncReport;
}) {
  const [openKind, setOpenKind] = useState<AgentSyncProblemKind | undefined>();
  return (
    <div className='agents-hub-sync-card'>
      {problems.map((problem) => (
        <FixRow
          isOpen={openKind === problem.kind}
          key={problem.kind}
          onFix={onFix}
          onSelectAgent={onSelectAgent}
          onToggle={() => setOpenKind((current) => (current === problem.kind ? undefined : problem.kind))}
          problem={problem}
          report={report}
        />
      ))}
    </div>
  );
}
