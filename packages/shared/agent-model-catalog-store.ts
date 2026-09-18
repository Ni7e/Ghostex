import { useEffect, useSyncExternalStore } from 'react';
import { currentAgentModelCatalog, subscribeAgentModelCatalog, refreshAgentModelCatalog } from './agent-model-catalog-state';
import type { AgentModelCatalog } from './agent-model-catalog';
export * from './agent-model-catalog-state';

/**
 * The current catalog, kept live: subscribes to replacements and kicks off the
 * once-per-load remote refresh on first use.
 */
export function useAgentModelCatalog(): AgentModelCatalog {
  const catalog = useSyncExternalStore(subscribeAgentModelCatalog, currentAgentModelCatalog, currentAgentModelCatalog);
  useEffect(() => {
    void refreshAgentModelCatalog();
  }, []);
  return catalog;
}
