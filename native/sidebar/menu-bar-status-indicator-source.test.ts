import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const statusIndicatorSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/SessionStatusIndicatorController.swift", import.meta.url),
  "utf8",
);
const appDelegateSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift", import.meta.url),
  "utf8",
);
const hostProtocolSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/HostProtocol.swift", import.meta.url),
  "utf8",
);
const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("menu bar status indicator source", () => {
  test("opens a running-agents modal on left click and leaves right click inert", () => {
    /*
     * CDXC:MenuBarStatusIndicator 2026-06-22-13:52:
     * Left-clicking the macOS menu bar status button opens a native Running
     * Agents modal grouped by project. Right click and Control-click are
     * no-ops; lifecycle commands live as Restart/Quit footer rows below a
     * separator.
     *
     * CDXC:MenuBarStatusIndicator 2026-06-22-14:41:
     * The modal should have no title bar or close button, close on click-away,
     * keep only one session hover row active, reserve horizontal padding, and
     * use a 2px scrollbar.
     *
     * CDXC:MenuBarStatusIndicator 2026-06-22-22:55:
     * The dropdown should visually match the macOS sidebar, use compact
     * Restart/Quit rows, show last-active time for running rows, and represent
     * Working with an amber square instead of status text.
     *
     * CDXC:MenuBarStatusIndicator 2026-06-22-23:08:
     * The dropdown should be 60px narrower, use the shared sidebar session
     * display order inside each project, darken its background, round session
     * hovers slightly, and show hover backgrounds for Restart/Quit rows.
     *
     * CDXC:MenuBarStatusIndicator 2026-06-22-23:20:
     * Project labels and Restart/Quit rows should have 10px left/right label
     * padding. Opening the dropdown should focus a non-visible native sink so
     * macOS does not draw keyboard focus on any visible row.
     *
     * CDXC:MenuBarStatusIndicator 2026-06-23-04:05:
     * The dropdown should use a #1e1e1e modal background, put each project in
     * its own rounded card, pin the 2px scrollbar to the modal's right edge,
     * and show that scrollbar only while the pointer is hovering over the
     * modal.
     *
     * CDXC:MenuBarStatusIndicator 2026-06-23-04:13:
     * Project titles should sit outside the rounded session cards, matching the
     * reference usage modal's title-above-card structure.
     *
     * CDXC:MenuBarStatusIndicator 2026-06-23-04:20:
     * Opening the dropdown from the menu bar should not activate Ghostex. The
     * session-card padding should be symmetric and the Restart/Quit hover
     * background should be darker than session-row hover.
     */
    const setupSource = sourceBetween(
      statusIndicatorSource,
      "if let button = menuBarStatusItem.button {",
      "  func apply(_ command: SetSessionStatusIndicators) {",
    );
    const targetSource = sourceBetween(
      statusIndicatorSource,
      "private final class MenuBarSessionStatusIndicatorTarget: NSObject {",
      "private final class MenuBarSessionStatusPanelController: NSObject {",
    );
    const panelSource = sourceBetween(
      statusIndicatorSource,
      "private final class MenuBarSessionStatusPanelController: NSObject {",
      "private final class MenuBarStatusProjectButton: NSControl {",
    );

    expect(statusIndicatorSource).toContain("CDXC:MenuBarStatusIndicator 2026-06-22-13:52:");
    expect(setupSource).toContain("_ = button.sendAction(on: [.leftMouseUp])");
    expect(setupSource).not.toContain("rightMouseDown");
    expect(setupSource).not.toContain("button.menu =");
    expect(targetSource).toContain("guard event?.type == .leftMouseUp || event == nil else");
    expect(targetSource).toContain("if event?.modifierFlags.contains(.control) == true");
    expect(targetSource).toContain("panelController.show(from: sender)");
    expect(panelSource).toContain("private static let panelWidth: CGFloat = 370");
    expect(panelSource).toContain("styleMask: [.borderless, .nonactivatingPanel]");
    expect(panelSource).toContain("panel.orderFrontRegardless()");
    expect(panelSource).not.toContain("NSApp.activate");
    expect(panelSource).not.toContain('panel.title = "Running Agents"');
    expect(panelSource).not.toContain("standardWindowButton");
    expect(panelSource).toContain("panel.hidesOnDeactivate = true");
    expect(panelSource).toContain("installDismissEventMonitors()");
    expect(panelSource).toContain("private let focusSink = MenuBarStatusFocusSink");
    expect(panelSource).toContain("panel.makeFirstResponder(focusSink)");
    expect(panelSource).toContain("NSColor(calibratedWhite: 0x1e / 255, alpha: 1)");
    expect(panelSource).toContain("private static let contentHorizontalPadding: CGFloat = 16");
    expect(panelSource).toContain("private static let scrollbarWidth: CGFloat = 2");
    expect(panelSource).toContain("private static let projectSectionSpacing: CGFloat = 10");
    expect(panelSource).toContain("private static let projectTitleCardGap: CGFloat = 4");
    expect(panelSource).toContain("private static let projectCardHorizontalPadding: CGFloat = 6");
    expect(panelSource).toContain("private static let projectCardVerticalPadding: CGFloat = 6");
    expect(panelSource).toContain("private static let footerRowHeight: CGFloat = 30");
    expect(panelSource).toContain("footerStack.distribution = .fill");
    expect(panelSource).toContain("button.widthAnchor.constraint(equalToConstant: Self.contentWidth)");
    expect(panelSource).toContain("let contentView = MenuBarStatusContentView()");
    expect(panelSource).toContain("contentView.onHoverChange = { [weak self] isHovered in");
    expect(panelSource).toContain("scrollbarView.isHidden = true");
    expect(panelSource).toContain("scrollbarView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor)");
    expect(panelSource).toContain("scrollbarView.widthAnchor.constraint(equalToConstant: Self.scrollbarWidth)");
    expect(panelSource).toContain("private final class MenuBarStatusThinScrollbar: NSView");
    expect(panelSource).toContain("private final class MenuBarStatusContentView: NSView");
    expect(panelSource).toContain("private final class MenuBarStatusProjectCardView: NSView");
    expect(panelSource).not.toContain("override func hitTest");
    expect(panelSource).toContain("private weak var hoveredSessionRow: MenuBarStatusSessionRow?");
    expect(panelSource).toContain("private func setHoveredSessionRow(_ row: MenuBarStatusSessionRow?)");
    expect(panelSource).toContain("rowsStack.addArrangedSubview(projectSection(project))");
    expect(panelSource).toContain("sectionStack.addArrangedSubview(projectButton(project))");
    expect(panelSource).toContain("sectionStack.addArrangedSubview(projectCard(project))");
    expect(panelSource).not.toContain("cardStack.addArrangedSubview(projectButton(project))");
    expect(panelSource).toContain("cardStack.addArrangedSubview(sessionRow(project: project, session: session))");
    expect(panelSource).toContain("guard isMouseInsidePanel, visibleHeight > 0, contentHeight > visibleHeight + 1 else");
    expect(panelSource).toContain('actionButton(title: "Restart Ghostex"');
    expect(panelSource).toContain('actionButton(title: "Quit Ghostex"');
    expect(panelSource).toContain("rootStack.addArrangedSubview(separator)");
    expect(statusIndicatorSource).toContain("NSColor(calibratedWhite: 0x20 / 255, alpha: 1)");
    expect(statusIndicatorSource).toContain("NSColor(calibratedWhite: 0x18 / 255, alpha: 1)");
    expect(statusIndicatorSource).toContain("private final class MenuBarStatusActionButton: NSControl");
    expect(statusIndicatorSource).toContain("private final class MenuBarStatusFocusSink: NSView");
    expect(statusIndicatorSource).toContain("private static let labelHorizontalPadding: CGFloat = 10");
    expect(statusIndicatorSource).toContain("focusRingType = .none");
    expect(statusIndicatorSource).toContain(
      "NSBezierPath(roundedRect: bounds.insetBy(dx: 0, dy: 2), xRadius: 6, yRadius: 6).fill()",
    );
    expect(panelSource).toContain("NSFont.systemFont(ofSize: 15.55, weight: .light)");
    expect(statusIndicatorSource).toContain("workingSquareView.widthAnchor.constraint(equalToConstant: 8)");
    expect(panelSource).toContain("project.sessions.sorted(by: { $0.sidebarOrder < $1.sidebarOrder })");
    expect(statusIndicatorSource).toContain("sessionStatusIndicatorImage(fromDataUrl: session.agentIconDataUrl, isTemplate: true)");
    expect(statusIndicatorSource).toContain("timeField.stringValue = Self.trailingText(for: session)");
    expect(statusIndicatorSource).toContain('session.status == .working ? "" : relativeTimeText(from: session.lastActiveAt)');
    expect(statusIndicatorSource).not.toContain('return "Running"');
  });

  test("passes native-tab agent icons and routes modal clicks through sidebar focus paths", () => {
    /*
     * CDXC:MenuBarStatusIndicator 2026-06-22-13:52:
     * The modal rows must use the same agent logo data URLs/colors as native
     * pane tabs. Project/session clicks return ids to the sidebar so existing
     * focusProject and focusSidebarSession behavior owns navigation.
     *
     * CDXC:MenuBarStatusIndicator 2026-06-23-04:20:
     * The menu bar modal session order is the Last Active sidebar priority:
     * pinned, attention, working, then neutral sessions by last-active time.
     */
    const statusPublishSource = sourceBetween(
      nativeSidebarSource,
      "function syncNativeSessionStatusIndicators",
      "function syncNativePetOverlayState",
    );
    const candidateSource = sourceBetween(
      nativeSidebarSource,
      "function createNativeSessionStatusIndicatorCandidates",
      "function createNativeSessionStatusIndicatorCandidatesFromSidebarGroups",
    );
    const eventHandlerSource = sourceBetween(
      nativeSidebarSource,
      'if (hostEvent.type === "sessionStatusIndicatorClicked")',
      'if (hostEvent.type === "petOverlayActivityClicked")',
    );

    expect(hostProtocolSource).toContain("struct SessionStatusIndicatorProject: Decodable");
    expect(hostProtocolSource).toContain("struct SessionStatusIndicatorSession: Decodable");
    expect(hostProtocolSource).toContain("case sessionStatusIndicatorProjectClicked(projectId: String)");
    expect(hostProtocolSource).toContain("case sessionStatusIndicatorSessionClicked(projectId: String, sessionId: String)");
    expect(appDelegateSource).toContain("handleSessionStatusIndicatorProjectClick");
    expect(appDelegateSource).toContain("handleSessionStatusIndicatorSessionClick");

    expect(statusPublishSource).toContain("projects: createNativeSessionStatusIndicatorModalProjects(sidebarMessage)");
    expect(nativeSidebarSource).toContain("agentIconDataUrl: agentIcon ? AGENT_LOGOS[agentIcon] : undefined");
    expect(nativeSidebarSource).toContain("agentIconColor: agentIcon ? AGENT_LOGO_COLORS[agentIcon] : undefined");
    expect(candidateSource).toContain("createProjectedSidebarSessionsForGroup(group, project.projectId)");
    expect(candidateSource).toContain("createDisplaySessionLayout({");
    expect(candidateSource).toContain('sortMode: "lastActivity"');
    expect(nativeSidebarSource).toContain('sortMode: "lastActivity"');
    expect(hostProtocolSource).toContain("let sidebarOrder: Int");
    expect(hostProtocolSource).toContain("let status: NativeSessionStatusIndicatorStatus");
    expect(statusPublishSource).toContain("lastActiveAt: candidate.lastInteractionAt");
    expect(statusPublishSource).toContain("sidebarOrder: candidate.order");
    expect(statusPublishSource).toContain("status: candidate.status");
    expect(eventHandlerSource).toContain("handleNativeSessionStatusIndicatorProjectClicked(hostEvent.projectId)");
    expect(eventHandlerSource).toContain(
      "handleNativeSessionStatusIndicatorSessionClicked(hostEvent.projectId, hostEvent.sessionId)",
    );
    expect(nativeSidebarSource).toContain("focusProject(project.projectId)");
    expect(nativeSidebarSource).toContain("focusSidebarSession(sessionId)");
  });
});
