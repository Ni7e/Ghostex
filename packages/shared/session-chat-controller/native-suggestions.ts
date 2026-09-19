import {
  SESSION_CHAT_FILE_SUGGESTION_HEADING,
  composerSuggestions,
  completeComposerMention,
  composerNativeCommand,
} from '../session-chat-presentation/composer-suggestions';
import { nextFileReferenceIndex } from '../session-chat-presentation/references';
import {
  detectSessionChatComposerTrigger,
  linkedSessionChatSkillMention,
  sessionChatDisplaySkillDirectoryPath,
  sessionChatFileBasename,
  sessionChatFileDirectory,
  sessionChatFileMention,
} from '@/packages/core-ui/chat/session-chat-composer-trigger';
import {
  sessionChatSlashCommandsForAgent,
  sessionChatSlashHeadingForAgent,
  sessionChatSlashQuery,
} from '@/packages/core-ui/chat/session-chat-slash-commands';
import { sessionChatWelcomeAgentName } from '../session-chat-presentation/new-session-welcome';
import type { SessionChatAvailableAgent } from '@/packages/shared/session-chat';
import type { computeSessionChatFiles } from './files';
import type { computeSessionChatSkills } from './skills';

type Sources = ReturnType<typeof computeSessionChatFiles> &
  ReturnType<typeof computeSessionChatSkills> & {
    agent: string | null;
    sessionAgentId?: string | null;
    availableAgents?: readonly SessionChatAvailableAgent[] | null;
  };

/**
 * The `$` list is headed with the agent's own display name ("Claude skills"), the way React heads
 * it in `session-chat-view.tsx`: a project custom agent's row name wins, because its own id has no
 * entry in the shared agent catalog. The `/` list keeps the catalog's product heading instead.
 */
function skillsHeading(sources: Sources): string {
  const row = sources.availableAgents?.find((agent) => agent.agentId === sources.sessionAgentId);
  return `${row?.name ?? sessionChatWelcomeAgentName(sources.agent) ?? 'Agent'} skills`;
}

export class NativeComposerSuggestions {
  private text = '';
  private caret = 0;
  private dismissed = { slashDismissed: false, skillDismissed: false, fileDismissed: false };
  private index = 0;
  private skillActive = false;
  private cachedMatches: { key: readonly unknown[]; value: ReturnType<typeof composerSuggestions> } | null = null;

  update(text: string, caret: number) {
    const previous = detectSessionChatComposerTrigger(this.text, this.caret);
    const next = detectSessionChatComposerTrigger(text, caret);
    if (next?.kind !== 'skill' || next.start !== previous?.start) this.dismissed.skillDismissed = false;
    if (next?.kind !== 'path' || next.start !== previous?.start) this.dismissed.fileDismissed = false;
    if (sessionChatSlashQuery(text) === null) this.dismissed.slashDismissed = false;
    if (this.text !== text || previous?.query !== next?.query || previous?.start !== next?.start) this.index = 0;
    this.text = text;
    this.caret = caret;
  }

  nativeCommand(sources: Sources) {
    return composerNativeCommand(sessionChatSlashCommandsForAgent(sources.agent), this.text) ?? null;
  }

  recall(text: string) {
    this.update(text, text.length);
    const trigger = detectSessionChatComposerTrigger(text, text.length);
    this.dismissed = {
      slashDismissed: true,
      skillDismissed: trigger?.kind === 'skill',
      fileDismissed: trigger?.kind === 'path',
    };
  }

  private matches(sources: Sources) {
    const key = [
      this.text,
      this.caret,
      sources.agent,
      sources.skills,
      sources.files,
      sources.skillsLoading,
      sources.skillsError,
      sources.filesLoading,
      this.dismissed.slashDismissed,
      this.dismissed.skillDismissed,
      this.dismissed.fileDismissed,
    ];
    if (this.cachedMatches && key.every((value, index) => Object.is(value, this.cachedMatches!.key[index])))
      return this.cachedMatches.value;
    const value = composerSuggestions({
      ...sources,
      ...this.dismissed,
      draft: this.text,
      caret: this.caret,
      canRequestSkills: true,
      slashCommands: sessionChatSlashCommandsForAgent(sources.agent),
    });
    this.cachedMatches = { key, value };
    return value;
  }

  projection(sources: Sources) {
    const matches = this.matches(sources);
    if (matches.skillPickerActive && !this.skillActive) sources.requestSkills();
    this.skillActive = matches.skillPickerActive;
    if (matches.filePickerActive && sources.files === undefined) sources.requestFiles();
    const kind = matches.slashOpen ? 'slash' : matches.skillOpen ? 'skill' : matches.fileOpen ? 'file' : null;
    if (!kind) return null;
    const rows =
      kind === 'slash'
        ? matches.slashMatches.map((command) => ({ label: `/${command.name}`, detail: command.description }))
        : kind === 'skill'
          ? matches.skillMatches.map((skill) => ({
              label: `$${skill.name}`,
              detail: sessionChatDisplaySkillDirectoryPath(skill.directoryPath),
            }))
          : matches.fileMatches.map((path) => ({
              label: sessionChatFileBasename(path),
              detail: sessionChatFileDirectory(path),
            }));
    return {
      kind,
      rows,
      selected: Math.min(this.index, Math.max(0, rows.length - 1)),
      sendOnEnter:
        kind === 'slash' &&
        !matches.slashMatches[Math.min(this.index, Math.max(0, rows.length - 1))]?.insertText &&
        this.text === rows[Math.min(this.index, Math.max(0, rows.length - 1))]?.label,
      heading:
        kind === 'slash'
          ? sessionChatSlashHeadingForAgent(sources.agent)
          : kind === 'skill'
            ? skillsHeading(sources)
            : SESSION_CHAT_FILE_SUGGESTION_HEADING,
      status:
        kind === 'skill'
          ? sources.skillsLoading
            ? 'Loading skills…'
            : sources.skillsError || (sources.skills?.length === 0 ? 'No skills available.' : null)
          : kind === 'file' && !rows.length
            ? 'Listing project files…'
            : null,
      retry: kind === 'skill' && !!sources.skillsError,
      // React turns a loader beside "Loading skills…" and "Listing project files…", and shows no
      // spinner beside the error row or "No skills available.".
      loading: kind === 'skill' ? sources.skillsLoading : kind === 'file' && !rows.length,
    };
  }

  command(command: { type: string; key?: string; index?: number }, sources: Sources) {
    const projection = this.projection(sources);
    if (!projection) return null;
    if (command.type === 'suggestionRetry') {
      sources.requestSkills();
      return null;
    }
    if (command.type === 'suggestionHighlight') {
      this.index = Math.max(0, Math.min(command.index ?? 0, projection.rows.length - 1));
      return null;
    }
    if (command.key === 'escape' || command.type === 'suggestionDismiss') {
      this.dismissed[
        projection.kind === 'slash'
          ? 'slashDismissed'
          : projection.kind === 'skill'
            ? 'skillDismissed'
            : 'fileDismissed'
      ] = true;
      return null;
    }
    if (!projection.rows.length) return null;
    if (command.key === 'up' || command.key === 'down') {
      this.index =
        (projection.selected + (command.key === 'up' ? -1 : 1) + projection.rows.length) % projection.rows.length;
      return null;
    }
    const index = command.index ?? projection.selected;
    const matches = this.matches(sources);
    if (projection.kind === 'slash') {
      const match = matches.slashMatches[index];
      if (!match) return null;
      if (!match.insertText && command.key === 'enter' && this.text === `/${match.name}`)
        return { send: true as const };
      const content = match.insertText ?? `/${match.name}`;
      return { content, caret: content.length };
    }
    const replacement =
      projection.kind === 'skill'
        ? matches.skillMatches[index] && linkedSessionChatSkillMention(matches.skillMatches[index])
        : matches.fileMatches[index] &&
          sessionChatFileMention(matches.fileMatches[index], nextFileReferenceIndex(this.text));
    return replacement ? completeComposerMention(this.text, this.caret, `${replacement} `) : null;
  }
}
