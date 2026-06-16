import Foundation

enum SidebarRefreshDebugLog {
  private static let maxLogFileBytes: UInt64 = 25 * 1024 * 1024
  private static let maxRotatedLogFiles = 3
  private static let highVolumeSampleInterval: TimeInterval = 5
  private static let sampledEvents = Set([
    "messageApplied",
    "messageReceived",
    "nativeSidebar.gxserver.presentationActivity.localFirst",
    "nativeSidebar.gxserver.presentationDelta.applied",
    "nativeSidebar.gxserver.presentationDelta.sidebarPatch",
    "nativeSidebar.gxserver.presentationLifecycle.localFirst",
    "nativeSidebar.gxserver.presentationPaneChrome.applied",
    "nativeSidebar.gxserver.presentationProject.materializeSkipped",
    "nativeSidebar.gxserver.presentationProject.materialized",
    "nativeSidebar.gxserver.status",
    "nativeSidebar.remoteGxserver.presentationDelta.applied",
    "nativeSidebar.remoteGxserver.presentationLifecycle.localFirst",
    "renderStateChanged",
    "sidebar.refresh.messageApplied",
    "sidebar.refresh.messageReceived",
    "sidebar.refresh.renderStateChanged",
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
   CDXC:SidebarRefreshDiagnostics 2026-05-11-12:32
   Unexpected sidebar refresh repros need a dedicated app-storage log that
   records native action boundaries and React sidebar lifecycle events. Honor
   Settings Debugging Mode here as the final gate so no persistent sidebar
   refresh diagnostics are written during normal app use.

   CDXC:SidebarRefreshDiagnostics 2026-06-06-07:09:
   Routine sidebar refresh diagnostics stay Debugging Mode only, but
   warning/error/failure-like refresh events should persist in normal mode so
   support can diagnose crashes and failed refreshes without enabling broad
   disk logging first.
   */
  static func append(event: String, details: String?) {
    guard isNativePersistentLogImportantDiagnostic(event) || NativeDebugLogging.isEnabled else {
      return
    }
    let logsDirectory = GhostexAppStorage.logsDirectory
    let logURL = logsDirectory.appendingPathComponent("sidebar-refresh-debug.log")
    var payload: [String: Any] = [
      "details": parseDetailsPayload(details),
      "event": event,
    ]
    /*
     CDXC:SidebarRefreshDiagnostics 2026-06-16-12:22:
     Sidebar refresh logs must stay useful when Debugging Mode is left on. Sample message/render/presentation-delta events at the Swift writer boundary, including the prefixed `sidebar.refresh.*` names used by the React sidebar, so every caller shares the same support-bundle line cap behavior.
     */
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
      NSLog("failed to write sidebar refresh debug log: \(NativeLogPrivacy.sanitizeLogLine(error.localizedDescription))")
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

  private static func parseDetailsPayload(_ details: String?) -> Any {
    guard let details, let data = details.data(using: .utf8) else {
      return NSNull()
    }
    /*
     CDXC:GxserverPresentationDiagnostics 2026-06-04-19:39:
     React sends sidebar-refresh details as a JSON string, but sanitizer policy redacts raw `details` strings by design. Parse structured details at the writer boundary before privacy sanitization so targeted gxserver/sidebar/native-tab mismatch counts remain inspectable without allowing titles, paths, URLs, command text, or secrets through as free-form log text.
     */
    return (try? JSONSerialization.jsonObject(with: data)) ?? details
  }

  private static func rotateLogIfNeeded(logURL: URL, incomingByteCount: UInt64) throws {
    /*
     CDXC:SidebarRefreshDiagnostics 2026-06-01-15:08:
     Sidebar refresh diagnostics must stay useful without becoming a second memory/lag source. Cap the native writer at 25 MB with three rotations so repeated render/message events cannot grow this debug file to hundreds of MB or GB.
     */
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
    try manager.moveItem(at: logURL, to: firstRotation)
  }

  private static func rotatedLogURL(_ logURL: URL, index: Int) -> URL {
    logURL.deletingLastPathComponent().appendingPathComponent("\(logURL.lastPathComponent).\(index)")
  }
}
