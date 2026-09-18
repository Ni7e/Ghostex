import { useStore } from 'zustand';
import { sidebarStore, type SidebarStoreState } from './sidebar-store-model';

export * from './sidebar-store-model';

/**
 * CDXC:Sidebar 2026-09-16 WHY:
 * The native GPUI sidebar consumes the same presentation reducer without mounting React. Keep the React subscription adapter here so both renderers share normalization, focus reconciliation, and optimistic session state.
 */
export const useSidebarStore = Object.assign(function useSidebarStore<T = SidebarStoreState>(
  selector: (state: SidebarStoreState) => T = (state) => state as T
): T {
  return useStore(sidebarStore, selector);
}, sidebarStore);
