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
