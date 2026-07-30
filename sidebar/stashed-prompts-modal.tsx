import { IconCopy, IconFolder, IconTrash } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandItem,
  CommandList,
} from "../components/ui/command";
import type { GxserverStashedPrompt } from "../shared/gxserver-protocol";
import type { ExtensionToSidebarMessage } from "../shared/session-grid-contract";
import {
  normalizeWorkspaceProjectIcon,
  resolveWorkspaceProjectIconDataUrl,
} from "../shared/workspace-project-appearance";
import { AppTooltip, TooltipProvider } from "./app-tooltip";
import { SidebarCommandIconGlyph } from "./sidebar-command-icon";
import { formatRelativeTime } from "./relative-time";
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
const STASHED_PROMPTS_TOOLTIP_DELAY_MS = 350;

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
  const latestRequestIdRef = useRef<string | undefined>(undefined);
  const requestCounterRef = useRef(0);

  useEffect(() => {
    if (!isOpen) {
      setScope(projectId ? "project" : "all");
      setPrompts(undefined);
      setSearchQuery("");
      latestRequestIdRef.current = undefined;
    }
  }, [isOpen, projectId]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleMessage = (event: MessageEvent<ExtensionToSidebarMessage>) => {
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

  return (
    <CommandDialog
      className="ghostex-settings-shadcn ghostex-command-palette-dialog ghostex-stashed-prompts-dialog top-1/2 -translate-y-1/2"
      description="Search prompts saved from the prompt editor."
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
      <TooltipProvider delayDuration={STASHED_PROMPTS_TOOLTIP_DELAY_MS}>
        <Command shouldFilter={false}>
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
          {projectId ? (
            <div className="ghostex-stashed-prompts-scope" role="tablist">
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
