import { IconCopy, IconFolder, IconPlus, IconTrash } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandItem,
  CommandList,
} from "../components/ui/command";
import type { GxserverStashedPrompt } from "../shared/gxserver-protocol";
import { trimPromptEditorTrailingSpaces } from "../shared/prompt-editor-text";
import type { ExtensionToSidebarMessage } from "../shared/session-grid-contract";
import {
  normalizeWorkspaceProjectIcon,
  resolveWorkspaceProjectIconDataUrl,
} from "../shared/workspace-project-appearance";
import { AppTooltip, TooltipProvider } from "./app-tooltip";
import { SidebarCommandIconGlyph } from "./sidebar-command-icon";
import { formatRelativeTime } from "./relative-time";
import { TOOLTIP_DELAY_MS } from "./tooltip-delay";
import type { WebviewApi } from "./webview-api";

export type StashedPromptsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  projectId?: string;
  sessionId?: string;
  vscode: WebviewApi;
};

type StashedPromptsScope = "project" | "all";

const PREVIEW_LINE_COUNT = 3;
const TOOLTIP_LINE_COUNT = 30;

/*
 * CDXC:StashedPrompts 2026-07-29:
 * Search matches on whitespace-collapsed prompt text plus the project name so
 * a query typed with single spaces still finds prompts whose original body
 * uses line breaks or indentation.
 */
function stashedPromptSearchText(prompt: GxserverStashedPrompt): string {
  return `${prompt.content} ${prompt.projectName ?? ""}`
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function stashedPromptLines(prompt: GxserverStashedPrompt): string[] {
  return prompt.content.trim().split("\n");
}

function relativeTimeLabel(isoDate: string): string {
  const { suffix, value } = formatRelativeTime(isoDate, { allowJustNow: true });
  return suffix ? `${value} ${suffix}` : value;
}

export function StashedPromptsModal({
  isOpen,
  onClose,
  projectId,
  sessionId,
  vscode,
}: StashedPromptsModalProps) {
  const [scope, setScope] = useState<StashedPromptsScope>(projectId ? "project" : "all");
  const [prompts, setPrompts] = useState<GxserverStashedPrompt[]>();
  const [searchQuery, setSearchQuery] = useState("");
  const [isAddingPrompt, setIsAddingPrompt] = useState(false);
  const [draftContent, setDraftContent] = useState("");
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const latestRequestIdRef = useRef<string | undefined>(undefined);
  const latestSaveRequestIdRef = useRef<string | undefined>(undefined);
  const requestCounterRef = useRef(0);
  const draftTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setScope(projectId ? "project" : "all");
      setPrompts(undefined);
      setSearchQuery("");
      setIsAddingPrompt(false);
      setDraftContent("");
      setIsSavingPrompt(false);
      setSaveError(undefined);
      latestRequestIdRef.current = undefined;
      latestSaveRequestIdRef.current = undefined;
    }
  }, [isOpen, projectId]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleMessage = (event: MessageEvent<ExtensionToSidebarMessage>) => {
      if (event.data?.type === "saveStashedPromptResult") {
        if (event.data.requestId !== latestSaveRequestIdRef.current) {
          return;
        }
        setIsSavingPrompt(false);
        if (!event.data.ok || !event.data.prompt) {
          setSaveError(event.data.error ?? "Could not save this prompt.");
          return;
        }
        const savedPrompt = event.data.prompt;
        setPrompts((current) => [
          savedPrompt,
          ...(current ?? []).filter((prompt) => prompt.promptId !== savedPrompt.promptId),
        ]);
        setDraftContent("");
        setSearchQuery("");
        setSaveError(undefined);
        setIsAddingPrompt(false);
        latestSaveRequestIdRef.current = undefined;
        return;
      }
      if (event.data?.type !== "stashedPromptsResult") {
        return;
      }
      if (event.data.requestId !== latestRequestIdRef.current) {
        return;
      }
      setPrompts(event.data.prompts);
    };
    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !isAddingPrompt) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      draftTextareaRef.current?.focus();
    }, 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (isSavingPrompt) {
        return;
      }
      setIsAddingPrompt(false);
      setDraftContent("");
      setSaveError(undefined);
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.clearTimeout(timeoutId);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isAddingPrompt, isOpen, isSavingPrompt]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    requestCounterRef.current += 1;
    const requestId = `stashed-prompts-${Date.now()}-${requestCounterRef.current}`;
    latestRequestIdRef.current = requestId;
    setPrompts(undefined);
    vscode.postMessage({
      ...(scope === "project" && projectId ? { projectId } : {}),
      requestId,
      type: "requestStashedPrompts",
    });
  }, [isOpen, projectId, scope, vscode]);

  const visiblePrompts = useMemo(() => {
    if (!prompts) {
      return [];
    }
    const query = searchQuery.toLowerCase().replace(/\s+/g, " ").trim();
    if (!query) {
      return prompts;
    }
    return prompts.filter((prompt) => stashedPromptSearchText(prompt).includes(query));
  }, [prompts, searchQuery]);

  const insertPrompt = (prompt: GxserverStashedPrompt) => {
    vscode.postMessage({
      content: prompt.content,
      promptId: prompt.promptId,
      ...(sessionId ? { sessionId } : {}),
      type: "insertStashedPrompt",
    });
    onClose();
  };

  const deletePrompt = (prompt: GxserverStashedPrompt) => {
    vscode.postMessage({ promptId: prompt.promptId, type: "deleteStashedPrompt" });
    setPrompts((current) =>
      current?.filter((candidate) => candidate.promptId !== prompt.promptId),
    );
  };

  const savePrompt = () => {
    const content = trimPromptEditorTrailingSpaces(draftContent);
    if (!content.trim() || isSavingPrompt) {
      return;
    }
    requestCounterRef.current += 1;
    const requestId = `save-stashed-prompt-${Date.now()}-${requestCounterRef.current}`;
    latestSaveRequestIdRef.current = requestId;
    setIsSavingPrompt(true);
    setSaveError(undefined);
    vscode.postMessage({
      content,
      ...(projectId ? { projectId } : {}),
      requestId,
      ...(sessionId ? { sessionId } : {}),
      type: "saveStashedPrompt",
    });
  };

  return (
    <CommandDialog
      className="ghostex-settings-shadcn ghostex-command-palette-dialog ghostex-stashed-prompts-dialog top-1/2 -translate-y-1/2"
      description="Browse and add saved prompts."
      open={isOpen}
      showCloseButton={false}
      title="Prompts"
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
    >
      {/*
        CDXC:StashedPrompts 2026-07-29:
        Every prompt-editor save-and-close (Ctrl+G in a session, then Save)
        stashes the composed text in gxserver. This modal is the recall
        surface: a command-palette-style list, newest first, defaulting to the
        current project plus its worktrees with an explicit All Projects
        escape. Selecting a row inserts the prompt back into the originating
        terminal session without submitting it.
      */}
      <TooltipProvider delayDuration={TOOLTIP_DELAY_MS}>
        <Command
          className={isAddingPrompt ? "ghostex-stashed-prompts-command-editor" : undefined}
          shouldFilter={false}
        >
          {isAddingPrompt ? (
            <div className="ghostex-stashed-prompt-editor">
              <div className="ghostex-stashed-prompt-editor-heading">Add Saved Prompt</div>
              <textarea
                aria-label="Saved prompt content"
                className="ghostex-stashed-prompt-editor-textarea"
                disabled={isSavingPrompt}
                onChange={(event) => {
                  setDraftContent(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    savePrompt();
                  }
                }}
                placeholder="Write a prompt you want to save..."
                ref={draftTextareaRef}
                spellCheck={false}
                value={draftContent}
              />
              {saveError ? (
                <div className="ghostex-stashed-prompt-editor-error" role="alert">
                  {saveError}
                </div>
              ) : null}
              <div className="ghostex-stashed-prompt-editor-actions">
                <button
                  className="ghostex-stashed-prompt-editor-button"
                  disabled={isSavingPrompt}
                  onClick={() => {
                    setIsAddingPrompt(false);
                    setDraftContent("");
                    setSaveError(undefined);
                  }}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="ghostex-stashed-prompt-editor-button ghostex-stashed-prompt-editor-button-primary"
                  disabled={!draftContent.trim() || isSavingPrompt}
                  onClick={savePrompt}
                  type="button"
                >
                  {isSavingPrompt ? "Saving..." : "Add Prompt"}
                </button>
              </div>
            </div>
          ) : (
            <>
              <CommandInput
                className="pl-3"
                clearOnEscape={false}
                clearLabel="Clear prompt search"
                onKeyDown={(event) => {
                  if (event.key !== "Escape") {
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  onClose();
                }}
                placeholder="Search saved prompts..."
                value={searchQuery}
                onValueChange={setSearchQuery}
              />
              <div className="ghostex-stashed-prompts-scope">
                {projectId ? (
                  <div className="ghostex-stashed-prompts-scope-tabs" role="tablist">
                    <button
                      aria-selected={scope === "project"}
                      className="ghostex-stashed-prompts-scope-button"
                      data-active={scope === "project"}
                      onClick={() => {
                        setScope("project");
                      }}
                      role="tab"
                      type="button"
                    >
                      This Project
                    </button>
                    <button
                      aria-selected={scope === "all"}
                      className="ghostex-stashed-prompts-scope-button"
                      data-active={scope === "all"}
                      onClick={() => {
                        setScope("all");
                      }}
                      role="tab"
                      type="button"
                    >
                      All Projects
                    </button>
                  </div>
                ) : null}
                <button
                  className="ghostex-stashed-prompts-add-button"
                  onClick={() => {
                    setIsAddingPrompt(true);
                  }}
                  type="button"
                >
                  <IconPlus aria-hidden="true" size={13} stroke={2} />
                  Add Prompt
                </button>
              </div>
              <CommandList className="ghostex-command-palette-list">
                {prompts === undefined ? (
                  <div className="ghostex-stashed-prompts-empty">Loading saved prompts...</div>
                ) : visiblePrompts.length === 0 ? (
                  <div className="ghostex-stashed-prompts-empty">
                    {searchQuery.trim()
                      ? "No saved prompts match this search."
                      : scope === "project"
                        ? "No prompts saved in this project yet. Press Ctrl+G in a session and save the prompt editor to stash one."
                        : "No prompts saved yet. Press Ctrl+G in a session and save the prompt editor to stash one."}
                  </div>
                ) : (
                  visiblePrompts.map((prompt) => (
                    <StashedPromptRow
                      key={prompt.promptId}
                      onDelete={() => {
                        deletePrompt(prompt);
                      }}
                      onSelect={() => {
                        insertPrompt(prompt);
                      }}
                      prompt={prompt}
                    />
                  ))
                )}
              </CommandList>
            </>
          )}
        </Command>
      </TooltipProvider>
    </CommandDialog>
  );
}

type StashedPromptRowProps = {
  onDelete: () => void;
  onSelect: () => void;
  prompt: GxserverStashedPrompt;
};

/**
 * CDXC:StashedPrompts 2026-07-29:
 * Stash cards show the origin project with the same identity icon the sidebar
 * and Recent Projects use, falling back to a folder glyph for projects that
 * never picked one.
 */
function StashedPromptProjectIcon({ prompt }: { prompt: GxserverStashedPrompt }) {
  const iconSource = {
    icon: normalizeWorkspaceProjectIcon(prompt.projectIcon),
    iconDataUrl: prompt.projectIconDataUrl ?? undefined,
  };
  const iconDataUrl = resolveWorkspaceProjectIconDataUrl(iconSource);
  if (iconDataUrl) {
    return (
      <img
        alt=""
        className="ghostex-stashed-prompt-project-icon-image"
        draggable={false}
        src={iconDataUrl}
      />
    );
  }
  if (iconSource.icon?.kind === "tabler") {
    return (
      <SidebarCommandIconGlyph
        color={iconSource.icon.color}
        icon={iconSource.icon.icon}
        size={13}
        stroke={1.8}
      />
    );
  }
  return <IconFolder aria-hidden="true" size={13} stroke={1.8} />;
}

function StashedPromptRow({ onDelete, onSelect, prompt }: StashedPromptRowProps) {
  const lines = stashedPromptLines(prompt);
  const previewLines = lines.slice(0, PREVIEW_LINE_COUNT);
  const hasMoreLines = lines.length > PREVIEW_LINE_COUNT;
  const tooltipLines = lines.slice(0, TOOLTIP_LINE_COUNT);
  const tooltipTruncated = lines.length > TOOLTIP_LINE_COUNT;

  return (
    <AppTooltip
      align="center"
      content={
        <div className="ghostex-stashed-prompt-tooltip-body">
          {tooltipLines.join("\n")}
          {tooltipTruncated ? "\n…" : ""}
        </div>
      }
      /*
       * CDXC:StashedPrompts 2026-07-29:
       * The hover preview reads as an extension of the row: same width as the
       * hovered row and anchored directly under it, using the shared sidebar
       * tooltip surface. --anchor-width is provided by the Base UI positioner.
       */
      contentStyle={{ width: "var(--anchor-width)" }}
      side="bottom"
      sideOffset={4}
    >
      <CommandItem
        className="ghostex-stashed-prompt-item"
        onSelect={onSelect}
        value={prompt.promptId}
      >
        <div className="ghostex-stashed-prompt-card">
          <div className="ghostex-stashed-prompt-preview">
            {previewLines.map((line, index) => (
              <div className="ghostex-stashed-prompt-line" key={index}>
                {line.length > 0 ? line : " "}
                {hasMoreLines && index === previewLines.length - 1 ? "…" : ""}
              </div>
            ))}
          </div>
          <div className="ghostex-stashed-prompt-meta">
            <span className="ghostex-stashed-prompt-project">
              <span aria-hidden="true" className="ghostex-stashed-prompt-project-icon">
                <StashedPromptProjectIcon prompt={prompt} />
              </span>
              <span className="ghostex-stashed-prompt-project-name">
                {prompt.projectName ?? "No project"}
              </span>
            </span>
            <span className="ghostex-stashed-prompt-time">
              {relativeTimeLabel(prompt.updatedAt)}
            </span>
          </div>
          <div className="ghostex-stashed-prompt-actions">
            <button
              aria-label="Copy prompt"
              className="ghostex-stashed-prompt-action copy-cursor"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void navigator.clipboard.writeText(prompt.content);
              }}
              type="button"
            >
              <IconCopy aria-hidden="true" size={13} stroke={1.9} />
            </button>
            <button
              aria-label="Delete prompt"
              className="ghostex-stashed-prompt-action"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onDelete();
              }}
              type="button"
            >
              <IconTrash aria-hidden="true" size={13} stroke={1.9} />
            </button>
          </div>
        </div>
      </CommandItem>
    </AppTooltip>
  );
}
