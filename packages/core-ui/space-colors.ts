import { SIDEBAR_PROJECT_COLLECTION_COLORS, SIDEBAR_PROJECT_COLLECTION_COLOR_LABELS } from './project-collections';

/**
 * CDXC:Spaces 2026-09-21 DECISION: User: merge the two gray Space colors into one, and use one of them for dark mode and one for light mode.
 * A Space offers a single Gray that draws as #4f5663 on light themes and #808080 on dark themes. Spaces saved with either hex are that same Gray, so stored documents need no migration.
 * SEE-ALSO: apps/desktop/src/app/window/space_editor_modal.rs (SPACE_EDITOR_COLORS, space_display_color), apps/desktop/src/app/native_sidebar/selectors.rs.
 */
export const SIDEBAR_SPACE_GRAY_LIGHT_THEME = '#4f5663';
export const SIDEBAR_SPACE_GRAY_DARK_THEME = '#808080';

/** The stored value a Space gets when the user picks Gray. */
export const SIDEBAR_SPACE_GRAY = SIDEBAR_SPACE_GRAY_LIGHT_THEME;

export const SIDEBAR_SPACE_COLORS = SIDEBAR_PROJECT_COLLECTION_COLORS.filter(
  (color) => color !== SIDEBAR_SPACE_GRAY_DARK_THEME
);

export function isSidebarSpaceGray(color: string): boolean {
  const normalized = color.trim().toLowerCase();
  return normalized === SIDEBAR_SPACE_GRAY_LIGHT_THEME || normalized === SIDEBAR_SPACE_GRAY_DARK_THEME;
}

/** Whether a Space saved with `color` is the one the `swatchColor` swatch stands for. */
export function sidebarSpaceColorMatchesSwatch(color: string, swatchColor: string): boolean {
  return swatchColor === SIDEBAR_SPACE_GRAY ? isSidebarSpaceGray(color) : color.trim().toLowerCase() === swatchColor;
}

export function getSidebarSpaceColorLabel(swatchColor: (typeof SIDEBAR_SPACE_COLORS)[number]): string {
  return swatchColor === SIDEBAR_SPACE_GRAY ? 'Gray' : SIDEBAR_PROJECT_COLLECTION_COLOR_LABELS[swatchColor];
}

/** The CSS color a Space draws with; Gray follows the surrounding `color-scheme`. */
export function resolveSidebarSpaceDisplayColor(color: string): string {
  return isSidebarSpaceGray(color)
    ? `light-dark(${SIDEBAR_SPACE_GRAY_LIGHT_THEME}, ${SIDEBAR_SPACE_GRAY_DARK_THEME})`
    : color;
}
