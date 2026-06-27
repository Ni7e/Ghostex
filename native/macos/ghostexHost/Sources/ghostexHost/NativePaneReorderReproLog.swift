import Foundation

enum NativePaneReorderReproLog {
  private static let logDateFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS ZZZZ"
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = .current
    return formatter
  }()
  private static var didCreateLogsDirectory = false

  /**
   CDXC:NativePaneReorderDiagnostics 2026-05-11-08:33
   Bottom-edge terminal selection can still be misclassified as pane reordering.
   Keep this issue in a dedicated shared logs file so repro timestamps can be
   isolated from normal focus, sidebar, T3, and browser diagnostics. Honor the
   native.pane.reorder scenario so routine pane use does not write persistent
   logs.

   CDXC:GxserverLogs 2026-06-15-20:39:
   Pane reorder and pane-tab diagnostics are intentionally available while their
   scenarios are enabled, but long debug sessions must still stay bounded in
   support bundles. Rotate at the shared 25 MB/three-file limit before appends.
  */
  static func append(event: String, details: [String: Any] = [:]) {
    guard NativeDiagnosticLogging.isScenarioEnabled(.nativePaneReorder) else {
      return
    }
    let logsDirectory = GhostexAppStorage.sharedRootDirectory.appendingPathComponent(
      "logs", isDirectory: true)
    let logURL = logsDirectory.appendingPathComponent("native-pane-reorder-repro.log")

    var payload = details
    payload["event"] = event
    let line = "[\(logDateFormatter.string(from: Date()))] \(serialize(NativeLogPrivacy.sanitizePayload(payload)))\n"

    do {
      if !didCreateLogsDirectory {
        try FileManager.default.createDirectory(at: logsDirectory, withIntermediateDirectories: true)
        didCreateLogsDirectory = true
      }
      try NativePaneReproLogRotation.rotateIfNeeded(logURL: logURL, incomingByteCount: UInt64(line.lengthOfBytes(using: .utf8)))
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
      NSLog("failed to write native pane reorder repro log: \(NativeLogPrivacy.sanitizeLogLine(error.localizedDescription))")
    }
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
}

enum NativePaneTabDragReproLog {
  private static let highVolumeSampleInterval: TimeInterval = 5
  private static let sampledEvents = Set([
    "nativePaneResize.handle.cursorUpdate",
    "nativePaneResize.handle.mouseDragged",
    "nativePaneResize.handles.layering",
    "nativePaneResize.projectEditorCompanion.dragged",
    "nativePaneTabs.button.mouseDragged",
    "nativePaneTabs.geometry.layout",
    "nativePaneTabs.root.hitTest.titleBarPrepass",
    "nativeSidebarResize.handle.cursorRefresh",
    "nativeSidebarResize.handle.resetCursorRects",
    "serializationFailed",
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

  /**
   CDXC:PaneTabs 2026-05-11-08:33
   Native pane-tab click and drag failures need a feature-specific diagnostics
   file that covers the window monitor, title-bar hit testing, tab button mouse
   handlers, and host-event sends. Gate the file behind the native.pane.tabs
   scenario so normal tab use never writes persistent logs.

   CDXC:PaneTabs 2026-05-15-09:37
   Pane-tab height regressions need the same log stream as click and drag
   diagnostics so one repro captures both geometry and event ownership. Layout
   callers should dedupe snapshots before writing because AppKit can relayout
   title bars repeatedly during one visible resize.

   CDXC:GxserverLogs 2026-06-15-20:39:
   native-pane-tabs-debug can be high-volume while the native.pane.tabs scenario is enabled.
   Keep the diagnostics, but rotate the file at the same support-bundle limit
   as other native debug logs.
  */
  static func append(event: String, details: [String: Any] = [:]) {
    guard NativeDiagnosticLogging.isScenarioEnabled(.nativePaneTabs) else {
      return
    }
    let logsDirectory = GhostexAppStorage.sharedRootDirectory.appendingPathComponent(
      "logs", isDirectory: true)
    let logURL = logsDirectory.appendingPathComponent("native-pane-tabs-debug.log")

    var payload = details
    payload["event"] = event
    /*
     CDXC:PaneTabs 2026-06-16-12:22:
     Pane-tab, resize-rail, and sidebar-divider diagnostics can fire from cursor rect resets, mouse drags, and relayout loops while the native.pane.tabs scenario is left on. Sample those repeated event names in the shared writer and include suppressed counts on the next emitted line so long repros stay readable.
     */
    if !shouldWriteSampledLogEvent(
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
      try NativePaneReproLogRotation.rotateIfNeeded(logURL: logURL, incomingByteCount: UInt64(line.lengthOfBytes(using: .utf8)))
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
      NSLog("failed to write native pane tab drag repro log: \(NativeLogPrivacy.sanitizeLogLine(error.localizedDescription))")
    }
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
}

private enum NativePaneReproLogRotation {
  private static let maxLogFileBytes: UInt64 = 25 * 1024 * 1024
  private static let maxRotatedLogFiles = 3

  static func rotateIfNeeded(logURL: URL, incomingByteCount: UInt64) throws {
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
      let destination = rotatedLogURL(logURL, index: index + 1)
      if manager.fileExists(atPath: source.path) {
        try manager.moveItem(at: source, to: destination)
      }
    }
    let firstRotation = rotatedLogURL(logURL, index: 1)
    if manager.fileExists(atPath: firstRotation.path) {
      try manager.removeItem(at: firstRotation)
    }
    if manager.fileExists(atPath: logURL.path) {
      try manager.moveItem(at: logURL, to: firstRotation)
    }
  }

  private static func rotatedLogURL(_ logURL: URL, index: Int) -> URL {
    logURL.deletingLastPathComponent().appendingPathComponent("\(logURL.lastPathComponent).\(index)")
  }
}
