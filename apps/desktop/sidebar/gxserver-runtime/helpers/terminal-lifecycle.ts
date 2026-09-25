/*
CDXC:RepoStructure 2026-08-22:
Split out of the single 21,861-line `gxserver-runtime.ts`. Pure move: no logic
changed. See `core.ts` for how the runtime's methods are re-attached.
*/
import {
  GPUI_SIDEBAR_WORKSPACE_SESSION_ATTENTION_ACKNOWLEDGE_MESSAGE_TYPE,
  GPUI_SIDEBAR_WORKSPACE_SESSION_ATTENTION_ACKNOWLEDGE_MESSAGE_VERSION,
  GPUI_SIDEBAR_WORKSPACE_TERMINAL_ESCAPE_PRESSED_MESSAGE_TYPE,
  GPUI_SIDEBAR_WORKSPACE_TERMINAL_ESCAPE_PRESSED_MESSAGE_VERSION,
} from '../constants';
import type {
  GpuiWorkspaceSessionAttentionAcknowledgePayload,
  GpuiWorkspaceTerminalEscapePressedPayload,
} from '../types-and-protocol';
import { isObjectRecord, normalizeNonEmptyString } from './records';
import { parseGpuiRemotePresentationProjectId, parseGpuiRemotePresentationSessionId } from './remote-presentation';
import { gpuiStatusPetActivationSessionIdAllowed } from './status-indicators';
import { parseGxserverPresentationProjectSessionId } from '@/packages/shared/gxserver-presentation-sidebar-projection';
import type { GxserverSessionTransitionResult } from '@/packages/shared/gxserver-protocol';

export function gpuiWorkspaceTerminalTitleCommandForAgent(agentId: string): 'name' | 'rename' | 'title' {
  const normalizedAgentId = agentId.trim().toLowerCase();
  if (normalizedAgentId === 'pi' || normalizedAgentId === 'π') {
    return 'name';
  }
  if (normalizedAgentId === 'hermes' || normalizedAgentId === 'hermes agent' || normalizedAgentId === 'hermes-agent') {
    return 'title';
  }
  return 'rename';
}

export function normalizeGpuiWorkspaceTerminalEscapePressed(
  value: unknown
): GpuiWorkspaceTerminalEscapePressedPayload | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !['projectId', 'sessionId', 'type', 'version'].includes(key))) {
    return undefined;
  }
  if (
    record.type !== GPUI_SIDEBAR_WORKSPACE_TERMINAL_ESCAPE_PRESSED_MESSAGE_TYPE ||
    record.version !== GPUI_SIDEBAR_WORKSPACE_TERMINAL_ESCAPE_PRESSED_MESSAGE_VERSION
  ) {
    return undefined;
  }
  const projectId = normalizeNonEmptyString(record.projectId)?.trim();
  const sessionId = normalizeNonEmptyString(record.sessionId)?.trim();
  if (
    !projectId ||
    !sessionId ||
    !gpuiLocalWorkspaceLifecycleProjectIdAllowed(projectId) ||
    !gpuiLocalWorkspaceLifecycleSessionIdAllowed(sessionId)
  ) {
    return undefined;
  }
  return { projectId, sessionId };
}

export function normalizeGpuiWorkspaceSessionAttentionAcknowledge(
  value: unknown
): GpuiWorkspaceSessionAttentionAcknowledgePayload | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !['projectId', 'sessionId', 'type', 'version'].includes(key))) {
    return undefined;
  }
  if (
    record.type !== GPUI_SIDEBAR_WORKSPACE_SESSION_ATTENTION_ACKNOWLEDGE_MESSAGE_TYPE ||
    record.version !== GPUI_SIDEBAR_WORKSPACE_SESSION_ATTENTION_ACKNOWLEDGE_MESSAGE_VERSION
  ) {
    return undefined;
  }
  const projectId = normalizeNonEmptyString(record.projectId)?.trim();
  const sessionId = normalizeNonEmptyString(record.sessionId)?.trim();
  if (
    !projectId ||
    !sessionId ||
    !gpuiLocalWorkspaceLifecycleProjectIdAllowed(projectId) ||
    !gpuiLocalWorkspaceLifecycleSessionIdAllowed(sessionId)
  ) {
    return undefined;
  }
  return { projectId, sessionId };
}

/**
 * CDXC:RemoteMachines 2026-09-21 WHY:
 * The same bridge message for a row on ANOTHER machine: the store opens a remote row without
 * sending the click to this runtime any more, and acknowledges its attention here first, the way
 * `focusSession`'s remote branch did. The ids are the machine-scoped pair the tab-selected
 * callback carries, and they must name the same machine and project, so a local payload can
 * never be read as a remote one or the other way round. Returns the scoped session id.
 *
 * SEE-ALSO: packages/gx-core/src/sidebar_actions/remote_focus.rs (`attention_acknowledgement`),
 * apps/desktop/src/app/gx_store/sidebar_remote_focus.rs.
 */
export function normalizeGpuiWorkspaceRemoteSessionAttentionAcknowledge(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !['projectId', 'sessionId', 'type', 'version'].includes(key))) {
    return undefined;
  }
  if (
    record.type !== GPUI_SIDEBAR_WORKSPACE_SESSION_ATTENTION_ACKNOWLEDGE_MESSAGE_TYPE ||
    record.version !== GPUI_SIDEBAR_WORKSPACE_SESSION_ATTENTION_ACKNOWLEDGE_MESSAGE_VERSION
  ) {
    return undefined;
  }
  const projectId = normalizeNonEmptyString(record.projectId)?.trim();
  const sessionId = normalizeNonEmptyString(record.sessionId)?.trim();
  const remoteProject = projectId ? parseGpuiRemotePresentationProjectId(projectId) : undefined;
  const remoteSession = sessionId ? parseGpuiRemotePresentationSessionId(sessionId) : undefined;
  if (
    !sessionId ||
    !remoteProject ||
    !remoteSession ||
    remoteProject.machineId !== remoteSession.machineId ||
    remoteProject.projectId !== remoteSession.projectId
  ) {
    return undefined;
  }
  return sessionId;
}

export function didGpuiGxserverProviderTransitionCommit(result: GxserverSessionTransitionResult): boolean {
  /*
  CDXC:Workarea 2026-06-26-08:01:
  GPUI sleep must match macOS gxserver lifecycle ownership: `/api/transitionSession` resolving is not proof that zmx stopped. Only publish local sleep state after the returned session lifecycle matches the action, provider lifecycle is `missing`, and the optional kill result did not explicitly fail.
  */
  if (!isObjectRecord(result) || !isObjectRecord(result.session)) {
    return false;
  }
  const providerState = result.session.providerState;
  if (!isObjectRecord(providerState)) {
    return false;
  }
  const expectedLifecycleState = result.action === 'sleep' ? 'sleeping' : 'stopped';
  const killSucceeded = readGpuiTransitionKillSucceeded(
    isObjectRecord(result.transition) ? result.transition : undefined
  );
  return (
    result.session.lifecycleState === expectedLifecycleState &&
    providerState.lifecycleState === 'missing' &&
    killSucceeded !== false
  );
}

export function shouldApplyGpuiLocalWorkspaceTransition(
  result: GxserverSessionTransitionResult,
  action: 'close' | 'sleep'
): boolean {
  /*
  CDXC:Workarea 2026-06-26-23:44:
  macOS close and sleep intentionally diverge after gxserver handles a provider transition. Close removes the local pane/sidebar row once `/api/transitionSession` returns a valid close result, even when provider kill did not commit; sleep must stay strict so GPUI does not show a cold sleeping placeholder while the zmx runtime is still live.
  */
  if (!isObjectRecord(result) || result.action !== action || !isObjectRecord(result.session)) {
    return false;
  }
  return action === 'close' || didGpuiGxserverProviderTransitionCommit(result);
}

export function readGpuiTransitionKillSucceeded(transition: Record<string, unknown> | undefined): boolean | undefined {
  const kill = transition?.kill;
  if (!isObjectRecord(kill)) {
    return undefined;
  }
  return typeof kill.killed === 'boolean' ? kill.killed : undefined;
}

export function gpuiWorkspaceLifecycleProjectIdAllowed(value: string): boolean {
  return (
    gpuiLocalWorkspaceLifecycleProjectIdAllowed(value) || parseGpuiRemotePresentationProjectId(value) !== undefined
  );
}

export function gpuiLocalWorkspaceLifecycleProjectIdAllowed(value: string): boolean {
  return /^P[0-9][a-z0-9]{0,30}$/u.test(value);
}

export function gpuiLocalWorkspaceLifecycleSessionIdAllowed(value: string): boolean {
  return (
    gpuiStatusPetActivationSessionIdAllowed(value) &&
    !value.includes(':') &&
    !parseGpuiRemotePresentationSessionId(value) &&
    !parseGxserverPresentationProjectSessionId(value)
  );
}
