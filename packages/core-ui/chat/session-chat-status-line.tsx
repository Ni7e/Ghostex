// The text status line under the chat box: the starred context detail rows
// (session-chat-context-details.ts), values only, wrapping as the chat
// narrows. Hovering a value names the row it came from. A diamond separates
// items because the middle dot already separates the parts inside one value.

import { Fragment, useEffect, useState } from 'react';
import { AccountText } from '../accounts/account-text';
import { createAppToastRequest } from '../../shared/app-toast-contract';
import { postAppModalHostMessage } from '../app-modal-host-bridge';
import { AppTooltip } from '../app-tooltip';
import type { SessionChatContextDetailItem } from './session-chat-context-details';
import type { SessionChatPresentationStore } from './session-chat-presentation-cache';

function copyStatusLineItem(copy: { text: string; label: string }): void {
  void navigator.clipboard.writeText(copy.text).then(() => {
    try {
      postAppModalHostMessage(createAppToastRequest('success', copy.label, copy.text), 'SessionChatStatusLine:toast');
    } catch {
      // Toast-host availability must never gate the copy itself.
    }
  });
}

/** CDXC:AgentProviders 2026-09-10 DECISION: Hide emails also applies to the chat status line, context meter details, and Context details dialog previews, including hover text. */
/** CDXC:AgentProviders 2026-09-14 DECISION:
 * User: show a previously loaded chat's status line immediately when returning; keep the three-second wait and reserved space only for its initial load.
 * This supersedes repeating the 2026-09-12 initial fade on every chat activation.
 */
export function SessionChatStatusLine({
  hasConfiguredItems = false,
  items,
  presentation,
}: {
  hasConfiguredItems?: boolean;
  items: readonly SessionChatContextDetailItem[];
  presentation?: SessionChatPresentationStore | undefined;
}) {
  const [initialDelayElapsed, setInitialDelayElapsed] = useState(
    () => presentation?.getSnapshot().statusLineReady === true
  );
  const visible = initialDelayElapsed && items.length > 0;

  useEffect(() => {
    if (presentation?.getSnapshot().statusLineReady) return;
    const timeout = window.setTimeout(() => setInitialDelayElapsed(true), 3000);
    return () => window.clearTimeout(timeout);
  }, [presentation]);

  useEffect(() => {
    if (visible) presentation?.update({ statusLineReady: true });
  }, [visible, presentation]);

  const shouldReserveSpace = hasConfiguredItems || items.length > 0;
  if (initialDelayElapsed && !shouldReserveSpace) {
    return null;
  }
  return (
    <div
      aria-hidden={!visible}
      aria-label='Session status'
      className={`ghostex-chat-status-line${visible ? ' is-visible' : ''}${shouldReserveSpace ? ' is-reserved' : ''}`}
      role='status'
    >
      {items.map((item, index) => (
        <Fragment key={item.id}>
          {index > 0 ? (
            <span aria-hidden='true' className='ghostex-chat-status-line-separator'>
              ◆
            </span>
          ) : null}
          {item.copy ? (
            <AppTooltip content={`${item.label} · Click to copy id`} side='top'>
              <button
                className='ghostex-chat-status-line-item ghostex-chat-status-line-copy'
                onClick={() => copyStatusLineItem(item.copy!)}
                type='button'
              >
                <AccountText text={item.value} />
              </button>
            </AppTooltip>
          ) : (
            <AppTooltip content={item.label} side='top'>
              <span className='ghostex-chat-status-line-item'>
                <AccountText text={item.value} />
              </span>
            </AppTooltip>
          )}
        </Fragment>
      ))}
    </div>
  );
}
