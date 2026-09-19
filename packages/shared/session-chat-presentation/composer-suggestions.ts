import type { SessionChatSkill } from '../session-chat';
import {
  detectSessionChatComposerTrigger,
  filterSessionChatFiles,
  filterSessionChatSkills,
} from '@/packages/core-ui/chat/session-chat-composer-trigger';
import {
  filterSessionChatSlashCommands,
  sessionChatSlashQuery,
  type SessionChatSlashCommand,
} from '@/packages/core-ui/chat/session-chat-slash-commands';
import popup from './composer-suggestions.json';

/**
 * The look of the `/`, `$` and `@` popup, in unzoomed CSS pixels.
 *
 * CDXC:SessionChat 2026-09-19 SEE-ALSO:
 * apps/desktop/src/app/native_chat/suggestions/layout.rs reads composer-suggestions.json through
 * include_str! and draws its child window from it. React's values exist only as Tailwind classes on
 * the three `.ghostex-chat-composer-picker` blocks in packages/core-ui/chat/session-chat-composer.tsx
 * (`inset-x-0 bottom-full mb-2 rounded-2xl border shadow-xl`, `max-h-72 p-1.5`, the `text-[10px]
 * tracking-[0.14em]` heading, `px-3 py-2 text-sm` rows on a `200px` label column, the
 * `size="sm"` Retry button) plus the 1px row outline from theme.css's legacy
 * `button:where(:not([data-slot]))` base; `shadows` is Tailwind's `shadow-xl`, and only the row
 * corners (`rowRadiusPx`) are read from here by React too. Change them together.
 */
export const SESSION_CHAT_SUGGESTION_POPUP = popup;

/**
 * Which corners of a pickable `/`, `$` or `@` row are rounded.
 *
 * CDXC:SessionChat 2026-09-19 DECISION:
 * User: "the rounding on each skill and mention row isn't nice here, please fix. maybe just round the very first skill in the list and the very last one from the bottom (but only round the corners not touching another row)". The rows read as one block: only the first row's top corners and the last row's bottom corners are rounded (a lone row keeps all four), for the row outline and the hover and selected fill alike. The count is the whole list, not the rows scrolled into view; the heading and the loading, empty or error line are not rows. `rowRadiusPx` is the popup's 18px corner less its 1px border and 6px padding, so the last row sits concentric with the popup. GPUI reads the same flags from the native projection (native-suggestions.ts).
 */
export function sessionChatSuggestionRowCorners(index: number, count: number) {
  return { roundTop: index === 0, roundBottom: index === count - 1 };
}

/** React's `border-radius` for the row at `index` of `count`. */
export function sessionChatSuggestionRowRadius(index: number, count: number): string {
  const { roundTop, roundBottom } = sessionChatSuggestionRowCorners(index, count);
  const top = roundTop ? popup.rowRadiusPx : 0;
  const bottom = roundBottom ? popup.rowRadiusPx : 0;
  return `${top}px ${top}px ${bottom}px ${bottom}px`;
}

/**
 * The heading above the composer's `@` file list.
 *
 * CDXC:SessionChat 2026-09-18 SEE-ALSO:
 * Read by React's composer (`session-chat-composer.tsx`) and by the native
 * projection (`session-chat-controller/native-suggestions.ts`), so the GPUI and
 * React pickers cannot drift apart on what the list is called.
 */
export const SESSION_CHAT_FILE_SUGGESTION_HEADING = 'Project files';

export interface ComposerSuggestionInput {
  draft: string;
  caret: number;
  slashCommands?: readonly SessionChatSlashCommand[];
  skills?: readonly SessionChatSkill[];
  files?: readonly string[];
  skillsLoading: boolean;
  skillsError?: string;
  canRequestSkills: boolean;
  filesLoading: boolean;
  slashDismissed: boolean;
  skillDismissed: boolean;
  fileDismissed: boolean;
}

export function composerSuggestions(input: ComposerSuggestionInput) {
  const { draft, caret, slashCommands, skills, files, slashDismissed, skillDismissed, fileDismissed } = input;
  const slashQuery = sessionChatSlashQuery(draft);
  const slashMatches =
    slashQuery !== null && !slashDismissed && slashCommands !== undefined
      ? filterSessionChatSlashCommands(slashCommands, slashQuery)
      : [];
  const slashOpen = slashMatches.length > 0;
  const trigger = detectSessionChatComposerTrigger(draft, caret);
  const skillQuery = trigger?.kind === 'skill' ? trigger.query : null;
  const skillMatches = skillQuery !== null && !skillDismissed ? filterSessionChatSkills(skills ?? [], skillQuery) : [];
  const skillPickerActive = skillQuery !== null && !skillDismissed && !slashOpen;
  const skillOpen =
    skillPickerActive &&
    (skillMatches.length > 0 ||
      input.skillsLoading ||
      !!input.skillsError ||
      (skills?.length === 0 && input.canRequestSkills));
  const fileQuery = trigger?.kind === 'path' ? trigger.query : null;
  const fileMatches = fileQuery !== null && !fileDismissed ? filterSessionChatFiles(files ?? [], fileQuery) : [];
  const filePickerActive = fileQuery !== null && !fileDismissed && !slashOpen;
  const fileOpen = filePickerActive && (fileMatches.length > 0 || (input.filesLoading && !files));
  return {
    slashQuery,
    slashMatches,
    slashOpen,
    trigger,
    skillQuery,
    skillMatches,
    skillPickerActive,
    skillOpen,
    fileQuery,
    fileMatches,
    filePickerActive,
    fileOpen,
  };
}

export function completeComposerMention(draft: string, caret: number, replacement: string) {
  const trigger = detectSessionChatComposerTrigger(draft, caret);
  return trigger
    ? {
        content: `${draft.slice(0, trigger.start)}${replacement}${draft.slice(trigger.end)}`,
        caret: trigger.start + replacement.length,
      }
    : null;
}

export function composerNativeCommand(commands: readonly SessionChatSlashCommand[] | undefined, text: string) {
  return commands?.find((command) => command.insertText !== undefined && text.trim() === `/${command.name}`)
    ?.insertText;
}
