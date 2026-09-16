import type { AgentsHubFileTab, AgentsHubGroup } from './session-grid-contract-sidebar';

const agentsHubTabs: AgentsHubFileTab[] = ['configs', 'hooks', 'mds', 'skills'];

export function applySavedAgentsHubContents(
  groupsByTab: Record<AgentsHubFileTab, AgentsHubGroup[]>,
  savedContentsByPath: Record<string, string>
): Record<AgentsHubFileTab, AgentsHubGroup[]> {
  const savedPaths = new Set(Object.keys(savedContentsByPath));
  if (savedPaths.size === 0) {
    return groupsByTab;
  }

  return agentsHubTabs.reduce(
    (nextGroupsByTab, tab) => ({
      ...nextGroupsByTab,
      [tab]: groupsByTab[tab].map((group) => ({
        ...group,
        files: group.files.map((file) =>
          savedPaths.has(file.path) ? { ...file, content: savedContentsByPath[file.path]! } : file
        ),
      })),
    }),
    {} as Record<AgentsHubFileTab, AgentsHubGroup[]>
  );
}
