import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import {
  IconAlertTriangle,
  IconCheck,
  IconCopy,
  IconEdit,
  IconEye,
  IconFile,
  IconFileText,
  IconFolder,
  IconFolderOpen,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarRightCollapse,
  IconMenu2,
  IconMessageCircle,
  IconMessagePlus,
  IconPhoto,
  IconRefresh,
  IconSearch,
  IconTag,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import {
  Fragment,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
  type ReactElement,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type ManageFileEntry = {
  depth: number;
  kind: "directory" | "file";
  modifiedAt?: string;
  name: string;
  path: string;
  size?: number;
};

type ManageFilePreview = {
  content?: string;
  error?: string;
  kind: "text" | "unsupported";
  modifiedAt?: string;
  name: string;
  path: string;
  size?: number;
};

type ManageFilesBridgeRequest = {
  action: "list" | "read" | "save";
  content?: string;
  path?: string;
  projectEditorId: string;
  projectId: string;
  requestId: string;
};

type ManageFilesBridgeResponse = {
  action: "list" | "read" | "save";
  entries?: ManageFileEntry[];
  error?: string;
  file?: ManageFilePreview;
  requestId: string;
  rootName?: string;
};

type ManageAnnotationMode = "select" | "redline" | "comment";

type ManageAnnotationType = "comment" | "redline";

type ManageAnnotationScope = "global" | "selection";

type ManageQuickLabelId = "clarify" | "needs-tests" | "looks-good";

type ManageQuickLabel = {
  id: ManageQuickLabelId;
  text: string;
};

type ManageAnnotationImage = {
  dataUrl: string;
  id: string;
  mimeType: string;
  name: string;
  size: number;
};

type ManageAnnotation = {
  attachments: ManageAnnotationImage[];
  createdAt: string;
  id: string;
  labelId?: ManageQuickLabelId;
  note: string;
  quote: string;
  scope: ManageAnnotationScope;
  type: ManageAnnotationType;
};

type ManageAnnotationStore = {
  annotationsByPath: Record<string, ManageAnnotation[]>;
  updatedAt: string;
  version: 1;
};

type ManageSelectionAnchor = {
  left: number;
  top: number;
};

type ManageCapturedSelection = {
  anchor?: ManageSelectionAnchor;
  source: "editor" | "preview";
  text: string;
};

type ManageSidebarSide = "left" | "right";

type ManageWebKitWindow = Window & {
  webkit?: {
    messageHandlers?: {
      ghostexManageFiles?: {
        postMessage: (message: ManageFilesBridgeRequest) => void;
      };
    };
  };
};

type ExcalidrawFileData = {
  appState?: Record<string, unknown>;
  elements?: readonly ExcalidrawElement[];
  files?: BinaryFiles;
  source?: string;
  type?: string;
  version?: number;
};

const MANAGE_FILES_RESPONSE_EVENT = "ghostex-manage-files-response";
const MANAGE_BRIDGE_TIMEOUT_MS = 15_000;
const MANAGE_SELECTION_MAX_LENGTH = 700;
const MANAGE_ANNOTATIONS_SIDECAR_PATH = ".ghostex/manage-annotations.json";
const MANAGE_ANNOTATION_SCHEMA_VERSION = 1;
const MANAGE_ANNOTATION_IMAGE_MAX_BYTES = 512 * 1024;
const MANAGE_ANNOTATION_MAX_IMAGES = 4;
const MANAGE_SIDEBAR_SIDE_STORAGE_KEY = "ghostex.manage.sidebarSide";
const MANAGE_QUICK_LABELS: ManageQuickLabel[] = [
  { id: "clarify", text: "Clarify" },
  { id: "needs-tests", text: "Needs tests" },
  { id: "looks-good", text: "Looks good" },
];

/*
 * CDXC:ManageEditing 2026-06-20-06:14:
 * Manage is an editable bundled WKWebView project workarea beside Kanban. The page opens project-relative text, Markdown, and drawing files; Swift owns root resolution and save scoping, so the WK URL and JavaScript bridge never carry absolute workspace paths.
 *
 * CDXC:ManageAnnotations 2026-06-20-06:14:
 * Markdown review in Manage needs lightweight annotation behavior in the same workarea as editing. Keep annotations path-scoped in page state, capture selected source or preview text, mark matching Markdown text in the preview, and surface counts in the file tree without persisting user text to logs.
 *
 * CDXC:ManageAnnotations 2026-06-20-06:35:
 * Markdown feedback must behave like a local review tool: Select mode exposes a nearby action toolbar, Redline mode turns selected text into deletion annotations immediately, Comment mode focuses the comment composer, global comments work without selected text, quick labels add preset feedback, and structured Markdown export copies review data without logging annotation text.
 *
 * CDXC:ManageAnnotationPersistence 2026-06-20-06:35:
 * Annotation state should survive Manage reloads when the native project bridge is available. Store a versioned JSON sidecar under a Ghostex-owned project folder through the same project-relative read/save bridge, so Swift keeps path normalization and traversal checks at the writer boundary.
 *
 * CDXC:ManageAnnotationAttachments 2026-06-20-06:35:
 * Annotation images are user-provided feedback artifacts. Keep them local to the annotation sidecar as bounded data URLs, render compact thumbnails, and include attachment references in copied Markdown only when the user explicitly copies feedback.
 *
 * CDXC:ManageDrawings 2026-06-20-06:14:
 * .excalidraw files should open as editable drawings instead of raw JSON. Use the upstream Excalidraw component for canvas behavior, serialize full scene JSON through the normal Manage save bridge, and keep invalid drawings editable as source text so users can repair them.
 *
 * CDXC:ManageEditing 2026-06-21-18:00:
 * The macOS Manage editor header should not show an explicit Save button. Keep edited/saved status visible in metadata while retaining the existing bridge-backed save behavior through the keyboard shortcut and editor flows.
 *
 * CDXC:ManageSidebar 2026-06-20-17:15:
 * Manage's file-sidebar refresh control is an overflow menu with Refresh and Switch sidebar side actions. A separate adjacent icon hides the file sidebar, and the editor area provides a small restore affordance so hiding is reversible.
 */
function ManageApp() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const projectId = params.get("projectId") ?? "";
  const projectEditorId = params.get("projectEditorId") ?? projectId;
  const [entries, setEntries] = useState<ManageFileEntry[]>([]);
  const [rootName, setRootName] = useState("Project");
  const [query, setQuery] = useState("");
  const [selectedPath, setSelectedPath] = useState<string>();
  const selectedPathRef = useRef<string | undefined>(undefined);
  const [preview, setPreview] = useState<ManageFilePreview>();
  const [draftContent, setDraftContent] = useState("");
  const [lastSavedContent, setLastSavedContent] = useState("");
  const [listState, setListState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [previewState, setPreviewState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saveResetTimerRef = useRef<number | undefined>(undefined);
  const [error, setError] = useState<string>();
  const [annotationsByPath, setAnnotationsByPath] = useState<Record<string, ManageAnnotation[]>>({});
  const [annotationPersistenceState, setAnnotationPersistenceState] =
    useState<"idle" | "loading" | "ready" | "saving" | "saved" | "error">("idle");
  const [sidebarSide, setSidebarSide] = useState<ManageSidebarSide>(() => readStoredManageSidebarSide());
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const annotationsLoadedRef = useRef(false);
  const annotationsSaveTimerRef = useRef<number | undefined>(undefined);
  const lastPersistedAnnotationsRef = useRef("");

  const readFile = useCallback(
    async (path: string) => {
      setSelectedPath(path);
      selectedPathRef.current = path;
      setPreview(undefined);
      setDraftContent("");
      setLastSavedContent("");
      setPreviewState("loading");
      setSaveState("idle");
      setError(undefined);
      try {
        const response = await requestManageFiles({
          action: "read",
          path,
          projectEditorId,
          projectId,
        });
        if (response.error) {
          throw new Error(response.error);
        }
        setPreview(response.file);
        const nextContent = response.file?.content ?? "";
        setDraftContent(nextContent);
        setLastSavedContent(nextContent);
        setPreviewState("ready");
      } catch (readError) {
        setPreviewState("error");
        setError(readError instanceof Error ? readError.message : "Could not open file.");
      }
    },
    [projectEditorId, projectId],
  );

  const refreshFiles = useCallback(async () => {
    setListState("loading");
    setError(undefined);
    try {
      const response = await requestManageFiles({
        action: "list",
        projectEditorId,
        projectId,
      });
      if (response.error) {
        throw new Error(response.error);
      }
      const nextEntries = response.entries ?? [];
      setEntries(nextEntries);
      setRootName(response.rootName?.trim() || "Project");
      setListState("ready");
      const currentSelectedPath = selectedPathRef.current;
      const selectedStillExists =
        currentSelectedPath &&
        nextEntries.some((entry) => entry.kind === "file" && entry.path === currentSelectedPath);
      if (!selectedStillExists) {
        const firstFile = nextEntries.find((entry) => entry.kind === "file");
        if (firstFile) {
          void readFile(firstFile.path);
        } else {
          selectedPathRef.current = undefined;
          setSelectedPath(undefined);
          setPreview(undefined);
          setDraftContent("");
          setLastSavedContent("");
          setPreviewState("idle");
        }
      }
    } catch (listError) {
      setListState("error");
      setError(listError instanceof Error ? listError.message : "Could not load project files.");
    }
  }, [projectEditorId, projectId, readFile]);

  useEffect(() => {
    void refreshFiles();
  }, [refreshFiles]);

  useEffect(() => {
    window.localStorage.setItem(MANAGE_SIDEBAR_SIDE_STORAGE_KEY, sidebarSide);
  }, [sidebarSide]);

  useEffect(() => {
    let isCancelled = false;
    annotationsLoadedRef.current = false;
    setAnnotationPersistenceState("loading");
    async function loadAnnotations() {
      try {
        const response = await requestManageFiles({
          action: "read",
          path: MANAGE_ANNOTATIONS_SIDECAR_PATH,
          projectEditorId,
          projectId,
        });
        if (isCancelled) {
          return;
        }
        const content = response.error ? "" : (response.file?.content ?? "");
        const nextAnnotations = parseManageAnnotationStore(content);
        lastPersistedAnnotationsRef.current = stableManageAnnotationStoreKey(nextAnnotations);
        setAnnotationsByPath(nextAnnotations);
        annotationsLoadedRef.current = true;
        setAnnotationPersistenceState("ready");
      } catch {
        if (isCancelled) {
          return;
        }
        lastPersistedAnnotationsRef.current = stableManageAnnotationStoreKey({});
        setAnnotationsByPath({});
        annotationsLoadedRef.current = true;
        setAnnotationPersistenceState("ready");
      }
    }
    void loadAnnotations();
    return () => {
      isCancelled = true;
    };
  }, [projectEditorId, projectId]);

  useEffect(() => {
    if (!annotationsLoadedRef.current) {
      return;
    }
    const annotationStoreKey = stableManageAnnotationStoreKey(annotationsByPath);
    if (annotationStoreKey === lastPersistedAnnotationsRef.current) {
      return;
    }
    const serialized = serializeManageAnnotationStore(annotationsByPath);
    if (annotationsSaveTimerRef.current !== undefined) {
      window.clearTimeout(annotationsSaveTimerRef.current);
    }
    setAnnotationPersistenceState("saving");
    annotationsSaveTimerRef.current = window.setTimeout(() => {
      annotationsSaveTimerRef.current = undefined;
      void (async () => {
        try {
          const response = await requestManageFiles({
            action: "save",
            content: serialized,
            path: MANAGE_ANNOTATIONS_SIDECAR_PATH,
            projectEditorId,
            projectId,
          });
          if (response.error) {
            throw new Error(response.error);
          }
          lastPersistedAnnotationsRef.current = annotationStoreKey;
          setAnnotationPersistenceState("saved");
        } catch {
          setAnnotationPersistenceState("error");
        }
      })();
    }, 550);
  }, [annotationsByPath, projectEditorId, projectId]);

  const switchSidebarSide = useCallback(() => {
    setSidebarHidden(false);
    setSidebarSide((current) => (current === "left" ? "right" : "left"));
  }, []);

  useEffect(
    () => () => {
      if (saveResetTimerRef.current !== undefined) {
        window.clearTimeout(saveResetTimerRef.current);
      }
      if (annotationsSaveTimerRef.current !== undefined) {
        window.clearTimeout(annotationsSaveTimerRef.current);
      }
    },
    [],
  );

  const annotationsForSelectedPath = selectedPath ? (annotationsByPath[selectedPath] ?? []) : [];
  const annotationCountsByPath = useMemo(() => {
    const nextCounts = new Map<string, number>();
    for (const [path, annotations] of Object.entries(annotationsByPath)) {
      if (annotations.length > 0) {
        nextCounts.set(path, annotations.length);
      }
    }
    return nextCounts;
  }, [annotationsByPath]);

  const isEditablePreview = preview?.kind === "text";
  const isDirty = isEditablePreview && draftContent !== lastSavedContent;

  const saveFile = useCallback(async () => {
    if (!selectedPath || !preview || preview.kind !== "text" || saveState === "saving") {
      return;
    }
    if (saveResetTimerRef.current !== undefined) {
      window.clearTimeout(saveResetTimerRef.current);
      saveResetTimerRef.current = undefined;
    }
    setSaveState("saving");
    setError(undefined);
    try {
      const response = await requestManageFiles({
        action: "save",
        content: draftContent,
        path: selectedPath,
        projectEditorId,
        projectId,
      });
      if (response.error) {
        throw new Error(response.error);
      }
      const savedFile = response.file;
      if (!savedFile) {
        throw new Error("Manage did not return saved file metadata.");
      }
      setPreview(savedFile);
      const savedContent = savedFile.content ?? draftContent;
      setDraftContent(savedContent);
      setLastSavedContent(savedContent);
      setEntries((currentEntries) =>
        currentEntries.map((entry) =>
          entry.path === savedFile.path
            ? {
                ...entry,
                modifiedAt: savedFile.modifiedAt,
                size: savedFile.size,
              }
            : entry,
        ),
      );
      setSaveState("saved");
      saveResetTimerRef.current = window.setTimeout(() => {
        setSaveState("idle");
        saveResetTimerRef.current = undefined;
      }, 1_600);
    } catch (saveError) {
      setSaveState("error");
      setError(saveError instanceof Error ? saveError.message : "Could not save file.");
    }
  }, [draftContent, preview, projectEditorId, projectId, saveState, selectedPath]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "s") {
        if (!selectedPath || !isDirty) {
          return;
        }
        event.preventDefault();
        void saveFile();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDirty, saveFile, selectedPath]);

  const visibleEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) {
      return entries;
    }
    return entries.filter((entry) => entry.path.toLocaleLowerCase().includes(normalizedQuery));
  }, [entries, query]);

  const filesCount = useMemo(
    () => entries.filter((entry) => entry.kind === "file").length,
    [entries],
  );

  const updateAnnotationsForSelectedFile = useCallback(
    (updater: (annotations: ManageAnnotation[]) => ManageAnnotation[]) => {
      if (!selectedPath) {
        return;
      }
      setAnnotationsByPath((current) => {
        const nextAnnotations = updater(current[selectedPath] ?? []);
        if (nextAnnotations.length === 0) {
          const { [selectedPath]: _removed, ...remaining } = current;
          return remaining;
        }
        return {
          ...current,
          [selectedPath]: nextAnnotations,
        };
      });
    },
    [selectedPath],
  );

  return (
    <main className="manage-shell" data-sidebar-hidden={String(sidebarHidden)} data-sidebar-side={sidebarSide}>
      {!sidebarHidden ? (
        <aside className="manage-sidebar">
          <div className="manage-sidebar-header">
            <div className="manage-project-title">
              <IconFolderOpen aria-hidden="true" size={17} stroke={1.8} />
              <span>{rootName}</span>
            </div>
            <ManageSidebarActions
              isRefreshing={listState === "loading"}
              onHideSidebar={() => setSidebarHidden(true)}
              onRefresh={() => void refreshFiles()}
              onSwitchSide={switchSidebarSide}
              sidebarSide={sidebarSide}
            />
          </div>
          <label className="manage-search">
            <IconSearch aria-hidden="true" size={15} stroke={1.8} />
            <input
              aria-label="Search files"
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search"
              value={query}
            />
          </label>
          <div className="manage-sidebar-meta">
            {filesCount} files
            {entries.length >= 1_200 ? " · capped" : ""}
          </div>
          <div className="manage-file-list" role="tree">
            {listState === "loading" && entries.length === 0 ? (
              <ManageEmptyState icon={<IconRefresh aria-hidden="true" size={18} />} text="Loading files" />
            ) : null}
            {listState !== "loading" && visibleEntries.length === 0 ? (
              <ManageEmptyState icon={<IconSearch aria-hidden="true" size={18} />} text="No files found" />
            ) : null}
            {visibleEntries.map((entry) => (
              <ManageFileRow
                annotationCount={annotationCountsByPath.get(entry.path) ?? 0}
                entry={entry}
                isSelected={entry.path === selectedPath}
                key={entry.path}
                onSelect={() => {
                  if (entry.kind === "file") {
                    void readFile(entry.path);
                  }
                }}
              />
            ))}
          </div>
        </aside>
      ) : (
        <button
          aria-label="Show file sidebar"
          className="manage-sidebar-restore-button manage-icon-button"
          onClick={() => setSidebarHidden(false)}
          type="button"
        >
          {sidebarSide === "right" ? (
            <IconLayoutSidebarRightCollapse aria-hidden="true" size={16} stroke={1.8} />
          ) : (
            <IconLayoutSidebarLeftCollapse aria-hidden="true" size={16} stroke={1.8} />
          )}
        </button>
      )}
      <section className="manage-preview">
        <ManagePreview
          annotations={annotationsForSelectedPath}
          annotationPersistenceState={annotationPersistenceState}
          draftContent={draftContent}
          error={error}
          isDirty={isDirty}
          onAnnotationsChange={updateAnnotationsForSelectedFile}
          onDraftContentChange={setDraftContent}
          preview={preview}
          previewState={previewState}
          saveState={saveState}
          selectedPath={selectedPath}
        />
      </section>
    </main>
  );
}

function ManageSidebarActions({
  isRefreshing,
  onHideSidebar,
  onRefresh,
  onSwitchSide,
  sidebarSide,
}: {
  isRefreshing: boolean;
  onHideSidebar: () => void;
  onRefresh: () => void;
  onSwitchSide: () => void;
  sidebarSide: ManageSidebarSide;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const HideSidebarIcon = sidebarSide === "right" ? IconLayoutSidebarRightCollapse : IconLayoutSidebarLeftCollapse;

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && wrapperRef.current?.contains(target)) {
        return;
      }
      setMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  const runMenuAction = (action: () => void) => {
    setMenuOpen(false);
    action();
  };

  return (
    <div className="manage-sidebar-actions" ref={wrapperRef}>
      <button
        aria-label="Hide file sidebar"
        className="manage-icon-button"
        onClick={onHideSidebar}
        type="button"
      >
        <HideSidebarIcon aria-hidden="true" size={15} stroke={1.8} />
      </button>
      <button
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-label="Manage sidebar menu"
        className="manage-icon-button"
        onClick={() => setMenuOpen((current) => !current)}
        type="button"
      >
        <IconMenu2 aria-hidden="true" size={15} stroke={1.8} />
      </button>
      {menuOpen ? (
        <div className="manage-sidebar-menu" role="menu">
          <button
            className="manage-sidebar-menu-item"
            disabled={isRefreshing}
            onClick={() => runMenuAction(onRefresh)}
            role="menuitem"
            type="button"
          >
            <IconRefresh aria-hidden="true" size={14} stroke={1.8} />
            Refresh
          </button>
          <button
            className="manage-sidebar-menu-item"
            onClick={() => runMenuAction(onSwitchSide)}
            role="menuitem"
            type="button"
          >
            {sidebarSide === "right" ? (
              <IconLayoutSidebarLeftCollapse aria-hidden="true" size={14} stroke={1.8} />
            ) : (
              <IconLayoutSidebarRightCollapse aria-hidden="true" size={14} stroke={1.8} />
            )}
            Switch sidebar side
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ManageFileRow({
  annotationCount,
  entry,
  isSelected,
  onSelect,
}: {
  annotationCount: number;
  entry: ManageFileEntry;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const Icon = entry.kind === "directory" ? IconFolder : fileIconForPath(entry.path);
  return (
    <button
      aria-selected={entry.kind === "file" ? isSelected : undefined}
      className="manage-file-row"
      data-kind={entry.kind}
      data-selected={String(isSelected)}
      onClick={onSelect}
      role="treeitem"
      style={{ "--depth": entry.depth } as CSSProperties}
      type="button"
    >
      <Icon aria-hidden="true" className="manage-file-icon" size={15} stroke={1.75} />
      <span className="manage-file-name">{entry.name}</span>
      <span className="manage-file-badges">
        {annotationCount > 0 ? <span className="manage-count-badge">{annotationCount}</span> : null}
        {entry.kind === "file" && entry.size !== undefined ? (
          <span className="manage-file-size">{formatFileSize(entry.size)}</span>
        ) : null}
      </span>
    </button>
  );
}

function ManagePreview({
  annotations,
  annotationPersistenceState,
  draftContent,
  error,
  isDirty,
  onAnnotationsChange,
  onDraftContentChange,
  preview,
  previewState,
  saveState,
  selectedPath,
}: {
  annotations: ManageAnnotation[];
  annotationPersistenceState: "idle" | "loading" | "ready" | "saving" | "saved" | "error";
  draftContent: string;
  error?: string;
  isDirty: boolean;
  onAnnotationsChange: (updater: (annotations: ManageAnnotation[]) => ManageAnnotation[]) => void;
  onDraftContentChange: (content: string) => void;
  preview?: ManageFilePreview;
  previewState: "idle" | "loading" | "ready" | "error";
  saveState: "idle" | "saving" | "saved" | "error";
  selectedPath?: string;
}) {
  const [markdownMode, setMarkdownMode] = useState<"edit" | "preview" | "split">("split");
  const [annotationMode, setAnnotationMode] = useState<ManageAnnotationMode>("select");
  const [selection, setSelection] = useState<ManageCapturedSelection>();
  const [annotationNote, setAnnotationNote] = useState("");
  const [annotationAttachments, setAnnotationAttachments] = useState<ManageAnnotationImage[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [feedbackCopyState, setFeedbackCopyState] = useState<"idle" | "copied" | "error">("idle");
  const selectedPathRef = useRef<string | undefined>(selectedPath);
  const annotationNoteRef = useRef<HTMLTextAreaElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (selectedPathRef.current !== selectedPath) {
      selectedPathRef.current = selectedPath;
      setSelection(undefined);
      setAnnotationNote("");
      setAnnotationAttachments([]);
      setAttachmentError("");
      setFeedbackCopyState("idle");
    }
  }, [selectedPath]);

  const addAnnotation = useCallback(
    ({
      attachments = [],
      labelId,
      note = "",
      quote = "",
      type,
    }: {
      attachments?: ManageAnnotationImage[];
      labelId?: ManageQuickLabelId;
      note?: string;
      quote?: string;
      type: ManageAnnotationType;
    }) => {
      const normalizedQuote = normalizeAnnotationQuote(quote);
      if (type === "redline" && !normalizedQuote) {
        return;
      }
      const normalizedNote = note.trim();
      if (type === "comment" && !normalizedQuote && !normalizedNote && attachments.length === 0) {
        return;
      }
    const nextAnnotation: ManageAnnotation = {
        attachments,
      createdAt: new Date().toISOString(),
      id: `manage-annotation-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        labelId,
        note: normalizedNote,
        quote: normalizedQuote,
        scope: normalizedQuote ? "selection" : "global",
        type,
    };
    onAnnotationsChange((current) => [...current, nextAnnotation]);
    setAnnotationNote("");
      setAnnotationAttachments([]);
      setAttachmentError("");
      if (type === "redline" || normalizedQuote) {
        setSelection(undefined);
      }
    },
    [onAnnotationsChange],
  );

  const captureSelectedText = useCallback(
    (capturedSelection: ManageCapturedSelection) => {
      const normalized = normalizeAnnotationQuote(capturedSelection.text);
      if (!normalized) {
        return;
      }
      const nextSelection = {
        ...capturedSelection,
        text: normalized,
      };
      if (annotationMode === "redline") {
        addAnnotation({
          quote: normalized,
          type: "redline",
        });
        return;
      }
      setSelection(nextSelection);
      if (annotationMode === "comment") {
        window.requestAnimationFrame(() => annotationNoteRef.current?.focus());
      }
    },
    [addAnnotation, annotationMode],
  );

  const selectedText = selection?.text ?? "";

  const addDraftComment = useCallback(() => {
    addAnnotation({
      attachments: annotationAttachments,
      note: annotationNote,
      quote: selectedText,
      type: "comment",
    });
  }, [addAnnotation, annotationAttachments, annotationNote, selectedText]);

  const addSelectedRedline = useCallback(() => {
    addAnnotation({
      quote: selectedText,
      type: "redline",
    });
  }, [addAnnotation, selectedText]);

  const addQuickLabel = useCallback(
    (label: ManageQuickLabel) => {
      addAnnotation({
        labelId: label.id,
        note: label.text,
        quote: selectedText,
        type: "comment",
      });
    },
    [addAnnotation, selectedText],
  );

  const addAttachmentFiles = useCallback(
    (files: FileList | File[]) => {
      const nextFiles = Array.from(files).filter((file) => file.type.startsWith("image/"));
      if (nextFiles.length === 0) {
        return;
      }
      const availableSlots = Math.max(0, MANAGE_ANNOTATION_MAX_IMAGES - annotationAttachments.length);
      if (availableSlots === 0) {
        setAttachmentError(`Use ${MANAGE_ANNOTATION_MAX_IMAGES} images or fewer per annotation.`);
        return;
      }
      setAttachmentError("");
      for (const file of nextFiles.slice(0, availableSlots)) {
        if (file.size > MANAGE_ANNOTATION_IMAGE_MAX_BYTES) {
          setAttachmentError("Images must be 512 KB or smaller.");
          continue;
        }
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = typeof reader.result === "string" ? reader.result : "";
          if (!dataUrl) {
            return;
          }
          setAnnotationAttachments((current) => [
            ...current,
            {
              dataUrl,
              id: `manage-annotation-image-${Date.now()}-${Math.random().toString(16).slice(2)}`,
              mimeType: file.type,
              name: normalizeAttachmentName(file.name),
              size: file.size,
            },
          ]);
        };
        reader.onerror = () => {
          setAttachmentError("Could not read image attachment.");
        };
        reader.readAsDataURL(file);
      }
    },
    [annotationAttachments.length],
  );

  const removeDraftAttachment = useCallback((attachmentId: string) => {
    setAnnotationAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
  }, []);

  const copyFeedback = useCallback(async () => {
    if (!selectedPath) {
      return;
    }
    const output = formatManageAnnotationsAsMarkdown(selectedPath, annotations);
    try {
      await writeTextToClipboard(output);
      setFeedbackCopyState("copied");
      window.setTimeout(() => setFeedbackCopyState("idle"), 1_600);
    } catch {
      setFeedbackCopyState("error");
    }
  }, [annotations, selectedPath]);

  useEffect(() => {
    if (!selection) {
      return;
    }
    function handleAnnotationShortcut(event: KeyboardEvent) {
      if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey || isEditableEventTarget(event.target)) {
        return;
      }
      const key = event.key.toLocaleLowerCase();
      if (key === "escape") {
        event.preventDefault();
        setSelection(undefined);
        return;
      }
      if (key === "r") {
        event.preventDefault();
        addSelectedRedline();
        return;
      }
      if (key === "c") {
        event.preventDefault();
        setAnnotationMode("comment");
        annotationNoteRef.current?.focus();
        return;
      }
      if (/^[1-3]$/u.test(key)) {
        event.preventDefault();
        const label = MANAGE_QUICK_LABELS[Number(key) - 1];
        if (label) {
          addQuickLabel(label);
        }
      }
    }
    window.addEventListener("keydown", handleAnnotationShortcut);
    return () => window.removeEventListener("keydown", handleAnnotationShortcut);
  }, [addQuickLabel, addSelectedRedline, selection]);

  const removeAnnotation = useCallback(
    (annotationId: string) => {
      onAnnotationsChange((current) => current.filter((annotation) => annotation.id !== annotationId));
    },
    [onAnnotationsChange],
  );

  if (previewState === "loading") {
    return <ManagePreviewMessage icon={<IconRefresh aria-hidden="true" size={20} />} title="Loading file" />;
  }
  if (error) {
    return (
      <ManagePreviewMessage
        icon={<IconAlertTriangle aria-hidden="true" size={21} />}
        title={error}
      />
    );
  }
  if (!selectedPath || !preview) {
    return <ManagePreviewMessage icon={<IconFileText aria-hidden="true" size={21} />} title="Select a file" />;
  }

  const language = languageLabelForPath(preview.path);
  const isMarkdown = isMarkdownPath(preview.path);
  const isDrawing = isExcalidrawPath(preview.path);
  const canEdit = preview.kind === "text";
  const showMarkdownControls = canEdit && isMarkdown;

  return (
    <div className="manage-preview-content">
      <header className="manage-preview-header">
        <div className="manage-preview-title">
          {isDrawing ? (
            <IconEdit aria-hidden="true" size={17} stroke={1.85} />
          ) : (
            <IconFileText aria-hidden="true" size={17} stroke={1.85} />
          )}
          <span>{preview.name}</span>
        </div>
        <div className="manage-preview-meta">
          <span>{language}</span>
          {preview.size !== undefined ? <span>{formatFileSize(preview.size)}</span> : null}
          {isDirty ? <span>Edited</span> : saveState === "saved" ? <span>Saved</span> : null}
        </div>
        {showMarkdownControls ? (
          <div className="manage-segmented" aria-label="Markdown view">
            <button
              aria-pressed={markdownMode === "edit"}
              onClick={() => setMarkdownMode("edit")}
              type="button"
            >
              <IconEdit aria-hidden="true" size={14} />
              Edit
            </button>
            <button
              aria-pressed={markdownMode === "split"}
              onClick={() => setMarkdownMode("split")}
              type="button"
            >
              Split
            </button>
            <button
              aria-pressed={markdownMode === "preview"}
              onClick={() => setMarkdownMode("preview")}
              type="button"
            >
              <IconEye aria-hidden="true" size={14} />
              Preview
            </button>
          </div>
        ) : null}
      </header>
      <div className="manage-preview-path">{preview.path}</div>
      {preview.kind === "unsupported" ? (
        <ManagePreviewMessage
          icon={<IconAlertTriangle aria-hidden="true" size={21} />}
          title={preview.error ?? "Preview unavailable"}
        />
      ) : isDrawing ? (
        <ManageExcalidrawEditor
          content={draftContent}
          fileName={preview.name}
          key={preview.path}
          onChange={onDraftContentChange}
        />
      ) : isMarkdown ? (
        <div className="manage-markdown-workspace" data-mode={markdownMode}>
          {markdownMode !== "preview" ? (
            <ManageTextEditor
              content={draftContent}
              language={language}
              onChange={onDraftContentChange}
              onSelectionCapture={captureSelectedText}
            />
          ) : null}
          {markdownMode !== "edit" ? (
            <MarkdownReviewPane
              annotations={annotations}
              content={draftContent}
              onSelectionCapture={captureSelectedText}
            />
          ) : null}
          {selection?.anchor ? (
            <ManageSelectionToolbar
              anchor={selection.anchor}
              onComment={() => {
                setAnnotationMode("comment");
                window.requestAnimationFrame(() => annotationNoteRef.current?.focus());
              }}
              onDismiss={() => setSelection(undefined)}
              onQuickLabel={addQuickLabel}
              onRedline={addSelectedRedline}
            />
          ) : null}
          <ManageAnnotationPanel
            annotationAttachments={annotationAttachments}
            annotationMode={annotationMode}
            annotationNote={annotationNote}
            annotationPersistenceState={annotationPersistenceState}
            annotations={annotations}
            attachmentError={attachmentError}
            feedbackCopyState={feedbackCopyState}
            inputRef={annotationNoteRef}
            onAddComment={addDraftComment}
            onAddRedline={addSelectedRedline}
            onAnnotationNoteChange={setAnnotationNote}
            onAnnotationModeChange={setAnnotationMode}
            onCopyFeedback={() => void copyFeedback()}
            onOpenAttachmentPicker={() => attachmentInputRef.current?.click()}
            onQuickLabel={addQuickLabel}
            onRemoveAnnotation={removeAnnotation}
            onRemoveDraftAttachment={removeDraftAttachment}
            selectedText={selectedText}
          />
          <input
            accept="image/*"
            aria-label="Annotation image attachments"
            className="manage-hidden-file-input"
            multiple
            onChange={(event) => {
              if (event.currentTarget.files) {
                addAttachmentFiles(event.currentTarget.files);
              }
              event.currentTarget.value = "";
            }}
            ref={attachmentInputRef}
            type="file"
          />
        </div>
      ) : (
        <ManageTextEditor
          content={draftContent}
          language={language}
          onChange={onDraftContentChange}
          onSelectionCapture={() => undefined}
        />
      )}
    </div>
  );
}

function ManageTextEditor({
  content,
  language,
  onChange,
  onSelectionCapture,
}: {
  content: string;
  language: string;
  onChange: (content: string) => void;
  onSelectionCapture: (selection: ManageCapturedSelection) => void;
}) {
  return (
    <textarea
      aria-label={`${language} editor`}
      className="manage-text-editor"
      onChange={(event) => onChange(event.currentTarget.value)}
      onSelect={(event) => {
        const input = event.currentTarget;
        if (input.selectionEnd > input.selectionStart) {
          onSelectionCapture({
            anchor: selectionAnchorFromRect(input.getBoundingClientRect()),
            source: "editor",
            text: input.value.slice(input.selectionStart, input.selectionEnd),
          });
        }
      }}
      spellCheck={false}
      value={content}
    />
  );
}

function MarkdownReviewPane({
  annotations,
  content,
  onSelectionCapture,
}: {
  annotations: ManageAnnotation[];
  content: string;
  onSelectionCapture: (selection: ManageCapturedSelection) => void;
}) {
  const markdownComponents = useMemo(
    () => ({
      blockquote: ({ children }: { children?: ReactNode }) => (
        <blockquote>{annotateMarkdownChildren(children, annotations)}</blockquote>
      ),
      h1: ({ children }: { children?: ReactNode }) => <h1>{annotateMarkdownChildren(children, annotations)}</h1>,
      h2: ({ children }: { children?: ReactNode }) => <h2>{annotateMarkdownChildren(children, annotations)}</h2>,
      h3: ({ children }: { children?: ReactNode }) => <h3>{annotateMarkdownChildren(children, annotations)}</h3>,
      h4: ({ children }: { children?: ReactNode }) => <h4>{annotateMarkdownChildren(children, annotations)}</h4>,
      li: ({ children }: { children?: ReactNode }) => <li>{annotateMarkdownChildren(children, annotations)}</li>,
      p: ({ children }: { children?: ReactNode }) => <p>{annotateMarkdownChildren(children, annotations)}</p>,
      td: ({ children }: { children?: ReactNode }) => <td>{annotateMarkdownChildren(children, annotations)}</td>,
      th: ({ children }: { children?: ReactNode }) => <th>{annotateMarkdownChildren(children, annotations)}</th>,
    }),
    [annotations],
  );
  return (
    <div
      className="manage-markdown-preview"
      onMouseUp={() => {
        const domSelection = window.getSelection();
        const range = domSelection && domSelection.rangeCount > 0 ? domSelection.getRangeAt(0) : undefined;
        onSelectionCapture({
          anchor: selectionAnchorFromRect(range?.getBoundingClientRect()),
          source: "preview",
          text: domSelection?.toString() ?? "",
        });
      }}
    >
      <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

function ManageAnnotationPanel({
  annotationAttachments,
  annotationMode,
  annotationNote,
  annotationPersistenceState,
  annotations,
  attachmentError,
  feedbackCopyState,
  inputRef,
  onAddComment,
  onAddRedline,
  onAnnotationNoteChange,
  onAnnotationModeChange,
  onCopyFeedback,
  onOpenAttachmentPicker,
  onQuickLabel,
  onRemoveAnnotation,
  onRemoveDraftAttachment,
  selectedText,
}: {
  annotationAttachments: ManageAnnotationImage[];
  annotationMode: ManageAnnotationMode;
  annotationNote: string;
  annotationPersistenceState: "idle" | "loading" | "ready" | "saving" | "saved" | "error";
  annotations: ManageAnnotation[];
  attachmentError: string;
  feedbackCopyState: "idle" | "copied" | "error";
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onAddComment: () => void;
  onAddRedline: () => void;
  onAnnotationNoteChange: (note: string) => void;
  onAnnotationModeChange: (mode: ManageAnnotationMode) => void;
  onCopyFeedback: () => void;
  onOpenAttachmentPicker: () => void;
  onQuickLabel: (label: ManageQuickLabel) => void;
  onRemoveAnnotation: (annotationId: string) => void;
  onRemoveDraftAttachment: (attachmentId: string) => void;
  selectedText: string;
}) {
  const canAddComment = Boolean(annotationNote.trim()) || annotationAttachments.length > 0;
  const persistenceLabel = annotationPersistenceLabel(annotationPersistenceState);
  return (
    <aside className="manage-annotations" aria-label="Annotations">
      <header className="manage-annotations-header">
        <div className="manage-annotations-title">
          <IconMessageCircle aria-hidden="true" size={15} />
          <span>{annotations.length} annotations</span>
        </div>
        <span className="manage-annotation-persistence" data-state={annotationPersistenceState}>
          {persistenceLabel}
        </span>
      </header>
      <div className="manage-annotation-mode-row" aria-label="Annotation mode">
        {(["select", "redline", "comment"] as const).map((mode) => (
          <button
            aria-pressed={annotationMode === mode}
            key={mode}
            onClick={() => onAnnotationModeChange(mode)}
            type="button"
          >
            {annotationModeLabel(mode)}
          </button>
        ))}
      </div>
      <div className="manage-annotation-composer">
        <div className="manage-selected-quote" data-empty={String(!selectedText)}>
          {selectedText || "Global comment"}
        </div>
        <div className="manage-quick-labels" aria-label="Quick labels">
          {MANAGE_QUICK_LABELS.map((label) => (
            <button
              key={label.id}
              onClick={() => onQuickLabel(label)}
              type="button"
            >
              <IconTag aria-hidden="true" size={13} />
              {label.text}
            </button>
          ))}
        </div>
        <textarea
          aria-label="Annotation note"
          onChange={(event) => onAnnotationNoteChange(event.currentTarget.value)}
          placeholder={selectedText ? "Add a comment" : "Add a global comment"}
          ref={inputRef}
          value={annotationNote}
        />
        {annotationAttachments.length > 0 ? (
          <div className="manage-attachment-strip">
            {annotationAttachments.map((attachment) => (
              <figure className="manage-attachment-chip" key={attachment.id}>
                <img alt="" src={attachment.dataUrl} />
                <figcaption>{attachment.name}</figcaption>
                <button
                  aria-label={`Remove ${attachment.name}`}
                  onClick={() => onRemoveDraftAttachment(attachment.id)}
                  type="button"
                >
                  <IconX aria-hidden="true" size={12} />
                </button>
              </figure>
            ))}
          </div>
        ) : null}
        {attachmentError ? <div className="manage-attachment-error">{attachmentError}</div> : null}
        <div className="manage-annotation-actions">
          <button
            className="manage-annotation-secondary"
            disabled={!selectedText}
            onClick={onAddRedline}
            type="button"
          >
            <IconTrash aria-hidden="true" size={14} />
            Redline
          </button>
          <button
            className="manage-annotation-secondary"
            onClick={onOpenAttachmentPicker}
            type="button"
          >
            <IconPhoto aria-hidden="true" size={14} />
            Image
          </button>
          <button
            className="manage-annotation-add"
            disabled={!canAddComment}
            onClick={onAddComment}
            type="button"
          >
            <IconMessagePlus aria-hidden="true" size={14} />
            {selectedText ? "Comment" : "Global"}
          </button>
        </div>
      </div>
      <div className="manage-annotation-list">
        {annotations.length === 0 ? (
          <div className="manage-annotation-empty">No annotations</div>
        ) : null}
        {annotations.map((annotation) => (
          <article className="manage-annotation-card" data-type={annotation.type} key={annotation.id}>
            <div className="manage-annotation-card-header">
              <span>{annotationTypeLabel(annotation)}</span>
              <button
                aria-label="Remove annotation"
                className="manage-icon-button"
                onClick={() => onRemoveAnnotation(annotation.id)}
                type="button"
              >
                <IconTrash aria-hidden="true" size={14} />
              </button>
            </div>
            {annotation.scope === "selection" ? <blockquote>{annotation.quote}</blockquote> : null}
            {annotation.note ? <p>{annotation.note}</p> : null}
            {annotation.attachments.length > 0 ? (
              <div className="manage-annotation-attachments">
                {annotation.attachments.map((attachment) => (
                  <a href={attachment.dataUrl} key={attachment.id} rel="noreferrer" target="_blank">
                    <img alt="" src={attachment.dataUrl} />
                    <span>{attachment.name}</span>
                  </a>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>
      <footer className="manage-annotations-footer">
        <button disabled={annotations.length === 0} onClick={onCopyFeedback} type="button">
          {feedbackCopyState === "copied" ? (
            <IconCheck aria-hidden="true" size={14} />
          ) : (
            <IconCopy aria-hidden="true" size={14} />
          )}
          {feedbackCopyState === "copied" ? "Copied" : "Copy feedback"}
        </button>
      </footer>
    </aside>
  );
}

function ManageSelectionToolbar({
  anchor,
  onComment,
  onDismiss,
  onQuickLabel,
  onRedline,
}: {
  anchor: ManageSelectionAnchor;
  onComment: () => void;
  onDismiss: () => void;
  onQuickLabel: (label: ManageQuickLabel) => void;
  onRedline: () => void;
}) {
  return (
    <div
      className="manage-selection-toolbar"
      style={{
        left: anchor.left,
        top: Math.max(8, anchor.top - 42),
      }}
    >
      <button onClick={onRedline} type="button">
        <IconTrash aria-hidden="true" size={14} />
        Redline
      </button>
      <button onClick={onComment} type="button">
        <IconMessagePlus aria-hidden="true" size={14} />
        Comment
      </button>
      {MANAGE_QUICK_LABELS.map((label) => (
        <button key={label.id} onClick={() => onQuickLabel(label)} type="button">
          <IconTag aria-hidden="true" size={13} />
          {label.text}
        </button>
      ))}
      <button aria-label="Dismiss annotation toolbar" onClick={onDismiss} type="button">
        <IconX aria-hidden="true" size={14} />
      </button>
    </div>
  );
}

function ManageExcalidrawEditor({
  content,
  fileName,
  onChange,
}: {
  content: string;
  fileName: string;
  onChange: (content: string) => void;
}) {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const hasAcceptedInitialSceneRef = useRef(false);
  const previousSceneSignatureRef = useRef("");
  const lastSerializedRef = useRef(content);
  const [parseError, setParseError] = useState<string>();
  const parsed = useMemo(() => parseExcalidrawFile(content), [content]);

  useEffect(() => {
    if (content !== lastSerializedRef.current) {
      lastSerializedRef.current = content;
      hasAcceptedInitialSceneRef.current = false;
      previousSceneSignatureRef.current = "";
    }
  }, [content]);

  if (!parsed.ok) {
    return (
      <div className="manage-drawing-source">
        <ManagePreviewMessage
          icon={<IconAlertTriangle aria-hidden="true" size={21} />}
          title={parseError ?? parsed.error}
        />
        <textarea
          aria-label={`${fileName} source`}
          className="manage-text-editor"
          onChange={(event) => onChange(event.currentTarget.value)}
          spellCheck={false}
          value={content}
        />
      </div>
    );
  }

  const data = parsed.data;
  return (
    <div className="manage-drawing-editor">
      {parseError ? (
        <div className="manage-drawing-error">
          <IconAlertTriangle aria-hidden="true" size={15} />
          <span>{parseError}</span>
        </div>
      ) : null}
      <Excalidraw
        excalidrawAPI={(api) => {
          apiRef.current = api;
        }}
        initialData={{
          appState: {
            collaborators: new Map(),
            viewBackgroundColor: "#101112",
            ...data.appState,
          },
          elements: data.elements ?? [],
          files: data.files ?? {},
        }}
        onChange={(elements, appState, files) => {
          const api = apiRef.current;
          const filesForSave = files ?? api?.getFiles() ?? {};
          const nextSignature = createExcalidrawSceneSignature(elements, appState, filesForSave);
          const nextContent = serializeExcalidrawFile(data, elements, appState, filesForSave);
          /*
           * CDXC:ManageDrawings 2026-06-20-06:14:
           * Excalidraw can emit a normalized scene while hydrating initialData. Accept that as the canvas baseline instead of marking the file dirty before the user edits the drawing.
           *
           * CDXC:ManageDrawings 2026-06-20-06:35:
           * The drawing editor should compare element versions, file ids, and persisted view state before saving. Excalidraw may call onChange repeatedly with equivalent scene data, so duplicate callbacks must not churn draft content or dirty state.
           */
          if (!hasAcceptedInitialSceneRef.current) {
            hasAcceptedInitialSceneRef.current = true;
            previousSceneSignatureRef.current = nextSignature;
            lastSerializedRef.current = nextContent;
            return;
          }
          if (nextSignature === previousSceneSignatureRef.current) {
            return;
          }
          if (nextContent === lastSerializedRef.current) {
            return;
          }
          previousSceneSignatureRef.current = nextSignature;
          lastSerializedRef.current = nextContent;
          setParseError(undefined);
          onChange(nextContent);
        }}
        theme="dark"
      />
    </div>
  );
}

function ManageEmptyState({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="manage-empty">
      {icon}
      <span>{text}</span>
    </div>
  );
}

function ManagePreviewMessage({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="manage-preview-message">
      {icon}
      <span>{title}</span>
    </div>
  );
}

function requestManageFiles(
  request: Omit<ManageFilesBridgeRequest, "requestId">,
): Promise<ManageFilesBridgeResponse> {
  const bridge = (window as ManageWebKitWindow).webkit?.messageHandlers?.ghostexManageFiles;
  if (!bridge) {
    return Promise.reject(new Error("Manage is unavailable in this host."));
  }
  const requestId = `manage-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const message: ManageFilesBridgeRequest = {
    ...request,
    requestId,
  };
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener(MANAGE_FILES_RESPONSE_EVENT, handleResponse);
      reject(new Error("Manage request timed out."));
    }, MANAGE_BRIDGE_TIMEOUT_MS);
    function handleResponse(event: Event) {
      const response = (event as CustomEvent<ManageFilesBridgeResponse>).detail;
      if (response?.requestId !== requestId) {
        return;
      }
      window.clearTimeout(timeout);
      window.removeEventListener(MANAGE_FILES_RESPONSE_EVENT, handleResponse);
      resolve(response);
    }
    window.addEventListener(MANAGE_FILES_RESPONSE_EVENT, handleResponse);
    bridge.postMessage(message);
  });
}

function formatFileSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = size / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function languageLabelForPath(path: string): string {
  const extension = path.split(".").pop()?.toLocaleLowerCase();
  if (!extension || extension === path) {
    return "Text";
  }
  const labels: Record<string, string> = {
    css: "CSS",
    excalidraw: "Excalidraw",
    go: "Go",
    h: "C/C++",
    html: "HTML",
    js: "JavaScript",
    json: "JSON",
    jsx: "React",
    md: "Markdown",
    mjs: "JavaScript",
    py: "Python",
    rs: "Rust",
    sh: "Shell",
    swift: "Swift",
    ts: "TypeScript",
    tsx: "React",
    txt: "Text",
    yaml: "YAML",
    yml: "YAML",
    zig: "Zig",
  };
  return labels[extension] ?? extension.toLocaleUpperCase();
}

function fileIconForPath(path: string) {
  if (isMarkdownPath(path) || isExcalidrawPath(path)) {
    return IconFileText;
  }
  return IconFile;
}

function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown|mdown|mkdn)$/iu.test(path);
}

function isExcalidrawPath(path: string): boolean {
  return /\.excalidraw$/iu.test(path);
}

function annotationModeLabel(mode: ManageAnnotationMode): string {
  switch (mode) {
    case "comment":
      return "Comment";
    case "redline":
      return "Redline";
    case "select":
      return "Select";
  }
}

function annotationPersistenceLabel(state: "idle" | "loading" | "ready" | "saving" | "saved" | "error"): string {
  switch (state) {
    case "error":
      return "Not saved";
    case "loading":
      return "Loading";
    case "saved":
      return "Saved";
    case "saving":
      return "Saving";
    case "idle":
    case "ready":
      return "Local";
  }
}

function annotationTypeLabel(annotation: ManageAnnotation): string {
  if (annotation.scope === "global") {
    return annotation.labelId ? `Global · ${quickLabelText(annotation.labelId)}` : "Global";
  }
  switch (annotation.type) {
    case "comment":
      return annotation.labelId ? `Comment · ${quickLabelText(annotation.labelId)}` : "Comment";
    case "redline":
      return "Redline";
  }
}

function quickLabelText(labelId: ManageQuickLabelId): string {
  return MANAGE_QUICK_LABELS.find((label) => label.id === labelId)?.text ?? labelId;
}

function normalizeAnnotationQuote(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MANAGE_SELECTION_MAX_LENGTH);
}

function selectionAnchorFromRect(rect: DOMRect | undefined): ManageSelectionAnchor | undefined {
  if (!rect || rect.width === 0 || rect.height === 0) {
    return undefined;
  }
  const left = Math.min(Math.max(rect.left + rect.width / 2, 12), window.innerWidth - 12);
  const top = Math.min(Math.max(rect.top, 12), window.innerHeight - 12);
  return { left, top };
}

function readStoredManageSidebarSide(): ManageSidebarSide {
  return window.localStorage.getItem(MANAGE_SIDEBAR_SIDE_STORAGE_KEY) === "right" ? "right" : "left";
}

function normalizeAttachmentName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, "-");
  return trimmed ? trimmed.slice(0, 80) : "image";
}

function parseManageAnnotationStore(content: string): Record<string, ManageAnnotation[]> {
  if (!content.trim()) {
    return {};
  }
  try {
    const value = JSON.parse(content) as unknown;
    if (!isRecord(value)) {
      return {};
    }
    const annotationsValue = value.annotationsByPath;
    if (!isRecord(annotationsValue)) {
      return {};
    }
    const normalized: Record<string, ManageAnnotation[]> = {};
    for (const [path, annotations] of Object.entries(annotationsValue)) {
      const normalizedPath = normalizeStoredAnnotationPath(path);
      if (!normalizedPath || !Array.isArray(annotations)) {
        continue;
      }
      const normalizedAnnotations = annotations
        .map((annotation) => normalizeStoredAnnotation(annotation))
        .filter((annotation): annotation is ManageAnnotation => Boolean(annotation));
      if (normalizedAnnotations.length > 0) {
        normalized[normalizedPath] = normalizedAnnotations;
      }
    }
    return normalized;
  } catch {
    return {};
  }
}

function serializeManageAnnotationStore(annotationsByPath: Record<string, ManageAnnotation[]>): string {
  const store: ManageAnnotationStore = {
    annotationsByPath,
    updatedAt: new Date().toISOString(),
    version: MANAGE_ANNOTATION_SCHEMA_VERSION,
  };
  return `${JSON.stringify(store, null, 2)}\n`;
}

function stableManageAnnotationStoreKey(annotationsByPath: Record<string, ManageAnnotation[]>): string {
  return JSON.stringify(annotationsByPath);
}

function normalizeStoredAnnotationPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed || trimmed.startsWith("/") || trimmed.includes("\0")) {
    return "";
  }
  const components = trimmed.split("/").filter(Boolean);
  if (components.includes(".") || components.includes("..")) {
    return "";
  }
  return components.join("/");
}

function normalizeStoredAnnotation(value: unknown): ManageAnnotation | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const type = value.type === "redline" ? "redline" : value.type === "comment" ? "comment" : undefined;
  if (!type) {
    return undefined;
  }
  const quote = typeof value.quote === "string" ? normalizeAnnotationQuote(value.quote) : "";
  const note = typeof value.note === "string" ? value.note.slice(0, 4_000) : "";
  const attachments = Array.isArray(value.attachments)
    ? value.attachments
        .map((attachment) => normalizeStoredAttachment(attachment))
        .filter((attachment): attachment is ManageAnnotationImage => Boolean(attachment))
        .slice(0, MANAGE_ANNOTATION_MAX_IMAGES)
    : [];
  if (type === "redline" && !quote) {
    return undefined;
  }
  if (type === "comment" && !quote && !note.trim() && attachments.length === 0) {
    return undefined;
  }
  const labelId = normalizeQuickLabelId(value.labelId);
  return {
    attachments,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
    id: typeof value.id === "string" && value.id.trim() ? value.id : `manage-annotation-${Date.now()}`,
    ...(labelId ? { labelId } : {}),
    note,
    quote,
    scope: quote ? "selection" : "global",
    type,
  };
}

function normalizeStoredAttachment(value: unknown): ManageAnnotationImage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const dataUrl = typeof value.dataUrl === "string" ? value.dataUrl : "";
  const mimeType = typeof value.mimeType === "string" ? value.mimeType : "";
  const name = typeof value.name === "string" ? normalizeAttachmentName(value.name) : "image";
  const size = typeof value.size === "number" && Number.isFinite(value.size) ? Math.max(0, value.size) : 0;
  if (!dataUrl.startsWith("data:image/") || !mimeType.startsWith("image/") || size > MANAGE_ANNOTATION_IMAGE_MAX_BYTES) {
    return undefined;
  }
  return {
    dataUrl,
    id: typeof value.id === "string" && value.id.trim() ? value.id : `manage-annotation-image-${Date.now()}`,
    mimeType,
    name,
    size,
  };
}

function normalizeQuickLabelId(value: unknown): ManageQuickLabelId | undefined {
  return MANAGE_QUICK_LABELS.some((label) => label.id === value) ? (value as ManageQuickLabelId) : undefined;
}

function formatManageAnnotationsAsMarkdown(path: string, annotations: ManageAnnotation[]): string {
  if (annotations.length === 0) {
    return `# Manage Markdown Feedback\n\nFile: \`${path}\`\n\nNo annotations.\n`;
  }
  const lines = ["# Manage Markdown Feedback", "", `File: \`${path}\``, ""];
  const redlines = annotations.filter((annotation) => annotation.type === "redline");
  const comments = annotations.filter((annotation) => annotation.type === "comment");
  if (redlines.length > 0) {
    lines.push("## Redlines", "");
    for (const annotation of redlines) {
      lines.push(`- Delete: ${formatMarkdownQuote(annotation.quote)}`);
      appendAnnotationDetails(lines, annotation);
    }
    lines.push("");
  }
  if (comments.length > 0) {
    lines.push("## Comments", "");
    for (const annotation of comments) {
      const prefix = annotation.scope === "global" ? "Global" : `On ${formatMarkdownQuote(annotation.quote)}`;
      const body = annotation.note.trim() || (annotation.labelId ? quickLabelText(annotation.labelId) : "(attachment only)");
      lines.push(`- ${prefix}: ${body}`);
      appendAnnotationDetails(lines, annotation);
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function appendAnnotationDetails(lines: string[], annotation: ManageAnnotation): void {
  if (annotation.labelId) {
    lines.push(`  - Label: ${quickLabelText(annotation.labelId)}`);
  }
  if (annotation.type === "redline" && annotation.note.trim()) {
    lines.push(`  - Note: ${annotation.note.trim()}`);
  }
  if (annotation.attachments.length > 0) {
    lines.push("  - Attachments:");
    for (const attachment of annotation.attachments) {
      lines.push(`    - ${attachment.name}: ${attachment.dataUrl}`);
    }
  }
}

function formatMarkdownQuote(text: string): string {
  return `"${text.replace(/"/gu, '\\"')}"`;
}

async function writeTextToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.cssText = "position:fixed;left:-9999px;top:-9999px";
    document.body.append(textarea);
    textarea.select();
    const didCopy = document.execCommand("copy");
    textarea.remove();
    if (!didCopy) {
      throw new Error("Clipboard copy failed.");
    }
  }
}

function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  if (target.matches("input, textarea, select, [contenteditable='true']")) {
    return true;
  }
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function annotateMarkdownChildren(children: ReactNode, annotations: ManageAnnotation[]): ReactNode {
  if (typeof children === "string") {
    return annotateText(children, annotations);
  }
  if (Array.isArray(children)) {
    return children.map((child, index) => (
      <Fragment key={index}>{annotateMarkdownChildren(child, annotations)}</Fragment>
    ));
  }
  if (isValidElement(children)) {
    const child = children as ReactElement<{ children?: ReactNode }>;
    return cloneElement(child, undefined, annotateMarkdownChildren(child.props.children, annotations));
  }
  return children;
}

function annotateText(text: string, annotations: ManageAnnotation[]): ReactNode {
  const matchingAnnotations = annotations.filter((annotation) => annotation.quote && text.includes(annotation.quote));
  if (matchingAnnotations.length === 0) {
    return text;
  }
  const annotation = matchingAnnotations[0]!;
  const [before, ...rest] = text.split(annotation.quote);
  return (
    <>
      {before}
      <mark className="manage-annotation-highlight" data-type={annotation.type}>
        {annotation.quote}
      </mark>
      {annotateText(rest.join(annotation.quote), annotations.filter((candidate) => candidate.id !== annotation.id))}
    </>
  );
}

function parseExcalidrawFile(content: string): { data: ExcalidrawFileData; ok: true } | { error: string; ok: false } {
  const trimmed = content.trim();
  if (!trimmed) {
    return {
      data: createEmptyExcalidrawFile(),
      ok: true,
    };
  }
  try {
    const value = JSON.parse(trimmed) as unknown;
    if (!isRecord(value)) {
      return { error: "Drawing JSON must be an object.", ok: false };
    }
    if (value.type !== "excalidraw" && !Array.isArray(value.elements)) {
      return { error: "Drawing JSON is missing scene elements.", ok: false };
    }
    return {
      data: {
        appState: isRecord(value.appState) ? value.appState : {},
        elements: Array.isArray(value.elements) ? (value.elements as ExcalidrawElement[]) : [],
        files: isRecord(value.files) ? (value.files as BinaryFiles) : {},
        source: typeof value.source === "string" ? value.source : "https://excalidraw.com",
        type: "excalidraw",
        version: typeof value.version === "number" ? value.version : 2,
      },
      ok: true,
    };
  } catch (parseError) {
    return {
      error: parseError instanceof Error ? parseError.message : "Drawing JSON is invalid.",
      ok: false,
    };
  }
}

function createEmptyExcalidrawFile(): ExcalidrawFileData {
  return {
    appState: {
      viewBackgroundColor: "#101112",
    },
    elements: [],
    files: {},
    source: "https://excalidraw.com",
    type: "excalidraw",
    version: 2,
  };
}

function serializeExcalidrawFile(
  previousData: ExcalidrawFileData,
  elements: readonly ExcalidrawElement[],
  appState: AppState,
  files: BinaryFiles,
): string {
  const savedAppState: Record<string, unknown> = {
    ...(previousData.appState ?? {}),
    scrollX: appState.scrollX,
    scrollY: appState.scrollY,
    theme: appState.theme,
    viewBackgroundColor: appState.viewBackgroundColor,
    zoom: normalizeExcalidrawZoom(appState.zoom),
  };
  delete savedAppState.collaborators;
  return JSON.stringify(
    {
      appState: savedAppState,
      elements,
      files,
      source: previousData.source ?? "https://excalidraw.com",
      type: "excalidraw",
      version: previousData.version ?? 2,
    },
    null,
    2,
  );
}

function createExcalidrawSceneSignature(
  elements: readonly ExcalidrawElement[],
  appState: AppState,
  files: BinaryFiles,
): string {
  return JSON.stringify({
    appState: {
      scrollX: appState.scrollX,
      scrollY: appState.scrollY,
      viewBackgroundColor: appState.viewBackgroundColor,
      zoom: normalizeExcalidrawZoom(appState.zoom),
    },
    elements: elements.map((element) => ({
      id: element.id,
      isDeleted: element.isDeleted,
      version: element.version,
      versionNonce: element.versionNonce,
    })),
    files: Object.keys(files).sort(),
  });
}

function normalizeExcalidrawZoom(zoom: AppState["zoom"]): number {
  if (typeof zoom === "object" && zoom !== null && "value" in zoom && typeof zoom.value === "number") {
    return zoom.value;
  }
  return typeof zoom === "number" ? zoom : 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const styleElement = document.createElement("style");
styleElement.textContent = `
  :root {
    color-scheme: dark;
    --manage-bg: #101112;
    --manage-panel: #17191b;
    --manage-panel-strong: #202326;
    --manage-panel-raised: #23262a;
    --manage-border: rgba(255, 255, 255, 0.085);
    --manage-border-strong: rgba(255, 255, 255, 0.13);
    --manage-text: rgba(248, 250, 252, 0.92);
    --manage-muted: rgba(226, 232, 240, 0.58);
    --manage-subtle: rgba(226, 232, 240, 0.38);
    --manage-accent: #7dd3fc;
    --manage-accent-muted: rgba(125, 211, 252, 0.14);
    --manage-green: #86efac;
    --manage-red: #fda4af;
    --manage-yellow: #fde68a;
    background: var(--manage-bg);
  }

  * {
    box-sizing: border-box;
  }

  html,
  body,
  #root {
    background: var(--manage-bg);
    height: 100%;
    margin: 0;
    overflow: hidden;
    width: 100%;
  }

  body {
    color: var(--manage-text);
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
  }

  button,
  input,
  textarea {
    font: inherit;
  }

  .manage-shell {
    background: var(--manage-bg);
    display: grid;
    grid-template-columns: minmax(230px, 292px) minmax(0, 1fr);
    height: 100%;
    min-height: 0;
    position: relative;
    width: 100%;
  }

  .manage-shell[data-sidebar-side="right"] {
    grid-template-columns: minmax(0, 1fr) minmax(230px, 292px);
  }

  .manage-shell[data-sidebar-hidden="true"] {
    grid-template-columns: minmax(0, 1fr);
  }

  .manage-sidebar {
    background: var(--manage-panel);
    border-right: 1px solid var(--manage-border);
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }

  .manage-shell[data-sidebar-side="right"] .manage-sidebar {
    border-left: 1px solid var(--manage-border);
    border-right: 0;
    grid-column: 2;
    grid-row: 1;
  }

  .manage-shell[data-sidebar-side="right"] .manage-preview {
    grid-column: 1;
    grid-row: 1;
  }

  .manage-sidebar-header {
    align-items: center;
    border-bottom: 1px solid var(--manage-border);
    display: flex;
    gap: 8px;
    min-height: 48px;
    padding: 0 10px 0 12px;
  }

  .manage-project-title {
    align-items: center;
    color: var(--manage-text);
    display: flex;
    flex: 1 1 auto;
    font-size: 13px;
    font-weight: 680;
    gap: 8px;
    min-width: 0;
  }

  .manage-project-title span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .manage-sidebar-actions {
    align-items: center;
    display: inline-flex;
    flex: 0 0 auto;
    gap: 4px;
    position: relative;
  }

  .manage-icon-button {
    align-items: center;
    background: transparent;
    border: 1px solid transparent;
    color: rgba(248, 250, 252, 0.68);
    display: inline-flex;
    height: 28px;
    justify-content: center;
    padding: 0;
    width: 28px;
  }

  .manage-icon-button:hover,
  .manage-icon-button:focus-visible {
    background: rgba(255, 255, 255, 0.055);
    border-color: var(--manage-border);
    color: var(--manage-text);
    outline: none;
  }

  .manage-icon-button:disabled {
    color: var(--manage-subtle);
  }

  .manage-sidebar-menu {
    background: color-mix(in srgb, var(--manage-panel-raised) 92%, #000 8%);
    border: 1px solid var(--manage-border-strong);
    box-shadow:
      0 14px 28px rgba(0, 0, 0, 0.32),
      0 0 0 1px rgba(255, 255, 255, 0.04);
    display: grid;
    gap: 2px;
    min-width: 178px;
    padding: 6px;
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    z-index: 20;
  }

  .manage-sidebar-menu-item {
    align-items: center;
    background: transparent;
    border: 0;
    color: rgba(244, 244, 245, 0.88);
    display: flex;
    font-size: 12px;
    font-weight: 620;
    gap: 8px;
    min-height: 32px;
    padding: 8px 10px;
    text-align: left;
    white-space: nowrap;
    width: 100%;
  }

  .manage-sidebar-menu-item:hover,
  .manage-sidebar-menu-item:focus-visible {
    background: rgba(255, 255, 255, 0.08);
    color: rgba(250, 250, 250, 0.96);
    outline: none;
  }

  .manage-sidebar-menu-item:disabled {
    color: var(--manage-subtle);
    cursor: not-allowed;
  }

  .manage-sidebar-menu-item:disabled:hover {
    background: transparent;
  }

  .manage-sidebar-restore-button {
    left: 12px;
    position: absolute;
    top: 10px;
    z-index: 5;
  }

  .manage-shell[data-sidebar-side="right"] .manage-sidebar-restore-button {
    left: auto;
    right: 12px;
  }

  .manage-shell[data-sidebar-hidden="true"] .manage-preview-header {
    padding-left: 50px;
  }

  .manage-shell[data-sidebar-hidden="true"][data-sidebar-side="right"] .manage-preview-header {
    padding-left: 16px;
    padding-right: 50px;
  }

  .manage-search {
    align-items: center;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--manage-border);
    display: flex;
    gap: 7px;
    height: 32px;
    margin: 10px 10px 6px;
    padding: 0 9px;
  }

  .manage-search:focus-within {
    border-color: rgba(125, 211, 252, 0.58);
  }

  .manage-search svg {
    color: var(--manage-muted);
    flex: 0 0 auto;
  }

  .manage-search input {
    background: transparent;
    border: 0;
    color: var(--manage-text);
    min-width: 0;
    outline: 0;
    width: 100%;
  }

  .manage-search input::placeholder {
    color: var(--manage-subtle);
  }

  .manage-sidebar-meta {
    color: var(--manage-subtle);
    font-size: 11px;
    font-weight: 650;
    padding: 0 12px 8px;
  }

  .manage-file-list {
    min-height: 0;
    overflow: auto;
    padding: 3px 6px 10px;
  }

  .manage-file-row {
    --depth: 0;
    align-items: center;
    background: transparent;
    border: 1px solid transparent;
    color: var(--manage-muted);
    display: grid;
    gap: 7px;
    grid-template-columns: 16px minmax(0, 1fr) auto;
    min-height: 28px;
    padding: 0 7px 0 calc(7px + (var(--depth) * 13px));
    text-align: left;
    width: 100%;
  }

  .manage-file-row:hover,
  .manage-file-row:focus-visible {
    background: rgba(255, 255, 255, 0.045);
    border-color: rgba(255, 255, 255, 0.06);
    color: var(--manage-text);
    outline: none;
  }

  .manage-file-row[data-kind="directory"] {
    color: rgba(226, 232, 240, 0.66);
    font-weight: 640;
  }

  .manage-file-row[data-selected="true"] {
    background: var(--manage-accent-muted);
    border-color: rgba(125, 211, 252, 0.34);
    color: var(--manage-text);
  }

  .manage-file-icon {
    color: currentColor;
  }

  .manage-file-name {
    font-size: 12px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .manage-file-badges {
    align-items: center;
    display: flex;
    gap: 5px;
    min-width: 0;
  }

  .manage-count-badge {
    align-items: center;
    background: rgba(253, 230, 138, 0.14);
    border: 1px solid rgba(253, 230, 138, 0.32);
    color: var(--manage-yellow);
    display: inline-flex;
    font-size: 10px;
    font-weight: 750;
    height: 17px;
    justify-content: center;
    min-width: 17px;
    padding: 0 5px;
  }

  .manage-file-size {
    color: var(--manage-subtle);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .manage-empty {
    align-items: center;
    color: var(--manage-subtle);
    display: flex;
    font-size: 12px;
    gap: 8px;
    justify-content: center;
    min-height: 72px;
    padding: 14px;
  }

  .manage-preview {
    background: var(--manage-bg);
    min-height: 0;
    min-width: 0;
    overflow: hidden;
  }

  .manage-preview-content {
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
    height: 100%;
    min-height: 0;
  }

  .manage-preview-header {
    align-items: center;
    border-bottom: 1px solid var(--manage-border);
    display: flex;
    gap: 10px;
    min-height: 48px;
    padding: 0 12px 0 18px;
  }

  .manage-preview-title {
    align-items: center;
    display: flex;
    flex: 1 1 auto;
    font-size: 13px;
    font-weight: 700;
    gap: 8px;
    min-width: 0;
  }

  .manage-preview-title span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .manage-preview-meta {
    align-items: center;
    color: var(--manage-subtle);
    display: flex;
    flex: 0 0 auto;
    font-size: 11px;
    font-weight: 650;
    gap: 10px;
  }

  .manage-segmented {
    align-items: center;
    background: rgba(255, 255, 255, 0.045);
    border: 1px solid var(--manage-border);
    display: flex;
    flex: 0 0 auto;
    height: 30px;
    padding: 2px;
  }

  .manage-segmented button {
    align-items: center;
    background: transparent;
    border: 0;
    color: var(--manage-muted);
    display: inline-flex;
    font-size: 11px;
    font-weight: 700;
    gap: 5px;
    height: 24px;
    padding: 0 8px;
  }

  .manage-segmented button[aria-pressed="true"] {
    background: rgba(255, 255, 255, 0.11);
    color: var(--manage-text);
  }

  .manage-preview-path {
    border-bottom: 1px solid rgba(255, 255, 255, 0.055);
    color: var(--manage-subtle);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 11px;
    overflow: hidden;
    padding: 8px 18px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .manage-text-editor {
    background: var(--manage-bg);
    border: 0;
    color: rgba(248, 250, 252, 0.88);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 12px;
    height: 100%;
    line-height: 1.55;
    margin: 0;
    min-height: 0;
    outline: 0;
    overflow: auto;
    padding: 16px 18px 28px;
    resize: none;
    tab-size: 2;
    white-space: pre;
    width: 100%;
  }

  .manage-markdown-workspace {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 286px;
    min-height: 0;
    overflow: hidden;
  }

  .manage-markdown-workspace[data-mode="edit"] {
    grid-template-columns: minmax(0, 1fr) 286px;
  }

  .manage-markdown-workspace[data-mode="preview"] {
    grid-template-columns: minmax(0, 1fr) 286px;
  }

  .manage-markdown-preview {
    color: rgba(248, 250, 252, 0.9);
    font-size: 13px;
    line-height: 1.6;
    min-height: 0;
    overflow: auto;
    padding: 15px 20px 28px;
  }

  .manage-markdown-preview > :first-child {
    margin-top: 0;
  }

  .manage-markdown-preview h1,
  .manage-markdown-preview h2,
  .manage-markdown-preview h3,
  .manage-markdown-preview h4 {
    color: var(--manage-text);
    line-height: 1.22;
    margin: 1.2em 0 0.5em;
  }

  .manage-markdown-preview h1 {
    font-size: 24px;
  }

  .manage-markdown-preview h2 {
    font-size: 19px;
  }

  .manage-markdown-preview h3 {
    font-size: 16px;
  }

  .manage-markdown-preview p,
  .manage-markdown-preview ul,
  .manage-markdown-preview ol,
  .manage-markdown-preview blockquote,
  .manage-markdown-preview pre,
  .manage-markdown-preview table {
    margin: 0.8em 0;
  }

  .manage-markdown-preview code,
  .manage-markdown-preview pre {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  }

  .manage-markdown-preview pre {
    background: rgba(255, 255, 255, 0.045);
    border: 1px solid var(--manage-border);
    overflow: auto;
    padding: 10px 12px;
  }

  .manage-markdown-preview table {
    border-collapse: collapse;
    width: 100%;
  }

  .manage-markdown-preview th,
  .manage-markdown-preview td {
    border: 1px solid var(--manage-border);
    padding: 6px 8px;
  }

  .manage-annotation-highlight {
    background: rgba(253, 230, 138, 0.28);
    color: inherit;
    padding: 0 2px;
  }

  .manage-annotation-highlight[data-type="comment"] {
    background: rgba(125, 211, 252, 0.22);
  }

  .manage-annotation-highlight[data-type="redline"] {
    background: rgba(253, 164, 175, 0.22);
    text-decoration: line-through;
    text-decoration-color: rgba(253, 164, 175, 0.8);
    text-decoration-thickness: 2px;
  }

  .manage-annotations {
    background: var(--manage-panel);
    border-left: 1px solid var(--manage-border);
    display: grid;
    grid-template-rows: auto auto auto minmax(0, 1fr) auto;
    min-height: 0;
    overflow: hidden;
  }

  .manage-annotations-header {
    align-items: center;
    border-bottom: 1px solid var(--manage-border);
    color: var(--manage-muted);
    display: flex;
    font-size: 12px;
    font-weight: 750;
    gap: 7px;
    justify-content: space-between;
    min-height: 38px;
    padding: 0 12px;
  }

  .manage-annotations-title {
    align-items: center;
    display: flex;
    gap: 7px;
    min-width: 0;
  }

  .manage-annotation-persistence {
    color: var(--manage-subtle);
    font-size: 10px;
    font-weight: 720;
  }

  .manage-annotation-persistence[data-state="error"] {
    color: var(--manage-red);
  }

  .manage-annotation-persistence[data-state="saved"],
  .manage-annotation-persistence[data-state="saving"] {
    color: var(--manage-accent);
  }

  .manage-annotation-mode-row {
    border-bottom: 1px solid var(--manage-border);
    display: grid;
    gap: 5px;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    padding: 8px 10px;
  }

  .manage-annotation-mode-row button,
  .manage-quick-labels button,
  .manage-annotation-secondary,
  .manage-annotation-add,
  .manage-selection-toolbar button,
  .manage-annotations-footer button {
    align-items: center;
    border-radius: 6px;
    display: inline-flex;
    justify-content: center;
  }

  .manage-annotation-mode-row button {
    background: rgba(255, 255, 255, 0.035);
    border: 1px solid var(--manage-border);
    color: var(--manage-muted);
    font-size: 11px;
    font-weight: 750;
    height: 28px;
  }

  .manage-annotation-mode-row button[aria-pressed="true"] {
    background: rgba(125, 211, 252, 0.14);
    border-color: rgba(125, 211, 252, 0.34);
    color: var(--manage-text);
  }

  .manage-annotation-composer {
    border-bottom: 1px solid var(--manage-border);
    display: grid;
    gap: 8px;
    padding: 10px;
  }

  .manage-selected-quote {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--manage-border);
    color: var(--manage-muted);
    font-size: 11px;
    line-height: 1.35;
    max-height: 64px;
    min-height: 34px;
    overflow: auto;
    padding: 7px;
  }

  .manage-selected-quote[data-empty="true"] {
    border-style: dashed;
  }

  .manage-quick-labels {
    display: grid;
    gap: 5px;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .manage-quick-labels button {
    background: rgba(255, 255, 255, 0.035);
    border: 1px solid var(--manage-border);
    color: var(--manage-muted);
    font-size: 11px;
    font-weight: 750;
    gap: 4px;
    height: 28px;
    min-width: 0;
    padding: 0 6px;
  }

  .manage-quick-labels button:hover,
  .manage-quick-labels button:focus-visible {
    background: rgba(253, 230, 138, 0.1);
    border-color: rgba(253, 230, 138, 0.28);
    color: var(--manage-text);
    outline: none;
  }

  .manage-annotation-composer textarea {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--manage-border);
    color: var(--manage-text);
    font-size: 12px;
    height: 64px;
    outline: 0;
    padding: 8px;
    resize: none;
  }

  .manage-annotation-composer textarea:focus {
    border-color: rgba(125, 211, 252, 0.5);
  }

  .manage-annotation-actions {
    display: grid;
    gap: 6px;
    grid-template-columns: minmax(0, 0.95fr) minmax(0, 0.8fr) minmax(0, 1fr);
  }

  .manage-annotation-secondary,
  .manage-annotation-add {
    border: 1px solid var(--manage-border);
    font-size: 11px;
    font-weight: 750;
    gap: 5px;
    height: 30px;
    padding: 0 7px;
  }

  .manage-annotation-secondary {
    background: rgba(255, 255, 255, 0.035);
    color: var(--manage-muted);
  }

  .manage-annotation-secondary:hover,
  .manage-annotation-secondary:focus-visible {
    background: rgba(255, 255, 255, 0.065);
    color: var(--manage-text);
    outline: none;
  }

  .manage-annotation-add {
    background: rgba(125, 211, 252, 0.12);
    border-color: rgba(125, 211, 252, 0.3);
    color: var(--manage-text);
  }

  .manage-annotation-secondary:disabled,
  .manage-annotation-add:disabled,
  .manage-annotations-footer button:disabled {
    background: rgba(255, 255, 255, 0.035);
    border-color: var(--manage-border);
    color: var(--manage-subtle);
  }

  .manage-attachment-strip {
    display: grid;
    gap: 6px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .manage-attachment-chip {
    align-items: center;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--manage-border);
    border-radius: 6px;
    display: grid;
    gap: 6px;
    grid-template-columns: 34px minmax(0, 1fr) 20px;
    margin: 0;
    min-width: 0;
    padding: 5px;
  }

  .manage-attachment-chip img,
  .manage-annotation-attachments img {
    background: rgba(255, 255, 255, 0.06);
    border-radius: 4px;
    height: 34px;
    object-fit: cover;
    width: 34px;
  }

  .manage-attachment-chip figcaption,
  .manage-annotation-attachments span {
    color: var(--manage-muted);
    font-size: 10px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .manage-attachment-chip button {
    align-items: center;
    background: transparent;
    border: 0;
    color: var(--manage-muted);
    display: inline-flex;
    height: 20px;
    justify-content: center;
    padding: 0;
    width: 20px;
  }

  .manage-attachment-error {
    color: var(--manage-red);
    font-size: 11px;
    line-height: 1.35;
  }

  .manage-annotation-list {
    display: grid;
    gap: 8px;
    min-height: 0;
    overflow: auto;
    padding: 10px;
  }

  .manage-annotation-empty {
    color: var(--manage-subtle);
    font-size: 12px;
    padding: 12px 2px;
  }

  .manage-annotation-card {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--manage-border);
    display: grid;
    gap: 7px;
    padding: 9px;
  }

  .manage-annotation-card[data-type="redline"] {
    border-color: rgba(253, 164, 175, 0.3);
  }

  .manage-annotation-card-header {
    align-items: center;
    color: var(--manage-muted);
    display: flex;
    font-size: 11px;
    font-weight: 760;
    justify-content: space-between;
  }

  .manage-annotation-card blockquote {
    border-left: 2px solid rgba(253, 230, 138, 0.52);
    color: rgba(248, 250, 252, 0.82);
    font-size: 12px;
    line-height: 1.45;
    margin: 0;
    max-height: 96px;
    overflow: auto;
    padding-left: 8px;
  }

  .manage-annotation-card[data-type="redline"] blockquote {
    border-left-color: rgba(253, 164, 175, 0.58);
    text-decoration: line-through;
    text-decoration-color: rgba(253, 164, 175, 0.8);
    text-decoration-thickness: 2px;
  }

  .manage-annotation-card p {
    color: var(--manage-muted);
    font-size: 12px;
    line-height: 1.45;
    margin: 0;
    overflow-wrap: anywhere;
  }

  .manage-annotation-attachments {
    display: grid;
    gap: 6px;
  }

  .manage-annotation-attachments a {
    align-items: center;
    color: inherit;
    display: grid;
    gap: 6px;
    grid-template-columns: 34px minmax(0, 1fr);
    text-decoration: none;
  }

  .manage-annotations-footer {
    border-top: 1px solid var(--manage-border);
    padding: 8px 10px;
  }

  .manage-annotations-footer button {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--manage-border);
    color: var(--manage-muted);
    font-size: 11px;
    font-weight: 750;
    gap: 6px;
    height: 30px;
    width: 100%;
  }

  .manage-annotations-footer button:not(:disabled):hover,
  .manage-annotations-footer button:not(:disabled):focus-visible {
    background: rgba(125, 211, 252, 0.12);
    border-color: rgba(125, 211, 252, 0.3);
    color: var(--manage-text);
    outline: none;
  }

  .manage-selection-toolbar {
    align-items: center;
    background: var(--manage-panel-raised);
    border: 1px solid var(--manage-border-strong);
    border-radius: 8px;
    box-shadow: 0 14px 40px rgba(0, 0, 0, 0.34);
    display: flex;
    gap: 4px;
    max-width: calc(100vw - 24px);
    padding: 4px;
    position: fixed;
    transform: translateX(-50%);
    z-index: 10;
  }

  .manage-selection-toolbar button {
    background: transparent;
    border: 0;
    color: var(--manage-muted);
    font-size: 11px;
    font-weight: 750;
    gap: 4px;
    height: 28px;
    padding: 0 7px;
    white-space: nowrap;
  }

  .manage-selection-toolbar button:hover,
  .manage-selection-toolbar button:focus-visible {
    background: rgba(255, 255, 255, 0.07);
    color: var(--manage-text);
    outline: none;
  }

  .manage-hidden-file-input {
    display: none;
  }

  .manage-drawing-editor {
    background: #101112;
    display: grid;
    grid-template-rows: minmax(0, 1fr);
    min-height: 0;
    position: relative;
  }

  .manage-drawing-editor .excalidraw {
    min-height: 0;
  }

  .manage-drawing-error {
    align-items: center;
    background: rgba(253, 164, 175, 0.12);
    border: 1px solid rgba(253, 164, 175, 0.3);
    color: var(--manage-red);
    display: flex;
    font-size: 12px;
    gap: 7px;
    left: 12px;
    max-width: calc(100% - 24px);
    padding: 7px 9px;
    position: absolute;
    top: 12px;
    z-index: 3;
  }

  .manage-drawing-source {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 0;
  }

  .manage-preview-message {
    align-items: center;
    color: var(--manage-muted);
    display: flex;
    gap: 10px;
    height: 100%;
    justify-content: center;
    min-height: 140px;
    padding: 24px;
  }

  .manage-preview-message span {
    font-size: 13px;
    font-weight: 650;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  @media (max-width: 960px) {
    .manage-preview-header {
      align-items: flex-start;
      flex-direction: column;
      gap: 7px;
      padding: 8px 14px;
    }

    .manage-preview-meta,
    .manage-segmented {
      align-self: stretch;
    }

    .manage-markdown-workspace,
    .manage-markdown-workspace[data-mode="edit"],
    .manage-markdown-workspace[data-mode="preview"] {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr) minmax(220px, 36%);
    }

    .manage-annotations {
      border-left: 0;
      border-top: 1px solid var(--manage-border);
      min-height: 0;
    }
  }

  @media (max-width: 760px) {
    .manage-shell {
      grid-template-columns: minmax(190px, 42%) minmax(0, 1fr);
    }

    .manage-preview-path,
    .manage-text-editor,
    .manage-markdown-preview {
      padding-left: 14px;
      padding-right: 14px;
    }
  }
`;
document.head.append(styleElement);

createRoot(document.getElementById("root")!).render(<ManageApp />);
