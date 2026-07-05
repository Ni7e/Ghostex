type GhostexEditorConfigureMessage = {
  type: "configure";
  initialText?: unknown;
  language?: unknown;
  filePath?: unknown;
  title?: unknown;
};

type GhostexEditorHostMessage =
  | { type: "ready" }
  | { type: "configured" }
  | { type: "draftUpdate"; text: string }
  | { type: "saveAndClose"; text: string }
  | { type: "save"; text: string }
  | { type: "cancel" }
  | {
      type: "pasteImage";
      requestId: string;
      base64Data: string;
      suggestedName: string;
    };

type ImagePasteResult = {
  type: "imagePasteResult";
  requestId: string;
  path?: string;
  error?: string;
};

type MonacoEditor = {
  addCommand(keybinding: number, handler: () => void): void;
  createContextKey<T>(key: string, defaultValue: T): { set(value: T): void };
  dispose(): void;
  executeEdits(
    source: string,
    edits: Array<{ range: unknown; text: string; forceMoveMarkers?: boolean }>,
  ): boolean;
  focus(): void;
  getModel(): MonacoModel | null;
  getSelection(): unknown;
  getValue(): string;
  onDidChangeModelContent(handler: () => void): { dispose(): void };
  pushUndoStop(): boolean;
  revealPositionInCenterIfOutsideViewport(position: unknown): void;
  setModel(model: MonacoModel | null): void;
  setPosition(position: unknown): void;
  updateOptions(options: Record<string, unknown>): void;
};

type MonacoModel = {
  dispose(): void;
  getLanguageId(): string;
  getValue(): string;
};

type MonacoApi = {
  KeyCode: {
    Enter: number;
    KeyG: number;
    KeyS: number;
    Escape: number;
  };
  KeyMod: {
    CmdCtrl: number;
    WinCtrl: number;
  };
  Uri: {
    file(path: string): unknown;
    parse(value: string): unknown;
  };
  editor: {
    create(element: HTMLElement, options: Record<string, unknown>): MonacoEditor;
    createModel(value: string, language?: string, uri?: unknown): MonacoModel;
    setModelLanguage(model: MonacoModel, language: string): void;
  };
};

type MonacoAmdRequire = {
  (dependencies: string[], callback: () => void, errorback?: (error: unknown) => void): void;
  config(options: Record<string, unknown>): void;
};

declare global {
  interface Window {
    MonacoEnvironment?: {
      getWorkerUrl(_workerId: string, _label: string): string;
    };
    ipc?: {
      postMessage(message: string): void;
    };
    webkit?: {
      messageHandlers?: {
        ghostexEditorHost?: {
          postMessage(message: GhostexEditorHostMessage): void;
        };
      };
    };
  }

  const monaco: MonacoApi;
  const require: MonacoAmdRequire;
}

const pendingImagePasteRequests = new Map<string, (result: ImagePasteResult) => void>();

let editorInstance: MonacoEditor | null = null;
let editorTitleElement: HTMLElement | null = null;
let draftUpdateTimer: ReturnType<typeof window.setTimeout> | null = null;
let pendingConfigureMessage: GhostexEditorConfigureMessage | null = null;

window.MonacoEnvironment = {
  getWorkerUrl() {
    return "./monaco/vs/base/worker/workerMain.js";
  },
};

require.config({
  paths: {
    vs: "./monaco/vs",
  },
});

window.addEventListener("ghostex-editor-host-message", (event) => {
  const detail = (event as CustomEvent<unknown>).detail;
  if (isConfigureMessage(detail)) {
    if (!applyConfigureMessage(detail)) {
      pendingConfigureMessage = detail;
    }
    return;
  }

  if (!isImagePasteResult(detail)) {
    return;
  }

  const resolve = pendingImagePasteRequests.get(detail.requestId);
  if (!resolve) {
    return;
  }
  pendingImagePasteRequests.delete(detail.requestId);
  resolve(detail);
});

require(
  ["vs/editor/editor.main"],
  () => {
    editorTitleElement = getRequiredElement("editor-title");
    getRequiredElement("editor-hint").textContent = editorShortcutHint();
    const editorElement = getRequiredElement("editor");
    const saveButton = getRequiredElement("save-button") as HTMLButtonElement;
    const cancelButton = getRequiredElement("cancel-button") as HTMLButtonElement;
    const model = createModelForConfig({
      filePath: "",
      initialText: "",
      language: "markdown",
      title: "Ghostex Editor",
    });

    editorTitleElement.textContent = "Ghostex Editor";

    editorInstance = monaco.editor.create(editorElement, {
      acceptSuggestionOnEnter: "off",
      automaticLayout: true,
      cursorBlinking: "smooth",
      fontFamily:
        "JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
      fontLigatures: true,
      fontSize: 14,
      lineNumbersMinChars: 3,
      minimap: {
        enabled: false,
      },
      model,
      occurrencesHighlight: "off",
      copyWithSyntaxHighlighting: false,
      padding: {
        bottom: 48,
        top: 12,
      },
      parameterHints: {
        enabled: false,
      },
      quickSuggestions: false,
      renderLineHighlight: "none",
      scrollBeyondLastLine: false,
      scrollbar: {
        horizontalScrollbarSize: 7,
        verticalScrollbarSize: 7,
      },
      selectionHighlight: false,
      snippetSuggestions: "none",
      suggestOnTriggerCharacters: false,
      tabCompletion: "off",
      theme: "vs-dark",
      wordBasedSuggestions: "off",
      wordWrap: "on",
    });

    editorInstance.onDidChangeModelContent(() => {
      scheduleDraftUpdate();
    });

    editorInstance.addCommand(monaco.KeyMod.CmdCtrl | monaco.KeyCode.Enter, () => {
      saveAndClose();
    });
    editorInstance.addCommand(monaco.KeyMod.CmdCtrl | monaco.KeyCode.KeyS, () => {
      saveAndClose();
    });
    editorInstance.addCommand(monaco.KeyMod.WinCtrl | monaco.KeyCode.KeyG, () => {
      saveAndClose();
    });
    editorInstance.addCommand(monaco.KeyCode.Escape, () => {
      cancel();
    });

    document.addEventListener("keydown", handleDocumentKeyDown, true);
    editorElement.addEventListener("paste", handlePaste, true);
    saveButton.addEventListener("click", () => {
      saveAndClose();
    });
    cancelButton.addEventListener("click", () => {
      cancel();
    });

    postToHost({ type: "ready" });
    if (pendingConfigureMessage) {
      const configureMessage = pendingConfigureMessage;
      pendingConfigureMessage = null;
      applyConfigureMessage(configureMessage);
    } else {
      editorInstance.focus();
    }
  },
  (error) => {
    console.error("Failed to load Monaco editor", error);
  },
);

function normalizeConfigureMessage(rawMessage: GhostexEditorConfigureMessage) {
  const filePath =
    typeof rawMessage.filePath === "string" && rawMessage.filePath.length > 0
      ? rawMessage.filePath
      : "";
  return {
    filePath,
    initialText: typeof rawMessage.initialText === "string" ? rawMessage.initialText : "",
    language:
      typeof rawMessage.language === "string" && rawMessage.language.length > 0
        ? rawMessage.language
        : null,
    title:
      typeof rawMessage.title === "string" && rawMessage.title.length > 0
        ? rawMessage.title
        : filePath || "Ghostex Editor",
  };
}

function createModelForConfig(config: ReturnType<typeof normalizeConfigureMessage>): MonacoModel {
  const language = config.language || undefined;
  const model = monaco.editor.createModel(config.initialText, language, uriForFilePath(config.filePath));
  if (config.language) {
    monaco.editor.setModelLanguage(model, config.language);
  } else if (model.getLanguageId() === "plaintext") {
    monaco.editor.setModelLanguage(model, "markdown");
  }
  return model;
}

function applyConfigureMessage(message: GhostexEditorConfigureMessage): boolean {
  if (!editorInstance || !editorTitleElement) {
    return false;
  }

  clearDraftUpdateTimer();

  const config = normalizeConfigureMessage(message);
  const previousModel = editorInstance.getModel();
  if (previousModel) {
    editorInstance.setModel(null);
    previousModel.dispose();
  }

  const model = createModelForConfig(config);
  editorInstance.setModel(model);
  editorInstance.updateOptions({
    wordWrap: model.getLanguageId() === "markdown" ? "on" : "off",
  });
  editorTitleElement.textContent = config.title;
  editorInstance.focus();
  postToHost({ type: "configured" });

  return true;
}

function editorShortcutHint(): string {
  const platform = navigator.platform || navigator.userAgent;
  return /mac/iu.test(platform)
    ? "- F1 for commands - ⌘S or ⌃G to Save"
    : "- F1 for commands - Ctrl+S or Ctrl+G to Save";
}

function getRequiredElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element #${id}`);
  }
  return element;
}

function uriForFilePath(filePath: string): unknown {
  if (filePath.length > 0) {
    return monaco.Uri.file(filePath);
  }
  return monaco.Uri.parse("inmemory://ghostex-editor/draft.md");
}

function getCurrentText(): string {
  return editorInstance?.getValue() ?? "";
}

function saveAndClose(): void {
  postToHost({ type: "saveAndClose", text: getCurrentText() });
}

function cancel(): void {
  postToHost({ type: "cancel" });
}

function handleDocumentKeyDown(event: KeyboardEvent): void {
  const key = event.key.toLowerCase();
  if ((event.metaKey || event.ctrlKey) && key === "s") {
    stopShortcutEvent(event);
    saveAndClose();
    return;
  }

  if (event.ctrlKey && key === "g") {
    stopShortcutEvent(event);
    saveAndClose();
    return;
  }

  if (
    event.key === "Escape" &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey
  ) {
    stopShortcutEvent(event);
    cancel();
  }
}

function stopShortcutEvent(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

function scheduleDraftUpdate(): void {
  if (draftUpdateTimer !== null) {
    window.clearTimeout(draftUpdateTimer);
  }
  draftUpdateTimer = window.setTimeout(() => {
    draftUpdateTimer = null;
    postToHost({ type: "draftUpdate", text: getCurrentText() });
  }, 300);
}

function clearDraftUpdateTimer(): void {
  if (draftUpdateTimer === null) {
    return;
  }
  window.clearTimeout(draftUpdateTimer);
  draftUpdateTimer = null;
}

function postToHost(message: GhostexEditorHostMessage): void {
  const webKitHost = window.webkit?.messageHandlers?.ghostexEditorHost;
  if (webKitHost) {
    webKitHost.postMessage(message);
    return;
  }

  window.ipc?.postMessage(JSON.stringify(message));
}

function handlePaste(event: ClipboardEvent): void {
  const imageItem = firstImageClipboardItem(event.clipboardData);
  if (!imageItem || !editorInstance) {
    return;
  }

  const imageFile = imageItem.getAsFile();
  if (!imageFile) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const requestId = createRequestId();
  const suggestedName = suggestedImageName(imageFile, requestId);

  readFileAsDataUrl(imageFile)
    .then((dataUrl) => {
      const base64Data = dataUrl.split(",", 2)[1] ?? "";
      return requestImagePaste(requestId, base64Data, suggestedName);
    })
    .then((result) => {
      if (result.path) {
        insertTextAtCursor(result.path);
      } else if (result.error) {
        console.error("Image paste failed", result.error);
      }
    })
    .catch((error) => {
      console.error("Image paste failed", error);
    });
}

function firstImageClipboardItem(dataTransfer: DataTransfer | null): DataTransferItem | null {
  if (!dataTransfer) {
    return null;
  }
  for (const item of dataTransfer.items) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      return item;
    }
  }
  return null;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Image data was not readable"));
      }
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("Image data read failed"));
    });
    reader.readAsDataURL(file);
  });
}

function requestImagePaste(
  requestId: string,
  base64Data: string,
  suggestedName: string,
): Promise<ImagePasteResult> {
  return new Promise((resolve) => {
    pendingImagePasteRequests.set(requestId, resolve);
    postToHost({
      type: "pasteImage",
      requestId,
      base64Data,
      suggestedName,
    });
  });
}

function insertTextAtCursor(text: string): void {
  if (!editorInstance) {
    return;
  }

  const selection = editorInstance.getSelection();
  if (!selection) {
    return;
  }

  editorInstance.pushUndoStop();
  editorInstance.executeEdits("ghostex-editor-image-paste", [
    {
      forceMoveMarkers: true,
      range: selection,
      text,
    },
  ]);
  const model = editorInstance.getModel();
  if (model) {
    const insertedPosition = positionAfterInsertedText(selection, text);
    editorInstance.setPosition(insertedPosition);
    editorInstance.revealPositionInCenterIfOutsideViewport(insertedPosition);
  }
  editorInstance.pushUndoStop();
  editorInstance.focus();
}

function positionAfterInsertedText(selection: unknown, text: string): unknown {
  const startLineNumber = readNumberProperty(selection, "startLineNumber", 1);
  const startColumn = readNumberProperty(selection, "startColumn", 1);
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length === 1) {
    return {
      column: startColumn + text.length,
      lineNumber: startLineNumber,
    };
  }
  return {
    column: lines[lines.length - 1].length + 1,
    lineNumber: startLineNumber + lines.length - 1,
  };
}

function readNumberProperty(value: unknown, key: string, fallback: number): number {
  if (!value || typeof value !== "object") {
    return fallback;
  }
  const record = value as Record<string, unknown>;
  return typeof record[key] === "number" ? record[key] : fallback;
}

function suggestedImageName(file: File, requestId: string): string {
  const extension = file.name.split(".").pop() || extensionForMimeType(file.type);
  return `pasted-image-${requestId}.${extension}`;
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType === "image/jpeg") {
    return "jpg";
  }
  if (mimeType === "image/gif") {
    return "gif";
  }
  if (mimeType === "image/webp") {
    return "webp";
  }
  return "png";
}

function createRequestId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function isConfigureMessage(value: unknown): value is GhostexEditorConfigureMessage {
  if (!value || typeof value !== "object") {
    return false;
  }
  return (value as Record<string, unknown>).type === "configure";
}

function isImagePasteResult(value: unknown): value is ImagePasteResult {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.type === "imagePasteResult" &&
    typeof record.requestId === "string" &&
    (record.path === undefined || typeof record.path === "string") &&
    (record.error === undefined || typeof record.error === "string")
  );
}

export {};
