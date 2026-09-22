import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  IconBook2,
  IconCheck,
  IconCopy,
  IconFileText,
  IconFolder,
  IconFolderOpen,
  IconLink,
  IconLinkOff,
  IconRefresh,
  IconTerminal,
} from '@tabler/icons-react';
import { Button } from '@/packages/components/ui/button';
import { cn } from '@/packages/components/utils';
import type { WebviewApi } from '../webview-api';
import type {
  AgentSyncAgentReport,
  AgentSyncDotTone,
  AgentSyncPlanGroupKind,
  AgentSyncReport,
  AgentSyncSkillEntry,
  AgentSyncSkillEntryState,
} from '../../shared/agent-sync';
import {
  AGENT_SYNC_SKILL_ENTRY_LABELS,
  agentSyncHooksTone,
  agentSyncInstructionsTone,
  agentSyncIssueCount,
  agentSyncPartFixGroups,
  agentSyncSkillsTone,
} from '../../shared/agent-sync';
import { AgentLogo, Pill, StatusDot, expandHomePath } from './shared';

const bucketOrder: { label: string; states: AgentSyncSkillEntryState[]; sub?: string }[] = [
  { label: 'Broken', states: ['dangling'] },
  { label: 'Copies of a shared skill', states: ['copyIdentical', 'copyDrifted'] },
  { label: 'Only here', states: ['onlyHere', 'linkedElsewhere'], sub: 'not in the shared folder' },
  { label: 'Linked', states: ['linked', 'viaWholeFolder'] },
  { label: 'Missing here', states: ['missing'], sub: 'in the shared folder, not linked yet' },
];

function entryTone(state: AgentSyncSkillEntryState): 'ok' | 'warn' | 'err' | 'off' {
  switch (state) {
    case 'linked':
    case 'viaWholeFolder':
      return 'ok';
    case 'dangling':
      return 'err';
    case 'copyIdentical':
    case 'copyDrifted':
      return 'warn';
    default:
      return 'off';
  }
}

function SkillRow({ entry }: { entry: AgentSyncSkillEntry }) {
  return (
    <div className='agents-hub-sync-row is-compact'>
      <div className='agents-hub-sync-row-main'>
        <StatusDot tone={entryTone(entry.state)} title={AGENT_SYNC_SKILL_ENTRY_LABELS[entry.state]} />
        <div className='agents-hub-sync-row-text'>
          <span className='agents-hub-sync-row-label'>
            {entry.name}
            {entry.ghostexBundled ? <Pill>Ghostex bundled</Pill> : null}
          </span>
          <span className='agents-hub-sync-row-detail'>
            {AGENT_SYNC_SKILL_ENTRY_LABELS[entry.state]}
            {entry.linkTarget ? ` → ${entry.linkTarget}` : ''}
          </span>
        </div>
      </div>
    </div>
  );
}

function SkillBucket({ entries, label, sub }: { entries: AgentSyncSkillEntry[]; label: string; sub?: string }) {
  const [expanded, setExpanded] = useState(false);
  if (entries.length === 0) {
    return null;
  }
  const visible = expanded ? entries : entries.slice(0, 6);
  return (
    <>
      <div className='agents-hub-sync-group-label'>
        {label}{' '}
        <span>
          ({entries.length}
          {sub ? `, ${sub}` : ''})
        </span>
      </div>
      {visible.map((entry) => (
        <SkillRow entry={entry} key={entry.path} />
      ))}
      {entries.length > visible.length ? (
        <button className='agents-hub-sync-more' onClick={() => setExpanded(true)} type='button'>
          + {entries.length - visible.length} more
        </button>
      ) : expanded && entries.length > 6 ? (
        <button className='agents-hub-sync-more' onClick={() => setExpanded(false)} type='button'>
          Show fewer
        </button>
      ) : null}
    </>
  );
}

type PartLine = { icon: ReactNode; text: string; tone?: 'ok' | 'warn' | 'err' };

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function PartCard({
  children,
  fixCount,
  icon,
  lines,
  name,
  neutralPill,
  onFix,
  state,
  tone,
}: {
  children?: ReactNode;
  fixCount: number;
  icon: ReactNode;
  lines: PartLine[];
  name: string;
  /** Shown instead of a status when the part does not apply to this agent. */
  neutralPill?: string;
  onFix: () => void;
  state: string;
  tone: AgentSyncDotTone;
}) {
  return (
    <div className='agents-hub-sync-part'>
      <div className='agents-hub-sync-part-head'>
        <span className={cn('agents-hub-sync-icon-tile', tone !== 'off' && `is-${tone}`)}>{icon}</span>
        <div className='agents-hub-sync-fix-text'>
          <span className='agents-hub-sync-part-name'>
            {name}
            {neutralPill ? (
              <Pill>{neutralPill}</Pill>
            ) : fixCount > 0 ? (
              <Pill tone={tone === 'err' ? 'err' : 'warn'}>{`${fixCount} to fix`}</Pill>
            ) : (
              <Pill tone='ok'>In sync</Pill>
            )}
          </span>
          <span className='agents-hub-sync-part-state'>{state}</span>
        </div>
        {fixCount > 0 ? (
          <Button onClick={onFix} size='sm' type='button' variant='outline'>
            Fix…
          </Button>
        ) : null}
      </div>
      {lines.length > 0 || children ? (
        <div className='agents-hub-sync-part-body'>
          {lines.map((line) => (
            <div className={cn('agents-hub-sync-part-line', line.tone && `is-${line.tone}`)} key={line.text}>
              {line.icon}
              <span>{line.text}</span>
            </div>
          ))}
          {children}
        </div>
      ) : null}
    </div>
  );
}

/**
 * CDXC:AgentSync 2026-09-22 WHY:
 * Every agent shows the same three cards in the same order as the overview's coverage cards (Skills, Instructions, Hook scripts). Each card is one sentence on the current state, then what Sync will do and what it leaves alone; the full per-skill list sits behind a disclosure because it is reference material, not something to act on.
 */
export function SyncAgentPane({
  agent,
  onOpenPlan,
  onRefresh,
  report,
  vscode,
}: {
  agent: AgentSyncAgentReport;
  onOpenPlan: (scope: string, groups?: AgentSyncPlanGroupKind[]) => void;
  onRefresh: () => void;
  report: AgentSyncReport;
  vscode: WebviewApi;
}) {
  const [showSkills, setShowSkills] = useState(false);
  const skills = agent.skills;
  const counts = skills?.counts;
  const openFolder = (path: string) =>
    vscode.postMessage({ path: expandHomePath(path, report.home), type: 'openAgentsHubPathInFinder' });
  const issues = agentSyncIssueCount(agent);
  const skillsGroups = agentSyncPartFixGroups(agent, 'skills');
  const instructionGroups = agentSyncPartFixGroups(agent, 'instructions');
  const hooksGroups = agentSyncPartFixGroups(agent, 'hooks');
  const copies = counts ? counts.copiesIdentical + counts.copiesDrifted : 0;

  const skillLines: PartLine[] = [];
  if (skills && counts) {
    if (counts.dangling > 0) {
      skillLines.push({
        icon: <IconLinkOff size={14} />,
        text: `${plural(counts.dangling, 'link points', 'links point')} to a skill that no longer exists`,
        tone: 'err',
      });
    }
    if (skills.dirState === 'wholeFolderLink') {
      skillLines.push({
        icon: <IconFolder size={14} />,
        text: 'The whole skills folder is one link. It becomes a real folder with one link per skill.',
        tone: 'warn',
      });
    }
    if (counts.copiesIdentical > 0) {
      skillLines.push({
        icon: <IconCopy size={14} />,
        text: `${plural(counts.copiesIdentical, 'skill is a copy', 'skills are copies')} identical to the original, and will be replaced with links`,
        tone: 'warn',
      });
    }
    if (counts.copiesDrifted > 0) {
      skillLines.push({
        icon: <IconCopy size={14} />,
        text: `${plural(counts.copiesDrifted, 'copy was', 'copies were')} edited here and will be kept as ${counts.copiesDrifted === 1 ? 'it is' : 'they are'}`,
        tone: 'warn',
      });
    }
    if (!agent.universal && counts.missing > 0) {
      skillLines.push({
        icon: <IconLink size={14} />,
        text: `${plural(counts.missing, 'shared skill', 'shared skills')} will be linked`,
      });
    }
    if (counts.onlyHere + counts.linkedElsewhere > 0) {
      skillLines.push({
        icon: <IconCheck size={14} />,
        text: `${plural(counts.onlyHere + counts.linkedElsewhere, 'skill exists', 'skills exist')} only in ${agent.displayName} and will stay untouched`,
        tone: 'ok',
      });
    }
  }
  const skillsState = !skills
    ? `${agent.displayName} reads the shared skills folder directly, so it needs no links.`
    : agent.universal
      ? `${agent.displayName} reads the shared skills folder directly. Sync only removes dead links here.`
      : skillsGroups.length === 0
        ? `${plural(counts!.linked + counts!.viaWholeFolder, 'shared skill is', 'shared skills are')} linked.`
        : [
            copies > 0 ? plural(copies, 'copy', 'copies') : undefined,
            counts!.dangling > 0 ? plural(counts!.dangling, 'dead link', 'dead links') : undefined,
            counts!.missing > 0
              ? `${plural(counts!.missing, 'shared skill', 'shared skills')} not linked yet`
              : undefined,
            skills.dirState === 'wholeFolderLink' ? 'the whole folder is one link' : undefined,
          ]
            .filter(Boolean)
            .join(', ')
            .replace(/^./, (first) => first.toUpperCase()) + '.';

  const instructions = agent.instructions;
  const instructionsState = !instructions
    ? `${agent.displayName} has no instruction file that Agent Sync manages.`
    : instructions.state === 'pointer'
      ? `${agent.displayName} reads your shared main.md.`
      : instructions.state === 'missing'
        ? `${agent.displayName} has no instruction file, so it does not read your shared main.md.`
        : instructions.state === 'legacyPointer'
          ? 'The instruction file mentions your shared main.md with older wording.'
          : instructions.state === 'otherContent'
            ? 'The instruction file has content of its own and does not mention your shared main.md.'
            : 'The instruction file is a link or a folder, which Agent Sync leaves alone.';
  const instructionLines: PartLine[] = !instructions
    ? []
    : instructions.state === 'missing'
      ? [{ icon: <IconFileText size={14} />, text: `A one-line file will be created at ${instructions.path}` }]
      : instructions.state === 'legacyPointer' || instructions.state === 'otherContent'
        ? [
            {
              icon: <IconFileText size={14} />,
              text: `${instructions.path} is backed up next to the original, then replaced with the one-line file`,
            },
          ]
        : [{ icon: <IconFileText size={14} />, text: instructions.path }];

  const hooksState = !agent.hooks
    ? `${agent.displayName} does not run hook scripts from a folder, so there is nothing to share.`
    : agent.hooks.state === 'linked'
      ? 'The hooks folder is linked to your shared hook scripts.'
      : agent.hooks.state === 'missing'
        ? 'The hooks folder is not linked to your shared hook scripts yet.'
        : agent.hooks.state === 'realDir'
          ? 'The hooks folder is a folder of its own. It is backed up, then linked.'
          : 'The hooks folder links somewhere else, which Agent Sync leaves alone.';
  const hookLines: PartLine[] = agent.hooks
    ? [
        { icon: <IconTerminal size={14} />, text: agent.hooks.dir },
        ...(agent.lock
          ? [
              {
                icon: agent.lock.state === 'linked' ? <IconCheck size={14} /> : <IconLink size={14} />,
                text:
                  agent.lock.state === 'linked'
                    ? 'The skills lock file is linked too'
                    : 'The skills lock file will be linked too',
                tone: agent.lock.state === 'linked' ? ('ok' as const) : undefined,
              },
            ]
          : []),
      ]
    : [];

  return (
    <div className='agents-hub-sync-detail-body'>
      <header className='agents-hub-sync-agent-header'>
        <AgentLogo agent={agent} size={40} />
        <div className='agents-hub-sync-agent-header-text'>
          <h2 className='agents-hub-sync-hero-title'>{agent.displayName}</h2>
          <span className='agents-hub-sync-agent-header-path'>{agent.root}</span>
        </div>
        <div className='agents-hub-sync-agent-header-actions'>
          <Button onClick={() => openFolder(agent.root)} size='sm' type='button' variant='ghost'>
            <IconFolderOpen data-icon='inline-start' size={14} />
            Open folder
          </Button>
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
          {agent.detected && issues > 0 ? (
            <Button onClick={() => onOpenPlan(agent.id)} type='button' variant='default'>
              Review and fix {issues}…
            </Button>
          ) : agent.detected ? (
            <Pill tone='ok'>In sync</Pill>
          ) : null}
        </div>
      </header>

      {!agent.detected ? (
        <div className='agents-hub-sync-empty'>
          This agent has no config folder on this computer
          {skills ? ', only leftover links from an earlier install' : ''}.
          {skills && counts && counts.dangling > 0 ? (
            <Button onClick={() => onOpenPlan(agent.id, ['removeDangling'])} size='sm' type='button' variant='outline'>
              Remove {plural(counts.dangling, 'dead link', 'dead links')}
            </Button>
          ) : null}
        </div>
      ) : (
        <section className='agents-hub-sync-parts'>
          <PartCard
            fixCount={skillsGroups.length}
            icon={<IconBook2 size={15} />}
            lines={skillLines}
            name='Skills'
            onFix={() => onOpenPlan(agent.id, skillsGroups)}
            state={skillsState}
            tone={agentSyncSkillsTone(agent)}
          >
            {skills && skills.entries.length > 0 ? (
              <>
                <button
                  className='agents-hub-sync-link'
                  onClick={() => setShowSkills((current) => !current)}
                  type='button'
                >
                  {showSkills ? 'Hide the skill list' : `Show all ${skills.entries.length} skills`}
                </button>
                {showSkills ? (
                  <div className='agents-hub-sync-card agents-hub-sync-skill-list'>
                    {bucketOrder.map((bucket) => (
                      <SkillBucket
                        entries={skills.entries.filter((entry) => bucket.states.includes(entry.state))}
                        key={bucket.label}
                        label={bucket.label}
                        sub={bucket.sub}
                      />
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}
          </PartCard>
          <PartCard
            fixCount={instructionGroups.length}
            icon={<IconFileText size={15} />}
            lines={instructionLines}
            name='Instructions'
            neutralPill={instructions ? undefined : 'Not used'}
            onFix={() => onOpenPlan(agent.id, instructionGroups)}
            state={instructionsState}
            tone={agentSyncInstructionsTone(agent)}
          />
          <PartCard
            fixCount={hooksGroups.length}
            icon={<IconTerminal size={15} />}
            lines={hookLines}
            name='Hook scripts'
            neutralPill={agent.hooks ? undefined : 'Not used'}
            onFix={() => onOpenPlan(agent.id, hooksGroups)}
            state={hooksState}
            tone={agentSyncHooksTone(agent)}
          />
        </section>
      )}
    </div>
  );
}
