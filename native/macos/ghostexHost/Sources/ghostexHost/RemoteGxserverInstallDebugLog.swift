import Foundation
import OSLog

enum RemoteGxserverInstallDebugLog {
  private static let maxLogFileBytes: UInt64 = 25 * 1024 * 1024
  private static let maxRotatedLogFiles = 3
  private static let logger = Logger(
    subsystem: "com.madda.ghostex.host", category: "remote-gxserver-install-debug")
  private static let logDateFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS ZZZZ"
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = .current
    return formatter
  }()
  private static var didCreateLogsDirectory = false

  /**
   CDXC:RemoteMachines 2026-06-30-03:05:
   Remote gxserver install crashes need a dedicated support-bundle log because
   the failure can occur between the approval modal click, sidebar command
   relay, SSH platform probe, package upload, token read, and tunnel startup.
   Persist only sanitized structured phase fields such as request ids, stable
   machine ids, booleans, durations, exit codes, byte counts, platform enums,
   internal package resource ids, and local ports. Never write remote names,
   SSH hosts/users, local or remote paths, URLs, command text, stdout/stderr,
   tokens, passwords, or raw errors.
   */
  static func append(event: String, details: [String: Any] = [:]) {
    guard isNativePersistentLogImportantDiagnostic(event) ||
      NativeDiagnosticLogging.isScenarioEnabled(.nativeRemoteGxserverInstall)
    else {
      return
    }
    let logsDirectory = GhostexAppStorage.logsDirectory
    let logURL = logsDirectory.appendingPathComponent("remote-gxserver-install-debug.log")

    var payload = details
    payload["event"] = event
    payload["source"] = payload["source"] ?? "native"
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
      let sanitizedError = NativeLogPrivacy.sanitizeLogLine(error.localizedDescription)
      logger.warning("failed to write remote gxserver install debug log: \(sanitizedError)")
    }
  }

  static func append(event: String, details: String?) {
    guard let details, !details.isEmpty else {
      append(event: event)
      return
    }
    append(event: event, details: ["details": parseDetailsPayload(details)])
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

  private static func parseDetailsPayload(_ details: String) -> Any {
    guard let data = details.data(using: .utf8) else {
      return ["detailsLength": details.count, "detailsParseFailed": true] as [String: Any]
    }
    return (try? JSONSerialization.jsonObject(with: data)) ?? [
      "detailsLength": details.count,
      "detailsParseFailed": true,
    ]
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
    if manager.fileExists(atPath: logURL.path) {
      try manager.moveItem(at: logURL, to: firstRotation)
    }
  }

  private static func rotatedLogURL(_ logURL: URL, index: Int) -> URL {
    logURL.deletingLastPathComponent().appendingPathComponent("\(logURL.lastPathComponent).\(index)")
  }
}
