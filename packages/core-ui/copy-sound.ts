/**
 * CDXC:Clipboard 2026-09-15 DECISION:
 * User: "I want this copy sound to actually play everywhere in the app when we copy something."
 * Every React copy site calls this right where it writes the clipboard. Rust owns the sound asset and the Copy Sound setting, so a page only posts a fixed message over the bridge it already has: the app-modal host shim on the sidebar, modal, chat, and find pages, or the project-board request function on the Kanban, Automate, and Docs pages. Outside the desktop app (web, Storybook) there is no bridge and nothing plays.
 * SEE-ALSO: apps/desktop/src/app/helpers/os_cli/notifications.rs (gpui_play_copy_sound), apps/desktop/src/app/remote_conn/app_modal_bridge.rs, apps/desktop/src/app/session_chat.rs, apps/desktop/src/app/workspace_events.rs.
 */
export const PLAY_COPY_SOUND_MESSAGE_TYPE = 'playCopySound';

type CopySoundBridgeWindow = {
  ghostexGpui?: { postProjectBoardRequest?: (payload: string) => boolean };
  webkit?: { messageHandlers?: { ghostexAppModalHost?: { postMessage: (message: unknown) => void } } };
};

export function playCopySound(): void {
  const target = window as unknown as CopySoundBridgeWindow;
  const modalHost = target.webkit?.messageHandlers?.ghostexAppModalHost;
  if (modalHost) {
    modalHost.postMessage({ type: PLAY_COPY_SOUND_MESSAGE_TYPE });
    return;
  }
  target.ghostexGpui?.postProjectBoardRequest?.(JSON.stringify({ action: PLAY_COPY_SOUND_MESSAGE_TYPE }));
}
