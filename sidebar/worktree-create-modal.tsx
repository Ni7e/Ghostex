import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { IconFolderOpen, IconGitBranch, IconPhotoPlus } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trimPromptEditorTrailingSpaces } from "../shared/prompt-editor-text";
import {
  createSidebarAgentSelectItems,
  type SidebarAgentButton,
} from "../shared/sidebar-agents";
import { postAppModalHostMessage } from "./app-modal-host-bridge";

export type ExistingWorktreeOption = {
  branch: string;
  isCurrentProject?: boolean;
  isRegistered?: boolean;
  name: string;
  path: string;
};

export type WorktreeCreateModalDraft =
  | { agentId: string; mode: "create"; prompt: string }
  | { existingWorktreePath: string; mode: "openExisting" };

export type WorktreeCreateModalProps = {
  agents: SidebarAgentButton[];
  defaultAgentId?: string;
  isOpen: boolean;
  onCancel: () => void;
  onConfirm: (draft: WorktreeCreateModalDraft) => void;
  onRequestExistingWorktrees?: (requestId: string) => void;
  projectName?: string;
};

type WorktreeCreateMode = WorktreeCreateModalDraft["mode"];

type ProjectWorktreesResultMessage = {
  error?: unknown;
  ok: boolean;
  requestId: string;
  type: "projectWorktreesResult";
  worktrees?: unknown;
};

export function WorktreeCreateModal({
  agents,
  defaultAgentId,
  isOpen,
  onCancel,
  onConfirm,
  onRequestExistingWorktrees,
  projectName,
}: WorktreeCreateModalProps) {
  const promptId = useId();
  const agentId = useId();
  const existingWorktreeId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const userInteractedAfterOpenRef = useRef(false);
  const worktreeListRequestIdRef = useRef<string | undefined>(undefined);
  const commandAgents = useMemo(
    () => agents.filter((agent) => agent.command?.trim()),
    [agents],
  );
  const agentSelectItems = useMemo(
    () => createSidebarAgentSelectItems(commandAgents),
    [commandAgents],
  );
  const [prompt, setPrompt] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState(commandAgents[0]?.agentId ?? "");
  const [mode, setMode] = useState<WorktreeCreateMode>("create");
  const [existingWorktrees, setExistingWorktrees] = useState<ExistingWorktreeOption[]>([]);
  const [selectedExistingWorktreePath, setSelectedExistingWorktreePath] = useState("");
  const [worktreeListError, setWorktreeListError] = useState<string | undefined>(undefined);
  const [isLoadingWorktrees, setIsLoadingWorktrees] = useState(false);
  const [imageCount, setImageCount] = useState(0);

  /**
   * CDXC:Worktrees 2026-05-18-23:07:
   * New worktrees need an agent plus a first prompt. Image paste and native file picking insert Markdown links into that prompt so visual context travels with the first agent instruction.
   *
   * CDXC:PromptAgents 2026-05-28-07:15:
   * The first selectable worktree agent should start from Settings' default
   * prompt agent when that agent is visible and configured, while preserving
   * any valid in-modal selection during the current modal session.
   *
   * CDXC:Worktrees 2026-05-28-07:47:
   * The first prompt is prompt-editor text. Plain-text paste and submit should
   * remove spaces at line ends before the prompt is sent to the selected agent,
   * while image paste keeps inserting durable Markdown links.
   *
   * CDXC:AppModals 2026-05-29-19:44:
   * Session attention/activity can refresh app-modal props while a user is
   * typing. The Add Worktree draft is initialized only when the modal opens;
   * later agent-list updates may repair an invalid selection but must not clear
   * the prompt, images, or a still-valid selected agent.
   *
   * CDXC:WorktreeProjectRegistration 2026-06-01-20:59:
   * Add Worktree supports creating a fresh checkout or opening an existing Git
   * worktree from the same machine. The existing-worktree list is requested when
   * the modal opens and submit carries the selected path so native registers and
   * opens it through gxserver.
   *
   * CDXC:WorktreeProjectRegistration 2026-06-01-21:33:
   * Open Existing is a project-open flow, not an agent-start flow. In that mode
   * the modal only shows the worktree picker and primary Open Worktree action;
   * hide agent, prompt, image attachment, and prompt-helper controls.
   *
   * CDXC:WorktreeModal 2026-06-13-18:39:
   * Add Worktree should close from the same top-right shadcn X used by Rename
   * Session. Do not keep a footer Cancel row; the bottom of the modal should
   * be reserved for the primary worktree action and create-mode image picker.
   *
   * CDXC:WorktreeModal 2026-06-15-11:30:
   * Add Worktree opens in the same hidden native child-window host as Rename
   * Session, so the first-prompt textarea must retry focus across native
   * window activation and stop retrying after any user click or key input.
   */
  const hasInitializedOpenDraftRef = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      hasInitializedOpenDraftRef.current = false;
      userInteractedAfterOpenRef.current = false;
      return;
    }
    if (hasInitializedOpenDraftRef.current) {
      return;
    }
    hasInitializedOpenDraftRef.current = true;
    userInteractedAfterOpenRef.current = false;

    setPrompt("");
    setImageCount(0);
    setMode("create");
    setExistingWorktrees([]);
    setSelectedExistingWorktreePath("");
    setWorktreeListError(undefined);
    setSelectedAgentId(resolveInitialWorktreeAgentId(commandAgents, defaultAgentId));
    if (onRequestExistingWorktrees) {
      const requestId = `worktrees-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      worktreeListRequestIdRef.current = requestId;
      setIsLoadingWorktrees(true);
      onRequestExistingWorktrees(requestId);
    }
  }, [commandAgents, defaultAgentId, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setSelectedAgentId((currentAgentId) =>
      commandAgents.some((agent) => agent.agentId === currentAgentId)
        ? currentAgentId
        : resolveInitialWorktreeAgentId(commandAgents, defaultAgentId),
    );
  }, [commandAgents, defaultAgentId, isOpen]);

  const focusInput = useCallback(() => {
    const input = inputRef.current;
    if (input) {
      input.focus({ preventScroll: true });
      const selectionIndex = input.value.length;
      input.setSelectionRange(selectionIndex, selectionIndex);
    }
    return false as const;
  }, []);

  const markUserInteractedAfterOpen = useCallback(() => {
    userInteractedAfterOpenRef.current = true;
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const focusUnlessUserInteracted = () => {
      if (userInteractedAfterOpenRef.current) {
        return;
      }
      focusInput();
    };
    const retryDelaysMs = [0, 16, 50, 100, 250, 500, 1000, 1600, 2400];
    const timeoutIds = retryDelaysMs.map((delayMs) =>
      window.setTimeout(focusUnlessUserInteracted, delayMs),
    );
    const animationFrame = window.requestAnimationFrame(focusUnlessUserInteracted);
    const windowFocusTimeoutIds: number[] = [];
    const windowFocusAnimationFrames: number[] = [];
    const handleWindowFocus = () => {
      windowFocusTimeoutIds.push(window.setTimeout(focusUnlessUserInteracted, 0));
      windowFocusAnimationFrames.push(window.requestAnimationFrame(focusUnlessUserInteracted));
    };

    window.addEventListener("focus", handleWindowFocus);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
      windowFocusTimeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
      windowFocusAnimationFrames.forEach((frameId) => window.cancelAnimationFrame(frameId));
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [focusInput, isOpen]);

  const normalizedPrompt = trimPromptEditorTrailingSpaces(prompt);
  const trimmedPrompt = normalizedPrompt.trim();
  const canCreate = Boolean(
    mode === "openExisting"
      ? selectedExistingWorktreePath
      : trimmedPrompt && selectedAgentId,
  );

  const insertImageLinks = (files: readonly File[]) => {
    if (files.length === 0) {
      return;
    }

    const links = files.map((file, index) => {
      const path =
        (file as File & { path?: string }).path?.trim() ||
        file.webkitRelativePath?.trim() ||
        file.name;
      return `[Image #${imageCount + index + 1}](${path})`;
    });
    setImageCount((count) => count + files.length);
    insertPromptText(
      `${prompt.endsWith("\n") || prompt.length === 0 ? "" : "\n"}${links.join("\n")}\n`,
    );
  };

  const insertImagePaths = (paths: readonly string[]) => {
    if (paths.length === 0) {
      return;
    }
    const links = paths.map((path, index) => `[Image #${imageCount + index + 1}](${path})`);
    setImageCount((count) => count + paths.length);
    insertPromptText(
      `${prompt.endsWith("\n") || prompt.length === 0 ? "" : "\n"}${links.join("\n")}\n`,
    );
  };

  const insertPromptText = (text: string) => {
    const textarea = inputRef.current;
    if (!textarea) {
      setPrompt((current) => `${current}${text}`);
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const nextPrompt = `${prompt.slice(0, start)}${text}${prompt.slice(end)}`;
    setPrompt(nextPrompt);
    window.requestAnimationFrame(() => {
      textarea.focus();
      const nextSelection = start + text.length;
      textarea.setSelectionRange(nextSelection, nextSelection);
    });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canCreate) {
      return;
    }
    onConfirm(createDraft(mode, selectedAgentId, trimmedPrompt, selectedExistingWorktreePath));
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (canCreate) {
      onConfirm(createDraft(mode, selectedAgentId, trimmedPrompt, selectedExistingWorktreePath));
    }
  };

  const handlePaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const imageFiles = Array.from(event.clipboardData.files).filter((file): file is File =>
      file.type.startsWith("image/"),
    );
    if (imageFiles.length > 0) {
      event.preventDefault();
      insertImageLinks(imageFiles);
      return;
    }

    const pastedText = event.clipboardData.getData("text/plain");
    const trimmedText = trimPromptEditorTrailingSpaces(pastedText);
    if (!pastedText || trimmedText === pastedText) {
      return;
    }
    event.preventDefault();
    insertPromptText(trimmedText);
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePickedImages = (event: Event) => {
      const message = (event as CustomEvent<unknown>).detail;
      if (!message || typeof message !== "object" || !("type" in message)) {
        return;
      }
      if (message.type !== "worktreeImageFilesPicked") {
        if (message.type === "projectWorktreesResult") {
          const result = message as ProjectWorktreesResultMessage;
          if (result.requestId !== worktreeListRequestIdRef.current) {
            return;
          }
          setIsLoadingWorktrees(false);
          if (!result.ok) {
            setWorktreeListError(
              typeof result.error === "string" ? result.error : "Could not load existing worktrees.",
            );
            setExistingWorktrees([]);
            return;
          }
          const worktrees = normalizeExistingWorktreeOptions(result.worktrees);
          setExistingWorktrees(worktrees);
          setSelectedExistingWorktreePath((current) =>
            worktrees.some((worktree) => worktree.path === current)
              ? current
              : worktrees.find((worktree) => !worktree.isRegistered)?.path ?? worktrees[0]?.path ?? "",
          );
          return;
        }
        return;
      }
      const candidate = message as { paths?: unknown };
      const paths = Array.isArray(candidate.paths)
        ? candidate.paths.filter(
            (path): path is string => typeof path === "string" && path.trim().length > 0,
          )
        : [];
      insertImagePaths(paths);
    };

    window.addEventListener("ghostex-app-modal-host-message", handlePickedImages);
    return () => {
      window.removeEventListener("ghostex-app-modal-host-message", handlePickedImages);
    };
  });

  if (!isOpen) {
    return null;
  }

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onCancel();
        }
      }}
      open={isOpen}
    >
      <DialogContent
        className="command-config-modal-shadcn worktree-create-modal-shadcn font-sans"
        initialFocus={focusInput}
        showCloseButton
      >
        <form
          className="session-rename-form worktree-create-form"
          onKeyDownCapture={markUserInteractedAfterOpen}
          onPointerDownCapture={markUserInteractedAfterOpen}
          onSubmit={submit}
        >
          <DialogHeader>
            <DialogTitle className="text-xl">Add Worktree</DialogTitle>
            <DialogDescription>
              Start a worktree from {projectName?.trim() || "this project"}.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="session-rename-field-group">
            <Field>
              <FieldLabel>Mode</FieldLabel>
              <div className="worktree-create-mode-toggle" role="group" aria-label="Worktree mode">
                <Button
                  onClick={() => setMode("create")}
                  type="button"
                  variant={mode === "create" ? "default" : "outline"}
                >
                  <IconGitBranch aria-hidden="true" data-icon="inline-start" />
                  Create New
                </Button>
                <Button
                  onClick={() => setMode("openExisting")}
                  type="button"
                  variant={mode === "openExisting" ? "default" : "outline"}
                >
                  <IconFolderOpen aria-hidden="true" data-icon="inline-start" />
                  Open Existing
                </Button>
              </div>
            </Field>
            {mode === "openExisting" ? (
              <Field>
                <FieldLabel htmlFor={existingWorktreeId}>Existing worktree</FieldLabel>
                <Select
                  onValueChange={setSelectedExistingWorktreePath}
                  value={selectedExistingWorktreePath}
                >
                  <SelectTrigger
                    aria-label="Existing worktree"
                    className="worktree-create-existing-select"
                    id={existingWorktreeId}
                  >
                    <SelectValue placeholder={isLoadingWorktrees ? "Loading worktrees" : "Select worktree"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {existingWorktrees.map((worktree) => (
                        <SelectItem
                          key={worktree.path}
                          value={worktree.path}
                        >
                          {worktree.name} {worktree.branch ? `(${worktree.branch})` : ""}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  {worktreeListError ??
                    (selectedExistingWorktreePath ||
                      (isLoadingWorktrees ? "Loading existing worktrees." : "No existing worktrees found."))}
                </FieldDescription>
              </Field>
            ) : null}
            {mode === "create" ? (
              <>
                <Field>
                  <FieldLabel htmlFor={agentId}>Agent</FieldLabel>
                  <Select
                    items={agentSelectItems}
                    onValueChange={setSelectedAgentId}
                    value={selectedAgentId}
                  >
                    <SelectTrigger
                      aria-label="Agent"
                      className="worktree-create-agent-select"
                      id={agentId}
                    >
                      <SelectValue placeholder="Select agent" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {commandAgents.map((agent) => (
                          <SelectItem key={agent.agentId} value={agent.agentId}>
                            {agent.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor={promptId}>First prompt</FieldLabel>
                  <Textarea
                    aria-label="First prompt"
                    autoFocus
                    id={promptId}
                    onChange={(event) => setPrompt(event.currentTarget.value)}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    placeholder="Describe the worktree task"
                    ref={inputRef}
                    value={prompt}
                  />
                  <FieldDescription>
                    Paste images or pick files to insert image links into the prompt.
                  </FieldDescription>
                </Field>
              </>
            ) : null}
          </FieldGroup>
          <DialogFooter>
            {mode === "create" ? (
              <Button
                onClick={() =>
                  postAppModalHostMessage(
                    { type: "pickWorktreeImages" },
                    "AppModals:pickWorktreeImages",
                  )
                }
                type="button"
                variant="secondary"
              >
                <IconPhotoPlus aria-hidden="true" data-icon="inline-start" />
                Add Images
              </Button>
            ) : null}
            <Button disabled={!canCreate} type="submit">
              {mode === "openExisting" ? "Open Worktree" : "New Worktree"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function resolveInitialWorktreeAgentId(
  commandAgents: SidebarAgentButton[],
  defaultAgentId?: string,
): string {
  return (
    commandAgents.find((agent) => agent.agentId === defaultAgentId)?.agentId ??
    commandAgents[0]?.agentId ??
    ""
  );
}

function createDraft(
  mode: WorktreeCreateMode,
  agentId: string,
  prompt: string,
  existingWorktreePath: string,
): WorktreeCreateModalDraft {
  if (mode === "openExisting") {
    return {
      existingWorktreePath,
      mode,
    };
  }
  return { agentId, mode, prompt };
}

function normalizeExistingWorktreeOptions(candidate: unknown): ExistingWorktreeOption[] {
  if (!Array.isArray(candidate)) {
    return [];
  }
  return candidate.flatMap((entry): ExistingWorktreeOption[] => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const worktree = entry as Partial<ExistingWorktreeOption>;
    const path = worktree.path?.trim();
    const name = worktree.name?.trim();
    if (!path || !name) {
      return [];
    }
    return [
      {
        branch: worktree.branch?.trim() ?? "",
        isCurrentProject: worktree.isCurrentProject === true,
        isRegistered: worktree.isRegistered === true,
        name,
        path,
      },
    ];
  });
}
