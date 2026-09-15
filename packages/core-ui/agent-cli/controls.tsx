import { useState } from 'react';
import { IconDownload, IconExternalLink, IconRefresh } from '@tabler/icons-react';
import { Button } from '@/packages/components/ui/button';
import { SelectItem, SelectTrigger, SelectValue } from '@/packages/components/ui/select';
import { AGENT_CLI_CATALOG, type AgentCliConnection } from '@/packages/shared/agent-cli-maintenance';
import { SettingsSelect, SettingsSelectContent } from '../settings-modal/fields';
import type { WebviewApi } from '../webview-api';
import { defaultAgentCliInstallMethod, useAgentCliJob } from './use-agent-cli-job';

export function AgentCliControls({
  agentId,
  connection,
  onInstalled,
  vscode,
}: {
  agentId: string;
  connection?: AgentCliConnection;
  onInstalled?: () => void;
  vscode?: WebviewApi;
}) {
  const definition = AGENT_CLI_CATALOG.find((entry) => entry.agentId === agentId);
  const [methodId, setMethodId] = useState<string>();
  const {
    state,
    loading,
    error,
    actionError,
    running,
    refresh,
    start: startJob,
  } = useAgentCliJob({ agentId, connection, eager: Boolean(definition), onInstalled });

  if (!definition) return null;
  const installed = Boolean(state?.executablePath);
  const operation = installed ? 'update' : 'install';
  const methods =
    state?.methods.filter((method) => !installed || !state.detectedMethodId || method.id === state.detectedMethodId) ??
    [];
  const selected =
    (installed ? state?.detectedMethodId : undefined) ?? methodId ?? defaultAgentCliInstallMethod(state)?.id;
  const method = methods.find((entry) => entry.id === selected);
  const status = state
    ? installed
      ? (state.version ?? 'Installed')
      : 'Not installed'
    : loading
      ? 'Checking CLI…'
      : 'Not checked';

  const start = () => {
    if (!connection || !method || running) return;
    void startJob(operation, method.id);
  };

  return (
    <div className='flex min-w-0 flex-col gap-3 border-b border-border/70 px-3 py-4' data-agent-cli={agentId}>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='flex min-w-0 flex-col gap-1'>
          <span className='text-sm font-medium'>Agent CLI</span>
          <span className='text-xs text-muted-foreground'>
            {status}
            {connection ? ` · ${connection.label}` : ''}
            {state ? ` · ${state.platform}` : ''}
          </span>
        </div>
        <div className='flex items-center gap-2'>
          {definition.docsUrl ? (
            <a
              className='inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline'
              href={definition.docsUrl}
              target='_blank'
              rel='noreferrer'
              onClick={(event) => {
                if (vscode) {
                  event.preventDefault();
                  vscode.postMessage({ type: 'openExternalUrl', url: definition.docsUrl! });
                }
              }}
            >
              Install docs
              <IconExternalLink aria-hidden='true' className='size-3.5' />
            </a>
          ) : null}
          <Button
            aria-label={`Refresh ${definition.binary} CLI status`}
            disabled={!connection || loading || running}
            onClick={refresh}
            size='icon-sm'
            variant='ghost'
          >
            <IconRefresh aria-hidden='true' className={loading ? 'animate-spin' : undefined} />
          </Button>
        </div>
      </div>
      {state?.executablePath ? (
        <code className='break-all text-xs text-muted-foreground'>{state.executablePath}</code>
      ) : null}
      {!connection ? (
        <p className='text-xs text-muted-foreground'>Connect to a computer to manage its agent CLIs.</p>
      ) : null}
      {state && methods.length === 0 ? (
        <p className='text-xs text-muted-foreground'>Follow the installation docs for this platform.</p>
      ) : null}
      {methods.length ? (
        <>
          <div className='flex flex-wrap items-center gap-2'>
            <SettingsSelect
              items={methods.map((entry) => ({ label: entry.label, value: entry.id }))}
              disabled={running}
              onValueChange={(value) => setMethodId(value ?? undefined)}
              value={selected ?? null}
            >
              <SelectTrigger aria-label={`Installation method for ${definition.binary}`} className='h-8 min-w-0 flex-1'>
                <SelectValue placeholder={installed ? 'Choose how this CLI was installed' : 'Installation method'} />
              </SelectTrigger>
              <SettingsSelectContent>
                {methods.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.label}
                  </SelectItem>
                ))}
              </SettingsSelectContent>
            </SettingsSelect>
            <Button
              disabled={running || loading || !connection || !method || Boolean(method.unavailableReason)}
              onClick={start}
              size='sm'
              variant='outline'
            >
              {running ? (
                <IconRefresh aria-hidden='true' className='animate-spin' />
              ) : installed ? (
                <IconRefresh aria-hidden='true' />
              ) : (
                <IconDownload aria-hidden='true' />
              )}
              {running
                ? state?.job?.operation === 'update'
                  ? 'Updating…'
                  : 'Installing…'
                : installed
                  ? 'Update CLI'
                  : 'Install CLI'}
            </Button>
          </div>
          {method ? (
            <code className='whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs'>{method.command}</code>
          ) : null}
          {method?.unavailableReason ? (
            <p className='text-xs text-muted-foreground'>{method.unavailableReason}</p>
          ) : null}
        </>
      ) : null}
      {state?.versionError ? (
        <p className='text-xs text-muted-foreground'>Version check failed: {state.versionError}</p>
      ) : null}
      {error || actionError ? (
        <p role='alert' className='text-xs text-destructive'>
          {actionError ?? error}
        </p>
      ) : null}
      {state?.job ? (
        <div className='min-w-0 text-xs' aria-live='polite'>
          <p className={state.job.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}>
            {state.job.status === 'running'
              ? 'Running. You can close Settings and return to check progress.'
              : state.job.status === 'failed'
                ? (state.job.error ?? 'CLI operation failed.')
                : 'CLI command completed. Start a new session to use the installed version.'}
          </p>
          {state.job.output ? (
            <details className='mt-2'>
              <summary className='cursor-pointer text-muted-foreground'>Command output</summary>
              <pre
                tabIndex={0}
                className='mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2'
              >
                {state.job.output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')}
              </pre>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
