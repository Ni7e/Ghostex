import { createRoot } from "react-dom/client";
import "../../sidebar/styles.css";
import { SidebarApp } from "../../sidebar/sidebar-app";
import { createGpuiSidebarRuntime } from "./phase1-gxserver-runtime";
import "./phase1-sidebar.css";

/*
CDXC:GPUISidebarGxserverRuntime 2026-06-24-11:00:
GPUI sidebar production runtime mounts the shared SidebarApp directly and feeds it through the local gxserver message source. Storybook fixtures are not a runtime fallback; missing or invalid Rust/CEF gxserver bootstrap publishes the explicit gxserver-unavailable sidebar state until real presentation data arrives.
*/
document.body.dataset.sidebarTheme = "plain-dark";
document.body.classList.add("vscode-dark");

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Ghostex GPUI sidebar root element was not found.");
}

const gpuiSidebarRuntime = createGpuiSidebarRuntime();
const root = createRoot(rootElement);

root.render(
  <div className="native-sidebar-shell gpui-phase1-sidebar" data-sidebar-mode="combined">
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
