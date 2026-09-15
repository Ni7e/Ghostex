import { useMemo, useSyncExternalStore } from 'react';
import { GXSERVER_PROTOCOL_VERSION } from '@/packages/shared/gxserver-protocol';
import type { AgentCliConnection, AgentCliState } from '@/packages/shared/agent-cli-maintenance';

let source: (() => AgentCliConnection[]) | undefined;
const listeners = new Set<() => void>();
let revision = 0;

export function notifyAgentCliConnectionsChanged(): void {
  revision++;
  listeners.forEach((listener) => listener());
}

export function setAgentCliConnectionSource(value: () => AgentCliConnection[]): void {
  source = value;
  notifyAgentCliConnectionsChanged();
}

function getConnections(): AgentCliConnection[] {
  if (source) return source();
  const bootstrap = (
    window as unknown as { ghostexGpui?: { gxserverBootstrap?: { baseUrl: string; authToken: string } } }
  ).ghostexGpui?.gxserverBootstrap;
  if (!bootstrap?.baseUrl || !bootstrap.authToken) return [];
  return [
    {
      id: 'local',
      label: 'This computer',
      request: async (params) => {
        const response = await fetch(`${bootstrap.baseUrl}/api/agentCliMaintenance`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${bootstrap.authToken}`,
            'content-type': 'application/json',
            'x-gxserver-protocol-version': String(GXSERVER_PROTOCOL_VERSION),
          },
          body: JSON.stringify({ params, protocolVersion: GXSERVER_PROTOCOL_VERSION }),
          signal: AbortSignal.timeout(30_000),
        });
        const envelope = (await response.json()) as {
          ok: boolean;
          result: AgentCliState;
          error?: { message?: string };
        };
        if (!response.ok || !envelope.ok) throw new Error(envelope.error?.message || 'The CLI request failed.');
        return envelope.result;
      },
    },
  ];
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAgentCliConnections(): AgentCliConnection[] {
  const currentRevision = useSyncExternalStore(subscribe, () => revision);
  return useMemo(getConnections, [currentRevision]);
}
