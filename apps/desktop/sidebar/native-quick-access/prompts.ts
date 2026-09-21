/**
 * The Saved Prompts tab: the Saved / Recovered / Sent views, scope and tag
 * filters, day grouping, rows and editor of packages/core-ui/stashed-prompts-modal.tsx.
 */
import { formatRelativeTime } from '@/packages/core-ui/relative-time';
import { sidebarStore } from '@/packages/core-ui/sidebar-store-model';
import { parseGxserverPresentationProjectSessionId } from '@/packages/shared/gxserver-presentation-sidebar-projection';
import type { RecoveredSessionChatDraft } from '@/packages/core-ui/chat/session-chat-draft-storage';
import type { GxserverStashedPrompt, GxserverStashedPromptTag } from '@/packages/shared/gxserver-protocol';
import { GXSERVER_FAVORITE_PROMPT_TAG_ID, GXSERVER_STASHED_PROMPT_TAG_ID } from '@/packages/shared/gxserver-protocol';
import {
  normalizeDiscoveredProjectIconDataUrl,
  normalizeWorkspaceProjectIcon,
  resolveWorkspaceProjectIconDataUrl,
} from '@/packages/shared/workspace-project-appearance';
import type {
  QuickAccessGroup,
  QuickAccessMenuItem,
  QuickAccessOption,
  QuickAccessPromptAction,
  QuickAccessPromptEditor,
  QuickAccessRow,
  QuickAccessSelect,
} from '@/packages/shared/native-quick-access';
import { quickAccessDayLabel } from './day-labels';
import { assetIcon, imageIcon, NO_ICON } from './icons';

export type PromptsView = 'saved' | 'recovered' | 'sent';
export type PromptsScope = 'all' | 'project' | 'session';
export type PromptTagFilter = { kind: 'all' } | { kind: 'tag'; tagId: string } | { kind: 'untagged' };

export const ALL_PROJECTS_VALUE = 'scope:all';
export const CURRENT_SESSION_VALUE = 'scope:session';
export const NO_PROJECT_VALUE = 'project:none';
export const ALL_TAGS_VALUE = 'tag:all';
export const NO_TAG_VALUE = 'tag:none';
export const TOOLTIP_LINE_COUNT = 30;

/**
 * CDXC:SavedPrompts 2026-08-23 (ported):
 * New tags pick from these eight hues, which stay legible as a 7px dot, an 18px
 * chip and a 3px row stripe.
 */
export const STASHED_PROMPT_TAG_COLORS = [
  '#e3b341',
  '#7f9cf5',
  '#86d1a4',
  '#e3796b',
  '#c99bdd',
  '#7ec7f5',
  '#e0a3c8',
  '#9aa4b2',
] as const;

export type PromptsTabState = {
  view: PromptsView;
  scope: PromptsScope;
  scopeProjectId?: string;
  tagFilter: PromptTagFilter;
  prompts?: GxserverStashedPrompt[];
  tags: GxserverStashedPromptTag[];
  recovered: GxserverStashedPrompt[];
  sent: GxserverStashedPrompt[];
  /** The launcher's session context, decoded into the daemon's raw ids. */
  projectId?: string;
  sessionId?: string;
  rawProjectId?: string;
  rawSessionId?: string;
  editing?: { promptId?: string; content: string; projectValue: string; tagValue: string; isFavorite: boolean };
  saving: boolean;
  saveError?: string;
  tagError?: string;
  composer?: { name: string; color: string; anchor: string; promptId?: string };
  resolvedDefaultScope: boolean;
};

export function createPromptsTabState(): PromptsTabState {
  return {
    view: 'saved',
    scope: 'all',
    tagFilter: { kind: 'all' },
    tags: [],
    recovered: [],
    sent: [],
    saving: false,
    resolvedDefaultScope: false,
  };
}

export function applyPromptsLauncherContext(
  state: PromptsTabState,
  projectId: string | undefined,
  sessionId: string | undefined,
  scope: PromptsScope | undefined
): void {
  const combined = sessionId ? parseGxserverPresentationProjectSessionId(sessionId) : undefined;
  state.projectId = projectId;
  state.sessionId = sessionId;
  state.rawSessionId = combined?.sessionId ?? sessionId;
  state.rawProjectId = projectId ?? combined?.projectId;
  state.scope = scope ?? 'all';
  state.scopeProjectId = state.rawProjectId;
  state.resolvedDefaultScope = false;
}

function promptTagIds(prompt: GxserverStashedPrompt): readonly string[] {
  return prompt.tagIds ?? [];
}

function promptLabelTagIds(prompt: GxserverStashedPrompt): readonly string[] {
  return promptTagIds(prompt).filter((tagId) => tagId !== GXSERVER_FAVORITE_PROMPT_TAG_ID);
}

function searchText(prompt: GxserverStashedPrompt): string {
  return `${prompt.content} ${prompt.projectName ?? ''}`.toLowerCase().replace(/\s+/g, ' ').trim();
}

function promptTitle(prompt: GxserverStashedPrompt): string {
  return prompt.content.replace(/\s+/g, ' ').trim() || 'Untitled saved prompt';
}

function parseUpdatedAt(prompt: GxserverStashedPrompt): number {
  const timestamp = Date.parse(prompt.updatedAt);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function relativeTimeLabel(isoDate: string): string {
  const { suffix, value } = formatRelativeTime(isoDate, { allowJustNow: true });
  return suffix ? `${value} ${suffix}` : value;
}

export function promptBelongsToSession(prompt: GxserverStashedPrompt, state: PromptsTabState): boolean {
  const agentSessionId = state.sessionId
    ? sidebarStore.getState().sessionsById[state.sessionId]?.agentSessionId
    : undefined;
  if (agentSessionId && prompt.agentSessionId === agentSessionId) return true;
  if (!state.rawSessionId || prompt.sessionId !== state.rawSessionId) return false;
  return state.rawProjectId === undefined || prompt.projectId === state.rawProjectId;
}

export function promptsProjectOptions(state: PromptsTabState): { projectId: string; name: string }[] {
  const store = sidebarStore.getState();
  const options = new Map<string, { projectId: string; name: string }>();
  for (const groupId of store.groupOrder) {
    const group = store.groupsById[groupId];
    const groupProjectId = group?.projectContext?.editor?.projectId;
    if (groupProjectId && !options.has(groupProjectId)) {
      options.set(groupProjectId, { projectId: groupProjectId, name: group.title });
    }
  }
  for (const prompt of state.prompts ?? []) {
    if (prompt.projectId && !options.has(prompt.projectId)) {
      options.set(prompt.projectId, {
        projectId: prompt.projectId,
        name: prompt.projectName?.trim() || 'Unnamed project',
      });
    }
  }
  if (state.rawProjectId && !options.has(state.rawProjectId)) {
    options.set(state.rawProjectId, { projectId: state.rawProjectId, name: 'This project' });
  }
  return [...options.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function hasSessionScope(state: PromptsTabState): boolean {
  const agentSessionId = state.sessionId
    ? sidebarStore.getState().sessionsById[state.sessionId]?.agentSessionId
    : undefined;
  return Boolean(state.rawSessionId || agentSessionId);
}

export function effectivePromptsScope(state: PromptsTabState): PromptsScope {
  if (state.scope === 'session' && !hasSessionScope(state)) return 'all';
  if (state.scope === 'project' && !state.scopeProjectId) return 'all';
  return state.scope;
}

export function activePrompts(state: PromptsTabState): GxserverStashedPrompt[] | undefined {
  if (state.view === 'sent') return state.sent;
  if (state.view === 'recovered') return state.recovered;
  return state.prompts;
}

/** Search, then scope, then tag: the order the React modal narrows in. */
export function scopedPrompts(state: PromptsTabState, query: string): GxserverStashedPrompt[] {
  const all = activePrompts(state) ?? [];
  const normalizedQuery = query.toLowerCase().replace(/\s+/g, ' ').trim();
  const searched = normalizedQuery ? all.filter((prompt) => searchText(prompt).includes(normalizedQuery)) : all;
  const scope = effectivePromptsScope(state);
  if (scope === 'all') return searched;
  if (scope === 'project') {
    return searched.filter((prompt) => state.scopeProjectId !== undefined && prompt.projectId === state.scopeProjectId);
  }
  return searched.filter((prompt) => promptBelongsToSession(prompt, state));
}

export function visiblePrompts(state: PromptsTabState, query: string): GxserverStashedPrompt[] {
  const scoped = scopedPrompts(state, query);
  if (state.view !== 'saved' || state.tagFilter.kind === 'all') return scoped;
  if (state.tagFilter.kind === 'untagged') {
    return scoped.filter((prompt) => promptLabelTagIds(prompt).length === 0);
  }
  const tagId = state.tagFilter.tagId;
  return scoped.filter((prompt) => promptTagIds(prompt).includes(tagId));
}

/** Port of `StashedPromptProjectIcon`. */
function promptProjectIcon(prompt: GxserverStashedPrompt) {
  const icon = normalizeWorkspaceProjectIcon(prompt.projectIcon);
  const explicit = imageIcon(
    resolveWorkspaceProjectIconDataUrl({ icon, iconDataUrl: prompt.projectIconDataUrl ?? undefined })
  );
  if (explicit) return explicit;
  const discovered = imageIcon(normalizeDiscoveredProjectIconDataUrl(prompt.projectDiscoveredIconDataUrl));
  if (discovered) return discovered;
  if (icon?.kind === 'tabler') return assetIcon(icon.icon, icon.color);
  return assetIcon('folder');
}

export const RECOVERED_PROMPT_ID_PREFIX = 'recovered:';

/**
 * CDXC:Drafts 2026-08-28 (ported):
 * The Recovered view lists the composer's never-sent local drafts shaped as
 * stash rows, so one list, grouping, search and insert path renders both views.
 */
export function recoveredDraftAsPrompt(
  draft: RecoveredSessionChatDraft,
  projectNamesById: ReadonlyMap<string, string>
): GxserverStashedPrompt {
  const updatedAt = new Date(draft.updatedAt).toISOString();
  return {
    content: draft.text,
    createdAt: updatedAt,
    cwd: null,
    projectId: draft.projectId ?? null,
    projectName: (draft.projectId && projectNamesById.get(draft.projectId)) || null,
    promptId: `${RECOVERED_PROMPT_ID_PREFIX}${draft.recoveryId ? `history:${draft.recoveryId}` : draft.sessionKey}`,
    sessionId: draft.sessionId ?? null,
    updatedAt,
  } as GxserverStashedPrompt;
}

export function recoveredDraftSessionKey(promptId: string): string {
  return promptId.slice(RECOVERED_PROMPT_ID_PREFIX.length);
}

export function promptProjectNames(state: PromptsTabState): ReadonlyMap<string, string> {
  return new Map(promptsProjectOptions(state).map((project) => [project.projectId, project.name]));
}

export function promptRowKey(promptId: string): string {
  return `prompt:${promptId}`;
}

export function promptActions(state: PromptsTabState, prompt: GxserverStashedPrompt): QuickAccessPromptAction[] {
  const canJump = Boolean(prompt.agentSessionId || prompt.sessionId);
  if (state.view === 'saved') {
    return [...(canJump ? (['open'] as const) : []), 'favorite', 'tag', 'copy', 'edit', 'delete'];
  }
  return [...(canJump ? (['open'] as const) : []), 'save', 'copy', 'delete'];
}

export function buildPromptGroups(state: PromptsTabState, query: string): QuickAccessGroup[] {
  const tagsById = new Map(state.tags.map((tag) => [tag.tagId, tag]));
  const prompts = [...visiblePrompts(state, query)].sort(
    (left, right) => parseUpdatedAt(right) - parseUpdatedAt(left) || left.promptId.localeCompare(right.promptId)
  );
  const byDay = new Map<string, GxserverStashedPrompt[]>();
  for (const prompt of prompts) {
    const timestamp = parseUpdatedAt(prompt);
    const dayLabel = timestamp === 0 ? 'Earlier' : quickAccessDayLabel(timestamp);
    const grouped = byDay.get(dayLabel);
    if (grouped) grouped.push(prompt);
    else byDay.set(dayLabel, [prompt]);
  }
  return [...byDay.entries()].map(([dayLabel, dayPrompts]) => ({
    key: dayLabel,
    heading: dayLabel,
    separated: false,
    rows: dayPrompts.map((prompt): QuickAccessRow => {
      const tagIds = promptTagIds(prompt);
      const labelTags = tagIds
        .filter((tagId) => tagId !== GXSERVER_FAVORITE_PROMPT_TAG_ID)
        .map((tagId) => tagsById.get(tagId))
        .filter((tag): tag is GxserverStashedPromptTag => tag !== undefined);
      const lines = prompt.content.trim().split('\n');
      return {
        kind: 'prompt',
        key: promptRowKey(prompt.promptId),
        title: promptTitle(prompt),
        tooltip: lines.slice(0, TOOLTIP_LINE_COUNT).join('\n') + (lines.length > TOOLTIP_LINE_COUNT ? '\n…' : ''),
        projectName: prompt.projectName ?? (state.view === 'recovered' ? 'Unknown project' : 'No project'),
        projectIcon: promptProjectIcon(prompt),
        sessionTitle: (prompt as { sessionTitle?: string }).sessionTitle ?? '',
        tags: labelTags
          .filter((tag) => tag.tagId !== GXSERVER_STASHED_PROMPT_TAG_ID)
          .map((tag) => ({ label: tag.name, color: tag.color })),
        time: relativeTimeLabel(prompt.updatedAt),
        isFavorite: tagIds.includes(GXSERVER_FAVORITE_PROMPT_TAG_ID),
      };
    }),
  }));
}

export function promptsProjectSelect(state: PromptsTabState): QuickAccessSelect {
  const projects = promptsProjectOptions(state);
  const scope = effectivePromptsScope(state);
  const value =
    scope === 'session'
      ? CURRENT_SESSION_VALUE
      : scope === 'project' && state.scopeProjectId
        ? `project:${state.scopeProjectId}`
        : ALL_PROJECTS_VALUE;
  const selectedName =
    value === CURRENT_SESSION_VALUE
      ? 'This session'
      : value === ALL_PROJECTS_VALUE
        ? 'All projects'
        : (projects.find((project) => `project:${project.projectId}` === value)?.name ?? 'All projects');
  const option = (optionValue: string, label: string): QuickAccessOption => ({
    value: optionValue,
    label,
    detail: '',
    color: '',
    icon: NO_ICON,
    disabled: false,
    selected: optionValue === value,
    separated: false,
  });
  return {
    label: selectedName,
    detail: '',
    color: '',
    options: [
      option(ALL_PROJECTS_VALUE, 'All projects'),
      ...(hasSessionScope(state) ? [option(CURRENT_SESSION_VALUE, 'This session')] : []),
      ...projects.map((project) => option(`project:${project.projectId}`, project.name)),
    ],
    searchable: true,
    searchPlaceholder: 'Filter projects...',
  };
}

export function promptsTagSelect(state: PromptsTabState, query: string): QuickAccessSelect {
  const scoped = scopedPrompts(state, query);
  const countByTagId = new Map<string, number>();
  for (const prompt of scoped) {
    for (const tagId of promptTagIds(prompt)) countByTagId.set(tagId, (countByTagId.get(tagId) ?? 0) + 1);
  }
  const untaggedCount = scoped.filter((prompt) => promptLabelTagIds(prompt).length === 0).length;
  const hasTaggedPrompt = (state.prompts ?? []).some((prompt) => promptLabelTagIds(prompt).length > 0);
  const value =
    state.tagFilter.kind === 'tag'
      ? `tag:${state.tagFilter.tagId}`
      : state.tagFilter.kind === 'untagged'
        ? NO_TAG_VALUE
        : ALL_TAGS_VALUE;
  const options: QuickAccessOption[] = [
    {
      value: 'tag:new',
      label: 'New tag…',
      detail: '',
      color: '',
      icon: assetIcon('plus'),
      disabled: false,
      selected: false,
      separated: false,
    },
    {
      value: ALL_TAGS_VALUE,
      label: `All tags (${scoped.length})`,
      detail: '',
      color: '#ffffff',
      icon: NO_ICON,
      disabled: false,
      selected: value === ALL_TAGS_VALUE,
      separated: true,
    },
    ...state.tags.map((tag): QuickAccessOption => ({
      value: `tag:${tag.tagId}`,
      label: `${tag.name} (${countByTagId.get(tag.tagId) ?? 0})`,
      detail: '',
      color: tag.color,
      icon: NO_ICON,
      disabled: false,
      selected: value === `tag:${tag.tagId}`,
      separated: false,
    })),
  ];
  if (hasTaggedPrompt || state.tagFilter.kind === 'untagged') {
    options.push({
      value: NO_TAG_VALUE,
      label: `No tag (${untaggedCount})`,
      detail: '',
      color: '',
      icon: NO_ICON,
      disabled: false,
      selected: value === NO_TAG_VALUE,
      separated: false,
    });
  }
  const selected = options.find((option) => option.selected);
  return {
    label: selected?.label ?? `All tags (${scoped.length})`,
    detail: '',
    color: selected?.color ?? '#ffffff',
    options,
    searchable: true,
    searchPlaceholder: 'Filter tags...',
  };
}

export function promptEditorState(state: PromptsTabState): QuickAccessPromptEditor | null {
  const editing = state.editing;
  if (!editing) return null;
  const projects = promptsProjectOptions(state);
  const projectOption = (value: string, label: string): QuickAccessOption => ({
    value,
    label,
    detail: '',
    color: '',
    icon: NO_ICON,
    disabled: false,
    selected: value === editing.projectValue,
    separated: false,
  });
  const tagOption = (value: string, label: string, color: string): QuickAccessOption => ({
    value,
    label,
    detail: '',
    color,
    icon: NO_ICON,
    disabled: false,
    selected: value === editing.tagValue,
    separated: false,
  });
  const selectedTag = state.tags.find((tag) => `tag:${tag.tagId}` === editing.tagValue);
  return {
    heading: editing.promptId ? 'Edit Saved Prompt' : 'Add Saved Prompt',
    content: editing.content,
    // Editing a prompt keeps its project; only a new prompt picks one.
    projects: editing.promptId
      ? { label: '', detail: '', color: '', options: [], searchable: false, searchPlaceholder: '' }
      : {
          label:
            projects.find((project) => `project:${project.projectId}` === editing.projectValue)?.name ?? 'No project',
          detail: '',
          color: '',
          options: [
            projectOption(NO_PROJECT_VALUE, 'No project'),
            ...projects.map((project) => projectOption(`project:${project.projectId}`, project.name)),
          ],
          searchable: true,
          searchPlaceholder: 'Filter projects...',
        },
    tags: {
      label: selectedTag?.name ?? 'No tag',
      detail: '',
      color: selectedTag?.color ?? '',
      options: [
        tagOption(NO_TAG_VALUE, 'No tag', ''),
        ...state.tags
          .filter((tag) => tag.tagId !== GXSERVER_FAVORITE_PROMPT_TAG_ID)
          .map((tag) => tagOption(`tag:${tag.tagId}`, tag.name, tag.color)),
      ],
      searchable: true,
      searchPlaceholder: 'Filter tags...',
    },
    isFavorite: editing.isFavorite,
    error: state.saveError ?? '',
    saving: state.saving,
    submitLabel: state.saving ? 'Saving...' : editing.promptId ? 'Save Changes' : 'Add Prompt',
  };
}

export function promptsEmptyCopy(state: PromptsTabState): string {
  if (state.view === 'sent') return 'No sent messages match. The last 50 messages you send appear here.';
  const scope = effectivePromptsScope(state);
  if (state.view === 'recovered') {
    if (scope === 'session') return 'No recovered drafts came from this session.';
    if (scope === 'project') return 'No recovered drafts came from this project.';
    return 'No recovered drafts. Unsent text and earlier draft versions show up here.';
  }
  if (state.tagFilter.kind === 'tag') return 'No saved prompts carry this tag yet.';
  if (state.tagFilter.kind === 'untagged') return 'Every saved prompt here already carries a tag.';
  if (scope === 'session') return 'No saved prompts came from this session.';
  if (scope === 'project') return 'No saved prompts came from this project.';
  return 'No saved prompts match this search.';
}

export function findPrompt(state: PromptsTabState, key: string): GxserverStashedPrompt | undefined {
  return (activePrompts(state) ?? []).find((prompt) => promptRowKey(prompt.promptId) === key);
}

/** Port of `togglePromptTag`: Favorites and one label tag coexist; labels are exclusive. */
export function nextPromptTagIds(prompt: GxserverStashedPrompt, tagId: string): string[] {
  const current = promptTagIds(prompt);
  const favoriteTagIds = current.includes(GXSERVER_FAVORITE_PROMPT_TAG_ID) ? [GXSERVER_FAVORITE_PROMPT_TAG_ID] : [];
  if (tagId === GXSERVER_FAVORITE_PROMPT_TAG_ID) {
    const labelTagId = current.find((candidate) => candidate !== GXSERVER_FAVORITE_PROMPT_TAG_ID);
    return [
      ...(favoriteTagIds.length > 0 ? [] : [GXSERVER_FAVORITE_PROMPT_TAG_ID]),
      ...(labelTagId ? [labelTagId] : []),
    ];
  }
  return current.includes(tagId) ? favoriteTagIds : [...favoriteTagIds, tagId];
}

/**
 * The row tag menu: every non-Favorites tag as a toggle, then New tag…, the
 * same list `StashedPromptRow`'s tag popover shows.
 */
export function promptTagMenuItems(state: PromptsTabState, prompt: GxserverStashedPrompt): QuickAccessMenuItem[] {
  const tagIds = promptTagIds(prompt);
  const items: QuickAccessMenuItem[] = state.tags
    .filter((tag) => tag.tagId !== GXSERVER_FAVORITE_PROMPT_TAG_ID)
    .map((tag) => ({
      id: `tag:${tag.tagId}`,
      label: tag.name,
      icon: assetIcon(tagIds.includes(tag.tagId) ? 'circle-check-filled' : 'tag', tag.color),
      hotkey: '',
      danger: false,
      disabled: false,
      separator: false,
    }));
  if (items.length > 0) {
    items.push({
      id: 'separator',
      label: '',
      icon: NO_ICON,
      hotkey: '',
      danger: false,
      disabled: false,
      separator: true,
    });
  }
  items.push({
    id: 'tag:new',
    label: 'New tag…',
    icon: assetIcon('plus'),
    hotkey: '',
    danger: false,
    disabled: false,
    separator: false,
  });
  return items;
}
