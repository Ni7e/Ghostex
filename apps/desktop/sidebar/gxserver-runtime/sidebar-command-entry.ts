import type { SidebarToExtensionMessage } from '@/packages/shared/session-grid-contract';

/**
 * CDXC:Sidebar 2026-09-21 WHY:
 * The Rust store's direct route into this runtime (`window.ghostexGpui.onSidebarCommand`) replaces
 * the hop through the sidebar page, which is being deleted. The payload crosses a bridge, so it is
 * `unknown` on arrival and is checked for the one thing `handleSidebarMessage` switches on: an
 * object with a string `type`. A payload that is not one is dropped rather than thrown, because a
 * throw inside the bridge callback would take the rest of the batch with it.
 */
export function asGpuiSidebarCommand(payload: unknown): SidebarToExtensionMessage | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const { type } = payload as { type?: unknown };
  return typeof type === 'string' && type.length ? (payload as SidebarToExtensionMessage) : undefined;
}
