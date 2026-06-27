import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { StateEffect, StateField, RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
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
  IconFile,
  IconFileText,
  IconFileTypeHtml,
  IconFolder,
  IconFolderOpen,
  IconLayoutSidebarLeftCollapse,
  IconMarkdown,
  IconLayoutSidebarRightCollapse,
  IconLayoutSidebarRightExpand,
  IconMenu2,
  IconMessagePlus,
  IconPhoto,
  IconRefresh,
  IconSearch,
  IconTag,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { createEditor as createMeoEditor } from "./meo/editor";
import { applyThemeSettings as applyMeoThemeSettings } from "./meo/helpers/theme";
import "./meo/styles.css";

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
  anchor: ManageSelectionAnchor;
  text: string;
};

type ManageCommentDraft = {
  anchor: ManageSelectionAnchor;
  attachmentError: string;
  attachments: ManageAnnotationImage[];
  note: string;
  quote: string;
};

type ManageSidebarSide = "left" | "right";

type ManageArtifactKind = "excalidraw" | "html" | "markdown";

type ManageMarkdownAlertKind = "caution" | "important" | "note" | "tip" | "warning";

type ManageMarkdownBlock = {
  alertKind?: ManageMarkdownAlertKind;
  checked?: boolean;
  content: string;
  directiveKind?: string;
  id: string;
  language?: string;
  level?: number;
  order: number;
  ordered?: boolean;
  orderedIndex?: number;
  orderedStart?: number;
  startLine: number;
  type: "blockquote" | "code" | "directive" | "heading" | "hr" | "html" | "list-item" | "paragraph" | "table";
};

type ManageMeoEditor = {
  destroy: () => void;
  focus: () => void;
  getText: () => string;
  refreshLayout?: () => void;
  setText: (text: string) => void;
  view: EditorView;
};

type ManageMeoSelectionState = {
  anchorBottomY?: number;
  anchorX?: number;
  anchorY?: number;
  from?: number;
  to?: number;
  visible?: boolean;
};

type ManageMeoAnnotationDecoration = {
  from: number;
  to: number;
  type: ManageAnnotationType;
};

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
const MANAGE_ARTIFACT_ROOT_PATH = "artifacts";
const MANAGE_SELECTION_MAX_LENGTH = 700;
const MANAGE_ANNOTATIONS_SIDECAR_PATH = ".ghostex/manage-annotations.json";
const MANAGE_ANNOTATION_SCHEMA_VERSION = 1;
const MANAGE_ANNOTATION_IMAGE_MAX_BYTES = 512 * 1024;
const MANAGE_ANNOTATION_MAX_IMAGES = 4;
const MANAGE_SIDEBAR_DEFAULT_WIDTH = 292;
const MANAGE_SIDEBAR_MIN_WIDTH = 230;
const MANAGE_SIDEBAR_MAX_WIDTH = 560;
const MANAGE_SIDEBAR_SIDE_STORAGE_KEY = "ghostex.manage.sidebarSide";
const MANAGE_SIDEBAR_WIDTH_STORAGE_KEY = "ghostex.manage.sidebarWidth";
const MANAGE_EXCALIDRAW_CANVAS_BACKGROUND = "#101112";
const MANAGE_EXCALIDRAW_CANVAS_THEME: AppState["theme"] = "light";
const MANAGE_QUICK_LABELS: ManageQuickLabel[] = [
  { id: "clarify", text: "Clarify" },
  { id: "needs-tests", text: "Needs tests" },
  { id: "looks-good", text: "Looks good" },
];
const MANAGE_MEO_THEME = {
  backgroundColor: "#101112",
  colors: {
    base01: "#e5e7eb",
    base02: "#8b949e",
    base03: "#30363d",
    base04: "#f87171",
    base05: "#7dd3fc",
    base06: "#67e8f9",
    base07: "#fde68a",
    base08: "#c084fc",
    base09: "#86efac",
  },
  fonts: {
    liveFont: "",
    sourceFont: "",
    liveFontWeight: "450",
    sourceFontWeight: "450",
    liveFontSize: 14,
    sourceFontSize: 14,
    h1FontSize: 1.5,
    h1FontWeight: "720",
    h2FontSize: 1.35,
    h2FontWeight: "700",
    h3FontSize: 1.18,
    h3FontWeight: "700",
    h4FontSize: 1.08,
    h4FontWeight: "680",
    h5FontSize: 1,
    h5FontWeight: "660",
    h6FontSize: 0.94,
    h6FontWeight: "650",
    liveLineHeight: 1.55,
    sourceLineHeight: 1.55,
  },
  id: "ghostex-manage-meo",
  name: "Ghostex Manage Meo",
  syntaxTokens: {},
};
const manageMeoAnnotationEffect = StateEffect.define<ManageMeoAnnotationDecoration[]>();
const manageMeoCommentMark = Decoration.mark({
  attributes: { "data-type": "comment" },
  class: "annotation-highlight manage-annotation-highlight comment",
});
const manageMeoRedlineMark = Decoration.mark({
  attributes: { "data-type": "redline" },
  class: "annotation-highlight manage-annotation-highlight deletion",
});

const manageMeoAnnotationField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(value, transaction) {
    let nextValue = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(manageMeoAnnotationEffect)) {
        nextValue = buildManageMeoAnnotationDecorations(effect.value);
      }
    }
    return nextValue;
  },
  provide(field) {
    return EditorView.decorations.from(field);
  },
});

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
 * CDXC:ManageAnnotations 2026-06-26-23:35:
 * Markdown artifacts should use a rendered-document review shape with floating selection actions, an anchored comment popover, and a side annotation timeline. Do not show Manage's old Edit/Split/Preview tabs or fixed bottom annotation composer for Markdown files.
 *
 * CDXC:ManageMarkdownRendering 2026-06-26-23:35:
 * Manage Markdown rendering should use a local block parser and consistent visual scale for headings, lists, blockquotes, code, tables, alerts, directives, and raw HTML blocks instead of a generic Markdown preview.
 *
 * CDXC:ManageMarkdownEditing 2026-06-27-12:40:
 * Markdown artifacts must be editable and richly rendered in one surface, matching Meo's live Markdown editor instead of a split edit/preview or review-only view.
 * Mount Meo's copied CodeMirror live editor for Markdown files while keeping Ghostex annotations in the same Manage workarea.
 *
 * CDXC:ManageMarkdownAnnotations 2026-06-27-12:40:
 * Users need to edit Markdown text and annotate selections at the same time.
 * Feed Meo editor selections into the existing annotation toolbar and render sidecar comments/redlines as CodeMirror decorations so annotation review remains visible during editing.
 *
 * CDXC:ManageMarkdownHeader 2026-06-27-13:01:
 * Markdown artifacts need a single top row: show the project-relative file path in the header, remove the separate path/status row, move Comment/Copy controls into the header, and expose a collapsible annotation rail with the active annotation count.
 * Annotation cards must size to their own content instead of stretching to fill the rail.
 *
 * CDXC:ManageDrawings 2026-06-20-06:14:
 * .excalidraw files should open as editable drawings instead of raw JSON. Use the upstream Excalidraw component for canvas behavior, serialize full scene JSON through the normal Manage save bridge, and keep invalid drawings editable as source text so users can repair them.
 *
 * CDXC:ManageDrawings 2026-06-26-23:53:
 * The Manage Excalidraw canvas must display selected background colors literally. Keep Excalidraw in light theme because its dark theme applies an inversion filter that makes white render dark and #000000 render white.
 *
 * CDXC:ManageEditing 2026-06-21-18:00:
 * The macOS Manage editor header should not show an explicit Save button. Keep edited/saved status visible in metadata while retaining the existing bridge-backed save behavior through the keyboard shortcut and editor flows.
 *
 * CDXC:ManageSidebar 2026-06-20-17:15:
 * Manage's file-sidebar refresh control is an overflow menu with Refresh and Switch sidebar side actions. A separate adjacent icon hides the file sidebar, and the editor area provides a small restore affordance so hiding is reversible.
 *
 * CDXC:ManageArtifacts 2026-06-26-13:59:
 * Manage is an artifacts-focused project surface. Keep first-class sidebar actions for new Markdown, HTML, and Excalidraw files, create them under the active project's artifacts/ directory, and immediately open the created file in the Manage preview/editor.
 *
 * CDXC:ManageSidebar 2026-06-26-23:14:
 * The Manage file sidebar needs a visible resizer so users can widen the artifacts tree on either sidebar side without overlapping the preview/editor. Persist the width locally and clamp it to the current workarea so the preview keeps usable space.
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
  const [sidebarWidth, setSidebarWidth] = useState(() => readStoredManageSidebarWidth());
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [creatingArtifactKind, setCreatingArtifactKind] = useState<ManageArtifactKind>();
  const shellRef = useRef<HTMLElement | null>(null);
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
    window.localStorage.setItem(MANAGE_SIDEBAR_WIDTH_STORAGE_KEY, String(Math.round(sidebarWidth)));
  }, [sidebarWidth]);

  useEffect(() => {
    const handleResize = () => {
      const containerWidth = shellRef.current?.getBoundingClientRect().width ?? window.innerWidth;
      setSidebarWidth((currentWidth) => clampManageSidebarWidth(currentWidth, containerWidth));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

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

  const updateSidebarWidthFromClientX = useCallback(
    (clientX: number) => {
      const shellRect = shellRef.current?.getBoundingClientRect();
      if (!shellRect) {
        return;
      }
      const nextWidth = sidebarSide === "right" ? shellRect.right - clientX : clientX - shellRect.left;
      setSidebarWidth(clampManageSidebarWidth(nextWidth, shellRect.width));
    },
    [sidebarSide],
  );

  const resizeSidebarBy = useCallback((delta: number) => {
    const containerWidth = shellRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    setSidebarWidth((currentWidth) => clampManageSidebarWidth(currentWidth + delta, containerWidth));
  }, []);

  const handleSidebarResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (sidebarHidden) {
        return;
      }
      event.preventDefault();
      updateSidebarWidthFromClientX(event.clientX);
      const handlePointerMove = (moveEvent: PointerEvent) => {
        updateSidebarWidthFromClientX(moveEvent.clientX);
      };
      const handlePointerUp = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerUp);
      };
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerUp);
    },
    [sidebarHidden, updateSidebarWidthFromClientX],
  );

  const handleSidebarResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const direction = sidebarSide === "right" ? -1 : 1;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        resizeSidebarBy(-12 * direction);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        resizeSidebarBy(12 * direction);
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        const containerWidth = shellRef.current?.getBoundingClientRect().width ?? window.innerWidth;
        setSidebarWidth(clampManageSidebarWidth(MANAGE_SIDEBAR_MIN_WIDTH, containerWidth));
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        const containerWidth = shellRef.current?.getBoundingClientRect().width ?? window.innerWidth;
        setSidebarWidth(clampManageSidebarWidth(MANAGE_SIDEBAR_MAX_WIDTH, containerWidth));
      }
    },
    [resizeSidebarBy, sidebarSide],
  );

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

  const createArtifactFile = useCallback(
    async (kind: ManageArtifactKind) => {
      if (creatingArtifactKind) {
        return;
      }
      const path = createUniqueArtifactPath(entries, kind);
      const content = createInitialArtifactContent(kind);
      setCreatingArtifactKind(kind);
      setSaveState("saving");
      setError(undefined);
      try {
        const response = await requestManageFiles({
          action: "save",
          content,
          path,
          projectEditorId,
          projectId,
        });
        if (response.error) {
          throw new Error(response.error);
        }
        const createdFile = response.file;
        if (!createdFile) {
          throw new Error("Manage did not return created file metadata.");
        }
        selectedPathRef.current = createdFile.path;
        setSelectedPath(createdFile.path);
        setPreview(createdFile);
        const nextContent = createdFile.content ?? content;
        setDraftContent(nextContent);
        setLastSavedContent(nextContent);
        setPreviewState("ready");
        setSaveState("saved");
        if (saveResetTimerRef.current !== undefined) {
          window.clearTimeout(saveResetTimerRef.current);
        }
        saveResetTimerRef.current = window.setTimeout(() => {
          setSaveState("idle");
          saveResetTimerRef.current = undefined;
        }, 1_600);
        await refreshFiles();
      } catch (createError) {
        setSaveState("error");
        setError(createError instanceof Error ? createError.message : "Could not create artifact.");
      } finally {
        setCreatingArtifactKind(undefined);
      }
    },
    [creatingArtifactKind, entries, projectEditorId, projectId, refreshFiles],
  );

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
    <main
      className="manage-shell"
      data-sidebar-hidden={String(sidebarHidden)}
      data-sidebar-side={sidebarSide}
      ref={shellRef}
      style={{ "--manage-sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
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
          <ManageArtifactCreateButtons
            creatingKind={creatingArtifactKind}
            onCreate={(kind) => void createArtifactFile(kind)}
          />
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
      {!sidebarHidden ? (
        <div
          aria-label="Resize file sidebar"
          aria-orientation="vertical"
          aria-valuemax={MANAGE_SIDEBAR_MAX_WIDTH}
          aria-valuemin={MANAGE_SIDEBAR_MIN_WIDTH}
          aria-valuenow={Math.round(sidebarWidth)}
          className="manage-sidebar-resizer"
          onKeyDown={handleSidebarResizeKeyDown}
          onPointerDown={handleSidebarResizePointerDown}
          role="separator"
          tabIndex={0}
          title="Resize file sidebar"
        />
      ) : null}
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

function ManageArtifactCreateButtons({
  creatingKind,
  onCreate,
}: {
  creatingKind?: ManageArtifactKind;
  onCreate: (kind: ManageArtifactKind) => void;
}) {
  const isCreating = Boolean(creatingKind);
  return (
    <div className="manage-artifact-create" aria-label="Create artifact">
      <button
        className="manage-artifact-create-button"
        disabled={isCreating}
        onClick={() => onCreate("markdown")}
        title="New Markdown artifact"
        type="button"
      >
        <IconMarkdown aria-hidden="true" size={15} stroke={1.85} />
        <span>{creatingKind === "markdown" ? "..." : "MD"}</span>
      </button>
      <button
        className="manage-artifact-create-button"
        disabled={isCreating}
        onClick={() => onCreate("html")}
        title="New HTML artifact"
        type="button"
      >
        <IconFileTypeHtml aria-hidden="true" size={15} stroke={1.85} />
        <span>{creatingKind === "html" ? "..." : "HTML"}</span>
      </button>
      <button
        className="manage-artifact-create-button"
        disabled={isCreating}
        onClick={() => onCreate("excalidraw")}
        title="New Excalidraw artifact"
        type="button"
      >
        <IconEdit aria-hidden="true" size={15} stroke={1.85} />
        <span>{creatingKind === "excalidraw" ? "..." : "Draw"}</span>
      </button>
    </div>
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
  const [selection, setSelection] = useState<ManageCapturedSelection>();
  const [commentDraft, setCommentDraft] = useState<ManageCommentDraft>();
  const [feedbackCopyState, setFeedbackCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [markdownAnnotationsCollapsed, setMarkdownAnnotationsCollapsed] = useState(false);
  const selectedPathRef = useRef<string | undefined>(selectedPath);

  useEffect(() => {
    if (selectedPathRef.current !== selectedPath) {
      selectedPathRef.current = selectedPath;
      setSelection(undefined);
      setCommentDraft(undefined);
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
      setSelection(undefined);
      setCommentDraft(undefined);
    },
    [onAnnotationsChange],
  );

  const captureSelectedText = useCallback((capturedSelection: ManageCapturedSelection) => {
    const normalized = normalizeAnnotationQuote(capturedSelection.text);
    if (!normalized) {
      return;
    }
    setCommentDraft(undefined);
    setSelection({
      anchor: capturedSelection.anchor,
      text: normalized,
    });
  }, []);

  const clearSelectedText = useCallback(() => {
    setSelection(undefined);
  }, []);

  const openCommentDraft = useCallback(
    (quote: string, anchor: ManageSelectionAnchor, initialNote = "") => {
      setSelection(undefined);
      setCommentDraft({
        anchor,
        attachmentError: "",
        attachments: [],
        note: initialNote,
        quote: normalizeAnnotationQuote(quote),
      });
    },
    [],
  );

  const addSelectedRedline = useCallback(() => {
    if (!selection) {
      return;
    }
    addAnnotation({
      quote: selection.text,
      type: "redline",
    });
  }, [addAnnotation, selection]);

  const addQuickLabel = useCallback(
    (label: ManageQuickLabel) => {
      addAnnotation({
        labelId: label.id,
        note: label.text,
        quote: selection?.text ?? commentDraft?.quote ?? "",
        type: "comment",
      });
    },
    [addAnnotation, commentDraft?.quote, selection?.text],
  );

  const submitCommentDraft = useCallback(() => {
    if (!commentDraft) {
      return;
    }
    addAnnotation({
      attachments: commentDraft.attachments,
      note: commentDraft.note,
      quote: commentDraft.quote,
      type: "comment",
    });
  }, [addAnnotation, commentDraft]);

  const updateCommentDraftNote = useCallback((note: string) => {
    setCommentDraft((current) => (current ? { ...current, note } : current));
  }, []);

  const addAttachmentFiles = useCallback((files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) {
      return;
    }
    setCommentDraft((current) => {
      if (!current) {
        return current;
      }
      const availableSlots = Math.max(0, MANAGE_ANNOTATION_MAX_IMAGES - current.attachments.length);
      if (availableSlots === 0) {
        return {
          ...current,
          attachmentError: `Use ${MANAGE_ANNOTATION_MAX_IMAGES} images or fewer per annotation.`,
        };
      }
      let attachmentError =
        imageFiles.length > availableSlots ? `Use ${MANAGE_ANNOTATION_MAX_IMAGES} images or fewer per annotation.` : "";
      for (const file of imageFiles.slice(0, availableSlots)) {
        if (file.size > MANAGE_ANNOTATION_IMAGE_MAX_BYTES) {
          attachmentError = "Images must be 512 KB or smaller.";
          continue;
        }
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = typeof reader.result === "string" ? reader.result : "";
          if (!dataUrl) {
            return;
          }
          setCommentDraft((latest) => {
            if (!latest || latest.attachments.length >= MANAGE_ANNOTATION_MAX_IMAGES) {
              return latest;
            }
            return {
              ...latest,
              attachmentError: "",
              attachments: [
                ...latest.attachments,
                {
                  dataUrl,
                  id: `manage-annotation-image-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                  mimeType: file.type,
                  name: normalizeAttachmentName(file.name),
                  size: file.size,
                },
              ],
            };
          });
        };
        reader.onerror = () => {
          setCommentDraft((latest) =>
            latest ? { ...latest, attachmentError: "Could not read image attachment." } : latest,
          );
        };
        reader.readAsDataURL(file);
      }
      return {
        ...current,
        attachmentError,
      };
    });
  }, []);

  const removeDraftAttachment = useCallback((attachmentId: string) => {
    setCommentDraft((current) =>
      current
        ? {
            ...current,
            attachments: current.attachments.filter((attachment) => attachment.id !== attachmentId),
          }
        : current,
    );
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

  const copySelectedText = useCallback(async () => {
    if (!selection) {
      return;
    }
    try {
      await writeTextToClipboard(selection.text);
    } catch {
      // Selection copy is opportunistic; the main feedback export reports copy failures.
    }
  }, [selection]);

  const openCommentForSelection = useCallback(() => {
    if (!selection) {
      return;
    }
    openCommentDraft(selection.text, selection.anchor);
  }, [openCommentDraft, selection]);

  const openGlobalComment = useCallback(
    (anchor: ManageSelectionAnchor) => {
      openCommentDraft("", anchor);
    },
    [openCommentDraft],
  );

  useEffect(() => {
    if (!selection || commentDraft) {
      return;
    }
    const activeSelection = selection;
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
      if (key === "backspace" || key === "d" || key === "delete") {
        event.preventDefault();
        addSelectedRedline();
        return;
      }
      if (key === "c") {
        event.preventDefault();
        openCommentForSelection();
        return;
      }
      if (/^[1-3]$/u.test(key)) {
        event.preventDefault();
        const label = MANAGE_QUICK_LABELS[Number(key) - 1];
        if (label) {
          addQuickLabel(label);
        }
        return;
      }
      if (event.key.length === 1) {
        event.preventDefault();
        openCommentDraft(activeSelection.text, activeSelection.anchor, event.key);
      }
    }
    window.addEventListener("keydown", handleAnnotationShortcut);
    return () => window.removeEventListener("keydown", handleAnnotationShortcut);
  }, [addQuickLabel, addSelectedRedline, commentDraft, openCommentDraft, openCommentForSelection, selection]);

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
  const previewTitle = isMarkdown ? preview.path : preview.name;
  const annotationPersistenceTitle = annotationPersistenceLabel(annotationPersistenceState);

  return (
    <div className="manage-preview-content" data-kind={isMarkdown ? "markdown" : isDrawing ? "drawing" : "text"}>
      <header className="manage-preview-header">
        <div className="manage-preview-title">
          {isDrawing ? (
            <IconEdit aria-hidden="true" size={17} stroke={1.85} />
          ) : (
            <IconFileText aria-hidden="true" size={17} stroke={1.85} />
          )}
          <span>{previewTitle}</span>
        </div>
        <div className="manage-preview-meta">
          <span>{language}</span>
          {preview.size !== undefined ? <span>{formatFileSize(preview.size)}</span> : null}
          {isDirty ? <span>Edited</span> : saveState === "saved" ? <span>Saved</span> : null}
        </div>
        {isMarkdown ? (
          <div className="manage-preview-header-actions">
            <button
              aria-label="Add global comment"
              onClick={(event) =>
                openGlobalComment(
                  selectionAnchorFromRect(event.currentTarget.getBoundingClientRect()) ?? defaultManageSelectionAnchor(),
                )
              }
              title="Add global comment"
              type="button"
            >
              <IconMessagePlus aria-hidden="true" size={14} />
              <span>Comment</span>
            </button>
            <button
              aria-label="Copy feedback"
              disabled={annotations.length === 0}
              onClick={() => void copyFeedback()}
              title="Copy feedback"
              type="button"
            >
              {feedbackCopyState === "copied" ? (
                <IconCheck aria-hidden="true" size={14} />
              ) : (
                <IconCopy aria-hidden="true" size={14} />
              )}
              <span>{feedbackCopyState === "copied" ? "Copied" : "Copy"}</span>
            </button>
            <button
              aria-controls="manage-markdown-annotation-rail"
              aria-expanded={!markdownAnnotationsCollapsed}
              aria-label={markdownAnnotationsCollapsed ? "Show annotations" : "Hide annotations"}
              className="manage-annotation-rail-toggle"
              onClick={() => setMarkdownAnnotationsCollapsed((current) => !current)}
              title={`${markdownAnnotationsCollapsed ? "Show" : "Hide"} annotations (${annotations.length}) · ${annotationPersistenceTitle}`}
              type="button"
            >
              {markdownAnnotationsCollapsed ? (
                <IconLayoutSidebarRightExpand aria-hidden="true" size={14} />
              ) : (
                <IconLayoutSidebarRightCollapse aria-hidden="true" size={14} />
              )}
              <span className="manage-count-badge">{annotations.length}</span>
            </button>
          </div>
        ) : null}
      </header>
      {!isMarkdown ? <div className="manage-preview-path">{preview.path}</div> : null}
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
        <>
          <ManageMarkdownReviewViewer
            annotations={annotations}
            annotationsCollapsed={markdownAnnotationsCollapsed}
            content={draftContent}
            documentKey={preview.path}
            onContentChange={onDraftContentChange}
            onRemoveAnnotation={removeAnnotation}
            onSelectionClear={clearSelectedText}
            onSelectionCapture={captureSelectedText}
          />
          {selection ? (
            <ManageAnnotationToolbar
              anchor={selection.anchor}
              onComment={openCommentForSelection}
              onCopy={() => void copySelectedText()}
              onDismiss={() => setSelection(undefined)}
              onQuickLabel={addQuickLabel}
              onRedline={addSelectedRedline}
            />
          ) : null}
          {commentDraft ? (
            <ManageCommentPopover
              draft={commentDraft}
              onAddAttachmentFiles={addAttachmentFiles}
              onCancel={() => setCommentDraft(undefined)}
              onDraftNoteChange={updateCommentDraftNote}
              onRemoveDraftAttachment={removeDraftAttachment}
              onSubmit={submitCommentDraft}
            />
          ) : null}
        </>
      ) : (
        <ManageTextEditor
          content={draftContent}
          language={language}
          onChange={onDraftContentChange}
        />
      )}
    </div>
  );
}

function ManageTextEditor({
  content,
  language,
  onChange,
}: {
  content: string;
  language: string;
  onChange: (content: string) => void;
}) {
  return (
    <textarea
      aria-label={`${language} editor`}
      className="manage-text-editor"
      onChange={(event) => onChange(event.currentTarget.value)}
      spellCheck={false}
      value={content}
    />
  );
}

function ManageMarkdownReviewViewer({
  annotations,
  annotationsCollapsed,
  content,
  documentKey,
  onContentChange,
  onRemoveAnnotation,
  onSelectionClear,
  onSelectionCapture,
}: {
  annotations: ManageAnnotation[];
  annotationsCollapsed: boolean;
  content: string;
  documentKey: string;
  onContentChange: (content: string) => void;
  onRemoveAnnotation: (annotationId: string) => void;
  onSelectionClear: () => void;
  onSelectionCapture: (selection: ManageCapturedSelection) => void;
}) {
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<ManageMeoEditor | null>(null);
  const latestContentRef = useRef(content);
  const annotationsRef = useRef(annotations);
  const onContentChangeRef = useRef(onContentChange);
  const onSelectionClearRef = useRef(onSelectionClear);
  const onSelectionCaptureRef = useRef(onSelectionCapture);

  useEffect(() => {
    annotationsRef.current = annotations;
  }, [annotations]);

  useEffect(() => {
    onContentChangeRef.current = onContentChange;
  }, [onContentChange]);

  useEffect(() => {
    onSelectionClearRef.current = onSelectionClear;
  }, [onSelectionClear]);

  useEffect(() => {
    onSelectionCaptureRef.current = onSelectionCapture;
  }, [onSelectionCapture]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || content === latestContentRef.current) {
      return;
    }
    latestContentRef.current = content;
    editor.setText(content);
    editor.refreshLayout?.();
  }, [content]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    editor.view.dispatch({
      effects: manageMeoAnnotationEffect.of(createManageMeoAnnotationDecorations(editor.getText(), annotations)),
    });
  }, [annotations, content]);

  useEffect(() => {
    const host = editorHostRef.current;
    if (!host) {
      return;
    }
    latestContentRef.current = content;
    host.replaceChildren();
    applyManageMeoTheme();
    let mountedEditor: ManageMeoEditor | null = null;
    const editor = createMeoEditor({
      externalExtensions: [manageMeoAnnotationField] satisfies Extension[],
      initialGitGutter: false,
      initialLineNumbers: true,
      initialMode: "live",
      initialVimKeybindings: [],
      parent: host,
      text: content,
      onApplyChanges: (nextContent: string) => {
        latestContentRef.current = nextContent;
        onContentChangeRef.current(nextContent);
        mountedEditor?.view.dispatch({
          effects: manageMeoAnnotationEffect.of(createManageMeoAnnotationDecorations(nextContent, annotationsRef.current)),
        });
      },
      onOpenLink: (href: string) => {
        const safeHref = sanitizeManageHref(href);
        if (safeHref) {
          window.open(safeHref, "_blank", "noopener,noreferrer");
        }
      },
      onSelectionChange: (state: ManageMeoSelectionState) => {
        const selection = normalizeManageMeoSelection(state, mountedEditor);
        if (selection) {
          onSelectionCaptureRef.current(selection);
          return;
        }
        /*
         * CDXC:ManageMarkdownAnnotations 2026-06-27-12:40:
         * Meo reports hidden selection states after the user clicks away or collapses the range.
         * Clear Manage's floating annotation toolbar then, so annotation actions follow the live editor selection instead of a stale previous quote.
         */
        onSelectionClearRef.current();
      },
    }) as ManageMeoEditor;
    mountedEditor = editor;
    editorRef.current = editor;
    editor.view.dispatch({
      effects: manageMeoAnnotationEffect.of(createManageMeoAnnotationDecorations(content, annotationsRef.current)),
    });
    window.requestAnimationFrame(() => editor.refreshLayout?.());
    return () => {
      editor.destroy();
      if (editorRef.current === editor) {
        editorRef.current = null;
      }
    };
  }, [documentKey]);

  return (
    <div
      className="manage-markdown-review manage-markdown-meo-review"
      data-annotations-collapsed={String(annotationsCollapsed)}
    >
      <section className="manage-markdown-review-main">
        <div className="manage-meo-markdown-editor editor-root">
          <div className="editor-wrapper" data-outline-position="right">
            <div className="editor-host" ref={editorHostRef} />
          </div>
        </div>
      </section>
      {annotationsCollapsed ? null : (
        <ManageAnnotationTimeline annotations={annotations} onRemoveAnnotation={onRemoveAnnotation} />
      )}
    </div>
  );
}

function ManageAnnotationToolbar({
  anchor,
  onComment,
  onCopy,
  onDismiss,
  onQuickLabel,
  onRedline,
}: {
  anchor: ManageSelectionAnchor;
  onComment: () => void;
  onCopy: () => void;
  onDismiss: () => void;
  onQuickLabel: (label: ManageQuickLabel) => void;
  onRedline: () => void;
}) {
  return createPortal(
    <div
      className="manage-markdown-selection-toolbar"
      style={{
        left: anchor.left,
        top: Math.max(8, anchor.top - 46),
      }}
    >
      <button onClick={onCopy} title="Copy selection" type="button">
        <IconCopy aria-hidden="true" size={14} />
        Copy
      </button>
      <button onClick={onRedline} title="Mark as deletion" type="button">
        <IconTrash aria-hidden="true" size={14} />
        Delete
      </button>
      <button onClick={onComment} title="Comment on selection" type="button">
        <IconMessagePlus aria-hidden="true" size={14} />
        Comment
      </button>
      {MANAGE_QUICK_LABELS.map((label) => (
        <button key={label.id} onClick={() => onQuickLabel(label)} title={label.text} type="button">
          <IconTag aria-hidden="true" size={13} />
          {label.text}
        </button>
      ))}
      <button aria-label="Dismiss annotation toolbar" onClick={onDismiss} type="button">
        <IconX aria-hidden="true" size={14} />
      </button>
    </div>,
    document.body,
  );
}

function ManageCommentPopover({
  draft,
  onAddAttachmentFiles,
  onCancel,
  onDraftNoteChange,
  onRemoveDraftAttachment,
  onSubmit,
}: {
  draft: ManageCommentDraft;
  onAddAttachmentFiles: (files: FileList | File[]) => void;
  onCancel: () => void;
  onDraftNoteChange: (note: string) => void;
  onRemoveDraftAttachment: (attachmentId: string) => void;
  onSubmit: () => void;
}) {
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const canSubmit = Boolean(draft.note.trim()) || draft.attachments.length > 0;
  return createPortal(
    <div className="manage-comment-popover" style={commentPopoverStyle(draft.anchor)}>
      <div className="manage-comment-popover-quote" data-empty={String(!draft.quote)}>
        {draft.quote || "Global comment"}
      </div>
      <textarea
        aria-label="Annotation note"
        autoFocus
        onChange={(event) => onDraftNoteChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
            return;
          }
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canSubmit) {
            event.preventDefault();
            onSubmit();
          }
        }}
        placeholder={draft.quote ? "Add a comment" : "Add a global comment"}
        value={draft.note}
      />
      {draft.attachments.length > 0 ? (
        <div className="manage-attachment-strip">
          {draft.attachments.map((attachment) => (
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
      {draft.attachmentError ? <div className="manage-attachment-error">{draft.attachmentError}</div> : null}
      <div className="manage-comment-popover-actions">
        <button onClick={() => attachmentInputRef.current?.click()} type="button">
          <IconPhoto aria-hidden="true" size={14} />
          Image
        </button>
        <button onClick={onCancel} type="button">
          Cancel
        </button>
        <button disabled={!canSubmit} onClick={onSubmit} type="button">
          <IconMessagePlus aria-hidden="true" size={14} />
          Comment
        </button>
      </div>
      <input
        accept="image/*"
        aria-label="Annotation image attachments"
        className="manage-hidden-file-input"
        multiple
        onChange={(event) => {
          if (event.currentTarget.files) {
            onAddAttachmentFiles(event.currentTarget.files);
          }
          event.currentTarget.value = "";
        }}
        ref={attachmentInputRef}
        type="file"
      />
    </div>,
    document.body,
  );
}

function ManageAnnotationTimeline({
  annotations,
  onRemoveAnnotation,
}: {
  annotations: ManageAnnotation[];
  onRemoveAnnotation: (annotationId: string) => void;
}) {
  return (
    <aside className="manage-markdown-annotation-rail" aria-label="Annotations" id="manage-markdown-annotation-rail">
      <header>
        <span>Annotations</span>
        {annotations.length > 0 ? <span className="manage-count-badge">{annotations.length}</span> : null}
      </header>
      <div className="manage-markdown-annotation-list">
        {annotations.length === 0 ? <div className="manage-annotation-empty">No annotations</div> : null}
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
    </aside>
  );
}

function ManageMarkdownBlockRenderer({
  annotations,
  block,
  orderedIndex,
}: {
  annotations: ManageAnnotation[];
  block: ManageMarkdownBlock;
  orderedIndex?: number;
}) {
  switch (block.type) {
    case "heading": {
      const HeadingTag = `h${Math.min(Math.max(block.level ?? 1, 1), 6)}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      return (
        <HeadingTag data-block-id={block.id} data-block-type="heading">
          {renderManageInlineMarkdown(block.content, annotations)}
        </HeadingTag>
      );
    }
    case "blockquote": {
      if (block.alertKind) {
        return (
          <div className="manage-md-alert" data-kind={block.alertKind} data-block-id={block.id}>
            <div className="manage-md-alert-title">{block.alertKind}</div>
            {block.content.split(/\n\n+/u).map((paragraph, index) => (
              <p key={index}>{renderManageInlineMarkdown(paragraph, annotations)}</p>
            ))}
          </div>
        );
      }
      return (
        <blockquote data-block-id={block.id}>
          {block.content.split(/\n\n+/u).map((paragraph, index) => (
            <p key={index}>{renderManageInlineMarkdown(paragraph, annotations)}</p>
          ))}
        </blockquote>
      );
    }
    case "list-item":
      return (
        <div
          className="manage-md-list-item"
          data-block-id={block.id}
          style={{ "--manage-md-list-level": block.level ?? 0 } as CSSProperties}
        >
          <span className="manage-md-list-marker">
            {block.checked !== undefined ? (
              <input checked={block.checked} readOnly tabIndex={-1} type="checkbox" />
            ) : block.ordered ? (
              `${orderedIndex ?? block.orderedStart ?? 1}.`
            ) : (
              "*"
            )}
          </span>
          <span className={block.checked ? "manage-md-list-text is-checked" : "manage-md-list-text"}>
            {renderManageInlineMarkdown(block.content, annotations)}
          </span>
        </div>
      );
    case "code":
      return <ManageMarkdownCodeBlock block={block} />;
    case "table":
      return <ManageMarkdownTable block={block} annotations={annotations} />;
    case "hr":
      return <hr data-block-id={block.id} />;
    case "html":
      return <ManageMarkdownHtmlBlock block={block} />;
    case "directive":
      return (
        <div className="manage-md-directive" data-kind={block.directiveKind ?? "note"} data-block-id={block.id}>
          {block.content.split(/\n\n+/u).map((paragraph, index) => (
            <p key={index}>{renderManageInlineMarkdown(paragraph, annotations)}</p>
          ))}
        </div>
      );
    case "paragraph":
    default:
      return (
        <p data-block-id={block.id}>
          {renderManageInlineMarkdown(block.content, annotations)}
        </p>
      );
  }
}

function ManageMarkdownCodeBlock({ block }: { block: ManageMarkdownBlock }) {
  const [copied, setCopied] = useState(false);
  const copyCode = useCallback(async () => {
    try {
      await writeTextToClipboard(block.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_600);
    } catch {
      setCopied(false);
    }
  }, [block.content]);
  return (
    <div className="manage-md-code-block" data-block-id={block.id}>
      <button aria-label="Copy code" onClick={() => void copyCode()} type="button">
        {copied ? <IconCheck aria-hidden="true" size={14} /> : <IconCopy aria-hidden="true" size={14} />}
      </button>
      <pre>
        <code className={block.language ? `language-${block.language}` : undefined}>{block.content}</code>
      </pre>
    </div>
  );
}

function ManageMarkdownTable({
  annotations,
  block,
}: {
  annotations: ManageAnnotation[];
  block: ManageMarkdownBlock;
}) {
  const { headers, rows } = parseManageMarkdownTableContent(block.content);
  return (
    <div className="manage-md-table-wrap" data-block-id={block.id}>
      <table>
        <thead>
          <tr>
            {headers.map((header, index) => (
              <th key={index}>{renderManageInlineMarkdown(header, annotations)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{renderManageInlineMarkdown(cell, annotations)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ManageMarkdownHtmlBlock({ block }: { block: ManageMarkdownBlock }) {
  const sanitized = useMemo(() => sanitizeManageBlockHtml(block.content), [block.content]);
  return (
    <div
      className="manage-md-html-block"
      data-block-id={block.id}
      data-block-type="html"
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
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

  if (parsed.ok === false) {
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
            viewBackgroundColor: MANAGE_EXCALIDRAW_CANVAS_BACKGROUND,
            ...data.appState,
            theme: MANAGE_EXCALIDRAW_CANVAS_THEME,
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
        theme={MANAGE_EXCALIDRAW_CANVAS_THEME}
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

function createUniqueArtifactPath(entries: ManageFileEntry[], kind: ManageArtifactKind): string {
  const occupiedPaths = new Set(entries.map((entry) => entry.path.toLocaleLowerCase()));
  const { extension, stem } = artifactNameParts(kind);
  for (let index = 1; index < 10_000; index += 1) {
    const suffix = index === 1 ? "" : `-${index}`;
    const path = `${MANAGE_ARTIFACT_ROOT_PATH}/${stem}${suffix}.${extension}`;
    if (!occupiedPaths.has(path.toLocaleLowerCase())) {
      return path;
    }
  }
  return `${MANAGE_ARTIFACT_ROOT_PATH}/${stem}-${Date.now()}.${extension}`;
}

function artifactNameParts(kind: ManageArtifactKind): { extension: string; stem: string } {
  switch (kind) {
    case "excalidraw":
      return { extension: "excalidraw", stem: "drawing" };
    case "html":
      return { extension: "html", stem: "page" };
    case "markdown":
      return { extension: "md", stem: "note" };
  }
}

function createInitialArtifactContent(kind: ManageArtifactKind): string {
  switch (kind) {
    case "excalidraw":
      return `${JSON.stringify(createEmptyExcalidrawFile(), null, 2)}\n`;
    case "html":
      return [
        "<!doctype html>",
        '<html lang="en">',
        "<head>",
        '  <meta charset="utf-8">',
        "  <title>Untitled</title>",
        "</head>",
        "<body>",
        "  <main>",
        "    <h1>Untitled</h1>",
        "  </main>",
        "</body>",
        "</html>",
        "",
      ].join("\n");
    case "markdown":
      return "# Untitled\n\n";
  }
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
  if (isMarkdownPath(path)) {
    return IconMarkdown;
  }
  if (isHtmlPath(path)) {
    return IconFileTypeHtml;
  }
  if (isExcalidrawPath(path)) {
    return IconEdit;
  }
  return IconFile;
}

function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown|mdown|mkdn)$/iu.test(path);
}

function isExcalidrawPath(path: string): boolean {
  return /\.excalidraw$/iu.test(path);
}

function isHtmlPath(path: string): boolean {
  return /\.html?$/iu.test(path);
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

function selectionAnchorFromRange(range: Range): ManageSelectionAnchor | undefined {
  const visibleRect = Array.from(range.getClientRects()).find((rect) => rect.width > 0 && rect.height > 0);
  return selectionAnchorFromRect(visibleRect ?? range.getBoundingClientRect());
}

function selectionBelongsToElement(selection: Selection, element: HTMLElement): boolean {
  const anchorNode = selection.anchorNode;
  const focusNode = selection.focusNode;
  return Boolean(
    anchorNode &&
      focusNode &&
      element.contains(anchorNode.nodeType === Node.ELEMENT_NODE ? anchorNode : anchorNode.parentElement) &&
      element.contains(focusNode.nodeType === Node.ELEMENT_NODE ? focusNode : focusNode.parentElement),
  );
}

function defaultManageSelectionAnchor(): ManageSelectionAnchor {
  return {
    left: Math.min(Math.max(window.innerWidth / 2, 12), window.innerWidth - 12),
    top: Math.min(Math.max(72, 12), window.innerHeight - 12),
  };
}

function applyManageMeoTheme(): void {
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty(
    "--vscode-editor-font-family",
    'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  );
  rootStyle.setProperty("--vscode-editor-font-size", "14px");
  rootStyle.setProperty("--vscode-editor-font-weight", "450");
  rootStyle.setProperty("--vscode-editor-background", "#101112");
  rootStyle.setProperty("--vscode-editor-foreground", "#e5e7eb");
  rootStyle.setProperty("--vscode-sideBar-background", "#17191c");
  rootStyle.setProperty("--vscode-panel-border", "rgba(255, 255, 255, 0.10)");
  rootStyle.setProperty("--vscode-editor-selectionBackground", "rgba(125, 211, 252, 0.28)");
  rootStyle.setProperty("--vscode-editorWidget-background", "#17191c");
  applyMeoThemeSettings(MANAGE_MEO_THEME);
}

function createManageMeoAnnotationDecorations(
  text: string,
  annotations: readonly ManageAnnotation[],
): ManageMeoAnnotationDecoration[] {
  const decorations: ManageMeoAnnotationDecoration[] = [];
  for (const annotation of annotations) {
    if (annotation.scope !== "selection") {
      continue;
    }
    const quote = normalizeAnnotationQuote(annotation.quote);
    if (!quote) {
      continue;
    }
    let fromIndex = 0;
    while (fromIndex < text.length) {
      const matchIndex = text.indexOf(quote, fromIndex);
      if (matchIndex < 0) {
        break;
      }
      decorations.push({
        from: matchIndex,
        to: matchIndex + quote.length,
        type: annotation.type,
      });
      fromIndex = matchIndex + quote.length;
    }
  }
  return decorations;
}

function buildManageMeoAnnotationDecorations(decorations: readonly ManageMeoAnnotationDecoration[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const orderedDecorations = decorations
    .filter((decoration) => decoration.from >= 0 && decoration.to > decoration.from)
    .sort((left, right) => left.from - right.from || left.to - right.to);
  for (const decoration of orderedDecorations) {
    builder.add(decoration.from, decoration.to, decoration.type === "redline" ? manageMeoRedlineMark : manageMeoCommentMark);
  }
  return builder.finish();
}

function normalizeManageMeoSelection(
  state: ManageMeoSelectionState | undefined,
  editor: ManageMeoEditor | null,
): ManageCapturedSelection | undefined {
  if (!state?.visible || !editor || typeof state.from !== "number" || typeof state.to !== "number") {
    return undefined;
  }
  const documentLength = editor.view.state.doc.length;
  const from = Math.max(0, Math.min(Math.floor(state.from), documentLength));
  const to = Math.max(from, Math.min(Math.floor(state.to), documentLength));
  const text = editor.view.state.doc.sliceString(from, to);
  if (!normalizeAnnotationQuote(text)) {
    return undefined;
  }
  const left = Math.min(Math.max(state.anchorX ?? window.innerWidth / 2, 12), window.innerWidth - 12);
  const top = Math.min(Math.max(state.anchorY ?? state.anchorBottomY ?? 72, 12), window.innerHeight - 12);
  return {
    anchor: { left, top },
    text,
  };
}

function commentPopoverStyle(anchor: ManageSelectionAnchor): CSSProperties {
  const width = Math.min(360, Math.max(280, window.innerWidth - 24));
  const left = Math.min(Math.max(anchor.left - width / 2, 12), window.innerWidth - width - 12);
  const maxTop = Math.max(12, window.innerHeight - 260);
  const top = Math.min(Math.max(anchor.top + 12, 12), maxTop);
  return {
    left,
    top,
    width,
  };
}

function readStoredManageSidebarSide(): ManageSidebarSide {
  return window.localStorage.getItem(MANAGE_SIDEBAR_SIDE_STORAGE_KEY) === "right" ? "right" : "left";
}

function readStoredManageSidebarWidth(): number {
  const parsedWidth = Number(window.localStorage.getItem(MANAGE_SIDEBAR_WIDTH_STORAGE_KEY));
  return clampManageSidebarWidth(
    Number.isFinite(parsedWidth) && parsedWidth > 0 ? parsedWidth : MANAGE_SIDEBAR_DEFAULT_WIDTH,
    window.innerWidth,
  );
}

function clampManageSidebarWidth(width: number, containerWidth: number): number {
  const maxForContainer = Math.max(
    MANAGE_SIDEBAR_MIN_WIDTH,
    Math.min(MANAGE_SIDEBAR_MAX_WIDTH, Math.floor(containerWidth * 0.46)),
  );
  return Math.min(Math.max(Math.round(width), MANAGE_SIDEBAR_MIN_WIDTH), maxForContainer);
}

const MANAGE_MARKDOWN_HTML_BLOCK_TAGS = new Set([
  "article",
  "aside",
  "blockquote",
  "details",
  "div",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "ul",
]);

function parseManageMarkdownToBlocks(markdown: string): ManageMarkdownBlock[] {
  const body = extractManageMarkdownBody(markdown);
  const lines = body.split("\n");
  const blocks: ManageMarkdownBlock[] = [];
  let index = 0;
  let order = 0;

  const pushBlock = (
    type: ManageMarkdownBlock["type"],
    content: string,
    startLine: number,
    extra: Partial<ManageMarkdownBlock> = {},
  ) => {
    blocks.push({
      content,
      id: `manage-md-block-${order}-${startLine}`,
      order,
      startLine,
      type,
      ...extra,
    });
    order += 1;
  };

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const startLine = index + 1;
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/u);
    if (heading) {
      pushBlock("heading", heading[2] ?? "", startLine, { level: heading[1]?.length ?? 1 });
      index += 1;
      continue;
    }

    if (/^\s{0,3}(?:([-*_])(?:\s*\1){2,})\s*$/u.test(line)) {
      pushBlock("hr", "", startLine);
      index += 1;
      continue;
    }

    const directive = line.match(/^\s*:::\s*([A-Za-z][\w-]*)\s*$/u);
    if (directive) {
      const contentLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*:::\s*$/u.test(lines[index] ?? "")) {
        contentLines.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      pushBlock("directive", contentLines.join("\n").trim(), startLine, {
        directiveKind: directive[1]?.toLocaleLowerCase(),
      });
      continue;
    }

    const fence = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/u);
    if (fence) {
      const marker = fence[1] ?? "```";
      const markerChar = marker[0] ?? "`";
      const markerLength = marker.length;
      const language = (fence[2] ?? "").trim().split(/\s+/u)[0] ?? "";
      const contentLines: string[] = [];
      index += 1;
      while (index < lines.length) {
        const close = (lines[index] ?? "").match(/^\s{0,3}(`{3,}|~{3,})\s*$/u);
        if (close && close[1]?.[0] === markerChar && close[1].length >= markerLength) {
          index += 1;
          break;
        }
        contentLines.push(lines[index] ?? "");
        index += 1;
      }
      pushBlock("code", contentLines.join("\n"), startLine, { language });
      continue;
    }

    if (/^\s{0,3}>\s?/u.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^\s{0,3}>\s?/u.test(lines[index] ?? "")) {
        quoteLines.push((lines[index] ?? "").replace(/^\s{0,3}>\s?/u, ""));
        index += 1;
      }
      const alert = quoteLines[0]?.trim().match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/iu);
      if (alert) {
        pushBlock("blockquote", quoteLines.slice(1).join("\n").trim(), startLine, {
          alertKind: alert[1]?.toLocaleLowerCase() as ManageMarkdownAlertKind,
        });
      } else {
        pushBlock("blockquote", quoteLines.join("\n").trim(), startLine);
      }
      continue;
    }

    if (isManageMarkdownTableStart(lines, index)) {
      const tableLines = [line, lines[index + 1] ?? ""];
      index += 2;
      while (index < lines.length && lineHasUnescapedPipe(lines[index] ?? "")) {
        tableLines.push(lines[index] ?? "");
        index += 1;
      }
      pushBlock("table", tableLines.join("\n"), startLine);
      continue;
    }

    const list = line.match(/^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?(.*)$/u);
    if (list) {
      const marker = list[2] ?? "-";
      const checkbox = list[3];
      const contentLines = [list[4] ?? ""];
      const indentLength = expandManageMarkdownIndent(list[1] ?? "").length;
      index += 1;
      while (index < lines.length) {
        const nextLine = lines[index] ?? "";
        if (!nextLine.trim() || isManageMarkdownBlockStart(lines, index)) {
          break;
        }
        if (expandManageMarkdownIndent(nextLine).length > indentLength) {
          contentLines.push(nextLine.trim());
          index += 1;
          continue;
        }
        break;
      }
      const orderedStartMatch = marker.match(/^(\d+)/u);
      pushBlock("list-item", contentLines.join("\n").trim(), startLine, {
        checked: checkbox ? /\[[xX]\]/u.test(checkbox) : undefined,
        level: Math.floor(indentLength / 2),
        ordered: Boolean(orderedStartMatch),
        orderedStart: orderedStartMatch ? Number(orderedStartMatch[1]) : undefined,
      });
      continue;
    }

    const htmlTag = line.match(/^\s{0,3}<([A-Za-z][\w-]*)(?:\s|>|\/>)/u)?.[1]?.toLocaleLowerCase();
    if (htmlTag && MANAGE_MARKDOWN_HTML_BLOCK_TAGS.has(htmlTag)) {
      const htmlLines = [line];
      index += 1;
      if (!line.includes(`</${htmlTag}>`) && !/\/>\s*$/u.test(line)) {
        while (index < lines.length) {
          const nextLine = lines[index] ?? "";
          if (!nextLine.trim()) {
            break;
          }
          htmlLines.push(nextLine);
          index += 1;
          if (nextLine.includes(`</${htmlTag}>`)) {
            break;
          }
        }
      }
      pushBlock("html", htmlLines.join("\n"), startLine);
      continue;
    }

    const paragraphLines = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index]?.trim() && !isManageMarkdownBlockStart(lines, index)) {
      paragraphLines.push((lines[index] ?? "").trim());
      index += 1;
    }
    pushBlock("paragraph", paragraphLines.join(" "), startLine);
  }

  return blocks;
}

function extractManageMarkdownBody(markdown: string): string {
  const normalized = markdown.replace(/\r\n?/gu, "\n");
  const frontmatter = normalized.match(/^---[ \t]*\n[\s\S]*?\n---[ \t]*(?:\n|$)/u);
  return frontmatter ? normalized.slice(frontmatter[0].length) : normalized;
}

function isManageMarkdownBlockStart(lines: string[], index: number): boolean {
  const line = lines[index] ?? "";
  if (!line.trim()) {
    return false;
  }
  return (
    /^(#{1,6})\s+/u.test(line) ||
    /^\s{0,3}(?:([-*_])(?:\s*\1){2,})\s*$/u.test(line) ||
    /^\s*:::\s*([A-Za-z][\w-]*)\s*$/u.test(line) ||
    /^\s{0,3}(`{3,}|~{3,})/u.test(line) ||
    /^\s{0,3}>\s?/u.test(line) ||
    /^(\s*)([-*+]|\d+[.)])\s+/u.test(line) ||
    isManageMarkdownTableStart(lines, index) ||
    Boolean(line.match(/^\s{0,3}<([A-Za-z][\w-]*)(?:\s|>|\/>)/u)?.[1])
  );
}

function isManageMarkdownTableStart(lines: string[], index: number): boolean {
  const line = lines[index] ?? "";
  const divider = lines[index + 1] ?? "";
  return lineHasUnescapedPipe(line) && isManageMarkdownTableDivider(divider);
}

function isManageMarkdownTableDivider(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/u.test(line);
}

function lineHasUnescapedPipe(line: string): boolean {
  return /(^|[^\\])\|/u.test(line);
}

function expandManageMarkdownIndent(value: string): string {
  return value.replace(/\t/gu, "    ");
}

function computeManageOrderedListIndices(blocks: ManageMarkdownBlock[]): Map<string, number> {
  const indices = new Map<string, number>();
  const counters = new Map<number, number>();
  for (const block of blocks) {
    if (block.type !== "list-item") {
      counters.clear();
      continue;
    }
    const level = block.level ?? 0;
    for (const counterLevel of Array.from(counters.keys())) {
      if (counterLevel > level) {
        counters.delete(counterLevel);
      }
    }
    if (!block.ordered) {
      counters.delete(level);
      continue;
    }
    const nextIndex = counters.has(level) ? (counters.get(level) ?? 0) + 1 : block.orderedStart ?? 1;
    counters.set(level, nextIndex);
    indices.set(block.id, nextIndex);
  }
  return indices;
}

function parseManageMarkdownTableContent(content: string): { headers: string[]; rows: string[][] } {
  const lines = content.split("\n").filter((line) => line.trim());
  const parseRow = (line: string): string[] =>
    line
      .replace(/^\s*\|/u, "")
      .replace(/\|\s*$/u, "")
      .split(/(?<!\\)\|/u)
      .map((cell) => cell.trim().replace(/\\\|/gu, "|"));
  const headers = lines[0] ? parseRow(lines[0]) : [];
  const rows = lines.slice(2).map(parseRow);
  return { headers, rows };
}

function renderManageInlineMarkdown(text: string, annotations: ManageAnnotation[]): ReactNode {
  return renderManageAnnotatedInline(
    text,
    annotations.filter((annotation) => annotation.scope === "selection" && Boolean(annotation.quote)),
  );
}

function renderManageAnnotatedInline(text: string, annotations: ManageAnnotation[]): ReactNode {
  const annotation = annotations.find((candidate) => text.includes(candidate.quote));
  if (!annotation) {
    return renderManageInlineTokens(text);
  }
  const index = text.indexOf(annotation.quote);
  const before = text.slice(0, index);
  const match = text.slice(index, index + annotation.quote.length);
  const after = text.slice(index + annotation.quote.length);
  const remaining = annotations.filter((candidate) => candidate.id !== annotation.id);
  return (
    <>
      {renderManageAnnotatedInline(before, remaining)}
      <mark
        className={`annotation-highlight manage-annotation-highlight ${annotation.type === "redline" ? "deletion" : "comment"}`}
        data-type={annotation.type}
      >
        {renderManageInlineTokens(match)}
      </mark>
      {renderManageAnnotatedInline(after, remaining)}
    </>
  );
}

function renderManageInlineTokens(text: string): ReactNode {
  const nodes: ReactNode[] = [];
  let index = 0;
  while (index < text.length) {
    if (text.startsWith("`", index)) {
      const end = text.indexOf("`", index + 1);
      if (end > index) {
        nodes.push(
          <code className="manage-md-inline-code" key={`code-${index}`}>
            {text.slice(index + 1, end)}
          </code>,
        );
        index = end + 1;
        continue;
      }
    }
    if (text.startsWith("![", index)) {
      const image = parseManageMarkdownImageToken(text, index);
      if (image) {
        nodes.push(image.node);
        index = image.nextIndex;
        continue;
      }
    }
    if (text.startsWith("[", index)) {
      const link = parseManageMarkdownLinkToken(text, index);
      if (link) {
        nodes.push(link.node);
        index = link.nextIndex;
        continue;
      }
    }
    const strongMarker = text.startsWith("**", index) ? "**" : text.startsWith("__", index) ? "__" : "";
    if (strongMarker) {
      const end = text.indexOf(strongMarker, index + 2);
      if (end > index + 2) {
        nodes.push(<strong key={`strong-${index}`}>{renderManageInlineTokens(text.slice(index + 2, end))}</strong>);
        index = end + 2;
        continue;
      }
    }
    if (text.startsWith("~~", index)) {
      const end = text.indexOf("~~", index + 2);
      if (end > index + 2) {
        nodes.push(<del key={`del-${index}`}>{renderManageInlineTokens(text.slice(index + 2, end))}</del>);
        index = end + 2;
        continue;
      }
    }
    const emphasisMarker = text[index] === "*" || text[index] === "_" ? text[index] : "";
    if (emphasisMarker && !text.startsWith(`${emphasisMarker}${emphasisMarker}`, index)) {
      const end = text.indexOf(emphasisMarker, index + 1);
      if (end > index + 1) {
        nodes.push(<em key={`em-${index}`}>{renderManageInlineTokens(text.slice(index + 1, end))}</em>);
        index = end + 1;
        continue;
      }
    }

    const nextSpecial = findNextManageInlineSpecial(text, index + 1);
    nodes.push(...renderManagePlainInlineText(text.slice(index, nextSpecial), `text-${index}`));
    index = nextSpecial;
  }
  return nodes;
}

function parseManageMarkdownLinkToken(text: string, index: number): { nextIndex: number; node: ReactNode } | undefined {
  const labelEnd = text.indexOf("]", index + 1);
  if (labelEnd <= index + 1 || text[labelEnd + 1] !== "(") {
    return undefined;
  }
  const hrefEnd = text.indexOf(")", labelEnd + 2);
  if (hrefEnd <= labelEnd + 2) {
    return undefined;
  }
  const href = sanitizeManageHref(text.slice(labelEnd + 2, hrefEnd).trim());
  const label = text.slice(index + 1, labelEnd);
  if (!href) {
    return {
      nextIndex: hrefEnd + 1,
      node: <span key={`link-${index}`}>{renderManageInlineTokens(label)}</span>,
    };
  }
  return {
    nextIndex: hrefEnd + 1,
    node: (
      <a href={href} key={`link-${index}`} rel="noreferrer" target={href.startsWith("#") ? undefined : "_blank"}>
        {renderManageInlineTokens(label)}
      </a>
    ),
  };
}

function parseManageMarkdownImageToken(text: string, index: number): { nextIndex: number; node: ReactNode } | undefined {
  const altEnd = text.indexOf("]", index + 2);
  if (altEnd <= index + 2 || text[altEnd + 1] !== "(") {
    return undefined;
  }
  const srcEnd = text.indexOf(")", altEnd + 2);
  if (srcEnd <= altEnd + 2) {
    return undefined;
  }
  const alt = text.slice(index + 2, altEnd);
  const src = sanitizeManageImageSrc(text.slice(altEnd + 2, srcEnd).trim());
  return {
    nextIndex: srcEnd + 1,
    node: src ? <img alt={alt} className="manage-md-inline-image" key={`image-${index}`} src={src} /> : alt,
  };
}

function renderManagePlainInlineText(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const urlPattern = /(https?:\/\/[^\s<)]+)/giu;
  let lastIndex = 0;
  for (const match of text.matchAll(urlPattern)) {
    const url = match[0];
    const index = match.index ?? 0;
    if (index > lastIndex) {
      nodes.push(text.slice(lastIndex, index));
    }
    nodes.push(
      <a href={url} key={`${keyPrefix}-url-${index}`} rel="noreferrer" target="_blank">
        {url}
      </a>,
    );
    lastIndex = index + url.length;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

function findNextManageInlineSpecial(text: string, start: number): number {
  const candidates = ["`", "![", "[", "**", "__", "~~", "*", "_"]
    .map((marker) => text.indexOf(marker, start))
    .filter((candidate) => candidate >= 0);
  return candidates.length > 0 ? Math.min(...candidates) : text.length;
}

function sanitizeManageHref(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || /^(?:javascript|data|vbscript|file):/iu.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function sanitizeManageImageSrc(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || /^(?:javascript|vbscript|file):/iu.test(trimmed)) {
    return undefined;
  }
  if (/^data:/iu.test(trimmed) && !/^data:image\//iu.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function sanitizeManageBlockHtml(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("script, style, iframe, object, embed, link, meta").forEach((element) => {
    element.remove();
  });
  template.content.querySelectorAll("*").forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLocaleLowerCase();
      if (name.startsWith("on") || name === "style") {
        element.removeAttribute(attribute.name);
        continue;
      }
      if ((name === "href" || name === "src") && !sanitizeManageHref(attribute.value)) {
        element.removeAttribute(attribute.name);
      }
    }
    if (element instanceof HTMLAnchorElement && element.href && !element.href.startsWith("#")) {
      element.target = "_blank";
      element.rel = "noreferrer";
    }
  });
  return template.innerHTML;
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
      theme: MANAGE_EXCALIDRAW_CANVAS_THEME,
      viewBackgroundColor: MANAGE_EXCALIDRAW_CANVAS_BACKGROUND,
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
    grid-template-columns: var(--manage-sidebar-width, 292px) 7px minmax(0, 1fr);
    height: 100%;
    min-height: 0;
    position: relative;
    width: 100%;
  }

  .manage-shell[data-sidebar-side="right"] {
    grid-template-columns: minmax(0, 1fr) 7px var(--manage-sidebar-width, 292px);
  }

  .manage-shell[data-sidebar-hidden="true"] {
    grid-template-columns: minmax(0, 1fr);
  }

  .manage-shell[data-sidebar-hidden="true"] .manage-preview {
    grid-column: 1;
    grid-row: 1;
  }

  .manage-sidebar {
    background: var(--manage-panel);
    display: flex;
    flex-direction: column;
    grid-column: 1;
    grid-row: 1;
    min-height: 0;
    min-width: 0;
  }

  .manage-shell[data-sidebar-side="right"] .manage-sidebar {
    grid-column: 3;
    grid-row: 1;
  }

  .manage-sidebar-resizer {
    background: var(--manage-panel);
    cursor: ew-resize;
    grid-column: 2;
    grid-row: 1;
    min-width: 7px;
    outline: none;
    position: relative;
    touch-action: none;
  }

  .manage-sidebar-resizer::before {
    background: var(--manage-border-strong);
    content: "";
    inset: 0 3px;
    position: absolute;
  }

  .manage-sidebar-resizer:hover::before,
  .manage-sidebar-resizer:focus-visible::before {
    background: rgba(125, 211, 252, 0.7);
  }

  .manage-preview {
    grid-column: 3;
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

  .manage-artifact-create {
    border-bottom: 1px solid var(--manage-border);
    display: grid;
    gap: 6px;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    padding: 8px 10px;
  }

  .manage-artifact-create-button {
    align-items: center;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--manage-border);
    color: rgba(248, 250, 252, 0.78);
    display: inline-flex;
    font-size: 11px;
    font-weight: 720;
    gap: 5px;
    height: 30px;
    justify-content: center;
    min-width: 0;
    overflow: hidden;
    padding: 0 7px;
    white-space: nowrap;
  }

  .manage-artifact-create-button:hover,
  .manage-artifact-create-button:focus-visible {
    background: rgba(125, 211, 252, 0.1);
    border-color: rgba(125, 211, 252, 0.38);
    color: var(--manage-text);
    outline: none;
  }

  .manage-artifact-create-button:disabled {
    color: var(--manage-subtle);
    cursor: wait;
  }

  .manage-artifact-create-button span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
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

  .manage-preview-content[data-kind="markdown"] {
    grid-template-rows: auto minmax(0, 1fr);
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

  .manage-preview-header-actions {
    align-items: center;
    display: inline-flex;
    flex: 0 0 auto;
    gap: 6px;
    min-width: 0;
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

  .manage-markdown-review {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 288px;
    min-height: 0;
    overflow: hidden;
  }

  .manage-markdown-review[data-annotations-collapsed="true"] {
    grid-template-columns: minmax(0, 1fr);
  }

  .manage-markdown-meo-review {
    background: var(--manage-bg);
  }

  .manage-markdown-review-main {
    display: grid;
    grid-template-rows: minmax(0, 1fr);
    min-height: 0;
    overflow: hidden;
  }

  .manage-preview-header-actions button,
  .manage-comment-popover-actions button,
  .manage-markdown-selection-toolbar button {
    align-items: center;
    border-radius: 6px;
    display: inline-flex;
    font-size: 11px;
    font-weight: 750;
    gap: 5px;
    justify-content: center;
    min-width: 0;
  }

  .manage-preview-header-actions button,
  .manage-comment-popover-actions button {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--manage-border);
    color: var(--manage-muted);
    height: 28px;
    padding: 0 8px;
  }

  .manage-preview-header-actions button:not(:disabled):hover,
  .manage-preview-header-actions button:not(:disabled):focus-visible,
  .manage-comment-popover-actions button:not(:disabled):hover,
  .manage-comment-popover-actions button:not(:disabled):focus-visible {
    background: rgba(125, 211, 252, 0.12);
    border-color: rgba(125, 211, 252, 0.32);
    color: var(--manage-text);
    outline: none;
  }

  .manage-preview-header-actions button:disabled,
  .manage-comment-popover-actions button:disabled {
    color: var(--manage-subtle);
  }

  .manage-preview-header-actions .manage-annotation-rail-toggle {
    padding: 0 7px;
  }

  .manage-preview-header-actions .manage-count-badge {
    height: 16px;
    min-width: 16px;
    padding: 0 4px;
  }

  .manage-meo-markdown-editor {
    background: #101112;
    color: rgba(248, 250, 252, 0.9);
    min-height: 0;
    min-width: 0;
    overflow: hidden;
  }

  .manage-meo-markdown-editor .editor-wrapper,
  .manage-meo-markdown-editor .editor-host,
  .manage-meo-markdown-editor .cm-editor {
    min-height: 0;
    min-width: 0;
  }

  .manage-meo-markdown-editor .cm-editor {
    background: #101112;
    height: 100%;
  }

  .manage-meo-markdown-editor .cm-scroller {
    scrollbar-color: rgba(148, 163, 184, 0.35) transparent;
  }

  .manage-markdown-document {
    color: rgba(248, 250, 252, 0.9);
    font-size: 15px;
    line-height: 1.625;
    min-height: 0;
    overflow: auto;
    padding: 24px 32px 48px;
  }

  .manage-markdown-document > :first-child {
    margin-top: 0;
  }

  .manage-markdown-document h1,
  .manage-markdown-document h2,
  .manage-markdown-document h3,
  .manage-markdown-document h4,
  .manage-markdown-document h5,
  .manage-markdown-document h6 {
    color: var(--manage-text);
    letter-spacing: 0;
    line-height: 1.22;
  }

  .manage-markdown-document h1 {
    font-size: 24px;
    font-weight: 750;
    margin: 24px 0 16px;
  }

  .manage-markdown-document h2 {
    color: rgba(248, 250, 252, 0.9);
    font-size: 20px;
    font-weight: 700;
    margin: 32px 0 12px;
  }

  .manage-markdown-document h3 {
    color: rgba(248, 250, 252, 0.82);
    font-size: 16px;
    font-weight: 700;
    margin: 24px 0 8px;
  }

  .manage-markdown-document h4,
  .manage-markdown-document h5,
  .manage-markdown-document h6 {
    font-size: 15px;
    font-weight: 700;
    margin: 18px 0 8px;
  }

  .manage-markdown-document p {
    margin: 0 0 16px;
  }

  .manage-markdown-document a {
    color: var(--manage-accent);
    text-decoration: none;
  }

  .manage-markdown-document a:hover,
  .manage-markdown-document a:focus-visible {
    text-decoration: underline;
  }

  .manage-markdown-document blockquote {
    border-left: 2px solid rgba(125, 211, 252, 0.48);
    color: var(--manage-muted);
    font-style: italic;
    margin: 16px 0;
    padding-left: 16px;
  }

  .manage-markdown-document blockquote p:last-child,
  .manage-md-alert p:last-child,
  .manage-md-directive p:last-child {
    margin-bottom: 0;
  }

  .manage-md-empty {
    color: var(--manage-subtle);
  }

  .manage-md-inline-code {
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    color: rgba(248, 250, 252, 0.92);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 0.9em;
    padding: 1px 4px;
  }

  .manage-md-inline-image {
    border: 1px solid var(--manage-border);
    display: block;
    margin: 12px 0;
    max-width: 100%;
  }

  .manage-md-list-item {
    align-items: flex-start;
    display: flex;
    gap: 12px;
    margin: 6px 0 6px calc(var(--manage-md-list-level, 0) * 20px);
  }

  .manage-md-list-marker {
    color: var(--manage-muted);
    flex: 0 0 22px;
    font-size: 13px;
    line-height: 1.625;
    text-align: right;
  }

  .manage-md-list-marker input {
    height: 13px;
    margin: 4px 0 0;
    width: 13px;
  }

  .manage-md-list-text {
    color: rgba(248, 250, 252, 0.9);
    min-width: 0;
  }

  .manage-md-list-text.is-checked {
    color: var(--manage-muted);
    text-decoration: line-through;
  }

  .manage-md-code-block {
    margin: 20px 0;
    position: relative;
  }

  .manage-md-code-block button {
    align-items: center;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid var(--manage-border);
    color: var(--manage-muted);
    display: inline-flex;
    height: 28px;
    justify-content: center;
    opacity: 0;
    padding: 0;
    position: absolute;
    right: 8px;
    top: 8px;
    transition: opacity 120ms ease;
    width: 28px;
  }

  .manage-md-code-block:hover button,
  .manage-md-code-block button:focus-visible {
    opacity: 1;
  }

  .manage-md-code-block pre {
    background: rgba(255, 255, 255, 0.045);
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 8px;
    color: rgba(248, 250, 252, 0.88);
    font-size: 13px;
    line-height: 1.6;
    margin: 0;
    overflow-x: auto;
    padding: 16px;
  }

  .manage-md-code-block code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  }

  .manage-md-table-wrap {
    margin: 16px 0;
    overflow-x: auto;
  }

  .manage-md-table-wrap table {
    border-collapse: collapse;
    min-width: 100%;
  }

  .manage-md-table-wrap th,
  .manage-md-table-wrap td {
    border-bottom: 1px solid var(--manage-border);
    font-size: 14px;
    padding: 8px 12px;
    text-align: left;
    vertical-align: top;
  }

  .manage-md-table-wrap th {
    background: rgba(255, 255, 255, 0.045);
    color: rgba(248, 250, 252, 0.9);
    font-weight: 700;
  }

  .manage-md-table-wrap td {
    color: rgba(248, 250, 252, 0.8);
  }

  .manage-md-alert,
  .manage-md-directive {
    border: 1px solid rgba(125, 211, 252, 0.26);
    border-left: 3px solid rgba(125, 211, 252, 0.72);
    margin: 16px 0;
    padding: 12px 14px;
  }

  .manage-md-alert-title {
    color: var(--manage-accent);
    font-size: 11px;
    font-weight: 780;
    margin-bottom: 6px;
    text-transform: uppercase;
  }

  .manage-md-alert[data-kind="warning"],
  .manage-md-alert[data-kind="caution"] {
    border-color: rgba(253, 230, 138, 0.3);
    border-left-color: rgba(253, 230, 138, 0.72);
  }

  .manage-md-html-block {
    color: rgba(248, 250, 252, 0.9);
    font-size: 15px;
    line-height: 1.625;
    margin: 16px 0;
  }

  .annotation-highlight,
  .manage-annotation-highlight {
    background: rgba(253, 230, 138, 0.28);
    color: inherit;
    padding: 0 2px;
  }

  .annotation-highlight.comment,
  .manage-annotation-highlight[data-type="comment"] {
    background: rgba(125, 211, 252, 0.22);
  }

  .annotation-highlight.deletion,
  .manage-annotation-highlight[data-type="redline"] {
    background: rgba(253, 164, 175, 0.22);
    text-decoration: line-through;
    text-decoration-color: rgba(253, 164, 175, 0.8);
    text-decoration-thickness: 2px;
  }

  .manage-markdown-annotation-rail {
    background: var(--manage-panel);
    border-left: 1px solid var(--manage-border);
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 0;
    overflow: hidden;
  }

  .manage-markdown-annotation-rail header {
    align-items: center;
    border-bottom: 1px solid var(--manage-border);
    color: var(--manage-muted);
    display: flex;
    font-size: 12px;
    font-weight: 750;
    justify-content: space-between;
    min-height: 40px;
    padding: 0 12px;
  }

  .manage-markdown-annotation-list {
    align-content: start;
    display: grid;
    gap: 8px;
    grid-auto-rows: max-content;
    min-height: 0;
    overflow: auto;
    padding: 10px;
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

  .manage-annotation-empty {
    color: var(--manage-subtle);
    font-size: 12px;
    padding: 12px 2px;
  }

  .manage-annotation-card {
    align-self: start;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--manage-border);
    display: grid;
    gap: 7px;
    height: max-content;
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

  .manage-markdown-selection-toolbar {
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

  .manage-markdown-selection-toolbar button {
    background: transparent;
    border: 0;
    color: var(--manage-muted);
    height: 28px;
    padding: 0 7px;
    white-space: nowrap;
  }

  .manage-markdown-selection-toolbar button:hover,
  .manage-markdown-selection-toolbar button:focus-visible {
    background: rgba(255, 255, 255, 0.07);
    color: var(--manage-text);
    outline: none;
  }

  .manage-comment-popover {
    background: var(--manage-panel-raised);
    border: 1px solid var(--manage-border-strong);
    box-shadow: 0 18px 52px rgba(0, 0, 0, 0.38);
    display: grid;
    gap: 8px;
    max-height: calc(100vh - 24px);
    overflow: auto;
    padding: 10px;
    position: fixed;
    z-index: 40;
  }

  .manage-comment-popover-quote {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--manage-border);
    color: var(--manage-muted);
    font-size: 11px;
    line-height: 1.35;
    max-height: 70px;
    min-height: 32px;
    overflow: auto;
    padding: 7px;
  }

  .manage-comment-popover-quote[data-empty="true"] {
    border-style: dashed;
  }

  .manage-comment-popover textarea {
    background: rgba(255, 255, 255, 0.045);
    border: 1px solid var(--manage-border);
    color: var(--manage-text);
    font-size: 12px;
    height: 88px;
    line-height: 1.45;
    outline: 0;
    padding: 8px;
    resize: vertical;
  }

  .manage-comment-popover textarea:focus {
    border-color: rgba(125, 211, 252, 0.52);
  }

  .manage-comment-popover-actions {
    display: grid;
    gap: 6px;
    grid-template-columns: minmax(0, 0.8fr) minmax(0, 0.8fr) minmax(0, 1fr);
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

    .manage-preview-meta {
      align-self: stretch;
    }

    .manage-preview-content[data-kind="markdown"] .manage-preview-header {
      align-items: center;
      flex-direction: row;
      gap: 8px;
      min-height: 48px;
      padding: 0 10px 0 14px;
    }

    .manage-preview-content[data-kind="markdown"] .manage-preview-meta {
      align-self: auto;
    }

    .manage-preview-content[data-kind="markdown"] .manage-preview-header-actions button span:not(.manage-count-badge) {
      display: none;
    }

    .manage-markdown-review {
      grid-template-columns: minmax(0, 1fr);
      position: relative;
    }

    .manage-markdown-annotation-rail {
      bottom: 12px;
      box-shadow: 0 18px 52px rgba(0, 0, 0, 0.34);
      position: absolute;
      right: 12px;
      top: 54px;
      width: min(288px, calc(100% - 24px));
      z-index: 3;
    }
  }

  @media (max-width: 760px) {
    .manage-shell {
      grid-template-columns: minmax(190px, 42%) minmax(0, 1fr);
    }

    .manage-preview-path,
    .manage-text-editor,
    .manage-markdown-document {
      padding-left: 14px;
      padding-right: 14px;
    }
  }
`;
document.head.append(styleElement);

createRoot(document.getElementById("root")!).render(<ManageApp />);
