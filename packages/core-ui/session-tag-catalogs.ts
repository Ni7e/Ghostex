import type { CustomSessionTagCatalogs } from '../shared/session-tags';
import { sidebarStore } from './sidebar-store-model';

export function getSessionTagCatalogs(): CustomSessionTagCatalogs {
  const state = sidebarStore.getState();
  return [state.customSessionTags, ...Object.values(state.remoteCustomSessionTagsByMachineId)];
}
