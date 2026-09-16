/**
 * CDXC:SessionStatus 2026-09-10 WHY:
 * A retained roster is not evidence of continued work. Pause both providers' clocks and pulses when verification fails or fresh observations stop arriving.
 * Provider IDs keep repeated names and resumed turns linked to the exact child transcript.
 */

import { IconChevronRight } from '@tabler/icons-react';
import { useContext, useEffect, useId, useLayoutEffect, useState } from 'react';
import type { SessionChatAgentFleet } from '../../shared/session-chat';
import { formatSessionChatActivityElapsed, sessionChatActivityElapsedSeconds } from './session-chat-activity-row';
import { SessionChatDisclosureBody } from './session-chat-disclosure-body';
import { persistSessionChatInteractions, sessionChatInteractionState } from './session-chat-interaction-state';
import { SessionChatSimpleModeContext } from './session-chat-simple-mode';
import { SessionChatSubagentLink } from './session-chat-subagent-link';
import { SessionChatSubagentModel } from './session-chat-subagent-model';

/** How often the local clocks re-render between server samples. */
const FLEET_CLOCK_TICK_MS = 1_000;
const FLEET_DISCLOSURE_KEY = JSON.stringify(['', 'subagents']);

export interface SessionChatAgentFleetStripProps {
  /** Null or empty renders nothing: no sub-agents is not a state worth a box. */
  fleet: SessionChatAgentFleet | null;
  provider?: string | null;
  sessionKey?: string;
}

export function SessionChatAgentFleetStrip(props: SessionChatAgentFleetStripProps) {
  return <SessionChatAgentFleetCard key={props.sessionKey} {...props} />;
}

function SessionChatAgentFleetCard({ fleet, provider, sessionKey }: SessionChatAgentFleetStripProps) {
  const simpleMode = useContext(SessionChatSimpleModeContext);
  /** CDXC:SessionChat 2026-09-13 DECISION:
   * User: clicking the Subagents header minimizes the card to its header; default to minimized in Simple mode and expanded otherwise, remembering the user's last choice per session.
   */
  const [openOverride, setOpenOverride] = useState<boolean | undefined>(
    () => sessionChatInteractionState(sessionKey).disclosures[FLEET_DISCLOSURE_KEY]?.open
  );
  const open = openOverride ?? !simpleMode;
  const rowsId = useId();
  const toggleOpen = () => {
    const next = !open;
    const state = sessionChatInteractionState(sessionKey);
    state.disclosures[FLEET_DISCLOSURE_KEY] = { open: next, defaultOpen: !simpleMode };
    persistSessionChatInteractions(state);
    setOpenOverride(next);
  };
  // A callback ref, not a ref object: the rows mount a render after `open`
  // flips (the disclosure body mounts them once it starts animating), so an
  // effect keyed on `open` would run before they exist.
  const [rowsElement, setRowsElement] = useState<HTMLDivElement | null>(null);
  const [scrollable, setScrollable] = useState(false);
  const agentCount = fleet?.agents.length ?? 0;
  // CDXC:SessionChat 2026-09-10 WHY: Scroll animations can retain their last fade after the roster shrinks to fit; remove the mask when there is no overflow.
  useLayoutEffect(() => {
    const rows = rowsElement;
    if (!rows) return;
    const measure = () => setScrollable(rows.scrollHeight > rows.clientHeight);
    const observer = new ResizeObserver(measure);
    observer.observe(rows);
    measure();
    return () => observer.disconnect();
  }, [agentCount, rowsElement]);
  const [now, setNow] = useState(() => Date.now());
  const detectedAt = fleet?.detectedAt ?? null;
  const validUntil = fleet?.validUntil ? Date.parse(fleet.validUntil) : null;
  const stale = fleet?.stale === true || (validUntil !== null && (!Number.isFinite(validUntil) || now >= validUntil));
  // Keep checking the observation lease even when every row's elapsed clock is idle.
  useEffect(() => {
    if (detectedAt === null || stale) {
      return;
    }
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), FLEET_CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, [detectedAt, stale]);

  const agents = fleet?.agents ?? [];
  if (!fleet || agents.length === 0) {
    return null;
  }

  const idleCount = agents.filter((agent) => agent.status === 'idle').length;
  const runningCount = stale ? 0 : agents.length - idleCount;
  // A stale roster cannot vouch for anything running, so it only carries its size.
  const countLabel = stale
    ? `${agents.length}`
    : [runningCount > 0 ? `${runningCount} running` : null, idleCount > 0 ? `${idleCount} idle` : null]
        .filter((part) => part !== null)
        .join(', ');

  // Carry the captured roster, not the ticking display clock, so identical
  // agent types can be resolved against the provider's ordered launch records.
  const roster = agents.map((agent) => ({
    name: agent.name,
    startedAt:
      agent.startedAt ??
      (agent.elapsedSeconds === undefined ? null : Date.parse(fleet.detectedAt) - agent.elapsedSeconds * 1000),
  }));

  return (
    <div
      aria-label='Subagents'
      className='ghostex-chat-prompt-card ghostex-chat-agent-fleet'
      role='group'
      data-stale={stale || undefined}
    >
      <button
        aria-controls={open ? rowsId : undefined}
        aria-expanded={open}
        className='ghostex-chat-agent-fleet-header ghostex-chat-status-card-header'
        onClick={toggleOpen}
        title={open ? 'Minimize subagents' : 'Expand subagents'}
        type='button'
      >
        {/* CDXC:SessionChat 2026-09-16 DECISION: User: the header has the pending tool card's shape (dot on the left, chevron on the right, same text size) and always says how many subagents are running. The dot and chevron sit in 1lh boxes like session-chat-terminal-tool-row.tsx. */}
        <span aria-hidden='true' className='flex h-[1lh] shrink-0 items-center'>
          <span
            className='ghostex-chat-agent-fleet-pulse'
            style={
              runningCount === 0
                ? { animation: 'none', backgroundColor: 'var(--muted-foreground)', opacity: 0.5 }
                : undefined
            }
          />
        </span>
        {/* CDXC:SessionChat 2026-09-07 DECISION: User: the title is "Subagents", without a hyphen or all caps. */}
        <span className='ghostex-chat-agent-fleet-title'>Subagents</span>
        <span className='ghostex-chat-agent-fleet-count'>{countLabel}</span>
        <span aria-hidden='true' className='ghostex-chat-agent-fleet-chevron flex h-[1lh] shrink-0 items-center'>
          <IconChevronRight
            className={`ghostex-chat-disclosure-chevron size-3.5 text-muted-foreground${open ? ' is-open' : ''}`}
          />
        </span>
      </button>
      <SessionChatDisclosureBody open={open} id={rowsId}>
        {stale ? (
          <div className='ghostex-chat-card-hint ghostex-chat-agent-fleet-unavailable' role='status'>
            Subagent status unavailable
          </div>
        ) : null}
        <div
          ref={setRowsElement}
          className={`ghostex-chat-agent-fleet-rows${scrollable ? ' scroll-fade-y' : ''}`}
          role='list'
        >
          {agents.map((agent, index) => {
            // CDXC:SessionChat 2026-09-12 DECISION: User: Codex rows show the child name/path beside the model and effort in the status column, moving it out of the tooltip; Claude keeps its task text.
            const statusText = provider === 'codex' ? agent.name : agent.task;
            const idle = agent.status === 'idle';
            const working = !stale && !idle;
            const selector = agent.id ?? `fleet:${JSON.stringify({ agents: roster, index })}`;
            const transcriptTarget = {
              name: agent.task ?? agent.name,
              selector,
              agentType: agent.name,
              task: agent.task,
              model: agent.model,
              effort: agent.effort,
            };
            const elapsed = sessionChatActivityElapsedSeconds(
              {
                detectedAt: fleet.detectedAt,
                ...(agent.elapsedSeconds === undefined ? {} : { elapsedSeconds: agent.elapsedSeconds }),
              },
              working ? now : Date.parse(fleet.detectedAt)
            );
            return (
              <div
                className='ghostex-chat-agent-fleet-row'
                key={agent.id ?? `${index}:${agent.name}`}
                role='listitem'
                data-status={stale ? 'unavailable' : idle ? 'idle' : 'working'}
              >
                <span
                  aria-hidden='true'
                  className='ghostex-chat-agent-fleet-pulse'
                  style={
                    !working
                      ? { animation: 'none', backgroundColor: 'var(--muted-foreground)', opacity: 0.5 }
                      : undefined
                  }
                />
                <span className='ghostex-chat-card-content ghostex-chat-agent-fleet-name'>
                  <SessionChatSubagentLink {...transcriptTarget} showAgentType={provider !== 'codex'}>
                    <SessionChatSubagentModel info={agent} />
                  </SessionChatSubagentLink>
                </span>
                {/* Task and marker share one cell: `+2` reads as belonging to the
                  work on its left, and staying out of the clock's column keeps
                  a marked row aligned with every unmarked one. */}
                <span className='ghostex-chat-agent-fleet-work'>
                  {/* CDXC:SessionChat 2026-09-10 DECISION: User: put the ‣ separator at the start of the status cell so it aligns across subagent rows regardless of model label width. */}
                  {statusText || (idle && !stale) || agent.nested ? (
                    <span aria-hidden='true' className='ghostex-chat-card-content shrink-0'>
                      ‣
                    </span>
                  ) : null}
                  {idle && !stale ? <span className='ghostex-chat-card-hint'>Idle</span> : null}
                  <span className='ghostex-chat-card-content ghostex-chat-agent-fleet-task'>
                    {statusText ? (
                      <SessionChatSubagentLink {...transcriptTarget} showAgentType={provider !== 'codex'}>
                        {statusText}
                      </SessionChatSubagentLink>
                    ) : (
                      ''
                    )}
                  </span>
                  {agent.nested ? (
                    <span
                      className='ghostex-chat-card-hint [--chat-card-hint-base:0.625rem] ghostex-chat-agent-fleet-nested'
                      title={`${agent.nested} more agent${agent.nested === 1 ? '' : 's'} under this one`}
                    >
                      +{agent.nested}
                    </span>
                  ) : null}
                </span>
                {/* Counter, separator and clock are three tracks, not one cell:
                  that is what right-aligns every counter on the same edge no
                  matter how long the one above it was. The separator only
                  appears when it has something on both sides of it. */}
                <span className='ghostex-chat-card-hint [--chat-card-hint-base:0.6875rem] ghostex-chat-agent-fleet-tokens'>
                  {agent.tokens ?? ''}
                </span>
                <span aria-hidden='true' className='ghostex-chat-agent-fleet-separator'>
                  {agent.tokens && elapsed !== null ? '•' : ''}
                </span>
                <span className='ghostex-chat-card-hint [--chat-card-hint-base:0.6875rem] ghostex-chat-agent-fleet-clock'>
                  {elapsed === null ? '' : formatSessionChatActivityElapsed(elapsed)}
                </span>
              </div>
            );
          })}
        </div>
      </SessionChatDisclosureBody>
    </div>
  );
}
