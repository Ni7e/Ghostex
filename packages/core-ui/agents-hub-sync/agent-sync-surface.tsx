import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/packages/components/ui/input';
import { ScrollArea } from '@/packages/components/ui/scroll-area';
import type { WebviewApi } from '../webview-api';
import type {
  AgentSyncApplyResultMessage,
  AgentSyncPlanMessage,
  AgentSyncReportMessage,
} from '../../shared/session-grid-contract';
import type { AgentSyncPlanGroupKind } from '../../shared/agent-sync';
import { agentSyncDefaultPlanGroups } from '../../shared/agent-sync';
import { SyncAgentList } from './sync-agent-list';
import { SyncAgentPane } from './sync-agent-pane';
import { SyncOverviewPane } from './sync-overview-pane';
import { SyncPlanSheet } from './sync-plan-sheet';
import { expandHomePath } from './shared';

type SheetState = {
  /** Groups chosen before the plan arrived (a problem row's fix); otherwise the plan defaults. */
  preset?: AgentSyncPlanGroupKind[];
  enabled?: Set<AgentSyncPlanGroupKind>;
  scope: string;
};

/**
 * CDXC:AgentSync 2026-09-16 WHY:
 * The tab keeps no filesystem state of its own: the report, the plan, and the apply result all
 * arrive from native, and every action is one bridge command, so the Hub, the CLI, and a
 * remote host behave identically. The plan sheet always precedes an apply.
 */
export function AgentSyncSurface({
  applyResult,
  initialAgentId,
  initialPlanScope,
  isActive,
  plan,
  report,
  vscode,
}: {
  applyResult?: AgentSyncApplyResultMessage;
  /** Story and test entry point: preselect one agent instead of the overview. */
  initialAgentId?: string;
  /** Story and test entry point: open the plan sheet for this scope on mount. */
  initialPlanScope?: string;
  isActive: boolean;
  plan?: AgentSyncPlanMessage;
  report?: AgentSyncReportMessage;
  vscode: WebviewApi;
}) {
  const [selectedId, setSelectedId] = useState(initialAgentId ?? 'all');
  const [query, setQuery] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [sheet, setSheet] = useState<SheetState | undefined>(() =>
    initialPlanScope === undefined ? undefined : { scope: initialPlanScope }
  );
  const [applying, setApplying] = useState(false);

  const hasReport = report !== undefined;
  useEffect(() => {
    if (!isActive || hasReport) {
      return;
    }
    vscode.postMessage({ type: 'requestAgentSyncReport' });
  }, [hasReport, isActive, vscode]);

  useEffect(() => {
    if (applyResult) {
      setApplying(false);
    }
  }, [applyResult]);

  const enabled = useMemo<Set<AgentSyncPlanGroupKind>>(() => {
    if (sheet?.enabled) {
      return sheet.enabled;
    }
    if (sheet?.preset) {
      return new Set(sheet.preset);
    }
    return new Set(agentSyncDefaultPlanGroups(plan && plan.scope === sheet?.scope ? plan : undefined));
  }, [plan, sheet]);

  const refresh = () => vscode.postMessage({ type: 'requestAgentSyncReport' });
  const openPlan = (scope: string, preset?: AgentSyncPlanGroupKind[]) => {
    setSheet({ preset, scope });
    vscode.postMessage({ scope, type: 'requestAgentSyncPlan' });
  };
  const closeSheet = () => {
    setSheet(undefined);
    setApplying(false);
  };
  const finishSheet = () => {
    closeSheet();
    refresh();
  };

  const selectedAgent = report?.agents.find((agent) => agent.id === selectedId);
  const sheetPlan = plan && sheet && plan.scope === sheet.scope ? plan : undefined;
  const sheetResult = applyResult && sheet && applyResult.scope === sheet.scope ? applyResult : undefined;
  const scopeLabel =
    sheet === undefined
      ? ''
      : sheet.scope === 'all'
        ? 'all agents'
        : (report?.agents.find((agent) => agent.id === sheet.scope)?.displayName ?? sheet.scope);

  return (
    <section className='agents-hub-layout agents-hub-sync-layout'>
      <aside className='agents-hub-list-pane'>
        <div className='agents-hub-search'>
          <Input
            aria-label='Search agents'
            className='h-8'
            onChange={(event) => setQuery(event.target.value)}
            placeholder='Search agents'
            value={query}
          />
        </div>
        <ScrollArea className='agents-hub-scroll'>
          {report ? (
            <SyncAgentList
              onSelect={setSelectedId}
              onToggleHidden={() => setShowHidden((current) => !current)}
              query={query}
              report={report}
              selectedId={selectedId}
              showHidden={showHidden}
            />
          ) : (
            <div className='agents-hub-empty'>
              <span>Scanning agents…</span>
            </div>
          )}
        </ScrollArea>
      </aside>
      <div className='agents-hub-sync-detail'>
        {!report ? (
          <div className='agents-hub-empty'>
            <span>Scanning agents…</span>
          </div>
        ) : report.errorMessage ? (
          <div className='agents-hub-empty'>
            <span>{report.errorMessage}</span>
          </div>
        ) : selectedAgent ? (
          <SyncAgentPane
            agent={selectedAgent}
            onOpenPlan={openPlan}
            onRefresh={refresh}
            report={report}
            vscode={vscode}
          />
        ) : (
          <SyncOverviewPane
            onOpenFolder={(path) =>
              vscode.postMessage({ path: expandHomePath(path, report.home), type: 'openAgentsHubPathInFinder' })
            }
            onOpenPlan={openPlan}
            onRefresh={refresh}
            onSelectAgent={setSelectedId}
            report={report}
          />
        )}
      </div>
      {sheet ? (
        <SyncPlanSheet
          applying={applying}
          applyResult={sheetResult}
          enabled={enabled}
          onApply={() => {
            setApplying(true);
            vscode.postMessage({ groups: [...enabled], scope: sheet.scope, type: 'applyAgentSyncPlan' });
          }}
          onCancel={closeSheet}
          onDone={finishSheet}
          onToggleGroup={(kind, value) => {
            setSheet((current) => {
              if (!current) {
                return current;
              }
              const next = new Set(enabled);
              if (value) {
                next.add(kind);
              } else {
                next.delete(kind);
              }
              return { ...current, enabled: next };
            });
          }}
          plan={sheetPlan}
          scopeLabel={scopeLabel}
        />
      ) : null}
    </section>
  );
}
