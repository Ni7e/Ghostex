/**
 * CDXC:SessionStatus 2026-09-10 WHY:
 * A retained roster is not evidence of continued work. Pause both providers' clocks and pulses when verification fails or fresh observations stop arriving.
 * Provider IDs keep repeated names and resumed turns linked to the exact child transcript.
 */

import { IconUsers } from '@tabler/icons-react';
import { useContext, useEffect, useLayoutEffect, useState } from 'react';
import type { SessionChatAgentFleet } from '../../shared/session-chat';
import { sessionChatAgentFleetRows } from '@/packages/shared/session-chat-presentation/agent-fleet';
import { persistSessionChatInteractions, sessionChatInteractionState } from './session-chat-interaction-state';
import { SessionChatSimpleModeContext } from './session-chat-simple-mode';
import { SessionChatStatusCard, SessionChatStatusCardLead } from './session-chat-status-card';
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
  const projection = sessionChatAgentFleetRows(fleet, provider, now);
  const stale = projection?.stale === true;
  // Keep checking the observation lease even when every row's elapsed clock is idle.
  useEffect(() => {
    if (detectedAt === null || stale) {
      return;
    }
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), FLEET_CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, [detectedAt, stale]);

  if (!projection) {
    return null;
  }

  const { countLabel, rows } = projection;

  return (
    <SessionChatStatusCard
      aria-label='Subagents'
      className='ghostex-chat-agent-fleet'
      data-stale={stale || undefined}
      lead={<SessionChatStatusCardLead icon={IconUsers} />}
      meta={countLabel}
      onOpenChange={toggleOpen}
      open={open}
      role='group'
      // CDXC:SessionChat 2026-09-07 DECISION: User: the title is "Subagents", without a hyphen or all caps.
      title='Subagents'
      toggleTitle={{ open: 'Minimize subagents', closed: 'Expand subagents' }}
    >
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
        {/* CDXC:SessionChat 2026-09-12 DECISION: User: Codex rows show the child name/path beside the model and effort in the status column, moving it out of the tooltip; Claude keeps its task text. */}
        {rows.map((row) => {
          const { statusText, idle, working } = row;
          const transcriptTarget = {
            name: row.name,
            selector: row.selector,
            agentType: row.agentType,
            task: row.task,
            model: row.model,
            effort: row.effort,
          };
          return (
            <div
              className='ghostex-chat-agent-fleet-row'
              key={row.key}
              role='listitem'
              data-status={stale ? 'unavailable' : idle ? 'idle' : 'working'}
            >
              <span
                aria-hidden='true'
                className='ghostex-chat-agent-fleet-pulse'
                style={
                  !working ? { animation: 'none', backgroundColor: 'var(--muted-foreground)', opacity: 0.5 } : undefined
                }
              />
              <span className='ghostex-chat-card-content ghostex-chat-agent-fleet-name'>
                <SessionChatSubagentLink {...transcriptTarget} showAgentType={row.showAgentType}>
                  <SessionChatSubagentModel info={{ model: row.model, effort: row.effort }} />
                </SessionChatSubagentLink>
              </span>
              {/* Task and marker share one cell: `+2` reads as belonging to the
                  work on its left, and staying out of the clock's column keeps
                  a marked row aligned with every unmarked one. */}
              <span className='ghostex-chat-agent-fleet-work'>
                {/* CDXC:SessionChat 2026-09-10 DECISION: User: put the ‣ separator at the start of the status cell so it aligns across subagent rows regardless of model label width. */}
                {row.marker ? (
                  <span aria-hidden='true' className='ghostex-chat-card-content shrink-0'>
                    ‣
                  </span>
                ) : null}
                {idle && !stale ? <span className='ghostex-chat-card-hint'>Idle</span> : null}
                <span className='ghostex-chat-card-content ghostex-chat-agent-fleet-task'>
                  {statusText ? (
                    <SessionChatSubagentLink {...transcriptTarget} showAgentType={row.showAgentType}>
                      {statusText}
                    </SessionChatSubagentLink>
                  ) : (
                    ''
                  )}
                </span>
                {row.nested ? (
                  <span
                    className='ghostex-chat-card-hint [--chat-card-hint-base:0.625rem] ghostex-chat-agent-fleet-nested'
                    title={row.nestedTitle}
                  >
                    +{row.nested}
                  </span>
                ) : null}
              </span>
              {/* Counter, separator and clock are three tracks, not one cell:
                  that is what right-aligns every counter on the same edge no
                  matter how long the one above it was. The separator only
                  appears when it has something on both sides of it. */}
              <span className='ghostex-chat-card-hint [--chat-card-hint-base:0.6875rem] ghostex-chat-agent-fleet-tokens'>
                {row.tokens}
              </span>
              <span aria-hidden='true' className='ghostex-chat-agent-fleet-separator'>
                {row.separator}
              </span>
              <span className='ghostex-chat-card-hint [--chat-card-hint-base:0.6875rem] ghostex-chat-agent-fleet-clock'>
                {row.elapsedLabel}
              </span>
            </div>
          );
        })}
      </div>
    </SessionChatStatusCard>
  );
}
