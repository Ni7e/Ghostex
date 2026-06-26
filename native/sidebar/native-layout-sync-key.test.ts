import { describe, expect, test } from "vitest";
import type { NativeTerminalLayout } from "../../shared/native-ghostty-host-protocol";
import {
  createNativeLayoutSyncKey,
  createNativePaneOwnerSelectionKey,
  normalizeNativeLayoutGeometry,
} from "./native-layout-sync-key";

describe("native layout sync key", () => {
  test("ignores focus-only active tab changes inside Source/Git/Code companion panes", () => {
    /**
     * CDXC:ProjectEditorCompanion 2026-06-04-03:42:
     * Clicking Source/Git/Code sidebar sessions changes the companion terminal
     * selection, but it must not be classified as native geometry change
     * because AppKit would relayout the adjacent CEF editor pane and flicker.
     */
    const layoutA: NativeTerminalLayout = {
      activeSessionId: "P3lv0:G5jjo",
      kind: "tabs",
      sessionIds: ["P3lv0:G5jjo", "P3lv0:G9fwl"],
    };
    const layoutB: NativeTerminalLayout = {
      ...layoutA,
      activeSessionId: "P3lv0:G9fwl",
    };

    expect(
      createNativeLayoutSyncKey({
        activeProjectEditorId: "project-editor:P3lv0:git",
        activeSessionIds: ["P3lv0:G5jjo", "P3lv0:G9fwl"],
        layout: layoutA,
        paneGap: 0,
      }),
    ).toBe(
      createNativeLayoutSyncKey({
        activeProjectEditorId: "project-editor:P3lv0:git",
        activeSessionIds: ["P3lv0:G5jjo", "P3lv0:G9fwl"],
        layout: layoutB,
        paneGap: 0,
      }),
    );
  });

  test("tracks active tab owner changes separately from full geometry", () => {
    /*
    CDXC:PaneTabs 2026-06-04-12:54:
    Sidebar session clicks must surface the selected terminal tab even when the
    geometry key intentionally ignores activeSessionId to avoid companion CEF
    flicker.
    */
    const layoutA: NativeTerminalLayout = {
      activeSessionId: "P3lv0:G5jjo",
      kind: "tabs",
      sessionIds: ["P3lv0:G5jjo", "P3lv0:G7za3"],
    };
    const layoutB: NativeTerminalLayout = {
      ...layoutA,
      activeSessionId: "P3lv0:G7za3",
    };

    expect(
      createNativePaneOwnerSelectionKey({
        activeProjectEditorId: undefined,
        activeSessionIds: ["P3lv0:G5jjo", "P3lv0:G7za3"],
        layout: layoutA,
        paneGap: 0,
      }),
    ).not.toBe(
      createNativePaneOwnerSelectionKey({
        activeProjectEditorId: undefined,
        activeSessionIds: ["P3lv0:G5jjo", "P3lv0:G7za3"],
        layout: layoutB,
        paneGap: 0,
      }),
    );
  });

  test("keeps real tab membership and split geometry changes in the layout key", () => {
    const baseLayout: NativeTerminalLayout = {
      children: [
        { activeSessionId: "P3lv0:G5jjo", kind: "tabs", sessionIds: ["P3lv0:G5jjo"] },
        { kind: "leaf", sessionId: "P3lv0:G9fwl" },
      ],
      direction: "horizontal",
      kind: "split",
      ratio: 0.4,
    };
    const extraTabLayout: NativeTerminalLayout = {
      ...baseLayout,
      children: [
        { activeSessionId: "P3lv0:G5jjo", kind: "tabs", sessionIds: ["P3lv0:G5jjo", "P3lv0:G2s1d"] },
        { kind: "leaf", sessionId: "P3lv0:G9fwl" },
      ],
    };
    const resizedLayout: NativeTerminalLayout = {
      ...baseLayout,
      ratio: 0.6,
    };

    const baseKey = createNativeLayoutSyncKey({
      activeProjectEditorId: "project-editor:P3lv0:code",
      activeSessionIds: ["P3lv0:G5jjo", "P3lv0:G9fwl"],
      layout: baseLayout,
      paneGap: 0,
    });

    expect(
      createNativeLayoutSyncKey({
        activeProjectEditorId: "project-editor:P3lv0:code",
        activeSessionIds: ["P3lv0:G5jjo", "P3lv0:G9fwl", "P3lv0:G2s1d"],
        layout: extraTabLayout,
        paneGap: 0,
      }),
    ).not.toBe(baseKey);
    expect(
      createNativeLayoutSyncKey({
        activeProjectEditorId: "project-editor:P3lv0:code",
        activeSessionIds: ["P3lv0:G5jjo", "P3lv0:G9fwl"],
        layout: resizedLayout,
        paneGap: 0,
      }),
    ).not.toBe(baseKey);
  });

  test("tracks terminal pane padding as layout geometry", () => {
    /*
    CDXC:TerminalPanePadding 2026-06-25-21:27:
    Padding changes the AppKit Ghostty content frame inside every terminal pane,
    so the full layout sync key must change even though pane membership and
    tab-owner selection remain unchanged.
    */
    const layout: NativeTerminalLayout = {
      activeSessionId: "P3lv0:G5jjo",
      kind: "tabs",
      sessionIds: ["P3lv0:G5jjo"],
    };
    const baseKey = createNativeLayoutSyncKey({
      activeSessionIds: ["P3lv0:G5jjo"],
      layout,
      paneGap: 0,
      terminalPaneHorizontalPaddingPx: 0,
      terminalPaneVerticalPaddingPx: 0,
    });

    expect(
      createNativeLayoutSyncKey({
        activeSessionIds: ["P3lv0:G5jjo"],
        layout,
        paneGap: 0,
        terminalPaneHorizontalPaddingPx: 14,
        terminalPaneVerticalPaddingPx: 6,
      }),
    ).not.toBe(baseKey);
  });

  test("normalizes nested command-panel tab focus without changing tab membership", () => {
    const layout: NativeTerminalLayout = {
      children: [
        { activeSessionId: "P3lv0:G5jjo", kind: "tabs", sessionIds: ["P3lv0:G5jjo", "P3lv0:G9fwl"] },
        { kind: "leaf", sessionId: "P3lv0:G2s1d" },
      ],
      direction: "vertical",
      kind: "split",
    };

    expect(normalizeNativeLayoutGeometry(layout)).toEqual({
      children: [
        { kind: "tabs", sessionIds: ["P3lv0:G5jjo", "P3lv0:G9fwl"] },
        { kind: "leaf", sessionId: "P3lv0:G2s1d" },
      ],
      direction: "vertical",
      kind: "split",
    });
  });
});
