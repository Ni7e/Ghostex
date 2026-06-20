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
const packageSource = readFileSync(new URL("../../package.json", import.meta.url), "utf8");

describe("Manage project workarea source", () => {
  test("keeps the WK page pathless while native owns project-root file scope", () => {
    /*
     * CDXC:Manage 2026-06-20-04:36:
     * Manage must not put workspace paths in the page URL or trust paths from JavaScript. The page sends only ids, relative file paths, and edit content, while Swift stores the typed project root on the project-editor session and validates every list/read/save target against it.
     */
    expect(manageSource).toContain("ghostexManageFiles");
    expect(manageSource).toContain('action: "list" | "read" | "save"');
    expect(manageSource).toContain("content?: string;");
    expect(manageSource).toContain("projectEditorId: string;");
    expect(manageSource).toContain("projectId: string;");
    expect(manageSource).not.toContain("projectPath");

    expect(hostProtocolSource).toContain("let projectPath: String?");
    expect(terminalWorkspaceSource).toContain("projectRootPath: command.projectPath");
    expect(terminalWorkspaceSource).toContain("private final class ManageFilesBridge");
    expect(terminalWorkspaceSource).toContain("manageURLIsInsideProjectRoot");
    expect(terminalWorkspaceSource).toContain("manageFilePreviewMaxBytes = 2_000_000");
    expect(terminalWorkspaceSource).toContain("manageFileSaveMaxBytes = 2_000_000");
    expect(terminalWorkspaceSource).toContain('case "read":');
    expect(terminalWorkspaceSource).toContain('case "save":');
    expect(terminalWorkspaceSource).toContain("manageSaveProjectFile(rootURL: rootURL, path: request.path, content: request.content)");
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

  test("executes the generated Manage bundle as a module script", () => {
    /*
     * CDXC:ManageWebBuild 2026-06-20-16:03:
     * Excalidraw brings import.meta into the Manage bundle for worker and development-mode guards, so the native Manage HTML wrapper must be a module script while preserving the inlined boot-error capture.
     */
    const manageTemplateStart = buildScriptSource.indexOf(
      'writeFileSync(join(webDir, "manage.html")',
    );
    const manageTemplateEnd = buildScriptSource.indexOf(
      'writeFileSync(join(webDir, "pet-host.html")',
    );
    expect(manageTemplateStart).toBeGreaterThan(-1);
    expect(manageTemplateEnd).toBeGreaterThan(manageTemplateStart);
    const manageTemplateSource = buildScriptSource.slice(manageTemplateStart, manageTemplateEnd);
    expect(manageTemplateSource).toContain('<script type="module">');
    expect(manageTemplateSource).toContain("(function () {");
    expect(manageTemplateSource).toContain("}).call(window);");
    expect(manageTemplateSource).toContain("${escapedManageJs}");
    expect(manageTemplateSource).toContain("window.__ghostex_BOOT_ERROR__");
  });

  test("uses a Manage sidebar overflow menu with hide and side controls", () => {
    /*
     * CDXC:ManageSidebar 2026-06-20-17:15:
     * The Manage file-sidebar header should expose Hide as its own icon button, replace the direct Refresh icon with an overflow menu, keep Refresh inside that menu, and let users switch the file sidebar between left and right without losing a restore affordance after hiding it.
     */
    expect(manageSource).toContain("function ManageSidebarActions");
    expect(manageSource).toContain('aria-label="Hide file sidebar"');
    expect(manageSource).toContain('aria-label="Manage sidebar menu"');
    expect(manageSource).toContain("Switch sidebar side");
    expect(manageSource).toContain('aria-label="Show file sidebar"');
    expect(manageSource).toContain('data-sidebar-hidden={String(sidebarHidden)}');
    expect(manageSource).toContain("setSidebarSide((current) => (current === \"left\" ? \"right\" : \"left\"))");
    expect(manageSource).toContain("MANAGE_SIDEBAR_SIDE_STORAGE_KEY");
    expect(manageSource).toContain(".manage-sidebar-menu");
    expect(manageSource).toContain(".manage-sidebar-restore-button");
    expect(manageSource).not.toContain('aria-label="Refresh files"');
  });

  test("saves edits through the native bridge with normalized in-project paths", () => {
    /*
     * CDXC:ManageEditing 2026-06-20-06:14:
     * Manage save support must be a direct write path, not a preview-only workaround. Swift should reuse the normalized project-relative URL helper, reject parent/symlink escapes, bound UTF-8 write size, and write without persistent logging.
     */
    expect(terminalWorkspaceSource).toContain("let content: String?");
    expect(terminalWorkspaceSource).toContain("private nonisolated static func manageSaveProjectFile");
    expect(terminalWorkspaceSource).toContain("let target = try manageURL(rootURL: rootURL, relativePath: path)");
    expect(terminalWorkspaceSource).toContain("resolvingSymlinksInPath()");
    expect(terminalWorkspaceSource).toContain("guard manageURLIsInsideProjectRoot(parentURL, rootURL: rootURL)");
    expect(terminalWorkspaceSource).toContain("try data.write(to: target.url, options: [.atomic])");
    expect(terminalWorkspaceSource).not.toContain("print(content)");
    expect(terminalWorkspaceSource).not.toContain("NSLog(content)");
  });

  test("provides Markdown editing with mode-driven annotations and export", () => {
    /*
     * CDXC:ManageAnnotations 2026-06-20-06:35:
     * Markdown annotation in Manage should support Select, Redline, and Comment modes; selecting text should expose quick selected-text actions; comments can be global; quick labels and structured Markdown copy should be available without logging annotation text.
     */
    expect(manageSource).toContain('import ReactMarkdown from "react-markdown"');
    expect(manageSource).toContain('import remarkGfm from "remark-gfm"');
    expect(manageSource).toContain("function MarkdownReviewPane");
    expect(manageSource).toContain("function ManageAnnotationPanel");
    expect(manageSource).toContain("function ManageSelectionToolbar");
    expect(manageSource).toContain('type ManageAnnotationMode = "select" | "redline" | "comment"');
    expect(manageSource).toContain('type ManageAnnotationScope = "global" | "selection"');
    expect(manageSource).toContain("annotationsByPath");
    expect(manageSource).toContain("manage-annotation-highlight");
    expect(manageSource).toContain("onSelectionCapture");
    expect(manageSource).toContain("markdownMode");
    expect(manageSource).toContain("annotationMode");
    expect(manageSource).toContain('annotationMode === "redline"');
    expect(manageSource).toContain('setAnnotationMode("comment")');
    expect(manageSource).toContain("MANAGE_QUICK_LABELS");
    expect(manageSource).toContain('"clarify"');
    expect(manageSource).toContain('"needs-tests"');
    expect(manageSource).toContain('"looks-good"');
    expect(manageSource).toContain("formatManageAnnotationsAsMarkdown");
    expect(manageSource).toContain("writeTextToClipboard");
  });

  test("persists Markdown annotations through a project-scoped sidecar", () => {
    /*
     * CDXC:ManageAnnotationPersistence 2026-06-20-06:35:
     * Annotation persistence should reuse the existing native Manage read/save bridge with a fixed project-relative Ghostex sidecar path so Swift owns path normalization and JavaScript never writes arbitrary absolute paths.
     */
    expect(manageSource).toContain('const MANAGE_ANNOTATIONS_SIDECAR_PATH = ".ghostex/manage-annotations.json"');
    expect(manageSource).toContain("type ManageAnnotationStore");
    expect(manageSource).toContain("parseManageAnnotationStore");
    expect(manageSource).toContain("serializeManageAnnotationStore");
    expect(manageSource).toContain("stableManageAnnotationStoreKey");
    expect(manageSource).toContain("normalizeStoredAnnotationPath");
    expect(manageSource).toContain('action: "read"');
    expect(manageSource).toContain("path: MANAGE_ANNOTATIONS_SIDECAR_PATH");
    expect(manageSource).toContain('action: "save"');
    expect(manageSource).toContain("annotationsLoadedRef");
    expect(terminalWorkspaceSource).toContain('".ghostex"');
    expect(terminalWorkspaceSource).toContain("FileManager.default.createDirectory(at: parentURL, withIntermediateDirectories: true)");
  });

  test("supports annotation image attachments without persistent logs", () => {
    /*
     * CDXC:ManageAnnotationAttachments 2026-06-20-06:35:
     * Image attachments should be bounded local feedback artifacts, stored only in the annotation sidecar and copied only when the user exports feedback.
     */
    expect(manageSource).toContain("type ManageAnnotationImage");
    expect(manageSource).toContain("MANAGE_ANNOTATION_IMAGE_MAX_BYTES");
    expect(manageSource).toContain("MANAGE_ANNOTATION_MAX_IMAGES");
    expect(manageSource).toContain('accept="image/*"');
    expect(manageSource).toContain("reader.readAsDataURL(file)");
    expect(manageSource).toContain("normalizeStoredAttachment");
    expect(manageSource).toContain("manage-attachment-strip");
    expect(manageSource).not.toContain("console.log(annotation");
    expect(manageSource).not.toContain("console.error(annotation");
  });

  test("lists direct Manage children before recursive descendants so root files survive the cap", () => {
    /*
     * CDXC:ManageFileListing 2026-06-20-06:52:
     * Native Manage listing must append every eligible direct child of a directory before recursing into nested directories, preventing large nested trees from consuming the 1,200-entry cap before root-level files and drawings are visible.
     */
    const traversalStart = terminalWorkspaceSource.indexOf(
      "private nonisolated static func manageAppendProjectFileEntries",
    );
    const traversalEnd = terminalWorkspaceSource.indexOf(
      "private nonisolated static func manageProjectFilePreview",
    );
    expect(traversalStart).toBeGreaterThan(-1);
    expect(traversalEnd).toBeGreaterThan(traversalStart);
    const traversalSource = terminalWorkspaceSource.slice(traversalStart, traversalEnd);
    const ignoredDirectoriesStart = terminalWorkspaceSource.indexOf("manageIgnoredDirectoryNames");
    const ignoredDirectoriesEnd = terminalWorkspaceSource.indexOf(
      "private nonisolated static func manageProjectRootURL",
    );
    expect(ignoredDirectoriesStart).toBeGreaterThan(-1);
    expect(ignoredDirectoriesEnd).toBeGreaterThan(ignoredDirectoriesStart);
    const ignoredDirectoriesSource = terminalWorkspaceSource.slice(ignoredDirectoriesStart, ignoredDirectoriesEnd);
    const appendIndex = traversalSource.indexOf("entries.append(\n        ManageFileEntry(");
    const queueIndex = traversalSource.indexOf(
      "directoriesToRecurse.append((url: child, relativePath: relativePath))",
    );
    const recurseLoopIndex = traversalSource.indexOf("for directory in directoriesToRecurse {");
    const recurseCallIndex = traversalSource.indexOf("directoryURL: directory.url");
    expect(traversalSource).toContain("var directoriesToRecurse: [(url: URL, relativePath: String)] = []");
    expect(appendIndex).toBeGreaterThan(-1);
    expect(queueIndex).toBeGreaterThan(appendIndex);
    expect(recurseLoopIndex).toBeGreaterThan(queueIndex);
    expect(recurseCallIndex).toBeGreaterThan(recurseLoopIndex);
    expect(traversalSource).toContain("return leftIsDirectory && !rightIsDirectory");
    expect(ignoredDirectoriesSource).not.toContain("excalidraw");
  });

  test("opens Excalidraw files as editable drawings and keeps them visible in file listing", () => {
    /*
     * CDXC:ManageDrawings 2026-06-20-06:14:
     * Root-level and nested .excalidraw files should remain normal project files in Manage, open with a drawing editor, and save complete scene JSON through the same bridge as text edits.
     */
    expect(packageSource).toContain('"@excalidraw/excalidraw"');
    expect(manageSource).toContain('import { Excalidraw } from "@excalidraw/excalidraw"');
    expect(manageSource).toContain("function ManageExcalidrawEditor");
    expect(manageSource).toContain("function parseExcalidrawFile");
    expect(manageSource).toContain("function serializeExcalidrawFile");
    expect(manageSource).toContain("function createExcalidrawSceneSignature");
    expect(manageSource).toContain("function normalizeExcalidrawZoom");
    expect(manageSource).toContain("hasAcceptedInitialSceneRef");
    expect(manageSource).toContain("previousSceneSignatureRef");
    expect(manageSource).toContain("return /\\.excalidraw$/iu.test(path);");
    expect(manageSource).toContain('excalidraw: "Excalidraw"');
    expect(terminalWorkspaceSource).toContain('if isDirectory && manageIgnoredDirectoryNames.contains(name)');
    expect(terminalWorkspaceSource).toContain('kind: isDirectory ? "directory" : "file"');
  });

  test("uses generic privacy checks without encoded local source identifiers", () => {
    /*
     * CDXC:ManagePrivacy 2026-06-20-06:35:
     * Source tests must not retain private local source identifiers, including obfuscated character-code reconstruction. Keep repository privacy verification generic and rely on external scans for environment-specific forbidden terms.
     */
    const manageTestSource = readFileSync(new URL("./manage-source.test.ts", import.meta.url), "utf8");
    const numericCharacterCodeArrayPattern = /\[\s*\d{2,3}\s*,\s*\d{2,3}\s*,\s*\d{2,3}(?:\s*,\s*\d{2,3})+\s*\]/u;
    const absoluteLocalPathLiteralPattern = /["'`]\/(?:Users|private\/tmp|tmp)\/[^"'`]+["'`]/u;
    expect(manageSource).not.toMatch(numericCharacterCodeArrayPattern);
    expect(manageTestSource).not.toMatch(numericCharacterCodeArrayPattern);
    expect(manageSource).not.toMatch(absoluteLocalPathLiteralPattern);
    expect(manageTestSource).not.toMatch(absoluteLocalPathLiteralPattern);
  });
});
