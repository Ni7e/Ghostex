import { readSidebarHiddenItems } from '@/packages/core-ui/sidebar-hidden-items';
import type { SidebarSessionTagFilter } from '@/packages/shared/session-tags';
import { readSidebarUiCollapseState, writeSidebarUiCollapseState } from '@/packages/core-ui/sidebar-app/collapse-state';
import {
  readSidebarSelectedMachineTabId,
  writeSidebarSelectedMachineTabId,
} from '@/packages/core-ui/sidebar-app/machine-tab-selection';
import { DEFAULT_PROJECT_SESSION_SECTION_COLLAPSE_STATE } from '@/packages/core-ui/sidebar-app/project-session-section-model';
import { NativeSidebarMetadata } from './metadata';
import type { NativeSidebarCommand } from '@/packages/shared/native-sidebar';

export class NativeSidebarUiState {
  renameRequest?: { collectionId: string; requestId: number };
  pendingAddedProject?: { machineId: string; projectId: string };
  unavailableSince?: number;
  hasObservedAvailableState = false;
  revealRequest?: { sessionId: string; requestId: number };
  handledRevealRequestId?: number;
  requestReveal(sessionId: string, requestId = Date.now()) {
    this.revealRequest = { sessionId, requestId };
  }
  hiddenItems = readSidebarHiddenItems();
  showHidden = false;
  selectedTagFilters: SidebarSessionTagFilter[] = [];
  previousExpandedGroups: Record<string, string[]> = {};
  selectedSessionIds: string[] = [];
  metadata = new NativeSidebarMetadata();
  collapse = readSidebarUiCollapseState('main').state;
  selectedMachineId = readSidebarSelectedMachineTabId('main');

  get sectionKey(): string {
    return this.selectedMachineId === 'local' ? 'local' : `remote:${this.selectedMachineId}`;
  }

  apply(command: Exclude<NativeSidebarCommand, { type: 'command' }>): void {
    switch (command.type) {
      case 'toggleTagFilter':
        this.selectedTagFilters = this.selectedTagFilters.includes(command.tag)
          ? this.selectedTagFilters.filter((tag) => tag !== command.tag)
          : [...this.selectedTagFilters, command.tag];
        return;
      case 'toggleHoverActions':
        toggleRecordEntry(this.collapse.expandedSessionCardHoverActionsById, command.groupId);
        break;
      case 'toggleGroup':
        toggleRecordEntry(this.collapse.collapsedGroupsById, command.groupId);
        break;
      case 'toggleList':
        toggleRecordEntry(this.collapse.expandedProjectSessionListsById, command.groupId);
        break;
      case 'toggleSection': {
        const previous =
          this.collapse.collapsedProjectSessionSectionsById[command.groupId] ??
          DEFAULT_PROJECT_SESSION_SECTION_COLLAPSE_STATE;
        this.collapse.collapsedProjectSessionSectionsById[command.groupId] = {
          ...previous,
          [command.section]: !previous[command.section],
        };
        break;
      }
      case 'editSpace':
        return;
      case 'selectSpace':
        this.collapse.selectedSpaceIdBySectionKey[this.sectionKey] = command.spaceId;
        break;
      case 'selectMachine':
        this.selectedMachineId = command.machineId;
        writeSidebarSelectedMachineTabId('main', command.machineId);
        return;
    }
    writeSidebarUiCollapseState('main', this.collapse);
  }
}

function toggleRecordEntry(record: Record<string, true>, key: string): void {
  if (record[key]) delete record[key];
  else record[key] = true;
}
