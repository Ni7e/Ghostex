/**
 * CDXC:Sessions 2026-09-16 DECISION:
 * User: reveal the active session with space from the top or bottom of the scroll area, depending on the scroll direction.
 * Keep the requested 50px cushion below sticky headers as well as above the bottom edge; scroll-margin alone also affects clipping ancestors and does not account for the pinned headers.
 */
export function scrollRevealedSessionIntoView(row: HTMLElement, viewport: HTMLElement): void {
  const viewportBounds = viewport.getBoundingClientRect();
  const rowBounds = row.getBoundingClientRect();
  const spaceHeader = viewport.querySelector<HTMLElement>(':scope > .sidebar-space-filter-row');
  const projectHeader = row
    .closest('.group[data-project-group="true"]')
    ?.querySelector<HTMLElement>(':scope > .group-head');
  const pinnedHeight =
    (spaceHeader?.getBoundingClientRect().height ?? 0) + (projectHeader?.getBoundingClientRect().height ?? 0);
  const availableHeight = viewport.clientHeight - pinnedHeight;
  const padding = Math.min(50, Math.max(0, (availableHeight - rowBounds.height) / 2));
  const visibleTop = viewportBounds.top + viewport.clientTop + pinnedHeight + padding;
  const visibleBottom = viewportBounds.top + viewport.clientTop + viewport.clientHeight - padding;
  const delta =
    rowBounds.top < visibleTop
      ? rowBounds.top - visibleTop
      : rowBounds.bottom > visibleBottom
        ? rowBounds.bottom - visibleBottom
        : 0;

  if (Math.abs(delta) < 1) return;
  const top = Math.max(0, Math.min(viewport.scrollTop + delta, viewport.scrollHeight - viewport.clientHeight));
  viewport.scrollTo({ top, behavior: 'smooth' });
}
