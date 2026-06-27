import Foundation
import OSLog

enum PromptEditorDebugLog {
  private static let logger = Logger(
    subsystem: "com.madda.ghostex.host", category: "prompt-editor-debug")
  private static let logDateFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS ZZZZ"
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = .current
    return formatter
  }()
  private static var didCreateLogsDirectory = false

  /**
  CDXC:PromptEditor 2026-05-19-11:20:
  Prompt-editor caret and click failures need a dedicated app-storage log file
  gated by the native.prompt.editor scenario. Record Monaco init, native child-window
  frame state, modal-host visibility, and prewarm timing so repros can be
  correlated by timestamp without mixing into agent-detection or terminal-focus
  logs.

  CDXC:DiagnosticsSettings 2026-06-27-22:07:
  Prompt-editor routine breadcrumbs now require the native.prompt.editor
  scenario instead of broad Debugging Mode, while the writer still sanitizes
  payloads at the file boundary.
   */
  static func append(event: String, details: [String: Any] = [:]) {
    guard NativeDiagnosticLogging.isScenarioEnabled(.nativePromptEditor) else {
      return
    }
    let logsDirectory = GhostexAppStorage.logsDirectory
    let logURL = logsDirectory.appendingPathComponent("native-prompt-editor-debug.log")

    var payload = details
    payload["event"] = event
    payload["source"] = payload["source"] ?? "native"
    let line = "[\(logDateFormatter.string(from: Date()))] \(serialize(NativeLogPrivacy.sanitizePayload(payload)))\n"

    do {
      if !didCreateLogsDirectory {
        try FileManager.default.createDirectory(at: logsDirectory, withIntermediateDirectories: true)
        didCreateLogsDirectory = true
      }
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
      logger.warning("failed to write prompt editor debug log: \(sanitizedError)")
    }
  }

  static func append(event: String, details: String?) {
    if let details, !details.isEmpty {
      append(event: event, details: ["details": details])
    } else {
      append(event: event)
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
