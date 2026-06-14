import { createRoot } from "react-dom/client";
import "../../sidebar/styles.css";
import { SidebarStoryHarness } from "../../sidebar/sidebar-story-harness";
import {
  createSidebarStoryMessage,
  type SidebarStoryArgs,
} from "../../sidebar/sidebar-story-fixtures";
import "./phase1-sidebar.css";

const phase1Args = {
  createSessionOnSidebarDoubleClick: false,
  debuggingMode: false,
  fixture: "combined-sparse-reference",
  highlightedVisibleCount: 1,
  isFocusModeActive: false,
  renameSessionOnDoubleClick: false,
  showCloseButtonOnSessionCards: false,
  showSessionCloseContextMenuAction: true,
  showSessionCommandCopyActions: true,
  showSessionDetailsCopyAction: true,
  theme: "plain-dark",
  viewMode: "grid",
  visibleCount: 1,
} satisfies SidebarStoryArgs;

/*
 * CDXC:GPUIPhase1 2026-06-14-12:06:
 * The GPUI prototype should embed the real macOS sidebar React component in CEF, not a rewritten placeholder. Mount the existing Storybook harness with a durable fixture so phase 1 has realistic projects, sessions, search, and sidebar controls before a native host bridge is connected.
 */
document.body.dataset.sidebarTheme = phase1Args.theme;
document.body.classList.add("vscode-dark");

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Ghostex GPUI sidebar root element was not found.");
}

createRoot(rootElement).render(
  <div className="native-sidebar-shell gpui-phase1-sidebar" data-sidebar-mode="combined">
    <main className="native-sidebar-main">
      <SidebarStoryHarness message={createSidebarStoryMessage(phase1Args)} />
    </main>
  </div>,
);
