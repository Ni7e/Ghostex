// Tool run rendering with collapsing rules (orca §11.3 port).

import { IconChevronRight } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type {
  SessionChatToolCallBlock,
  SessionChatToolResultBlock,
} from "../../shared/session-chat";
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
    <div className="ghostex-chat-diff">
      {lines.map((line, index) => (
        <div className="ghostex-chat-diff-line" data-kind={line.kind} key={index}>
          <span className="ghostex-chat-diff-sign">
            {line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}
          </span>
          <span className="ghostex-chat-diff-text">{line.text}</span>
        </div>
      ))}
    </div>
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
    <div className="ghostex-chat-tool-line">
      <button
        className="ghostex-chat-tool-line-header"
        data-clickable={hasDetail}
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
            className="ghostex-chat-tool-line-chevron"
            data-open={open}
            size={12}
            stroke={2}
          />
        ) : (
          <span className="ghostex-chat-tool-line-chevron-slot" />
        )}
        <span className="ghostex-chat-tool-line-name">{name}</span>
        {preview ? (
          <span className="ghostex-chat-tool-line-preview">{preview}</span>
        ) : null}
      </button>
      {hasDetail && open ? (
        diff ? (
          <DiffView lines={diff} />
        ) : body ? (
          <pre
            className="ghostex-chat-tool-body"
            data-error={body.isError ? "true" : undefined}
          >
            {clipBody(body.output)}
          </pre>
        ) : detail !== null ? (
          <pre className="ghostex-chat-tool-body">{clipBody(detail)}</pre>
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
    <div className="ghostex-chat-tool-run" data-open={open}>
      <button
        className="ghostex-chat-tool-run-header"
        onClick={() => {
          setOpen((current) => !current);
        }}
        type="button"
      >
        <span className="ghostex-chat-tool-run-count">{callCount}×</span>
        <span className="ghostex-chat-tool-run-label">{label}</span>
        <IconChevronRight
          aria-hidden="true"
          className="ghostex-chat-tool-run-chevron"
          data-open={open}
          size={13}
          stroke={2}
        />
      </button>
      {open ? (
        <div className="ghostex-chat-tool-lines">
          {blocks.map((block, index) => (
            <ToolLine block={block} key={index} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
