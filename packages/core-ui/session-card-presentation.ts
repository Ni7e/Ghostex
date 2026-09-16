import { DEFAULT_TERMINAL_SESSION_TITLE, type SidebarSessionItem } from '../shared/session-grid-contract';
import { getSidebarAgentNameByIcon, type SidebarAgentIcon } from '../shared/sidebar-agents';
import {
  getEffectiveSidebarSessionTag as getEffectiveSessionTag,
  getSidebarSessionTagLabel,
} from '../shared/session-tags';
import { getSessionTagCatalogs } from './session-tag-catalogs';

export const CLOSE_AFTER_DONE_ARMED_REMAINING_LABEL = '03:00';

export const AGENT_SECONDARY_LABELS: Record<SidebarAgentIcon, readonly string[]> = {
  'amp-cli': ['amp', 'amp cli'],
  'antigravity-cli': ['agy', 'antigravity', 'antigravity cli'],
  browser: ['browser'],
  zcode: ['zcode'],
  claude: ['claude', 'claude code'],
  codebuddy: ['codebuddy', 'code buddy'],
  'command-code': ['command code', 'commandcode'],
  'cursor-cli': ['cursor', 'cursor agent', 'cursor cli', 'cursor-agent'],
  codex: ['codex', 'codex cli', 'openai codex'],
  copilot: ['copilot', 'github copilot'],
  mastra: ['mastra', 'mastra code', 'mastracode'],
  devin: ['devin'],
  'factory-droid': ['droid', 'factory droid'],
  gemini: ['gemini'],
  'grok-build': ['grok', 'grok build'],
  'hermes-agent': ['hermes', 'hermes agent'],
  kimi: ['kimi', 'kimi code'],
  kiro: ['kiro', 'kiro cli', 'kiro-cli'],
  omp: ['omp'],
  openclaude: ['open claude', 'openclaude'],
  opencode: ['open code', 'opencode'],
  pi: ['pi', 'π'],
  qoder: ['qoder', 'qodercli'],
  'rovo-dev': ['rovo', 'rovo dev', 'rovodev'],
};

export const TERMINAL_TITLE_MARKER = '∗';

export const UNSYNCED_TITLE_LABEL = '(Unsynced title)';

export const GHOST_PLACEHOLDER_TITLE_PATTERN = /^👻(?:\s+Terminal Session)?$/u;

export const FILESYSTEM_PATH_TOOLTIP_PATTERN =
  /(?:^|\s)(?:~\/|\/(?:Applications|Library|System|Users|Volumes|etc|home|opt|private|tmp|usr|var)\/|[A-Za-z]:[\\/]|file:\/\/)/u;

export type SessionTooltipStateInput = Partial<
  Pick<
    SidebarSessionItem,
    | 'isLive'
    | 'isRunning'
    | 'isSleeping'
    | 'lifecycleState'
    | 'nativePaneState'
    | 'providerSessionState'
    | 'sessionPersistenceProvider'
  >
>;

export function getSessionCardTimerTrailingLabel(
  session: Pick<
    SidebarSessionItem,
    | 'closeAfterDone'
    | 'closeAfterDoneDeadlineAt'
    | 'closeAfterDoneRemainingLabel'
    | 'delayedSendDeadlineAt'
    | 'delayedSendRemainingLabel'
  >,
  nowMs: number
): string | undefined {
  if (session.delayedSendDeadlineAt) {
    return formatSessionTimerDeadlineCountdown(session.delayedSendDeadlineAt, nowMs);
  }
  if (session.delayedSendRemainingLabel) {
    /*
     * Send-when-finished triggers do not have a countdown while their agent
     * scope is still working. Keep that state on the Delayed Send icon and in
     * its tooltip instead of rendering prose in the session button's compact
     * trailing-time slot.
     */
    return isDelayedSendWaitingLabel(session.delayedSendRemainingLabel) ? undefined : session.delayedSendRemainingLabel;
  }
  if (session.closeAfterDoneDeadlineAt) {
    return formatSessionTimerDeadlineCountdown(session.closeAfterDoneDeadlineAt, nowMs);
  }
  if (session.closeAfterDoneRemainingLabel) {
    return session.closeAfterDoneRemainingLabel;
  }
  return session.closeAfterDone === true ? CLOSE_AFTER_DONE_ARMED_REMAINING_LABEL : undefined;
}

export function isDelayedSendWaitingLabel(remainingLabel: string): boolean {
  return remainingLabel === 'Waiting for agent' || remainingLabel === 'Waiting for agents';
}

export function getDelayedSendTooltipText(remainingLabel?: string): string {
  if (remainingLabel === 'Waiting for agent') {
    return 'Delayed Send: the prompt will be sent when the agent finishes working';
  }
  if (remainingLabel === 'Waiting for agents') {
    return 'Delayed Send: the prompt will be sent when all agents finish working';
  }
  if (remainingLabel) {
    return `Delayed Send: the prompt will be sent in ${remainingLabel}`;
  }
  return 'Delayed Send is scheduled';
}

export function formatSessionTimerDeadlineCountdown(deadlineAt: string, nowMs: number): string | undefined {
  const deadlineMs = Date.parse(deadlineAt);
  return Number.isNaN(deadlineMs) ? undefined : formatSessionTimerCountdown(deadlineMs - nowMs);
}

export function formatSessionTimerCountdown(delayMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(delayMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const paddedMinutes = String(minutes).padStart(2, '0');
  const paddedSeconds = String(seconds).padStart(2, '0');
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${paddedMinutes}:${paddedSeconds}`;
  }
  return `${paddedMinutes}:${paddedSeconds}`;
}

export function getSessionCardTitleTooltip({
  alwaysShowTitleTooltip = false,
  alwaysShowStateTooltip = false,
  session,
  showDebugSessionNumbers,
  showSessionDetails = false,
}: {
  alwaysShowTitleTooltip?: boolean;
  alwaysShowStateTooltip?: boolean;
  session: Pick<
    SidebarSessionItem,
    | 'activityLabel'
    | 'pendingQuestionCount'
    | 'activity'
    | 'agentIcon'
    | 'agentSessionId'
    | 'alias'
    | 'closeAfterDone'
    | 'closeAfterDoneRemainingLabel'
    | 'delayedSendRemainingLabel'
    | 'detail'
    | 'displayTitle'
    | 'displayTitleTooltip'
    | 'firstUserMessage'
    | 'isFavorite'
    | 'kind'
    | 'isPrimaryTitleTerminalTitle'
    | 'primaryTitle'
    | 'sessionKind'
    | 'sessionNote'
    | 'sessionTag'
    | 'sessionRoutingId'
    | 'sessionPersistenceName'
    | 'sessionPersistenceProvider'
    | 'sessionNumber'
    | 'terminalTitle'
  > &
    SessionTooltipStateInput & {
      projectName?: string;
      projectPath?: string;
    };
  showDebugSessionNumbers: boolean;
  showSessionDetails?: boolean;
}): {
  headingText: string;
  tooltip?: string;
  tooltipWhen: 'always' | 'overflow';
} {
  const headingText = formatSessionHeadingText({
    agentIcon: session.agentIcon,
    displayTitle: session.displayTitle,
    displayTitleTooltip: session.displayTitleTooltip,
    includeUnsyncedTitleLabel: false,
    kind: session.kind,
    isPrimaryTitleTerminalTitle: session.isPrimaryTitleTerminalTitle,
    primaryTitle: session.primaryTitle,
    sessionKind: session.sessionKind,
    terminalTitle: session.terminalTitle,
    alias: session.alias,
  });
  const tooltipHeadingText = formatSessionHeadingText({
    agentIcon: session.agentIcon,
    displayTitle: session.displayTitle,
    displayTitleTooltip: session.displayTitleTooltip,
    includeUnsyncedTitleLabel: true,
    kind: session.kind,
    isPrimaryTitleTerminalTitle: session.isPrimaryTitleTerminalTitle,
    primaryTitle: session.primaryTitle,
    sessionKind: session.sessionKind,
    terminalTitle: session.terminalTitle,
    alias: session.alias,
  });
  const fullTooltipHeadingText = getFullSessionTooltipHeadingText({
    firstUserMessage: session.firstUserMessage,
    headingText: formatSessionTagTooltipHeadingText(session, tooltipHeadingText),
  });
  /**
   * CDXC:Sessions 2026-05-08-16:07
   * Previous-session search cards need scannable restore context in their
   * title tooltip: archived agent, source project, and persistence provider
   * must be visible without exposing extra columns in the compact result row.
   *
   * CDXC:Tooltips 2026-05-31-06:25:
   * macOS gxserver session-card tooltips should show the full routed session id
   * such as S7k-P3a91-G8v20 when available. The legacy two-digit display id is
   * only a visual row shortcut and should not replace the routed identity.
   *
   * CDXC:Tooltips 2026-06-14-16:26:
   * Session identifiers and provider names are Debugging Mode-only tooltip
   * metadata, and filesystem paths should not appear in session-card tooltips.
   * Keep safe semantic details visible while suppressing routed ids, captured
   * agent ids, provider session names, and project paths by default.
   *
   * CDXC:Tooltips 2026-06-14-16:56:
   * Session status lines expose provider/surface internals, so show `State: ...`
   * only while Debugging Mode is enabled.
   *
   * CDXC:RemoteMachines 2026-06-30-00:11:
   * Remote sidebar rows need their title tooltip to expose the terminal state
   * without enabling Debugging Mode. Keep IDs and provider names debug-only,
   * but allow callers to opt into the non-private state label for remote
   * sessions.
   */
  const sessionIdTooltipValue = session.sessionRoutingId?.trim() || session.sessionNumber?.trim();
  const sessionIdTooltip =
    showDebugSessionNumbers && sessionIdTooltipValue ? `ID: ${sessionIdTooltipValue}` : undefined;
  const agentSessionIdTooltip = getCapturedAgentSessionIdTooltipText(session, showDebugSessionNumbers);
  const tooltipMetadata = [
    (session.pendingQuestionCount ?? 0) > 0
      ? `${session.activity === 'working' ? 'Working · ' : ''}Answer requested (${session.pendingQuestionCount})`
      : undefined,
    /*
     * CDXC:DelayedSend 2026-05-21-12:21:
     * Session-row hover tooltips must surface an active Delayed Send countdown
     * directly below the title, even when the user is not hovering the clock
     * icon itself, so pending Enter timing is visible from the normal card hover.
     */
    session.delayedSendRemainingLabel ? getDelayedSendTooltipText(session.delayedSendRemainingLabel) : undefined,
    /*
     * CDXC:Sessions 2026-06-15-21:00:
     * Close After Done uses the same leading clock slot as Delayed Send, but
     * the card tooltip must still expose whether it is merely armed or actively
     * counting down after the session has stayed Done.
     */
    session.closeAfterDoneRemainingLabel
      ? `Close After Done in ${session.closeAfterDoneRemainingLabel}`
      : session.closeAfterDone
        ? 'Close After Done armed'
        : undefined,
    /*
     * CDXC:SessionNotes 2026-08-24:
     * The note is the reason the user left this session, so it reads directly
     * under the title — above the state and provider lines, including on sleeping rows.
     */
    getSessionNoteTooltipText(session),
    getSessionStateTooltipText(session, showDebugSessionNumbers || alwaysShowStateTooltip),
    getSessionTooltipSecondaryText(session),
    ...(showSessionDetails ? getSessionDetailsTooltipLines(session) : []),
    agentSessionIdTooltip,
    sessionIdTooltip ? undefined : getSessionPersistenceTooltipText(session, showDebugSessionNumbers),
  ]
    .filter((value): value is string => Boolean(value))
    .join('\n');
  const titleTooltip = buildSessionTitleTooltip({
    headingText: fullTooltipHeadingText,
    secondaryText: tooltipMetadata,
    sessionIdTooltip,
  });
  const titleTooltipOptions = getSessionTitleTooltipOptions({
    alwaysShowTitleTooltip,
    headingText,
    titleTooltip,
  });

  return {
    headingText,
    ...titleTooltipOptions,
  };
}

/*
 * CDXC:SessionNotes 2026-08-24:
 * A long note must not turn the row tooltip into a wall of text, so the
 * displayed value is capped and ellipsized. The cap is display-only — the full
 * note is still what the editor opens on and what the daemon stores.
 */
export const SESSION_NOTE_TOOLTIP_MAX_LENGTH = 400;

export function getSessionNoteTooltipText(session: Pick<SidebarSessionItem, 'sessionNote'>): string | undefined {
  const note = session.sessionNote?.trim();
  if (!note) {
    return undefined;
  }
  return `Note: ${
    note.length > SESSION_NOTE_TOOLTIP_MAX_LENGTH ? `${note.slice(0, SESSION_NOTE_TOOLTIP_MAX_LENGTH)}…` : note
  }`;
}

export function getCapturedAgentSessionIdTooltipText(
  session: Pick<SidebarSessionItem, 'agentSessionId'>,
  showDebugSessionNumbers: boolean
): string | undefined {
  if (!showDebugSessionNumbers) {
    return undefined;
  }
  const agentSessionId = session.agentSessionId?.trim();
  return agentSessionId || undefined;
}

export function formatSessionTagTooltipHeadingText(
  session: Pick<SidebarSessionItem, 'isFavorite' | 'sessionTag'>,
  headingText: string
): string {
  const sessionTag = getEffectiveSessionTag(session);
  const label = getSidebarSessionTagLabel(sessionTag, getSessionTagCatalogs());
  if (!label) {
    return headingText;
  }

  /**
   * CDXC:Sessions 2026-06-05-12:30:
   * Session-card hover tooltips prefix the title with the active tag, for
   * example `[Todo]`, without changing the visible row title.
   */
  return `[${label}] ${headingText}`;
}

export function getFullSessionTooltipHeadingText({
  firstUserMessage,
  headingText,
}: {
  firstUserMessage?: string;
  headingText: string;
}): string {
  /**
   * CDXC:Tooltips 2026-05-15-15:57:
   * Active and Previous session-card tooltips must show the full human title line when the visible session title has already been shortened with an ellipsis. First-prompt auto titles can preserve only the shortened card label, so use the saved first user message as the full tooltip heading only when it clearly starts with the displayed truncated prefix.
   */
  const normalizedFirstUserMessage = firstUserMessage?.trim().replace(/\s+/g, ' ');
  if (!normalizedFirstUserMessage) {
    return headingText;
  }

  const unsyncedLabelSuffix = ` ${UNSYNCED_TITLE_LABEL}`;
  const headingWithoutUnsyncedLabel = headingText.endsWith(unsyncedLabelSuffix)
    ? headingText.slice(0, -unsyncedLabelSuffix.length)
    : headingText;
  const normalizedHeading = headingWithoutUnsyncedLabel.trim();
  const truncatedPrefix = normalizedHeading.replace(/(?:\.\.\.|…)$/u, '').trim();
  if (
    truncatedPrefix.length > 0 &&
    truncatedPrefix.length < normalizedFirstUserMessage.length &&
    truncatedPrefix !== normalizedHeading &&
    normalizedFirstUserMessage.toLowerCase().startsWith(truncatedPrefix.toLowerCase())
  ) {
    const fullHeading = normalizedHeading.startsWith(TERMINAL_TITLE_MARKER)
      ? `${TERMINAL_TITLE_MARKER} ${normalizedFirstUserMessage}`
      : normalizedFirstUserMessage;
    return headingText.endsWith(unsyncedLabelSuffix) ? `${fullHeading} ${UNSYNCED_TITLE_LABEL}` : fullHeading;
  }

  return headingText;
}

export function formatSessionHeadingText({
  agentIcon,
  alias,
  displayTitle,
  displayTitleTooltip,
  includeUnsyncedTitleLabel = false,
  kind,
  isPrimaryTitleTerminalTitle,
  primaryTitle,
  sessionKind,
  terminalTitle,
}: Pick<
  SidebarSessionItem,
  | 'agentIcon'
  | 'alias'
  | 'displayTitle'
  | 'displayTitleTooltip'
  | 'kind'
  | 'isPrimaryTitleTerminalTitle'
  | 'primaryTitle'
  | 'sessionKind'
  | 'terminalTitle'
> & {
  includeUnsyncedTitleLabel?: boolean;
}): string {
  const gxserverDisplayTitle = normalizeDisplayTitle(displayTitle);
  if (gxserverDisplayTitle) {
    /*
    CDXC:SessionTitles 2026-06-07-09:33:
    gxserver presentation rows are dumb-rendered title strings. When `displayTitle` is present, React must not compare titleSource, terminalTitle, or placeholder state locally; the server already applied the shared title rules and unsynced marker.
    */
    return includeUnsyncedTitleLabel
      ? (normalizeDisplayTitle(displayTitleTooltip) ?? gxserverDisplayTitle)
      : gxserverDisplayTitle;
  }

  const primaryHeadingTitle = normalizeSessionCardHeadingTitle(primaryTitle);
  const terminalHeadingTitle = normalizeSessionCardHeadingTitle(terminalTitle);
  const aliasHeadingTitle = normalizeSessionCardHeadingTitle(alias);
  const normalizedPrimaryTitle = primaryHeadingTitle.text;
  const normalizedTerminalTitle = terminalHeadingTitle.text;
  const baseHeadingTitle = normalizedPrimaryTitle ? primaryHeadingTitle : aliasHeadingTitle;
  const baseHeadingText = baseHeadingTitle.text || alias;
  const isBrowserSession = kind === 'browser' || sessionKind === 'browser';
  if (baseHeadingTitle.isGhostPlaceholder) {
    return formatNonPersistentSessionHeadingText(baseHeadingText, includeUnsyncedTitleLabel);
  }

  if (
    isBrowserSession ||
    isPrimaryTitleTerminalTitle ||
    !normalizedPrimaryTitle ||
    normalizedPrimaryTitle === normalizedTerminalTitle
  ) {
    return baseHeadingText;
  }

  return formatNonPersistentSessionHeadingText(baseHeadingText, includeUnsyncedTitleLabel);
}

export function normalizeDisplayTitle(title: string | undefined): string | undefined {
  const normalizedTitle = title?.trim().replace(/\s+/g, ' ');
  return normalizedTitle || undefined;
}

export function formatNonPersistentSessionHeadingText(headingText: string, includeUnsyncedTitleLabel: boolean): string {
  return includeUnsyncedTitleLabel
    ? `${TERMINAL_TITLE_MARKER} ${headingText} ${UNSYNCED_TITLE_LABEL}`
    : `${TERMINAL_TITLE_MARKER} ${headingText}`;
}

export function normalizeSessionCardHeadingTitle(title: string | undefined): {
  isGhostPlaceholder: boolean;
  text?: string;
} {
  const normalizedTitle = title?.trim().replace(/\s+/g, ' ');
  if (!normalizedTitle) {
    return { isGhostPlaceholder: false };
  }

  /**
   * CDXC:Sessions 2026-05-07-14:48
   * Ghost placeholder titles are UI-only session defaults, not meaningful
   * terminal titles. Sidebar cards must render them with the existing
   * non-persistent title marker as `∗ Terminal Session` instead of exposing
   * the ghost emoji as the card title.
   */
  if (GHOST_PLACEHOLDER_TITLE_PATTERN.test(normalizedTitle)) {
    return {
      isGhostPlaceholder: true,
      text: DEFAULT_TERMINAL_SESSION_TITLE,
    };
  }

  return {
    isGhostPlaceholder: false,
    text: normalizedTitle,
  };
}

export function buildSessionTitleTooltip({
  headingText,
  secondaryText,
  sessionIdTooltip,
}: {
  headingText: string;
  secondaryText?: string;
  sessionIdTooltip?: string;
}): string {
  /**
   * CDXC:Tooltips 2026-05-07-18:16
   * Session title tooltips can wrap inside the narrow sidebar, so separate each
   * logical metadata row with a blank line. Splitting metadata blocks first keeps
   * authored line breaks visible while making row boundaries readable after
   * wrapping.
   */
  const uniqueLines = [headingText, secondaryText, sessionIdTooltip].reduce<string[]>((lines, block) => {
    const normalizedBlockLines =
      block
        ?.split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean) ?? [];

    return normalizedBlockLines.reduce<string[]>((nextLines, normalizedLine) => {
      if (nextLines.includes(normalizedLine)) {
        return nextLines;
      }

      return [...nextLines, normalizedLine];
    }, lines);
  }, []);

  return uniqueLines.join('\n\n');
}

export function getSessionTooltipSecondaryText(
  session: Pick<SidebarSessionItem, 'activityLabel' | 'agentIcon' | 'detail' | 'terminalTitle'>
): string | undefined {
  const detail = stripAgentTooltipText(session.detail, session.agentIcon);
  if (detail && !containsFilesystemPath(detail)) {
    return detail;
  }

  const terminalHeadingTitle = normalizeSessionCardHeadingTitle(session.terminalTitle);
  const terminalTitle = terminalHeadingTitle.isGhostPlaceholder
    ? undefined
    : stripAgentTooltipText(terminalHeadingTitle.text, session.agentIcon);
  if (terminalTitle && !containsFilesystemPath(terminalTitle)) {
    return terminalTitle;
  }

  return session.activityLabel?.trim() || undefined;
}

export function containsFilesystemPath(value: string): boolean {
  return FILESYSTEM_PATH_TOOLTIP_PATTERN.test(value);
}

export function getSessionStateTooltipText(
  session: SessionTooltipStateInput,
  showStateTooltip: boolean
): string | undefined {
  if (!showStateTooltip) {
    return undefined;
  }

  const label = getSessionStateTooltipLabel(session);
  return label ? `State: ${label}` : undefined;
}

export function getSessionStateTooltipLabel(session: SessionTooltipStateInput): string | undefined {
  /*
   * CDXC:Tooltips 2026-06-13-23:24:
   * Session hover tooltips need one short lifecycle line that combines zmx
   * provider liveness with the app's loaded surface state. "Active, not loaded"
   * is the user-facing wording for a live provider session whose native pane is
   * not mounted yet.
   */
  const hasStateSignal =
    session.isLive !== undefined ||
    session.isRunning !== undefined ||
    session.isSleeping !== undefined ||
    session.lifecycleState !== undefined ||
    session.nativePaneState !== undefined ||
    session.providerSessionState !== undefined;
  if (!hasStateSignal) {
    return undefined;
  }

  const hasLoadedSurface = session.nativePaneState === 'mounted' || session.nativePaneState === 'mounting';
  if (hasLoadedSurface) {
    return 'Active in app';
  }

  if (session.providerSessionState === 'exists') {
    return 'Active, not loaded';
  }

  if (session.isSleeping === true || session.lifecycleState === 'sleeping') {
    return 'Sleeping';
  }

  if (session.providerSessionState === 'unknown' || session.lifecycleState === 'error') {
    return 'Unknown';
  }

  if (session.isLive === true || session.isRunning === true || session.lifecycleState === 'running') {
    return 'Active in app';
  }

  if (session.providerSessionState === 'missing' && session.sessionPersistenceProvider) {
    return 'Not started';
  }

  if (session.lifecycleState === 'done' || session.isRunning === false || session.isLive === false) {
    return 'Done';
  }

  return undefined;
}

export function getSessionTitleTooltipOptions({
  titleTooltip,
}: {
  alwaysShowTitleTooltip: boolean;
  headingText: string;
  titleTooltip: string;
}): {
  tooltip?: string;
  tooltipWhen: 'always' | 'overflow';
} {
  /**
   * CDXC:Tooltips 2026-09-12 DECISION:
   * User: session-card title tooltips must always show on hover, even when the session name is short and the visible title is not truncated.
   */
  return {
    tooltip: titleTooltip,
    tooltipWhen: 'always',
  };
}

export function getSessionDetailsTooltipLines(
  session: Pick<SidebarSessionItem, 'agentIcon' | 'sessionKind' | 'sessionPersistenceProvider'> & {
    projectName?: string;
    projectPath?: string;
  }
): string[] {
  const agentName = getSessionDetailsAgentName(session);
  const projectLabel = getSessionDetailsProjectLabel(session);
  const providerLabel = session.sessionPersistenceProvider ?? 'none';

  return [`Agent: ${agentName}`, `Project: ${projectLabel}`, `Provider: ${providerLabel}`];
}

export function getSessionDetailsAgentName(session: Pick<SidebarSessionItem, 'agentIcon' | 'sessionKind'>): string {
  if (session.agentIcon) {
    return getSidebarAgentNameByIcon(session.agentIcon) ?? session.agentIcon;
  }

  if (session.sessionKind === 'browser') {
    return 'Browser';
  }

  return 'None';
}

export function getSessionDetailsProjectLabel({ projectName }: { projectName?: string; projectPath?: string }): string {
  const normalizedProjectName = projectName?.trim();
  return normalizedProjectName || 'None';
}

export function getSessionPersistenceTooltipText(
  session: Pick<SidebarSessionItem, 'sessionPersistenceName' | 'sessionPersistenceProvider'>,
  showDebugSessionNumbers: boolean
): string | undefined {
  if (!showDebugSessionNumbers) {
    return undefined;
  }
  if (!session.sessionPersistenceName || !session.sessionPersistenceProvider) {
    return undefined;
  }
  return `${session.sessionPersistenceProvider} session: ${session.sessionPersistenceName}`;
}

export function shouldShowTerminalSessionIcon(session: Pick<SidebarSessionItem, 'agentIcon' | 'sessionKind'>): boolean {
  return !session.agentIcon && (session.sessionKind === undefined || session.sessionKind === 'terminal');
}

export function stripAgentTooltipText(
  value: string | undefined,
  agentIcon: SidebarSessionItem['agentIcon']
): string | undefined {
  const normalizedValue = value?.trim();
  if (!normalizedValue) {
    return undefined;
  }

  if (!agentIcon) {
    return normalizedValue;
  }

  const normalizedAgentLabels = Array.from(
    new Set([getSidebarAgentNameByIcon(agentIcon), ...AGENT_SECONDARY_LABELS[agentIcon]])
  )
    .filter((label): label is string => typeof label === 'string')
    .map((label) => label.trim())
    .filter((label) => label.length > 0)
    .sort((left, right) => right.length - left.length);
  const lowerValue = normalizedValue.toLowerCase();

  for (const label of normalizedAgentLabels) {
    const lowerLabel = label.toLowerCase();
    if (lowerValue === lowerLabel) {
      return undefined;
    }

    if (!lowerValue.startsWith(lowerLabel)) {
      continue;
    }

    const remainder = normalizedValue.slice(label.length).trimStart();
    if (!remainder) {
      return undefined;
    }

    const separatorMatch = remainder.match(/^([:/|-]+)\s*(.*)$/);
    if (separatorMatch) {
      const strippedValue = separatorMatch[2]?.trim();
      return strippedValue || undefined;
    }

    return normalizedValue;
  }

  return normalizedValue;
}
