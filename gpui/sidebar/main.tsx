import { createRoot } from "react-dom/client";
import "../../sidebar/styles.css";
import { SidebarApp } from "../../sidebar/sidebar-app";
import { createGpuiSidebarRuntime } from "./gxserver-runtime";
import "./sidebar.css";

/*
CDXC:GPUISidebarGxserverRuntime 2026-06-24-11:00:
GPUI sidebar production runtime mounts the shared SidebarApp directly and feeds it through the local gxserver message source. Storybook fixtures are not a runtime fallback; missing or invalid Rust/CEF gxserver bootstrap publishes the explicit gxserver-unavailable sidebar state until real presentation data arrives.
*/
document.body.dataset.sidebarTheme = "plain-dark";
// Reuse the native sidebar edge contract so reference-sidebar bleed stays inside the GPUI viewport.
document.body.classList.add("vscode-dark", "native-sidebar-body");

const GPUI_SIDEBAR_UI_COLLAPSE_STATE_STORAGE_KEY = "ghostex-sidebar-ui-collapse-state";
const GPUI_SIDEBAR_UI_COLLAPSE_STATE_FIELDS = [
  "collapsedGroupsById",
  "collapsedRemoteMachineSectionsById",
  "isRecentProjectsOpen",
  "isReferenceChatsCollapsed",
  "isReferenceProjectsCollapsed",
] as const;

function seedGpuiSidebarUiCollapseState(): void {
  /*
  CDXC:GPUISidebarCollapseRestore 2026-07-05:
  GPUI's app-owned collapse-state file is the startup source of truth. Rust
  installs it as `startupUiCollapseState` at V8 context creation so it is
  readable here, synchronously before SidebarApp's mount-time localStorage
  read; `runtimeSettings.uiCollapseState` only arrives with the load-end
  install message, after this module already ran.
  */
  const serializedCollapseState = window.ghostexGpui?.startupUiCollapseState;
  if (typeof serializedCollapseState !== "string") {
    return;
  }

  let collapseState: unknown;
  try {
    collapseState = JSON.parse(serializedCollapseState);
  } catch {
    return;
  }
  if (!hasGpuiSidebarUiCollapseStateShape(collapseState)) {
    return;
  }

  try {
    window.localStorage.setItem(
      GPUI_SIDEBAR_UI_COLLAPSE_STATE_STORAGE_KEY,
      JSON.stringify(collapseState),
    );
  } catch {
    // Keep the in-memory default if CEF storage is unavailable.
  }
}

function hasGpuiSidebarUiCollapseStateShape(
  candidate: unknown,
): candidate is Record<string, unknown> {
  return (
    candidate !== null &&
    typeof candidate === "object" &&
    !Array.isArray(candidate) &&
    GPUI_SIDEBAR_UI_COLLAPSE_STATE_FIELDS.some((field) =>
      Object.prototype.hasOwnProperty.call(candidate, field),
    )
  );
}

seedGpuiSidebarUiCollapseState();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Ghostex GPUI sidebar root element was not found.");
}

const gpuiSidebarRuntime = createGpuiSidebarRuntime();
const root = createRoot(rootElement);

root.render(
  <div className="native-sidebar-shell gpui-sidebar" data-sidebar-mode="combined">
    <main className="native-sidebar-main">
      <SidebarApp
        messageSource={gpuiSidebarRuntime.messageSource}
        nativeHostEventSource={null}
        vscode={gpuiSidebarRuntime.vscode}
      />
    </main>
  </div>,
);

gpuiSidebarRuntime.start();
