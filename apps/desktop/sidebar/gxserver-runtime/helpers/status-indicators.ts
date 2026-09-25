/*
CDXC:RepoStructure 2026-08-22:
Split out of the single 21,861-line `gxserver-runtime.ts`. Pure move: no logic
changed. See `core.ts` for how the runtime's methods are re-attached.
*/
/*
CDXC:StatusPet 2026-09-25 WHY:
The status item and pet payloads are derived in Rust since the app runtime port's F2
(packages/gx-core/src/indicators.rs, apps/desktop/src/app/gx_store/indicators/); what is left here
are the activation and title helpers other runtime paths still use.
*/
import {
  GPUI_ACTIVE_WORKSPACE_TAB_SESSION_TITLE_MAX_CHARS,
  GPUI_SIDEBAR_MENU_BAR_PROJECT_ACTIVATION_MESSAGE_TYPE,
  GPUI_SIDEBAR_MENU_BAR_PROJECT_ACTIVATION_MESSAGE_VERSION,
  GPUI_STATUS_INDICATOR_ID_MAX_CHARS,
} from '../constants';
import type { GpuiMenuBarProjectActivationPayload } from '../types-and-protocol';
import { normalizeNonEmptyString } from './records';
import { DEFAULT_TERMINAL_SESSION_TITLE } from '@/packages/shared/session-grid-contract';

export function boundedGpuiActiveWorkspaceTabSessionTitle(value: string): string {
  const normalized = normalizeNonEmptyString(value) ?? DEFAULT_TERMINAL_SESSION_TITLE;
  return normalized.length > GPUI_ACTIVE_WORKSPACE_TAB_SESSION_TITLE_MAX_CHARS
    ? normalized.slice(0, GPUI_ACTIVE_WORKSPACE_TAB_SESSION_TITLE_MAX_CHARS)
    : normalized;
}

export function normalizeGpuiMenuBarProjectActivation(value: unknown): GpuiMenuBarProjectActivationPayload | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !['projectId', 'type', 'version'].includes(key))) {
    return undefined;
  }
  if (
    record.type !== GPUI_SIDEBAR_MENU_BAR_PROJECT_ACTIVATION_MESSAGE_TYPE ||
    record.version !== GPUI_SIDEBAR_MENU_BAR_PROJECT_ACTIVATION_MESSAGE_VERSION
  ) {
    return undefined;
  }
  const projectId = normalizeNonEmptyString(record.projectId)?.trim();
  if (!projectId || !gpuiStatusPetActivationSessionIdAllowed(projectId)) {
    return undefined;
  }
  return { projectId };
}

export function gpuiStatusPetActivationSessionIdAllowed(value: string): boolean {
  return (
    value.length <= GPUI_STATUS_INDICATOR_ID_MAX_CHARS &&
    !value.includes('/') &&
    !value.includes('\\') &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}
