import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  IconBook2,
  IconCheck,
  IconCircleCheck,
  IconExternalLink,
  IconFileText,
  IconFolder,
  IconInfoCircle,
  IconLock,
  IconRefresh,
  IconTerminal,
} from '@tabler/icons-react';
import { Button } from '@/packages/components/ui/button';
import { Switch } from '@/packages/components/ui/switch';
import { cn } from '@/packages/components/utils';
import type { AgentSyncPart, AgentSyncPlanGroupKind, AgentSyncReport } from '../../shared/agent-sync';
import { agentSyncDefaultPlanGroups, agentSyncProblemPart } from '../../shared/agent-sync';
import { SyncFixList } from './sync-fix-list';

const RING_RADIUS = 24;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

function checkedLabel(generatedAt: string): string | undefined {
  const date = new Date(generatedAt);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return `Checked at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function CoverageCard({
  active,
  caption,
  done,
  icon,
  label,
  onClick,
  total,
}: {
  active: boolean;
  caption: string;
  done: number;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  total: number;
}) {
  const complete = total > 0 && done >= total;
  return (
    <button
      aria-pressed={active}
      className={cn('agents-hub-sync-coverage-card', active && 'is-active')}
      onClick={onClick}
      type='button'
    >
      <span className='agents-hub-sync-coverage-head'>
        {icon}
        {label}
        <span className='count'>
          <b>{done}</b> of {total} agents
        </span>
      </span>
      <span className='agents-hub-sync-coverage-bar'>
        <span className={cn(complete && 'is-ok')} style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }} />
      </span>
      <span className='agents-hub-sync-coverage-caption'>{caption}</span>
    </button>
  );
}

export function SyncOverviewPane({
  onOpenFolder,
  onOpenPlan,
  onRefresh,
  onSelectAgent,
  report,
}: {
  onOpenFolder: (path: string) => void;
  onOpenPlan: (scope: string, groups?: AgentSyncPlanGroupKind[]) => void;
  onRefresh: () => void;
  onSelectAgent: (id: string) => void;
  report: AgentSyncReport;
}) {
  const [part, setPart] = useState<AgentSyncPart | undefined>();
  const [tidyLock, setTidyLock] = useState(false);

  const summary = report.summary;
  const detected = report.agents.filter((agent) => agent.detected);
  const skillsLinked = detected.filter(
    (agent) =>
      agent.universal ||
      (agent.skills &&
        agent.skills.dirState === 'realDir' &&
        agent.skills.counts.dangling === 0 &&
        agent.skills.counts.missing === 0 &&
        agent.skills.counts.copiesIdentical === 0)
  ).length;
  const pointers = detected.filter((agent) => agent.instructions?.state === 'pointer').length;
  const pointerTargets = detected.filter((agent) => agent.instructions).length;
  const hooksLinked = detected.filter((agent) => agent.hooks?.state === 'linked').length;
  const hooksTargets = detected.filter((agent) => agent.hooks).length;

  const toFix = report.problems.filter((problem) => problem.fixable && problem.kind !== 'staleLockEntries');
  const staleLock = report.problems.find((problem) => problem.kind === 'staleLockEntries');
  const untracked = report.problems.find((problem) => problem.kind === 'untrackedSkills');
  const visible = part ? toFix.filter((problem) => agentSyncProblemPart(problem.kind) === part) : toFix;
  const synced = summary.agentsAttention === 0 && toFix.length === 0;
  const checked = checkedLabel(report.generatedAt);
  const sourceSkills = report.source.skills.filter((skill) => !skill.broken).length;

  /*
   * CDXC:AgentSync 2026-09-22 WHY:
   * Tidying the lock file stays opt-in (DECISION 4A, 2026-09-16), so it is a switch beside the fix list rather than a problem row, and "Review and fix all" only adds the pruneLock group while that switch is on.
   */
  const fixAll = () =>
    onOpenPlan('all', tidyLock ? [...agentSyncDefaultPlanGroups(undefined), 'pruneLock'] : undefined);
  const togglePart = (next: AgentSyncPart) => setPart((current) => (current === next ? undefined : next));

  return (
    <div className='agents-hub-sync-detail-body'>
      <section className={cn('agents-hub-sync-hero', synced && 'is-synced')}>
        <div className='agents-hub-sync-hero-main'>
          <div className='agents-hub-sync-ring'>
            <svg aria-hidden='true' viewBox='0 0 56 56'>
              <circle className='track' cx='28' cy='28' r={RING_RADIUS} />
              <circle
                className='fill'
                cx='28'
                cy='28'
                r={RING_RADIUS}
                strokeDasharray={`${
                  summary.agentsDetected > 0 ? (summary.agentsLinked / summary.agentsDetected) * RING_LENGTH : 0
                } ${RING_LENGTH}`}
              />
            </svg>
            <span className='agents-hub-sync-ring-label'>
              {synced ? <IconCheck size={22} stroke={2.4} /> : `${summary.agentsLinked}/${summary.agentsDetected}`}
            </span>
          </div>
          <div className='agents-hub-sync-hero-text'>
            <h2 className='agents-hub-sync-hero-title'>
              {synced
                ? `All ${summary.agentsDetected} agents are in sync`
                : summary.agentsAttention > 0
                  ? `${summary.agentsAttention} of ${summary.agentsDetected} agents are out of sync`
                  : `${toFix.length} ${toFix.length === 1 ? 'thing' : 'things'} to fix in your shared folder`}
            </h2>
            <p className='agents-hub-sync-hero-sub'>
              {synced
                ? 'Every agent on this computer uses the skills, instructions and hook scripts in your shared folder. Edit them there and every agent picks up the change.'
                : 'Agent Sync makes every agent on this computer use the same skills, instructions and hook scripts from one shared folder.'}
            </p>
          </div>
          <div className='agents-hub-sync-hero-actions'>
            {synced ? (
              <Button onClick={onRefresh} size='sm' type='button' variant='outline'>
                <IconRefresh data-icon='inline-start' size={14} />
                Check again
              </Button>
            ) : (
              <>
                <Button onClick={fixAll} type='button' variant='default'>
                  Review and fix all…
                </Button>
                <span className='agents-hub-sync-hero-reassure'>Nothing changes until you approve</span>
              </>
            )}
          </div>
        </div>
        <div className='agents-hub-sync-folder-strip'>
          <IconFolder size={14} />
          <span>Shared folder</span>
          <span className='path'>{report.source.path}</span>
          <span className='counts'>
            · {sourceSkills} skills, {report.source.mdFiles.length} instruction files, {report.source.hookScriptCount}{' '}
            hook scripts
          </span>
          <span className='spacer' />
          {checked ? <span className='checked'>{checked}</span> : null}
          {synced ? null : (
            <Button
              aria-label='Check again'
              onClick={onRefresh}
              size='sm'
              title='Check again'
              type='button'
              variant='ghost'
            >
              <IconRefresh size={14} />
            </Button>
          )}
          <Button onClick={() => onOpenFolder(report.source.path)} size='sm' type='button' variant='ghost'>
            <IconExternalLink data-icon='inline-start' size={14} />
            Open folder
          </Button>
        </div>
      </section>

      <section className='agents-hub-sync-section'>
        <div className='agents-hub-sync-section-header'>
          <h3 className='agents-hub-sync-section-title'>What is shared</h3>
          <span className='agents-hub-sync-section-hint'>How many agents use the shared copy</span>
        </div>
        <div className='agents-hub-sync-coverage'>
          <CoverageCard
            active={part === 'skills'}
            caption='Each agent gets a link to every shared skill.'
            done={skillsLinked}
            icon={<IconBook2 size={16} />}
            label='Skills'
            onClick={() => togglePart('skills')}
            total={detected.length}
          />
          <CoverageCard
            active={part === 'instructions'}
            caption='Each agent is told to read your shared main.md.'
            done={pointers}
            icon={<IconFileText size={16} />}
            label='Instructions'
            onClick={() => togglePart('instructions')}
            total={pointerTargets}
          />
          <CoverageCard
            active={part === 'hooks'}
            caption='Only Claude Code and Codex use them.'
            done={hooksLinked}
            icon={<IconTerminal size={16} />}
            label='Hook scripts'
            onClick={() => togglePart('hooks')}
            total={hooksTargets}
          />
        </div>
      </section>

      <section className='agents-hub-sync-section'>
        <div className='agents-hub-sync-section-header'>
          <h3 className='agents-hub-sync-section-title'>
            {visible.length === 0
              ? 'Nothing to fix'
              : `${visible.length} ${visible.length === 1 ? 'thing' : 'things'} to fix`}
          </h3>
          {part ? (
            <button className='agents-hub-sync-link' onClick={() => setPart(undefined)} type='button'>
              Show everything
            </button>
          ) : visible.length > 0 ? (
            <span className='agents-hub-sync-section-hint'>
              Fix one at a time, or all at once with the button above
            </span>
          ) : null}
        </div>
        {visible.length === 0 ? (
          <div className='agents-hub-sync-card'>
            <div className='agents-hub-sync-fix-row is-static'>
              <span className='agents-hub-sync-icon-tile is-ok'>
                <IconCircleCheck size={15} />
              </span>
              <div className='agents-hub-sync-fix-text'>
                <span className='agents-hub-sync-fix-title'>
                  {part && !synced ? 'Nothing to fix for this part.' : 'Every agent uses your shared folder.'}
                </span>
                <span className='agents-hub-sync-fix-sub'>
                  When you install a new agent, it shows up here until you sync it.
                </span>
              </div>
            </div>
          </div>
        ) : (
          <SyncFixList
            onFix={(groups) => onOpenPlan('all', groups)}
            onSelectAgent={onSelectAgent}
            problems={visible}
            report={report}
          />
        )}
      </section>

      {staleLock || untracked ? (
        <section className='agents-hub-sync-section'>
          {staleLock ? (
            <>
              <div className='agents-hub-sync-section-header'>
                <h3 className='agents-hub-sync-section-title'>Optional cleanup</h3>
                <span className='agents-hub-sync-section-hint'>Not included in "fix all" unless you turn it on</span>
              </div>
              <div className='agents-hub-sync-card'>
                <div className='agents-hub-sync-fix-row is-static'>
                  <span className='agents-hub-sync-icon-tile'>
                    <IconLock size={15} />
                  </span>
                  <div className='agents-hub-sync-fix-text'>
                    <span className='agents-hub-sync-fix-title'>Tidy the skills lock file</span>
                    <span className='agents-hub-sync-fix-sub' title={staleLock.items.join('\n')}>
                      {staleLock.count} {staleLock.count === 1 ? 'entry is' : 'entries are'} left over from skills you
                      removed or renamed.
                    </span>
                  </div>
                  <Switch
                    aria-label='Tidy the skills lock file'
                    checked={tidyLock}
                    onCheckedChange={(value) => setTidyLock(value === true)}
                  />
                </div>
              </div>
            </>
          ) : null}
          {untracked ? (
            <p className='agents-hub-sync-note' title={untracked.items.join('\n')}>
              <IconInfoCircle size={14} />
              {untracked.count} of your skills are not tracked by the skills CLI (your own and the ones Ghostex
              bundles). That is expected, nothing to do.
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
