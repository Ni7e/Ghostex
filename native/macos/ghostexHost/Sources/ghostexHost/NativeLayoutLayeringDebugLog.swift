import Foundation

enum NativeLayoutLayeringDebugLog {
  private static let maxLogFileBytes: UInt64 = 25 * 1024 * 1024
  private static let maxRotatedLogFiles = 3
  private static let logDateFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS ZZZZ"
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = .current
    return formatter
  }()
  private static var didCreateLogsDirectory = false

  /**
   CDXC:WorkspaceLayeringDiagnostics 2026-05-28-04:36:
   Browser/editor pane click-through bugs need layout synthesis, AppKit
   hit-test, and visible-surface ordering in one log that is separate from
   terminal focus diagnostics. Keep ordinary entries behind Debugging Mode, and
   use the shared important-diagnostic classifier for normal-mode failures.

   CDXC:WorkspaceLayeringDiagnostics 2026-06-06-07:09:
   Layout/layering diagnostics were able to grow into hundreds of MB. Enforce
   the app-wide normal-mode logging rule at the writer: only important
   warning/error/failure-like events persist with Debugging Mode off, and all
   writes rotate at 25 MB with three retained files.

   CDXC:Diagnostics 2026-06-15-18:39:
   Forced layout/startup breadcrumbs are useful during active debugging but are
   not normal-mode warnings by themselves. They must wait for Debugging Mode
   unless the event name is failure-classified.
   */
  static func append(event: String, details: [String: Any] = [:], force: Bool = false) {
    let isImportantDiagnostic = isNativePersistentLogImportantDiagnostic(event)
    guard isImportantDiagnostic || NativeDebugLogging.isEnabled else {
      return
    }
    let logsDirectory = GhostexAppStorage.logsDirectory
    let logURL = logsDirectory.appendingPathComponent("native-layout-layering-debug.log")

    var payload = details
    payload["event"] = event
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
      NSLog("failed to write native layout/layering debug log: \(NativeLogPrivacy.sanitizeLogLine(error.localizedDescription))")
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
