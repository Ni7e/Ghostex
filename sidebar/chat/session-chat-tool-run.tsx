// Tool run rendering with collapsing rules (upstream chat spec §11.3 port), rendered as a
// shadcn Marker header over a bordered detail rail.

import { IconChevronRight } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type {
  SessionChatToolCallBlock,
  SessionChatToolResultBlock,
} from "../../shared/session-chat";
import { cn } from "../../lib/utils";
import { Marker, MarkerContent, MarkerIcon } from "../../components/ui/marker";
import {
  diffFromSessionChatText,
  diffFromSessionChatToolCall,
  type SessionChatDiffLine,
} from "./session-chat-diff";
import {
  countSessionChatToolCalls,
  formatSessionChatToolInput,
  summarizeSessionChatToolInput,
  summarizeSessionChatToolRun,
} from "./session-chat-tool-summary";

export const SESSION_CHAT_MAX_TOOL_RESULT_CHARS = 4000;

type ToolBlock = SessionChatToolCallBlock | SessionChatToolResultBlock;

export interface SessionChatToolRunProps {
  blocks: readonly ToolBlock[];
  /** Global expand toggle; per-run override still works after a change. */
  expandSignal?: boolean;
}

function clipBody(text: string): string {
  return text.length > SESSION_CHAT_MAX_TOOL_RESULT_CHARS
    ? `${text.slice(0, SESSION_CHAT_MAX_TOOL_RESULT_CHARS)}…`
    : text;
}

function DiffView({ lines }: { lines: readonly SessionChatDiffLine[] }) {
  return (
    <div className="overflow-x-auto rounded-lg bg-muted/40 px-2 py-1.5 font-mono text-xs leading-5">
      {lines.map((line, index) => (
        <div
          className={cn(
            "flex whitespace-pre",
            line.kind === "add" && "bg-emerald-500/10 text-emerald-500",
            line.kind === "del" && "bg-red-500/10 text-red-400",
            line.kind === "meta" && "text-muted-foreground",
          )}
          key={index}
        >
          <span className="w-4 shrink-0 select-none">
            {line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}
          </span>
          <span className="min-w-0">{line.text}</span>
        </div>
      ))}
    </div>
  );
}

function ToolBody({ error, text }: { error?: boolean; text: string }) {
  return (
    <pre
      className={cn(
        "overflow-x-auto rounded-lg bg-muted/40 px-2 py-1.5 font-mono text-xs leading-5 whitespace-pre-wrap wrap-break-word",
        error && "text-destructive",
      )}
    >
      {clipBody(text)}
    </pre>
  );
}

function ToolLine({ block }: { block: ToolBlock }) {
  // Each line starts expanded — opening the run reveals every line at once —
  // then is individually collapsible.
  const [open, setOpen] = useState(true);

  let name: string;
  let preview: string;
  let diff: SessionChatDiffLine[] | null;
  let detail: string | null = null;
  let body: { output: string; isError: boolean } | null = null;
  if (block.type === "tool-call") {
    name = block.name;
    preview = summarizeSessionChatToolInput(block.input);
    diff = diffFromSessionChatToolCall(block.name, block.input);
    detail = diff ? null : formatSessionChatToolInput(block.input);
  } else {
    name = "Result";
    preview = block.output.split("\n")[0]?.slice(0, 80) ?? "";
    diff = diffFromSessionChatText(block.output);
    body = { isError: block.isError === true, output: block.output };
  }

  // Only offer expansion when there's more than the inline preview shows.
  const detailAddsInfo =
    detail !== null && detail.replace(/\s+/g, " ").trim() !== preview;
  const hasDetail = diff !== null || body !== null || detailAddsInfo;

  return (
    <div className="flex flex-col gap-1">
      <button
        className={cn(
          "flex min-w-0 items-center gap-1.5 text-left text-xs text-muted-foreground",
          hasDetail && "cursor-pointer transition-colors hover:text-foreground",
        )}
        disabled={!hasDetail}
        onClick={() => {
          if (hasDetail) {
            setOpen((current) => !current);
          }
        }}
        type="button"
      >
        {hasDetail ? (
          <IconChevronRight
            aria-hidden="true"
            className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")}
            stroke={2}
          />
        ) : (
          <span className="size-3 shrink-0" />
        )}
        <span className="shrink-0 font-medium text-foreground/80">{name}</span>
        {preview ? (
          <span className="min-w-0 truncate font-mono">{preview}</span>
        ) : null}
      </button>
      {hasDetail && open ? (
        diff ? (
          <DiffView lines={diff} />
        ) : body ? (
          <ToolBody error={body.isError} text={body.output} />
        ) : detail !== null ? (
          <ToolBody text={detail} />
        ) : null
      ) : null}
    </div>
  );
}

export function SessionChatToolRun({ blocks, expandSignal = false }: SessionChatToolRunProps) {
  const [open, setOpen] = useState(expandSignal);

  // Re-sync on every expandSignal change so a global toolbar toggle drives
  // all runs while a per-run override still works in between.
  useEffect(() => {
    setOpen(expandSignal);
  }, [expandSignal]);

  const callCount = countSessionChatToolCalls(blocks) || blocks.length;
  const summary = summarizeSessionChatToolRun(blocks);
  const label =
    summary || (callCount === 1 ? "1 tool call" : `${callCount} tool calls`);

  return (
    <div className="flex w-full min-w-0 flex-col gap-1.5" data-open={open}>
      <Marker
        render={
          <button
            className="cursor-pointer transition-colors hover:text-foreground"
            onClick={() => {
              setOpen((current) => !current);
            }}
            type="button"
          />
        }
      >
        <MarkerIcon>
          <IconChevronRight
            aria-hidden="true"
            className={cn("transition-transform", open && "rotate-90")}
            stroke={2}
          />
        </MarkerIcon>
        <MarkerContent className="flex min-w-0 items-baseline gap-1.5 truncate text-left">
          <span className="font-mono text-xs">{callCount}×</span>
          <span className="min-w-0 truncate">{label}</span>
        </MarkerContent>
      </Marker>
      {open ? (
        <div className="ml-1.5 flex min-w-0 flex-col gap-1.5 border-l border-border pl-3">
          {blocks.map((block, index) => (
            <ToolLine block={block} key={index} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
