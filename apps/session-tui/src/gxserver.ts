import { readFile } from 'node:fs/promises';
import {
  GXSERVER_PROTOCOL_VERSION,
  type GxserverPresentationSnapshot,
  type GxserverProjectDomainState,
  type GxserverRecentProjectDomainState,
  type GxserverSidebarHudResponse,
} from '@/packages/shared/gxserver-protocol';
import type { Options } from './paths';
export type Catalog = {
  snapshot: GxserverPresentationSnapshot;
  projects: GxserverProjectDomainState[];
  recentProjects: GxserverRecentProjectDomainState[];
  capturedAt: string;
};
export class Gxserver {
  constructor(readonly config: Options) {}
  async rpc<T>(path: string, params: Record<string, unknown> = {}, timeout = 5000): Promise<T> {
    if (this.config.offline) throw new Error('Offline mode: gxserver requests disabled.');
    const token = (await readFile(this.config.tokenFile, 'utf8')).trim();
    const response = await fetch(this.config.url + path, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(timeout),
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-gxserver-protocol-version': String(GXSERVER_PROTOCOL_VERSION),
      },
      body: JSON.stringify({ protocolVersion: GXSERVER_PROTOCOL_VERSION, params }),
    });
    const body = (await response.json()) as {
      ok?: boolean;
      protocolVersion?: number;
      result: T;
      error?: { message?: string };
    };
    if (!response.ok || !body.ok)
      throw new Error(body.error?.message ?? `gxserver ${response.status}: ${path}`);
    if (body.protocolVersion !== GXSERVER_PROTOCOL_VERSION) throw new Error('gxserver protocol mismatch.');
    return body.result;
  }
  async catalog(): Promise<Catalog> {
    const [{ snapshot }, { projects }, { recentProjects }] = await Promise.all([
      this.rpc<{ snapshot: GxserverPresentationSnapshot }>('/api/readPresentationSnapshot'),
      this.rpc<{ projects: GxserverProjectDomainState[] }>('/api/listProjects'),
      this.rpc<{ recentProjects: GxserverRecentProjectDomainState[] }>('/api/listRecentProjects'),
    ]);
    if (
      !Array.isArray(snapshot?.sessions) ||
      !Array.isArray(snapshot.projects) ||
      !Array.isArray(snapshot.groups) ||
      !Array.isArray(projects) ||
      !Array.isArray(recentProjects)
    )
      throw new Error('Invalid gxserver catalog.');
    return { snapshot, projects, recentProjects, capturedAt: new Date().toISOString() };
  }
  agents(projectId: string) {
    return this.rpc<GxserverSidebarHudResponse>('/api/readSidebarHud', { activeProjectId: projectId });
  }
  async create(
    projectId: string,
    agentId?: string
  ): Promise<{ projectId: string; sessionId: string; zmxName: string }> {
    const result = await this.rpc<{ session: { projectId: string; sessionId: string; zmxName: string } }>(
      agentId ? '/api/createAgentSession' : '/api/createSession',
      {
        projectId,
        surface: 'workspace',
        ...(agentId
          ? { agentId, draft: true, requireLaunchCommand: true }
          : { kind: 'terminal', lifecycleState: 'running', title: 'Terminal Session' }),
      },
      30000
    );
    return result.session;
  }
  wake(projectId: string, sessionId: string) {
    return this.rpc('/api/wakeSession', { projectId, sessionId }, 30000);
  }
}
