import type { Menu } from '@base-ui/react/menu';

/**
 * CDXC:DesignSystem 2026-09-15 DECISION:
 * User: Switch Account and other submenus must stay open when the pointer crosses another menu item so their contents remain easy to reach.
 */
export function keepSubmenuOpenOnHover(open: boolean, details: Menu.SubmenuRoot.ChangeEventDetails) {
  if (open) return;

  const trigger = details.trigger;
  const parentMenu = trigger?.closest('[role="menu"]');

  if (details.reason === 'trigger-hover') {
    details.cancel();
  } else if (details.reason === 'sibling-open') {
    // Base UI uses sibling-open for both hovering a regular row and opening
    // another submenu. Only an actually expanded sibling replaces this menu.
    const siblingIsOpen =
      parentMenu &&
      Array.from(parentMenu.querySelectorAll('[aria-haspopup="menu"][aria-expanded="true"]')).some(
        (candidate) => candidate !== trigger && candidate.closest('[role="menu"]') === parentMenu
      );
    if (parentMenu && !siblingIsOpen) details.cancel();
  } else if (details.reason === 'focus-out') {
    // Hover highlighting moves focus into the parent menu as well.
    const target = (details.event as FocusEvent).relatedTarget;
    if (target instanceof Element && target.closest('[role="menu"]') === parentMenu) details.cancel();
  }
}
