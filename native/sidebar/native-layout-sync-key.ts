import type { NativeTerminalLayout } from "../../shared/native-ghostty-host-protocol";

export type NativeLayoutSyncKeyInput = {
  activeProjectEditorId?: string;
  activeSessionIds?: string[];
  commandsPanelActiveSessionIds?: string[];
  commandsPanelHeightRatio?: number;
  commandsPanelIsVisible?: boolean;
  commandsPanelLayout?: NativeTerminalLayout;
  commandsPanelMode?: "floating" | "pinned";
  layout?: NativeTerminalLayout;
  mountingSessionIds?: string[];
  paneGap?: number;
  terminalPaneHorizontalPaddingPx?: number;
  terminalPaneVerticalPaddingPx?: number;
};

export function createNativeLayoutSyncKey(input: NativeLayoutSyncKeyInput): string {
  /**
   * CDXC:NativeGpu 2026-05-08-16:45
   * The expensive native AppKit layout only depends on visible surface
   * identity, split geometry, fixed pane gap, and active editor surface. Pane
   * titles, activity colors, focus display, and icons are chrome metadata and
   * must not make the host reframe IOSurface-backed terminal/browser views.
   *
   * CDXC:ProjectEditorCompanion 2026-06-04-03:42:
   * Source/Git/Code sidebar clicks retarget the companion terminal by changing
   * focusedSessionId and tab activeSessionId. That must remain a focus update,
   * not a geometry change, so the layout key strips activeSessionId from tab
   * nodes before hashing and avoids reframing the adjacent CEF editor pane.
   */
  return JSON.stringify(
    normalizeNativeLayoutSyncValue({
      activeProjectEditorId: input.activeProjectEditorId,
      activeSessionIds: input.activeSessionIds,
      commandsPanelActiveSessionIds: input.commandsPanelActiveSessionIds,
      commandsPanelHeightRatio: input.commandsPanelHeightRatio,
      commandsPanelIsVisible: input.commandsPanelIsVisible,
      commandsPanelLayout: normalizeNativeLayoutGeometry(input.commandsPanelLayout),
      commandsPanelMode: input.commandsPanelMode,
      layout: normalizeNativeLayoutGeometry(input.layout),
      mountingSessionIds: input.mountingSessionIds,
      paneGap: input.paneGap,
      terminalPaneHorizontalPaddingPx: input.terminalPaneHorizontalPaddingPx,
      terminalPaneVerticalPaddingPx: input.terminalPaneVerticalPaddingPx,
    }),
  );
}

export function createNativePaneOwnerSelectionKey(input: NativeLayoutSyncKeyInput): string {
  /*
  CDXC:PaneTabs 2026-06-04-12:54:
  The native host applies visible tab owner changes without running the full
  geometry layout path. Keep this key separate from createNativeLayoutSyncKey so
  CEF flicker prevention can ignore activeSessionId while terminal tab
  surfacing still observes it.
  */
  return JSON.stringify(
    normalizeNativeLayoutSyncValue({
      activeProjectEditorId: input.activeProjectEditorId,
      activeSessionIds: input.activeSessionIds,
      commandsPanelActiveSessionIds: input.commandsPanelActiveSessionIds,
      commandsPanelIsVisible: input.commandsPanelIsVisible,
      commandsPanelLayout: normalizeNativePaneOwnerSelection(input.commandsPanelLayout),
      layout: normalizeNativePaneOwnerSelection(input.layout),
      mountingSessionIds: input.mountingSessionIds,
    }),
  );
}

export function normalizeNativeLayoutGeometry(
  layout: NativeTerminalLayout | undefined,
): NativeTerminalLayout | undefined {
  if (!layout) {
    return undefined;
  }
  if (layout.kind === "tabs") {
    return {
      kind: "tabs",
      sessionIds: layout.sessionIds,
    };
  }
  if (layout.kind === "split") {
    return {
      children: layout.children
        .map(normalizeNativeLayoutGeometry)
        .filter((child): child is NativeTerminalLayout => Boolean(child)),
      direction: layout.direction,
      kind: "split",
      ratio: layout.ratio,
    };
  }
  return layout;
}

function normalizeNativePaneOwnerSelection(
  layout: NativeTerminalLayout | undefined,
): NativeTerminalLayout | undefined {
  if (!layout) {
    return undefined;
  }
  if (layout.kind === "tabs") {
    return {
      activeSessionId: layout.activeSessionId,
      kind: "tabs",
      sessionIds: layout.sessionIds,
    };
  }
  if (layout.kind === "split") {
    return {
      children: layout.children
        .map(normalizeNativePaneOwnerSelection)
        .filter((child): child is NativeTerminalLayout => Boolean(child)),
      direction: layout.direction,
      kind: "split",
      ratio: layout.ratio,
    };
  }
  return layout;
}

export function normalizeNativeLayoutSyncValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeNativeLayoutSyncValue);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, entryValue]) => [key, normalizeNativeLayoutSyncValue(entryValue)]),
  );
}
