// useSessionChat — host-agnostic session-chat state machine.
// Consumes an injected SessionChatTransport; implements the seed read, frame
// folding with epoch/seq rules (drop dup seq, resnapshot on gap/epoch
// change), the 60s not-found/starting retry patience (orca §5.13),
// load-earlier pagination, optimistic sends, and status derivation.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  GxserverAnswerSessionChatPromptParams,
  GxserverReadSessionChatResult,
  GxserverSessionChatEvent,
  SessionChatInteractivePrompt,
  SessionChatMessage,
  SessionChatStatus,
  SessionChatTurnLifecycle,
} from "../../shared/session-chat";
import {
  applySessionChatAppends,
  createIncrementalSessionChatAssembler,
  resetIncrementalSessionChatAssembler,
  sessionChatSharesPrefix,
} from "./session-chat-assembler";
import {
  applySessionChatMergerAppend,
  createSessionChatMerger,
  replaceSessionChatMergerList,
  type SessionChatMerger,
} from "./session-chat-merge";
import {
  appendSessionChatCommandMarker,
  applySessionChatCommandMarkerBoundaries,
  assignSessionChatPendingOccurrence,
  nextSessionChatPendingSendId,
  pruneSessionChatPendingSends,
  SESSION_CHAT_PENDING_SEND_LIMIT,
  sessionChatCommandMarkersAsMessages,
  sessionChatPendingSendsAsMessages,
  visibleSessionChatPendingSends,
  type SessionChatCommandMarker,
  type SessionChatPendingSend,
} from "./session-chat-pending";
import {
  SESSION_CHAT_INITIAL_LIMIT,
  SESSION_CHAT_PAGE,
} from "./session-chat-pagination";
import {
  classifySessionChatSend,
  SESSION_CHAT_DEFAULT_COMMAND_CATALOG,
} from "./session-chat-send-classification";
import {
  deriveSessionChatStreamingText,
  sessionChatStreamingMessage,
} from "./session-chat-streaming";
import { surfaceSkillInvocationUserTurns } from "./session-chat-command-envelope";
import type { SessionChatTransport } from "./session-chat-transport";
import {
  selectSessionChatViewState,
  type SessionChatViewState,
} from "./session-chat-view-state";
import { deriveSessionChatWorkingOverride } from "./session-chat-working-status";

// Client-side not-found/starting retry patience (orca §5.13).
const NOTFOUND_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000] as const;
const NOTFOUND_RETRY_FIXED_DELAY_MS = 10_000;
const NOTFOUND_RETRY_WINDOW_MS = 60_000;

function notFoundRetryDelayMs(attempt: number): number {
  return NOTFOUND_RETRY_DELAYS_MS[attempt] ?? NOTFOUND_RETRY_FIXED_DELAY_MS;
}

interface FrameState {
  epoch: number | null;
  seq: number;
  frameArrived: boolean;
}

export interface UseSessionChatOptions {
  transport: SessionChatTransport;
  /** Live assistant preview text from the host's hook status, if available. */
  previewText?: string | null;
  /** Optional external live-work signal merged with the server status. */
  working?: boolean;
  /** Verified command catalog for local "Ran /x" markers. */
  commandCatalog?: readonly string[];
  initialLimit?: number;
}

export interface UseSessionChatResult {
  view: SessionChatViewState;
  status: SessionChatStatus;
  /** Composed list: transcript + markers + streaming bubble + pending echoes. */
  messages: SessionChatMessage[];
  lifecycle: SessionChatTurnLifecycle | null;
  prompt: SessionChatInteractivePrompt | null;
  working: boolean;
  agent: string | null;
  agentSessionId: string | null;
  error: string | null;
  hasMore: boolean;
  loadingEarlier: boolean;
  loadEarlier: () => void;
  send: (text: string, imagePaths?: string[]) => Promise<void>;
  answerPrompt: (
    params: Omit<GxserverAnswerSessionChatPromptParams, "projectId" | "sessionId">,
  ) => Promise<void>;
  interrupt: () => Promise<void>;
}

export function useSessionChat(options: UseSessionChatOptions): UseSessionChatResult {
  const {
    commandCatalog = SESSION_CHAT_DEFAULT_COMMAND_CATALOG,
    initialLimit = SESSION_CHAT_INITIAL_LIMIT,
    previewText = null,
    transport,
    working: externalWorking = false,
  } = options;

  const [transcript, setTranscript] = useState<readonly SessionChatMessage[]>([]);
  const [serverStatus, setServerStatus] = useState<SessionChatStatus>("loading");
  const [lifecycle, setLifecycle] = useState<SessionChatTurnLifecycle | null>(null);
  const [prompt, setPrompt] = useState<SessionChatInteractivePrompt | null>(null);
  const [agent, setAgent] = useState<string | null>(null);
  const [agentSessionId, setAgentSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [pending, setPending] = useState<readonly SessionChatPendingSend[]>([]);
  const [markers, setMarkers] = useState<readonly SessionChatCommandMarker[]>([]);
  const [interrupted, setInterrupted] = useState(false);

  const mergerRef = useRef<SessionChatMerger>(createSessionChatMerger());
  const assemblerRef = useRef(createIncrementalSessionChatAssembler());
  const appliedRef = useRef<readonly SessionChatMessage[]>([]);
  const frameStateRef = useRef<FrameState>({ epoch: null, frameArrived: false, seq: 0 });
  const limitRef = useRef(initialLimit);
  const beforeOffsetRef = useRef(0);
  const closedRef = useRef(false);
  const resyncInFlightRef = useRef(false);
  const loadEarlierEpochRef = useRef<number | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workingRef = useRef(false);

  const applyAuthoritative = useCallback(
    (result: {
      messages: SessionChatMessage[];
      lifecycle?: SessionChatTurnLifecycle;
      hasMore: boolean;
      beforeOffset: number;
      status: SessionChatStatus;
      prompt?: SessionChatInteractivePrompt;
      agent?: string;
      agentSessionId?: string;
      error?: string;
    }): void => {
      replaceSessionChatMergerList(mergerRef.current, result.messages);
      setTranscript(mergerRef.current.list);
      setLifecycle(result.lifecycle ?? null);
      setHasMore(result.hasMore);
      beforeOffsetRef.current = result.beforeOffset;
      setServerStatus(result.status);
      setPrompt(result.prompt ?? null);
      if (result.agent !== undefined) {
        setAgent(result.agent);
      }
      setAgentSessionId(result.agentSessionId ?? null);
      setError(result.status === "error" ? (result.error ?? "Conversation could not be loaded.") : null);
      // A fresh authoritative generation cancels an in-flight older page.
      loadEarlierEpochRef.current = null;
      setLoadingEarlier(false);
    },
    [],
  );

  const requestResync = useCallback((): void => {
    if (resyncInFlightRef.current || closedRef.current) {
      return;
    }
    resyncInFlightRef.current = true;
    void transport
      .read({ limit: limitRef.current })
      .then((result) => {
        if (closedRef.current) {
          return;
        }
        const frameState = frameStateRef.current;
        frameState.epoch = result.epoch;
        frameState.seq = result.seq;
        applyAuthoritative(result);
      })
      .catch(() => {
        if (!closedRef.current) {
          setError("Conversation could not be loaded.");
          setServerStatus("error");
        }
      })
      .finally(() => {
        resyncInFlightRef.current = false;
      });
  }, [applyAuthoritative, transport]);

  useEffect(() => {
    closedRef.current = false;
    const frameState: FrameState = { epoch: null, frameArrived: false, seq: 0 };
    frameStateRef.current = frameState;
    mergerRef.current = createSessionChatMerger();
    assemblerRef.current = createIncrementalSessionChatAssembler();
    appliedRef.current = [];
    limitRef.current = initialLimit;
    beforeOffsetRef.current = 0;
    setTranscript([]);
    setServerStatus("loading");
    setLifecycle(null);
    setPrompt(null);
    setAgentSessionId(null);
    setError(null);
    setHasMore(false);
    setLoadingEarlier(false);
    setPending([]);
    setMarkers([]);
    setInterrupted(false);

    const acceptSequencedFrame = (event: {
      epoch: number;
      seq: number;
    }): "apply" | "drop" | "resync" => {
      if (frameState.epoch !== null && event.epoch === frameState.epoch) {
        if (event.seq <= frameState.seq) {
          return "drop";
        }
        if (event.seq === frameState.seq + 1) {
          frameState.seq = event.seq;
          return "apply";
        }
      }
      return "resync";
    };

    const onEvent = (event: GxserverSessionChatEvent): void => {
      if (closedRef.current) {
        return;
      }
      if (event.type === "sessionChatSnapshot" || event.type === "sessionChatReplaced") {
        frameState.epoch = event.epoch;
        frameState.seq = event.seq;
        frameState.frameArrived = true;
        applyAuthoritative(event);
        return;
      }
      const verdict = acceptSequencedFrame(event);
      if (verdict === "drop") {
        return;
      }
      if (verdict === "resync") {
        requestResync();
        return;
      }
      if (event.type === "sessionChatAppended") {
        if (event.messages.length > 0) {
          applySessionChatMergerAppend(mergerRef.current, event.messages, limitRef.current);
          setTranscript(mergerRef.current.list);
        }
        if (event.lifecycle) {
          setLifecycle(event.lifecycle);
        }
        return;
      }
      // sessionChatState
      setServerStatus(event.status);
      if (event.lifecycle) {
        setLifecycle(event.lifecycle);
      }
      setPrompt(event.prompt ?? null);
      if (event.agentSessionId !== undefined) {
        setAgentSessionId(event.agentSessionId);
      }
    };

    const unsubscribe = transport.subscribe({ onEvent });

    // Seed read: independent of the subscription; permanently outranked by
    // the first snapshot/replacement frame.
    const startedAt = Date.now();
    let attempt = 0;
    const scheduleRetry = (run: () => void): void => {
      retryTimerRef.current = setTimeout(run, notFoundRetryDelayMs(attempt));
      attempt += 1;
    };
    const seedRead = (): void => {
      void transport
        .read({ limit: limitRef.current })
        .then((result: GxserverReadSessionChatResult) => {
          if (closedRef.current || frameState.frameArrived) {
            return;
          }
          frameState.epoch = result.epoch;
          frameState.seq = result.seq;
          applyAuthoritative(result);
          if (
            result.status === "starting" &&
            Date.now() - startedAt < NOTFOUND_RETRY_WINDOW_MS
          ) {
            scheduleRetry(seedRead);
          }
        })
        .catch(() => {
          if (closedRef.current || frameState.frameArrived) {
            return;
          }
          if (Date.now() - startedAt < NOTFOUND_RETRY_WINDOW_MS) {
            scheduleRetry(seedRead);
            return;
          }
          setError("Conversation could not be loaded.");
          setServerStatus("error");
        });
    };
    seedRead();

    return () => {
      closedRef.current = true;
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      unsubscribe();
    };
  }, [applyAuthoritative, initialLimit, requestResync, transport]);

  // --- Assembly (suffix-extension fast path, §6.4) ---------------------------
  const assembled = useMemo(() => {
    const assembler = assemblerRef.current;
    const applied = appliedRef.current;
    const isSuffixExtension =
      transcript.length >= applied.length &&
      sessionChatSharesPrefix(transcript, applied, applied.length);
    if (isSuffixExtension && transcript.length > applied.length) {
      applySessionChatAppends(assembler, transcript.slice(applied.length));
    } else if (!isSuffixExtension) {
      resetIncrementalSessionChatAssembler(assembler, transcript);
    }
    appliedRef.current = transcript;
    return assembler.messages;
  }, [transcript]);

  const catalogSet = useMemo(() => new Set(commandCatalog), [commandCatalog]);

  const surfaced = useMemo(
    () => surfaceSkillInvocationUserTurns(assembled, catalogSet),
    [assembled, catalogSet],
  );

  const boundaried = useMemo(
    () => applySessionChatCommandMarkerBoundaries(surfaced, markers),
    [markers, surfaced],
  );

  // --- Pending prune against the authoritative list --------------------------
  useEffect(() => {
    setPending((current) => {
      if (current.length === 0) {
        return current;
      }
      const next = pruneSessionChatPendingSends(current, boundaried);
      return next === current ? current : next;
    });
  }, [boundaried]);

  // --- Working / status derivation -------------------------------------------
  const workingSignal = serverStatus === "working" || externalWorking === true;
  const workingOverride = deriveSessionChatWorkingOverride({
    lifecycle,
    transcriptMessages: transcript,
    working: workingSignal,
    workingStartedAt: null,
  });
  const working = workingOverride === "working" && !interrupted;
  workingRef.current = working;

  // Clear the Stop suppression once the live signal settles (§10.5).
  useEffect(() => {
    if (!workingSignal && interrupted) {
      setInterrupted(false);
    }
  }, [interrupted, workingSignal]);

  const status: SessionChatStatus = error
    ? "error"
    : working
      ? "working"
      : serverStatus === "working"
        ? "ready"
        : serverStatus;

  // --- Composition (§11.1 order: markers → streaming → pending) --------------
  const messages = useMemo(() => {
    const markerMessages = sessionChatCommandMarkersAsMessages(markers);
    const pendingMessages = sessionChatPendingSendsAsMessages(
      visibleSessionChatPendingSends(pending, boundaried),
    );
    const tail: SessionChatMessage[] = [...markerMessages];
    const streamingText = deriveSessionChatStreamingText({
      messages: [...boundaried, ...pendingMessages],
      previewText,
      working,
    });
    if (streamingText) {
      tail.push(sessionChatStreamingMessage(streamingText));
    }
    tail.push(...pendingMessages);
    return [...boundaried, ...tail];
  }, [boundaried, markers, pending, previewText, working]);

  const view = selectSessionChatViewState({
    error,
    hasKnownAgentSession: agentSessionId !== null,
    messageCount: messages.length,
    status,
  });

  // --- Actions ----------------------------------------------------------------
  const loadEarlier = useCallback((): void => {
    if (loadingEarlier || !hasMore || closedRef.current) {
      return;
    }
    setLoadingEarlier(true);
    const requestEpoch = frameStateRef.current.epoch;
    loadEarlierEpochRef.current = requestEpoch;
    void transport
      .read({ beforeOffset: beforeOffsetRef.current, limit: SESSION_CHAT_PAGE })
      .then((result) => {
        if (closedRef.current || loadEarlierEpochRef.current !== requestEpoch) {
          return;
        }
        if (frameStateRef.current.epoch !== requestEpoch) {
          // A replacement rebuilt the tail while this page was in flight.
          return;
        }
        const merger = mergerRef.current;
        const older = result.messages.filter(
          (message) => !merger.indexById.has(message.id),
        );
        // Grow the retained window so future append bounding cannot trim the
        // freshly loaded history.
        limitRef.current += SESSION_CHAT_PAGE;
        replaceSessionChatMergerList(merger, [...older, ...merger.list]);
        setTranscript(merger.list);
        setHasMore(result.hasMore);
        beforeOffsetRef.current = result.beforeOffset;
        // Older pages never rewind the live lifecycle or status.
      })
      .finally(() => {
        if (!closedRef.current && loadEarlierEpochRef.current === requestEpoch) {
          setLoadingEarlier(false);
          loadEarlierEpochRef.current = null;
        }
      });
  }, [hasMore, loadingEarlier, transport]);

  const send = useCallback(
    async (text: string, imagePaths?: string[]): Promise<void> => {
      const classification = classifySessionChatSend(text, commandCatalog);
      let pendingId: string | null = null;
      if (
        classification === "chat" &&
        (text.trim().length > 0 || (imagePaths?.length ?? 0) > 0)
      ) {
        const last = mergerRef.current.list.at(-1);
        const id = nextSessionChatPendingSendId();
        pendingId = id;
        const baseEntry: SessionChatPendingSend = {
          afterMessageId: last?.id ?? null,
          afterMessageTimestamp: last?.timestamp ?? null,
          id,
          imagePaths,
          sentAt: Date.now(),
          text,
        };
        setPending((current) => {
          const entry = assignSessionChatPendingOccurrence(current, baseEntry);
          const next = [...current, entry];
          return next.length > SESSION_CHAT_PENDING_SEND_LIMIT
            ? next.slice(next.length - SESSION_CHAT_PENDING_SEND_LIMIT)
            : next;
        });
      } else if (classification === "command") {
        setMarkers((current) => appendSessionChatCommandMarker(current, text.trim()));
      }
      try {
        await transport.send(text, imagePaths);
      } catch (sendError) {
        if (pendingId !== null) {
          const dropId = pendingId;
          setPending((current) => current.filter((entry) => entry.id !== dropId));
        }
        throw sendError;
      }
    },
    [commandCatalog, transport],
  );

  const answerPrompt = useCallback(
    async (
      params: Omit<GxserverAnswerSessionChatPromptParams, "projectId" | "sessionId">,
    ): Promise<void> => {
      await transport.answerPrompt(params);
    },
    [transport],
  );

  const interrupt = useCallback(async (): Promise<void> => {
    if (workingRef.current) {
      // Stop: suppress the spinner and drop optimistic echoes — the delayed
      // server-side Enter may never fire, so the echo would be a ghost bubble.
      setInterrupted(true);
      setPending([]);
    }
    await transport.interrupt();
  }, [transport]);

  return {
    agent,
    agentSessionId,
    answerPrompt,
    error,
    hasMore,
    interrupt,
    lifecycle,
    loadEarlier,
    loadingEarlier,
    messages,
    prompt,
    send,
    status,
    view,
    working,
  };
}
