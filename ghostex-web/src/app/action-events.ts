import type { GxserverSidebarHudCommandButton } from "@/shared/gxserver-protocol";
import type { OpenAppModalMessage } from "@/sidebar/app-modal-host-bridge";

export type OpenRecentProjectsModalDetail = Pick<
  Extract<OpenAppModalMessage, { modal: "recentProjects" }>,
  "machineId" | "machineName"
>;

export interface RunTitlebarActionDetail {
  action: GxserverSidebarHudCommandButton;
  machineId: string;
  projectId: string;
}

declare global {
  interface WindowEventMap {
    "ghostex-web:closeAppModal": CustomEvent;
    "ghostex-web:openCommandPane": CustomEvent;
    "ghostex-web:openRecentProjectsModal": CustomEvent<OpenRecentProjectsModalDetail>;
    "ghostex-web:runTitlebarAction": CustomEvent<RunTitlebarActionDetail>;
  }
}
