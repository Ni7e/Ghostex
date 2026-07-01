import Darwin
import Foundation
import OSLog

/**
 Always-on crash diagnostics for the support bundle.

 Users report crashes without Debugging Mode enabled, so everything here runs
 unconditionally and lands under `~/.ghostex/logs/crashes/` where the standard
 "zip your logs folder" support flow already picks it up.

 The process already has a crash handler: the embedded Ghostty initializes
 sentry-native, which captures native crashes (Swift/Zig/CEF alike) as local
 `.ghosttycrash` envelopes under the Ghostty XDG state directory. macOS
 additionally writes `.ips` reports to `~/Library/Logs/DiagnosticReports` for
 the app and its helper processes. Neither location is part of the support
 bundle, so this type harvests both into the crashes folder on launch.

 What each artifact means when triaging a report:
 - `*.ghosttycrash` — the verbatim Sentry envelope. Its crashpad backend puts
   the thread stacks in the envelope's minidump attachment, not in the event
   JSON, and crashpad also suppresses the macOS `.ips` report for the crash it
   handled — so the full envelope is frequently the only record of a native
   crash and must always be harvested whole.
 - `*.crash-event.json` — the event item extracted from the same envelope for
   quick triage: release, breadcrumbs, contexts, and binary images. It outlives
   the larger envelopes under retention but does not contain stacks.
 - `*.ips` / `*.crash` — verbatim macOS crash reports for Ghostex,
   `ghostex Helper` (CEF), `gxserver`, and `zmx`.
 - `uncaught-nsexception-*.log` — ObjC exception name plus call stack written
   by our NSUncaughtExceptionHandler before the process dies. The exception
   reason string is deliberately not logged; it can embed user text.
 - `session.marker.json` — present while the app runs; a marker that survives
   into the next launch means the previous run did not exit cleanly.
 - `main-thread-heartbeat.json` — rewritten every few seconds from the main
   thread. After an unclean exit, a stale heartbeat with no matching crash
   artifact means the app was hung and the user force-quit it; a fresh
   heartbeat with a crash artifact means a genuine sudden crash.
 - `crash-reports.jsonl` — sanitized index of launches, unclean-exit
   detections, and harvested artifacts for timestamp correlation with the
   other logs in the support bundle.
 */
enum NativeCrashDiagnostics {
  private static let logger = Logger(
    subsystem: "com.madda.ghostex.host", category: "crash-diagnostics")
  private static let ioQueue = DispatchQueue(
    label: "com.madda.ghostex.crash-diagnostics", qos: .utility)
  private static let isoFormatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }()

  private static let heartbeatInterval: TimeInterval = 5
  private static let harvestStartupDelay: TimeInterval = 5
  private static let maxHarvestSourceAge: TimeInterval = 30 * 24 * 60 * 60
  private static let maxCrashEventFiles = 10
  private static let maxFullEnvelopeFiles = 8
  private static let maxSystemReportFiles = 10
  private static let maxUncaughtExceptionFiles = 5
  private static let maxRememberedHarvestedNames = 400
  private static let indexLogMaxBytes: UInt64 = 5 * 1024 * 1024

  private static var heartbeatTimer: Timer?
  private static var previousUncaughtExceptionHandler: (@convention(c) (NSException) -> Void)?

  private static var crashesDirectory: URL {
    GhostexAppStorage.logsDirectory.appendingPathComponent("crashes", isDirectory: true)
  }

  private static var indexLogURL: URL {
    crashesDirectory.appendingPathComponent("crash-reports.jsonl")
  }

  private static var sessionMarkerURL: URL {
    crashesDirectory.appendingPathComponent("session.marker.json")
  }

  private static var heartbeatURL: URL {
    crashesDirectory.appendingPathComponent("main-thread-heartbeat.json")
  }

  private static var harvestStateURL: URL {
    crashesDirectory.appendingPathComponent("harvest-state.json")
  }

  /// Metadata files that retention and harvesting must never treat as artifacts.
  private static var protectedFileNames: Set<String> {
    [
      indexLogURL.lastPathComponent,
      "\(indexLogURL.lastPathComponent).1",
      sessionMarkerURL.lastPathComponent,
      heartbeatURL.lastPathComponent,
      harvestStateURL.lastPathComponent,
    ]
  }

  // MARK: - Lifecycle

  /// Call once, early in applicationDidFinishLaunching, on the main thread.
  static func beginLaunchSession() {
    ensureCrashesDirectory()
    reportPreviousRunOutcome()
    writeSessionMarker()
    installUncaughtExceptionHandler()
    startHeartbeat()
    ioQueue.asyncAfter(deadline: .now() + harvestStartupDelay) {
      harvestCrashArtifacts()
    }
  }

  /// Call from applicationWillTerminate. A crash or SIGKILL skips this, which
  /// is exactly what leaves the marker behind for unclean-exit detection.
  static func markCleanExit() {
    heartbeatTimer?.invalidate()
    heartbeatTimer = nil
    try? FileManager.default.removeItem(at: sessionMarkerURL)
    appendIndexEvent("appExitedCleanly", details: [:])
    // The process exits as soon as applicationWillTerminate returns; drain the
    // serial writer queue so the clean-exit line reaches disk.
    ioQueue.sync {}
  }

  private static func ensureCrashesDirectory() {
    do {
      try FileManager.default.createDirectory(
        at: crashesDirectory, withIntermediateDirectories: true)
    } catch {
      let sanitizedError = NativeLogPrivacy.sanitizeLogLine(error.localizedDescription)
      logger.warning("failed to create crashes directory: \(sanitizedError)")
    }
  }

  private static func reportPreviousRunOutcome() {
    guard let markerData = try? Data(contentsOf: sessionMarkerURL),
      let marker = (try? JSONSerialization.jsonObject(with: markerData)) as? [String: Any]
    else {
      appendIndexEvent("appLaunched", details: ["previousRunEndedCleanly": true])
      return
    }
    let previousPid = marker["pid"] as? Int ?? -1
    if previousPid > 0, kill(pid_t(previousPid), 0) == 0 {
      // Another live instance owns the marker; do not misreport it as a crash.
      appendIndexEvent(
        "appLaunched",
        details: ["previousRunMarkerPidStillRunning": true])
      return
    }
    var details: [String: Any] = [
      "previousRunEndedCleanly": false,
      "previousPid": previousPid,
      "previousVersion": marker["version"] as? String ?? "unknown",
      "previousStartedAt": marker["startedAt"] as? String ?? "unknown",
    ]
    if let heartbeatData = try? Data(contentsOf: heartbeatURL),
      let heartbeat = (try? JSONSerialization.jsonObject(with: heartbeatData)) as? [String: Any],
      let lastHeartbeatAt = heartbeat["at"] as? String
    {
      details["previousLastHeartbeatAt"] = lastHeartbeatAt
      if let lastHeartbeatDate = isoFormatter.date(from: lastHeartbeatAt) {
        details["previousLastHeartbeatAgeSeconds"] =
          Int(Date().timeIntervalSince(lastHeartbeatDate))
      }
    }
    appendIndexEvent("previousRunEndedUnclean", details: details)
    appendIndexEvent("appLaunched", details: ["previousRunEndedCleanly": false])
  }

  private static func writeSessionMarker() {
    let marker: [String: Any] = [
      "pid": Int(ProcessInfo.processInfo.processIdentifier),
      "version": appVersion(),
      "startedAt": isoFormatter.string(from: Date()),
    ]
    writeJSONObject(marker, to: sessionMarkerURL, label: "session marker")
  }

  private static func startHeartbeat() {
    writeHeartbeat()
    // Scheduled on the main run loop in .common mode on purpose: the heartbeat
    // must stop exactly when the main thread stops servicing events, so a
    // stale heartbeat after an unclean exit is evidence of a hang.
    let timer = Timer(timeInterval: heartbeatInterval, repeats: true) { _ in
      writeHeartbeat()
    }
    RunLoop.main.add(timer, forMode: .common)
    heartbeatTimer = timer
  }

  private static func writeHeartbeat() {
    let heartbeat: [String: Any] = [
      "pid": Int(ProcessInfo.processInfo.processIdentifier),
      "at": isoFormatter.string(from: Date()),
    ]
    writeJSONObject(heartbeat, to: heartbeatURL, label: "heartbeat")
  }

  // MARK: - Uncaught ObjC exceptions

  private static func installUncaughtExceptionHandler() {
    previousUncaughtExceptionHandler = NSGetUncaughtExceptionHandler()
    NSSetUncaughtExceptionHandler { exception in
      NativeCrashDiagnostics.recordUncaughtException(exception)
    }
  }

  private static func recordUncaughtException(_ exception: NSException) {
    // Runs on the crashing thread moments before the process dies: write one
    // dedicated file synchronously and do not touch shared queues or handles.
    let fileName = "uncaught-nsexception-\(fileTimestamp()).log"
    let stack = exception.callStackSymbols.joined(separator: "\n")
    let contents = """
      at=\(isoFormatter.string(from: Date()))
      version=\(appVersion())
      name=\(exception.name.rawValue)
      callStack:
      \(stack)
      """
    try? contents.write(
      to: crashesDirectory.appendingPathComponent(fileName),
      atomically: true,
      encoding: .utf8)
    previousUncaughtExceptionHandler?(exception)
  }

  // MARK: - Harvest

  private static func harvestCrashArtifacts() {
    let manager = FileManager.default
    var harvestedNames = loadHarvestedNames()
    var didHarvest = false

    // Candidates are sorted oldest-first. Copy only the newest few per
    // category — a first run can face a months-old backlog of multi-megabyte
    // envelopes, and copying files retention would immediately delete is
    // wasted disk churn. Remember the skipped names so they are never
    // reconsidered.
    let envelopeCandidates = ghosttyEnvelopeCandidates(harvestedNames: harvestedNames)
    for skipped in envelopeCandidates.dropLast(maxFullEnvelopeFiles) {
      harvestedNames.append(skipped.lastPathComponent)
      didHarvest = true
    }
    for candidate in envelopeCandidates.suffix(maxFullEnvelopeFiles) {
      if harvestGhosttyEnvelope(candidate) {
        harvestedNames.append(candidate.lastPathComponent)
        didHarvest = true
      }
    }

    let reportCandidates = systemReportCandidates(harvestedNames: harvestedNames)
    for skipped in reportCandidates.dropLast(maxSystemReportFiles) {
      harvestedNames.append(skipped.lastPathComponent)
      didHarvest = true
    }
    for candidate in reportCandidates.suffix(maxSystemReportFiles) {
      let destination = crashesDirectory.appendingPathComponent(candidate.lastPathComponent)
      do {
        if manager.fileExists(atPath: destination.path) {
          try manager.removeItem(at: destination)
        }
        try manager.copyItem(at: candidate, to: destination)
        appendIndexEvent(
          "crashArtifactHarvested",
          details: [
            "source": "macosDiagnosticReport",
            "file": destination.lastPathComponent,
            "bytes": fileSize(destination),
            "sourceModifiedAt": isoFormatter.string(from: modificationDate(candidate) ?? Date()),
          ])
        harvestedNames.append(candidate.lastPathComponent)
        didHarvest = true
      } catch {
        let sanitizedError = NativeLogPrivacy.sanitizeLogLine(error.localizedDescription)
        logger.warning("failed to copy system crash report: \(sanitizedError)")
      }
    }

    if didHarvest {
      saveHarvestedNames(harvestedNames)
    }
    enforceRetention()
  }

  private static func ghosttyEnvelopeCandidates(harvestedNames: [String]) -> [URL] {
    // Matches ghostty/src/crash/dir.zig: $XDG_STATE_HOME/ghostty/crash with a
    // ~/.local/state default.
    let stateRoot: URL
    if let xdgStateHome = ProcessInfo.processInfo.environment["XDG_STATE_HOME"],
      !xdgStateHome.isEmpty
    {
      stateRoot = URL(fileURLWithPath: xdgStateHome, isDirectory: true)
    } else {
      stateRoot = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(".local/state", isDirectory: true)
    }
    let crashDir = stateRoot.appendingPathComponent("ghostty/crash", isDirectory: true)
    return freshFiles(in: crashDir, harvestedNames: harvestedNames) { url in
      url.pathExtension == "ghosttycrash"
    }
  }

  private static func systemReportCandidates(harvestedNames: [String]) -> [URL] {
    let reportsDir = FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent("Library/Logs/DiagnosticReports", isDirectory: true)
    let directories = [
      reportsDir,
      reportsDir.appendingPathComponent("Retired", isDirectory: true),
    ]
    let processPrefixes = ["ghostex", "gxserver", "zmx"]
    return directories.flatMap { directory in
      freshFiles(in: directory, harvestedNames: harvestedNames) { url in
        let name = url.lastPathComponent.lowercased()
        let ext = url.pathExtension.lowercased()
        return (ext == "ips" || ext == "crash")
          && processPrefixes.contains(where: { name.hasPrefix($0) })
      }
    }
  }

  private static func freshFiles(
    in directory: URL,
    harvestedNames: [String],
    matching isMatch: (URL) -> Bool
  ) -> [URL] {
    let manager = FileManager.default
    guard
      let entries = try? manager.contentsOfDirectory(
        at: directory,
        includingPropertiesForKeys: [.contentModificationDateKey],
        options: [.skipsHiddenFiles])
    else {
      return []
    }
    let harvested = Set(harvestedNames)
    return entries
      .filter { url in
        guard isMatch(url), !harvested.contains(url.lastPathComponent) else {
          return false
        }
        guard let modifiedAt = modificationDate(url) else {
          return false
        }
        return Date().timeIntervalSince(modifiedAt) < maxHarvestSourceAge
      }
      .sorted { (modificationDate($0) ?? .distantPast) < (modificationDate($1) ?? .distantPast) }
  }

  private static func harvestGhosttyEnvelope(_ envelopeURL: URL) -> Bool {
    guard let envelopeData = try? Data(contentsOf: envelopeURL) else {
      return false
    }
    let baseName = envelopeURL.deletingPathExtension().lastPathComponent
    let sourceModifiedAt = isoFormatter.string(from: modificationDate(envelopeURL) ?? Date())

    let envelopeDestination =
      crashesDirectory.appendingPathComponent(envelopeURL.lastPathComponent)
    do {
      try envelopeData.write(to: envelopeDestination)
    } catch {
      let sanitizedError = NativeLogPrivacy.sanitizeLogLine(error.localizedDescription)
      logger.warning("failed to copy crash envelope: \(sanitizedError)")
      return false
    }

    var eventExtracted = false
    if let eventPayload = sentryEnvelopeEventPayload(from: envelopeData) {
      let eventDestination =
        crashesDirectory.appendingPathComponent("\(baseName).crash-event.json")
      eventExtracted = (try? eventPayload.write(to: eventDestination)) != nil
    }

    appendIndexEvent(
      "crashArtifactHarvested",
      details: [
        "source": "ghosttySentryEnvelope",
        "file": envelopeDestination.lastPathComponent,
        "bytes": envelopeData.count,
        "eventExtracted": eventExtracted,
        "sourceModifiedAt": sourceModifiedAt,
      ])
    return true
  }

  /**
   Minimal Sentry envelope reader: a header line, then repeating items of one
   JSON header line followed by a payload. Payload size comes from the item
   header's `length`; when `length` is absent the payload runs to the next
   newline. Returns the payload of the first `"type":"event"` item.
   */
  private static func sentryEnvelopeEventPayload(from data: Data) -> Data? {
    let newline: UInt8 = 0x0A
    guard let envelopeHeaderEnd = data.firstIndex(of: newline) else {
      return nil
    }
    var cursor = data.index(after: envelopeHeaderEnd)
    while cursor < data.endIndex {
      guard let itemHeaderEnd = data[cursor...].firstIndex(of: newline) else {
        return nil
      }
      guard
        let itemHeader = (try? JSONSerialization.jsonObject(with: data[cursor..<itemHeaderEnd]))
          as? [String: Any]
      else {
        return nil
      }
      let payloadStart = data.index(after: itemHeaderEnd)
      let itemType = itemHeader["type"] as? String
      let payloadEnd: Data.Index
      if let length = itemHeader["length"] as? Int, length >= 0 {
        guard
          let boundedEnd = data.index(payloadStart, offsetBy: length, limitedBy: data.endIndex)
        else {
          return nil
        }
        payloadEnd = boundedEnd
      } else {
        payloadEnd = data[payloadStart...].firstIndex(of: newline) ?? data.endIndex
      }
      if itemType == "event" {
        return data.subdata(in: payloadStart..<payloadEnd)
      }
      cursor = payloadEnd
      if cursor < data.endIndex, data[cursor] == newline {
        cursor = data.index(after: cursor)
      }
    }
    return nil
  }

  // MARK: - Retention

  private static func enforceRetention() {
    prune(matching: { $0.hasSuffix(".crash-event.json") }, keepingNewest: maxCrashEventFiles)
    prune(matching: { $0.hasSuffix(".ghosttycrash") }, keepingNewest: maxFullEnvelopeFiles)
    prune(
      matching: { $0.hasSuffix(".ips") || $0.hasSuffix(".crash") },
      keepingNewest: maxSystemReportFiles)
    prune(
      matching: { $0.hasPrefix("uncaught-nsexception-") },
      keepingNewest: maxUncaughtExceptionFiles)
  }

  private static func prune(matching isMatch: (String) -> Bool, keepingNewest keepCount: Int) {
    let manager = FileManager.default
    guard
      let entries = try? manager.contentsOfDirectory(
        at: crashesDirectory,
        includingPropertiesForKeys: [.contentModificationDateKey],
        options: [.skipsHiddenFiles])
    else {
      return
    }
    let matches =
      entries
      .filter { isMatch($0.lastPathComponent) && !protectedFileNames.contains($0.lastPathComponent) }
      .sorted { (modificationDate($0) ?? .distantPast) > (modificationDate($1) ?? .distantPast) }
    for stale in matches.dropFirst(keepCount) {
      try? manager.removeItem(at: stale)
    }
  }

  // MARK: - Harvest state

  private static func loadHarvestedNames() -> [String] {
    guard let data = try? Data(contentsOf: harvestStateURL),
      let state = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
      let names = state["harvestedFileNames"] as? [String]
    else {
      return []
    }
    return names
  }

  private static func saveHarvestedNames(_ names: [String]) {
    let bounded = Array(names.suffix(maxRememberedHarvestedNames))
    writeJSONObject(["harvestedFileNames": bounded], to: harvestStateURL, label: "harvest state")
  }

  // MARK: - Writers

  private static func appendIndexEvent(_ event: String, details: [String: Any]) {
    ioQueue.async {
      var payload = NativeLogPrivacy.sanitizePayload(details)
      payload["event"] = event
      payload["at"] = isoFormatter.string(from: Date())
      guard JSONSerialization.isValidJSONObject(payload),
        let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]),
        let json = String(data: data, encoding: .utf8)
      else {
        return
      }
      appendIndexLine(json)
    }
  }

  private static func appendIndexLine(_ json: String) {
    let manager = FileManager.default
    let line = json + "\n"
    do {
      try manager.createDirectory(at: crashesDirectory, withIntermediateDirectories: true)
      rotateIndexLogIfNeeded()
      if manager.fileExists(atPath: indexLogURL.path) {
        let handle = try FileHandle(forWritingTo: indexLogURL)
        try handle.seekToEnd()
        if let data = line.data(using: .utf8) {
          try handle.write(contentsOf: data)
        }
        try handle.close()
      } else {
        try line.write(to: indexLogURL, atomically: true, encoding: .utf8)
      }
    } catch {
      let sanitizedError = NativeLogPrivacy.sanitizeLogLine(error.localizedDescription)
      logger.warning("failed to write crash reports index: \(sanitizedError)")
    }
  }

  private static func rotateIndexLogIfNeeded() {
    let manager = FileManager.default
    let size =
      (try? manager.attributesOfItem(atPath: indexLogURL.path)[.size] as? NSNumber)?
      .uint64Value ?? 0
    guard size > indexLogMaxBytes else {
      return
    }
    let rotated = crashesDirectory.appendingPathComponent(
      "\(indexLogURL.lastPathComponent).1")
    try? manager.removeItem(at: rotated)
    try? manager.moveItem(at: indexLogURL, to: rotated)
  }

  private static func writeJSONObject(_ object: [String: Any], to url: URL, label: String) {
    guard JSONSerialization.isValidJSONObject(object),
      let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    else {
      return
    }
    do {
      try data.write(to: url, options: .atomic)
    } catch {
      let sanitizedError = NativeLogPrivacy.sanitizeLogLine(error.localizedDescription)
      logger.warning("failed to write \(label): \(sanitizedError)")
    }
  }

  // MARK: - Small helpers

  private static func appVersion() -> String {
    Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown"
  }

  private static func modificationDate(_ url: URL) -> Date? {
    (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
  }

  private static func fileSize(_ url: URL) -> Int {
    (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?
      .intValue ?? 0
  }

  private static func fileTimestamp() -> String {
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd-HHmmss"
    formatter.locale = Locale(identifier: "en_US_POSIX")
    return formatter.string(from: Date())
  }
}
