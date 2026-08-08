// SessionChatView — root layout (upstream chat spec §11.1 port): message list
// over an interactive-card slot over the composer. The question card replaces
// the composer while showing. Hosts inject a SessionChatTransport; everything
// else is derived by useSessionChat.

import { IconRobot } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { cn } from "../../lib/utils";
import { getDefaultSidebarAgentById } from "../../shared/sidebar-agents";
import { getBrandAgentLogoStyle } from "../agent-logos";
import { TooltipProvider } from "../app-tooltip";
import {
  SessionChatComposer,
  type SessionChatComposerHandle,
} from "./session-chat-composer";
import { sessionChatEmptyStateCopy } from "./session-chat-empty-state";
import {
  SessionChatHostActionsCluster,
  type SessionChatHostAction,
  type SessionChatHostActions,
} from "./session-chat-host-actions-cluster";
import { SessionChatImageViewerProvider } from "./session-chat-image-viewer";
import {
  SessionChatHostLinksProvider,
  type SessionChatHostLinks,
} from "./session-chat-links";
import { SessionChatInteractiveCard } from "./session-chat-interactive-card";
import { SessionChatMessageList } from "./session-chat-message-list";
import {
  SessionChatSessionOptionPills,
  useSessionChatSessionOptions,
} from "./session-chat-option-pills";
import { sessionChatOptionCommandNames } from "./session-chat-session-options";
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

export type { SessionChatHostAction, SessionChatHostActions, SessionChatHostLinks };

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
  /**
   * Stable identity of this conversation, used to persist the last chosen
   * session options (model/effort) per session. Hosts that cannot name the
   * session omit it, which simply means the pills start from the defaults.
   */
  sessionKey?: string;
  /** Top-right Terminal View / Agent Actions cluster (see the type doc). */
  hostActions?: SessionChatHostActions;
  /**
   * What the host does with links in the conversation (web URLs, machine file
   * paths). Omitted means browser defaults: URLs open in a new tab and file
   * paths are inert.
   */
  hostLinks?: SessionChatHostLinks;
  /**
   * Base URL of monaco-editor's min/vs directory on this surface; when set,
   * the composer input is a Monaco editor. Hosts that cannot serve Monaco's
   * sibling assets (the mobile single-file bundle) omit it.
   */
  monacoVsBaseUrl?: string;
  className?: string;
}

function EmptyState({
  detail,
  title,
}: {
  detail: string;
  title: string;
}) {
  return (
    <div className="ghostex-chat-empty-state">
      <div className="ghostex-chat-empty-title">{title}</div>
      <div className="ghostex-chat-empty-detail">{detail}</div>
    </div>
  );
}

function displayAgentName(agentLabel?: string | null): string | null {
  const normalized = agentLabel?.trim();
  if (!normalized) {
    return null;
  }
  return (
    getDefaultSidebarAgentById(normalized)?.name ??
    normalized
      .replace(/[-_]+/g, " ")
      .replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase())
  );
}

function NewSessionWelcome({ agentLabel }: { agentLabel?: string | null }) {
  const agent = agentLabel ? getDefaultSidebarAgentById(agentLabel) : undefined;
  const agentName = displayAgentName(agentLabel);

  return (
    <div className="ghostex-chat-new-session">
      <div
        aria-label={agentName ?? "Agent"}
        className="ghostex-chat-new-session-agent"
        role="img"
      >
        {agent?.icon ? (
          <span
            aria-hidden="true"
            className="ghostex-chat-new-session-agent-logo"
            style={getBrandAgentLogoStyle(agent.icon)}
          />
        ) : (
          <IconRobot aria-hidden="true" size={28} stroke={1.7} />
        )}
      </div>
      <div className="ghostex-chat-new-session-title">
        {agentName ? (
          <>
            What should we build with{" "}
            <span className="ghostex-chat-new-session-agent-name">{agentName}</span>?
          </>
        ) : (
          "What should we work on?"
        )}
      </div>
    </div>
  );
}

export function SessionChatView({
  agentLabel,
  canSend = true,
  className,
  commandCatalog,
  hostActions,
  hostLinks,
  monacoVsBaseUrl,
  previewText,
  sessionKey,
  transport,
  working,
}: SessionChatViewProps) {
  const slashCommands = useMemo(
    () => sessionChatSlashCommandsForAgent(agentLabel ?? null),
    [agentLabel],
  );
  // The option pills type commands the "/" picker does not offer (/effort,
  // /fast). They still have to classify as commands so a dispatched pill
  // renders the same muted "Ran /model sonnet" row a typed one does.
  const slashCommandNames = useMemo(
    () => [
      ...slashCommands.map((command) => command.name),
      ...sessionChatOptionCommandNames(agentLabel ?? null),
    ],
    [agentLabel, slashCommands],
  );
  const chat = useSessionChat({
    commandCatalog: commandCatalog ?? slashCommandNames,
    previewText,
    transport,
    working,
  });
  const sessionOptions = useSessionChatSessionOptions({
    agent: agentLabel ?? null,
    ...(sessionKey !== undefined ? { sessionKey } : {}),
  });
  /*
  What the agent is actually running, confirmed by gxserver from structured
  transcript metadata and the terminal statusline. Keyed on detectedAt so a
  repeated identical detection does not re-run the fold.
  */
  const applyDetectedOptions = sessionOptions.applyDetected;
  const detectedOptions = chat.selectedOptions;
  const detectedAt = detectedOptions?.detectedAt ?? null;
  useEffect(() => {
    if (!detectedOptions || detectedAt === null) {
      return;
    }
    applyDetectedOptions(detectedOptions);
    // detectedOptions is re-created per frame; detectedAt identifies the read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyDetectedOptions, detectedAt]);
  const composerRef = useRef<SessionChatComposerHandle | null>(null);
  const pasteImage = useMemo(() => {
    const saveImage = transport.saveImage?.bind(transport);
    return saveImage
      ? async (payload: { base64Data: string; suggestedName?: string }) =>
          (await saveImage(payload)).path
      : undefined;
  }, [transport]);
  const attachFile = useMemo(() => {
    const saveAttachment = transport.saveAttachment?.bind(transport);
    return saveAttachment
      ? async (payload: { base64Data: string; suggestedName?: string }) =>
          (await saveAttachment(payload)).path
      : undefined;
  }, [transport]);
  const pickPaths = useMemo(() => {
    const pickAttachmentPaths = transport.pickAttachmentPaths?.bind(transport);
    return pickAttachmentPaths ? () => pickAttachmentPaths() : undefined;
  }, [transport]);
  // Machine-path image bytes as a data URL: chat-log overlay + picked-image
  // composer thumbnails both read through it.
  const loadImageDataUrl = useMemo(() => {
    const loadImage = transport.loadImage?.bind(transport);
    return loadImage
      ? async (path: string) => {
          const result = await loadImage({ path });
          return `data:${result.mediaType};base64,${result.base64Data}`;
        }
      : undefined;
  }, [transport]);
  const [questionActive, setQuestionActive] = useState(false);

  const interrupt = useCallback((): void => {
    void chat.interrupt();
  }, [chat]);

  // A command the user types themselves reconciles the pills (§1.4), so the
  // Model pill follows a hand-typed "/model opus" without a second dispatch.
  const chatSend = chat.send;
  const reconcileTypedCommand = sessionOptions.reconcileTypedCommand;
  const send = useCallback(
    (text: string): Promise<void> => {
      reconcileTypedCommand(text);
      return chatSend(text);
    },
    [chatSend, reconcileTypedCommand],
  );

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
  const showNewSessionWelcome =
    emptyKind === "loading" || emptyKind === "starting" || emptyKind === "empty";

  return (
    <TooltipProvider>
      <div
        className={cn(
        // The app theme zeroes --radius for its square chrome; restore the
        // shadcn default inside the chat so bubbles and cards keep their
        // rounded look. The scope class lifts the SquareTheme border-radius
        // override (sidebar/styles.css) for controls inside the chat.
        "ghostex-session-chat-scope relative flex h-full min-h-0 flex-col bg-background text-foreground outline-none [--radius:0.625rem]",
        className,
      )}
        onKeyDownCapture={handleKeyDownCapture}
        tabIndex={-1}
      >
      <SessionChatImageViewerProvider
        {...(loadImageDataUrl ? { loadImage: loadImageDataUrl } : {})}
      >
      <SessionChatHostLinksProvider {...(hostLinks ? { links: hostLinks } : {})}>
      {hostActions ? (
        <SessionChatHostActionsCluster hostActions={hostActions} surface="chat" />
      ) : null}
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col",
          showNewSessionWelcome && "justify-center",
        )}
      >
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col",
          showNewSessionWelcome && "flex-none",
        )}
      >
        {chat.view.kind === "ready" ? (
          <SessionChatMessageList
            hasMore={chat.hasMore}
            isWorking={chat.view.isWorking}
            loadingEarlier={chat.loadingEarlier}
            messages={chat.messages}
            onLoadEarlier={chat.loadEarlier}
          />
        ) : showNewSessionWelcome ? (
          <NewSessionWelcome agentLabel={agentLabel} />
        ) : emptyKind ? (
          chat.view.kind === "error" ? (
            <EmptyState
              detail={sessionChatEmptyStateCopy("error").detail}
              title={sessionChatEmptyStateCopy("error").title}
            />
          ) : (
            <EmptyState
              detail={sessionChatEmptyStateCopy(emptyKind, agentLabel).detail}
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
          onSwitchToTerminal={hostActions?.onSwitchToTerminal}
          prompt={chat.prompt}
        />
        {questionActive ? null : (
          <SessionChatComposer
            disabled={!canSend}
            isWorking={chat.working}
            monacoVsBaseUrl={monacoVsBaseUrl}
            onAttachFile={attachFile}
            onInterrupt={interrupt}
            onLoadImagePreview={loadImageDataUrl}
            onPasteImage={pasteImage}
            onPickPaths={pickPaths}
            onSend={send}
            optionPills={
              <SessionChatSessionOptionPills
                canSend={canSend}
                canSendKey={chat.sendKey !== undefined}
                controller={sessionOptions}
                isWorking={chat.working}
                onDispatchCommand={send}
                onDispatchKey={async (key, marker) => {
                  await chat.sendKey?.(key, marker);
                }}
                {...(hostActions?.onSwitchToTerminal
                  ? { onSwitchToTerminal: hostActions.onSwitchToTerminal }
                  : {})}
              />
            }
            placeholder={canSend ? undefined : "Input is held by another device."}
            ref={composerRef}
            slashCommands={slashCommands}
            slashHeading={sessionChatSlashHeadingForAgent(agentLabel ?? null)}
          />
        )}
      </div>
      </div>
      </SessionChatHostLinksProvider>
      </SessionChatImageViewerProvider>
      </div>
    </TooltipProvider>
  );
}
