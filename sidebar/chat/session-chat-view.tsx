// SessionChatView — root layout (orca §11.1 port): message list over an
// interactive-card slot over the composer. The question card replaces the
// composer while showing. Hosts inject a SessionChatTransport; everything
// else is derived by useSessionChat.

import {
  IconClockCheck,
  IconDots,
  IconGitBranch,
  IconMessageCode,
  IconPaperclip,
  IconPencil,
  IconRefresh,
  IconStack,
  IconStackPush,
  IconTerminal2,
  type Icon as TablerIcon,
} from "@tabler/icons-react";
import { useCallback, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { cn } from "../../lib/utils";
import {
  SessionChatComposer,
  type SessionChatComposerHandle,
} from "./session-chat-composer";
import { sessionChatEmptyStateCopy } from "./session-chat-empty-state";
import { SessionChatInteractiveCard } from "./session-chat-interactive-card";
import { SessionChatMessageList } from "./session-chat-message-list";
import {
  sessionChatSlashCommandsForAgent,
  sessionChatSlashHeadingForAgent,
} from "./session-chat-slash-commands";
import type { SessionChatTransport } from "./session-chat-transport";
import { useSessionChat } from "./use-session-chat";

const INTERACTIVE_TARGET_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  '[contenteditable]:not([contenteditable="false"])',
  '[role="button"]',
  '[role="checkbox"]',
  '[role="combobox"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="radio"]',
  '[role="slider"]',
  '[role="switch"]',
  '[role="textbox"]',
  '[data-session-chat-typing-redirect-ignore="true"]',
].join(", ");

export interface SessionChatHostAction {
  /** Host-defined action id, passed back verbatim to onAction. */
  id: string;
  label: string;
  /**
   * When set, clicking swaps the cluster to an inline text field (e.g.
   * Rename); onAction receives the submitted value as its second argument.
   */
  input?: { initialValue?: string; placeholder?: string };
}

/**
 * Host-injected top-right cluster shown over the chat: a "Terminal View"
 * switch-back button plus an optional "Agent Actions" button that expands
 * into the host's per-session action row. Hosts whose own chrome already
 * offers these (e.g. the mobile app's native header) simply omit the prop.
 */
export interface SessionChatHostActions {
  onSwitchToTerminal: () => void;
  /** Expanded Agent Actions row; omit to hide the Agent Actions button. */
  actions?: readonly SessionChatHostAction[];
  onAction?: (id: string, value?: string) => void;
  /** Direct Agent Actions handler (e.g. opens a host menu) instead of expanding a row. */
  onAgentActions?: () => void;
}

export interface SessionChatViewProps {
  /** Host-injected transport scoped to one (projectId, sessionId). */
  transport: SessionChatTransport;
  /** Display label for the agent in the empty state ("claude", "codex", …). */
  agentLabel?: string | null;
  /** Live assistant preview text (hook status) for the streaming bubble. */
  previewText?: string | null;
  /** Optional external live-work signal merged with the server status. */
  working?: boolean;
  /** False when input is held elsewhere; disables composer and cards. */
  canSend?: boolean;
  /** Verified command catalog for local "Ran /x" markers. */
  commandCatalog?: readonly string[];
  /** Top-right Terminal View / Agent Actions cluster (see the type doc). */
  hostActions?: SessionChatHostActions;
  /**
   * Base URL of monaco-editor's min/vs directory on this surface; when set,
   * the composer input is a Monaco editor. Hosts that cannot serve Monaco's
   * sibling assets (the mobile single-file bundle) omit it.
   */
  monacoVsBaseUrl?: string;
  className?: string;
}

/*
 * The cluster clones the gpui terminal overlay's action strip
 * (gpui/src/terminal_element.rs terminal_overlay_button): flush 28.125px
 * square buttons sharing 1px #2a2a2a divider borders, #101010 background,
 * #343434 hover, 14px #a6a6a6 icons, 0 10px 22px rgba(0,0,0,0.32) shadow,
 * inset 8.5px from the pane's top-right corner. Icons are the same Tabler
 * glyphs the gpui assets use; Sleep's moon is a custom filled asset copied
 * verbatim from gpui/assets/titlebar/moon.svg.
 */
const HOST_ACTION_ICONS: Record<string, TablerIcon> = {
  attachPath: IconPaperclip,
  delayedActions: IconClockCheck,
  fork: IconGitBranch,
  fullReload: IconRefresh,
  promptEditor: IconMessageCode,
  rename: IconPencil,
  stashPrompt: IconStackPush,
  stashedPrompts: IconStack,
};

function SleepMoonIcon() {
  return (
    <svg aria-hidden="true" className="size-3.5" fill="currentColor" viewBox="0 0 32 32">
      <path
        d="M30.4422 21.7576L30.4116 21.7051C30.2498 21.4554 29.954 21.3157 29.6478 21.3697C29.5454 21.3877 29.4525 21.4254 29.3705 21.4785L29.375 21.4756C28.2165 22.2303 26.8137 22.7975 25.2833 23.0673C19.1647 24.1462 13.3295 20.0604 12.2506 13.9418C11.4414 9.3526 13.5372 4.9234 17.2172 2.5401L17.2852 2.4997L17.4776 2.3754C17.72 2.2129 17.8546 1.9221 17.8014 1.6207C17.7363 1.2514 17.4105 0.9931 17.0476 1.0022L17.0435 1.0019C16.3825 1.0139 15.6299 1.0877 14.8745 1.2209C6.8533 2.6353 1.4972 10.2846 2.9116 18.3058C4.3259 26.3271 11.9752 31.6832 19.9965 30.2688C24.6723 29.4443 28.4435 26.5007 30.4942 22.5994L30.5129 22.5615C30.5867 22.4216 30.616 22.254 30.586 22.0836C30.5639 21.9585 30.5128 21.8467 30.4404 21.7529L30.443 21.7564Z"
        transform="rotate(-10 16 16)"
      />
    </svg>
  );
}

function hostActionIcon(id: string): ReactNode {
  if (id === "sleep") {
    return <SleepMoonIcon />;
  }
  const Icon = HOST_ACTION_ICONS[id];
  return Icon ? <Icon aria-hidden="true" size={14} stroke={2} /> : null;
}

function HostActionButton({
  children,
  label,
  last = false,
  onClick,
}: {
  children: ReactNode;
  label: string;
  last?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className={cn(
        "flex h-[28.125px] min-w-[28.125px] shrink-0 items-center justify-center border-y border-l border-[#2a2a2a] bg-[#101010] text-[#a6a6a6] transition-colors hover:bg-[#343434]",
        last && "border-r",
      )}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

function EmptyState({
  detail,
  spinning,
  title,
}: {
  detail: string;
  spinning: boolean;
  title: string;
}) {
  return (
    <div className="ghostex-chat-empty-state">
      {spinning ? <span className="ghostex-chat-empty-spinner" /> : null}
      <div className="ghostex-chat-empty-title">{title}</div>
      <div className="ghostex-chat-empty-detail">{detail}</div>
    </div>
  );
}

export function SessionChatView({
  agentLabel,
  canSend = true,
  className,
  commandCatalog,
  hostActions,
  monacoVsBaseUrl,
  previewText,
  transport,
  working,
}: SessionChatViewProps) {
  const slashCommands = useMemo(
    () => sessionChatSlashCommandsForAgent(agentLabel ?? null),
    [agentLabel],
  );
  const slashCommandNames = useMemo(
    () => slashCommands.map((command) => command.name),
    [slashCommands],
  );
  const chat = useSessionChat({
    commandCatalog: commandCatalog ?? slashCommandNames,
    previewText,
    transport,
    working,
  });
  const composerRef = useRef<SessionChatComposerHandle | null>(null);
  const pasteImage = useMemo(() => {
    const saveImage = transport.saveImage?.bind(transport);
    return saveImage
      ? async (payload: { base64Data: string; suggestedName?: string }) =>
          (await saveImage(payload)).path
      : undefined;
  }, [transport]);
  const [questionActive, setQuestionActive] = useState(false);
  const [hostActionsExpanded, setHostActionsExpanded] = useState(false);
  const [hostInputAction, setHostInputAction] = useState<SessionChatHostAction | null>(null);
  const [hostInputValue, setHostInputValue] = useState("");

  const interrupt = useCallback((): void => {
    void chat.interrupt();
  }, [chat]);

  // Typing anywhere in the pane lands in the composer (§11.1): a single
  // printable character without Ctrl/Meta is redirected; unmodified
  // Backspace/Delete focuses the composer without inserting anything.
  const handleKeyDownCapture = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): void => {
      if (event.defaultPrevented || questionActive) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.closest?.(INTERACTIVE_TARGET_SELECTOR)) {
        return;
      }
      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        composerRef.current?.focus();
        return;
      }
      if (
        event.key.length === 1 &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.nativeEvent.isComposing
      ) {
        if (composerRef.current?.insertTypedText(event.key)) {
          event.preventDefault();
          event.stopPropagation();
        }
      }
    },
    [questionActive],
  );

  const emptyKind =
    chat.view.kind === "ready"
      ? null
      : chat.view.kind === "error"
        ? ("error" as const)
        : chat.view.kind;

  return (
    <div
      className={cn(
        // The app theme zeroes --radius for its square chrome; restore the
        // shadcn default inside the chat so bubbles and cards keep their
        // rounded look.
        "relative flex h-full min-h-0 flex-col bg-background text-foreground outline-none [--radius:0.625rem]",
        className,
      )}
      onKeyDownCapture={handleKeyDownCapture}
      tabIndex={-1}
    >
      {hostActions ? (
        <div className="pointer-events-none absolute right-[8.5px] top-[8.5px] z-20">
          <div className="pointer-events-auto flex items-center shadow-[0_10px_22px_rgba(0,0,0,0.32)]">
            {hostInputAction ? (
              <input
                autoFocus
                className="h-[28.125px] w-64 border border-[#2a2a2a] bg-[#101010] px-2 text-xs text-foreground outline-none focus:border-ring"
                onBlur={() => setHostInputAction(null)}
                onChange={(event) => setHostInputValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    hostActions.onAction?.(hostInputAction.id, hostInputValue);
                    setHostInputAction(null);
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    setHostInputAction(null);
                  }
                }}
                placeholder={hostInputAction.input?.placeholder ?? hostInputAction.label}
                value={hostInputValue}
              />
            ) : (
              <>
                <HostActionButton
                  label="Terminal View"
                  last={
                    hostActions.onAgentActions === undefined &&
                    !hostActions.actions?.length
                  }
                  onClick={hostActions.onSwitchToTerminal}
                >
                  <IconTerminal2 aria-hidden="true" size={14} stroke={2} />
                </HostActionButton>
                {hostActionsExpanded
                  ? hostActions.actions?.map((action) => (
                      <HostActionButton
                        key={action.id}
                        label={action.label}
                        onClick={() => {
                          if (action.input) {
                            setHostInputValue(action.input.initialValue ?? "");
                            setHostInputAction(action);
                          } else {
                            hostActions.onAction?.(action.id);
                          }
                        }}
                      >
                        {hostActionIcon(action.id) ?? (
                          <span className="whitespace-nowrap px-2 text-[11px]">
                            {action.label}
                          </span>
                        )}
                      </HostActionButton>
                    ))
                  : null}
                {hostActions.onAgentActions !== undefined || hostActions.actions?.length ? (
                  <HostActionButton
                    label="Agent Actions"
                    last
                    onClick={
                      hostActions.onAgentActions ??
                      (() => setHostActionsExpanded((value) => !value))
                    }
                  >
                    <IconDots aria-hidden="true" size={14} stroke={2} />
                  </HostActionButton>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col">
        {chat.view.kind === "ready" ? (
          <SessionChatMessageList
            hasMore={chat.hasMore}
            isWorking={chat.view.isWorking}
            loadingEarlier={chat.loadingEarlier}
            messages={chat.messages}
            onLoadEarlier={chat.loadEarlier}
          />
        ) : emptyKind ? (
          chat.view.kind === "error" ? (
            <EmptyState
              detail={sessionChatEmptyStateCopy("error").detail}
              spinning={false}
              title={sessionChatEmptyStateCopy("error").title}
            />
          ) : (
            <EmptyState
              detail={sessionChatEmptyStateCopy(emptyKind, agentLabel).detail}
              spinning={emptyKind === "loading" || emptyKind === "starting"}
              title={sessionChatEmptyStateCopy(emptyKind, agentLabel).title}
            />
          )
        ) : null}
      </div>
      <div className="mx-auto grid w-full max-w-3xl flex-none gap-2 px-4 pt-2 pb-3">
        <SessionChatInteractiveCard
          canSend={canSend}
          onAnswer={chat.answerPrompt}
          onInterrupt={interrupt}
          onShowingQuestionChange={setQuestionActive}
          prompt={chat.prompt}
        />
        {questionActive ? null : (
          <SessionChatComposer
            disabled={!canSend}
            isWorking={chat.working}
            monacoVsBaseUrl={monacoVsBaseUrl}
            onInterrupt={interrupt}
            onPasteImage={pasteImage}
            onSend={(text) => chat.send(text)}
            placeholder={canSend ? undefined : "Input is held by another device."}
            ref={composerRef}
            slashCommands={slashCommands}
            slashHeading={sessionChatSlashHeadingForAgent(agentLabel ?? null)}
          />
        )}
      </div>
    </div>
  );
}
