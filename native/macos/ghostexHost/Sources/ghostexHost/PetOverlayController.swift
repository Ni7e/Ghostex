import AppKit
import CoreGraphics
import Foundation
import WebKit

final class PetOverlayController: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
  private enum AnchorSide: String {
    case left
    case right
  }

  private static let defaultScreenMargin: CGFloat = 18
  private static let edgeAnchorSwitchDistance: CGFloat = 44
  private static let storageKey = "ghostex.petOverlayOrigin"
  private static let activityPanelWidth: CGFloat = 320
  private static let spritePanelSize = NSSize(width: 104, height: 108)
  private static let statusPanelBaseWidth: CGFloat = 104
  private static let statusPanelItemWidth: CGFloat = 36
  private static let statusPanelHeight: CGFloat = 152

  private let encoder = JSONEncoder()
  private let onGoToGhostex: () -> Void
  private let onActivityClick: (String, String) -> Void
  private let onSleepPet: () -> Void
  private let onStatusClick: (NativeSessionStatusIndicatorStatus) -> Void
  private let panel: NSPanel
  private let webView: WKWebView
  private var anchorSide: AnchorSide
  private var areActivitiesVisible = true
  private var dragStartMouseLocation: NSPoint?
  private var dragStartPanelOrigin: NSPoint?
  private var hasUserPositionedPanel: Bool
  private var isLoaded = false
  private var latestState: SetPetOverlayState?

  init(
    onActivityClick: @escaping (String, String) -> Void,
    onGoToGhostex: @escaping () -> Void,
    onStatusClick: @escaping (NativeSessionStatusIndicatorStatus) -> Void,
    onSleepPet: @escaping () -> Void
  ) {
    let configuration = WKWebViewConfiguration()
    let webView = WKWebView(frame: .zero, configuration: configuration)
    let storedActivitiesVisible = Self.readStoredActivitiesVisible() ?? true
    let initialSize = Self.preferredSize(
      activityCount: 0,
      statusItemCount: 0,
      activitiesVisible: storedActivitiesVisible)
    let panel = NSPanel(
      contentRect: NSRect(origin: .zero, size: initialSize),
      styleMask: [.borderless, .nonactivatingPanel],
      backing: .buffered,
      defer: false
    )
    self.onGoToGhostex = onGoToGhostex
    self.onActivityClick = onActivityClick
    self.onSleepPet = onSleepPet
    self.onStatusClick = onStatusClick
    self.panel = panel
    self.webView = webView
    self.anchorSide = Self.readStoredAnchorSide() ?? Self.readStoredOrigin().map {
      Self.anchorSide(for: NSRect(origin: $0, size: initialSize))
    } ?? .right
    self.areActivitiesVisible = storedActivitiesVisible
    self.hasUserPositionedPanel = Self.readStoredOrigin() != nil
    super.init()

    configuration.userContentController.add(self, name: "ghostexPetOverlay")
    webView.navigationDelegate = self
    webView.autoresizingMask = [.width, .height]
    webView.frame = NSRect(origin: .zero, size: initialSize)
    webView.setValue(false, forKey: "drawsBackground")

    panel.backgroundColor = .clear
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
    panel.contentView = webView
    panel.hasShadow = false
    panel.hidesOnDeactivate = false
    panel.ignoresMouseEvents = false
    panel.isFloatingPanel = true
    panel.isOpaque = false
    panel.isReleasedWhenClosed = false
    panel.level = .floating
    panel.setFrame(
      NSRect(origin: initialOrigin(size: initialSize), size: initialSize),
      display: false
    )
  }

  deinit {
    webView.configuration.userContentController.removeScriptMessageHandler(forName: "ghostexPetOverlay")
  }

  func load(webAssets: URL) {
    let petHost = webAssets.appendingPathComponent("pet-host.html")
    if FileManager.default.fileExists(atPath: petHost.path) {
      webView.loadFileURL(petHost, allowingReadAccessTo: webAssets)
      return
    }
    webView.loadHTMLString(
      "<!doctype html><html><body style=\"margin:0;background:transparent\"></body></html>",
      baseURL: webAssets
    )
  }

  func apply(_ state: SetPetOverlayState) {
    latestState = state
    guard state.enabled else {
      panel.orderOut(nil)
      sendLatestStateIfLoaded()
      return
    }

    let size = Self.preferredSize(
      activityCount: state.activities.count,
      statusItemCount: state.statusItems.count,
      activitiesVisible: areActivitiesVisible)
    let origin =
      hasUserPositionedPanel
      ? Self.anchoredOrigin(from: panel.frame, nextSize: size, anchorSide: anchorSide)
      : Self.defaultOrigin(size: size)
    if !hasUserPositionedPanel {
      anchorSide = .right
    }
    panel.setFrame(NSRect(origin: origin, size: size), display: true, animate: true)
    panel.orderFrontRegardless()
    sendLatestStateIfLoaded()
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    isLoaded = true
    sendLatestStateIfLoaded()
  }

  func userContentController(
    _ userContentController: WKUserContentController,
    didReceive message: WKScriptMessage
  ) {
    guard
      message.name == "ghostexPetOverlay",
      let body = message.body as? [String: Any],
      let type = body["type"] as? String
    else {
      return
    }

    switch type {
    case "activateActivity":
      guard
        let projectId = body["projectId"] as? String,
        let sessionId = body["sessionId"] as? String
      else {
        return
      }
      /**
       CDXC:PetOverlay 2026-05-14-10:23:
       The overlay webview owns hit-testing for the message bubble, while the
       main app owns session focus. Forward exact ids through AppKit instead of
       deriving a target from title text or status color.
       */
      onActivityClick(projectId, sessionId)
    case "activateStatus":
      guard
        let statusValue = body["status"] as? String,
        let status = NativeSessionStatusIndicatorStatus(rawValue: statusValue)
      else {
        return
      }
      /**
       CDXC:PetOverlay 2026-05-21-02:19:
       The collapsed pet badge uses the aggregate session-status route that
       previously powered the floating indicator. Route badge clicks through
       the same native status callback so attention, working, and available
       selection stays identical after the standalone floating badge is removed.
       */
      onStatusClick(status)
    case "dragStart":
      dragStartMouseLocation = NSEvent.mouseLocation
      dragStartPanelOrigin = panel.frame.origin
    case "dragMove":
      handleDragMove()
    case "dragEnd":
      finishDrag()
    case "setActivityVisibility":
      guard let visible = body["visible"] as? Bool else {
        return
      }
      areActivitiesVisible = visible
      Self.storeActivitiesVisible(visible)
      if let latestState {
        apply(latestState)
      }
    case "showContextMenu":
      showContextMenu()
    default:
      break
    }
  }

  private func showContextMenu() {
    /**
     CDXC:PetOverlay 2026-05-21-14:59:
     Right-clicking any point inside the pet overlay webview should show the
     native pet menu instead of the WKWebView context menu. Keep Sleep Pet first
     and Go to Ghostex second so the pet can either be dismissed or raise the main
     app window without requiring a precise click on the sprite.
     */
    let menu = NSMenu(title: "Pet")
    let sleepItem = NSMenuItem(title: "Sleep Pet", action: #selector(sleepPetFromContextMenu(_:)), keyEquivalent: "")
    sleepItem.target = self
    menu.addItem(sleepItem)
    let goToGhostexItem = NSMenuItem(
      title: "Go to Ghostex",
      action: #selector(goToGhostexFromContextMenu(_:)),
      keyEquivalent: "")
    goToGhostexItem.target = self
    menu.addItem(goToGhostexItem)
    let screenPoint = NSEvent.mouseLocation
    let windowPoint = webView.window?.convertPoint(fromScreen: screenPoint) ?? .zero
    let viewPoint = webView.convert(windowPoint, from: nil)
    menu.popUp(positioning: sleepItem, at: viewPoint, in: webView)
  }

  @objc private func sleepPetFromContextMenu(_ sender: NSMenuItem) {
    onSleepPet()
  }

  @objc private func goToGhostexFromContextMenu(_ sender: NSMenuItem) {
    onGoToGhostex()
  }

  private func handleDragMove() {
    guard let dragStartMouseLocation, let dragStartPanelOrigin else {
      return
    }
    hasUserPositionedPanel = true
    let mouseLocation = NSEvent.mouseLocation
    let nextOrigin = NSPoint(
      x: dragStartPanelOrigin.x + mouseLocation.x - dragStartMouseLocation.x,
      y: dragStartPanelOrigin.y + mouseLocation.y - dragStartMouseLocation.y
    )
    panel.setFrameOrigin(Self.clampedOrigin(nextOrigin, size: panel.frame.size))
  }

  private func finishDrag() {
    dragStartMouseLocation = nil
    dragStartPanelOrigin = nil
    anchorSide = Self.edgeAnchoredSide(for: panel.frame, current: anchorSide)
    Self.storeOrigin(panel.frame.origin)
    Self.storeAnchorSide(anchorSide)
    sendLatestStateIfLoaded()
  }

  private func sendLatestStateIfLoaded() {
    guard isLoaded, let latestState else {
      return
    }
    guard
      let data = try? encoder.encode(PetOverlayWebState(
        state: latestState,
        activitiesVisible: areActivitiesVisible,
        anchorSide: anchorSide.rawValue)),
      let json = String(data: data, encoding: .utf8)
    else {
      return
    }
    webView.evaluateJavaScript(
      """
      window.__ghostexPetOverlayState = \(json);
      window.dispatchEvent(new CustomEvent('ghostex-pet-overlay-state', {
        detail: window.__ghostexPetOverlayState
      }));
      undefined;
      """)
  }

  private func initialOrigin(size: NSSize) -> NSPoint {
    if let storedOrigin = Self.readStoredOrigin() {
      return Self.clampedOrigin(storedOrigin, size: size)
    }
    return Self.defaultOrigin(size: size)
  }

  private static func anchoredOrigin(
    from currentFrame: NSRect,
    nextSize: NSSize,
    anchorSide: AnchorSide
  ) -> NSPoint {
    /**
     CDXC:PetOverlay 2026-05-21-02:19:
     The pet overlay is always left- or right-anchored based on the last screen
     side the user dragged it toward. Preserve that edge when cards collapse or
     expand so the visible pet stays in place while the card stack changes size.
     */
    let unclampedOrigin: NSPoint
    switch anchorSide {
    case .left:
      unclampedOrigin = currentFrame.origin
    case .right:
      unclampedOrigin = NSPoint(
        x: currentFrame.maxX - nextSize.width,
        y: currentFrame.origin.y)
    }
    return clampedOrigin(unclampedOrigin, size: nextSize)
  }

  private static func preferredSize(
    activityCount: Int,
    statusItemCount: Int,
    activitiesVisible: Bool
  ) -> NSSize {
    let visibleActivityCount = min(max(activityCount, 0), 3)
    /**
     CDXC:PetOverlay 2026-05-15-00:36:
     When the pet has no activity bubbles, the native panel should fit the
     sprite-sized React shell instead of keeping the wider bubble hit area.
     Activity bubbles still need the wider panel so their titles remain usable.
     CDXC:PetOverlay 2026-05-21-02:19:
     Hiding session cards keeps the pet awake and replaces the cards with the
     compact aggregate status indicator, so the panel must shrink to the badge
     and sprite instead of keeping the full card hit area.
     */
    if !activitiesVisible && statusItemCount > 0 {
      return NSSize(
        width: max(statusPanelBaseWidth, CGFloat(statusItemCount) * statusPanelItemWidth + 64),
        height: statusPanelHeight)
    }
    if visibleActivityCount == 0 {
      return spritePanelSize
    }
    return NSSize(width: activityPanelWidth, height: CGFloat(126 + visibleActivityCount * 54))
  }

  private static func defaultOrigin(size: NSSize) -> NSPoint {
    let frame = defaultScreen().visibleFrame
    return NSPoint(
      x: frame.maxX - size.width - defaultScreenMargin,
      y: frame.minY + defaultScreenMargin)
  }

  private static func clampedOrigin(_ origin: NSPoint, size: NSSize) -> NSPoint {
    let proposedFrame = NSRect(origin: origin, size: size)
    guard let screen = screen(containing: proposedFrame) ?? screen(containing: origin) ?? defaultScreenOptional() else {
      return origin
    }
    /**
     CDXC:PetOverlay 2026-05-21-02:19:
     Drag clamping must keep a pet on the monitor its panel overlaps, including
     when the panel is flush against the left edge of a secondary display. Use
     the proposed panel rect before falling back to origin-only screen detection
     so an edge point does not snap to the built-in/primary monitor.
     */
    let frame = screen.frame
    return NSPoint(
      x: min(max(origin.x, frame.minX), max(frame.minX, frame.maxX - size.width)),
      y: min(max(origin.y, frame.minY), max(frame.minY, frame.maxY - size.height)))
  }

  private static func screen(containing origin: NSPoint) -> NSScreen? {
    NSScreen.screens.first { $0.frame.contains(origin) }
  }

  private static func screen(containing frame: NSRect) -> NSScreen? {
    let intersectingScreens = NSScreen.screens.compactMap { screen -> (screen: NSScreen, area: CGFloat)? in
      let intersection = screen.frame.intersection(frame)
      guard !intersection.isNull, intersection.width > 0, intersection.height > 0 else {
        return nil
      }
      return (screen, intersection.width * intersection.height)
    }
    return intersectingScreens.max { left, right in left.area < right.area }?.screen
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

  private static func readStoredOrigin() -> NSPoint? {
    guard
      let value = UserDefaults.standard.dictionary(forKey: storageKey),
      let x = value["x"] as? Double,
      let y = value["y"] as? Double
    else {
      return nil
    }
    return NSPoint(x: x, y: y)
  }

  private static func storeOrigin(_ origin: NSPoint) {
    var value = storedOverlayStateDictionary()
    value["x"] = origin.x
    value["y"] = origin.y
    UserDefaults.standard.set(value, forKey: storageKey)
  }

  private static func anchorSide(for frame: NSRect) -> AnchorSide {
    let screen = screen(containing: frame) ?? defaultScreen()
    return frame.midX <= screen.frame.midX ? .left : .right
  }

  private static func edgeAnchoredSide(for frame: NSRect, current: AnchorSide) -> AnchorSide {
    guard let screen = screen(containing: frame) ?? defaultScreenOptional() else {
      return current
    }
    let distanceToLeft = abs(frame.minX - screen.frame.minX)
    let distanceToRight = abs(screen.frame.maxX - frame.maxX)
    let isNearLeft = distanceToLeft <= edgeAnchorSwitchDistance
    let isNearRight = distanceToRight <= edgeAnchorSwitchDistance
    /**
     CDXC:PetOverlay 2026-05-21-02:19:
     Alignment should only switch when the user drags the pet to, or very near,
     the left or right edge of the monitor the panel is on. Ordinary movement
     within the monitor preserves the previous left/right alignment so the pet
     does not flip sides while being repositioned.
     */
    switch (isNearLeft, isNearRight) {
    case (true, true):
      return distanceToLeft <= distanceToRight ? .left : .right
    case (true, false):
      return .left
    case (false, true):
      return .right
    case (false, false):
      return current
    }
  }

  private static func readStoredAnchorSide() -> AnchorSide? {
    guard let rawSide = storedOverlayStateDictionary()["anchorSide"] as? String else {
      return nil
    }
    return AnchorSide(rawValue: rawSide)
  }

  private static func storeAnchorSide(_ anchorSide: AnchorSide) {
    var value = storedOverlayStateDictionary()
    value["anchorSide"] = anchorSide.rawValue
    UserDefaults.standard.set(value, forKey: storageKey)
  }

  private static func readStoredActivitiesVisible() -> Bool? {
    storedOverlayStateDictionary()["activitiesVisible"] as? Bool
  }

  private static func storeActivitiesVisible(_ visible: Bool) {
    var value = storedOverlayStateDictionary()
    value["activitiesVisible"] = visible
    UserDefaults.standard.set(value, forKey: storageKey)
  }

  private static func storedOverlayStateDictionary() -> [String: Any] {
    UserDefaults.standard.dictionary(forKey: storageKey) ?? [:]
  }
}

private struct PetOverlayWebState: Encodable {
  let activities: [PetOverlayActivity]
  let activitiesVisible: Bool
  let anchorSide: String
  let enabled: Bool
  let selectedPetId: String
  let statusItems: [PetOverlayStatusItem]

  init(state: SetPetOverlayState, activitiesVisible: Bool, anchorSide: String) {
    self.activities = state.activities
    self.activitiesVisible = activitiesVisible
    self.anchorSide = anchorSide
    self.enabled = state.enabled
    self.selectedPetId = state.selectedPetId
    self.statusItems = state.statusItems
  }
}
