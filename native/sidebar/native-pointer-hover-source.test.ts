import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const appDelegateSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift", import.meta.url),
  "utf8",
);
const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");
const titlebarHostSource = readFileSync(new URL("./titlebar-host.tsx", import.meta.url), "utf8");
const sessionCardsSource = readFileSync(
  new URL("../../sidebar/styles/session-cards.css", import.meta.url),
  "utf8",
);
const sessionOverlaysSource = readFileSync(
  new URL("../../sidebar/styles/session-overlays.css", import.meta.url),
  "utf8",
);
const workspaceThemeSource = readFileSync(
  new URL("../../sidebar/styles/workspace-theme.css", import.meta.url),
  "utf8",
);
const groupPanelsSource = readFileSync(
  new URL("../../sidebar/styles/group-panels.css", import.meta.url),
  "utf8",
);
const appTooltipSource = readFileSync(new URL("../../sidebar/app-tooltip.tsx", import.meta.url), "utf8");
const tooltipPrimitiveSource = readFileSync(
  new URL("../../components/ui/tooltip.tsx", import.meta.url),
  "utf8",
);
const sidebarBridgeSource = readFileSync(
  new URL("../../sidebar/sidebar-context-menu-portal.tsx", import.meta.url),
  "utf8",
);

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("native pointer hover boundary source", () => {
  test("keeps AppKit pointer ownership wired as tooltip cleanup instead of persistent hover gates", () => {
    /*
     * CDXC:SidebarHover 2026-06-10-23:44:
     * Sticky WebKit :hover must be neutralized at the native pointer boundary.
     * The fix is only complete when AppKit tracking and JS bridge state remain
     * wired while the sidebar document stays interactive enough to recover on
     * the next DOM pointer movement.
     *
     * CDXC:SidebarHover 2026-06-11-09:23:
     * Keep explicit native-outside CSS overrides for sidebar session visuals,
     * but do not let the native pointer flag own titlebar tooltip visibility or
     * broad sidebar hit testing.
     *
     * CDXC:SidebarHover 2026-06-11-09:34:
     * Sidebar rows must not keep a second highlighted session when native says
     * the pointer left. Assert that the native-outside reset covers the row
     * ::after hover surface and remains late enough to beat reference-sidebar
     * hover styling.
     *
     * CDXC:TooltipLifecycle 2026-06-13-02:30:
     * Native pointer-leave should close currently visible tooltips and stale
     * row visuals, but it must not disable hit testing or set a persistent
     * tooltip-suppression flag. Hover needs to recover on the next DOM pointer
     * movement without requiring a click.
     *
     * CDXC:SidebarTooltips 2026-06-30-02:02:
     * Tooltip surfaces in the macOS sidebar must be completely non-interactive:
     * Base UI, fixed action, and session-title tooltip popups need
     * pointer-events disabled so hovering, scrolling, or clicking on a tooltip
     * passes through to the underlying sidebar.
     */
    expect(appDelegateSource).toContain("var onNativePointerInsideChanged: ((Bool) -> Void)?");
    expect(appDelegateSource).toContain(".mouseEnteredAndExited, .mouseMoved");
    expect(appDelegateSource).toContain("setSidebarNativePointerInside");
    expect(appDelegateSource).toContain("window.__ghostex_NATIVE_SIDEBAR__?.setNativePointerInside");
    expect(appDelegateSource).toContain("window.__ghostex_TITLEBAR__?.setNativePointerInside");
    expect(appDelegateSource).toContain("isPointInFixedTitlebarStrip(convert(event.locationInWindow, from: nil))");
    expect(appDelegateSource).toContain("final class TitlebarChromeWebView: WKWebView");
    expect(appDelegateSource).toContain("override var mouseDownCanMoveWindow: Bool");
    expect(appDelegateSource).not.toContain("var onTitlebarMouseEvent: ((NSEvent) -> Bool)?");
    expect(appDelegateSource).not.toContain("func routeTitlebarMouseEventFromWindow(_ event: NSEvent) -> Bool");
    expect(appDelegateSource).not.toContain("func routeWindowMouseEvent(_ event: NSEvent) -> Bool");
    expect(appDelegateSource).not.toContain("dispatchWindowMouseEventToWebView");
    expect(appDelegateSource).not.toContain("shouldConsumeTitlebarWindowMouseEvent");
    expect(appDelegateSource).not.toContain("windowSendEvent.titlebarRerouted");
    expect(appDelegateSource).not.toContain("override func hitTest(_ point: NSPoint) -> NSView?");
    expect(appDelegateSource).toContain("divider.onPointerEntered = { [weak self] in");
    expect(appDelegateSource).toContain("self?.sidebarView.forceNativePointerInside(false)");
    expect(appDelegateSource).toContain("func forceNativePointerInside(_ isInside: Bool)");
    expect(appDelegateSource).toContain("shouldLetTitlebarHandleOutsideMouseEvent");
    expect(appDelegateSource).toContain("pre-close titlebar");
    expect(appDelegateSource).toContain("containsTitlebarStripPoint(titlebarPoint)");
    expect(appDelegateSource).not.toContain("containsInteractiveHitRegion");
    expect(appDelegateSource).not.toContain("ReactTitlebarHitRegion");
    expect(appDelegateSource).not.toContain("setReactTitlebarHitRegions");
    expect(appDelegateSource).toContain("setReactTitlebarStripState");
    expect(appDelegateSource).toContain("performBlankTitlebarMouseDownFromWebContent");
    expect(appDelegateSource).toContain("handleBlankTitlebarMouseDown");
    expect(appDelegateSource).toContain("activeMouseDownEvent");
    const titlebarChromeWebViewSource = sourceBetween(
      appDelegateSource,
      "final class TitlebarChromeWebView: WKWebView",
      "final class SidebarWebView: WKWebView",
    );
    expect(titlebarChromeWebViewSource).toContain("private static let leftMouseButtonMask = 1");
    expect(titlebarChromeWebViewSource).toContain("override func mouseUp(with event: NSEvent)");
    expect(titlebarChromeWebViewSource).toContain("NSEvent.pressedMouseButtons & Self.leftMouseButtonMask");
    expect(titlebarChromeWebViewSource).not.toContain("DispatchQueue.main.async");

    expect(nativeSidebarSource).toContain("function setNativeSidebarPointerInside(isInside: boolean): void");
    expect(nativeSidebarSource).toContain("function setSidebarNativePointerState(isInside: boolean): void");
    expect(nativeSidebarSource).not.toContain("let latestNativeSidebarPointerInside = true");
    expect(nativeSidebarSource).not.toContain("latestNativeSidebarPointerInside && !sidebarDomHoverSuppressed");
    expect(nativeSidebarSource).not.toContain('document.body.dataset.sidebarTooltipsSuppressed = "true"');
    expect(nativeSidebarSource).toContain("setNativePointerInside: setNativeSidebarPointerInside");
    expect(nativeSidebarSource).toContain("suppressSidebarHoverFromDom();");
    expect(nativeSidebarSource).toContain("dismissSidebarTooltips();");
    expect(nativeSidebarSource).toContain('document.addEventListener("pointermove", enableSidebarTooltips');
    expect(nativeSidebarSource).toContain("function enableSidebarHoverFromDom(): void");

    expect(titlebarHostSource).toContain("function setTitlebarNativePointerInside(isInside: boolean): void");
    expect(titlebarHostSource).toContain("setNativePointerInside: setTitlebarNativePointerInside");
    expect(titlebarHostSource).toContain("function enableTitlebarTooltipsFromDom(): void");
    expect(titlebarHostSource).toContain('document.addEventListener("pointermove", enableTitlebarTooltips');
    expect(titlebarHostSource).toContain("nativeDropdownOpen === kind");
    expect(titlebarHostSource).toContain("requesting the already-open panel closes it");
    expect(titlebarHostSource).toContain('type: "setReactTitlebarStripState"');
    expect(titlebarHostSource).toContain("publishTitlebarStripState");
    expect(titlebarHostSource).toContain('type: "titlebarBlankMouseDown"');
    expect(titlebarHostSource).toContain("requestTitlebarBlankMouseDown");
    expect(titlebarHostSource).toContain("Blank titlebar drag should use normal DOM event ownership");
    expect(titlebarHostSource).not.toContain("data-titlebar-hit-region");
    expect(titlebarHostSource).not.toContain("querySelectorAll<HTMLElement>(\"[data-titlebar-hit-region]\")");
    expect(titlebarHostSource).not.toContain("setReactTitlebarHitRegions");
    expect(titlebarHostSource).not.toContain('body[data-native-pointer-inside="false"] #root');
    /*
     * CDXC:TitlebarTooltips 2026-06-13-02:59:
     * Right-side titlebar icon tooltips must use the same AppTooltip wrapper as
     * sidebar buttons, not local titlebar-only data-tooltip pseudo-elements.
     *
     * CDXC:TitlebarTooltips 2026-06-15-13:34:
     * Floating titlebar tooltip labels must not keep themselves open when the
     * pointer moves onto the label. Assert that every titlebar AppTooltip root
     * disables Base UI's hoverable popup behavior.
     *
     * CDXC:TitlebarTooltips 2026-06-15-16:40:
     * Titlebar button hover labels should render higher via the shared
     * tooltip positioner alignment offset, not with titlebar-only transforms.
     *
     * CDXC:TitlebarTooltips 2026-06-15-23:25:
     * Titlebar hover labels should be shifted 2px farther up and made 6px
     * shorter without changing sidebar tooltip geometry.
     *
     * CDXC:TitlebarTooltips 2026-06-16-01:19:
     * Actions and Open In titlebar hover labels should state the button
     * function before the right-click menu instruction.
     */
    expect(titlebarHostSource).toContain("import { AppTooltip, TooltipProvider } from");
    expect(titlebarHostSource).toContain("function TitlebarAppTooltip");
    expect(titlebarHostSource).toContain("const TITLEBAR_TOOLTIP_ROOT_PROPS");
    expect(titlebarHostSource).toContain("disableHoverablePopup: true");
    expect(titlebarHostSource).toContain("Hovering the floating label itself must not keep it open");
    expect(titlebarHostSource).toContain("const TITLEBAR_TOOLTIP_ALIGN_OFFSET_PX = -4;");
    expect(titlebarHostSource).toContain("alignOffset = TITLEBAR_TOOLTIP_ALIGN_OFFSET_PX");
    expect(titlebarHostSource).toContain("alignOffset={alignOffset}");
    expect(titlebarHostSource).toContain(".titlebar-app-tooltip");
    expect(titlebarHostSource).toContain("padding-bottom: 3px !important;");
    expect(titlebarHostSource).toContain("padding-top: 3px !important;");
    expect(
      [...titlebarHostSource.matchAll(/<AppTooltip[\s\S]*?>/g)].every((match) =>
        match[0].includes("{...TITLEBAR_TOOLTIP_ROOT_PROPS}"),
      ),
    ).toBe(true);
    expect(titlebarHostSource).not.toContain("<Tooltip>");
    expect(titlebarHostSource).not.toContain("<TooltipTrigger");
    expect(titlebarHostSource).not.toContain("<TooltipContent");
    expect(titlebarHostSource).toContain('<TitlebarAppTooltip content="Tips">');
    expect(titlebarHostSource).not.toContain('<TitlebarAppTooltip content="Keep awake">');
    expect(titlebarHostSource).toContain('<TitlebarAppTooltip content="Resources Monitor">');
    expect(titlebarHostSource).toContain('<TitlebarAppTooltip content="Git actions">');
    expect(titlebarHostSource).toContain('<TitlebarAppTooltip content="Quick Actions. Right click for more options">');
    expect(titlebarHostSource).toContain(
      '<TitlebarAppTooltip content="Open in an app. Right click for more options">',
    );
    expect(titlebarHostSource).not.toContain(".titlebar-update-button::after");
    expect(titlebarHostSource).not.toContain("content: attr(data-tooltip);");
    expect(titlebarHostSource).not.toContain(".titlebar-open-group > .titlebar-session-button[data-tooltip]::after");
    expect(titlebarHostSource).not.toContain('<TooltipContent side="left">Tips</TooltipContent>');
    expect(titlebarHostSource).not.toContain(
      '<TooltipContent side="left">Click to toggle. Right-click for options.</TooltipContent>',
    );
    expect(titlebarHostSource).not.toContain('<TooltipContent side="left">Resources Monitor</TooltipContent>');
    expect(titlebarHostSource).not.toContain(
      '<TooltipContent side="left">Commit. Right-click for more actions</TooltipContent>',
    );
    expect(titlebarHostSource).not.toContain(
      '<TooltipContent side="left">Click to run. Right-click for actions.</TooltipContent>',
    );
    expect(titlebarHostSource).not.toContain(
      '<TooltipContent side="left">Click to open. Right-click for targets.</TooltipContent>',
    );
    expect(titlebarHostSource).not.toContain("Click to run. Right-click for actions.");
    expect(titlebarHostSource).not.toContain("Click to open. Right-click for targets.");
    expect(titlebarHostSource).not.toContain("[data-radix-popper-content-wrapper]");
    expect(titlebarHostSource).toContain(".titlebar-resource-tooltip");
    /*
     * CDXC:TitlebarResources 2026-06-12-03:26:
     * Resources header Sleep actions must not depend on raw CSS :hover in the
     * native child dropdown. Stale WebKit hover can show the tooltip while
     * leaving the buttons unable to receive clicks.
     *
     * CDXC:TitlebarResources 2026-06-12-23:37:
     * The header Sleep buttons should be normal always-hit-testable buttons.
     * Do not reintroduce React hover gates, native-pointer body-flag workarounds,
     * or hidden-by-default CSS that can make visible controls reject clicks.
     */
    expect(titlebarHostSource).not.toContain("resourceHeaderActionsActive");
    expect(titlebarHostSource).not.toContain("data-actions-active");
    expect(titlebarHostSource).not.toContain("child dropdown documents");
    expect(titlebarHostSource).not.toContain("Sleep header tooltips are temporarily commented out");
    expect(titlebarHostSource).not.toContain("const [sleepInactiveTooltipOpen");
    expect(titlebarHostSource).not.toContain(".titlebar-resources-header[data-actions-active");
    expect(titlebarHostSource).not.toContain(".titlebar-resources-header:hover .titlebar-resources-action-button");
    /*
     * CDXC:TitlebarResources 2026-06-13-00:56:
     * Resource item Focus and Sleep/Close buttons should also stay normal
     * visible controls. Do not hide them behind row hover, overlay them on
     * metrics, or let native-pointer stale-hover CSS disable their clicks.
     *
     * CDXC:TitlebarResources 2026-06-13-02:07:
     * CPU/RAM metrics should render as one stable usage cluster without
     * drifting into the action button area.
     *
     * CDXC:TitlebarResources 2026-06-13-02:13:
     * Resource Focus should dismiss the native child window after forwarding
     * focus, or the panel keeps covering the newly focused workspace and the
     * click appears to do nothing.
     *
     * CDXC:TitlebarResources 2026-06-14-16:50:
     * The row-level Close action in Resources should match Sleep's neutral
     * background, border, and icon color. Keep the destructive meaning in the
     * X icon and label instead of restoring the previous red button palette.
     *
     * CDXC:TitlebarResources 2026-06-16-01:10:
     * CPU/RAM metrics should be the far-right row column, with Focus and
     * Sleep/Close immediately to their left.
     *
     * CDXC:TitlebarResources 2026-06-16-07:37:
     * Resource row action buttons should stay on the same grid row as metrics,
     * and CPU/RAM cards should use the same fixed smaller dimensions for
     * parent rows and expanded child-process rows.
     */
    expect(titlebarHostSource).toContain('className="titlebar-resource-metrics"');
    expect(titlebarHostSource).toContain('className="titlebar-resource-child-metrics"');
    expect(titlebarHostSource).toMatch(
      /const focusResourceSession = \(sessionId: string\) => \{[\s\S]*postNative\(\{ sessionId, type: "focusResourceSessionFromTitlebar" \}\);[\s\S]*closeTitlebarDropdownPanel\(\);[\s\S]*\};/,
    );
    expect(titlebarHostSource).toContain("grid-template-columns: minmax(0, 1fr) 24px 24px 200px");
    expect(titlebarHostSource).toContain("grid-template-columns: 86px 106px");
    expect(titlebarHostSource).toContain("grid-template-columns: minmax(0, 1fr) 200px");
    expect(titlebarHostSource).toContain("grid-column: 4;");
    expect(titlebarHostSource).toContain("grid-row: 1;");
    expect(titlebarHostSource).toContain("justify-self: end;");
    expect(titlebarHostSource).toContain("background: rgba(255,255,255,0.055);");
    expect(titlebarHostSource).toContain("Row-level Close should carry the same neutral background");
    expect(titlebarHostSource).toMatch(
      /\.titlebar-resource-kill-button \{[\s\S]*background: rgba\(255,255,255,0\.14\);[\s\S]*border-color: rgba\(255,255,255,0\.16\);[\s\S]*color: rgba\(255,255,255,0\.9\);[\s\S]*grid-column: 3;/,
    );
    expect(titlebarHostSource).toContain(".titlebar-resource-kill-button[data-action=\"quit\"]:focus-visible");
    expect(titlebarHostSource).not.toContain("background: rgb(220 38 38);");
    expect(titlebarHostSource).not.toContain("background: rgb(185 28 28);");
    expect(titlebarHostSource).not.toContain("border-color: rgba(248,113,113,0.45);");
    expect(titlebarHostSource).not.toContain("actionTooltipTitle");
    expect(titlebarHostSource).not.toContain("actionTooltipBody");
    expect(titlebarHostSource).not.toContain(".titlebar-resource-row:hover");
    expect(titlebarHostSource).not.toContain(".titlebar-resource-row:focus-within");
    expect(titlebarHostSource).not.toContain('body[data-native-pointer-inside="false"] .titlebar-resource-row');
    expect(titlebarHostSource).not.toContain(
      'body[data-native-pointer-inside="false"] .titlebar-session-button:hover',
    );

    expect(sessionCardsSource).toContain('body.native-sidebar-body[data-native-pointer-inside="false"]');
    expect(sessionCardsSource).toContain(".session:not(:focus-visible):not([data-focused=\"true\"]):not(");
    expect(sessionCardsSource).toContain("):hover::after");
    expect(sessionCardsSource).toContain("avoid showing both the focused row and the last hovered row as active");
    expect(sessionCardsSource).toContain(".session:has(.session-card-close-button):hover:not(:focus-visible):not(:focus-within)");

    expect(workspaceThemeSource).not.toContain('body.native-sidebar-body[data-native-pointer-inside="false"] #root');
    expect(workspaceThemeSource).toContain("Do not disable #root hit testing");
    expect(appTooltipSource).toContain("function setSidebarTooltipSuppressionBodyFlag(suppressed: boolean)");
    expect(appTooltipSource).toContain('side={side}');
    expect(appTooltipSource).toContain('alignOffset={alignOffset}');
    expect(appTooltipSource).toContain('body.dataset.sidebarTooltipsSuppressed = "true"');
    expect(appTooltipSource).toContain("delete body.dataset.sidebarTooltipsSuppressed");
    const sharedTooltipPositionerSource = sourceBetween(
      tooltipPrimitiveSource,
      "<TooltipPrimitive.Positioner",
      ">",
    );
    expect(sharedTooltipPositionerSource).toContain('className="pointer-events-none isolate z-50"');
    expect(tooltipPrimitiveSource).toContain('"pointer-events-none z-50 inline-block');
    expect(sourceBetween(sessionOverlaysSource, ".session-local-tooltip-popup {", "}")).toContain(
      "pointer-events: none;",
    );
    expect(sourceBetween(groupPanelsSource, ".sidebar-fixed-tooltip-popup {", "}")).toContain(
      "pointer-events: none;",
    );
    expect(groupPanelsSource).toContain("This body flag is drag-only tooltip suppression");

    expect(sidebarBridgeSource).toContain("setNativePointerInside: (isInside: boolean) => void");
  });
});
