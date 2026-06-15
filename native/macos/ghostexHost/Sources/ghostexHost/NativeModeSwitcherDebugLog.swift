import Foundation

enum NativeModeSwitcherDebugLog {
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

  /*
   CDXC:ModeSwitcherDiagnostics 2026-06-15-00:21:
   Agents, Source, Browser, and Kanban switching lag needs one dedicated support-bundle log so the titlebar click, sidebar route, native layout sync, and AppKit settle timings can be correlated without mixing them into session-title or terminal-focus diagnostics.
   Keep routine breadcrumbs behind Settings Debugging Mode, write under ~/.ghostex/logs, rotate at the shared 25 MB/three-file limit, and sanitize structured payloads at the writer boundary so project names, paths, URLs, titles, commands, and user text cannot reach disk.
   */
  static func append(event: String, details: [String: Any] = [:], force: Bool = false) {
    let isImportantDiagnostic = isNativePersistentLogImportantDiagnostic(event)
    guard isImportantDiagnostic || NativeDebugLogging.isEnabled else {
      return
    }
    let logsDirectory = GhostexAppStorage.logsDirectory
    let logURL = logsDirectory.appendingPathComponent("native-mode-switcher-debug.log")

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
      NSLog("failed to write native mode-switcher debug log: \(NativeLogPrivacy.sanitizeLogLine(error.localizedDescription))")
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
