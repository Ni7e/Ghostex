import {
  IconAlertTriangle,
  IconFile,
  IconFileText,
  IconFolder,
  IconFolderOpen,
  IconRefresh,
  IconSearch,
} from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";

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
  action: "list" | "read";
  path?: string;
  projectEditorId: string;
  projectId: string;
  requestId: string;
};

type ManageFilesBridgeResponse = {
  action: "list" | "read";
  entries?: ManageFileEntry[];
  error?: string;
  file?: ManageFilePreview;
  requestId: string;
  rootName?: string;
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

const MANAGE_FILES_RESPONSE_EVENT = "ghostex-manage-files-response";
const MANAGE_BRIDGE_TIMEOUT_MS = 15_000;

/*
 * CDXC:Manage 2026-06-20-04:36:
 * Manage is a bundled WKWebView project workarea beside Kanban. Keep the page read-only in this first version: browse project-relative files, select one file, and preview bounded UTF-8 text while native owns project-root scoping.
 *
 * CDXC:Manage 2026-06-20-04:36:
 * The WK page must not receive or construct an absolute workspace path. It sends only project/editor ids and relative file paths; Swift resolves requests from the owning project-editor session and rejects traversal, binary, oversize, or out-of-root reads.
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
  const [listState, setListState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [previewState, setPreviewState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string>();

  const readFile = useCallback(
    async (path: string) => {
      setSelectedPath(path);
      selectedPathRef.current = path;
      setPreview(undefined);
      setPreviewState("loading");
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
        setPreviewState("ready");
      } catch (readError) {
        setPreviewState("error");
        setError(readError instanceof Error ? readError.message : "Could not preview file.");
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

  return (
    <main className="manage-shell">
      <aside className="manage-sidebar">
        <div className="manage-sidebar-header">
          <div className="manage-project-title">
            <IconFolderOpen aria-hidden="true" size={17} stroke={1.8} />
            <span>{rootName}</span>
          </div>
          <button
            aria-label="Refresh files"
            className="manage-icon-button"
            disabled={listState === "loading"}
            onClick={() => void refreshFiles()}
            type="button"
          >
            <IconRefresh aria-hidden="true" size={15} stroke={1.8} />
          </button>
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
      <section className="manage-preview">
        <ManagePreview
          error={error}
          preview={preview}
          previewState={previewState}
          selectedPath={selectedPath}
        />
      </section>
    </main>
  );
}

function ManageFileRow({
  entry,
  isSelected,
  onSelect,
}: {
  entry: ManageFileEntry;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const Icon = entry.kind === "directory" ? IconFolder : IconFile;
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
      {entry.kind === "file" && entry.size !== undefined ? (
        <span className="manage-file-size">{formatFileSize(entry.size)}</span>
      ) : null}
    </button>
  );
}

function ManagePreview({
  error,
  preview,
  previewState,
  selectedPath,
}: {
  error?: string;
  preview?: ManageFilePreview;
  previewState: "idle" | "loading" | "ready" | "error";
  selectedPath?: string;
}) {
  if (previewState === "loading") {
    return <ManagePreviewMessage icon={<IconRefresh aria-hidden="true" size={20} />} title="Loading preview" />;
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
  return (
    <div className="manage-preview-content">
      <header className="manage-preview-header">
        <div className="manage-preview-title">
          <IconFileText aria-hidden="true" size={17} stroke={1.85} />
          <span>{preview.name}</span>
        </div>
        <div className="manage-preview-meta">
          <span>{language}</span>
          {preview.size !== undefined ? <span>{formatFileSize(preview.size)}</span> : null}
        </div>
      </header>
      <div className="manage-preview-path">{preview.path}</div>
      {preview.kind === "unsupported" ? (
        <ManagePreviewMessage
          icon={<IconAlertTriangle aria-hidden="true" size={21} />}
          title={preview.error ?? "Preview unavailable"}
        />
      ) : (
        <pre className="manage-preview-text">{preview.content}</pre>
      )}
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

const styleElement = document.createElement("style");
styleElement.textContent = `
  :root {
    color-scheme: dark;
    --manage-bg: #101112;
    --manage-panel: #17191b;
    --manage-panel-strong: #202326;
    --manage-border: rgba(255, 255, 255, 0.085);
    --manage-border-strong: rgba(255, 255, 255, 0.13);
    --manage-text: rgba(248, 250, 252, 0.92);
    --manage-muted: rgba(226, 232, 240, 0.58);
    --manage-subtle: rgba(226, 232, 240, 0.38);
    --manage-accent: #7dd3fc;
    --manage-accent-muted: rgba(125, 211, 252, 0.14);
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
  input {
    font: inherit;
  }

  .manage-shell {
    background: var(--manage-bg);
    display: grid;
    grid-template-columns: minmax(230px, 292px) minmax(0, 1fr);
    height: 100%;
    min-height: 0;
    width: 100%;
  }

  .manage-sidebar {
    background: var(--manage-panel);
    border-right: 1px solid var(--manage-border);
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
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
    gap: 12px;
    min-height: 48px;
    padding: 0 18px;
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

  .manage-preview-text {
    color: rgba(248, 250, 252, 0.86);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 12px;
    line-height: 1.55;
    margin: 0;
    min-height: 0;
    overflow: auto;
    padding: 16px 18px 28px;
    tab-size: 2;
    white-space: pre-wrap;
    word-break: break-word;
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

  @media (max-width: 760px) {
    .manage-shell {
      grid-template-columns: minmax(190px, 42%) minmax(0, 1fr);
    }

    .manage-preview-header {
      align-items: flex-start;
      flex-direction: column;
      gap: 4px;
      justify-content: center;
      padding: 8px 14px;
    }

    .manage-preview-path,
    .manage-preview-text {
      padding-left: 14px;
      padding-right: 14px;
    }
  }
`;
document.head.append(styleElement);

createRoot(document.getElementById("root")!).render(<ManageApp />);
