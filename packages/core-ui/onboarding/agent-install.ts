import { useEffect, useRef } from 'react';
import type { AgentCliConnection, AgentCliMethod } from '@/packages/shared/agent-cli-maintenance';
import { defaultAgentCliInstallMethod, useAgentCliJob } from '../agent-cli/use-agent-cli-job';

/** What an install row tells the Agents panel so the scan log can print real job events. */
export type AgentInstallEvent =
  | { kind: 'started'; agentId: string; name: string; methodLabel: string }
  | { kind: 'output'; agentId: string; name: string; line: string }
  | { kind: 'succeeded'; agentId: string; name: string }
  | { kind: 'failed'; agentId: string; name: string; error: string };

const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const LOG_LINE_MAX = 72;

/** The last non-empty line of a job's output, without ANSI colour codes, short enough for one scan-log row. */
export function lastOutputLine(output: string | undefined): string | undefined {
  if (!output) return undefined;
  const lines = output.replace(ANSI, '').split(/\r?\n|\r/);
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index].trim();
    if (line) return line.length > LOG_LINE_MAX ? line.slice(0, LOG_LINE_MAX - 1) + '…' : line;
  }
  return undefined;
}

export type AgentInstallRow = {
  /** The method an Install click will run (see `defaultAgentCliInstallMethod`); undefined until the state is read. */
  method: AgentCliMethod | undefined;
  /** The first read has not answered yet. */
  checking: boolean;
  /** A job is running (or was just started). */
  running: boolean;
  /** gxserver already finds the CLI on PATH even though detection has not caught up yet. */
  installed: boolean;
  /** The failure to show under the row: a start that was refused, or the job's own error / last line. */
  error: string | undefined;
  install: () => void;
};

/**
 * CDXC:Onboarding 2026-09-15 WHY:
 * The scan log must only ever print real job state (no scripted lines), so this hook derives every event from the
 * polled `AgentCliState` and narrates only jobs it saw running (started here, or found running on the server): a
 * job that already finished before the panel opened, for example from Settings, still shows its failure inline
 * under the row, but it is not narrated as if it just happened.
 */
export function useAgentInstallRow({
  agentId,
  name,
  connection,
  eager,
  onEvent,
}: {
  agentId: string;
  name: string;
  connection: AgentCliConnection | undefined;
  eager: boolean;
  onEvent: (event: AgentInstallEvent) => void;
}): AgentInstallRow {
  /** Job ids this row watched while they were running; only those are narrated to the scan log. */
  const tracked = useRef(new Set<string>());
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  // Success is narrated from the effect below (after the job's last output line), not from `onInstalled`.
  const job = useAgentCliJob({ agentId, connection, eager });
  const { state, actionError } = job;
  const jobId = state?.job?.id;
  const jobStatus = state?.job?.status;
  const jobError = state?.job?.error;
  const line = lastOutputLine(state?.job?.output);

  const reported = useRef<{ job?: string; line?: string; ended?: string }>({});
  useEffect(() => {
    if (!jobId) return;
    if (jobStatus === 'running' && !tracked.current.has(jobId)) tracked.current.add(jobId);
    if (!tracked.current.has(jobId)) return;
    const seen = reported.current;
    if (seen.job !== jobId) {
      seen.job = jobId;
      seen.line = undefined;
      seen.ended = undefined;
      const method = state?.methods.find((entry) => entry.command === state.job?.command);
      onEventRef.current({ kind: 'started', agentId, name, methodLabel: method?.label ?? 'its installer' });
    }
    if (line && seen.line !== line) {
      seen.line = line;
      onEventRef.current({ kind: 'output', agentId, name, line });
    }
    if (jobStatus === 'failed' && seen.ended !== jobId) {
      seen.ended = jobId;
      onEventRef.current({ kind: 'failed', agentId, name, error: jobError ?? line ?? 'The install failed.' });
    }
    if (jobStatus === 'succeeded' && seen.ended !== jobId) {
      seen.ended = jobId;
      onEventRef.current({ kind: 'succeeded', agentId, name });
    }
  }, [agentId, name, jobId, jobStatus, jobError, line, state]);

  const reportedActionError = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!actionError || reportedActionError.current === actionError) return;
    reportedActionError.current = actionError;
    onEventRef.current({ kind: 'failed', agentId, name, error: actionError });
  }, [actionError, agentId, name]);

  return {
    method: defaultAgentCliInstallMethod(state),
    checking: job.loading && !state,
    running: job.running,
    installed: Boolean(state?.executablePath),
    error: actionError ?? (jobStatus === 'failed' ? (jobError ?? line ?? 'The install failed.') : undefined),
    install: () => {
      if (job.running) return;
      void job.install();
    },
  };
}
