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

  test("keeps the Manage file sidebar resizable on either side", () => {
    /*
     * CDXC:ManageSidebar 2026-06-26-23:14:
     * The Manage file sidebar should have a visible separator that can resize the artifacts tree on the left or right side, persists width locally, and keeps the preview/editor in normal non-overlapping grid layout.
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
    expect(manageSource).toContain('grid-template-columns: var(--manage-sidebar-width, 292px) 7px minmax(0, 1fr)');
    expect(manageSource).toContain('grid-template-columns: minmax(0, 1fr) 7px var(--manage-sidebar-width, 292px)');
  });

  test("creates Markdown, HTML, and Excalidraw artifacts from the Manage sidebar", () => {
    /*
     * CDXC:ManageArtifacts 2026-06-26-13:59:
     * Manage should offer top-sidebar creation buttons for Markdown, HTML, and Excalidraw artifacts, write them under artifacts/, and immediately open the created file in the Manage preview/editor.
     */
    expect(manageSource).toContain('type ManageArtifactKind = "excalidraw" | "html" | "markdown"');
    expect(manageSource).toContain('const MANAGE_ARTIFACT_ROOT_PATH = "artifacts"');
    expect(manageSource).toContain("function ManageArtifactCreateButtons");
    expect(manageSource).toContain('aria-label="Create artifact"');
    expect(manageSource).toContain('title="New Markdown artifact"');
    expect(manageSource).toContain('title="New HTML artifact"');
    expect(manageSource).toContain('title="New Excalidraw artifact"');
    expect(manageSource).toContain("createUniqueArtifactPath(entries, kind)");
    expect(manageSource).toContain("createInitialArtifactContent(kind)");
    expect(manageSource).toContain("selectedPathRef.current = createdFile.path");
    expect(manageSource).toContain("setPreview(createdFile)");
    expect(manageSource).toContain(".manage-artifact-create");
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

  test("scopes the Manage file tree and normal file access to project artifacts", () => {
    /*
     * CDXC:ManageArtifacts 2026-06-26-13:59:
     * Native Manage listing should expose only the active project's artifacts/ tree while preserving project-relative artifacts/... paths for file opens and saves. The annotation sidecar remains a fixed Ghostex-owned project path outside the visible tree.
     */
    expect(terminalWorkspaceSource).toContain('manageArtifactsRelativePath = "artifacts"');
    expect(terminalWorkspaceSource).toContain('manageAnnotationsSidecarRelativePath = ".ghostex/manage-annotations.json"');
    expect(terminalWorkspaceSource).toContain("rootName: manageArtifactsRelativePath");
    expect(terminalWorkspaceSource).toContain("private nonisolated static func manageProjectArtifactsURL");
    expect(terminalWorkspaceSource).toContain("guard let artifactsURL = try manageProjectArtifactsURL(rootURL: rootURL)");
    expect(terminalWorkspaceSource).toContain("directoryURL: artifactsURL");
    expect(terminalWorkspaceSource).toContain("relativeDirectoryPath: manageArtifactsRelativePath");
    expect(terminalWorkspaceSource).toContain("private nonisolated static func manageValidateAccessibleRelativePath");
    expect(terminalWorkspaceSource).toContain("relativePath == manageAnnotationsSidecarRelativePath");
    expect(terminalWorkspaceSource).toContain('relativePath.hasPrefix("\\(manageArtifactsRelativePath)/")');
    expect(terminalWorkspaceSource).toContain("try manageValidateAccessibleRelativePath(target.relativePath)");
  });

  test("uses the copied Meo Markdown editor with Manage annotations", () => {
    /*
     * CDXC:ManageMarkdownEditing 2026-06-27-12:40:
     * Markdown artifacts in Manage should edit and render rich Markdown in one Meo live-editor surface while keeping Ghostex selection annotations, global comments, and structured feedback copy available in the same workarea.
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
    expect(manageSource).toContain("normalizeManageMeoSelection");
    expect(manageSource).toContain("createMeoEditor({");
    expect(manageSource).toContain("externalExtensions: [manageMeoAnnotationField]");
    expect(manageSource).toContain('initialMode: "live"');
    expect(manageSource).toContain("onApplyChanges");
    expect(manageSource).toContain("onContentChangeRef.current(nextContent)");
    expect(manageSource).toContain("onContentChange={onDraftContentChange}");
    expect(manageSource).toContain("onSelectionClear={clearSelectedText}");
    expect(manageSource).toContain("onSelectionClearRef.current()");
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

  test("renders HTML artifacts as sanitized DOM for Agentation", () => {
    /*
     * CDXC:ManageHtmlRendering 2026-06-28-01:25:
     * HTML artifacts should render as sanitized same-document DOM, not as source code or an iframe, because Project Editor Agentation needs to inspect and annotate the actual rendered elements.
     *
     * CDXC:ManageHtmlAgentation 2026-06-28-01:46:
     * Rendered HTML artifacts need a visible Manage header action for annotation mode because the Manage surface hides the native browser feedback toolbar.
     *
     * CDXC:ManageHtmlAgentation 2026-06-28-02:29:
     * The HTML annotation control is named Annotate, is enabled by default, behaves as a toggle, mounts Agentation directly while enabled, and unmounts it when disabled.
     */
    expect(manageSource).toContain("function ManageHtmlRenderViewer");
    expect(manageSource).toContain(") : isHtml ? (");
    expect(manageSource).toContain("<ManageHtmlRenderViewer content={draftContent} documentKey={preview.path} />");
    expect(manageSource).toContain("function sanitizeManageHtmlDocument");
    expect(manageSource).toContain('new DOMParser().parseFromString(html, "text/html")');
    expect(manageSource).toContain('data-agentation-html-root="true"');
    expect(manageSource).toContain("dangerouslySetInnerHTML={{ __html: renderedHtml }}");
    expect(manageSource).toContain("return documentValue.body.innerHTML;");
    expect(manageSource).toContain('name.startsWith("on") || name === "srcdoc"');
    expect(manageSource).toContain("/^(?:javascript|vbscript|data:text\\/html)/iu.test(value)");
    expect(manageSource).toContain(".manage-html-render-view");
    expect(manageSource).toContain("const [htmlAnnotationEnabled, setHtmlAnnotationEnabled] = useState(true);");
    expect(manageSource).toContain('aria-label="Toggle annotations"');
    expect(manageSource).toContain("aria-pressed={htmlAnnotationEnabled}");
    expect(manageSource).toContain("<span>Annotate</span>");
    expect(manageSource).toContain("function ensureManageAgentationInjected");
    expect(manageSource).toContain("function disableManageAgentation");
    expect(manageSource).toContain("function mountManageAgentation");
    expect(manageSource).toContain("function importManageAgentationModule");
    expect(manageSource).toContain('const MANAGE_AGENTATION_VERSION = "3.0.2";');
    expect(manageSource).toContain("React.createElement(Agentation)");
    expect(manageSource).toContain('title="Start feedback mode"');
    expect(manageSource).toContain("disableManageAgentation();");
    expect(manageSource).not.toContain("ghostexManageAgentation");
  });

  test("keeps Markdown Manage controls in a single header row with annotation dropdown cards", () => {
    /*
     * CDXC:ManageMarkdownAnnotations 2026-06-27-22:52:
     * Markdown files should keep Comment/Copy/annotations controls in the top row, open annotations as a dropdown instead of a sidebar, simplify quick-label cards so labels are not repeated, tint cards with their annotation color, and reveal a remove X only on card hover/focus.
     *
     * CDXC:ManageArtifactHeader 2026-06-28-00:13:
     * HTML and Excalidraw files should share Markdown's compact artifact header: the title is the project-relative path, the separate path row is gone, and the header stays one row at the narrower Manage viewport.
     */
    expect(manageSource).toContain("const isHtml = isHtmlPath(preview.path);");
    expect(manageSource).toContain("const usesCompactArtifactHeader = isMarkdown || isDrawing || isHtml;");
    expect(manageSource).toContain("const previewTitle = usesCompactArtifactHeader ? preview.path : preview.name;");
    expect(manageSource).toContain("data-compact-header={String(usesCompactArtifactHeader)}");
    expect(manageSource).toContain('data-kind={isMarkdown ? "markdown" : isDrawing ? "drawing" : isHtml ? "html" : "text"}');
    expect(manageSource).toContain('{!usesCompactArtifactHeader ? <div className="manage-preview-path">{preview.path}</div> : null}');
    expect(manageSource).toContain('.manage-preview-content[data-compact-header="true"]');
    expect(manageSource).toContain("manage-preview-header-actions");
    expect(manageSource).toContain("annotationsDropdownOpen");
    expect(manageSource).toContain("annotationsDropdownRef");
    expect(manageSource).toContain('aria-haspopup="dialog"');
    expect(manageSource).toContain("IconMessages");
    expect(manageSource).toContain("function ManageAnnotationDropdown");
    expect(manageSource).toContain('id="manage-markdown-annotation-dropdown"');
    expect(manageSource).toContain("annotationDisplayNote(annotation)");
    expect(manageSource).toContain("note === quickLabelText(annotation.labelId) ? \"\" : note");
    expect(manageSource).toContain("manage-annotation-remove-button");
    expect(manageSource).toContain("<IconX");
    expect(manageSource).toContain("manageAnnotationColor(annotation)");
    expect(manageSource).toContain("color-mix(in srgb, var(--manage-annotation-color)");
    expect(manageSource).toContain("grid-auto-rows: max-content;");
    expect(manageSource).toContain("align-content: start;");
    expect(manageSource).toContain("height: max-content;");
    expect(manageSource).not.toContain("manage-markdown-review-topbar");
    expect(manageSource).not.toContain("manage-markdown-review-status");
    expect(manageSource).not.toContain("manage-markdown-annotation-rail");
    expect(manageSource).not.toContain("IconTrash");
  });

  test("uses icon-only colored Markdown selection actions with matching highlights", () => {
    /*
     * CDXC:ManageMarkdownSelectionToolbar 2026-06-27-22:41:
     * The floating Markdown selection toolbar should remove Copy/Delete and show only colored icon buttons for Comment, Clarify, Needs tests, Looks good, and Dismiss.
     * Hover/focus tooltips should name each icon-only action, and annotation colors should be shared with the selected-text highlight.
     *
     * CDXC:ManageMarkdownSelectionToolbar 2026-06-28-01:49:
     * The floating selection toolbar should keep a real left edge margin in Manage, so selecting text at the start of a Markdown line does not pin the toolbar flush against the window edge.
     */
    const toolbarStart = manageSource.indexOf("function ManageAnnotationToolbar");
    const toolbarEnd = manageSource.indexOf("function ManageCommentPopover", toolbarStart);
    expect(toolbarStart).toBeGreaterThan(-1);
    expect(toolbarEnd).toBeGreaterThan(toolbarStart);
    const toolbarSource = manageSource.slice(toolbarStart, toolbarEnd);
    expect(toolbarSource).toContain('aria-label="Comment"');
    expect(toolbarSource).toContain('data-tooltip="Comment"');
    expect(toolbarSource).toContain("IconMessagePlus");
    expect(toolbarSource).toContain("renderManageQuickLabelIcon(label.id)");
    expect(toolbarSource).toContain('aria-label="Dismiss"');
    expect(toolbarSource).toContain('data-tooltip="Dismiss"');
    expect(toolbarSource).toContain("manageToolbarActionStyle(MANAGE_COMMENT_ANNOTATION_COLOR)");
    expect(toolbarSource).toContain("manageToolbarActionStyle(label.color)");
    expect(toolbarSource).toContain("clampManageSelectionToolbarLeft(anchor.left)");
    expect(toolbarSource).not.toContain("onCopy");
    expect(toolbarSource).not.toContain("onRedline");
    expect(toolbarSource).not.toContain("IconTag");
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
    expect(manageSource).toContain("const MANAGE_SELECTION_TOOLBAR_WIDTH_ESTIMATE = 190;");
    expect(manageSource).toContain("function clampManageSelectionToolbarLeft");
    expect(manageSource).toContain("max-width: calc(100vw - 36px);");
    expect(manageSource).toContain("data-label-id");
    expect(manageSource).toContain("manageAnnotationColor");
    expect(manageSource).toContain("content: attr(data-tooltip);");
    expect(manageSource).toContain("var(--manage-toolbar-action-color)");
    expect(manageSource).not.toContain("IconTag");
  });

  test("keeps the Markdown editor gutter tight and the comment composer compact", () => {
    /*
     * CDXC:ManageMarkdownEditing 2026-06-28-01:49:
     * Manage Markdown files should reduce the visual gap between line numbers and editable text by narrowing only the Manage-scoped Meo gutters.
     *
     * CDXC:ManageAnnotationComposer 2026-06-28-01:49:
     * The anchored comment composer should be a darker rounded panel with one textarea, a top-right close X, an Image action, and a green Submit button.
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
    expect(manageSource).toContain("theme={MANAGE_EXCALIDRAW_CANVAS_THEME}");
    expect(manageSource).toContain("theme: MANAGE_EXCALIDRAW_CANVAS_THEME");
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
