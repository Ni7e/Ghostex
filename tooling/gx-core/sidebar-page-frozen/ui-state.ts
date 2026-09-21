/**
 * FROZEN copy of the TypeScript sidebar page, which was deleted on 2026-09-21 (M4d part 2). It is
 * kept only so the parity gates beside it still have the behaviour the app shipped on that date to
 * compare the Rust store against: a clean run proves Rust still matches THAT, not that it matches
 * the app. Never edit this file to make a gate pass; change the Rust and re-record, or delete the
 * gate.
 *
 * One method is NOT here: `mirror`, which applied the changes the app made to this state by itself
 * (the project slot hotkey's jump and its reveal). Its only callers were the slot-jump and
 * session-slot gates, which were deleted with the page, and the `sidebarUiMirror` contract it read
 * went with them.
 */
import { readSidebarHiddenItems } from '@/packages/core-ui/sidebar-hidden-items';
import type { SidebarSessionTagFilter } from '@/packages/shared/session-tags';
import { readSidebarUiCollapseState } from '@/packages/core-ui/sidebar-app/collapse-state';
import { readSidebarSelectedMachineTabId } from '@/packages/core-ui/sidebar-app/machine-tab-selection';
import { DEFAULT_PROJECT_SESSION_SECTION_COLLAPSE_STATE } from '@/packages/core-ui/sidebar-app/project-session-section-model';
import { NativeSidebarMetadata } from './metadata';
import type { NativeSidebarCommand } from '@/packages/shared/native-sidebar';

/*
CDXC:Sidebar 2026-09-21 WHY:
This state is READ from client storage at construction and is never written back. The app owns the
three keys since M5 piece 7c (`ghostex-sidebar-ui-collapse-state:window:main`,
`ghostex-sidebar-selected-machine-tab`, `ghostex.sidebar.hidden-items.v1`), and it applies every one
of these commands to its own copy in the same frame this one does, so the two move together and
only one of them writes. What is kept here is the in-memory copy the paths this page still owns read
from: the projection it draws with the list-source switch off, the Space switch's focus restore, the
reveal, and the project slot hotkey.
SEE-ALSO: apps/desktop/src/app/gx_store/sidebar_ui.rs,
apps/desktop/src/app/gx_store/sidebar_ui_commands.rs,
apps/desktop/src/app/gx_store/sidebar_ui_paths.rs.
*/
export class NativeSidebarUiState {
  renameRequest?: { collectionId: string; requestId: number };
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
        return;
    }
  }

}

function setRecordEntry(record: Record<string, true>, key: string, on: boolean): void {
  if (on) record[key] = true;
  else delete record[key];
}

function setListEntry(list: readonly string[], key: string, on: boolean): string[] {
  const rest = list.filter((entry) => entry !== key);
  return on ? [...rest, key] : rest;
}

function toggleRecordEntry(record: Record<string, true>, key: string): void {
  if (record[key]) delete record[key];
  else record[key] = true;
}
