// Session chat composer (upstream chat spec §1.1/§11.6 port). Enter sends,
// Shift+Enter inserts a newline, Escape interrupts, the IME guard swallows
// composition Enter, and ArrowUp/Down recall draft history. Typing a
// line-leading "/" opens the slash-command picker (per-agent catalog):
// ArrowUp/Down highlight, Tab/Enter complete, Enter on an exact match sends,
// Escape dismisses the picker without interrupting.
//
// Layout (§1.1): input row, then a footer row — [+] attach on the left,
// session-option pills and the Send/Stop button on the right. Styled with
// shadcn tokens to sit under the shadcn chat conversation.

import {
  IconArrowUp,
  IconLoader2,
  IconPlayerStopFilled,
  IconPlus,
  IconRobot,
  IconX,
} from "@tabler/icons-react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "../../lib/utils";
import { Button } from "../../components/ui/button";
import {
  EMPTY_SESSION_CHAT_COMPOSER_HISTORY,
  pushSessionChatComposerHistory,
  recallNextSessionChatDraft,
  recallPreviousSessionChatDraft,
  resetSessionChatComposerHistoryIndex,
} from "./session-chat-composer-state";
import {
  filterSessionChatSlashCommands,
  sessionChatSlashQuery,
  type SessionChatSlashCommand,
} from "./session-chat-slash-commands";
import { SessionChatMonacoInput } from "./session-chat-monaco-input";

export interface SessionChatComposerHandle {
  focus: () => void;
  /** Insert text at the caret; returns false when the composer cannot take it. */
  insertTypedText: (text: string) => boolean;
}

/**
 * Backend-neutral key event: the textarea path adapts React's KeyboardEvent,
 * the Monaco path adapts monaco's IKeyboardEvent (whose preventDefault also
 * stops monaco's own handling of the key).
 */
export interface SessionChatComposerKeyEvent {
  altKey: boolean;
  ctrlKey: boolean;
  isComposing: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
  preventDefault: () => void;
}

/**
 * Imperative surface of the active input backend. `draft` state stays the
 * source of truth; applyValue only synchronizes the visual input (and caret)
 * after the composer has already updated the draft itself.
 */
export interface SessionChatComposerInputApi {
  applyValue: (next: string, caret: number) => void;
  focus: () => void;
  getSelection: () => { end: number; start: number };
  getValue: () => string;
  insertText: (text: string) => boolean;
}

export interface SessionChatComposerProps {
  disabled?: boolean;
  isWorking: boolean;
  placeholder?: string;
  /** Agent slash commands offered by the "/" picker; empty disables it. */
  slashCommands?: readonly SessionChatSlashCommand[];
  /** Section heading shown above the picker rows (usually the agent name). */
  slashHeading?: string;
  onSend: (text: string) => void | Promise<void>;
  onInterrupt: () => void;
  /**
   * Saves a pasted image onto the session's machine and resolves with the
   * absolute path there. When set, pasting an image inserts the terminal
   * paste reference "[Image #N](path)" and shows a preview thumbnail above
   * the input; when omitted, image pastes fall through untouched.
   */
  onPasteImage?: (payload: {
    base64Data: string;
    suggestedName?: string;
  }) => Promise<string>;
  /**
   * Session-option pills rendered in the footer, left of Send (§1.1). The view
   * builds them so the composer stays about input mechanics; agents without an
   * option catalog pass nothing.
   */
  optionPills?: ReactNode;
  /**
   * Base URL of monaco-editor's min/vs directory on this surface. When set,
   * the input is a Monaco editor (editing hotkeys work); when omitted (the
   * mobile single-file bundle, where Monaco's sibling assets are
   * unreachable), the plain textarea renders instead.
   */
  monacoVsBaseUrl?: string;
}

interface PastedImagePreview {
  dataUrl: string;
  id: string;
  path: string;
}

/** Rich Prompt Editor numbering: max existing [Image #N]( in the draft, +1. */
function nextImageReferenceIndex(text: string): number {
  let highest = 0;
  for (const match of text.matchAll(/\[Image #(\d+)\]\(/g)) {
    const index = Number.parseInt(match[1] ?? "", 10);
    if (Number.isFinite(index)) {
      highest = Math.max(highest, index);
    }
  }
  return highest + 1;
}

function clipboardImageFiles(data: DataTransfer): File[] {
  const files: File[] = [];
  for (const item of Array.from(data.items)) {
    if (item.kind !== "file") {
      continue;
    }
    const file = item.getAsFile();
    if (
      file &&
      (file.type.startsWith("image/") ||
        /\.(avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|tiff?|webp)$/i.test(file.name))
    ) {
      files.push(file);
    }
  }
  return files;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(reader.error ?? new Error("Could not read the pasted image."));
    reader.readAsDataURL(file);
  });
}

function reactKeyEventAdapter(
  event: KeyboardEvent<HTMLTextAreaElement>,
): SessionChatComposerKeyEvent {
  return {
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    isComposing: event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229,
    key: event.key,
    metaKey: event.metaKey,
    preventDefault: () => event.preventDefault(),
    shiftKey: event.shiftKey,
  };
}

export const SessionChatComposer = forwardRef<
  SessionChatComposerHandle,
  SessionChatComposerProps
>(function SessionChatComposer(
  {
    disabled = false,
    isWorking,
    monacoVsBaseUrl,
    onInterrupt,
    onPasteImage,
    onSend,
    optionPills,
    placeholder,
    slashCommands,
    slashHeading,
  },
  ref,
) {
  const [draft, setDraft] = useState("");
  const [history, setHistory] = useState(EMPTY_SESSION_CHAT_COMPOSER_HISTORY);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const [pastedImages, setPastedImages] = useState<readonly PastedImagePreview[]>([]);
  const [pendingImagePastes, setPendingImagePastes] = useState(0);
  const [monacoFailed, setMonacoFailed] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const slashListRef = useRef<HTMLDivElement | null>(null);
  const pasteSequenceRef = useRef(0);
  const monacoApiRef = useRef<SessionChatComposerInputApi | null>(null);
  const useMonaco = monacoVsBaseUrl !== undefined && !monacoFailed;

  // Previews mirror the draft: deleting a reference (by any means, including
  // sending, which clears the draft) drops its thumbnail.
  useEffect(() => {
    setPastedImages((current) =>
      current.filter((image) => draft.includes(`](${image.path})`)),
    );
  }, [draft]);

  const slashQuery = sessionChatSlashQuery(draft);
  const slashMatches = useMemo(
    () =>
      slashQuery !== null && !slashDismissed && slashCommands !== undefined
        ? filterSessionChatSlashCommands(slashCommands, slashQuery)
        : [],
    [slashCommands, slashDismissed, slashQuery],
  );
  const slashOpen = slashMatches.length > 0 && !disabled;
  const highlightedIndex = Math.min(slashIndex, Math.max(slashMatches.length - 1, 0));

  useEffect(() => {
    if (!slashOpen) {
      return;
    }
    slashListRef.current
      ?.querySelector('[data-highlighted="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex, slashOpen]);

  const updateDraft = (next: string): void => {
    setDraft(next);
    setHistory((current) => resetSessionChatComposerHistoryIndex(current));
    if (sessionChatSlashQuery(next) === null) {
      setSlashDismissed(false);
    }
    setSlashIndex(0);
  };

  const textareaApi: SessionChatComposerInputApi = {
    applyValue: (next, caret) => {
      // Value arrives through the controlled `draft`; only the caret needs
      // repositioning once React has committed it.
      requestAnimationFrame(() => {
        const clamped = Math.min(caret, next.length);
        textareaRef.current?.setSelectionRange(clamped, clamped);
      });
    },
    focus: () => textareaRef.current?.focus(),
    getSelection: () => {
      const textarea = textareaRef.current;
      const fallback = textarea?.value.length ?? draft.length;
      return {
        end: textarea?.selectionEnd ?? fallback,
        start: textarea?.selectionStart ?? fallback,
      };
    },
    getValue: () => textareaRef.current?.value ?? draft,
    insertText: (text) => {
      const textarea = textareaRef.current;
      if (!textarea) {
        return false;
      }
      const start = textarea.selectionStart ?? textarea.value.length;
      const end = textarea.selectionEnd ?? textarea.value.length;
      const next = `${textarea.value.slice(0, start)}${text}${textarea.value.slice(end)}`;
      updateDraft(next);
      textarea.focus();
      requestAnimationFrame(() => {
        const caret = start + text.length;
        textarea.setSelectionRange(caret, caret);
      });
      return true;
    },
  };

  // Resolved lazily: the Monaco backend registers its api into a ref after
  // an async load, without a re-render, so a render-scoped const would go
  // stale between load and the next state change.
  const getInputApi = (): SessionChatComposerInputApi | null =>
    useMonaco ? monacoApiRef.current : textareaApi;

  useImperativeHandle(ref, () => ({
    focus: () => {
      getInputApi()?.focus();
    },
    insertTypedText: (text: string): boolean => {
      if (disabled) {
        return false;
      }
      return getInputApi()?.insertText(text) ?? false;
    },
  }));

  const send = (text: string = draft): void => {
    if (text.trim() === "" || disabled) {
      return;
    }
    void onSend(text);
    setHistory((current) => pushSessionChatComposerHistory(current, text));
    setDraft("");
    getInputApi()?.applyValue("", 0);
    setSlashDismissed(false);
    setSlashIndex(0);
  };

  const insertImageReference = (path: string, dataUrl: string): void => {
    const api = getInputApi();
    const current = api?.getValue() ?? draft;
    const reference = `[Image #${nextImageReferenceIndex(current)}](${path})`;
    const { end, start } = api?.getSelection() ?? {
      end: current.length,
      start: current.length,
    };
    const needsLeadingSpace = start > 0 && !/\s/.test(current[start - 1] ?? "");
    const inserted = `${needsLeadingSpace ? " " : ""}${reference} `;
    const next = `${current.slice(0, start)}${inserted}${current.slice(end)}`;
    updateDraft(next);
    pasteSequenceRef.current += 1;
    setPastedImages((currentImages) => [
      ...currentImages,
      { dataUrl, id: `${path}#${pasteSequenceRef.current}`, path },
    ]);
    api?.focus();
    api?.applyValue(next, start + inserted.length);
  };

  const removePastedImage = (image: PastedImagePreview): void => {
    const api = getInputApi();
    const current = api?.getValue() ?? draft;
    const escapedPath = image.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`\\s?\\[Image #\\d+\\]\\(${escapedPath}\\) ?`);
    const matchIndex = current.search(pattern);
    if (matchIndex < 0) {
      // The reference text is already gone; just drop the thumbnail.
      setPastedImages((images) => images.filter((entry) => entry.id !== image.id));
      return;
    }
    const next = current.replace(pattern, "");
    updateDraft(next);
    api?.applyValue(next, matchIndex);
  };

  /**
   * The one image intake path: clipboard paste and the footer's [+] button
   * both land here, so an attached file becomes the same "[Image #N](path)"
   * reference plus preview thumbnail a pasted one does.
   */
  const consumeImageFiles = (files: readonly File[]): void => {
    void (async () => {
      for (const file of files) {
        setPendingImagePastes((count) => count + 1);
        try {
          const dataUrl = await readFileAsDataUrl(file);
          const base64Data = dataUrl.split(",", 2)[1] ?? "";
          if (base64Data === "") {
            continue;
          }
          const path = await onPasteImage?.({
            base64Data,
            ...(file.name ? { suggestedName: file.name } : {}),
          });
          if (path !== undefined) {
            insertImageReference(path, dataUrl);
          }
        } catch (error) {
          console.error("[session-chat] image attach failed", error);
        } finally {
          setPendingImagePastes((count) => count - 1);
        }
      }
    })();
  };

  /** Returns true when the clipboard held images this composer consumed. */
  const processClipboardData = (data: DataTransfer): boolean => {
    if (!onPasteImage || disabled) {
      return false;
    }
    const files = clipboardImageFiles(data);
    if (files.length === 0) {
      return false;
    }
    consumeImageFiles(files);
    return true;
  };

  const completeSlashCommand = (command: SessionChatSlashCommand): void => {
    const next = `/${command.name}`;
    updateDraft(next);
    const api = getInputApi();
    api?.focus();
    api?.applyValue(next, next.length);
  };

  const handleSlashKeyDown = (event: SessionChatComposerKeyEvent): boolean => {
    if (!slashOpen) {
      return false;
    }
    const highlighted = slashMatches[highlightedIndex];
    if (event.key === "Escape") {
      event.preventDefault();
      setSlashDismissed(true);
      return true;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const delta = event.key === "ArrowUp" ? -1 : 1;
      setSlashIndex(
        (highlightedIndex + delta + slashMatches.length) % slashMatches.length,
      );
      return true;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      completeSlashCommand(highlighted);
      return true;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      // A fully typed (or previously completed) command sends immediately;
      // a partial token completes first so arguments can still be added.
      if (draft === `/${highlighted.name}`) {
        send();
      } else {
        completeSlashCommand(highlighted);
      }
      return true;
    }
    return false;
  };

  const handleKeyDown = (event: SessionChatComposerKeyEvent): void => {
    // IME guard: composition Enter confirms the composition; letting it fall
    // through would submit a partial draft. (The textarea wrapper additionally
    // preventDefaults composition Enter; Monaco manages its own IME.)
    if (event.isComposing) {
      return;
    }
    if (handleSlashKeyDown(event)) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onInterrupt();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
      return;
    }
    if (event.key === "ArrowUp" && (draft === "" || history.index !== null)) {
      const recalled = recallPreviousSessionChatDraft(history);
      if (recalled) {
        event.preventDefault();
        setHistory(recalled.history);
        setDraft(recalled.draft);
        getInputApi()?.applyValue(recalled.draft, recalled.draft.length);
      }
      return;
    }
    if (event.key === "ArrowDown" && history.index !== null) {
      const recalled = recallNextSessionChatDraft(history);
      if (recalled) {
        event.preventDefault();
        setHistory(recalled.history);
        setDraft(recalled.draft);
        getInputApi()?.applyValue(recalled.draft, recalled.draft.length);
      }
    }
  };

  const sendDisabled = isWorking ? false : disabled || draft.trim() === "";

  return (
    <div className="relative">
      {slashOpen ? (
        <div className="absolute inset-x-0 bottom-full z-10 mb-2 overflow-hidden rounded-2xl border border-input bg-popover shadow-xl">
          <div
            className="max-h-72 overflow-y-auto p-1.5"
            ref={slashListRef}
            role="listbox"
            aria-label="Slash commands"
          >
            <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {slashHeading ?? "Commands"}
            </div>
            {slashMatches.map((command, index) => (
              <button
                aria-selected={index === highlightedIndex}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm",
                  index === highlightedIndex
                    ? "bg-accent text-accent-foreground"
                    : "text-foreground",
                )}
                data-highlighted={index === highlightedIndex ? "true" : undefined}
                key={command.name}
                onMouseDown={(event) => {
                  // Keep textarea focus; complete on the same gesture.
                  event.preventDefault();
                  completeSlashCommand(command);
                }}
                onMouseMove={() => {
                  if (index !== highlightedIndex) {
                    setSlashIndex(index);
                  }
                }}
                role="option"
                type="button"
              >
                <IconRobot
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground"
                  stroke={1.6}
                />
                <span className="shrink-0 font-semibold">/{command.name}</span>
                <span className="truncate text-muted-foreground">
                  {command.description}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div
        className={cn(
          "rounded-3xl border border-input bg-card px-4 py-2.5 transition-colors focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/20",
          disabled && "opacity-60",
        )}
        data-disabled={disabled ? "true" : undefined}
      >
        {pastedImages.length > 0 || pendingImagePastes > 0 ? (
          <div className="flex flex-wrap items-center gap-2 pb-2">
            {pastedImages.map((image) => (
              <div className="relative" key={image.id}>
                <img
                  alt="Pasted image"
                  className="h-12 w-12 rounded-lg border border-input object-cover"
                  src={image.dataUrl}
                />
                <button
                  aria-label="Remove image"
                  className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full border border-input bg-card text-muted-foreground hover:text-foreground"
                  onClick={() => removePastedImage(image)}
                  type="button"
                >
                  <IconX aria-hidden="true" size={10} stroke={2.4} />
                </button>
              </div>
            ))}
            {pendingImagePastes > 0 ? (
              <div
                aria-label="Saving pasted image"
                className="flex h-12 w-12 items-center justify-center rounded-lg border border-dashed border-input text-muted-foreground"
              >
                <IconLoader2
                  aria-hidden="true"
                  className="animate-spin"
                  size={16}
                  stroke={2}
                />
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="flex items-end gap-2 pb-1.5">
        {useMonaco ? (
          <SessionChatMonacoInput
            disabled={disabled}
            initialValue={draft}
            onChange={updateDraft}
            onKeyDown={handleKeyDown}
            onLoadFailed={(error) => {
              console.error(
                "[session-chat] Monaco failed to load; using the plain input.",
                error,
              );
              setMonacoFailed(true);
            }}
            onPasteData={processClipboardData}
            placeholder={placeholder ?? "Send a message…"}
            registerApi={(api) => {
              monacoApiRef.current = api;
            }}
            vsBaseUrl={monacoVsBaseUrl ?? ""}
          />
        ) : (
          <textarea
            className="max-h-40 min-h-6 flex-1 resize-none overflow-y-auto bg-transparent text-sm leading-6 text-foreground outline-none [field-sizing:content] placeholder:text-muted-foreground"
            disabled={disabled}
            onChange={(event) => {
              updateDraft(event.target.value);
            }}
            onKeyDown={(event) => {
              const adapted = reactKeyEventAdapter(event);
              if (adapted.isComposing) {
                if (adapted.key === "Enter") {
                  event.preventDefault();
                }
                return;
              }
              handleKeyDown(adapted);
            }}
            onPaste={(event) => {
              if (processClipboardData(event.clipboardData)) {
                event.preventDefault();
              }
            }}
            placeholder={placeholder ?? "Send a message…"}
            ref={textareaRef}
            rows={1}
            value={draft}
          />
        )}
        </div>
        <div className="flex w-full items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-0.5">
            {onPasteImage ? (
              <>
                <input
                  accept="image/*"
                  className="hidden"
                  multiple
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    // Same input element every time: clear it so re-picking
                    // the same file still fires change.
                    event.target.value = "";
                    if (files.length > 0) {
                      consumeImageFiles(files);
                    }
                  }}
                  ref={fileInputRef}
                  tabIndex={-1}
                  type="file"
                />
                <Button
                  aria-label="Attach image"
                  disabled={disabled}
                  onClick={() => fileInputRef.current?.click()}
                  size="icon-sm"
                  title="Attach image"
                  variant="ghost"
                >
                  <IconPlus aria-hidden="true" stroke={2} />
                </Button>
              </>
            ) : null}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            {optionPills}
            {isWorking ? (
              <Button
                aria-label="Stop the agent"
                className="size-8 rounded-full"
                onClick={() => {
                  onInterrupt();
                }}
                size="icon"
                variant="secondary"
              >
                <IconPlayerStopFilled
                  aria-hidden="true"
                  className="size-3.5"
                  stroke={1.6}
                />
              </Button>
            ) : (
              <Button
                aria-label="Send"
                className="size-8 rounded-full"
                disabled={sendDisabled}
                onClick={() => send()}
                size="icon"
              >
                <IconArrowUp aria-hidden="true" className="size-4" stroke={2.2} />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
