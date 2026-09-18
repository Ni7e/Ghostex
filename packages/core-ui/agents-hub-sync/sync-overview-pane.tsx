import { IconAlertTriangle, IconCircleCheck, IconInfoCircle, IconLink, IconLinkOff } from '@tabler/icons-react';
import { Button } from '@/packages/components/ui/button';
import { cn } from '@/packages/components/utils';
import type { AgentSyncPlanGroupKind, AgentSyncProblem, AgentSyncReport } from '../../shared/agent-sync';
import { agentSyncProblemFixGroups } from '../../shared/agent-sync';
import { Pill } from './shared';

function problemFixLabel(problem: AgentSyncProblem): string {
  switch (problem.kind) {
    case 'danglingLinks':
      return 'Remove links';
    case 'sourceBrokenLinks':
      return 'Remove link';
    case 'wholeFolderLinks':
      return 'Convert';
    case 'copiedFolders':
      return 'Replace with links';
    case 'missingPointers':
      return 'Write pointers';
    case 'staleLockEntries':
      return 'Prune lock';
    case 'untrackedSkills':
      return '';
  }
}

function ProblemRow({
  onFix,
  problem,
}: {
  onFix: (groups: AgentSyncPlanGroupKind[]) => void;
  problem: AgentSyncProblem;
}) {
  const groups = agentSyncProblemFixGroups(problem.kind);
  const tone = problem.fixable
    ? problem.kind === 'danglingLinks' || problem.kind === 'sourceBrokenLinks'
      ? 'err'
      : 'warn'
    : 'info';
  const Icon = tone === 'err' ? IconLinkOff : tone === 'warn' ? IconAlertTriangle : IconInfoCircle;
  return (
    <div className='agents-hub-sync-row'>
      <div className='agents-hub-sync-row-main'>
        <span className={cn('agents-hub-sync-icon-tile', `is-${tone}`)}>
          <Icon size={14} />
        </span>
        <div className='agents-hub-sync-row-text'>
          <span className='agents-hub-sync-row-label'>
            {problem.title}
            {!problem.fixable ? <Pill>Info</Pill> : null}
          </span>
          <span className='agents-hub-sync-row-detail' title={problem.items.join('\n')}>
            {problem.items.slice(0, 6).join(' · ')}
            {problem.items.length > 6 ? ` · +${problem.items.length - 6} more` : ''}
          </span>
          <span className='agents-hub-sync-row-detail is-sans'>{problem.detail}</span>
        </div>
      </div>
      {problem.fixable && groups.length > 0 ? (
        <div className='agents-hub-sync-row-control'>
          <Button onClick={() => onFix(groups)} size='sm' type='button' variant='outline'>
            {problemFixLabel(problem)}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function SyncOverviewPane({
  onFixProblem,
  report,
}: {
  onFixProblem: (groups: AgentSyncPlanGroupKind[]) => void;
  report: AgentSyncReport;
}) {
  const summary = report.summary;
  const detected = report.agents.filter((agent) => agent.detected);
  const skillsLinked = detected.filter(
    (agent) =>
      agent.skills &&
      agent.skills.dirState === 'realDir' &&
      agent.skills.counts.dangling === 0 &&
      agent.skills.counts.missing === 0 &&
      agent.skills.counts.copiesIdentical === 0
  ).length;
  const pointers = detected.filter((agent) => agent.instructions?.state === 'pointer').length;
  const pointerTargets = detected.filter((agent) => agent.instructions).length;
  const hooksLinked = detected.filter((agent) => agent.hooks?.state === 'linked').length;
  const hooksTargets = detected.filter((agent) => agent.hooks).length;
  return (
    <div className='agents-hub-sync-detail-body'>
      <div className='agents-hub-sync-stats'>
        <div className={cn('agents-hub-sync-stat', summary.agentsLinked > 0 && 'is-ok')}>
          <span className='n'>{summary.agentsLinked}</span>
          <span className='l'>agents fully linked</span>
        </div>
        <div className={cn('agents-hub-sync-stat', summary.agentsAttention > 0 && 'is-warn')}>
          <span className='n'>{summary.agentsAttention}</span>
          <span className='l'>agents with drift</span>
        </div>
        <div className={cn('agents-hub-sync-stat', summary.danglingLinks > 0 && 'is-err')}>
          <span className='n'>{summary.danglingLinks}</span>
          <span className='l'>dangling symlinks</span>
        </div>
        <div className='agents-hub-sync-stat'>
          <span className='n'>{summary.staleLockEntries}</span>
          <span className='l'>stale lock entries</span>
        </div>
      </div>

      <section className='agents-hub-sync-section'>
        <div className='agents-hub-sync-section-header'>
          <h3 className='agents-hub-sync-section-title'>
            Problems <span className='sub'>fix individually, or let Sync all handle them</span>
          </h3>
        </div>
        <div className='agents-hub-sync-card'>
          {report.problems.length === 0 ? (
            <div className='agents-hub-sync-row'>
              <div className='agents-hub-sync-row-main'>
                <span className='agents-hub-sync-icon-tile is-ok'>
                  <IconCircleCheck size={14} />
                </span>
                <div className='agents-hub-sync-row-text'>
                  <span className='agents-hub-sync-row-label'>Every agent points at the source.</span>
                </div>
              </div>
            </div>
          ) : (
            report.problems.map((problem) => <ProblemRow key={problem.kind} onFix={onFixProblem} problem={problem} />)
          )}
        </div>
      </section>

      <section className='agents-hub-sync-section'>
        <div className='agents-hub-sync-section-header'>
          <h3 className='agents-hub-sync-section-title'>
            What is synced <span className='sub'>per agent, three things</span>
          </h3>
        </div>
        <div className='agents-hub-sync-card'>
          <div className='agents-hub-sync-row'>
            <div className='agents-hub-sync-row-main'>
              <span className='agents-hub-sync-icon-tile'>
                <IconLink size={14} />
              </span>
              <div className='agents-hub-sync-row-text'>
                <span className='agents-hub-sync-row-label'>
                  Skills <Pill tone='ok'>{`${skillsLinked} linked`}</Pill>
                  {summary.wholeFolderLinks > 0 ? (
                    <Pill tone='warn'>{`${summary.wholeFolderLinks} whole-folder, to convert`}</Pill>
                  ) : null}
                  {summary.copiedSkillFolders > 0 ? (
                    <Pill tone='warn'>{`${summary.copiedSkillFolders} copies`}</Pill>
                  ) : null}
                  {summary.danglingLinks > 0 ? <Pill tone='err'>{`${summary.danglingLinks} broken`}</Pill> : null}
                </span>
                <span className='agents-hub-sync-row-detail is-sans'>
                  One relative link per skill in every agent folder. Whole-folder links are converted, so agent-local
                  files always survive.
                </span>
              </div>
            </div>
            <div className='agents-hub-sync-row-control'>
              <span className='agents-hub-sync-muted'>
                {report.source.skills.filter((skill) => !skill.broken).length} in source
              </span>
            </div>
          </div>
          <div className='agents-hub-sync-row'>
            <div className='agents-hub-sync-row-main'>
              <span className='agents-hub-sync-icon-tile'>
                <IconLink size={14} />
              </span>
              <div className='agents-hub-sync-row-text'>
                <span className='agents-hub-sync-row-label'>
                  Instructions (MDs) <Pill tone='ok'>{`${pointers} pointing at main.md`}</Pill>
                  {pointerTargets - pointers > 0 ? (
                    <Pill tone='warn'>{`${pointerTargets - pointers} to write`}</Pill>
                  ) : null}
                </span>
                <span className='agents-hub-sync-row-detail is-sans'>
                  A one-line entry file per agent that says "read ~/.agents/main.md". Never a symlink: several agents
                  refuse linked instruction files.
                </span>
              </div>
            </div>
            <div className='agents-hub-sync-row-control'>
              <span className='agents-hub-sync-muted'>
                {report.source.mainMdExists ? 'main.md' : 'main.md missing'} +{' '}
                {Math.max(report.source.mdFiles.length - 1, 0)} rule files
              </span>
            </div>
          </div>
          <div className='agents-hub-sync-row'>
            <div className='agents-hub-sync-row-main'>
              <span className='agents-hub-sync-icon-tile'>
                <IconLink size={14} />
              </span>
              <div className='agents-hub-sync-row-text'>
                <span className='agents-hub-sync-row-label'>
                  Hook scripts <Pill tone='ok'>{`${hooksLinked} linked`}</Pill>
                  <Pill>{`${detected.length - hooksTargets} n/a`}</Pill>
                </span>
                <span className='agents-hub-sync-row-detail is-sans'>
                  Only the scripts folder is shared, into Claude Code and Codex. Each agent's hook config keeps its own
                  format and is left alone.
                </span>
              </div>
            </div>
            <div className='agents-hub-sync-row-control'>
              <span className='agents-hub-sync-muted'>{report.source.hooksDir}</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
