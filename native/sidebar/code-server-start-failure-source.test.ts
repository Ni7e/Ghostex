import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");
const appDelegateSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift", import.meta.url),
  "utf8",
);
const nativeT3LogSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/NativeT3CodePaneReproLog.swift", import.meta.url),
  "utf8",
);

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("code-server startup failure bridge", () => {
  test("shows an immediate VS Code toast and logs an error-classified sanitized native failure", () => {
    /*
    CDXC:EditorPanes 2026-06-06-23:50:
    VS Code server startup failures must not wait for the generic project-editor timeout. Native should return the failure to the project editor row, show an error toast, and write the persistent support log through the native privacy sanitizer.
    */
    const wakeProjectEditor = sourceBetween(
      nativeSidebarSource,
      "function wakeProjectEditorSurface",
      "function restoreActiveProjectEditorAtStartup",
    );
    const startRuntimeHelper = sourceBetween(
      nativeSidebarSource,
      "function postStartCodeServerRuntimeForProject",
      "function nativeGhostexHomeDirectory",
    );
    expect(wakeProjectEditor).toContain("projectId: nativeEditorId");
    expect(wakeProjectEditor).toContain("postStartCodeServerRuntimeForProject(project);");
    expect(startRuntimeHelper).toContain('type: "startCodeServerRuntime"');

    const hostEventHandler = sourceBetween(
      nativeSidebarSource,
      'if (hostEvent.type === "codeServerRuntimeStartFailed")',
      'if (hostEvent.type === "projectEditorLoadState")',
    );
    expect(hostEventHandler).toContain('setProjectEditorLoadState(hostEvent.projectId, "error", hostEvent.message)');
    expect(hostEventHandler).toContain('showAppToast("error", "VS Code server failed", hostEvent.message');
    expect(hostEventHandler).toContain("CODE_SERVER_RUNTIME_TOAST_ID");

    const nativeFailures = appDelegateSource.match(/codeServerRuntime\.start\.failed[\s\S]*?logger\.error/g) ?? [];
    expect(nativeFailures.length).toBeGreaterThanOrEqual(2);
    for (const nativeFailure of nativeFailures) {
      expect(nativeFailure).toContain('"level": "error"');
      expect(nativeFailure).toContain(".codeServerRuntimeStartFailed(projectId: command.projectId, message: failureMessage)");
      expect(nativeFailure).toContain("NativeLogPrivacy.sanitizeLogLine(error.localizedDescription)");
    }

    const nativeT3Append = sourceBetween(
      nativeT3LogSource,
      "static func append(_ event: String",
      "private static func serialize",
    );
    expect(nativeT3Append).toContain("NativeLogPrivacy.sanitizePayload(payload)");

    expect(nativeT3LogSource).toContain("validateCodeServerDevelopmentPayload(repoRoot:");
    expect(nativeT3LogSource).toContain("lib/vscode/out/server-main.js");
    expect(nativeT3LogSource).toContain("code-server's raw 500 page");
    expect(nativeT3LogSource).toContain("@vscode/fs-copyfile/build/Release/vscode_fs.node");
    expect(nativeT3LogSource).toContain("Git activation failure toast");
  });
});
