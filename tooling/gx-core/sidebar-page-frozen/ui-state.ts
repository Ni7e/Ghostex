/**
 * FROZEN copy of the TypeScript sidebar page, which was deleted on 2026-09-21 (M4d part 2). It is
 * kept only so the parity gates beside it still have the behaviour the app shipped on that date to
 * compare the Rust store against: a clean run proves Rust still matches THAT, not that it matches
 * the app. Never edit this file to make a gate pass; change the Rust and re-record, or delete the
 * gate.
 */
import { readSidebarHiddenItems } from '@/packages/core-ui/sidebar-hidden-items';
import type { SidebarSessionTagFilter } from '@/packages/shared/session-tags';
import { readSidebarUiCollapseState } from '@/packages/core-ui/sidebar-app/collapse-state';
import { readSidebarSelectedMachineTabId } from '@/packages/core-ui/sidebar-app/machine-tab-selection';
import { DEFAULT_PROJECT_SESSION_SECTION_COLLAPSE_STATE } from '@/packages/core-ui/sidebar-app/project-session-section-model';
import { NativeSidebarMetadata } from './metadata';
import type { NativeSidebarCommand } from '@/packages/shared/native-sidebar';
import type { SidebarUiMirrorChange } from '@/packages/shared/session-grid-contract';

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

  /**
   * CDXC:Sidebar 2026-09-21 WHY:
   * The changes the app made to this state by itself (the project slot hotkey's jump and its
   * reveal), as the value each touched key now holds there. Only this copy moves: no reveal is
   * requested, nothing scrolls, nothing is focused, and `revealRequest` is left alone, because a new
   * request id here would be published and overwrite the id the app uses to skip a reveal it has
   * already handled. Supersedes sending this page a `revealSidebarSession` for the jump.
   * SEE-ALSO: packages/gx-core/src/sidebar_ui/mirror.rs, apps/desktop/src/app/gx_store/sidebar_slot_jump.rs.
   */
  mirror(changes: readonly SidebarUiMirrorChange[]): void {
    const collapse = this.collapse;
    for (const change of changes) {
      switch (change.kind) {
        case 'collapsedGroup':
          setRecordEntry(collapse.collapsedGroupsById, change.id, change.on);
          break;
        case 'expandedList':
          setRecordEntry(collapse.expandedProjectSessionListsById, change.id, change.on);
          break;
        case 'hoverActions':
          setRecordEntry(collapse.expandedSessionCardHoverActionsById, change.id, change.on);
          break;
        case 'collapsedCollection':
          setRecordEntry(collapse.collapsedProjectCollectionsByKey, change.id, change.on);
          break;
        case 'hiddenGroup':
          this.hiddenItems = {
            ...this.hiddenItems,
            groupIds: setListEntry(this.hiddenItems.groupIds, change.id, change.on),
          };
          break;
        case 'hiddenCollection':
          this.hiddenItems = {
            ...this.hiddenItems,
            collectionKeys: setListEntry(this.hiddenItems.collectionKeys, change.id, change.on),
          };
          break;
        case 'section':
          collapse.collapsedProjectSessionSectionsById[change.id] = { ...change.state };
          break;
        case 'selectedSpace':
          if (change.spaceId === null) delete collapse.selectedSpaceIdBySectionKey[change.sectionKey];
          else collapse.selectedSpaceIdBySectionKey[change.sectionKey] = change.spaceId;
          break;
        case 'recentSessions': {
          const bySpace = { ...collapse.recentSessionIdsBySpace[change.sectionKey] };
          if (change.sessionIds?.length) bySpace[change.spaceId] = [...change.sessionIds];
          else delete bySpace[change.spaceId];
          collapse.recentSessionIdsBySpace = { ...collapse.recentSessionIdsBySpace, [change.sectionKey]: bySpace };
          break;
        }
        case 'selectedMachine':
          this.selectedMachineId = change.machineId;
          break;
        case 'tagFilters':
          this.selectedTagFilters = [...change.tags];
          break;
        case 'showHidden':
          this.showHidden = change.on;
          break;
        case 'selectedSessions':
          this.selectedSessionIds = [...change.sessionIds];
          break;
      }
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
