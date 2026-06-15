import Foundation

enum TerminalFocusDebugLog {
  private static let maxLogFileBytes: UInt64 = 25 * 1024 * 1024
  private static let maxRotatedLogFiles = 3
  private static let noisyEvents = Set([
    "nativeSidebar.postNative",
    "nativeHotkeys.appKitKeyEquivalent",
    "nativeHotkeys.appKitNoAction",
    "nativeHotkeys.appKitNoMatch",
    "nativeHotkeys.domKeyIgnored",
    "nativeWorkspace.focusedResponderIgnored",
    "nativeWorkspace.setActiveTerminalSet.applied",
    "nativeWorkspace.terminalFocused.emitted",
    "nativeSidebar.terminalFocused.applied",
    "nativeSidebar.terminalFocused.duplicateSkipped",
    "nativeWorkspace.terminalResize",
    "nativeWorkspace.focusTerminal.completed",
    "nativeWorkspace.sendTerminalEnter.sent",
    "nativeWorkspace.sendTerminalEnter.start",
    "nativeWorkspace.setActiveTerminalSet.focusSkipped",
    "nativeWorkspace.setTerminalLayout",
    "nativeWorkspace.setTerminalVisibility",
    "nativeWorkspace.windowFirstResponderChanged.nil",
    "nativeWorkspace.windowFirstResponderChanged.programmaticSkipped",
    "nativeWorkspace.writeTerminalText",
  ])
  private static let logDateFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS ZZZZ"
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = .current
    return formatter
  }()
  private static var didCreateLogsDirectory = false

  /**
   CDXC:NativeTerminalFocus 2026-05-08-16:41
   Split Ghostty focus debugging must land in a completely separate
   app storage logs file. These native entries record AppKit first-responder
   state only when debugging mode is enabled, with routine focus/layout/hotkey
   events suppressed so normal terminal use cannot generate oversized logs.

   CDXC:StartupPaneDiagnostics 2026-05-16-09:14:
   Startup pane-layout diagnostics must be available even when a restart-time
   tab/split restore bug happens before Debugging Mode is enabled. Use the
   nativePaneLayoutStartup prefix for those one-shot breadcrumbs while keeping
   the existing forced-repro and Settings-controlled logging paths intact.
   */
  static func append(event: String, details: [String: Any] = [:], force: Bool = false) {
    /**
     CDXC:Diagnostics 2026-05-16-07:23:
     Forced terminal-focus entries may bypass noisy-event suppression during a
     focused repro. Startup pane breadcrumbs use the same forced write path and
     a distinct prefix so they can be found after a restart-time layout restore
     issue without broadening routine focus logging.

     CDXC:Diagnostics 2026-06-06-07:09:
     Forced native diagnostics are still regular logging unless the event is
     warning/error/failure-like. Do not write routine forced/startup entries
     when Debugging Mode is off, so normal app use only persists warnings,
     errors, exceptions, and crashes.

     CDXC:TerminalImagePaste 2026-06-11-19:12:
     Terminal file/image drag-drop support and its forced normal-mode diagnostic
     bypass were removed. Keep normal-mode native logging limited to important
     diagnostics.

     CDXC:Diagnostics 2026-06-15-18:39:
     Normal app use must not persist stale repro breadcrumbs such as hotkey
     navigation traces or routine missing-session focus probes. Debugging Mode
     can still write targeted forced traces, but Debugging Mode off writes only
     warning/error/failure-class events.
     */
    let isStartupPaneLayoutEvent = event.hasPrefix("nativePaneLayoutStartup.")
    let isImportantDiagnostic = isNativePersistentLogImportantDiagnostic(event)
    guard isImportantDiagnostic || (NativeDebugLogging.isEnabled && (force || isStartupPaneLayoutEvent || !noisyEvents.contains(event))) else {
      return
    }
    let logsDirectory = GhostexAppStorage.logsDirectory
    let logURL = logsDirectory.appendingPathComponent("native-terminal-focus-debug.log")

    var payload = details
    payload["event"] = event
    let serializedPayload = serialize(NativeLogPrivacy.sanitizePayload(payload))
    let line = "[\(logDateFormatter.string(from: Date()))] \(serializedPayload)\n"

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
      NSLog("failed to write terminal focus debug log: \(NativeLogPrivacy.sanitizeLogLine(error.localizedDescription))")
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
    /*
     CDXC:NativeTerminalFocus 2026-06-01-15:08:
     Terminal focus diagnostics are intentionally low-volume, but forced repro paths can still run for long sessions. Enforce the same 25 MB/three-file rotation at the native writer so focus debugging cannot create GB-scale logs.
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

func nullableLogString(_ value: String?) -> Any {
  value ?? NSNull()
}

func isNativePersistentLogImportantDiagnostic(_ event: String) -> Bool {
  /*
   CDXC:Diagnostics 2026-06-06-07:09:
   Persistent native logs should stay quiet during normal use but still capture
   failures that support can inspect without asking users to reproduce with
   Debugging Mode already enabled. Classify only warning/error/exception-style
   event names as normal-mode writes; all routine diagnostics remain gated.

   CDXC:Diagnostics 2026-06-15-18:39:
   Missing-session, focus-trace, hotkey-repro, and pane-layout breadcrumb names
   are common during recoverable UI transitions. They are useful with Debugging
   Mode on, but they are not important warnings by themselves and must not write
   persistent logs in normal mode.

   CDXC:GxserverLogs 2026-06-15-20:39:
   The nativeSidebar.actionCrashTrace prefix is a legacy breadcrumb namespace,
   not severity. Ignore the crash word in that namespace unless the actual phase
   name is warning/error/failure-like.
  */
  let normalized = event.lowercased()
  if normalized.hasPrefix("nativesidebar.actioncrashtrace.")
    && !normalized.contains("warn")
    && !normalized.contains("error")
    && !normalized.contains("exception")
    && !normalized.contains("fatal")
    && !normalized.contains("panic")
    && !normalized.contains("fail")
    && !normalized.contains("invalid")
    && !normalized.contains("timeout")
    && !normalized.contains("exhausted")
    && !normalized.contains("rejected")
    && !normalized.contains("unhealthy")
    && !normalized.contains("portbusy")
  {
    return false
  }
  return (
    normalized.contains("warn")
      || normalized.contains("error")
      || normalized.contains("exception")
      || normalized.contains("fatal")
      || normalized.contains("panic")
      || normalized.contains("fail")
      || normalized.contains("invalid")
      || normalized.contains("timeout")
      || normalized.contains("exhausted")
      || normalized.contains("rejected")
      || normalized.contains("crash")
      || normalized.contains("unhealthy")
      || normalized.contains("portbusy")
  )
}

enum NativeLogPrivacy {
  private static let redactedText = "[redacted]"
  private static let redactedPath = "[redacted:path]"
  private static let redactedURL = "[redacted:url]"
  private static let redactedSecret = "[redacted:secret]"

  /*
   CDXC:DiagnosticsPrivacy 2026-05-30-23:56:
   Users must be able to zip and send Ghostex diagnostic log files without exposing project names, session titles, workspace paths, browser URLs with private query strings, command text, terminal text, or credentials. Sanitize all file-backed native log payloads and the remaining native system-log diagnostics at the writer boundary so individual call sites can keep logging useful IDs, counts, phases, and geometry without leaking user content.

   CDXC:DiagnosticsPrivacy 2026-06-11-19:12:
   Terminal image insertion is paste-only after removing drag/drop support, but future diagnostics can still accidentally include generated Markdown content. Treat content-like keys as user text and redact them at the writer boundary.
   */
  static func sanitizePayload(_ payload: [String: Any]) -> [String: Any] {
    var sanitized: [String: Any] = [:]
    for (key, value) in payload {
      sanitized[key] = sanitizeValue(value, key: key)
    }
    return sanitized
  }

  static func sanitizeLogLine(_ message: String) -> String {
    redactSensitiveText(message)
  }

  private static func sanitizeValue(_ value: Any, key: String) -> Any {
    if value is NSNull {
      return value
    }

    let normalizedKey = key.lowercased()
    if let string = value as? String {
      return sanitizeString(string, key: normalizedKey)
    }
    if let number = value as? NSNumber {
      /*
       CDXC:ModeSwitcherDiagnostics 2026-06-15-00:21:
       JSONSerialization gives booleans and small numbers to Swift as NSNumber.
       Preserve real numeric telemetry such as elapsedMs, counts, and exit codes
       instead of logging 0/1 as false/true, while still keeping actual
       CFBoolean values as booleans.
       */
      if CFGetTypeID(number) == CFBooleanGetTypeID() {
        return number.boolValue
      }
      return number
    }
    if let bool = value as? Bool {
      return bool
    }
    if let array = value as? [Any] {
      if isSensitiveCollectionKey(normalizedKey) {
        return ["count": array.count, "redacted": true] as [String: Any]
      }
      return array.map { sanitizeValue($0, key: key) }
    }
    if let dictionary = value as? [String: Any] {
      if isSensitiveCollectionKey(normalizedKey) {
        return ["redacted": true] as [String: Any]
      }
      return sanitizePayload(dictionary)
    }

    return redactSensitiveText(String(describing: value))
  }

  private static func sanitizeString(_ value: String, key: String) -> Any {
    if key == "event" || key == "phase" || key == "reason" || key == "kind" || key == "type" {
      return redactSensitiveText(value)
    }
    if isSecretKey(key) {
      return redactedSecret
    }
    if isIdentifierKey(key), isSafeIdentifier(value) {
      return value
    }
    if isURLKey(key) || looksLikeURL(value) {
      return summarizeURL(value)
    }
    if isPathKey(key) || looksLikePath(value) {
      return redactedPath
    }
    if isSensitiveTextKey(key) {
      return redactedText
    }
    return redactSensitiveText(value)
  }

  private static func summarizeURL(_ value: String) -> [String: Any] {
    guard let components = URLComponents(string: value) else {
      return ["redacted": true, "type": "url"]
    }
    var summary: [String: Any] = [
      "redacted": true,
      "type": "url",
    ]
    if let scheme = components.scheme {
      summary["protocol"] = scheme
    }
    if let host = components.host {
      summary["host"] = components.port.map { "\(host):\($0)" } ?? host
    }
    return summary
  }

  private static func redactSensitiveText(_ value: String) -> String {
    var redacted = value
    redacted = redacted.replacingOccurrences(
      of:
        #"(?i)"(title|name|projectName|sessionName|cwd|path|projectPath|workspaceRoot|worktreePath|url|input|comment|description|command|text|message|details|token|authToken|bearer|credential|password|secret)"\s*:\s*"[^"]*""#,
      with: #""$1":"[redacted]""#,
      options: .regularExpression)
    redacted = redacted.replacingOccurrences(
      of: #"(?i)\b(bearer|token|authorization|password|secret|credential)=?[^\s"']+"#,
      with: redactedSecret,
      options: .regularExpression)
    redacted = redacted.replacingOccurrences(
      of: #"https?://[^\s"')]+"#,
      with: redactedURL,
      options: .regularExpression)
    redacted = redacted.replacingOccurrences(
      of: #"(~|/Users/[^\s/"']+|/(private/)?tmp|/var/folders|/Volumes)/[^\s"']+"#,
      with: redactedPath,
      options: .regularExpression)
    return redacted
  }

  private static func isIdentifierKey(_ key: String) -> Bool {
    key == "id" || key.hasSuffix("id") || key.hasSuffix("ids") || key.hasSuffix("ref")
      || key.hasSuffix("refs")
  }

  private static func isSafeIdentifier(_ value: String) -> Bool {
    value.range(of: #"^[A-Za-z0-9._:-]{1,128}$"#, options: .regularExpression) != nil
  }

  private static func isSecretKey(_ key: String) -> Bool {
    key.contains("token") || key.contains("bearer") || key.contains("secret")
      || key.contains("credential") || key.contains("password") || key.contains("cookie")
      || key.contains("authorization") || key.contains("auth")
  }

  private static func isURLKey(_ key: String) -> Bool {
    key == "url" || key.hasSuffix("url") || key.contains("uri") || key == "href"
      || key == "origin"
  }

  private static func isPathKey(_ key: String) -> Bool {
    key == "path" || key == "cwd" || key.hasSuffix("path") || key.hasSuffix("dir")
      || key.hasSuffix("directory") || key.hasSuffix("root") || key.hasSuffix("file")
      || key.hasSuffix("filename") || key.contains("workspace")
  }

  private static func isSensitiveTextKey(_ key: String) -> Bool {
    key == "title" || key.hasSuffix("title") || key == "name" || key.hasSuffix("name")
      || key == "message" || key == "details" || key.hasSuffix("details") || key == "input"
      || key == "text" || key.hasSuffix("text") || key == "content" || key.hasSuffix("content")
      || key == "comment" || key == "description" || key == "label" || key == "command"
      || key.hasSuffix("command") || key == "stdout" || key == "stderr" || key == "body"
      || key.hasSuffix("body")
  }

  private static func isSensitiveCollectionKey(_ key: String) -> Bool {
    key == "args" || key.hasSuffix("args") || key == "arguments" || key.hasSuffix("arguments")
  }

  private static func looksLikeURL(_ value: String) -> Bool {
    value.range(of: #"^https?://"#, options: [.regularExpression, .caseInsensitive]) != nil
  }

  private static func looksLikePath(_ value: String) -> Bool {
    value.range(
      of: #"^(~/|/Users/|/Volumes/|/private/|/tmp/|/var/folders/)"#,
      options: .regularExpression) != nil
  }
}
