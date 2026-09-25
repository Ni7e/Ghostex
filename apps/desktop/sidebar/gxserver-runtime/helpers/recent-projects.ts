import { storageScope } from '@/packages/client-storage';
/*
CDXC:RepoStructure 2026-08-22:
Split out of the single 21,861-line `gxserver-runtime.ts`. Pure move: no logic
changed. See `core.ts` for how the runtime's methods are re-attached.
*/
import { GPUI_REMOTE_GROUP_ORDER_STORAGE_KEY, GPUI_REMOTE_RECENT_PROJECTS_STORAGE_KEY } from '../constants';
import { normalizeNonEmptyString } from './records';
import type {
  GxserverProjectId,
  GxserverRecentProjectDomainState,
} from '@/packages/shared/gxserver-protocol';

const clientStorage = storageScope(["remoteOrder","remoteRecents"]);

/*
CDXC:RemoteMachines 2026-07-12:
Per-machine remote project group order is app-client presentation state, like
the remote recent-projects list: the remote gxserver keeps publishing its own
group order and this map only reorders the projection locally. Persist only
machine ids and remote project ids.
*/
export function readStoredGpuiRemoteGroupOrder(): Map<string, string[]> {
  try {
    const raw: unknown = JSON.parse(clientStorage.getItem(GPUI_REMOTE_GROUP_ORDER_STORAGE_KEY) ?? '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return new Map();
    }
    const next = new Map<string, string[]>();
    for (const [machineId, order] of Object.entries(raw)) {
      if (!machineId.trim() || !Array.isArray(order)) {
        continue;
      }
      const projectIds = order.filter(
        (projectId): projectId is string => typeof projectId === 'string' && projectId.trim().length > 0
      );
      if (projectIds.length > 0) {
        next.set(machineId, projectIds);
      }
    }
    return next;
  } catch {
    return new Map();
  }
}

export function writeStoredGpuiRemoteGroupOrder(orderByMachineId: ReadonlyMap<string, readonly string[]>): void {
  try {
    clientStorage.setItem(GPUI_REMOTE_GROUP_ORDER_STORAGE_KEY, JSON.stringify(Object.fromEntries(orderByMachineId)));
  } catch {
    // CEF storage may be unavailable in tests or early bootstrap; the in-memory order still drives this session.
  }
}

export function readStoredGpuiRemoteRecentProjects(): Map<string, GxserverRecentProjectDomainState[]> {
  try {
    return groupGpuiRemoteRecentProjectsByMachine(
      normalizeStoredGpuiRemoteRecentProjects(
        JSON.parse(clientStorage.getItem(GPUI_REMOTE_RECENT_PROJECTS_STORAGE_KEY) ?? '[]')
      )
    );
  } catch {
    return new Map();
  }
}

export function writeStoredGpuiRemoteRecentProjects(
  projectsByMachineId: ReadonlyMap<string, readonly GxserverRecentProjectDomainState[]>
): void {
  try {
    const rows = [...projectsByMachineId.entries()].flatMap(([machineId, projects]) =>
      projects.flatMap((project) => {
        const projectId = typeof project.projectId === 'string' ? project.projectId.trim() : '';
        const title = typeof project.title === 'string' ? project.title.trim() : '';
        const path = typeof project.path === 'string' ? project.path.trim() : '';
        if (!machineId.trim() || !projectId || !title) {
          return [];
        }
        return [
          {
            machineId: machineId.trim(),
            path,
            projectId,
            recentClosedAt: typeof project.recentClosedAt === 'string' ? project.recentClosedAt : undefined,
            sessionCount: Number.isFinite(project.sessionCount) ? Math.max(0, Math.floor(project.sessionCount)) : 0,
            title,
          },
        ];
      })
    );
    /*
    CDXC:RemoteMachines 2026-06-27-19:37:
    GPUI remote recent rows are app-client state. Persist only machine id,
    remote project id, title/path needed for the disconnected drawer, timestamp,
    and count; do not persist tokens, SSH hosts, usernames, command text,
    terminal output, or local gxserver project rows.
    */
    clientStorage.setItem(GPUI_REMOTE_RECENT_PROJECTS_STORAGE_KEY, JSON.stringify(rows));
  } catch {
    // CEF storage may be unavailable in tests or early bootstrap; the in-memory rows still drive this session.
  }
}

export function normalizeStoredGpuiRemoteRecentProjects(
  value: unknown
): Array<{ machineId: string; project: GxserverRecentProjectDomainState }> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') {
      return [];
    }
    const record = candidate as Record<string, unknown>;
    const machineId = normalizeNonEmptyString(record.machineId);
    const projectId = normalizeNonEmptyString(record.projectId);
    const title = normalizeNonEmptyString(record.title);
    if (!machineId || !projectId || !title) {
      return [];
    }
    const path = typeof record.path === 'string' ? record.path.trim() : '';
    const recentClosedAt =
      typeof record.recentClosedAt === 'string' &&
      record.recentClosedAt.trim().length > 0 &&
      Number.isFinite(Date.parse(record.recentClosedAt))
        ? record.recentClosedAt.trim()
        : undefined;
    const sessionCount = Number(record.sessionCount);
    return [
      {
        machineId,
        project: {
          path,
          projectId: projectId as GxserverProjectId,
          ...(recentClosedAt ? { recentClosedAt } : {}),
          sessionCount: Number.isFinite(sessionCount) && sessionCount > 0 ? Math.floor(sessionCount) : 0,
          title,
        },
      },
    ];
  });
}

/*
CDXC:RemoteMachines 2026-06-27-21:59:
The GPUI start build runs through Vite/Rolldown, whose transformer accepts readonly array shorthand and ReadonlyArray<T> but rejects `readonly Array<T>`. Keep this helper input in ReadonlyArray<T> form so Remote Recent Projects packaging does not break local GPUI startup.
*/
export function groupGpuiRemoteRecentProjectsByMachine(
  rows: ReadonlyArray<{ machineId: string; project: GxserverRecentProjectDomainState }>
): Map<string, GxserverRecentProjectDomainState[]> {
  const projectsByMachineId = new Map<string, GxserverRecentProjectDomainState[]>();
  for (const row of rows) {
    projectsByMachineId.set(
      row.machineId,
      orderGpuiRecentProjects([
        row.project,
        ...(projectsByMachineId.get(row.machineId) ?? []).filter(
          (project) => project.projectId !== row.project.projectId
        ),
      ])
    );
  }
  return projectsByMachineId;
}

export function orderGpuiRecentProjects(
  projects: readonly GxserverRecentProjectDomainState[]
): GxserverRecentProjectDomainState[] {
  return [...projects].sort(
    (left, right) => Date.parse(right.recentClosedAt ?? '') - Date.parse(left.recentClosedAt ?? '')
  );
}
