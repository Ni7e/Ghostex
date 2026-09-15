// The text status line under the chat box: the starred context detail rows
// (session-chat-context-details.ts), values only, wrapping as the chat
// narrows. Hovering a value names the row it came from. A diamond separates
// items because the middle dot already separates the parts inside one value.

import { Fragment } from 'react';
import { AccountText } from '../accounts/account-text';
import { createAppToastRequest } from '../../shared/app-toast-contract';
import { postAppModalHostMessage } from '../app-modal-host-bridge';
import { AppTooltip } from '../app-tooltip';
import type { SessionChatContextDetailItem } from './session-chat-context-details';
import { useSessionChatStatusLineLayout } from './use-session-chat-status-line-layout';
import { playCopySound } from '../copy-sound';

function copyStatusLineItem(copy: { text: string; label: string }): void {
  playCopySound();
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
 * User: show the status line as soon as its values are known, including on the first load.
 * This supersedes the fixed three-second initial wait; configured items still reserve space while loading.
 */
export function SessionChatStatusLine({
  hasConfiguredItems = false,
  items,
}: {
  hasConfiguredItems?: boolean;
  items: readonly SessionChatContextDetailItem[];
}) {
  const { ref, rowStarts } = useSessionChatStatusLineLayout(items);
  const visible = items.length > 0;
  const shouldReserveSpace = hasConfiguredItems || items.length > 0;
  return (
    <div
      ref={ref}
      hidden={!shouldReserveSpace}
      aria-hidden={!visible}
      aria-label='Session status'
      className={`ghostex-chat-status-line${visible ? ' is-visible' : ''}${shouldReserveSpace ? ' is-reserved' : ''}`}
      role='status'
    >
      {items.map((item, index) => (
        <Fragment key={item.id}>
          {index > 0 && rowStarts.includes(index) ? (
            <span aria-hidden='true' className='ghostex-chat-status-line-break' />
          ) : null}
          <span className='ghostex-chat-status-line-group'>
            <span aria-hidden='true' hidden={rowStarts.includes(index)} className='ghostex-chat-status-line-separator'>
              ◆
            </span>
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
          </span>
        </Fragment>
      ))}
    </div>
  );
}
