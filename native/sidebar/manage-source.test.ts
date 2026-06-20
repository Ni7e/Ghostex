import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const manageSource = readFileSync(new URL("./manage.tsx", import.meta.url), "utf8");
const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");
const terminalWorkspaceSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift", import.meta.url),
  "utf8",
);
const hostProtocolSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/HostProtocol.swift", import.meta.url),
  "utf8",
);
const buildScriptSource = readFileSync(
  new URL("../macos/ghostexHost/build-ghostex-host.sh", import.meta.url),
  "utf8",
);

describe("Manage project workarea source", () => {
  test("keeps the WK page pathless while native owns project-root file scope", () => {
    /*
     * CDXC:Manage 2026-06-20-04:36:
     * Manage must not put workspace paths in the page URL or trust paths from JavaScript. The page sends only ids and relative file paths, while Swift stores the typed project root on the project-editor session and validates every list/read target against it.
     */
    expect(manageSource).toContain("ghostexManageFiles");
    expect(manageSource).toContain('action: "list" | "read"');
    expect(manageSource).toContain("projectEditorId: string;");
    expect(manageSource).toContain("projectId: string;");
    expect(manageSource).not.toContain("projectPath");

    expect(hostProtocolSource).toContain("let projectPath: String?");
    expect(terminalWorkspaceSource).toContain("projectRootPath: command.projectPath");
    expect(terminalWorkspaceSource).toContain("private final class ManageFilesBridge");
    expect(terminalWorkspaceSource).toContain("manageURLIsInsideProjectRoot");
    expect(terminalWorkspaceSource).toContain("manageFilePreviewMaxBytes = 400_000");
    expect(terminalWorkspaceSource).toContain('case "read":');
  });

  test("registers Manage as a mode-scoped bundled project-editor surface", () => {
    /*
     * CDXC:Manage 2026-06-20-04:36:
     * Manage should follow Kanban's bundled WKWebView workarea pattern while retaining a separate project-editor id, mode, titlebar command, and native web bundle.
     */
    expect(nativeSidebarSource).toContain('type ProjectEditorSurfaceMode = "code" | "git" | "tasks" | "manage"');
    expect(nativeSidebarSource).toContain('new URL("manage.html", window.location.href)');
    expect(nativeSidebarSource).toContain("function openProjectManageEditorSurface");
    expect(nativeSidebarSource).toContain("openManageFromTitlebar");
    expect(buildScriptSource).toContain('"$REPO_ROOT/native/sidebar/manage.tsx"');
    expect(buildScriptSource).toContain('writeFileSync(join(webDir, "manage.html")');
  });
});
