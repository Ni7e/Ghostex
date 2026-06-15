export const SIDEBAR_PROJECT_JUMP_EVENT = "ghostex-sidebar-project-jump";

export type SidebarProjectJumpEventDetail = {
  expandCollapsedProject: boolean;
  groupId: string;
  projectId: string;
  showLessAfterExpand: boolean;
};
