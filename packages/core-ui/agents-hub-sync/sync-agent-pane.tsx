import { useState } from 'react';
import { IconFileText, IconFolderOpen, IconLink, IconRefresh } from '@tabler/icons-react';
import { Button } from '@/packages/components/ui/button';
import { cn } from '@/packages/components/utils';
import type { WebviewApi } from '../webview-api';
import type {
  AgentSyncAgentReport,
  AgentSyncPlanGroupKind,
  AgentSyncReport,
  AgentSyncSkillEntry,
  AgentSyncSkillEntryState,
} from '../../shared/agent-sync';
import { AGENT_SYNC_INSTRUCTION_LABELS, AGENT_SYNC_SKILL_ENTRY_LABELS } from '../../shared/agent-sync';
import { AgentLogo, Pill, StatusDot, expandHomePath } from './shared';

const bucketOrder: { label: string; states: AgentSyncSkillEntryState[]; sub?: string }[] = [
  { label: 'Broken', states: ['dangling'] },
  { label: 'Copies that also exist in the source', states: ['copyIdentical', 'copyDrifted'] },
  { label: 'Only here', states: ['onlyHere', 'linkedElsewhere'], sub: 'not in the source' },
  { label: 'Linked', states: ['linked', 'viaWholeFolder'] },
  { label: 'Missing here', states: ['missing'], sub: 'in the source, not linked yet' },
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
  const skills = agent.skills;
  const counts = skills?.counts;
  const openFolder = (path: string) =>
    vscode.postMessage({ path: expandHomePath(path, report.home), type: 'openAgentsHubPathInFinder' });
  return (
    <>
      <div className='agents-hub-sync-toolbar'>
        <div className='agents-hub-sync-toolbar-title'>
          <AgentLogo agent={agent} size={22} />
          <span>{agent.displayName}</span>
          <span className='agents-hub-sync-toolbar-path'>{agent.root}</span>
        </div>
        <div className='agents-hub-sync-toolbar-actions'>
          <Button onClick={() => openFolder(agent.root)} size='sm' type='button' variant='ghost'>
            <IconFolderOpen data-icon='inline-start' size={14} />
            Open folder
          </Button>
          <Button aria-label='Refresh' onClick={onRefresh} size='sm' type='button' variant='ghost'>
            <IconRefresh size={14} />
          </Button>
          {agent.detected ? (
            <Button onClick={() => onOpenPlan(agent.id)} size='sm' type='button' variant='default'>
              Sync {agent.displayName}…
            </Button>
          ) : null}
        </div>
      </div>
      <div className='agents-hub-sync-detail-body'>
        {!agent.detected ? (
          <div className='agents-hub-sync-empty'>
            This agent has no config folder on this computer
            {skills ? ', only leftover links from an earlier install' : ''}.
            {skills && counts && counts.dangling > 0 ? (
              <Button
                onClick={() => onOpenPlan(agent.id, ['removeDangling'])}
                size='sm'
                type='button'
                variant='outline'
              >
                Remove {counts.dangling} dangling link{counts.dangling === 1 ? '' : 's'}
              </Button>
            ) : null}
          </div>
        ) : null}

        {agent.detected && skills && counts ? (
          <section className='agents-hub-sync-section'>
            <div className='agents-hub-sync-section-header'>
              <h3 className='agents-hub-sync-section-title'>
                Skills
                {counts.dangling > 0 ? <Pill tone='err'>{`${counts.dangling} broken`}</Pill> : null}
                {counts.copiesIdentical + counts.copiesDrifted > 0 ? (
                  <Pill tone='warn'>{`${counts.copiesIdentical + counts.copiesDrifted} copies`}</Pill>
                ) : null}
                {skills.dirState === 'wholeFolderLink' ? <Pill tone='warn'>Whole-folder link</Pill> : null}
                {counts.linked > 0 ? <Pill tone='ok'>{`${counts.linked} linked`}</Pill> : null}
                <span className='sub'>{skills.dir}</span>
              </h3>
              <div className='agents-hub-sync-section-actions'>
                {counts.dangling > 0 ? (
                  <Button
                    onClick={() => onOpenPlan(agent.id, ['removeDangling'])}
                    size='sm'
                    type='button'
                    variant='outline'
                  >
                    Remove broken links
                  </Button>
                ) : null}
                {skills.dirState === 'wholeFolderLink' ? (
                  <Button
                    onClick={() => onOpenPlan(agent.id, ['convertWholeFolder'])}
                    size='sm'
                    type='button'
                    variant='outline'
                  >
                    Convert to per-skill links
                  </Button>
                ) : null}
                {counts.copiesIdentical > 0 || (!agent.universal && counts.missing > 0) ? (
                  <Button
                    onClick={() => onOpenPlan(agent.id, ['perSkillLinks'])}
                    size='sm'
                    type='button'
                    variant='outline'
                  >
                    {counts.copiesIdentical > 0 && counts.missing > 0
                      ? `Replace ${counts.copiesIdentical} copies and link ${counts.missing} more`
                      : counts.copiesIdentical > 0
                        ? `Replace ${counts.copiesIdentical} copies with links`
                        : `Link all ${counts.missing}`}
                  </Button>
                ) : null}
              </div>
            </div>
            <div className='agents-hub-sync-card'>
              <div className='agents-hub-sync-row'>
                <div className='agents-hub-sync-row-main'>
                  <span className='agents-hub-sync-icon-tile'>
                    <IconLink size={14} />
                  </span>
                  <div className='agents-hub-sync-row-text'>
                    <span className='agents-hub-sync-row-label'>
                      {agent.universal ? 'Reads the source directly' : 'Per-skill links'}
                    </span>
                    <span className='agents-hub-sync-row-detail is-sans is-wrap'>
                      {agent.universal
                        ? `${agent.displayName} reads ~/.agents/skills itself, so Sync adds no links here and only removes broken ones.`
                        : skills.dirState === 'wholeFolderLink'
                          ? `${skills.dir} is one symlink to ${skills.dirLinkTarget ?? '~/.agents/skills'}. Sync replaces it with a real folder holding one relative link per source skill, so files of the agent's own can live next to them.`
                          : `Each source skill gets one relative link, ${skills.dir}/<name> → ../../.agents/skills/<name>. Files of the agent's own stay untouched, and a skill removed from the source shows up here as a broken link on the next scan.`}
                    </span>
                  </div>
                </div>
              </div>
              {bucketOrder.map((bucket) => (
                <SkillBucket
                  entries={skills.entries.filter((entry) => bucket.states.includes(entry.state))}
                  key={bucket.label}
                  label={bucket.label}
                  sub={bucket.sub}
                />
              ))}
            </div>
          </section>
        ) : null}

        {agent.detected && agent.instructions ? (
          <section className='agents-hub-sync-section'>
            <div className='agents-hub-sync-section-header'>
              <h3 className='agents-hub-sync-section-title'>
                Instructions
                <Pill tone={agent.instructions.state === 'pointer' ? 'ok' : 'warn'}>
                  {AGENT_SYNC_INSTRUCTION_LABELS[agent.instructions.state]}
                </Pill>
              </h3>
              <div className='agents-hub-sync-section-actions'>
                {agent.instructions.state !== 'pointer' &&
                agent.instructions.state !== 'symlink' &&
                agent.instructions.state !== 'notAFile' ? (
                  <Button
                    onClick={() => onOpenPlan(agent.id, ['pointerFiles'])}
                    size='sm'
                    type='button'
                    variant='outline'
                  >
                    {agent.instructions.state === 'missing' ? 'Write pointer' : 'Back up and write pointer'}
                  </Button>
                ) : null}
              </div>
            </div>
            <div className='agents-hub-sync-card'>
              <div className='agents-hub-sync-row'>
                <div className='agents-hub-sync-row-main'>
                  <span
                    className={cn(
                      'agents-hub-sync-icon-tile',
                      agent.instructions.state === 'pointer' ? 'is-ok' : 'is-warn'
                    )}
                  >
                    <IconFileText size={14} />
                  </span>
                  <div className='agents-hub-sync-row-text'>
                    <span className='agents-hub-sync-row-label'>{agent.instructions.path}</span>
                    <span className='agents-hub-sync-row-detail is-sans is-wrap'>
                      {agent.instructions.state === 'pointer'
                        ? 'Contains the one-line pointer, so this agent reads the shared instructions in ~/.agents/main.md.'
                        : agent.instructions.state === 'missing'
                          ? 'Not present. Sync writes the one-line pointer so this agent reads the shared instructions in ~/.agents/main.md.'
                          : agent.instructions.state === 'legacyPointer'
                            ? 'Mentions ~/.agents/main.md with older wording. Sync backs the file up and writes the current pointer line.'
                            : 'Has content of its own. Sync backs the file up as <name>.pre-sync-<stamp>.bak and writes only the pointer line.'}
                    </span>
                  </div>
                </div>
                <div className='agents-hub-sync-row-control'>
                  {agent.instructions.state !== 'missing' ? (
                    <Button
                      aria-label='Open file location'
                      onClick={() => openFolder(agent.instructions!.path)}
                      size='sm'
                      type='button'
                      variant='ghost'
                    >
                      <IconFolderOpen size={14} />
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {agent.detected ? (
          <section className='agents-hub-sync-section'>
            <div className='agents-hub-sync-section-header'>
              <h3 className='agents-hub-sync-section-title'>
                Hook scripts and lock file
                {agent.hooks ? (
                  <Pill tone={agent.hooks.state === 'linked' ? 'ok' : 'warn'}>
                    {agent.hooks.state === 'linked'
                      ? 'Linked'
                      : agent.hooks.state === 'missing'
                        ? 'Not linked'
                        : 'Local folder'}
                  </Pill>
                ) : (
                  <Pill>Not applicable</Pill>
                )}
              </h3>
              <div className='agents-hub-sync-section-actions'>
                {(agent.hooks && agent.hooks.state !== 'linked' && agent.hooks.state !== 'otherLink') ||
                (agent.lock && agent.lock.state !== 'linked' && agent.lock.state !== 'otherLink') ? (
                  <Button onClick={() => onOpenPlan(agent.id, ['hooks'])} size='sm' type='button' variant='outline'>
                    Link hooks and lock file
                  </Button>
                ) : null}
              </div>
            </div>
            <div className='agents-hub-sync-card'>
              <div className='agents-hub-sync-row'>
                <div className='agents-hub-sync-row-main'>
                  <span className='agents-hub-sync-icon-tile'>
                    <IconLink size={14} />
                  </span>
                  <div className='agents-hub-sync-row-text'>
                    <span className='agents-hub-sync-row-label'>
                      {agent.hooks ? agent.hooks.dir : 'Nothing to sync'}
                    </span>
                    <span className='agents-hub-sync-row-detail is-sans is-wrap'>
                      {agent.hooks
                        ? `Linked to ~/.agents/hooks so the hook config can reference scripts by path. ${agent.lock ? `The lock file ${agent.lock.path} is ${agent.lock.state === 'linked' ? 'linked' : 'not linked'} to ~/.agents/.skill-lock.json.` : ''}`
                        : "Only Claude Code and Codex read scripts from a hooks folder. Ghostex's own notify hooks are managed by Settings and are not part of Agent Sync."}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </>
  );
}
