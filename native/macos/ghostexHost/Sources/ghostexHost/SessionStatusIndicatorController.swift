import AppKit

enum SessionStatusIndicatorMenuAction {
  case quitApp
  case restartApp
}

@MainActor
final class SessionStatusIndicatorController {
  private let menuBarStatusItem: NSStatusItem
  private let menuBarClickTarget: MenuBarSessionStatusIndicatorTarget
  private let onActivationRequest: (String) -> Void

  /**
   CDXC:SessionStatusIndicators 2026-05-05-19:47:
   Session counts must be rendered by AppKit, not SwiftUI, so native status UI
   can live outside the ghostex content view.

   CDXC:SessionStatusIndicators 2026-06-27-20:11:
   The desktop floating session badge surface was removed from the macOS app.
   Keep this controller as the owner of the menu bar status item and dropdown
   only; do not allocate a floating NSPanel or draggable indicator view.
   */
  init(
    onActivationRequest: @escaping (String) -> Void,
    onProjectClick: @escaping (String) -> Void,
    onSessionClick: @escaping (String, String) -> Void,
    onMenuAction: @escaping (SessionStatusIndicatorMenuAction) -> Void
  ) {
    /**
     CDXC:SessionStatusIndicators 2026-05-09-15:48:
     The menu bar indicator reuses the computed native status items so
     attention, working, and idle counts stay aligned with sidebar state.

     CDXC:SessionStatusIndicators 2026-06-27-20:11:
     Floating indicator click routing was removed with the floating badge
     surface. Menu bar primary click opens the Running Agents dropdown, while
     collapsed pet status badges keep the aggregate status-click route.
     */
    let menuBarStatusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    let menuBarClickTarget = MenuBarSessionStatusIndicatorTarget(
      onOpen: {
        onActivationRequest("menuBarStatusIndicator.openRunningAgents")
      },
      onProjectClick: onProjectClick,
      onSessionClick: onSessionClick,
      onMenuAction: onMenuAction)
    self.menuBarStatusItem = menuBarStatusItem
    self.menuBarClickTarget = menuBarClickTarget
    self.onActivationRequest = onActivationRequest
    menuBarStatusItem.isVisible = false
    if let button = menuBarStatusItem.button {
      button.action = #selector(MenuBarSessionStatusIndicatorTarget.clicked(_:))
      button.imagePosition = .imageOnly
      /*
       CDXC:MenuBarStatusIndicator 2026-06-22-13:52:
       The menu bar status button opens the running-agents modal on ordinary left click. Subscribe only to leftMouseUp; secondary clicks and Control-clicks should be no-ops now that lifecycle commands live inside the modal footer.
       */
      _ = button.sendAction(on: [.leftMouseUp])
      button.target = menuBarClickTarget
    }
  }

  func apply(_ command: SetSessionStatusIndicators) {
    let items = Self.visibleItems(for: command)
    applyMenuBarItems(items, projects: command.projects ?? [], isHidden: command.hideMenuBarIndicators)
    /**
     CDXC:SessionStatusIndicators 2026-06-27-20:11:
     Applying status updates is now menu-bar-only. The removed desktop floating
     badge must not be hidden through a dormant panel path; it should not exist
     in the AppKit view hierarchy at all.
     */
  }

  private static func visibleItems(
    for command: SetSessionStatusIndicators
  ) -> [SessionStatusIndicatorItem] {
    /**
     CDXC:SessionStatusIndicators 2026-05-05-19:47
     Attention and working counts are action states and should suppress the
     idle available-session total whenever either exists. The idle chip is only
     a quiet all-available summary for the fully idle case.
     CDXC:SessionStatusIndicators 2026-05-09-15:53
     Working status items are `working`, not `running`. Keep native naming
     aligned with app terminology so `running` remains reserved for live
     runtime state and the idle available-session count.

     CDXC:SessionStatusIndicators 2026-06-15-02:03:
     Menu bar indicators temporarily drew count text with no badge fill behind
     the numbers; the later 2026-06-15-12:42 requirement restores square
     status backgrounds.

     CDXC:SessionStatusIndicators 2026-06-15-02:24:
     The menu bar idle number should use #e5e6e6 while attention and working
     numbers keep their status colors.

     CDXC:SessionStatusIndicators 2026-06-15-12:42:
     Working status initially used #e3b256 before the darker menu bar color.

     CDXC:SessionStatusIndicators 2026-06-15-15:24:
     Working status is darkened to #c99643. Menu bar badges use a rounded native
     control-background fill so the button background follows macOS light and
     dark appearances while the count text carries the status color.

     CDXC:SessionStatusIndicators 2026-06-27-20:11:
     The standalone floating badge is removed, but the menu bar and pet still
     share these aggregate counts and priority rules.
     */
    if command.attentionCount > 0 || command.workingCount > 0 {
      return [
        command.attentionCount > 0
          ? SessionStatusIndicatorItem(
            status: .attention,
            count: command.attentionCount,
            color: NSColor(calibratedRed: 0x00 / 255, green: 0x93 / 255, blue: 0xFE / 255, alpha: 1))
          : nil,
        command.workingCount > 0
          ? SessionStatusIndicatorItem(
            status: .working,
            count: command.workingCount,
            color: NSColor(calibratedRed: 0xC9 / 255, green: 0x96 / 255, blue: 0x43 / 255, alpha: 1))
          : nil,
      ].compactMap { $0 }
    }

    guard command.availableCount > 0 else {
      return []
    }
    return [
      SessionStatusIndicatorItem(
        status: .available,
        count: command.availableCount,
        color: NSColor(calibratedRed: 0x1E / 255, green: 0x1E / 255, blue: 0x1E / 255, alpha: 1))
    ]
  }

  private func applyMenuBarItems(
    _ items: [SessionStatusIndicatorItem],
    projects: [SessionStatusIndicatorProject],
    isHidden: Bool
  ) {
    MenuBarStatusDebugLog.append(event: "nativeMenuBarStatus.apply", details: [
      "availableCount": items.first(where: { $0.status == .available })?.count ?? 0,
      "attentionCount": items.first(where: { $0.status == .attention })?.count ?? 0,
      "isHidden": isHidden,
      "itemCount": items.count,
      "projectCount": projects.count,
      "sessionCount": projects.map(\.sessions.count).reduce(0, +),
      "statusItemVisibleBefore": menuBarStatusItem.isVisible,
      "workingCount": items.first(where: { $0.status == .working })?.count ?? 0,
    ])
    guard !items.isEmpty && !isHidden else {
      menuBarStatusItem.isVisible = false
      MenuBarStatusDebugLog.append(event: "nativeMenuBarStatus.apply.hidden", details: [
        "isHidden": isHidden,
        "itemCount": items.count,
        "projectCount": projects.count,
        "sessionCount": projects.map(\.sessions.count).reduce(0, +),
      ])
      return
    }

    let sizeSetting = SessionStatusIndicatorView.menuBarSizeSetting
    let preferredSize = SessionStatusIndicatorView.menuBarPreferredSize(
      for: items,
      sizeSetting: sizeSetting)
    menuBarClickTarget.items = items
    menuBarClickTarget.projects = projects
    menuBarClickTarget.sizeSetting = sizeSetting
    menuBarStatusItem.length = preferredSize.width
    menuBarStatusItem.isVisible = true
    guard let button = menuBarStatusItem.button else {
      MenuBarStatusDebugLog.append(event: "nativeMenuBarStatus.apply.missingButton", details: [
        "preferredHeight": preferredSize.height,
        "preferredWidth": preferredSize.width,
      ])
      return
    }
    button.image = SessionStatusIndicatorView.menuBarImage(for: items, sizeSetting: sizeSetting)
    button.image?.isTemplate = false
    button.toolTip = NativeTooltip.text("Ghostex session status")
    MenuBarStatusDebugLog.append(event: "nativeMenuBarStatus.apply.visible", details: [
      "buttonFrame": MenuBarStatusDebugLog.rectPayload(button.frame),
      "buttonWindowNumber": button.window?.windowNumber ?? -1,
      "preferredHeight": preferredSize.height,
      "preferredWidth": preferredSize.width,
      "statusItemLength": menuBarStatusItem.length,
    ])
  }

}

private struct SessionStatusIndicatorItem {
  let status: NativeSessionStatusIndicatorStatus
  let count: Int
  let color: NSColor
}

@MainActor
private enum SessionStatusIndicatorView {
  private struct IndicatorMetrics {
    let scale: CGFloat

    var menuBarCountFont: NSFont {
      NSFont.monospacedDigitSystemFont(ofSize: 25 * scale + 5, weight: .semibold)
    }
    var menuBarBadgeMinimumHeight: CGFloat { 20 }
    var menuBarBadgeMinimumWidth: CGFloat { 26 }
    var menuBarBadgeCornerRadius: CGFloat { 6 }
    var menuBarBadgeTextHorizontalPadding: CGFloat { 10 }
    var menuBarBadgeTextVerticalPadding: CGFloat { 2 }
    var menuBarHorizontalInset: CGFloat { 1 }
    var menuBarItemGap: CGFloat { max(1, 4 * scale) }
    var menuBarVerticalInset: CGFloat { 1 }
    var menuBarTextBaselineOffset: CGFloat { 0 }
  }

  static let menuBarSizeSetting: NativeSessionStatusIndicatorSize = .small

  /**
   CDXC:SessionStatusIndicators 2026-05-07-17:36:
   Preserve the inactive-only-when-no-action-state visibility rule in
   visibleItems so idle counts appear only when no working or attention badge
   needs priority.

   CDXC:SessionStatusIndicators 2026-06-15-02:03:
   Menu bar indicators temporarily drew text-only counts with no badge
   background; the later 2026-06-15-12:42 requirement restores compact square
   status backgrounds.

   CDXC:SessionStatusIndicators 2026-06-15-02:24:
   Menu bar counts should be 5pt larger than the prior small-count font and
   slightly less bold than the earlier bold rendering. Idle menu bar counts use
   #e5e6e6 because the dark idle badge fill is no longer visible behind them.

   CDXC:SessionStatusIndicators 2026-06-15-03:08:
   Text-only menu bar indicators should reserve only enough horizontal room for
   the glyphs and a small click target. Use menu-bar-specific inset and gap
   metrics so tightening the status item does not depend on the removed
   floating badge sizing.

   CDXC:SessionStatusIndicators 2026-06-15-12:42:
   Menu bar indicators returned to square status backgrounds after the
   text-only pass. Keep the status item compact by sizing each square from the
   count text plus menu-bar-specific padding.

   CDXC:SessionStatusIndicators 2026-06-15-15:24:
   Menu bar indicator backgrounds are rounded native-control backgrounds, not
   status-colored squares. Resolve the image at draw time so AppKit supplies the
   correct light or dark background color for the current macOS appearance.

   CDXC:SessionStatusIndicators 2026-06-15-15:34:
   Menu bar badges should be rounded chips, not square badges with rounded
   corners. Keep separate width and height metrics so one-digit counts still
   render as a short rounded rectangle.

   CDXC:SessionStatusIndicators 2026-06-27-20:11:
   The standalone floating badge is gone; keep this type as a static menu-bar
   image renderer only. Do not reintroduce draggable panel view state, mouse
   handling, or user-facing floating size controls here.
   */
  private static func metrics(for size: NativeSessionStatusIndicatorSize) -> IndicatorMetrics {
    switch size {
    case .small:
      return IndicatorMetrics(scale: 0.4)
    case .medium:
      return IndicatorMetrics(scale: 0.5)
    case .large:
      return IndicatorMetrics(scale: 0.75)
    case .xLarge:
      return IndicatorMetrics(scale: 1)
    }
  }

  private static func currentMetrics(
    for sizeSetting: NativeSessionStatusIndicatorSize
  ) -> IndicatorMetrics {
    metrics(for: sizeSetting)
  }

  static func menuBarPreferredSize(
    for items: [SessionStatusIndicatorItem],
    sizeSetting: NativeSessionStatusIndicatorSize
  ) -> NSSize {
    let metrics = currentMetrics(for: sizeSetting)
    let itemSizes = items.map { menuBarBadgeSize(for: $0, metrics: metrics) }
    let contentWidth =
      itemSizes.map(\.width).reduce(0, +)
      + CGFloat(max(items.count - 1, 0)) * metrics.menuBarItemGap
      + metrics.menuBarHorizontalInset * 2
    let contentHeight = (itemSizes.map(\.height).max() ?? metrics.menuBarBadgeMinimumHeight)
      + metrics.menuBarVerticalInset * 2
    return NSSize(width: ceil(contentWidth), height: ceil(contentHeight))
  }

  static func menuBarImage(
    for items: [SessionStatusIndicatorItem],
    sizeSetting: NativeSessionStatusIndicatorSize
  ) -> NSImage {
    let size = menuBarPreferredSize(for: items, sizeSetting: sizeSetting)
    return NSImage(size: size, flipped: false) { rect in
      drawMenuBarItems(items: items, in: rect, sizeSetting: sizeSetting)
      return true
    }
  }

  private static func drawMenuBarItems(
    items: [SessionStatusIndicatorItem],
    in bounds: NSRect,
    sizeSetting: NativeSessionStatusIndicatorSize
  ) {
    let metrics = currentMetrics(for: sizeSetting)
    for (item, rect) in menuBarItemRects(items: items, bounds: bounds, sizeSetting: sizeSetting) {
      menuBarBadgeBackgroundColor().setFill()
      NSBezierPath(
        roundedRect: rect,
        xRadius: metrics.menuBarBadgeCornerRadius,
        yRadius: metrics.menuBarBadgeCornerRadius).fill()
      let label = NSAttributedString(
        string: "\(item.count)",
        attributes: menuBarTextAttributes(for: item, metrics: metrics))
      let labelSize = label.size()
      label.draw(
        at: NSPoint(
          x: rect.midX - labelSize.width / 2,
          y: rect.midY - labelSize.height / 2 + metrics.menuBarTextBaselineOffset))
    }
  }

  private static func menuBarTextAttributes(
    for item: SessionStatusIndicatorItem,
    metrics: IndicatorMetrics
  ) -> [NSAttributedString.Key: Any] {
    [
      .font: metrics.menuBarCountFont,
      .foregroundColor: menuBarTextColor(for: item),
    ]
  }

  private static func menuBarTextColor(for item: SessionStatusIndicatorItem) -> NSColor {
    if item.status == .available {
      return menuBarAvailableTextColor()
    }
    return item.color
  }

  private static func menuBarBadgeBackgroundColor() -> NSColor {
    NSColor.controlBackgroundColor
  }

  private static func menuBarAvailableTextColor() -> NSColor {
    NSColor(name: NSColor.Name("GhostexMenuBarAvailableText")) { appearance in
      let darkMatch = appearance.bestMatch(from: [
        .darkAqua,
        .accessibilityHighContrastDarkAqua,
        .aqua,
        .accessibilityHighContrastAqua,
      ])
      if darkMatch == .darkAqua || darkMatch == .accessibilityHighContrastDarkAqua {
        return NSColor(
          calibratedRed: 0xE5 / 255,
          green: 0xE6 / 255,
          blue: 0xE6 / 255,
          alpha: 1)
      }
      return NSColor(calibratedWhite: 0.08, alpha: 1)
    }
  }

  private static func menuBarItemRects(
    items: [SessionStatusIndicatorItem],
    bounds: NSRect,
    sizeSetting: NativeSessionStatusIndicatorSize
  ) -> [(SessionStatusIndicatorItem, NSRect)] {
    let metrics = currentMetrics(for: sizeSetting)
    let centerY = bounds.midY
    let itemSizes = items.map { menuBarBadgeSize(for: $0, metrics: metrics) }
    let groupWidth =
      itemSizes.map(\.width).reduce(0, +)
      + CGFloat(max(items.count - 1, 0)) * metrics.menuBarItemGap
    var x = (bounds.width - groupWidth) / 2
    return zip(items, itemSizes).map { item, size in
      let rect = NSRect(
        x: x,
        y: centerY - size.height / 2,
        width: size.width,
        height: size.height)
      x += size.width + metrics.menuBarItemGap
      return (item, rect)
    }
  }

  private static func menuBarTextSize(
    for item: SessionStatusIndicatorItem,
    metrics: IndicatorMetrics
  ) -> NSSize {
    NSAttributedString(
      string: "\(item.count)",
      attributes: [.font: metrics.menuBarCountFont]
    ).size()
  }

  private static func menuBarBadgeSize(
    for item: SessionStatusIndicatorItem,
    metrics: IndicatorMetrics
  ) -> NSSize {
    let labelSize = menuBarTextSize(for: item, metrics: metrics)
    return NSSize(
      width: ceil(max(metrics.menuBarBadgeMinimumWidth, labelSize.width + metrics.menuBarBadgeTextHorizontalPadding)),
      height: ceil(max(metrics.menuBarBadgeMinimumHeight, labelSize.height + metrics.menuBarBadgeTextVerticalPadding)))
  }
}

@MainActor
private final class MenuBarSessionStatusIndicatorTarget: NSObject {
  var items: [SessionStatusIndicatorItem] = []
  var projects: [SessionStatusIndicatorProject] = [] {
    didSet {
      panelController.projects = projects
    }
  }
  var sizeSetting: NativeSessionStatusIndicatorSize = SessionStatusIndicatorView.menuBarSizeSetting
  private let onOpen: () -> Void
  private let panelController: MenuBarSessionStatusPanelController

  init(
    onOpen: @escaping () -> Void,
    onProjectClick: @escaping (String) -> Void,
    onSessionClick: @escaping (String, String) -> Void,
    onMenuAction: @escaping (SessionStatusIndicatorMenuAction) -> Void
  ) {
    self.onOpen = onOpen
    self.panelController = MenuBarSessionStatusPanelController(
      onProjectClick: onProjectClick,
      onSessionClick: onSessionClick,
      onMenuAction: onMenuAction)
    super.init()
    /*
     CDXC:MenuBarStatusIndicator 2026-06-22-13:52:
     Requirements changed: menu bar primary click now opens a Running Agents
     modal grouped by project, while right click does nothing. Lifecycle
     commands are footer rows below a separator, and project/session clicks
     route back to the sidebar for normal navigation.
     */
  }

  @objc func clicked(_ sender: NSStatusBarButton) {
    let event = NSApp.currentEvent
    MenuBarStatusDebugLog.append(event: "nativeMenuBarStatus.click.received", details: [
      "controlModifier": event?.modifierFlags.contains(.control) == true,
      "currentEventType": event.map { String(describing: $0.type) } ?? "<none>",
      "itemCount": items.count,
      "panelVisibleBefore": panelController.isPanelVisible,
      "projectCount": projects.count,
      "senderFrame": MenuBarStatusDebugLog.rectPayload(sender.frame),
      "senderHasWindow": sender.window != nil,
      "senderWindowNumber": sender.window?.windowNumber ?? -1,
      "sessionCount": projects.map(\.sessions.count).reduce(0, +),
    ])
    /*
     CDXC:MenuBarStatusIndicator 2026-06-26-06:21:
     The status button itself is registered for leftMouseUp, so the click hook
     should not require NSApp.currentEvent to still be leftMouseUp by the time
     AppKit dispatches the action. Some menu-bar clicks can arrive with a
     different current event and must still open the dropdown; only explicit
     secondary clicks and Control-clicks remain inert.
     */
    if event?.type == .rightMouseDown || event?.type == .rightMouseUp {
      MenuBarStatusDebugLog.append(event: "nativeMenuBarStatus.click.ignored", details: [
        "reason": "secondaryClick",
        "currentEventType": event.map { String(describing: $0.type) } ?? "<none>",
      ])
      return
    }
    if event?.modifierFlags.contains(.control) == true {
      MenuBarStatusDebugLog.append(event: "nativeMenuBarStatus.click.ignored", details: [
        "reason": "controlClick",
        "currentEventType": event.map { String(describing: $0.type) } ?? "<none>",
      ])
      return
    }
    if panelController.consumeSuppressedStatusItemClickIfNeeded() {
      return
    }
    if panelController.dismissForStatusItemToggleIfVisible() {
      return
    }
    onOpen()
    panelController.show(from: sender)
  }
}

@MainActor
private final class MenuBarSessionStatusPanelController: NSObject {
  private static let panelWidth: CGFloat = 370
  private static let maxPanelHeight: CGFloat = 520
  private static let minPanelHeight: CGFloat = 180
  private static let rowHeight: CGFloat = 34
  private static let projectHeaderHeight: CGFloat = 28
  private static let footerHeight: CGFloat = 66
  private static let footerRowHeight: CGFloat = 30
  private static let emptyHeight: CGFloat = 44
  private static let contentHorizontalPadding: CGFloat = 16
  private static let contentVerticalPadding: CGFloat = 8
  private static let scrollbarWidth: CGFloat = 2
  private static let projectSectionSpacing: CGFloat = 10
  private static let projectTitleCardGap: CGFloat = 4
  private static let projectCardHorizontalPadding: CGFloat = 6
  private static let projectCardVerticalPadding: CGFloat = 6
  private static let contentWidth = panelWidth - contentHorizontalPadding * 2
  private static let rowContentWidth = contentWidth
  private static let projectCardInnerWidth = contentWidth - projectCardHorizontalPadding * 2

  private let panel: NSPanel
  private let rootStack = NSStackView()
  private let rowsContainerView = NSView()
  private let scrollView = NSScrollView()
  private let scrollbarView = MenuBarStatusThinScrollbar()
  private let focusSink = MenuBarStatusFocusSink(frame: NSRect(x: -8, y: -8, width: 1, height: 1))
  private let rowsContentView = FlippedDocumentView()
  private let rowsStack = NSStackView()
  private let onProjectClick: (String) -> Void
  private let onSessionClick: (String, String) -> Void
  private let onMenuAction: (SessionStatusIndicatorMenuAction) -> Void
  private var footerActionButtons: [MenuBarStatusActionButton] = []
  private var isMouseInsidePanel = false
  private weak var hoveredSessionRow: MenuBarStatusSessionRow?
  private var localDismissEventMonitor: Any?
  private var globalDismissEventMonitor: Any?
  private var statusItemAnchorFrame: NSRect?
  private var suppressStatusItemClickUntil: TimeInterval?

  var isPanelVisible: Bool {
    panel.isVisible
  }

  var projects: [SessionStatusIndicatorProject] = [] {
    didSet {
      /*
       Status updates arrive on every sidebar publish, but the dropdown reads
       `projects` lazily: `show(from:)` rebuilds rows right before the panel
       appears, so only an already-visible panel needs a live rebuild here.
       */
      guard panel.isVisible else {
        return
      }
      rebuildRows()
    }
  }

  init(
    onProjectClick: @escaping (String) -> Void,
    onSessionClick: @escaping (String, String) -> Void,
    onMenuAction: @escaping (SessionStatusIndicatorMenuAction) -> Void
  ) {
    self.onProjectClick = onProjectClick
    self.onSessionClick = onSessionClick
    self.onMenuAction = onMenuAction
    self.panel = MenuBarStatusPanel(
      contentRect: NSRect(x: 0, y: 0, width: Self.panelWidth, height: Self.minPanelHeight),
      styleMask: [.borderless, .nonactivatingPanel],
      backing: .buffered,
      defer: false)
    super.init()
    /*
     CDXC:MenuBarStatusIndicator 2026-06-22-14:41:
     The menu bar modal should be chrome-free: no Running Agents title bar, no
     close button, and no right-click menu. It dismisses through click-away
     monitors while using normal AppKit controls for rows and footer actions.

     CDXC:MenuBarStatusIndicator 2026-06-22-22:55:
     The dropdown must visually match the macOS sidebar: use the sidebar's dark
     panel, #202020 row hover surface, reference-sidebar typography, compact
     footer rows, sidebar row order, and no Running status text.

     CDXC:MenuBarStatusIndicator 2026-06-22-23:08:
     The dropdown should be 60px narrower, use a slightly darker sidebar-like
     background, round session hover fills slightly, and give Restart/Quit rows
     the same hover background behavior as selectable rows.

     CDXC:MenuBarStatusIndicator 2026-06-22-23:20:
     Project labels and Restart/Quit rows need 10px horizontal label padding.
     Opening the dropdown must not show macOS keyboard focus on visible rows;
     focus a tiny offscreen sink and disable focus rings on visible controls.

     CDXC:MenuBarStatusIndicator 2026-06-23-04:05:
     The dropdown should use #1e1e1e for the modal background, show each
     project's sessions inside a separate rounded card, and pin the 2px
     scrollbar to the modal's right edge. Keep the scrollbar hidden until the
     pointer is hovering over the modal.

     CDXC:MenuBarStatusIndicator 2026-06-23-04:13:
     Project titles belong outside the rounded session cards, matching the
     reference usage modal where the account/vendor title labels the card below
     instead of being part of the card surface.

     CDXC:MenuBarStatusIndicator 2026-06-23-04:20:
     Opening the menu bar dropdown must not activate or raise the main Ghostex
     app. Use a non-activating panel and order it directly from the status item
     click. Session-card padding should be symmetric, and Restart/Quit hover
     should be darker than session-row hover.
     */
    panel.delegate = self
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
    panel.hidesOnDeactivate = true
    panel.isFloatingPanel = true
    panel.isOpaque = false
    panel.isReleasedWhenClosed = false
    panel.level = .floating
    panel.backgroundColor = .clear
    panel.hasShadow = true
    configureContent()
    rebuildRows()
  }

  func show(from sender: NSStatusBarButton) {
    isMouseInsidePanel = false
    statusItemAnchorFrame = Self.statusItemFrame(anchoredTo: sender)
    MenuBarStatusDebugLog.append(event: "nativeMenuBarStatus.panel.show.start", details: [
      "panelVisibleBefore": panel.isVisible,
      "projectCount": projects.count,
      "senderBounds": MenuBarStatusDebugLog.rectPayload(sender.bounds),
      "senderFrame": MenuBarStatusDebugLog.rectPayload(sender.frame),
      "senderHasWindow": sender.window != nil,
      "senderScreenFrame": MenuBarStatusDebugLog.optionalRectPayload(statusItemAnchorFrame),
      "senderWindowFrame": MenuBarStatusDebugLog.optionalRectPayload(sender.window?.frame),
      "senderWindowNumber": sender.window?.windowNumber ?? -1,
      "sessionCount": projects.map(\.sessions.count).reduce(0, +),
    ])
    rebuildRows()
    let height = preferredPanelHeight()
    let frame = Self.panelFrame(
      size: NSSize(width: Self.panelWidth, height: height),
      anchoredTo: sender)
    MenuBarStatusDebugLog.append(event: "nativeMenuBarStatus.panel.frameResolved", details: [
      "contentHeight": rowsContentView.bounds.height,
      "panelFrame": MenuBarStatusDebugLog.rectPayload(frame),
      "preferredHeight": height,
      "screenCount": NSScreen.screens.count,
    ])
    panel.setFrame(frame, display: true)
    panel.orderFrontRegardless()
    panel.makeFirstResponder(focusSink)
    installDismissEventMonitors()
    updateScrollbar()
    MenuBarStatusDebugLog.append(event: "nativeMenuBarStatus.panel.show.ordered", details: [
      "canBecomeKey": panel.canBecomeKey,
      "firstResponderClass": panel.firstResponder.map { String(describing: type(of: $0)) } ?? "<none>",
      "isKeyWindow": panel.isKeyWindow,
      "panelFrame": MenuBarStatusDebugLog.rectPayload(panel.frame),
      "panelLevel": panel.level.rawValue,
      "panelVisibleAfter": panel.isVisible,
    ])
  }

  func consumeSuppressedStatusItemClickIfNeeded() -> Bool {
    guard let suppressStatusItemClickUntil else {
      return false
    }
    if ProcessInfo.processInfo.systemUptime > suppressStatusItemClickUntil {
      self.suppressStatusItemClickUntil = nil
      return false
    }
    self.suppressStatusItemClickUntil = nil
    MenuBarStatusDebugLog.append(event: "nativeMenuBarStatus.click.suppressedAfterMouseDownToggle", details: [
      "panelVisible": panel.isVisible,
    ])
    return true
  }

  func dismissForStatusItemToggleIfVisible() -> Bool {
    guard panel.isVisible else {
      return false
    }
    dismissPanel(reason: "statusItemClickToggle")
    return true
  }

  private func configureContent() {
    let contentView = MenuBarStatusContentView()
    contentView.onHoverChange = { [weak self] isHovered in
      self?.isMouseInsidePanel = isHovered
      self?.updateScrollbar()
    }
    contentView.wantsLayer = true
    contentView.layer?.backgroundColor = NSColor(calibratedWhite: 0x1e / 255, alpha: 1).cgColor
    contentView.layer?.borderColor = NSColor(calibratedWhite: 0x4f / 255, alpha: 0.72).cgColor
    contentView.layer?.borderWidth = 1
    contentView.layer?.cornerRadius = 18
    contentView.layer?.masksToBounds = true
    panel.contentView = contentView

    focusSink.translatesAutoresizingMaskIntoConstraints = false
    contentView.addSubview(focusSink)

    rootStack.orientation = .vertical
    rootStack.alignment = .leading
    rootStack.distribution = .fill
    rootStack.spacing = 0
    rootStack.translatesAutoresizingMaskIntoConstraints = false
    contentView.addSubview(rootStack)

    scrollView.drawsBackground = false
    scrollView.borderType = .noBorder
    scrollView.hasVerticalScroller = false
    scrollView.autohidesScrollers = true
    scrollView.translatesAutoresizingMaskIntoConstraints = false
    scrollView.documentView = rowsContentView
    scrollView.contentView.postsBoundsChangedNotifications = true
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(scrollBoundsDidChange(_:)),
      name: NSView.boundsDidChangeNotification,
      object: scrollView.contentView)

    rowsContainerView.translatesAutoresizingMaskIntoConstraints = false
    rowsContainerView.addSubview(scrollView)
    scrollbarView.translatesAutoresizingMaskIntoConstraints = false
    scrollbarView.isHidden = true
    contentView.addSubview(scrollbarView)

    rowsStack.orientation = .vertical
    rowsStack.alignment = .leading
    rowsStack.distribution = .fill
    rowsStack.spacing = Self.projectSectionSpacing
    rowsStack.translatesAutoresizingMaskIntoConstraints = false
    rowsContentView.addSubview(rowsStack)
    NSLayoutConstraint.activate([
      rowsStack.leadingAnchor.constraint(equalTo: rowsContentView.leadingAnchor),
      rowsStack.trailingAnchor.constraint(equalTo: rowsContentView.trailingAnchor),
      rowsStack.topAnchor.constraint(equalTo: rowsContentView.topAnchor),
    ])

    let separator = NSBox()
    separator.boxType = .separator
    separator.translatesAutoresizingMaskIntoConstraints = false

    let footerStack = NSStackView()
    footerStack.orientation = .vertical
    footerStack.alignment = .leading
    footerStack.distribution = .fill
    footerStack.edgeInsets = NSEdgeInsets(top: 4, left: 0, bottom: 2, right: 0)
    footerStack.spacing = 0
    footerStack.translatesAutoresizingMaskIntoConstraints = false
    footerStack.addArrangedSubview(actionButton(title: "Restart Ghostex", action: #selector(restartGhostex(_:))))
    footerStack.addArrangedSubview(actionButton(title: "Quit Ghostex", action: #selector(quitGhostex(_:))))

    rootStack.addArrangedSubview(rowsContainerView)
    rootStack.addArrangedSubview(separator)
    rootStack.addArrangedSubview(footerStack)

    NSLayoutConstraint.activate([
      rootStack.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: Self.contentHorizontalPadding),
      rootStack.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -Self.contentHorizontalPadding),
      rootStack.topAnchor.constraint(equalTo: contentView.topAnchor, constant: Self.contentVerticalPadding),
      rootStack.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -Self.contentVerticalPadding),

      focusSink.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: -8),
      focusSink.topAnchor.constraint(equalTo: contentView.topAnchor, constant: -8),
      focusSink.widthAnchor.constraint(equalToConstant: 1),
      focusSink.heightAnchor.constraint(equalToConstant: 1),

      rowsContainerView.widthAnchor.constraint(equalToConstant: Self.contentWidth),
      scrollView.leadingAnchor.constraint(equalTo: rowsContainerView.leadingAnchor),
      scrollView.topAnchor.constraint(equalTo: rowsContainerView.topAnchor),
      scrollView.bottomAnchor.constraint(equalTo: rowsContainerView.bottomAnchor),
      scrollView.trailingAnchor.constraint(equalTo: rowsContainerView.trailingAnchor),
      scrollbarView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
      scrollbarView.topAnchor.constraint(equalTo: rowsContainerView.topAnchor),
      scrollbarView.bottomAnchor.constraint(equalTo: rowsContainerView.bottomAnchor),
      scrollbarView.widthAnchor.constraint(equalToConstant: Self.scrollbarWidth),

      separator.widthAnchor.constraint(equalToConstant: Self.contentWidth),
      footerStack.widthAnchor.constraint(equalToConstant: Self.contentWidth),
      footerStack.heightAnchor.constraint(equalToConstant: Self.footerHeight),
    ])
  }

  private func actionButton(title: String, action: Selector) -> MenuBarStatusActionButton {
    let button = MenuBarStatusActionButton(frame: .zero)
    button.title = title
    button.target = self
    button.action = action
    button.font = NSFont.systemFont(ofSize: 15.55, weight: .light)
    button.textColor = NSColor(calibratedRed: 0xb4 / 255, green: 0xb8 / 255, blue: 0xc0 / 255, alpha: 1)
    button.translatesAutoresizingMaskIntoConstraints = false
    button.heightAnchor.constraint(equalToConstant: Self.footerRowHeight).isActive = true
    button.widthAnchor.constraint(equalToConstant: Self.contentWidth).isActive = true
    footerActionButtons.append(button)
    return button
  }

  private func rebuildRows() {
    setHoveredSessionRow(nil)
    for view in rowsStack.arrangedSubviews {
      rowsStack.removeArrangedSubview(view)
      view.removeFromSuperview()
    }

    if projects.flatMap(\.sessions).isEmpty {
      rowsStack.addArrangedSubview(emptyLabel())
    } else {
      for project in projects {
        rowsStack.addArrangedSubview(projectSection(project))
      }
    }
    let rowHeight = preferredRowsHeight()
    rowsContentView.setFrameSize(NSSize(width: Self.rowContentWidth, height: rowHeight))
    rowsStack.layoutSubtreeIfNeeded()
    updateScrollbar()
  }

  private func emptyLabel() -> NSTextField {
    let label = NSTextField(labelWithString: "No running agents")
    label.font = NSFont.systemFont(ofSize: 13, weight: .medium)
    label.textColor = NSColor.secondaryLabelColor
    label.alignment = .center
    label.translatesAutoresizingMaskIntoConstraints = false
    label.heightAnchor.constraint(equalToConstant: Self.emptyHeight).isActive = true
    label.widthAnchor.constraint(equalToConstant: Self.rowContentWidth).isActive = true
    return label
  }

  private func projectSection(_ project: SessionStatusIndicatorProject) -> NSStackView {
    let sectionStack = NSStackView()
    sectionStack.orientation = .vertical
    sectionStack.alignment = .leading
    sectionStack.distribution = .fill
    sectionStack.spacing = Self.projectTitleCardGap
    sectionStack.translatesAutoresizingMaskIntoConstraints = false

    sectionStack.addArrangedSubview(projectButton(project))
    sectionStack.addArrangedSubview(projectCard(project))

    NSLayoutConstraint.activate([
      sectionStack.widthAnchor.constraint(equalToConstant: Self.contentWidth),
      sectionStack.heightAnchor.constraint(equalToConstant: Self.projectSectionHeight(project)),
    ])

    return sectionStack
  }

  private func projectCard(_ project: SessionStatusIndicatorProject) -> NSView {
    let card = MenuBarStatusProjectCardView()
    card.translatesAutoresizingMaskIntoConstraints = false

    let cardStack = NSStackView()
    cardStack.orientation = .vertical
    cardStack.alignment = .leading
    cardStack.distribution = .fill
    cardStack.spacing = 0
    cardStack.translatesAutoresizingMaskIntoConstraints = false
    card.addSubview(cardStack)

    for session in Self.sortedProjectSessions(project.sessions) {
      cardStack.addArrangedSubview(sessionRow(project: project, session: session))
    }

    NSLayoutConstraint.activate([
      card.widthAnchor.constraint(equalToConstant: Self.contentWidth),
      card.heightAnchor.constraint(equalToConstant: Self.projectSessionsCardHeight(project)),

      cardStack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: Self.projectCardHorizontalPadding),
      cardStack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -Self.projectCardHorizontalPadding),
      cardStack.topAnchor.constraint(equalTo: card.topAnchor, constant: Self.projectCardVerticalPadding),
      cardStack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -Self.projectCardVerticalPadding),
    ])

    return card
  }

  private struct SortableMenuBarStatusSession {
    let session: SessionStatusIndicatorSession
    let lastActiveAt: TimeInterval
  }

  private static func sortedProjectSessions(
    _ sessions: [SessionStatusIndicatorSession]
  ) -> [SessionStatusIndicatorSession] {
    /*
     CDXC:MenuBarStatusIndicator 2026-07-01-03:14:
     The menu bar dropdown is a status surface: attention sessions must appear first, working sessions second, and rows within a status bucket use newest last-active time so neutral sessions are ordered by recent activity instead of raw sidebar order.

     `lastActiveAt` is an ISO8601 string; parse it once per session here.
     Date parsing must never run inside the sort comparator.
     */
    return sessions
      .map { SortableMenuBarStatusSession(session: $0, lastActiveAt: menuBarLastActiveSortValue($0)) }
      .sorted(by: compareMenuBarStatusSessions)
      .map(\.session)
  }

  private static func compareMenuBarStatusSessions(
    _ left: SortableMenuBarStatusSession,
    _ right: SortableMenuBarStatusSession
  ) -> Bool {
    let statusDelta =
      menuBarStatusPriority(left.session.status) - menuBarStatusPriority(right.session.status)
    if statusDelta != 0 {
      return statusDelta > 0
    }

    if left.lastActiveAt != right.lastActiveAt {
      return left.lastActiveAt > right.lastActiveAt
    }

    if left.session.sidebarOrder != right.session.sidebarOrder {
      return left.session.sidebarOrder < right.session.sidebarOrder
    }
    return left.session.sessionId < right.session.sessionId
  }

  private static func menuBarStatusPriority(_ status: NativeSessionStatusIndicatorStatus) -> Int {
    switch status {
    case .attention:
      return 2
    case .working:
      return 1
    case .available:
      return 0
    }
  }

  private static func menuBarLastActiveSortValue(
    _ session: SessionStatusIndicatorSession
  ) -> TimeInterval {
    sessionStatusIndicatorDate(from: session.lastActiveAt)?.timeIntervalSinceReferenceDate ?? 0
  }

  private func projectButton(_ project: SessionStatusIndicatorProject) -> MenuBarStatusProjectButton {
    let button = MenuBarStatusProjectButton(projectId: project.projectId)
    button.title = project.title
    button.target = self
    button.action = #selector(projectClicked(_:))
    button.font = NSFont.systemFont(ofSize: 16, weight: .light)
    button.textColor = NSColor(calibratedWhite: 0xa5 / 255, alpha: 1)
    button.translatesAutoresizingMaskIntoConstraints = false
    button.heightAnchor.constraint(equalToConstant: Self.projectHeaderHeight).isActive = true
    button.widthAnchor.constraint(equalToConstant: Self.contentWidth).isActive = true
    return button
  }

  private func sessionRow(
    project: SessionStatusIndicatorProject,
    session: SessionStatusIndicatorSession
  ) -> MenuBarStatusSessionRow {
    let row = MenuBarStatusSessionRow(projectId: project.projectId, session: session)
    row.target = self
    row.action = #selector(sessionClicked(_:))
    row.onHoverChange = { [weak self] row in
      self?.setHoveredSessionRow(row)
    }
    row.translatesAutoresizingMaskIntoConstraints = false
    row.heightAnchor.constraint(equalToConstant: Self.rowHeight).isActive = true
    row.widthAnchor.constraint(equalToConstant: Self.projectCardInnerWidth).isActive = true
    return row
  }

  private func preferredRowsHeight() -> CGFloat {
    let sessionCount = projects.map(\.sessions.count).reduce(0, +)
    guard sessionCount > 0 else {
      return Self.emptyHeight
    }
    return projects.map(Self.projectSectionHeight).reduce(0, +)
      + CGFloat(max(projects.count - 1, 0)) * Self.projectSectionSpacing
  }

  private static func projectSectionHeight(_ project: SessionStatusIndicatorProject) -> CGFloat {
    projectHeaderHeight
      + projectTitleCardGap
      + projectSessionsCardHeight(project)
  }

  private static func projectSessionsCardHeight(_ project: SessionStatusIndicatorProject) -> CGFloat {
    projectCardVerticalPadding * 2
      + CGFloat(project.sessions.count) * rowHeight
  }

  private func preferredPanelHeight() -> CGFloat {
    min(
      Self.maxPanelHeight,
      max(
        Self.minPanelHeight,
        preferredRowsHeight() + Self.footerHeight + Self.contentVerticalPadding * 2))
  }

  private func setHoveredSessionRow(_ row: MenuBarStatusSessionRow?) {
    if hoveredSessionRow === row {
      return
    }
    hoveredSessionRow?.setHovered(false)
    hoveredSessionRow = row
    row?.setHovered(true)
  }

  @objc private func scrollBoundsDidChange(_ notification: Notification) {
    updateScrollbar()
  }

  private func updateScrollbar() {
    guard scrollView.superview != nil else {
      return
    }
    let visibleHeight = max(0, scrollView.contentView.bounds.height)
    let contentHeight = max(0, rowsContentView.bounds.height)
    guard isMouseInsidePanel, visibleHeight > 0, contentHeight > visibleHeight + 1 else {
      scrollbarView.isHidden = true
      return
    }
    let maxOffset = max(1, contentHeight - visibleHeight)
    scrollbarView.isHidden = false
    scrollbarView.knobHeightFraction = min(1, visibleHeight / contentHeight)
    scrollbarView.knobOffsetFraction = min(1, max(0, scrollView.contentView.bounds.origin.y / maxOffset))
  }

  private func installDismissEventMonitors() {
    removeDismissEventMonitors()
    MenuBarStatusDebugLog.append(event: "nativeMenuBarStatus.panel.dismissMonitors.install", details: [
      "panelVisible": panel.isVisible,
    ])
    localDismissEventMonitor = NSEvent.addLocalMonitorForEvents(
      matching: [.leftMouseDown, .rightMouseDown]
    ) { [weak self] event in
      guard let self else {
        return event
      }
      if self.panel.isVisible && event.window !== self.panel {
        MenuBarStatusDebugLog.append(event: "nativeMenuBarStatus.panel.dismissMonitor.localOutside", details: [
          "eventType": String(describing: event.type),
          "eventWindowNumber": event.window?.windowNumber ?? -1,
          "panelWindowNumber": self.panel.windowNumber,
        ])
        self.dismissPanel(reason: "localOutsideMouseDown")
      }
      return event
    }
    globalDismissEventMonitor = NSEvent.addGlobalMonitorForEvents(
      matching: [.leftMouseDown, .rightMouseDown]
    ) { [weak self] _ in
      guard let self else {
        return
      }
      if self.isMouseLocationInStatusItemAnchor() {
        MenuBarStatusDebugLog.append(event: "nativeMenuBarStatus.panel.dismissMonitor.statusItemMouseDown", details: [
          "mouseLocation": MenuBarStatusDebugLog.pointPayload(NSEvent.mouseLocation),
          "statusItemAnchorFrame": MenuBarStatusDebugLog.optionalRectPayload(self.statusItemAnchorFrame),
        ])
        self.suppressNextStatusItemClick()
        self.dismissPanel(reason: "statusItemMouseDownToggle")
        return
      }
      MenuBarStatusDebugLog.append(event: "nativeMenuBarStatus.panel.dismissMonitor.globalMouseDown", details: [
        "panelVisible": self.panel.isVisible,
      ])
      self.dismissPanel(reason: "globalMouseDown")
    }
  }

  private func removeDismissEventMonitors() {
    let hadLocalMonitor = localDismissEventMonitor != nil
    let hadGlobalMonitor = globalDismissEventMonitor != nil
    if let localDismissEventMonitor {
      NSEvent.removeMonitor(localDismissEventMonitor)
      self.localDismissEventMonitor = nil
    }
    if let globalDismissEventMonitor {
      NSEvent.removeMonitor(globalDismissEventMonitor)
      self.globalDismissEventMonitor = nil
    }
    if hadLocalMonitor || hadGlobalMonitor {
      MenuBarStatusDebugLog.append(event: "nativeMenuBarStatus.panel.dismissMonitors.removed", details: [
        "hadGlobalMonitor": hadGlobalMonitor,
        "hadLocalMonitor": hadLocalMonitor,
        "panelVisible": panel.isVisible,
      ])
    }
  }

  private func dismissPanel(reason: String) {
    guard panel.isVisible else {
      removeDismissEventMonitors()
      MenuBarStatusDebugLog.append(event: "nativeMenuBarStatus.panel.dismiss.skipped", details: [
        "reason": reason,
      ])
      return
    }
    MenuBarStatusDebugLog.append(event: "nativeMenuBarStatus.panel.dismiss", details: [
      "isKeyWindow": panel.isKeyWindow,
      "panelFrame": MenuBarStatusDebugLog.rectPayload(panel.frame),
      "reason": reason,
    ])
    setHoveredSessionRow(nil)
    footerActionButtons.forEach { $0.setHovered(false) }
    isMouseInsidePanel = false
    panel.orderOut(nil)
    removeDismissEventMonitors()
  }

  private func suppressNextStatusItemClick() {
    suppressStatusItemClickUntil = ProcessInfo.processInfo.systemUptime + 0.8
  }

  private static func panelFrame(size: NSSize, anchoredTo sender: NSStatusBarButton) -> NSRect {
    let fallbackScreen = NSScreen.main ?? NSScreen.screens.first
    let buttonFrame = statusItemFrame(anchoredTo: sender)
    let screenFrame = (fallbackScreen ?? NSScreen.screens.first)?.visibleFrame
      ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
    let x = min(
      max(screenFrame.minX + 8, buttonFrame.midX - size.width / 2),
      screenFrame.maxX - size.width - 8)
    let proposedY = buttonFrame.minY - size.height - 8
    let y = proposedY >= screenFrame.minY + 8 ? proposedY : buttonFrame.maxY + 8
    return NSRect(origin: NSPoint(x: x, y: y), size: size)
  }

  private static func statusItemFrame(anchoredTo sender: NSStatusBarButton) -> NSRect {
    sender.window.map { window in
      window.convertToScreen(sender.convert(sender.bounds, to: nil))
    } ?? NSRect(origin: NSEvent.mouseLocation, size: .zero)
  }

  private func isMouseLocationInStatusItemAnchor() -> Bool {
    guard let statusItemAnchorFrame else {
      return false
    }
    return statusItemAnchorFrame.insetBy(dx: -6, dy: -6).contains(NSEvent.mouseLocation)
  }

  @objc private func projectClicked(_ sender: MenuBarStatusProjectButton) {
    dismissPanel(reason: "projectClicked")
    onProjectClick(sender.projectId)
  }

  @objc private func sessionClicked(_ sender: MenuBarStatusSessionRow) {
    dismissPanel(reason: "sessionClicked")
    onSessionClick(sender.projectId, sender.sessionId)
  }

  @objc private func restartGhostex(_ sender: MenuBarStatusActionButton) {
    dismissPanel(reason: "restartGhostex")
    onMenuAction(.restartApp)
  }

  @objc private func quitGhostex(_ sender: MenuBarStatusActionButton) {
    dismissPanel(reason: "quitGhostex")
    onMenuAction(.quitApp)
  }
}

extension MenuBarSessionStatusPanelController: NSWindowDelegate {
  func windowDidResignKey(_ notification: Notification) {
    MenuBarStatusDebugLog.append(event: "nativeMenuBarStatus.panel.windowDidResignKey", details: [
      "panelVisible": (notification.object as? NSWindow)?.isVisible ?? false,
    ])
    dismissPanel(reason: "windowDidResignKey")
  }
}

@MainActor
private final class MenuBarStatusPanel: NSPanel {
  override var canBecomeKey: Bool {
    true
  }
}

private final class MenuBarStatusThinScrollbar: NSView {
  var knobHeightFraction: CGFloat = 1 {
    didSet {
      needsDisplay = true
    }
  }
  var knobOffsetFraction: CGFloat = 0 {
    didSet {
      needsDisplay = true
    }
  }

  override var isOpaque: Bool {
    false
  }

  override func draw(_ dirtyRect: NSRect) {
    super.draw(dirtyRect)
    let trackHeight = bounds.height
    guard trackHeight > 0 else {
      return
    }
    let minKnobHeight: CGFloat = 24
    let knobHeight = max(minKnobHeight, trackHeight * min(1, max(0, knobHeightFraction)))
    let maxOffset = max(0, trackHeight - knobHeight)
    let y = bounds.maxY - knobHeight - maxOffset * min(1, max(0, knobOffsetFraction))
    NSColor.tertiaryLabelColor.withAlphaComponent(0.8).setFill()
    NSBezierPath(
      roundedRect: NSRect(x: 0, y: y, width: bounds.width, height: knobHeight),
      xRadius: bounds.width / 2,
      yRadius: bounds.width / 2).fill()
  }
}

private final class MenuBarStatusContentView: NSView {
  var onHoverChange: ((Bool) -> Void)?

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    for trackingArea in trackingAreas {
      removeTrackingArea(trackingArea)
    }
    addTrackingArea(NSTrackingArea(
      rect: bounds,
      options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
      owner: self,
      userInfo: nil))
  }

  override func mouseEntered(with event: NSEvent) {
    onHoverChange?(true)
  }

  override func mouseExited(with event: NSEvent) {
    onHoverChange?(false)
  }
}

private final class MenuBarStatusProjectCardView: NSView {
  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    wantsLayer = true
    layer?.backgroundColor = NSColor(calibratedWhite: 0x16 / 255, alpha: 1).cgColor
    layer?.borderColor = NSColor(calibratedWhite: 0x3a / 255, alpha: 0.72).cgColor
    layer?.borderWidth = 1
    layer?.cornerRadius = 8
    layer?.masksToBounds = true
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }
}

@MainActor
private final class MenuBarStatusProjectButton: NSControl {
  private static let labelHorizontalPadding: CGFloat = 10
  let projectId: String

  var title: String = "" {
    didSet { needsDisplay = true }
  }

  /*
   CDXC:MenuBarStatusIndicator 2026-06-23-04:08:
   The custom-drawn menu bar project button uses NSControl.font as its typography source so AppKit SDKs that expose the inherited property require an explicit override while preserving redraw invalidation when the panel configures fonts.
   */
  override var font: NSFont? {
    didSet { needsDisplay = true }
  }

  var textColor: NSColor? {
    didSet { needsDisplay = true }
  }

  init(projectId: String) {
    self.projectId = projectId
    super.init(frame: .zero)
    focusRingType = .none
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  override var acceptsFirstResponder: Bool {
    false
  }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
    true
  }

  override func mouseUp(with event: NSEvent) {
    guard bounds.contains(convert(event.locationInWindow, from: nil)),
      let action
    else {
      return
    }
    _ = NSApp.sendAction(action, to: target, from: self)
  }

  override func draw(_ dirtyRect: NSRect) {
    super.draw(dirtyRect)
    drawMenuBarStatusPaddedTitle(
      title,
      font: font ?? NSFont.systemFont(ofSize: 16, weight: .light),
      textColor: textColor ?? NSColor.labelColor,
      horizontalPadding: Self.labelHorizontalPadding,
      in: bounds)
  }
}

@MainActor
private final class MenuBarStatusActionButton: NSControl {
  private static let labelHorizontalPadding: CGFloat = 10
  private static let hoverFillColor = NSColor(calibratedWhite: 0x18 / 255, alpha: 1)
  private var isHovered = false {
    didSet {
      needsDisplay = true
    }
  }

  var title: String = "" {
    didSet { needsDisplay = true }
  }

  /*
   CDXC:MenuBarStatusIndicator 2026-06-23-04:08:
   Footer action rows are custom NSControl buttons; keep their text styling on the inherited font property and mark the override explicitly for newer AppKit SDK compilation.
   */
  override var font: NSFont? {
    didSet { needsDisplay = true }
  }

  var textColor: NSColor? {
    didSet { needsDisplay = true }
  }

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    focusRingType = .none
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  override var acceptsFirstResponder: Bool {
    false
  }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
    true
  }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    for trackingArea in trackingAreas {
      removeTrackingArea(trackingArea)
    }
    addTrackingArea(NSTrackingArea(
      rect: bounds,
      options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
      owner: self,
      userInfo: nil))
  }

  override func mouseEntered(with event: NSEvent) {
    setHovered(true)
  }

  override func mouseExited(with event: NSEvent) {
    setHovered(false)
  }

  func setHovered(_ hovered: Bool) {
    isHovered = hovered
  }

  override func draw(_ dirtyRect: NSRect) {
    super.draw(dirtyRect)
    if isHovered {
      Self.hoverFillColor.setFill()
      NSBezierPath(roundedRect: bounds.insetBy(dx: 0, dy: 2), xRadius: 6, yRadius: 6).fill()
    }
    drawMenuBarStatusPaddedTitle(
      title,
      font: font ?? NSFont.systemFont(ofSize: 15.55, weight: .light),
      textColor: textColor ?? NSColor.labelColor,
      horizontalPadding: Self.labelHorizontalPadding,
      in: bounds)
  }

  override func mouseUp(with event: NSEvent) {
    guard bounds.contains(convert(event.locationInWindow, from: nil)),
      let action
    else {
      return
    }
    _ = NSApp.sendAction(action, to: target, from: self)
  }
}

private final class MenuBarStatusFocusSink: NSView {
  override var acceptsFirstResponder: Bool {
    true
  }

  override var canBecomeKeyView: Bool {
    true
  }
}

private func drawMenuBarStatusPaddedTitle(
  _ title: String,
  font: NSFont,
  textColor: NSColor,
  horizontalPadding: CGFloat,
  in bounds: NSRect
) {
  let paragraphStyle = NSMutableParagraphStyle()
  paragraphStyle.alignment = .left
  paragraphStyle.lineBreakMode = .byTruncatingTail
  let attributes: [NSAttributedString.Key: Any] = [
    .font: font,
    .foregroundColor: textColor,
    .paragraphStyle: paragraphStyle,
  ]
  let textHeight = ceil((title as NSString).size(withAttributes: attributes).height)
  let textRect = NSRect(
    x: bounds.minX + horizontalPadding,
    y: bounds.midY - textHeight / 2,
    width: max(0, bounds.width - horizontalPadding * 2),
    height: textHeight)
  (title as NSString).draw(in: textRect, withAttributes: attributes)
}

@MainActor
private final class MenuBarStatusSessionRow: NSControl {
  private static let iconSize: CGFloat = 18
  private static let horizontalPadding: CGFloat = 13
  private static let titleTimeGap: CGFloat = 12
  private static let titleColor = NSColor(
    calibratedRed: 0xb4 / 255,
    green: 0xb8 / 255,
    blue: 0xc0 / 255,
    alpha: 1)
  private static let trailingTimeColor = NSColor(calibratedWhite: 0x4f / 255, alpha: 1)
  private static let hoverFillColor = NSColor(calibratedWhite: 0x20 / 255, alpha: 1)
  private static let workingSquareColor = NSColor(
    calibratedRed: 0xC9 / 255,
    green: 0x96 / 255,
    blue: 0x43 / 255,
    alpha: 1)

  let projectId: String
  let sessionId: String
  var onHoverChange: ((MenuBarStatusSessionRow?) -> Void)?

  private let iconView = NSImageView()
  private let titleField = NSTextField(labelWithString: "")
  private let timeField = NSTextField(labelWithString: "")
  private let trailingContainer = NSView()
  private let workingSquareView = NSView()
  private var isHovered = false {
    didSet {
      needsDisplay = true
    }
  }

  init(projectId: String, session: SessionStatusIndicatorSession) {
    self.projectId = projectId
    self.sessionId = session.sessionId
    super.init(frame: .zero)
    wantsLayer = true
    configureIcon(session)
    titleField.stringValue = session.title
    titleField.font = NSFont.systemFont(ofSize: 15.55, weight: .light)
    titleField.lineBreakMode = .byTruncatingTail
    titleField.textColor = Self.titleColor
    timeField.stringValue = Self.trailingText(for: session)
    timeField.font = NSFont.monospacedDigitSystemFont(ofSize: 13.55, weight: .light)
    timeField.lineBreakMode = .byTruncatingTail
    timeField.textColor = Self.trailingTimeColor
    workingSquareView.wantsLayer = true
    workingSquareView.layer?.backgroundColor = Self.workingSquareColor.cgColor
    workingSquareView.isHidden = session.status != .working
    timeField.isHidden = session.status == .working

    trailingContainer.translatesAutoresizingMaskIntoConstraints = false
    addSubview(trailingContainer)
    for view in [timeField, workingSquareView] {
      view.translatesAutoresizingMaskIntoConstraints = false
      trailingContainer.addSubview(view)
    }
    for view in [iconView, titleField] {
      view.translatesAutoresizingMaskIntoConstraints = false
      addSubview(view)
    }
    NSLayoutConstraint.activate([
      iconView.leadingAnchor.constraint(equalTo: leadingAnchor, constant: Self.horizontalPadding),
      iconView.centerYAnchor.constraint(equalTo: centerYAnchor),
      iconView.widthAnchor.constraint(equalToConstant: Self.iconSize),
      iconView.heightAnchor.constraint(equalToConstant: Self.iconSize),

      titleField.leadingAnchor.constraint(equalTo: iconView.trailingAnchor, constant: 10),
      titleField.centerYAnchor.constraint(equalTo: centerYAnchor),
      titleField.trailingAnchor.constraint(
        lessThanOrEqualTo: trailingContainer.leadingAnchor,
        constant: -Self.titleTimeGap),

      trailingContainer.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -Self.horizontalPadding),
      trailingContainer.centerYAnchor.constraint(equalTo: centerYAnchor),
      trailingContainer.widthAnchor.constraint(equalToConstant: 82),
      trailingContainer.heightAnchor.constraint(equalToConstant: 20),

      timeField.trailingAnchor.constraint(equalTo: trailingContainer.trailingAnchor),
      timeField.centerYAnchor.constraint(equalTo: trailingContainer.centerYAnchor),

      workingSquareView.trailingAnchor.constraint(equalTo: trailingContainer.trailingAnchor),
      workingSquareView.centerYAnchor.constraint(equalTo: trailingContainer.centerYAnchor),
      workingSquareView.widthAnchor.constraint(equalToConstant: 8),
      workingSquareView.heightAnchor.constraint(equalToConstant: 8),
    ])
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
    true
  }

  func setHovered(_ hovered: Bool) {
    isHovered = hovered
  }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    for trackingArea in trackingAreas {
      removeTrackingArea(trackingArea)
    }
    addTrackingArea(NSTrackingArea(
      rect: bounds,
      options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
      owner: self,
      userInfo: nil))
  }

  override func mouseEntered(with event: NSEvent) {
    onHoverChange?(self)
  }

  override func mouseExited(with event: NSEvent) {
    if isHovered {
      onHoverChange?(nil)
    }
  }

  override func mouseUp(with event: NSEvent) {
    guard bounds.contains(convert(event.locationInWindow, from: nil)),
      let action
    else {
      return
    }
    _ = NSApp.sendAction(action, to: target, from: self)
  }

  override func draw(_ dirtyRect: NSRect) {
    super.draw(dirtyRect)
    guard isHovered else {
      return
    }
    Self.hoverFillColor.setFill()
    NSBezierPath(roundedRect: bounds.insetBy(dx: 0, dy: 2), xRadius: 6, yRadius: 6).fill()
  }

  private func configureIcon(_ session: SessionStatusIndicatorSession) {
    let tint = sessionStatusIndicatorColor(fromHex: session.agentIconColor) ?? NSColor.labelColor
    iconView.image = sessionStatusIndicatorImage(fromDataUrl: session.agentIconDataUrl, isTemplate: true)
    iconView.contentTintColor = tint
    iconView.imageScaling = .scaleProportionallyDown
    iconView.wantsLayer = true
    iconView.layer?.backgroundColor = NSColor.clear.cgColor
  }

  private static func trailingText(for session: SessionStatusIndicatorSession) -> String {
    session.status == .working ? "" : relativeTimeText(from: session.lastActiveAt)
  }

  private static func relativeTimeText(from value: String?) -> String {
    guard let date = sessionStatusIndicatorDate(from: value) else {
      return "unknown"
    }
    let elapsed = max(0, Int(Date().timeIntervalSince(date)))
    if elapsed < 60 {
      return "now"
    }
    let minutes = elapsed / 60
    if minutes < 60 {
      return "\(minutes)m ago"
    }
    let hours = minutes / 60
    if hours < 24 {
      return "\(hours)h ago"
    }
    let days = hours / 24
    return "\(days)d ago"
  }
}

private enum MenuBarStatusDebugLog {
  private static let maxLogFileBytes: UInt64 = 25 * 1024 * 1024
  private static let maxRotatedLogFiles = 3
  private static let highVolumeSampleInterval: TimeInterval = 5
  private static let sampledEvents = Set([
    "nativeMenuBarStatus.apply",
    "nativeMenuBarStatus.apply.visible",
  ])
  private static let logDateFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS ZZZZ"
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = .current
    return formatter
  }()
  private static var didCreateLogsDirectory = false
  private static var sampleStateByEvent: [String: LogSampleState] = [:]

  static func append(event: String, details: [String: Any] = [:]) {
    guard isNativePersistentLogImportantDiagnostic(event) ||
      NativeDiagnosticLogging.isScenarioEnabled(.nativeMenuBarStatus)
    else {
      return
    }
    let logsDirectory = GhostexAppStorage.logsDirectory
    let logURL = logsDirectory.appendingPathComponent("native-menu-bar-status-debug.log")
    var payload = details
    payload["event"] = event
    if !isNativePersistentLogImportantDiagnostic(event),
      !shouldWriteSampledLogEvent(
        event: event,
        sampledEvents: sampledEvents,
        sampleInterval: highVolumeSampleInterval,
        stateByEvent: &sampleStateByEvent,
        payload: &payload)
    {
      return
    }
    let line = "[\(logDateFormatter.string(from: Date()))] \(serialize(NativeLogPrivacy.sanitizePayload(payload)))\n"

    do {
      if !didCreateLogsDirectory {
        try FileManager.default.createDirectory(at: logsDirectory, withIntermediateDirectories: true)
        didCreateLogsDirectory = true
      }
      try rotateLogIfNeeded(logURL: logURL, incomingByteCount: UInt64(line.lengthOfBytes(using: .utf8)))
      if FileManager.default.fileExists(atPath: logURL.path) {
        let handle = try FileHandle(forWritingTo: logURL)
        try handle.seekToEnd()
        if let data = line.data(using: .utf8) {
          try handle.write(contentsOf: data)
        }
        try handle.close()
      } else {
        try line.write(to: logURL, atomically: true, encoding: .utf8)
      }
    } catch {
      NSLog("failed to write native menu bar status debug log: \(NativeLogPrivacy.sanitizeLogLine(error.localizedDescription))")
    }
  }

  static func rectPayload(_ rect: NSRect) -> [String: Any] {
    [
      "height": rect.height,
      "maxX": rect.maxX,
      "maxY": rect.maxY,
      "minX": rect.minX,
      "minY": rect.minY,
      "width": rect.width,
    ]
  }

  static func pointPayload(_ point: NSPoint) -> [String: Any] {
    [
      "x": point.x,
      "y": point.y,
    ]
  }

  static func optionalRectPayload(_ rect: NSRect?) -> Any {
    guard let rect else {
      return NSNull()
    }
    return rectPayload(rect)
  }

  private static func serialize(_ payload: [String: Any]) -> String {
    guard JSONSerialization.isValidJSONObject(payload),
      let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]),
      let json = String(data: data, encoding: .utf8)
    else {
      return "{\"event\":\"serializationFailed\"}"
    }
    return json
  }

  private static func rotateLogIfNeeded(logURL: URL, incomingByteCount: UInt64) throws {
    let manager = FileManager.default
    let size = (try? manager.attributesOfItem(atPath: logURL.path)[.size] as? NSNumber)?.uint64Value ?? 0
    guard size + incomingByteCount > maxLogFileBytes else {
      return
    }
    let oldest = rotatedLogURL(logURL, index: maxRotatedLogFiles)
    if manager.fileExists(atPath: oldest.path) {
      try manager.removeItem(at: oldest)
    }
    for index in stride(from: maxRotatedLogFiles - 1, through: 1, by: -1) {
      let source = rotatedLogURL(logURL, index: index)
      guard manager.fileExists(atPath: source.path) else {
        continue
      }
      try manager.moveItem(at: source, to: rotatedLogURL(logURL, index: index + 1))
    }
    try manager.moveItem(at: logURL, to: rotatedLogURL(logURL, index: 1))
  }

  private static func rotatedLogURL(_ logURL: URL, index: Int) -> URL {
    logURL.deletingLastPathComponent().appendingPathComponent("\(logURL.lastPathComponent).\(index)")
  }
}

private final class FlippedDocumentView: NSView {
  override var isFlipped: Bool {
    true
  }
}

private func sessionStatusIndicatorImage(fromDataUrl dataUrl: String?, isTemplate: Bool) -> NSImage? {
  guard let dataUrl,
    let commaIndex = dataUrl.firstIndex(of: ",")
  else {
    return nil
  }
  let metadata = dataUrl[..<commaIndex]
  let payload = String(dataUrl[dataUrl.index(after: commaIndex)...])
  let data: Data?
  if metadata.contains(";base64") {
    data = Data(base64Encoded: payload)
  } else {
    data = payload.removingPercentEncoding?.data(using: .utf8)
  }
  guard let data, let image = NSImage(data: data) else {
    return nil
  }
  image.isTemplate = isTemplate
  return image
}

private func sessionStatusIndicatorColor(fromHex hex: String?) -> NSColor? {
  guard let hex else {
    return nil
  }
  let value = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
  guard value.count == 6, let rgb = UInt32(value, radix: 16) else {
    return nil
  }
  return NSColor(
    calibratedRed: CGFloat((rgb >> 16) & 0xff) / 255,
    green: CGFloat((rgb >> 8) & 0xff) / 255,
    blue: CGFloat(rgb & 0xff) / 255,
    alpha: 1)
}

/*
 ISO8601DateFormatter construction loads ICU locale data and is far too
 expensive for per-parse use on the status-update path; share one formatter
 per format shape instead.
 */
@MainActor
private enum SessionStatusIndicatorDateParsing {
  static let fractionalFormatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }()

  static let internetDateTimeFormatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter
  }()
}

@MainActor
private func sessionStatusIndicatorDate(from value: String?) -> Date? {
  guard let value, !value.isEmpty else {
    return nil
  }
  if let date = SessionStatusIndicatorDateParsing.fractionalFormatter.date(from: value) {
    return date
  }
  return SessionStatusIndicatorDateParsing.internetDateTimeFormatter.date(from: value)
}
