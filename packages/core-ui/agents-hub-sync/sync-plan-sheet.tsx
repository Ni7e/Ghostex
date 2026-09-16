import { useState } from 'react';
import { Button } from '@/packages/components/ui/button';
import { Switch } from '@/packages/components/ui/switch';
import { cn } from '@/packages/components/utils';
import type {
  AgentSyncApplyResult,
  AgentSyncPlan,
  AgentSyncPlanGroup,
  AgentSyncPlanGroupKind,
  AgentSyncPlanOp,
} from '../../shared/agent-sync';
import { AGENT_SYNC_VERB_LABELS, agentSyncPlanChangeCount } from '../../shared/agent-sync';
import { playCopySound } from '../copy-sound';
import { Pill } from './shared';

function shellQuote(path: string): string {
  if (path.startsWith('~/')) {
    const rest = path.slice(2);
    return /[^A-Za-z0-9._\/-]/.test(rest) ? `"$HOME/${rest.replace(/(["$`\\])/g, '\\$1')}"` : `~/${rest}`;
  }
  return /[^A-Za-z0-9._\/-]/.test(path) ? `'${path.replace(/'/g, `'\\''`)}'` : path;
}

/**
 * CDXC:AgentSync 2026-09-16 WHY:
 * The plan doubles as a shell script so the same operations can be read, kept, or run on
 * another computer; it emits only ln, mv, rm, mkdir and heredocs, never rm -r.
 */
export function planToShellScript(plan: AgentSyncPlan, enabled: ReadonlySet<AgentSyncPlanGroupKind>): string {
  const lines: string[] = [
    '#!/usr/bin/env bash',
    '# Ghostex Agent Sync plan',
    `# scope: ${plan.scope}, backups use .pre-sync-${plan.stamp}.bak`,
    'set -euo pipefail',
    '',
  ];
  const drops: string[] = [];
  for (const group of plan.groups) {
    if (!enabled.has(group.kind)) {
      continue;
    }
    lines.push(`# ${group.title}`);
    for (const op of group.ops) {
      switch (op.verb) {
        case 'keep':
          break;
        case 'unlink':
          lines.push(`rm ${shellQuote(op.path)}`);
          break;
        case 'mkdir':
          lines.push(`mkdir -p ${shellQuote(op.path)}`);
          break;
        case 'backup':
          lines.push(`mv ${shellQuote(op.path)} ${shellQuote(op.target ?? `${op.path}.bak`)}`);
          break;
        case 'link':
          lines.push(`ln -s ${shellQuote(op.target ?? '')} ${shellQuote(op.path)}`);
          break;
        case 'write':
          lines.push(`mkdir -p "$(dirname ${shellQuote(op.path)})"`);
          lines.push(`cat > ${shellQuote(op.path)} <<'GHOSTEX_EOF'`);
          lines.push((op.content ?? '').replace(/\n$/, ''));
          lines.push('GHOSTEX_EOF');
          break;
        case 'drop':
          if (op.target) {
            drops.push(op.target);
          }
          break;
      }
    }
    lines.push('');
  }
  if (drops.length > 0) {
    lines.push('# Prune stale lock entries (needs jq)');
    lines.push(
      `jq 'del(.skills["${drops.join('"], .skills["')}"])' ~/.agents/.skill-lock.json > ~/.agents/.skill-lock.json.tmp && mv ~/.agents/.skill-lock.json.tmp ~/.agents/.skill-lock.json`
    );
    lines.push('');
  }
  return lines.join('\n');
}

function OpLine({ op }: { op: AgentSyncPlanOp }) {
  const target =
    op.verb === 'link' || op.verb === 'backup'
      ? ` → ${op.target ?? ''}`
      : op.verb === 'drop'
        ? ` ${op.target ?? ''}`
        : '';
  return (
    <div className='agents-hub-sync-plan-line'>
      <span className={cn('agents-hub-sync-plan-verb', `is-${op.verb}`)}>{AGENT_SYNC_VERB_LABELS[op.verb]}</span>
      <span className='agents-hub-sync-plan-what' title={`${op.path}${target}${op.note ? `\n${op.note}` : ''}`}>
        {op.path}
        {target}
        {op.note ? <em> {op.note}</em> : null}
      </span>
    </div>
  );
}

function PlanGroupView({
  enabled,
  group,
  onToggle,
}: {
  enabled: boolean;
  group: AgentSyncPlanGroup;
  onToggle: (enabled: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const changes = group.ops.filter((op) => op.verb !== 'keep');
  const visible = expanded ? changes : changes.slice(0, 8);
  return (
    <div className={cn('agents-hub-sync-plan-group', !enabled && 'is-off')}>
      <div className='agents-hub-sync-plan-group-head'>
        <Switch aria-label={group.title} checked={enabled} onCheckedChange={(checked) => onToggle(checked === true)} />
        <span className='agents-hub-sync-plan-group-title'>{group.title}</span>
        <Pill
          tone={
            group.changeCount === 0
              ? undefined
              : group.kind === 'removeDangling'
                ? 'err'
                : group.kind === 'pruneLock'
                  ? 'warn'
                  : 'ok'
          }
        >
          {`${group.changeCount}`}
        </Pill>
        {group.kind === 'pruneLock' ? (
          <span className='agents-hub-sync-muted'>off by default; the skills CLI re-adds anything it reinstalls</span>
        ) : null}
        {group.ops.length - changes.length > 0 ? (
          <span className='agents-hub-sync-muted'>{group.ops.length - changes.length} already correct</span>
        ) : null}
      </div>
      {changes.length === 0 ? (
        <div className='agents-hub-sync-plan-line'>
          <span className='agents-hub-sync-plan-verb is-keep'>keep</span>
          <span className='agents-hub-sync-plan-what'>nothing to change</span>
        </div>
      ) : (
        <>
          {visible.map((op, index) => (
            <OpLine key={`${op.verb}-${op.path}-${index}`} op={op} />
          ))}
          {changes.length > visible.length ? (
            <button className='agents-hub-sync-more' onClick={() => setExpanded(true)} type='button'>
              + {changes.length - visible.length} more
            </button>
          ) : expanded && changes.length > 8 ? (
            <button className='agents-hub-sync-more' onClick={() => setExpanded(false)} type='button'>
              Show fewer
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

export function SyncPlanSheet({
  applying,
  applyResult,
  enabled,
  onApply,
  onCancel,
  onDone,
  onToggleGroup,
  plan,
  scopeLabel,
}: {
  applying: boolean;
  applyResult?: AgentSyncApplyResult & { errorMessage?: string };
  enabled: ReadonlySet<AgentSyncPlanGroupKind>;
  onApply: () => void;
  onCancel: () => void;
  onDone: () => void;
  onToggleGroup: (kind: AgentSyncPlanGroupKind, enabled: boolean) => void;
  plan?: AgentSyncPlan & { errorMessage?: string };
  scopeLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  const changeCount = plan ? agentSyncPlanChangeCount(plan, enabled) : 0;
  const copyScript = () => {
    if (!plan) {
      return;
    }
    void navigator.clipboard.writeText(planToShellScript(plan, enabled)).then(() => {
      playCopySound();
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className='agents-hub-sync-scrim' role='presentation'>
      <div aria-label='Sync plan' className='agents-hub-sync-sheet' role='dialog'>
        <div className='agents-hub-sync-sheet-head'>
          <span>{applyResult ? `Sync ${scopeLabel} · result` : `Sync ${scopeLabel}`}</span>
          {plan && !applyResult ? (
            <span className='agents-hub-sync-plan-summary'>
              <Pill tone='ok'>{`${plan.summary.links.toLocaleString()} links`}</Pill>
              <Pill tone='info'>{`${plan.summary.writes} pointer files`}</Pill>
              <Pill tone='warn'>{`${plan.summary.backups} backups`}</Pill>
              <Pill tone='err'>{`${plan.summary.unlinks} removals`}</Pill>
            </span>
          ) : null}
        </div>
        <div className='agents-hub-sync-sheet-body'>
          {applyResult ? (
            <>
              {applyResult.errorMessage ? (
                <div className='agents-hub-sync-verdict is-err'>{applyResult.errorMessage}</div>
              ) : (
                <div className={cn('agents-hub-sync-verdict', applyResult.failed.length === 0 ? 'is-ok' : 'is-warn')}>
                  {applyResult.done.length.toLocaleString()} operation{applyResult.done.length === 1 ? '' : 's'} done,{' '}
                  {applyResult.failed.length} failed, {applyResult.skippedKeeps} already correct.
                  {applyResult.failed.length > 0
                    ? ' Fix the failures below and run Sync again; the plan is idempotent.'
                    : ''}
                </div>
              )}
              {applyResult.failed?.map((failure, index) => (
                <div className='agents-hub-sync-plan-line' key={`${failure.op.path}-${index}`}>
                  <span className='agents-hub-sync-plan-verb is-unlink'>failed</span>
                  <span className='agents-hub-sync-plan-what'>
                    {AGENT_SYNC_VERB_LABELS[failure.op.verb]} {failure.op.path}
                    <em> {failure.error}</em>
                  </span>
                </div>
              ))}
            </>
          ) : !plan ? (
            <div className='agents-hub-sync-empty'>Computing the plan…</div>
          ) : plan.errorMessage ? (
            <div className='agents-hub-sync-verdict is-err'>{plan.errorMessage}</div>
          ) : (
            <>
              <div className='agents-hub-sync-verdict'>
                Nothing is deleted. Anything in the way of a link is renamed to{' '}
                <code>{`<name>.pre-sync-${plan.stamp}.bak`}</code> first, dangling links are removed, and every other
                file is left alone. Switch a group off to skip it.
              </div>
              {plan.groups.map((group) => (
                <PlanGroupView
                  enabled={enabled.has(group.kind)}
                  group={group}
                  key={group.kind}
                  onToggle={(value) => onToggleGroup(group.kind, value)}
                />
              ))}
            </>
          )}
        </div>
        <div className='agents-hub-sync-sheet-foot'>
          {applyResult ? (
            <Button onClick={onDone} size='sm' type='button' variant='default'>
              Done
            </Button>
          ) : (
            <>
              <Button disabled={!plan || applying} onClick={copyScript} size='sm' type='button' variant='ghost'>
                {copied ? 'Copied' : 'Copy as shell script'}
              </Button>
              <Button disabled={applying} onClick={onCancel} size='sm' type='button' variant='ghost'>
                Cancel
              </Button>
              <Button
                disabled={!plan || applying || changeCount === 0}
                onClick={onApply}
                size='sm'
                type='button'
                variant='default'
              >
                {applying
                  ? 'Applying…'
                  : changeCount === 0
                    ? 'Nothing to apply'
                    : `Apply ${changeCount.toLocaleString()} change${changeCount === 1 ? '' : 's'}`}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
