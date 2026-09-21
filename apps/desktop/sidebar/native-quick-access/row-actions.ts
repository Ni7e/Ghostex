/**
 * The actions a Quick Access row offers: the list behind a row's right-click menu and the footer's Actions panel,
 * and the accelerators that run one of them without opening either.
 *
 * CDXC:AppModal 2026-09-21 DECISION:
 * User: make Quick Access look like Raycast. Rows carry no hover buttons any more; everything a row could do (open,
 * star, tag, copy, edit, delete, remove) is listed here once, reached with right-click, the Actions panel (Cmd+K) or
 * the action's own hotkey. Supersedes the per-row icon strips ported from the React rows.
 */
import { formatSidebarHotkeyLabel } from '@/packages/core-ui/hotkey-label';
import type { QuickAccessMenuItem } from '@/packages/shared/native-quick-access';
import { assetIcon, NO_ICON } from './icons';

/** Wire hotkeys by menu item id. Chosen to stay clear of the search field's own editing keys (Cmd+A/C/V/X/Z). */
const ACTION_HOTKEYS: Record<string, string> = {
  addPrompt: 'cmd+n',
  copyPath: 'cmd+shift+c',
  remove: 'cmd+d',
  'prompt:open': 'cmd+o',
  'prompt:favorite': 'cmd+s',
  'prompt:save': 'cmd+s',
  'prompt:tag': 'cmd+t',
  'prompt:copy': 'cmd+shift+c',
  'prompt:edit': 'cmd+e',
  'prompt:delete': 'cmd+d',
};

export const QUICK_ACCESS_ACTION_HOTKEYS: string[] = [...new Set(Object.values(ACTION_HOTKEYS))];

export const ACTIVATE_ACTION_ID = 'activate';

export function actionItem(
  id: string,
  label: string,
  icon: string,
  options: { danger?: boolean; disabled?: boolean; hotkey?: string } = {}
): QuickAccessMenuItem {
  const wireHotkey = ACTION_HOTKEYS[id];
  return {
    id,
    label,
    icon: assetIcon(icon),
    hotkey:
      options.hotkey ?? (id === ACTIVATE_ACTION_ID ? '↵' : wireHotkey ? formatSidebarHotkeyLabel(wireHotkey) : ''),
    danger: options.danger === true,
    disabled: options.disabled === true,
    separator: false,
  };
}

export const ACTION_SEPARATOR: QuickAccessMenuItem = {
  id: 'separator',
  label: '',
  icon: NO_ICON,
  hotkey: '',
  danger: false,
  disabled: false,
  separator: true,
};

/** Drops leading, trailing and doubled separators so optional sections can be appended freely. */
export function tidyActionItems(items: QuickAccessMenuItem[]): QuickAccessMenuItem[] {
  return items.filter(
    (item, index) => !item.separator || (index > 0 && index < items.length - 1 && !items[index - 1]?.separator)
  );
}

/** The enabled item `hotkey` (wire form) runs, if this row offers one. */
export function actionForHotkey(items: QuickAccessMenuItem[], hotkey: string): QuickAccessMenuItem | undefined {
  return items.find((item) => !item.separator && !item.disabled && ACTION_HOTKEYS[item.id] === hotkey);
}
