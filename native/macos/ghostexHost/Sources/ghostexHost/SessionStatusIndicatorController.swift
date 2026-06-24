import AppKit
import CoreGraphics

enum SessionStatusIndicatorMenuAction {
  case quitApp
  case restartApp
}

@MainActor
final class SessionStatusIndicatorController {
  private static let defaultScreenMargin: CGFloat = 22

  private let panel: NSPanel
  private let indicatorView: SessionStatusIndicatorView
  private let menuBarStatusItem: NSStatusItem
  private let menuBarClickTarget: MenuBarSessionStatusIndicatorTarget
  private let onActivationRequest: (String) -> Void
  private var hasUserPositionedPanel = false

  /**
   CDXC:SessionStatusIndicators 2026-05-05-19:47
   Session counts must be rendered by AppKit, not SwiftUI, so the floating
   status UI can live outside the ghostex content view, default to the built-in or
   primary display, and support direct drag repositioning without webview hit
   testing.
   */
  init(
    onActivationRequest: @escaping (String) -> Void,
    onClick: @escaping (NativeSessionStatusIndicatorStatus) -> Void,
    onProjectClick: @escaping (String) -> Void,
    onSessionClick: @escaping (String, String) -> Void,
    onMenuAction: @escaping (SessionStatusIndicatorMenuAction) -> Void
  ) {
    /**
     CDXC:SessionStatusIndicators 2026-05-09-15:48
     The menu bar indicator must be a second presentation of the floating
     status indicator, not a separate state machine. Reuse the same computed
     visible items and click callback so attention, working, and idle session
     counts route through the existing sidebar selector.
     */
    let view = SessionStatusIndicatorView(
      onClick: { status in
        onActivationRequest("floatingStatusIndicatorClick.\(status.rawValue)")
        NSApp.activate(ignoringOtherApps: true)
        onClick(status)
      },
      onDrag: {})
    let menuBarStatusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    let menuBarClickTarget = MenuBarSessionStatusIndicatorTarget(
      onOpen: {
        onActivationRequest("menuBarStatusIndicator.openRunningAgents")
      },
      onProjectClick: onProjectClick,
      onSessionClick: onSessionClick,
      onMenuAction: onMenuAction)
    let panel = NSPanel(
      contentRect: NSRect(origin: .zero, size: view.preferredSize),
      styleMask: [.borderless, .nonactivatingPanel],
      backing: .buffered,
      defer: false
    )
    self.indicatorView = view
    self.menuBarStatusItem = menuBarStatusItem
    self.menuBarClickTarget = menuBarClickTarget
    self.onActivationRequest = onActivationRequest
    self.panel = panel
    panel.backgroundColor = .clear
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
    panel.contentView = indicatorView
    panel.hasShadow = false
    panel.hidesOnDeactivate = false
    panel.ignoresMouseEvents = false
    panel.isFloatingPanel = true
    panel.isOpaque = false
    panel.isReleasedWhenClosed = false
    panel.level = .floating
    view.onDrag = { [weak self] in
      self?.hasUserPositionedPanel = true
    }
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
    indicatorView.sizeSetting = command.size
    indicatorView.items = items
    applyMenuBarItems(items, projects: command.projects ?? [], isHidden: command.hideMenuBarIndicators)
    /**
     CDXC:SessionStatusIndicators 2026-05-09-17:30
     Floating badges are hidden by default while menu bar badges remain visible
     by default. Apply both visibility settings after computing shared items so
     hiding a surface never changes counts or click target ordering.
     */
    guard !items.isEmpty && !command.hideFloatingIndicators else {
      panel.orderOut(nil)
      return
    }

    let nextSize = indicatorView.preferredSize
    let nextOrigin =
      hasUserPositionedPanel
      ? Self.clampedOrigin(panel.frame.origin, size: nextSize)
      : Self.defaultOrigin(size: nextSize)
    panel.setFrame(NSRect(origin: nextOrigin, size: nextSize), display: true)
    panel.orderFrontRegardless()
  }

  private static func visibleItems(
    for command: SetSessionStatusIndicators
  ) -> [SessionStatusIndicatorItem] {
    /**
     CDXC:SessionStatusIndicators 2026-05-05-19:47
     Attention and working counts are action states and should suppress the
     idle available-session total whenever either exists. The idle chip is only
     a quiet all-available summary for the fully idle case.
     CDXC:SessionStatusIndicators 2026-05-08-09:09
     Floating status badges draw directly on a transparent panel without a
     shared backdrop, so each indicator owns its own visible chip.
     CDXC:SessionStatusIndicators 2026-05-09-15:53
     Working status badges are `working`, not `running`. Keep native naming
     aligned with app terminology so `running` remains reserved for live
     runtime state and the idle available-session count.

     CDXC:SessionStatusIndicators 2026-06-13-07:20:
     Floating status badges used a single solid square fill with no border
     radius until the later 2026-06-15-17:10 requirement made them match the
     menu bar chip renderer.

     CDXC:SessionStatusIndicators 2026-06-15-02:03:
     Menu bar indicators temporarily drew count text with no badge fill behind
     the numbers; the later 2026-06-15-12:42 requirement restores square
     status backgrounds.

     CDXC:SessionStatusIndicators 2026-06-15-02:24:
     The menu bar idle number should use #e5e6e6 instead of the idle floating
     badge fill, while attention and working numbers keep their status colors.

     CDXC:SessionStatusIndicators 2026-06-15-12:42:
     Working status initially used #e3b256 across floating and menu bar badges.

     CDXC:SessionStatusIndicators 2026-06-15-15:24:
     Working status is darkened to #c99643. Menu bar badges use a rounded native
     control-background fill so the button background follows macOS light and
     dark appearances while the count text carries the status color.

     CDXC:SessionStatusIndicators 2026-06-15-17:10:
     Floating indicators must match the menu bar indicator look: rounded native
     control-background chips with status-colored count text.
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
    guard !items.isEmpty && !isHidden else {
      menuBarStatusItem.isVisible = false
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
      return
    }
    button.image = SessionStatusIndicatorView.menuBarImage(for: items, sizeSetting: sizeSetting)
    button.image?.isTemplate = false
    button.toolTip = NativeTooltip.text("Ghostex session status")
  }

  private static func defaultOrigin(size: NSSize) -> NSPoint {
    let screen = defaultScreen()
    let frame = screen.visibleFrame
    return NSPoint(
      x: frame.maxX - size.width - defaultScreenMargin,
      y: frame.minY + defaultScreenMargin)
  }

  private static func clampedOrigin(_ origin: NSPoint, size: NSSize) -> NSPoint {
    guard let screen = screen(containing: origin) ?? defaultScreenOptional() else {
      return origin
    }
    /**
     CDXC:SessionStatusIndicators 2026-05-08-10:22
     User-positioned floating indicators must be allowed in bottom screen
     corners beside the Dock. Clamp manual positions to the full screen frame,
     not visibleFrame, so count/size updates do not push them out of the Dock
     strip after the user places them there.
     */
    let frame = screen.frame
    let maxX = max(frame.minX, frame.maxX - size.width)
    let maxY = max(frame.minY, frame.maxY - size.height)
    return NSPoint(
      x: min(max(origin.x, frame.minX), maxX),
      y: min(max(origin.y, frame.minY), maxY))
  }

  private static func screen(containing origin: NSPoint) -> NSScreen? {
    NSScreen.screens.first { $0.frame.contains(origin) }
  }

  private static func defaultScreen() -> NSScreen {
    defaultScreenOptional() ?? NSScreen.main ?? NSScreen.screens.first!
  }

  private static func defaultScreenOptional() -> NSScreen? {
    NSScreen.screens.first(where: isBuiltInScreen) ?? NSScreen.main ?? NSScreen.screens.first
  }

  private static func isBuiltInScreen(_ screen: NSScreen) -> Bool {
    let key = NSDeviceDescriptionKey("NSScreenNumber")
    guard let displayNumber = screen.deviceDescription[key] as? NSNumber else {
      return false
    }
    return CGDisplayIsBuiltin(CGDirectDisplayID(displayNumber.uint32Value)) != 0
  }
}

private struct SessionStatusIndicatorItem {
  let status: NativeSessionStatusIndicatorStatus
  let count: Int
  let color: NSColor
}

@MainActor
private final class SessionStatusIndicatorView: NSView {
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

  private struct DragState {
    let mouseStart: NSPoint
    let windowOriginStart: NSPoint
    var didMove: Bool = false
  }

  /**
   CDXC:SessionStatusIndicators 2026-05-07-16:42
   Counts should read clearly at default size, and a future user-facing size
   setting should scale a small set of base metrics instead of rewriting draw
   logic. Keep the default number visually dominant inside the indicator.
   CDXC:SessionStatusIndicators 2026-05-07-17:36
   Preserve the inactive-only-when-no-action-state visibility rule in
   visibleItems so idle counts appear only when no working or attention badge
   needs priority.
   CDXC:SessionStatusIndicators 2026-05-07-18:02
   A single visible status should remain easy to click and read. Keep explicit
   view padding around each badge so transparent NSPanel edges do not crowd the
   count.
   CDXC:SessionStatusIndicators 2026-05-07-18:20
   Medium is the default and scales every drawing metric to 50% of X-Large;
   Large and Small are named settings values that reuse the same AppKit drawing
   path.
   CDXC:SessionStatusIndicators 2026-05-07-18:32
   The indicator should fit the visible badges tightly, including the
   single-badge case.
   CDXC:SessionStatusIndicators 2026-05-08-09:09
   The floating indicator must not draw a shared background behind the badges.
   Keep the NSPanel and NSView clear so only individual status chips render.
   CDXC:SessionStatusIndicators 2026-05-08-09:17
   Status buttons should not have a gray outer ring. Use a flat colored badge
   so the control does not add extra background colors around the status token.
   CDXC:SessionStatusIndicators 2026-05-08-10:21
   Indicator numbers should render 2px larger at the base drawing scale while
   preserving the existing Small/Medium/Large/X-Large size scaling behavior.
   CDXC:SessionStatusIndicators 2026-05-08-10:27
   Repositioning must not require a Shift modifier. Track ordinary drags from
   mouse-down and reserve click activation for mouse-up without panel movement.
   CDXC:SessionStatusIndicators 2026-06-13-07:20
   Floating running-session indicators previously rendered as solid, fully
   square status backgrounds. That status-fill design was retired by the
   2026-06-15-17:10 menu-bar-match requirement.

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
   metrics so tightening the status item never shrinks floating badge padding.

   CDXC:SessionStatusIndicators 2026-06-15-12:42:
   Menu bar indicators returned to square status backgrounds after the
   text-only pass. Keep the status item compact by sizing each square from the
   count text plus menu-bar-specific padding instead of reusing floating badge
   dimensions.

   CDXC:SessionStatusIndicators 2026-06-15-15:24:
   Menu bar indicator backgrounds are rounded native-control backgrounds, not
   status-colored squares. Resolve the image at draw time so AppKit supplies the
   correct light or dark background color for the current macOS appearance.

   CDXC:SessionStatusIndicators 2026-06-15-15:34:
   Menu bar badges should be rounded chips, not square badges with rounded
   corners. Keep separate width and height metrics so one-digit counts still
   render as a short rounded rectangle.

   CDXC:SessionStatusIndicators 2026-06-15-17:10:
   Floating status indicators should match the menu bar indicator exactly in
   visual treatment. Use the same chip sizing, rounded native background, and
   status-colored count text for the panel and the status item.
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

  var items: [SessionStatusIndicatorItem] = [] {
    didSet {
      needsDisplay = true
    }
  }

  var sizeSetting: NativeSessionStatusIndicatorSize = .medium {
    didSet {
      needsDisplay = true
    }
  }

  var preferredSize: NSSize {
    Self.preferredSize(for: items, sizeSetting: sizeSetting)
  }

  static func preferredSize(
    for items: [SessionStatusIndicatorItem],
    sizeSetting: NativeSessionStatusIndicatorSize
  ) -> NSSize {
    menuBarPreferredSize(for: items, sizeSetting: sizeSetting)
  }

  private var currentMetrics: IndicatorMetrics {
    Self.metrics(for: sizeSetting)
  }

  private static func currentMetrics(
    for sizeSetting: NativeSessionStatusIndicatorSize
  ) -> IndicatorMetrics {
    metrics(for: sizeSetting)
  }

  private let onClick: (NativeSessionStatusIndicatorStatus) -> Void
  var onDrag: () -> Void
  private var mouseDownStatus: NativeSessionStatusIndicatorStatus?
  private var dragState: DragState?

  init(
    onClick: @escaping (NativeSessionStatusIndicatorStatus) -> Void,
    onDrag: @escaping () -> Void
  ) {
    self.onClick = onClick
    self.onDrag = onDrag
    super.init(frame: NSRect(origin: .zero, size: .zero))
    wantsLayer = true
    layer?.backgroundColor = NSColor.clear.cgColor
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  override var isOpaque: Bool {
    false
  }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
    true
  }

  override func draw(_ dirtyRect: NSRect) {
    super.draw(dirtyRect)
    Self.drawMenuBarItems(items: items, in: bounds, sizeSetting: sizeSetting)
  }

  static func image(
    for items: [SessionStatusIndicatorItem],
    sizeSetting: NativeSessionStatusIndicatorSize
  ) -> NSImage {
    let size = menuBarPreferredSize(for: items, sizeSetting: sizeSetting)
    let image = NSImage(size: size)
    image.lockFocus()
    drawMenuBarItems(items: items, in: NSRect(origin: .zero, size: size), sizeSetting: sizeSetting)
    image.unlockFocus()
    return image
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

  static func menuBarStatus(
    at point: NSPoint,
    in bounds: NSRect,
    items: [SessionStatusIndicatorItem],
    sizeSetting: NativeSessionStatusIndicatorSize
  ) -> NativeSessionStatusIndicatorStatus? {
    menuBarItemRects(items: items, bounds: bounds, sizeSetting: sizeSetting)
      .first { _, rect in rect.contains(point) }?.0.status
      ?? items.first?.status
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

  override func mouseDown(with event: NSEvent) {
    mouseDownStatus = nil
    beginDragTracking()
    mouseDownStatus = status(at: convert(event.locationInWindow, from: nil))
  }

  override func mouseDragged(with event: NSEvent) {
    guard let dragState, let window else {
      return
    }
    if !dragState.didMove {
      self.dragState?.didMove = true
      mouseDownStatus = nil
      onDrag()
    }
    let mouseLocation = NSEvent.mouseLocation
    window.setFrameOrigin(
      NSPoint(
        x: dragState.windowOriginStart.x + mouseLocation.x - dragState.mouseStart.x,
        y: dragState.windowOriginStart.y + mouseLocation.y - dragState.mouseStart.y))
  }

  override func mouseUp(with event: NSEvent) {
    if dragState?.didMove == true {
      dragState = nil
      return
    }
    dragState = nil
    guard let mouseDownStatus else {
      return
    }
    defer {
      self.mouseDownStatus = nil
    }
    if status(at: convert(event.locationInWindow, from: nil)) == mouseDownStatus {
      onClick(mouseDownStatus)
    }
  }

  private func beginDragTracking() {
    guard let window else {
      return
    }
    dragState = DragState(
      mouseStart: NSEvent.mouseLocation,
      windowOriginStart: window.frame.origin)
  }

  private func status(at point: NSPoint) -> NativeSessionStatusIndicatorStatus? {
    Self.status(at: point, in: bounds, items: items, sizeSetting: sizeSetting)
  }

  static func status(
    at point: NSPoint,
    in bounds: NSRect,
    items: [SessionStatusIndicatorItem],
    sizeSetting: NativeSessionStatusIndicatorSize
  ) -> NativeSessionStatusIndicatorStatus? {
    menuBarItemRects(items: items, bounds: bounds, sizeSetting: sizeSetting)
      .first { _, rect in rect.contains(point) }?.0.status
  }

  private func itemRects() -> [(SessionStatusIndicatorItem, NSRect)] {
    Self.menuBarItemRects(items: items, bounds: bounds, sizeSetting: sizeSetting)
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
    guard event?.type == .leftMouseUp || event == nil else {
      return
    }
    if event?.modifierFlags.contains(.control) == true {
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

  var projects: [SessionStatusIndicatorProject] = [] {
    didSet {
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
    rebuildRows()
    let height = preferredPanelHeight()
    let frame = Self.panelFrame(
      size: NSSize(width: Self.panelWidth, height: height),
      anchoredTo: sender)
    panel.setFrame(frame, display: true)
    panel.orderFrontRegardless()
    panel.makeFirstResponder(focusSink)
    installDismissEventMonitors()
    updateScrollbar()
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

    for session in project.sessions.sorted(by: { $0.sidebarOrder < $1.sidebarOrder }) {
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
    localDismissEventMonitor = NSEvent.addLocalMonitorForEvents(
      matching: [.leftMouseDown, .rightMouseDown]
    ) { [weak self] event in
      guard let self else {
        return event
      }
      if self.panel.isVisible && event.window !== self.panel {
        self.dismissPanel()
      }
      return event
    }
    globalDismissEventMonitor = NSEvent.addGlobalMonitorForEvents(
      matching: [.leftMouseDown, .rightMouseDown]
    ) { [weak self] _ in
      self?.dismissPanel()
    }
  }

  private func removeDismissEventMonitors() {
    if let localDismissEventMonitor {
      NSEvent.removeMonitor(localDismissEventMonitor)
      self.localDismissEventMonitor = nil
    }
    if let globalDismissEventMonitor {
      NSEvent.removeMonitor(globalDismissEventMonitor)
      self.globalDismissEventMonitor = nil
    }
  }

  private func dismissPanel() {
    guard panel.isVisible else {
      removeDismissEventMonitors()
      return
    }
    setHoveredSessionRow(nil)
    footerActionButtons.forEach { $0.setHovered(false) }
    isMouseInsidePanel = false
    panel.orderOut(nil)
    removeDismissEventMonitors()
  }

  private static func panelFrame(size: NSSize, anchoredTo sender: NSStatusBarButton) -> NSRect {
    let fallbackScreen = NSScreen.main ?? NSScreen.screens.first
    let buttonFrame = sender.window.map { window in
      window.convertToScreen(sender.convert(sender.bounds, to: nil))
    } ?? NSRect(origin: NSEvent.mouseLocation, size: .zero)
    let screenFrame = (fallbackScreen ?? NSScreen.screens.first)?.visibleFrame
      ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
    let x = min(
      max(screenFrame.minX + 8, buttonFrame.midX - size.width / 2),
      screenFrame.maxX - size.width - 8)
    let proposedY = buttonFrame.minY - size.height - 8
    let y = proposedY >= screenFrame.minY + 8 ? proposedY : buttonFrame.maxY + 8
    return NSRect(origin: NSPoint(x: x, y: y), size: size)
  }

  @objc private func projectClicked(_ sender: MenuBarStatusProjectButton) {
    dismissPanel()
    onProjectClick(sender.projectId)
  }

  @objc private func sessionClicked(_ sender: MenuBarStatusSessionRow) {
    dismissPanel()
    onSessionClick(sender.projectId, sender.sessionId)
  }

  @objc private func restartGhostex(_ sender: MenuBarStatusActionButton) {
    dismissPanel()
    onMenuAction(.restartApp)
  }

  @objc private func quitGhostex(_ sender: MenuBarStatusActionButton) {
    dismissPanel()
    onMenuAction(.quitApp)
  }
}

extension MenuBarSessionStatusPanelController: NSWindowDelegate {
  func windowDidResignKey(_ notification: Notification) {
    dismissPanel()
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

private func sessionStatusIndicatorDate(from value: String?) -> Date? {
  guard let value, !value.isEmpty else {
    return nil
  }
  let fractionalFormatter = ISO8601DateFormatter()
  fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  if let date = fractionalFormatter.date(from: value) {
    return date
  }
  let formatter = ISO8601DateFormatter()
  formatter.formatOptions = [.withInternetDateTime]
  return formatter.date(from: value)
}
