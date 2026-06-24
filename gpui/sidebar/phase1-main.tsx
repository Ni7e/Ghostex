import { createRoot } from "react-dom/client";
import "../../sidebar/styles.css";
import { SidebarStoryHarness } from "../../sidebar/sidebar-story-harness";
import {
  createSidebarStoryMessage,
  type SidebarStoryArgs,
} from "../../sidebar/sidebar-story-fixtures";
import {
  createGpuiSidebarActiveProjectContextPayload,
  type GpuiSidebarRuntimeSettings,
  type GpuiSidebarRuntimeSettingsSnapshot,
} from "./phase1-active-project-context";
import type { SidebarStoryWorkspace } from "../../sidebar/sidebar-story-workspace";
import "./phase1-sidebar.css";

declare global {
  interface Window {
    ghostexGpui?: {
      postActiveProjectContext?: (payload: string) => boolean;
      runtimeSettings?: GpuiSidebarRuntimeSettings;
      onRuntimeSettingsChanged?: (
        runtimeSettings: GpuiSidebarRuntimeSettingsSnapshot,
      ) => void;
    };
  }
}

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

let latestGpuiBridgeWorkspace: SidebarStoryWorkspace | undefined;
let latestGpuiBridgeRuntimeSettings: GpuiSidebarRuntimeSettings | undefined;
let gpuiBridgeActiveProjectContextRetryId: number | undefined;

/**
 * CDXC:GPUIProjectSidebarBridge 2026-06-23-06:36:
 * The GPUI phase-1 sidebar stores the latest explicit Storybook workspace and computes the active-project payload only at send time with the installed `window.ghostexGpui.runtimeSettings` snapshot. The CEF bridge installs after page load, so startup retries must not replay a payload created before the Rust shared-settings booleans existed on the window object.
 *
 * CDXC:GPUIProjectSidebarBridge 2026-06-23-06:57:
 * Runtime-settings refresh from CEF is a fixed callback property, not a settings bus. When the two strict booleans change, repost the latest active-project payload using the latest workspace plus refreshed runtimeSettings so Manage availability cannot stay stale after Debugging Mode or Show Beta Features changes.
 */
function installGpuiBridgeRuntimeSettingsCallback(): void {
  const gpuiBridge = (window.ghostexGpui = window.ghostexGpui ?? {});
  gpuiBridge.onRuntimeSettingsChanged = (runtimeSettings) => {
    const runtimeSettingsChanged = !hasSameGpuiBridgeRuntimeSettings(
      latestGpuiBridgeRuntimeSettings,
      runtimeSettings,
    );
    latestGpuiBridgeRuntimeSettings = runtimeSettings;

    if (runtimeSettingsChanged) {
      postLatestGpuiBridgeActiveProjectContext(0);
    }
  };
}

function postGpuiBridgeActiveProjectContext(
  workspace: SidebarStoryWorkspace,
): void {
  latestGpuiBridgeWorkspace = workspace;
  postLatestGpuiBridgeActiveProjectContext(0);
}

function postLatestGpuiBridgeActiveProjectContext(attempt: number): void {
  if (gpuiBridgeActiveProjectContextRetryId !== undefined) {
    window.clearTimeout(gpuiBridgeActiveProjectContextRetryId);
    gpuiBridgeActiveProjectContextRetryId = undefined;
  }

  const postActiveProjectContext = window.ghostexGpui?.postActiveProjectContext;
  if (typeof postActiveProjectContext !== "function") {
    if (attempt < 20) {
      gpuiBridgeActiveProjectContextRetryId = window.setTimeout(
        () => postLatestGpuiBridgeActiveProjectContext(attempt + 1),
        50,
      );
    }
    return;
  }

  if (!latestGpuiBridgeWorkspace) {
    return;
  }

  const payload = createGpuiSidebarActiveProjectContextPayload(
    latestGpuiBridgeWorkspace,
    currentGpuiBridgeRuntimeSettings(),
  );
  postActiveProjectContext(JSON.stringify(payload));
}

function currentGpuiBridgeRuntimeSettings(): GpuiSidebarRuntimeSettings | undefined {
  const installedRuntimeSettings = window.ghostexGpui?.runtimeSettings;
  if (installedRuntimeSettings !== undefined) {
    latestGpuiBridgeRuntimeSettings = installedRuntimeSettings;
    return installedRuntimeSettings;
  }

  return latestGpuiBridgeRuntimeSettings;
}

function hasSameGpuiBridgeRuntimeSettings(
  previous: GpuiSidebarRuntimeSettings | undefined,
  next: GpuiSidebarRuntimeSettingsSnapshot,
): boolean {
  return (
    previous?.debuggingMode === next.debuggingMode &&
    previous?.showBetaFeatures === next.showBetaFeatures
  );
}

/*
 * CDXC:GPUIPhase1 2026-06-14-12:06:
 * The GPUI prototype should embed the real macOS sidebar React component in CEF, not a rewritten placeholder. Mount the existing Storybook harness with a durable fixture so phase 1 has realistic projects, sessions, search, and sidebar controls before a native host bridge is connected.
 */
installGpuiBridgeRuntimeSettingsCallback();
document.body.dataset.sidebarTheme = phase1Args.theme;
document.body.classList.add("vscode-dark");

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Ghostex GPUI sidebar root element was not found.");
}

createRoot(rootElement).render(
  <div className="native-sidebar-shell gpui-phase1-sidebar" data-sidebar-mode="combined">
    <main className="native-sidebar-main">
      <SidebarStoryHarness
        message={createSidebarStoryMessage(phase1Args)}
        onWorkspaceChange={(workspace) => {
          postGpuiBridgeActiveProjectContext(workspace);
        }}
      />
    </main>
  </div>,
);
