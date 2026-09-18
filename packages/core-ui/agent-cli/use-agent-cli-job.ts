import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AgentCliConnection,
  AgentCliJob,
  AgentCliMethod,
  AgentCliState,
} from '@/packages/shared/agent-cli-maintenance';

/** How often a running install/update job is re-read from gxserver. */
export const AGENT_CLI_JOB_POLL_MS = 1500;

/**
 * The method an install starts with when the user did not pick one: the first method the computer can run
 * (no `unavailableReason`), otherwise the first listed one so its reason can be shown. Undefined once the CLI
 * is installed, because updates must go through the detected method instead.
 */
export function defaultAgentCliInstallMethod(state: AgentCliState | undefined): AgentCliMethod | undefined {
  if (!state || state.executablePath) return undefined;
  return state.methods.find((method) => !method.unavailableReason) ?? state.methods[0];
}

export type AgentCliJobHook = {
  state: AgentCliState | undefined;
  /** A `read` request is in flight. */
  loading: boolean;
  /** The last `read` failed (transport or server error). */
  error: string | undefined;
  /** The last `start` failed before the job existed (for example another job is still running). */
  actionError: string | undefined;
  /** `start` was called and its reply has not arrived yet. */
  starting: boolean;
  /** `starting`, or the server reports a running job. */
  running: boolean;
  /** Re-read the CLI state now. */
  refresh: () => void;
  /** Start an install or update with an explicit method; resolves once the server acknowledged the job. */
  start: (operation: 'install' | 'update', methodId: string) => Promise<void>;
  /** Read the state when it is not loaded yet, then install through `defaultAgentCliInstallMethod`. */
  install: () => Promise<void>;
};

/**
 * CDXC:AgentProviders 2026-09-15 SEE-ALSO:
 * One owner for the agent CLI job lifecycle (read, poll every 1.5 s while a job runs, `onInstalled` once per
 * succeeded job id, start with a timed-out reply still counted as started) so Settings > Agents
 * (`AgentCliControls`) and the onboarding Agents panel (packages/core-ui/onboarding/agent-install.ts) cannot drift
 * apart. The server side is server/src/agent_cli/endpoint.rs.
 */
export function useAgentCliJob({
  agentId,
  connection,
  eager = true,
  onInstalled,
}: {
  agentId: string;
  connection: AgentCliConnection | undefined;
  /** Read the state as soon as a connection exists; `false` defers the first read to `install()`. */
  eager?: boolean;
  /** Called once per succeeded job id, with that job. */
  onInstalled?: (job: AgentCliJob) => void;
}): AgentCliJobHook {
  const [state, setState] = useState<AgentCliState>();
  const [error, setError] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [refreshCount, setRefreshCount] = useState(0);
  const completedJob = useRef<string | undefined>(undefined);
  const onInstalledRef = useRef(onInstalled);
  onInstalledRef.current = onInstalled;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const read = useCallback(
    async (signal: { active: boolean }) => {
      if (!connection) return;
      setLoading(true);
      try {
        const next = await connection.request({ action: 'read', agentId });
        if (!signal.active || !mounted.current) return;
        setState(next);
        setError(undefined);
        if (next.job?.status === 'succeeded' && completedJob.current !== next.job.id) {
          completedJob.current = next.job.id;
          onInstalledRef.current?.(next.job);
        }
      } catch (cause) {
        if (signal.active && mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (signal.active && mounted.current) setLoading(false);
      }
    },
    [agentId, connection]
  );

  useEffect(() => {
    // Lazy rows read on their first `refresh` (after `install` or `start`), never on mount.
    if (!connection || (!eager && refreshCount === 0)) return;
    const signal = { active: true };
    void read(signal);
    return () => {
      signal.active = false;
    };
  }, [connection, eager, read, refreshCount]);

  const jobId = state?.job?.id;
  const jobStatus = state?.job?.status;
  const jobOutput = state?.job?.output;
  useEffect(() => {
    if (!connection || jobStatus !== 'running') return;
    const signal = { active: true };
    const timer = setTimeout(() => void read(signal), AGENT_CLI_JOB_POLL_MS);
    return () => {
      signal.active = false;
      clearTimeout(timer);
    };
    // Every poll returns a new state object; keying on the job fields restarts the timer only after a read landed.
  }, [connection, jobId, jobStatus, jobOutput, read]);

  const refresh = useCallback(() => setRefreshCount((value) => value + 1), []);

  const start = useCallback(
    async (operation: 'install' | 'update', methodId: string) => {
      if (!connection) return;
      setStarting(true);
      setActionError(undefined);
      try {
        const next = await connection.request({ action: 'start', agentId, operation, methodId });
        if (!mounted.current) return;
        setState(next);
        setRefreshCount((value) => value + 1);
      } catch (cause) {
        if (mounted.current) {
          setActionError(cause instanceof Error ? cause.message : String(cause));
          // A timed-out start response can still have started the server-owned job.
          setRefreshCount((value) => value + 1);
        }
      } finally {
        if (mounted.current) setStarting(false);
      }
    },
    [agentId, connection]
  );

  const install = useCallback(async () => {
    if (!connection) return;
    setStarting(true);
    setActionError(undefined);
    try {
      let current = state;
      if (!current) {
        current = await connection.request({ action: 'read', agentId });
        if (!mounted.current) return;
        setState(current);
        setError(undefined);
      }
      if (current.executablePath) return;
      const method = defaultAgentCliInstallMethod(current);
      if (!method) throw new Error('No install method is available on this computer. Follow the install docs.');
      if (method.unavailableReason) throw new Error(method.unavailableReason);
      const next = await connection.request({ action: 'start', agentId, operation: 'install', methodId: method.id });
      if (!mounted.current) return;
      setState(next);
    } catch (cause) {
      if (mounted.current) setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (mounted.current) {
        setStarting(false);
        // Mirrors `start`: a timed-out reply can still have started the server-owned job, so re-read either way.
        setRefreshCount((value) => value + 1);
      }
    }
  }, [agentId, connection, state]);

  return {
    state,
    loading,
    error,
    actionError,
    starting,
    running: starting || jobStatus === 'running',
    refresh,
    start,
    install,
  };
}
