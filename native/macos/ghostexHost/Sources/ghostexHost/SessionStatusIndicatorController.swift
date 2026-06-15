import AppKit
import CoreGraphics

enum SessionStatusIndicatorMenuAction {
  case openApp
  case quitApp
  case quitFully
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
      onClick: { status in
        onActivationRequest("menuBarStatusIndicatorClick.\(status.rawValue)")
        NSApp.activate(ignoringOtherApps: true)
        onClick(status)
      },
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
      _ = button.sendAction(on: [.leftMouseUp, .rightMouseUp])
      button.target = menuBarClickTarget
    }
  }

  func apply(_ command: SetSessionStatusIndicators) {
    let items = Self.visibleItems(for: command)
    indicatorView.sizeSetting = command.size
    indicatorView.items = items
    applyMenuBarItems(items, isHidden: command.hideMenuBarIndicators)
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

  private func applyMenuBarItems(_ items: [SessionStatusIndicatorItem], isHidden: Bool) {
    guard !items.isEmpty && !isHidden else {
      menuBarStatusItem.isVisible = false
      return
    }

    let sizeSetting = SessionStatusIndicatorView.menuBarSizeSetting
    let preferredSize = SessionStatusIndicatorView.menuBarPreferredSize(
      for: items,
      sizeSetting: sizeSetting)
    menuBarClickTarget.items = items
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
  let menu: NSMenu
  var items: [SessionStatusIndicatorItem] = []
  var sizeSetting: NativeSessionStatusIndicatorSize = SessionStatusIndicatorView.menuBarSizeSetting
  private let onClick: (NativeSessionStatusIndicatorStatus) -> Void
  private let onMenuAction: (SessionStatusIndicatorMenuAction) -> Void

  init(
    onClick: @escaping (NativeSessionStatusIndicatorStatus) -> Void,
    onMenuAction: @escaping (SessionStatusIndicatorMenuAction) -> Void
  ) {
    self.onClick = onClick
    self.onMenuAction = onMenuAction
    self.menu = NSMenu()
    super.init()
    /*
     CDXC:SessionStatusIndicators 2026-06-15-03:16:
     The number-only menu bar indicator exposes app lifecycle commands.

     CDXC:SessionStatusIndicators 2026-06-15-11:34:
     Left click must keep the same status-focus behavior as floating badges,
     while right click opens the app lifecycle menu. Do not attach the menu to
     NSStatusItem.menu because AppKit would show it for ordinary left clicks.
     */
    menu.autoenablesItems = false
    menu.addItem(menuItem(title: "Open Ghostex", action: #selector(openGhostexApp(_:))))
    menu.addItem(menuItem(title: "Restart Ghostex App", action: #selector(restartGhostexApp(_:))))
    menu.addItem(menuItem(title: "Quit Ghostex App", action: #selector(quitGhostexApp(_:))))
    menu.addItem(menuItem(title: "Quit Ghostex Fully", action: #selector(quitGhostexFully(_:))))
  }

  private func menuItem(title: String, action: Selector) -> NSMenuItem {
    let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
    item.target = self
    return item
  }

  @objc func clicked(_ sender: NSStatusBarButton) {
    let event = NSApp.currentEvent
    if event?.type == .rightMouseUp || event?.modifierFlags.contains(.control) == true {
      showMenu(from: sender, event: event)
      return
    }
    guard !items.isEmpty else {
      return
    }
    let point =
      event.map { sender.convert($0.locationInWindow, from: nil) }
      ?? NSPoint(x: sender.bounds.midX, y: sender.bounds.midY)
    guard
      let status = SessionStatusIndicatorView.menuBarStatus(
        at: point,
        in: sender.bounds,
        items: items,
        sizeSetting: sizeSetting)
    else {
      return
    }
    onClick(status)
  }

  private func showMenu(from sender: NSStatusBarButton, event: NSEvent?) {
    sender.highlight(true)
    if let event {
      NSMenu.popUpContextMenu(menu, with: event, for: sender)
    } else {
      menu.popUp(positioning: nil, at: NSPoint(x: 0, y: sender.bounds.minY), in: sender)
    }
    sender.highlight(false)
  }

  @objc private func openGhostexApp(_ sender: NSMenuItem) {
    onMenuAction(.openApp)
  }

  @objc private func restartGhostexApp(_ sender: NSMenuItem) {
    onMenuAction(.restartApp)
  }

  @objc private func quitGhostexApp(_ sender: NSMenuItem) {
    onMenuAction(.quitApp)
  }

  @objc private func quitGhostexFully(_ sender: NSMenuItem) {
    onMenuAction(.quitFully)
  }
}
