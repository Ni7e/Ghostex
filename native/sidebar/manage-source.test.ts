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
    expect(terminalWorkspaceSource).toContain("file: try manageSaveProjectFile(");
    expect(terminalWorkspaceSource).toContain("additionalDocsFoldersText: additionalDocsFoldersText");
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

  test("uses a Docs sidebar overflow menu with hide and side controls", () => {
    /*
     * CDXC:ManageSidebar 2026-06-20-17:15:
     * The Manage file-sidebar header should expose Hide as its own icon button, replace the direct Refresh icon with an overflow menu, keep Refresh inside that menu, and let users switch the file sidebar between left and right without losing a restore affordance after hiding it.
     *
     * CDXC:ManageSidebar 2026-06-30-01:35:
     * The Docs sidebar overflow menu should use a polished popover treatment: slight edge inset, rounded surface, softened shadow, and clear icon/text row hover states.
     *
     * CDXC:ManageSidebar 2026-06-30-02:30:
     * The Docs sidebar dropdown should remove the pointer arrow and use a flat
     * #0e0e0e background with a 1px #595959 border.
     *
     * CDXC:ManageSidebar 2026-06-30-02:45:
     * The Docs sidebar dropdown should use reduced corner roundness: 4px on
     * the menu surface and 3px on action rows.
     */
    expect(manageSource).toContain("function ManageSidebarActions");
    expect(manageSource).toContain('aria-label="Hide file sidebar"');
    expect(manageSource).toContain('aria-label="Docs sidebar menu"');
    expect(manageSource).toContain("Switch sidebar side");
    expect(manageSource).toContain('aria-label="Show file sidebar"');
    expect(manageSource).toContain('data-sidebar-hidden={String(sidebarHidden)}');
    expect(manageSource).toContain("setSidebarSide((current) => (current === \"left\" ? \"right\" : \"left\"))");
    expect(manageSource).toContain("MANAGE_SIDEBAR_SIDE_STORAGE_KEY");
    expect(manageSource).toContain(".manage-sidebar-menu");
    expect(manageSource).toContain(".manage-sidebar-restore-button");
    expect(manageSource).not.toContain('aria-label="Refresh files"');

    const sidebarMenuCssStart = manageSource.indexOf("  .manage-sidebar-menu {");
    const sidebarMenuCssEnd = manageSource.indexOf("  .manage-create-menu {", sidebarMenuCssStart);
    expect(sidebarMenuCssStart).toBeGreaterThan(-1);
    expect(sidebarMenuCssEnd).toBeGreaterThan(sidebarMenuCssStart);
    const sidebarMenuCss = manageSource.slice(sidebarMenuCssStart, sidebarMenuCssEnd);
    expect(sidebarMenuCss).toContain("backdrop-filter: blur(18px);");
    expect(sidebarMenuCss).toContain("background: #0e0e0e;");
    expect(sidebarMenuCss).toContain("border: 1px solid #595959;");
    expect(sidebarMenuCss).toContain("border-radius: 4px;");
    expect(sidebarMenuCss).not.toContain("linear-gradient(");
    expect(sidebarMenuCss).toContain("inset 0 1px 0 rgba(255, 255, 255, 0.08)");
    expect(sidebarMenuCss).toContain("right: 6px;");
    expect(sidebarMenuCss).toContain("top: calc(100% + 7px);");
    expect(manageSource).not.toContain("  .manage-sidebar-menu::before {");
    expect(manageSource).toContain("  .manage-sidebar-menu-item svg {");
    expect(manageSource).toContain("border-radius: 3px;");
  });

  test("keeps the Manage file sidebar resizable on either side", () => {
    /*
     * CDXC:ManageSidebar 2026-06-26-23:14:
     * The Manage file sidebar should have a visible separator that can resize the artifacts tree on the left or right side, persists width locally, and keeps the preview/editor in normal non-overlapping grid layout.
     *
     * CDXC:DocsSidebar 2026-06-28-15:05:
     * The Docs sidebar resize rail should visually match the main native sidebar rail: a five-point grid track, one-point edge separator, and three-point hover affordance.
     */
    expect(manageSource).toContain("MANAGE_SIDEBAR_WIDTH_STORAGE_KEY");
    expect(manageSource).toContain("readStoredManageSidebarWidth");
    expect(manageSource).toContain("clampManageSidebarWidth");
    expect(manageSource).toContain('style={{ "--manage-sidebar-width": `${sidebarWidth}px` } as CSSProperties}');
    expect(manageSource).toContain('aria-label="Resize file sidebar"');
    expect(manageSource).toContain('role="separator"');
    expect(manageSource).toContain("handleSidebarResizePointerDown");
    expect(manageSource).toContain("handleSidebarResizeKeyDown");
    expect(manageSource).toContain(".manage-sidebar-resizer");
    expect(manageSource).toContain('grid-template-columns: var(--manage-sidebar-width, 292px) 5px minmax(0, 1fr)');
    expect(manageSource).toContain('grid-template-columns: minmax(0, 1fr) 5px var(--manage-sidebar-width, 292px)');
    expect(manageSource).toContain("width: 3px;");
  });

  test("creates folders, Markdown, HTML, and Excalidraw documents from the Docs sidebar", () => {
    /*
     * CDXC:ManageArtifacts 2026-06-26-13:59:
     * Manage should offer top-sidebar creation buttons for Markdown, HTML, and Excalidraw artifacts.
     *
     * CDXC:Docs 2026-06-28-06:24:
     * The user-facing Docs surface should create Markdown, HTML, and Excalidraw
     * documents under docs/ and immediately open the created file in the
     * preview/editor.
     *
     * CDXC:ManageFolders 2026-06-28-06:39:
     * The Docs sidebar create row now includes folders, so the accessible group
     * label must describe docs items rather than documents only.
     *
     * CDXC:ManageFolders 2026-06-28-07:02:
     * Native returns a flat capped listing, but the sidebar must tree-order it
     * before collapsed-folder filtering so children render directly below their
     * parent folders.
     *
     * CDXC:DocsSidebar 2026-06-29-04:08:
     * The docs/ directory should be a real top-level folder row now that
     * repo-root artifact files can also appear in the Docs sidebar. The header
     * needs a compact collapse/expand button immediately before Create.
     *
     * CDXC:DocsSidebar 2026-06-30-00:15:
     * The Docs header folder control should use the same diagonal-arrows icon
     * language as the macOS sidebar Projects bulk control while keeping Docs
     * stateless: Collapse All closes every expandable nested folder, and
     * Expand All clears the collapsed-folder set instead of restoring previous
     * expansion state.
     *
     * CDXC:ManageFolders 2026-06-28-07:12:
     * The Docs sidebar create actions live in the header plus menu, file rows
     * can target their containing folder/root for drops, and file rows do not
     * show size badges.
     *
     * CDXC:DocsSidebar 2026-06-28-15:05:
     * The Docs sidebar should remove the file count and selected-file summary
     * block so the tree starts directly below Search and use a hover-only 2px
     * scrollbar.
     *
     * CDXC:DocsSidebar 2026-06-28-15:57:
     * Docs file rows should use tighter padding, keep the selected file on its
     * selected-row surface, and show active parent folders by turning only
     * their text/icon color full white.
     *
     * CDXC:DocsSidebar 2026-06-28-16:29:
     * Docs sidebar search and file row buttons should fill the sidebar width
     * without an outer horizontal gutter; spacing belongs inside the controls.
     *
     * CDXC:DocsHeader 2026-06-29-03:43:
     * The Manage sidebar header should match the editor header's compact titlebar
     * strip, and the hidden-sidebar button should sit in that same strip with
     * an expand icon that indicates the sidebar will reopen.
     *
     * CDXC:DocsHeader 2026-06-29-21:48:
     * The Manage sidebar and editor headers were raised to 36px, with matching
     * full-height header buttons.
     *
     * CDXC:DocsHeader 2026-06-29-23:39:
     * The Manage sidebar and editor titlebars should now be 35px tall, with
     * matching full-height header buttons.
     *
     * CDXC:DocsSidebar 2026-06-30-01:46:
     * The Docs sidebar header is actions-only with no repeated root folder
     * title, and the Search-to-file-list gap should stay tight.
     *
     * CDXC:DocsSidebar 2026-06-30-03:20:
     * The Docs file tree should sit 5px closer to the sidebar's left edge while
     * the Search field keeps its current padding and icon alignment.
     *
     * CDXC:ManageFileActions 2026-06-29-03:27:
     * Folders should use the same right-click Rename/Delete menu as files, and
     * empty sidebar background right-clicks should suppress WebKit's default
     * Reload/Inspect context menu.
     *
     * CDXC:ManageFileActions 2026-06-30-01:37:
     * The Docs file context menu should match the polished dark popover styling
     * of the sidebar dropdowns while preserving the red Delete action state.
     *
     * CDXC:ManageFileActions 2026-06-30-02:30:
     * Docs file context menus should use the same flat #0e0e0e background and
     * 1px #595959 border as the sidebar dropdown.
     *
     * CDXC:ManageFileActions 2026-06-30-02:45:
     * Docs file context menu corners should match the reduced dropdown
     * roundness with 4px outer radius and 3px row radius.
     *
     * CDXC:ManageFileActions 2026-06-30-09:48:
     * Files and folders in the Docs sidebar should expose Copy path in the same
     * context menu as Rename/Delete, copying the Manage-relative path instead
     * of an absolute workspace path. The fixed docs root should still open a
     * copy-only menu while rename/delete remain unavailable there.
     */
    expect(manageSource).toContain('type ManageArtifactKind = "excalidraw" | "html" | "markdown"');
    expect(manageSource).toContain('const MANAGE_DOCS_ROOT_PATH = "docs"');
    expect(manageSource).toContain("function ManageSidebarActions");
    expect(manageSource).toContain('aria-label="Create docs item"');
    expect(manageSource).toContain("<IconPlus");
    expect(manageSource).toContain("New folder");
    expect(manageSource).toContain("New Markdown");
    expect(manageSource).toContain("New HTML");
    expect(manageSource).toContain("New drawing");
    expect(manageSource).toContain("createUniqueFolderPath(entries)");
    expect(manageSource).toContain("function orderManageEntriesForTree");
    expect(manageSource).toContain("const treeOrderedEntries = useMemo(() => orderManageEntriesForTree(entries), [entries]);");
    expect(manageSource).toContain("const parentPath = parentManagePath(entry.path);");
    expect(manageSource).toContain('appendChildren("");');
    expect(manageSource).toContain("return treeOrderedEntries.filter((entry) => !hasCollapsedManageAncestor(entry.path, collapsedDirectoryPaths));");
    expect(manageSource).toContain('kind: "entry";');
    expect(manageSource).toContain("targetDirectoryPath: string;");
    expect(manageSource).toContain("function dropDirectoryPathForManageEntry");
    expect(manageSource).toContain("entry.kind === \"directory\" ? entry.path : parentManagePath(entry.path) || MANAGE_DOCS_ROOT_PATH");
    expect(manageSource).toContain("void moveEntryToDirectory(dragEntry, targetDirectoryPath)");
    expect(manageSource).toContain('isDropTarget={dropTarget?.kind === "entry" && dropTarget.path === entry.path}');
    expect(manageSource).not.toContain("function ManageSidebarFileToolbar");
    expect(manageSource).not.toContain('aria-label="Selected file details"');
    expect(manageSource).not.toContain("manage-sidebar-meta");
    expect(manageSource).not.toContain("const [rootName, setRootName]");
    expect(manageSource).not.toContain("manage-project-title");
    expect(manageSource).toContain("justify-content: flex-end;");
    expect(manageSource).toContain("scrollbar-color: transparent transparent;");
    expect(manageSource).toContain("width: 2px;");
    expect(manageSource).toContain("hasActiveFileDescendant=");
    expect(manageSource).toContain("isManageDescendantPath(selectedPath, entry.path)");
    expect(manageSource).toContain('data-active-descendant={String(hasActiveFileDescendant)}');
    expect(manageSource).toContain('padding: 4px 7px 4px calc(9px + (var(--depth) * 18px));');
    expect(manageSource).toContain('min-height: 29px;');
    expect(manageSource).toContain('.manage-file-row[data-kind="directory"][data-active-descendant="true"]');
    expect(manageSource).toContain("color: #ffffff;");
    expect(manageSource).toContain("padding: 0 0 7px;");
    expect(manageSource).toContain("margin: 0 0 4px;");
    expect(manageSource).toContain("box-sizing: border-box;");
    expect(manageSource).toContain("IconLayoutSidebarLeftExpand");
    expect(manageSource).toContain("IconLayoutSidebarRightExpand");
    expect(manageSource).toContain("IconArrowsDiagonalMinimize");
    expect(manageSource).toContain("IconArrowsDiagonal2");
    expect(manageSource).toContain("const expandableDirectoryPaths = useMemo");
    expect(manageSource).toContain("hasExpandedDirectories ? \"Collapse All\" : \"Expand All\"");
    expect(manageSource).toContain("manage-sidebar-tree-toggle");
    expect(manageSource).toContain("return new Set(expandableDirectoryPaths);");
    expect(manageSource).toContain("return new Set();");
    expect(manageSource).toContain("onToggleAllDirectories={toggleAllDirectories}");
    expect(manageSource).toContain("function canOpenManageEntryContextMenu");
    expect(manageSource).toContain("function canRenameOrDeleteManageEntry");
    expect(manageSource).toContain('return entry.kind === "file" || entry.kind === "directory";');
    expect(manageSource).toContain(".manage-sidebar-header .manage-icon-button,");
    expect(manageSource).toContain(".manage-sidebar-restore-button {");
    expect(manageSource).toContain("height: 35px;");
    expect(manageSource).toContain("max-height: 35px;");
    expect(manageSource).toContain("min-height: 35px;");
    expect(manageSource).toContain("padding-left: 51px;");
    expect(manageSource).toContain("padding-right: 51px;");
    expect(manageSource).not.toContain('className="manage-file-size"');
    expect(manageSource).toContain("createUniqueArtifactPath(entries, kind)");
    expect(manageSource).toContain("createInitialArtifactContent(kind)");
    expect(manageSource).toContain("onContextMenu={suppressSidebarDefaultContextMenu}");
    expect(manageSource).toContain('aria-haspopup="menu"');
    expect(manageSource).toContain("currentEntry.kind === \"directory\" && renamedSelectedPath && isDirty");
    expect(manageSource).toContain("currentEntry.kind === \"directory\" && deletesSelectedPath");
    expect(manageSource).toContain("removeManageAnnotationPathsForDeletedEntry");
    expect(manageSource).toContain("removeManagePathSetForDeletedEntry");
    expect(manageSource).toContain("onCopyPath={() => void copyEntryPath(contextMenuEntry)}");
    expect(manageSource).toContain("canRenameOrDelete={contextMenuCanRenameOrDelete}");
    expect(manageSource).toContain("await writeTextToClipboard(entry.path)");
    expect(manageSource).toContain("Copy path");
    expect(manageSource).toContain("Rename item");
    const fileContextMenuCssStart = manageSource.indexOf("  .manage-file-context-menu {");
    const fileContextMenuCssEnd = manageSource.indexOf("  .manage-file-context-menu-item {", fileContextMenuCssStart);
    expect(fileContextMenuCssStart).toBeGreaterThan(-1);
    expect(fileContextMenuCssEnd).toBeGreaterThan(fileContextMenuCssStart);
    const fileContextMenuCss = manageSource.slice(fileContextMenuCssStart, fileContextMenuCssEnd);
    expect(fileContextMenuCss).toContain("backdrop-filter: blur(18px);");
    expect(fileContextMenuCss).toContain("background: #0e0e0e;");
    expect(fileContextMenuCss).toContain("border: 1px solid #595959;");
    expect(fileContextMenuCss).toContain("border-radius: 4px;");
    expect(fileContextMenuCss).toContain("min-width: 166px;");
    expect(fileContextMenuCss).not.toContain("linear-gradient(");
    expect(fileContextMenuCss).toContain("inset 0 1px 0 rgba(255, 255, 255, 0.08)");
    expect(manageSource).toContain("  .manage-file-context-menu-item svg {");
    expect(manageSource).toContain("  .manage-file-context-menu-item-danger:hover,");
    expect(manageSource).toContain("box-shadow: inset 0 0 0 1px rgba(253, 164, 175, 0.12);");
    expect(terminalWorkspaceSource).toContain("throws -> ManageFilePreview?");
    expect(terminalWorkspaceSource).toContain("!managePathIsDocsScanRoot(source.relativePath");
    expect(terminalWorkspaceSource).toContain("!managePathIsDocsScanRoot(destination.relativePath");
    expect(terminalWorkspaceSource).toContain("Could not rename item.");
    expect(terminalWorkspaceSource).toContain("Could not delete item.");
    /*
     * CDXC:ManageDefaultHtml 2026-06-28-07:17:
     * New HTML Docs files should explain that users can ask an agent to create a polished explanatory HTML document and then annotate the rendered page with Agentation.
     *
     * CDXC:ManageDefaultHtml 2026-06-30-04:41:
     * The starter page should use document-owned CSS, a max two-column card grid, a fourth guidance card, and full dark document background coverage so narrow widths do not leave an empty grid slot or white iframe gutter.
     */
    expect(manageSource).toContain("function createDefaultHtmlDocument");
    expect(manageSource).toContain("Ask your agent for an HTML explainer");
    expect(manageSource).toContain('meta name="color-scheme" content="dark"');
    expect(manageSource).toContain(":root { color-scheme: dark; background: #0e0e0e; }");
    expect(manageSource).toContain(".docs-card-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }");
    expect(manageSource).toContain(".docs-card-grid { grid-template-columns: 1fr; }");
    expect(manageSource).toContain("<p><strong>Good requests are specific.</strong>");
    expect(manageSource).toContain("<p><strong>Good annotations are precise.</strong>");
    expect(manageSource).not.toContain("repeat(auto-fit, minmax(220px, 1fr))");
    expect(manageSource).toContain("Use the bottom-left Agentation control when you are ready");
    expect(manageSource).toContain("annotate it in Ghostex Docs with Agentation");
    expect(manageSource).toContain("selectedPathRef.current = createdFile.path");
    expect(manageSource).toContain("setPreview(createdFile)");
  });

  test("renders the default HTML starter as a responsive four-card page", () => {
    /*
     * CDXC:ManageDefaultHtml 2026-06-30-04:41:
     * Default HTML Docs should avoid an empty grid slot at narrow widths by using exactly four guidance cards in a max two-column grid, collapsing to one column only on small screens.
     */
    expect(manageSource).toContain("function createDefaultHtmlDocument");
    expect(manageSource).toContain(":root { color-scheme: dark; background: #0e0e0e; }");
    expect(manageSource).toContain(".docs-card-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }");
    expect(manageSource).toContain(".docs-card-grid { grid-template-columns: 1fr; }");
    expect(manageSource).toContain('<section class="docs-card-grid">');
    expect(manageSource).toContain('<p class="docs-card-kicker">4. Refine</p>');
    expect(manageSource).toContain("<p><strong>Good requests are specific.</strong>");
    expect(manageSource).toContain("<p><strong>Good annotations are precise.</strong>");
    expect(manageSource).not.toContain("repeat(auto-fit, minmax(220px, 1fr))");
  });

  test("omits the Manage editor header Save button", () => {
    /*
     * CDXC:ManageEditing 2026-06-21-18:00:
     * The macOS Manage editor header should not expose a Save button. Keep the native save bridge available for shortcut-driven edit persistence, but do not render the old wide header action in the file panel.
     */
    expect(manageSource).not.toContain("manage-save-button");
    expect(manageSource).not.toContain("IconDeviceFloppy");
    expect(manageSource).not.toContain("onSave={() => void saveFile()}");
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

  test("scopes the Docs file tree and normal file access to configured docs folders and root artifacts", () => {
    /*
     * CDXC:ManageArtifacts 2026-06-26-13:59:
     * Native Manage listing used to expose only the active project's artifacts/ tree.
     *
     * CDXC:Docs 2026-06-28-06:24:
     * Native Docs listing should expose the active project's docs/ tree while
     * preserving project-relative docs/... paths for file opens and saves. The
     * annotation sidecar remains a fixed Ghostex-owned project path outside the
     * visible tree.
     *
     * CDXC:Docs 2026-06-29-03:54:
     * The Docs sidebar should also show Markdown, HTML, and Excalidraw files
     * that live directly at the repo root. Root access must be file-only and
     * extension allowlisted so Docs does not become a broad repo browser.
     *
     * CDXC:Docs 2026-06-29-04:08:
     * The native list should include docs/ itself as a directory entry and then
     * recurse into its children at depth 1 so the web sidebar can expand and
     * collapse docs/ as a normal folder beside root artifacts.
     *
     * CDXC:DocsSidebar 2026-06-30-19:47:
     * Global Projects settings can add comma-separated project-relative Docs scan roots. Source checks should require the shared scan-root helper and native layout setting rather than hardcoding only docs/.
     */
    expect(hostProtocolSource).toContain("let manageAdditionalDocsFolders: String?");
    expect(nativeSidebarSource).toContain("manageAdditionalDocsFolders: settings.manageAdditionalDocsFolders");
    expect(terminalWorkspaceSource).toContain('manageDocsRelativePath = "docs"');
    expect(terminalWorkspaceSource).toContain('manageAnnotationsSidecarRelativePath = ".ghostex/manage-annotations.json"');
    expect(terminalWorkspaceSource).toContain("manageRootArtifactFileExtensions");
    expect(terminalWorkspaceSource).toContain("rootName: manageDocsRelativePath");
    expect(terminalWorkspaceSource).toContain("private nonisolated static func manageAdditionalDocsFolderRelativePaths");
    expect(terminalWorkspaceSource).toContain("private nonisolated static func manageDocsScanRootRelativePaths");
    expect(terminalWorkspaceSource).toContain("private nonisolated static func manageProjectDirectoryURL");
    expect(terminalWorkspaceSource).toContain("kind: \"directory\"");
    expect(terminalWorkspaceSource).toContain("name: relativePath");
    expect(terminalWorkspaceSource).toContain("path: relativePath");
    expect(terminalWorkspaceSource).toContain("manageAppendProjectRootArtifactFileEntries(entries: &entries, rootURL: rootURL)");
    expect(terminalWorkspaceSource).toContain("private nonisolated static func manageAppendProjectRootArtifactFileEntries");
    expect(terminalWorkspaceSource).toContain("manageProjectDirectoryURL(rootURL: rootURL, relativePath: relativePath)");
    expect(terminalWorkspaceSource).toContain("directoryURL: directoryURL");
    expect(terminalWorkspaceSource).toContain("relativeDirectoryPath: relativePath");
    expect(terminalWorkspaceSource).toContain("depth: 1)");
    expect(terminalWorkspaceSource).toContain("private nonisolated static func manageValidateAccessibleRelativePath");
    expect(terminalWorkspaceSource).toContain("relativePath == manageAnnotationsSidecarRelativePath");
    expect(terminalWorkspaceSource).toContain("managePathIsInDocsScanRoot(relativePath, additionalDocsFoldersText: additionalDocsFoldersText)");
    expect(terminalWorkspaceSource).toContain("manageIsRootArtifactFileRelativePath(relativePath)");
    expect(terminalWorkspaceSource).toContain("private nonisolated static func manageValidateDocsActionRelativePath");
    expect(terminalWorkspaceSource).toContain("additionalDocsFoldersText: additionalDocsFoldersText)");
  });

  test("uses the copied Meo Markdown editor with Manage annotations", () => {
    /*
     * CDXC:ManageMarkdownEditing 2026-06-27-12:40:
     * Markdown artifacts in Manage should edit and render rich Markdown in one Meo live-editor surface while keeping Ghostex selection annotations, global comments, and structured feedback copy available in the same workarea.
     *
     * CDXC:ManageMarkdownAnnotations 2026-06-28-05:24:
     * Manage owns its annotation selection state from a CodeMirror update listener so multi-line review ranges and caret previews are not limited by Meo's inline formatting menu rules.
     *
     * CDXC:ManageMarkdownToolbar 2026-06-28-06:00:
     * Manage Markdown should mount Meo's editor-native toolbar in the macOS app and use Meo's selection callback only for the switchable formatting toolbar, while annotations still come from Manage's CodeMirror update listener.
     *
     * CDXC:ManageMarkdownToolbar 2026-06-28-07:56:
     * The Live/Source segmented control should visibly mark the selected mode.
     *
     * CDXC:ManageMarkdownTheme 2026-06-28-06:00:
     * The Manage Meo heading token should use #42a5f5.
     */
    expect(manageSource).not.toContain('import ReactMarkdown from "react-markdown"');
    expect(manageSource).not.toContain('import remarkGfm from "remark-gfm"');
    expect(manageSource).not.toContain("function MarkdownReviewPane");
    expect(manageSource).not.toContain("function ManageAnnotationPanel");
    expect(manageSource).not.toContain("function ManageSelectionToolbar");
    expect(manageSource).not.toContain('aria-label="Markdown view"');
    expect(manageSource).not.toContain("markdownMode");
    expect(manageSource).not.toContain("setMarkdownMode");
    expect(manageSource).not.toContain("annotationMode");
    expect(manageSource).not.toContain("setAnnotationMode");
    expect(packageSource).toContain('"@codemirror/view"');
    expect(packageSource).toContain('"@codemirror/lang-markdown"');
    expect(packageSource).toContain('"@replit/codemirror-vim"');
    expect(packageSource).toContain('"katex"');
    expect(packageSource).toContain('"shiki"');
    expect(manageSource).toContain('import { createEditor as createMeoEditor } from "./meo/editor"');
    expect(manageSource).toContain('import "./meo/styles.css"');
    expect(manageSource).toContain("function ManageMarkdownReviewViewer");
    expect(manageSource).toContain("manageMeoAnnotationField");
    expect(manageSource).toContain("manageMeoAnnotationEffect");
    expect(manageSource).toContain("createManageMeoAnnotationDecorations");
    expect(manageSource).toContain("syncManageMeoAnnotationReviewState");
    expect(manageSource).toContain("createMeoEditor({");
    expect(manageSource).toContain("externalExtensions: [");
    expect(manageSource).toContain("manageMeoAnnotationField,");
    expect(manageSource).toContain("initialMode: currentMode");
    expect(manageSource).toContain("function ManageMeoTopToolbar");
    expect(manageSource).toContain("function ManageMeoSelectionFormatToolbar");
    expect(manageSource).toContain("MeoHeadingIcon");
    expect(manageSource).toContain("MeoTable2Icon");
    expect(manageSource).toContain("MeoSearchIcon");
    expect(manageSource).toContain("mode-toolbar");
    expect(manageSource).toContain("format-group");
    expect(manageSource).toContain("mode-group");
    expect(manageSource).toContain('.manage-meo-markdown-editor .mode-button[aria-selected="true"],');
    expect(manageSource).toContain("box-shadow: inset 0 0 0 1px rgba(125, 211, 252, 0.34);");
    expect(manageSource).toContain('const MANAGE_MEO_HEADING_COLOR = "#42a5f5";');
    expect(manageSource).toContain("base04: MANAGE_MEO_HEADING_COLOR");
    expect(manageSource).toContain("onApplyChanges");
    expect(manageSource).toContain("onContentChangeRef.current(nextContent)");
    expect(manageSource).toContain("onContentChange={onDraftContentChange}");
    expect(manageSource).toContain("onSelectionClear={clearSelectedText}");
    expect(manageSource).toContain("onSelectionToolbarModeChange={setSelectionToolbarMode}");
    expect(manageSource).toContain('selectionToolbarMode === "formatting"');
    expect(manageSource).toContain("onSelectionClearRef.current,");
    expect(manageSource).toContain("onAnnotationPreviewChangeRef.current,");
    expect(manageSource).toContain("function ManageAnnotationToolbar");
    expect(manageSource).toContain("function ManageCommentPopover");
    expect(manageSource).toContain("function ManageAnnotationDropdown");
    expect(manageSource).toContain('type ManageAnnotationScope = "global" | "selection"');
    expect(manageSource).toContain("annotationsByPath");
    expect(manageSource).toContain("annotation-highlight manage-annotation-highlight");
    expect(manageSource).toContain("manage-meo-markdown-editor");
    expect(manageSource).toContain("manage-markdown-selection-toolbar");
    expect(manageSource).toContain("manage-comment-popover");
    expect(manageSource).toContain("manage-annotation-dropdown");
    expect(manageSource).toContain("onSelectionCapture");
    expect(manageSource).toContain('key === "backspace" || key === "d" || key === "delete"');
    expect(manageSource).toContain("openCommentDraft(selection.text, selection.anchor");
    expect(manageSource).toContain("MANAGE_QUICK_LABELS");
    expect(manageSource).toContain('"clarify"');
    expect(manageSource).toContain('"needs-tests"');
    expect(manageSource).toContain('"looks-good"');
    expect(manageSource).toContain("formatManageAnnotationsAsMarkdown");
    expect(manageSource).toContain("writeTextToClipboard");
  });

  test("renders HTML artifacts as isolated real documents for Agentation", () => {
    /*
     * CDXC:ManageHtmlRendering 2026-06-28-01:25:
     * HTML artifacts should render as a page surface instead of source code while scripts, event handlers, and script-like URLs remain passive in the app.
     *
     * CDXC:ManageHtmlRendering 2026-06-29-17:25:
     * HTML Docs should render like browser HTML by preserving head CSS, stylesheet links, and meta tags in a srcdoc iframe instead of stripping styles and injecting only body markup into Ghostex's dark Manage document.
     *
     * CDXC:ManageHtmlAgentation 2026-06-28-01:46:
     * Rendered HTML artifacts need a visible Manage header action for annotation mode because the Manage surface hides the native browser feedback toolbar.
     *
     * CDXC:ManageHtmlAgentation 2026-06-28-02:29:
     * The HTML annotation control is named Annotate, is enabled by default, behaves as a toggle, includes the Agentation bootstrap while enabled, and reloads the document without that bootstrap when disabled.
     *
     * CDXC:ManageHtmlAgentation 2026-06-29-18:20:
     * Agentation should be appended as a fixed bootstrap module inside the loaded HTML document, not mounted by the parent Manage React page against the iframe window or wrapper.
     *
     * CDXC:ManageHtmlAgentation 2026-06-30-04:41:
     * The sanitized srcdoc document should allow scripts and same-origin for Ghostex's fixed bootstrap so Agentation's module imports can initialize inside the loaded page.
     *
     * CDXC:ManageHtmlRendering 2026-06-30-04:57:
     * Rendered HTML Docs should inject a document-scoped viewer chrome style so the embedded page uses 4px scrollbars with transparent tracks and corners instead of a visible scrollbar background gutter.
     *
     * CDXC:ManageHtmlAgentation 2026-06-28-07:58:
     * HTML Docs should show Agentation's bottom-left control on open without auto-clicking Start feedback mode, so reading or interacting with the page does not immediately become annotation input.
     */
    expect(manageSource).toContain("function ManageHtmlRenderViewer");
    expect(manageSource).toContain(") : isHtml ? (");
    expect(manageSource).toContain("annotationsEnabled={htmlAnnotationEnabled}");
    expect(manageSource).toContain("content={draftContent}");
    expect(manageSource).toContain("documentKey={preview.path}");
    expect(manageSource).toContain("function sanitizeManageHtmlDocument");
    expect(manageSource).toContain("sanitizeManageHtmlDocument(content, { injectAgentation: annotationsEnabled })");
    expect(manageSource).toContain('new DOMParser().parseFromString(html, "text/html")');
    expect(manageSource).toContain("srcDoc={renderedHtml}");
    expect(manageSource).toContain('sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"');
    expect(manageSource).toContain('documentValue.querySelectorAll("script, iframe, object, embed, base")');
    expect(manageSource).not.toContain('documentValue.querySelectorAll("script, style');
    expect(manageSource).toContain("function injectManageAgentationScript");
    expect(manageSource).toContain('script.type = "module";');
    expect(manageSource).toContain("script.textContent = buildManageAgentationBootstrapScript()");
    expect(manageSource).toContain("function injectManageHtmlViewerChromeStyles");
    expect(manageSource).toContain("injectManageHtmlViewerChromeStyles(documentValue)");
    expect(manageSource).toContain('style.setAttribute("data-ghostex-manage-html-chrome", "true")');
    expect(manageSource).toContain("width: 4px !important;");
    expect(manageSource).toContain("height: 4px !important;");
    expect(manageSource).toContain(":where(html, body, *)::-webkit-scrollbar-track,");
    expect(manageSource).toContain(":where(html, body, *)::-webkit-scrollbar-corner");
    expect(manageSource).toContain("background: transparent !important;");
    expect(manageSource).toContain("rootEl.setAttribute(\"data-agentation-html-root\", \"true\")");
    expect(manageSource).toContain("Promise.all([");
    expect(manageSource).toContain("globalThis.__GHOSTEX_AGENTATION__ = { container: rootEl, root };");
    expect(manageSource).toContain("serializeManageDocumentType(documentValue)");
    expect(manageSource).toContain("documentValue.documentElement.outerHTML");
    expect(manageSource).toContain('name.startsWith("on") || name === "srcdoc"');
    expect(manageSource).toContain("/^(?:javascript|vbscript|data:text\\/html)/iu.test(value)");
    expect(manageSource).toContain(".manage-html-render-view");
    expect(manageSource).toContain("const [htmlAnnotationEnabled, setHtmlAnnotationEnabled] = useState(true);");
    expect(manageSource).toContain('aria-label="Toggle annotations"');
    expect(manageSource).toContain("aria-pressed={htmlAnnotationEnabled}");
    expect(manageSource).toContain("<span>Annotate</span>");
    expect(manageSource).not.toContain("function ensureManageAgentationInjected");
    expect(manageSource).not.toContain("function disableManageAgentation");
    expect(manageSource).not.toContain("function mountManageAgentation");
    expect(manageSource).not.toContain("function importManageAgentationModule");
    expect(manageSource).toContain('const MANAGE_AGENTATION_VERSION = "3.0.2";');
    expect(manageSource).toContain("React.createElement(Agentation)");
    expect(manageSource).not.toContain("iframe.contentWindow");
    expect(manageSource).not.toContain("scheduleManageAgentationAutoActivate");
    expect(manageSource).not.toContain("activateManageAgentationFeedbackMode");
    expect(manageSource).not.toContain("findManageAgentationStartButton");
    expect(manageSource).not.toContain('title="Start feedback mode"');
    expect(manageSource).not.toContain("ghostexManageAgentation");
  });

  test("keeps Markdown Manage controls in a single header row with annotation dropdown cards", () => {
    /*
     * CDXC:ManageMarkdownAnnotations 2026-06-27-22:52:
     * Markdown files should keep Comment/Copy/annotations controls in the top row, open annotations as a dropdown instead of a sidebar, simplify quick-label cards so labels are not repeated, subtly tint cards with their annotation color, and expose persistent top-right remove controls.
     *
     * CDXC:ManageArtifactHeader 2026-06-28-00:13:
     * HTML and Excalidraw files should share Markdown's compact artifact header: the title is the project-relative path, the separate path row is gone, and the header stays one row at the narrower Manage viewport.
     *
     * CDXC:ManageMarkdownAnnotations 2026-06-28-06:49:
     * The Docs annotation dropdown should stay visually above Meo's editor toolbar when it opens from the compact header.
     *
     * CDXC:DocsHeader 2026-06-28-18:02:
     * The Docs main header should be a compact titlebar-like strip with
     * smaller title/meta text and full-height square action buttons separated
     * like macOS titlebar controls.
     *
     * CDXC:DocsHeader 2026-06-29-13:00:
     * The annotations count button opens a dropdown from inside the compact
     * header, so the header itself must not clip overflow to its titlebar
     * height.
     *
     * CDXC:DocsHeader 2026-06-29-13:45:
     * Drawing compact headers have no action buttons on the right edge, so the
     * file type and size metadata need a right inset when the sidebar divider is
     * visible.
     *
     * CDXC:DocsHeader 2026-06-29-21:48:
     * The editor and sidebar headers had been raised three pixels from the
     * earlier compact strip, landing at 36px with matching line-height and
     * full-height action buttons.
     *
     * CDXC:DocsHeader 2026-06-29-23:39:
     * The editor and sidebar titlebars should now be one pixel shorter at 35px
     * with matching line-height and full-height action buttons.
     *
     * CDXC:ManageMarkdownAnnotations 2026-06-29-20:13:
     * The Markdown header needs a Clear button beside Copy that requires a
     * second Confirm click within three seconds, turns red while armed, and
     * keeps the annotations dropdown control 7px away from the right edge.
     *
     * CDXC:ManageMarkdownAnnotations 2026-06-29-20:16:
     * Annotation cards need an always-visible remove X pinned to the top-right
     * corner so deletion does not depend on hover-only discovery.
     *
     * CDXC:ManageMarkdownAnnotations 2026-06-29-20:54:
     * The caret-triggered floating annotation preview is a separate card and
     * needs the same top-right remove X, with pointer events enabled only on
     * that button.
     *
     * CDXC:ManageMarkdownAnnotations 2026-06-29-21:02:
     * Dropdown and caret-preview annotation cards should use flat, subtle
     * tinted backgrounds instead of gradients.
     *
     * CDXC:ManageMarkdownAnnotations 2026-06-29-21:21:
     * Annotation remove X controls should not show a left divider or boxed
     * chrome inside the card.
     */
    const annotationCardCssStart = manageSource.indexOf("  .manage-annotation-card {");
    const annotationCardCssEnd = manageSource.indexOf('  .manage-annotation-card[data-type="redline"]', annotationCardCssStart);
    expect(annotationCardCssStart).toBeGreaterThan(-1);
    expect(annotationCardCssEnd).toBeGreaterThan(annotationCardCssStart);
    const annotationCardCss = manageSource.slice(annotationCardCssStart, annotationCardCssEnd);
    expect(annotationCardCss).not.toContain("linear-gradient(");
    expect(manageSource).toContain("const isHtml = isHtmlPath(preview.path);");
    expect(manageSource).toContain("const usesCompactArtifactHeader = isMarkdown || isDrawing || isHtml;");
    expect(manageSource).toContain("const previewTitle = usesCompactArtifactHeader ? preview.path : preview.name;");
    expect(manageSource).toContain("data-compact-header={String(usesCompactArtifactHeader)}");
    expect(manageSource).toContain('data-kind={isMarkdown ? "markdown" : isDrawing ? "drawing" : isHtml ? "html" : "text"}');
    expect(manageSource).toContain('{!usesCompactArtifactHeader ? <div className="manage-preview-path">{preview.path}</div> : null}');
    expect(manageSource).toContain('.manage-preview-content[data-compact-header="true"]');
    expect(manageSource).toContain("manage-preview-header-actions");
    expect(manageSource).toContain("height: 35px;");
    expect(manageSource).toContain("line-height: 35px;");
    expect(manageSource).toContain("max-height: 35px;");
    expect(manageSource).toContain("min-height: 35px;");
    expect(manageSource).toContain("overflow: visible;");
    expect(manageSource).toContain('.manage-preview-content[data-kind="drawing"] .manage-preview-header');
    expect(manageSource).toContain("padding-right: 13px;");
    expect(manageSource).toContain("font-size: 12px;");
    expect(manageSource).toContain("font-size: 10.5px;");
    expect(manageSource).toContain("border-left: 1px solid #252525;");
    expect(manageSource).toContain("border-radius: 0;");
    expect(manageSource).toContain('.manage-preview-header-actions button[aria-expanded="true"]');
    expect(manageSource).toContain(".manage-preview-header-actions button svg");
    expect(manageSource).toContain("annotationsDropdownOpen");
    expect(manageSource).toContain("annotationsDropdownRef");
    expect(manageSource).toContain("clearAnnotationsConfirming");
    expect(manageSource).toContain("clearAnnotationsTimerRef");
    expect(manageSource).toContain("clearAllAnnotations");
    expect(manageSource).toContain('title="Clear All Annotations"');
    expect(manageSource).toContain('className="manage-clear-annotations-button"');
    expect(manageSource).toContain('data-confirming={String(clearAnnotationsConfirming)}');
    expect(manageSource).toContain('<span>{clearAnnotationsConfirming ? "Confirm" : "Clear"}</span>');
    expect(manageSource).toContain("}, 3_000);");
    expect(manageSource).toContain("onAnnotationsChange(() => []);");
    expect(manageSource).toContain('aria-haspopup="dialog"');
    expect(manageSource).toContain("IconMessages");
    expect(manageSource).toContain("margin-right: 7px;");
    expect(manageSource).toContain('.manage-preview-header-actions .manage-clear-annotations-button[data-confirming="true"]');
    expect(manageSource).toContain("rgba(244, 63, 94, 0.13)");
    expect(manageSource).toContain("function ManageAnnotationDropdown");
    expect(manageSource).toContain('id="manage-markdown-annotation-dropdown"');
    expect(manageSource).toContain("annotationDisplayNote(annotation)");
    expect(manageSource).toContain("note === quickLabelText(annotation.labelId) ? \"\" : note");
    expect(manageSource).toContain("manage-annotation-remove-button");
    expect(manageSource).toContain("<IconX");
    expect(manageSource).toContain("padding: 9px 33px 9px 9px;");
    expect(manageSource).toContain("position: absolute;");
    expect(manageSource).toContain("right: 7px;");
    expect(manageSource).toContain("top: 7px;");
    expect(manageSource).toContain("border: 0;");
    expect(manageSource).toContain("box-shadow: none;");
    expect(manageSource).toContain(".manage-annotation-remove-button:hover,");
    expect(manageSource).toContain(".manage-annotation-preview-remove-button:hover,");
    expect(manageSource).toContain("background: transparent;");
    expect(manageSource).toContain("manageAnnotationColor(annotation)");
    expect(manageSource).toContain("background: color-mix(in srgb, var(--manage-panel) 96%, var(--manage-annotation-color) 4%);");
    expect(manageSource).toContain("border: 1px solid color-mix(in srgb, var(--manage-annotation-color) 24%, var(--manage-border));");
    expect(manageSource).toContain("color-mix(in srgb, var(--manage-annotation-color)");
    expect(manageSource).toContain("grid-auto-rows: max-content;");
    expect(manageSource).toContain("align-content: start;");
    expect(manageSource).toContain("height: max-content;");
    expect(manageSource).toContain("z-index: 700;");
    expect(manageSource).not.toContain("manage-markdown-review-topbar");
    expect(manageSource).not.toContain("manage-markdown-review-status");
    expect(manageSource).not.toContain("manage-markdown-annotation-rail");
  });

  test("uses icon-only colored Markdown selection actions with matching highlights", () => {
    /*
     * CDXC:ManageMarkdownSelectionToolbar 2026-06-27-22:41:
     * The floating Markdown selection toolbar should remove Copy/Delete and show only colored icon buttons for Comment, Clarify, Needs tests, Looks good, and Dismiss.
     * Hover/focus tooltips should name each icon-only action, and annotation colors should be shared with the selected-text highlight.
     *
     * CDXC:ManageMarkdownSelectionToolbar 2026-06-28-01:49:
     * The floating selection toolbar should keep a real left edge margin in Manage, so selecting text at the start of a Markdown line does not pin the toolbar flush against the window edge.
     *
     * CDXC:ManageMarkdownAnnotations 2026-06-28-05:24:
     * Manage Markdown annotations should capture multi-line CodeMirror selections directly, resolve normalized quotes back to raw Markdown ranges for highlights, and show a passive caret preview card above the annotated range when the caret enters saved annotated text.
     *
     * CDXC:ManageMarkdownAnnotations 2026-06-29-21:02:
     * The caret preview should match the dropdown card's flat, subtle tinted
     * surface instead of using a gradient.
     *
     * CDXC:ManageMarkdownAnnotations 2026-06-29-21:21:
     * The floating preview remove X should also avoid divider or boxed button
     * chrome.
     *
     * CDXC:ManageMarkdownToolbar 2026-06-28-06:00:
     * The annotation toolbar should include a formatting switch, and formatting mode should show Meo's inline Bold/Italic/Lineover/Code/Link/Wiki/Kbd toolbar with an Annotations switch back.
     */
    const annotationPreviewCardCssStart = manageSource.indexOf("  .manage-annotation-preview-card {");
    const annotationPreviewCardCssEnd = manageSource.indexOf("  .manage-annotation-preview-card header", annotationPreviewCardCssStart);
    expect(annotationPreviewCardCssStart).toBeGreaterThan(-1);
    expect(annotationPreviewCardCssEnd).toBeGreaterThan(annotationPreviewCardCssStart);
    const annotationPreviewCardCss = manageSource.slice(annotationPreviewCardCssStart, annotationPreviewCardCssEnd);
    expect(annotationPreviewCardCss).not.toContain("linear-gradient(");
    const toolbarStart = manageSource.indexOf("function ManageAnnotationToolbar");
    const toolbarEnd = manageSource.indexOf("function ManageCommentPopover", toolbarStart);
    expect(toolbarStart).toBeGreaterThan(-1);
    expect(toolbarEnd).toBeGreaterThan(toolbarStart);
    const toolbarSource = manageSource.slice(toolbarStart, toolbarEnd);
    expect(toolbarSource).toContain('aria-label="Comment"');
    expect(toolbarSource).toContain('data-tooltip="Comment"');
    expect(toolbarSource).toContain("IconMessagePlus");
    expect(toolbarSource).toContain('aria-label="Formatting"');
    expect(toolbarSource).toContain("manageToolbarActionStyle(MANAGE_MEO_HEADING_COLOR)");
    expect(toolbarSource).toContain("renderManageQuickLabelIcon(label.id)");
    expect(toolbarSource).toContain('aria-label="Dismiss"');
    expect(toolbarSource).toContain('data-tooltip="Dismiss"');
    expect(toolbarSource).toContain("manageToolbarActionStyle(MANAGE_COMMENT_ANNOTATION_COLOR)");
    expect(toolbarSource).toContain("manageToolbarActionStyle(label.color)");
    expect(toolbarSource).toContain("clampManageSelectionToolbarLeft(anchor.left)");
    expect(toolbarSource).not.toContain("onCopy");
    expect(toolbarSource).not.toContain("onRedline");
    expect(toolbarSource).not.toContain("IconTag");
    expect(toolbarSource).not.toContain("IconTrash");
    expect(toolbarSource).not.toContain("Copy selection");
    expect(toolbarSource).not.toContain("Mark as deletion");
    expect(manageSource).toContain('const MANAGE_COMMENT_ANNOTATION_COLOR = "#e2b340";');
    expect(manageSource).toContain("IconHelpCircle");
    expect(manageSource).toContain("IconTestPipe");
    expect(manageSource).toContain("IconCircleCheck");
    expect(manageSource).toContain('color: "#a78bfa"');
    expect(manageSource).toContain('color: "#f59e0b"');
    expect(manageSource).toContain('color: "#86efac"');
    expect(manageSource).toContain("const MANAGE_SELECTION_TOOLBAR_EDGE_MARGIN = 18;");
    expect(manageSource).toContain("const MANAGE_SELECTION_TOOLBAR_WIDTH_ESTIMATE = 228;");
    expect(manageSource).toContain("function clampManageSelectionToolbarLeft");
    expect(manageSource).toContain("function meoSelectionToolbarPosition");
    expect(manageSource).toContain("selection-inline-menu is-visible");
    expect(manageSource).toContain("selection-inline-button manage-selection-inline-mode-button");
    expect(manageSource).toContain("MeoBoldIcon");
    expect(manageSource).toContain("MeoItalicIcon");
    expect(manageSource).toContain("MeoStrikethroughIcon");
    expect(manageSource).toContain("MeoTerminalIcon");
    expect(manageSource).toContain("MeoKeyboardIcon");
    expect(manageSource).toContain("max-width: calc(100vw - 36px);");
    expect(manageSource).toContain("data-label-id");
    expect(manageSource).toContain("manageAnnotationColor");
    expect(manageSource).toContain("content: attr(data-tooltip);");
    expect(manageSource).toContain("var(--manage-toolbar-action-color)");
    expect(manageSource).toContain("EditorView.updateListener.of");
    expect(manageSource).toContain("syncManageMeoAnnotationReviewState");
    expect(manageSource).toContain("collectManageAnnotationRanges");
    expect(manageSource).toContain("findManageAnnotationTextMatches");
    expect(manageSource).toContain("buildManageNormalizedTextIndex");
    expect(manageSource).toContain("onAnnotationPreviewChange={setAnnotationPreview}");
    expect(manageSource).toContain("function ManageAnnotationPreviewCard");
    expect(manageSource).toContain("removePreviewAnnotation");
    expect(manageSource).toContain("onRemoveAnnotation={removePreviewAnnotation}");
    expect(manageSource).toContain('className="manage-annotation-preview-remove-button manage-icon-button"');
    expect(manageSource).toContain("onPointerDown={(event: ReactPointerEvent<HTMLButtonElement>) => {");
    expect(manageSource).toContain("pointer-events: auto;");
    expect(manageSource).toContain("background: color-mix(in srgb, var(--manage-panel-raised) 96%, var(--manage-annotation-color) 4%);");
    expect(manageSource).toContain("border: 1px solid color-mix(in srgb, var(--manage-annotation-color) 28%, var(--manage-border-strong));");
    expect(manageSource).toContain("annotationPreviewText(annotation)");
    expect(manageSource).toContain("position >= range.from && position < range.to");
    expect(manageSource).toContain(".manage-annotation-preview-card");
    expect(manageSource).toContain("EditorView.updateListener.of");
    expect(manageSource).toContain("setMeoSelectionState(state?.visible ? state : { visible: false })");
    expect(manageSource).not.toContain("IconTag");
  });

  test("keeps the Markdown editor gutter tight and the comment composer compact", () => {
    /*
     * CDXC:ManageMarkdownEditing 2026-06-28-01:49:
     * Manage Markdown files should reduce the visual gap between line numbers and editable text by narrowing only the Manage-scoped Meo gutters.
     *
     * CDXC:ManageAnnotationComposer 2026-06-28-01:49:
     * The anchored comment composer should be a darker rounded panel with one textarea, a top-right close X, and a green Submit button.
     *
     * CDXC:ManageAnnotationComposer 2026-06-28-07:56:
     * The Add global comment composer should render above Meo's toolbar layer when opened from the compact Docs header.
     *
     * CDXC:ManageAnnotationComposer 2026-06-28-08:31:
     * The Image action should stay hidden and commented in source while its picker does not open from the Markdown annotation comment composer.
     */
    expect(manageSource).toContain(".manage-meo-markdown-editor .cm-gutter.cm-lineNumbers");
    expect(manageSource).toContain(".manage-meo-markdown-editor .cm-lineNumbers .cm-gutterElement");
    expect(manageSource).toContain("max-width: 28px;");
    expect(manageSource).toContain("padding: 0 4px 0 0;");
    expect(manageSource).toContain(".manage-meo-markdown-editor .cm-content");
    expect(manageSource).toContain("margin-left: 0;");

    const popoverStart = manageSource.indexOf("function ManageCommentPopover");
    const popoverEnd = manageSource.indexOf("function ManageAnnotationDropdown", popoverStart);
    expect(popoverStart).toBeGreaterThan(-1);
    expect(popoverEnd).toBeGreaterThan(popoverStart);
    const popoverSource = manageSource.slice(popoverStart, popoverEnd);
    expect(popoverSource).not.toContain("manage-comment-popover-quote");
    expect(popoverSource).toContain('aria-label="Close comment composer"');
    expect(popoverSource).toContain("The Image action in the Markdown annotation comment composer is hidden");
    expect(popoverSource).toContain("manage-comment-popover-image-button");
    expect(popoverSource).toContain("manage-comment-popover-submit");
    expect(popoverSource).toContain("Submit");
    expect(popoverSource).not.toContain("Global comment");
    expect(popoverSource).not.toContain("Comment\n        </button>");
    expect(manageSource).toContain("background: color-mix(in srgb, var(--manage-panel-raised) 76%, #000 24%);");
    expect(manageSource).toContain("border-radius: 10px;");
    expect(manageSource).toContain(".manage-comment-popover-close");
    expect(manageSource).toContain(".manage-comment-popover-actions .manage-comment-popover-submit");
    expect(manageSource).toContain("background: rgba(34, 197, 94, 0.18);");
    expect(manageSource).toContain("z-index: 710;");
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
     *
     * CDXC:ManageDrawings 2026-06-28-01:43:
     * The Manage Excalidraw canvas should use Excalidraw's dark scheme so the drawing surface matches the macOS Manage workarea.
     *
     * CDXC:ManageDrawings 2026-06-28-04:56:
     * Excalidraw dark theme serializes the dark-looking canvas as viewBackgroundColor #ffffff, so Manage should use that value for newly created drawings instead of trying to store #121212.
     *
     * CDXC:ManageDrawings 2026-06-28-05:12:
     * The embedded Excalidraw editor should suppress the macOS WKWebView failure beep for unmodified 1-4 tool shortcuts without blocking Excalidraw's own shortcut handling.
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
    expect(manageSource).toContain('const MANAGE_EXCALIDRAW_CANVAS_THEME: AppState["theme"] = "dark"');
    expect(manageSource).toContain('const MANAGE_EXCALIDRAW_CANVAS_BACKGROUND = "#ffffff"');
    expect(manageSource).toContain("theme={MANAGE_EXCALIDRAW_CANVAS_THEME}");
    expect(manageSource).toContain("theme: MANAGE_EXCALIDRAW_CANVAS_THEME");
    expect(manageSource).toContain("viewBackgroundColor: MANAGE_EXCALIDRAW_CANVAS_BACKGROUND");
    expect(manageSource).toContain("onKeyDownCapture={suppressManageExcalidrawToolKeyBeep}");
    expect(manageSource).toContain("function suppressManageExcalidrawToolKeyBeep");
    expect(manageSource).toContain("/^[1-4]$/u.test(event.key)");
    expect(manageSource).not.toContain('theme="light"');
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
