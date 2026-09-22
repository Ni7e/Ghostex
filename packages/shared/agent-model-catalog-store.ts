import { useEffect, useSyncExternalStore } from 'react';
import {
  currentAgentModelCatalog,
  subscribeAgentModelCatalog,
  refreshAgentModelCatalog,
} from './agent-model-catalog-state';
import type { AgentModelCatalog } from './agent-model-catalog';
export * from './agent-model-catalog-state';

/**
 * The current catalog, kept live: subscribes to replacements and asks for a
 * remote refresh on mount (reused when the last one is recent).
 */
export function useAgentModelCatalog(): AgentModelCatalog {
  const catalog = useSyncExternalStore(subscribeAgentModelCatalog, currentAgentModelCatalog, currentAgentModelCatalog);
  useEffect(() => {
    void refreshAgentModelCatalog();
  }, []);
  return catalog;
}
