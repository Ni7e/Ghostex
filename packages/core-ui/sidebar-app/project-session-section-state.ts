import { useCallback, useState } from 'react';
import {
  DEFAULT_PROJECT_SESSION_SECTION_COLLAPSE_STATE,
  type ProjectSessionSection,
  type ProjectSessionSectionCollapseStateById,
} from './project-session-section-model';
export * from './project-session-section-model';

/**
 * CDXC:Projects 2026-09-06 DECISION:
 * User: remember Pinned, Sessions, and Parked expansion per project when switching Spaces; keep Pinned and Sessions across app restarts, but start Parked collapsed.
 * SidebarApp owns the map because filtering a project out of a Space unmounts its row.
 */
export function useProjectSessionSectionCollapseState(initialState: ProjectSessionSectionCollapseStateById) {
  const [collapsedProjectSessionSectionsById, setState] = useState(initialState);
  const setProjectSessionSectionCollapsed = useCallback(
    (projectId: string, section: ProjectSessionSection, collapsed: boolean) => {
      setState((previous) => {
        const current = previous[projectId] ?? DEFAULT_PROJECT_SESSION_SECTION_COLLAPSE_STATE;
        if (current[section] === collapsed) return previous;
        return { ...previous, [projectId]: { ...current, [section]: collapsed } };
      });
    },
    []
  );
  return { collapsedProjectSessionSectionsById, setProjectSessionSectionCollapsed };
}
