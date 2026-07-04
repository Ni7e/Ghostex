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

function seedGpuiSidebarUiCollapseState(): void {
  const collapseState = window.ghostexGpui?.runtimeSettings?.uiCollapseState;
  if (!collapseState || typeof collapseState !== "object" || Array.isArray(collapseState)) {
    return;
  }

  try {
    if (window.localStorage.getItem(GPUI_SIDEBAR_UI_COLLAPSE_STATE_STORAGE_KEY) !== null) {
      return;
    }
    window.localStorage.setItem(
      GPUI_SIDEBAR_UI_COLLAPSE_STATE_STORAGE_KEY,
      JSON.stringify(collapseState),
    );
  } catch {
    // Keep the in-memory default if CEF storage is unavailable.
  }
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
