/*
CDXC:RepoStructure 2026-08-22:
Split out of the single 21,861-line `gxserver-runtime.ts`. Pure move: no logic
changed. See `core.ts` for how the runtime's methods are re-attached.
*/
import {
  GPUI_SIDEBAR_WORKSPACE_TAB_SESSION_SELECTED_MESSAGE_TYPE,
  GPUI_SIDEBAR_WORKSPACE_TAB_SESSION_SELECTED_MESSAGE_VERSION,
} from '../constants';
import type { GpuiWorkspaceTabSessionSelectionPayload } from '../types-and-protocol';
import { normalizeNonEmptyString, uniqueNonEmptyStrings } from './records';
import { gpuiStatusPetActivationSessionIdAllowed } from './status-indicators';

export function normalizeGpuiWorkspaceTabSessionSelection(
  value: unknown
): GpuiWorkspaceTabSessionSelectionPayload | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) =>
        ![
          'focusStamp',
          'localRuntimeMissing',
          'localWasSleeping',
          'projectId',
          'rememberedSessions',
          'sessionId',
          'type',
          'version',
          'visibleSessionIds',
        ].includes(key)
    )
  ) {
    return undefined;
  }
  if (
    record.type !== GPUI_SIDEBAR_WORKSPACE_TAB_SESSION_SELECTED_MESSAGE_TYPE ||
    record.version !== GPUI_SIDEBAR_WORKSPACE_TAB_SESSION_SELECTED_MESSAGE_VERSION
  ) {
    return undefined;
  }
  const projectId = normalizeNonEmptyString(record.projectId)?.trim();
  const sessionId = normalizeNonEmptyString(record.sessionId)?.trim();
  if (
    !projectId ||
    !sessionId ||
    !gpuiStatusPetActivationSessionIdAllowed(projectId) ||
    !gpuiStatusPetActivationSessionIdAllowed(sessionId)
  ) {
    return undefined;
  }
  if (record.localWasSleeping !== undefined && record.localWasSleeping !== true) {
    return undefined;
  }
  if (record.localRuntimeMissing !== undefined && record.localRuntimeMissing !== true) {
    return undefined;
  }
  const visibleSessionIds = Array.isArray(record.visibleSessionIds)
    ? uniqueNonEmptyStrings(record.visibleSessionIds)?.filter((visibleSessionId) =>
        gpuiStatusPetActivationSessionIdAllowed(visibleSessionId)
      )
    : undefined;
  if (
    record.visibleSessionIds !== undefined &&
    (!Array.isArray(record.visibleSessionIds) ||
      visibleSessionIds?.length !== record.visibleSessionIds.length ||
      visibleSessionIds.length > 64)
  ) {
    return undefined;
  }
  if (
    record.focusStamp !== undefined &&
    (typeof record.focusStamp !== 'number' || !Number.isSafeInteger(record.focusStamp) || record.focusStamp < 0)
  ) {
    return undefined;
  }
  const rememberedSessions = normalizeGpuiRememberedProjectSessions(record.rememberedSessions);
  if (record.rememberedSessions !== undefined && !rememberedSessions) {
    return undefined;
  }
  return {
    ...(record.focusStamp !== undefined ? { focusStamp: record.focusStamp } : {}),
    ...(record.localRuntimeMissing === true ? { localRuntimeMissing: true } : {}),
    ...(record.localWasSleeping === true ? { localWasSleeping: true } : {}),
    projectId,
    ...(rememberedSessions ? { rememberedSessions } : {}),
    sessionId,
    ...(visibleSessionIds ? { visibleSessionIds } : {}),
  };
}

function normalizeGpuiRememberedProjectSessions(
  value: unknown
): { projectId: string; sessionId: string }[] | undefined {
  if (!Array.isArray(value) || value.length > 16) {
    return undefined;
  }
  const sessions: { projectId: string; sessionId: string }[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return undefined;
    }
    const record = entry as Record<string, unknown>;
    const projectId = normalizeNonEmptyString(record.projectId)?.trim();
    const sessionId = normalizeNonEmptyString(record.sessionId)?.trim();
    if (
      Object.keys(record).some((key) => key !== 'projectId' && key !== 'sessionId') ||
      !projectId ||
      !sessionId ||
      !gpuiStatusPetActivationSessionIdAllowed(projectId) ||
      !gpuiStatusPetActivationSessionIdAllowed(sessionId)
    ) {
      return undefined;
    }
    sessions.push({ projectId, sessionId });
  }
  return sessions;
}
