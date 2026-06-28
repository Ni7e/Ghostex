import Darwin
import Foundation
import OSLog
import WebKit

enum NativeT3CodePaneReproLog {
  private static let maxLogFileBytes: UInt64 = 25 * 1024 * 1024
  private static let maxRotatedLogFiles = 3
  private static let highVolumeSampleInterval: TimeInterval = 5
  private static let logger = Logger(
    subsystem: "com.madda.ghostex.host", category: "native-t3-code-pane-repro")
  private static let noisyEvents = Set([
    "nativeSidebar.chrome.layout",
    "nativeSidebar.chrome.resize",
    "nativeWorkspace.projectEditor.dnd.nativeMonitorBypassed",
    "nativeWorkspace.projectEditor.dnd.nativeMonitorSync",
    "nativeWorkspace.projectEditor.layout.active",
    "nativeWorkspace.projectEditor.layout.end",
    "nativeWorkspace.projectEditor.layout.start",
    "nativeWorkspace.t3WebPane.layout.deferred",
    "nativeWorkspace.t3WebPane.layout.deferredPin",
  ])
  private static let sampledEvents = Set([
    "nativeWorkspace.chromiumBrowserPane.cef.internalGeometry",
    "nativeWorkspace.chromiumBrowserPane.cef.layout",
    "nativeWorkspace.chromiumBrowserPane.pageViewport",
    "nativeWorkspace.projectEditor.cef.console",
    "nativeWorkspace.projectEditor.cef.sourceDragDiagnostic",
    "nativeWorkspace.projectEditor.cef.sourceDragDiagnostic.nativeMouse",
    "nativeWorkspace.projectEditor.cef.sourceDragDiagnostics.pageProbe.injected",
    "nativeWorkspace.projectEditor.companion.sync",
    "nativeWorkspace.projectEditor.companionHiddenPreference.applied",
    "nativeWorkspace.projectEditor.companionHiddenPreference.apply",
    "nativeWorkspace.projectEditor.focus.applied",
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
   CDXC:T3Code 2026-05-08-16:41
   Native T3 Code blank-pane repros need a dedicated log file separate from
   terminal focus and sidebar lifecycle logs. Capture runtime launch, WKWebView
   navigation, HTTP response, and injected page diagnostics when the
   native.t3.codePane scenario is enabled, while dropping layout/resize
   breadcrumbs that can fire every frame during normal sidebar resizing.

   CDXC:T3Code 2026-06-06-07:09:
   T3/code-pane repro diagnostics can run for long sessions and previously had
   no file rotation. Keep routine entries behind the native.t3.codePane
   scenario, allow only important warning/error/failure-like events in normal
   mode, and rotate this support log at 25 MB with three retained files.
  */
  static func append(_ event: String, _ details: [String: Any] = [:]) {
    let isImportantDiagnostic = isNativePersistentLogImportantDiagnostic(event)
    guard isImportantDiagnostic ||
      (NativeDiagnosticLogging.isScenarioEnabled(.nativeT3CodePane) &&
        !noisyEvents.contains(event))
    else {
      return
    }
    let logsDirectory = GhostexAppStorage.logsDirectory
    let logURL = logsDirectory.appendingPathComponent("native-t3-code-pane-repro.log")

    var payload = details
    payload["event"] = event
    /*
     CDXC:T3Code 2026-06-16-12:22:
     Source CEF drag probes, console forwarding, and companion sync diagnostics are useful during repros but can repeat for every drag/mouse/layout tick. Sample these routine scenario-enabled events in the writer and include suppressed counts so support can see burst volume without 25 MB rotations per session.
     */
    if !isImportantDiagnostic,
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
      let sanitizedError = NativeLogPrivacy.sanitizeLogLine(error.localizedDescription)
      logger.warning("failed to write T3 Code pane repro log: \(sanitizedError)")
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

final class NativeT3RuntimeOutputCapture {
  private static let maxCapturedBytes = 64 * 1024
  private let lock = NSLock()
  private let stderrPipe = Pipe()
  private let stdoutPipe = Pipe()
  private var stderrData = Data()
  private var stderrTruncatedBytes = 0
  private var stdoutData = Data()
  private var stdoutTruncatedBytes = 0

  /**
   CDXC:T3Code 2026-04-30-03:18
   The gray native T3 pane repro needs the provider process stderr/stdout, not
   only the exit status. Capture bounded output from the desktop/no-browser
   launch so pairing/bootstrap failures can be diagnosed without changing the
   launch behavior or risking unbounded log growth.
   */
  func attach(to process: Process) {
    process.standardOutput = stdoutPipe
    process.standardError = stderrPipe
    stdoutPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
      self?.append(handle.availableData, stream: "stdout")
    }
    stderrPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
      self?.append(handle.availableData, stream: "stderr")
    }
  }

  func finish() -> [String: Any] {
    stdoutPipe.fileHandleForReading.readabilityHandler = nil
    stderrPipe.fileHandleForReading.readabilityHandler = nil
    return snapshot()
  }

  private func append(_ data: Data, stream: String) {
    guard !data.isEmpty else {
      return
    }
    lock.lock()
    defer { lock.unlock() }
    if stream == "stdout" {
      append(data, to: &stdoutData, truncatedBytes: &stdoutTruncatedBytes)
      return
    }
    append(data, to: &stderrData, truncatedBytes: &stderrTruncatedBytes)
  }

  private func append(_ data: Data, to target: inout Data, truncatedBytes: inout Int) {
    let availableBytes = max(Self.maxCapturedBytes - target.count, 0)
    if availableBytes > 0 {
      target.append(data.prefix(availableBytes))
    }
    if data.count > availableBytes {
      truncatedBytes += data.count - availableBytes
    }
  }

  private func snapshot() -> [String: Any] {
    lock.lock()
    defer { lock.unlock() }
    return [
      "stderr": decode(stderrData),
      "stderrBytes": stderrData.count + stderrTruncatedBytes,
      "stderrTruncatedBytes": stderrTruncatedBytes,
      "stdout": decode(stdoutData),
      "stdoutBytes": stdoutData.count + stdoutTruncatedBytes,
      "stdoutTruncatedBytes": stdoutTruncatedBytes,
    ]
  }

  private func decode(_ data: Data) -> String {
    String(data: data, encoding: .utf8) ?? "<non-utf8 \(data.count) bytes>"
  }
}

struct NativeT3RuntimeLaunch {
  let outputCapture: NativeT3RuntimeOutputCapture
  let process: Process
}

struct NativeCodeServerRuntimeLaunch {
  let outputCapture: NativeT3RuntimeOutputCapture
  let process: Process
}

enum NativeCodeServerRuntimeLauncher {
  static let host = "127.0.0.1"
  private struct RuntimeConfiguration {
    let ownerId: String
    let port: Int
    let storageName: String
  }
  private struct RuntimeOwnershipMetadata: Codable {
    let schemaVersion: Int
    let ownerId: String
    let bundleIdentifier: String
    let configKey: String
    let pid: Int
    let port: Int
    let startedAt: TimeInterval
    let storageName: String
  }
  private static var runtimeConfiguration: RuntimeConfiguration {
    let bundleIdentifier = Bundle.main.bundleIdentifier ?? ""
    if bundleIdentifier.hasPrefix("com.madda.ghostex-dev") {
      /*
       CDXC:SourceRuntimeOwnership 2026-06-28-04:05:
       Legacy ghostex-dev bundles must not contend with installed Ghostex for
       the Source code-server listener. Keep the port and profile identity
       bundle-derived so LaunchServices starts get the same split as shell
       starts without probing user paths or process command lines.
       */
      return RuntimeConfiguration(
        ownerId: "macos-dev",
        port: 3776,
        storageName: "code-server-runtime-macos-dev")
    }
    /*
     CDXC:SourceRuntimeOwnership 2026-06-28-04:05:
     Installed macOS Ghostex keeps the historical Source port/profile contract,
     while ownership metadata below decides whether an existing listener is safe
     to reuse. GPUI owns a different port/profile so Source tab clicks do not
     wait on cross-build code-server listeners.
     */
    return RuntimeConfiguration(
      ownerId: "macos",
      port: 3775,
      storageName: "code-server-runtime")
  }
  static var ownerId: String { runtimeConfiguration.ownerId }
  static var port: Int { runtimeConfiguration.port }
  static var origin: String { "http://\(host):\(port)" }
  static var storageName: String { runtimeConfiguration.storageName }
  private struct NodeRuntimeVersion {
    let major: Int
    let raw: String
  }
  private struct ListenerDiagnostic {
    let ownerKind: String
    let parentOwnerKind: String
    let parentPid: Int?
    let pid: Int
    let runtimeAgeSeconds: Int?
  }

  /**
   CDXC:ModeSwitcherDiagnostics 2026-06-28-03:44:
   Source-tab lag repros need to distinguish a slow titlebar/sidebar bridge from
   the fixed code-server port being owned by another app build. Capture only
   listener counts, PIDs, runtime ages, and enum owner kinds; never persist raw
   process command lines, executable paths, workspace paths, or launch arguments.
   */
  static func listenerDiagnosticsSnapshot() -> [String: Any] {
    let listeners = listeningProcesses(onPort: port)
    return [
      "listenerCount": listeners.count,
      "listenerOwnerKinds": listeners.map(\.ownerKind),
      "listenerParentOwnerKinds": listeners.map(\.parentOwnerKind),
      "listenerParentPids": listeners.map { $0.parentPid ?? 0 },
      "listenerPids": listeners.map(\.pid),
      "listenerRuntimeAgeSeconds": listeners.map { $0.runtimeAgeSeconds ?? -1 },
      "port": port,
    ]
  }

  static func bootstrapPayload() -> [String: Any] {
    [
      "host": host,
      "origin": origin,
      "ownerId": ownerId,
      "port": port,
      "storageName": storageName,
    ]
  }

  static func runtimeConfigKey(
    linkVscodeUserConfig: Bool,
    vscodeUserConfigDir: String?
  ) -> String {
    guard linkVscodeUserConfig else {
      return "ghostex-default"
    }
    let normalized = normalizedVscodeUserConfigDirectory(vscodeUserConfigDir)
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .lowercased()
    if normalized.hasSuffix("/library/application support/code - insiders/user") {
      return "vscode-insiders"
    }
    if normalized.hasSuffix("/library/application support/code/user") {
      return "vscode-stable"
    }
    return "vscode-custom"
  }

  static func ownedResponsiveRuntimePid(
    linkVscodeUserConfig: Bool,
    vscodeUserConfigDir: String?
  ) -> Int32? {
    let configKey = runtimeConfigKey(
      linkVscodeUserConfig: linkVscodeUserConfig,
      vscodeUserConfigDir: vscodeUserConfigDir)
    guard let metadata = readOwnershipMetadata(),
      metadataMatchesCurrentRuntime(metadata, configKey: configKey),
      hasListenerForOwnedRuntime(metadata),
      hasResponsiveRuntimeListener()
    else {
      return nil
    }
    return Int32(metadata.pid)
  }

  static func writeOwnershipMetadata(
    pid: Int32,
    linkVscodeUserConfig: Bool,
    vscodeUserConfigDir: String?
  ) {
    let metadata = RuntimeOwnershipMetadata(
      schemaVersion: 1,
      ownerId: ownerId,
      bundleIdentifier: Bundle.main.bundleIdentifier ?? "",
      configKey: runtimeConfigKey(
        linkVscodeUserConfig: linkVscodeUserConfig,
        vscodeUserConfigDir: vscodeUserConfigDir),
      pid: Int(pid),
      port: port,
      startedAt: Date().timeIntervalSince1970,
      storageName: storageName)
    do {
      let metadataURL = try runtimeOwnershipMetadataURL()
      let data = try JSONEncoder().encode(metadata)
      try data.write(to: metadataURL, options: [.atomic])
      NativeT3CodePaneReproLog.append("nativeCodeServerRuntime.ownership.written", [
        "configKey": metadata.configKey,
        "ownerId": metadata.ownerId,
        "pid": metadata.pid,
        "port": metadata.port,
        "storageName": metadata.storageName,
      ])
    } catch {
      NativeT3CodePaneReproLog.append("nativeCodeServerRuntime.ownership.writeFailed", [
        "error": error.localizedDescription,
        "ownerId": ownerId,
        "pid": Int(pid),
        "port": port,
        "storageName": storageName,
      ])
    }
  }

  static func clearOwnershipMetadata(pid: Int32?) {
    guard let metadata = readOwnershipMetadata(),
      metadataMatchesCurrentOwner(metadata)
    else {
      return
    }
    if let pid, metadata.pid != Int(pid) {
      return
    }
    do {
      try FileManager.default.removeItem(at: runtimeOwnershipMetadataURL())
      NativeT3CodePaneReproLog.append("nativeCodeServerRuntime.ownership.cleared", [
        "ownerId": metadata.ownerId,
        "pid": metadata.pid,
        "port": metadata.port,
        "storageName": metadata.storageName,
      ])
    } catch {
      NativeT3CodePaneReproLog.append("nativeCodeServerRuntime.ownership.clearFailed", [
        "error": error.localizedDescription,
        "ownerId": metadata.ownerId,
        "pid": metadata.pid,
        "port": metadata.port,
        "storageName": metadata.storageName,
      ])
    }
  }

  static func terminateOwnedRuntime(pid: Int32, logPrefix: String) {
    guard let metadata = readOwnershipMetadata(),
      metadataMatchesCurrentOwner(metadata),
      metadata.pid == Int(pid)
    else {
      return
    }
    guard hasListenerForOwnedRuntime(metadata) else {
      clearOwnershipMetadata(pid: pid)
      return
    }
    NativeT3CodePaneReproLog.append("\(logPrefix).codeServerRuntime.stop.ownedMetadata", [
      "ownerId": metadata.ownerId,
      "pid": metadata.pid,
      "port": metadata.port,
      "storageName": metadata.storageName,
    ])
    terminateRuntimeProcessTree(pid: pid, logPrefix: logPrefix)
    clearOwnershipMetadata(pid: pid)
  }

  static func terminateRuntimeProcessTree(pid: Int32, logPrefix: String) {
    let metadataPid = Int(pid)
    let ownedListenerPids = listeningProcesses(onPort: port)
      .filter { listener in listenerBelongsToRuntime(listener, metadataPid: metadataPid) }
      .map(\.pid)
    /*
     CDXC:SourceRuntimeOwnership 2026-06-28-04:37:
     Stopping Source must terminate the recorded launcher and its direct
     code-server listener child. Leaving the child alive creates a future
     unowned-but-responsive port that makes the next Source click fail as a
     cross-app conflict.
     */
    NativeT3CodePaneReproLog.append("\(logPrefix).codeServerRuntime.stop.processTree", [
      "listenerPids": ownedListenerPids,
      "pid": metadataPid,
      "port": port,
    ])
    for listenerPid in ownedListenerPids where listenerPid != metadataPid {
      kill(pid_t(listenerPid), SIGTERM)
    }
    kill(pid_t(pid), SIGTERM)
  }

  static func terminateCurrentOwnedRuntimeIfPresent(logPrefix: String) {
    guard let metadata = readOwnershipMetadata(),
      metadataMatchesCurrentOwner(metadata)
    else {
      return
    }
    let pid = Int32(metadata.pid)
    guard hasListenerForOwnedRuntime(metadata) else {
      NativeT3CodePaneReproLog.append("\(logPrefix).codeServerRuntime.stop.staleOwnership", [
        "ownerId": metadata.ownerId,
        "pid": metadata.pid,
        "port": metadata.port,
        "storageName": metadata.storageName,
      ])
      clearOwnershipMetadata(pid: pid)
      return
    }
    terminateOwnedRuntime(pid: pid, logPrefix: logPrefix)
  }

  private static func runtimeOwnershipMetadataURL() throws -> URL {
    try runtimeStorage().appendingPathComponent("owner.json", isDirectory: false)
  }

  private static func readOwnershipMetadata() -> RuntimeOwnershipMetadata? {
    guard let metadataURL = try? runtimeOwnershipMetadataURL(),
      let data = try? Data(contentsOf: metadataURL),
      let metadata = try? JSONDecoder().decode(RuntimeOwnershipMetadata.self, from: data)
    else {
      return nil
    }
    return metadata
  }

  private static func metadataMatchesCurrentRuntime(
    _ metadata: RuntimeOwnershipMetadata,
    configKey: String
  ) -> Bool {
    metadataMatchesCurrentOwner(metadata) && metadata.configKey == configKey
  }

  private static func metadataMatchesCurrentOwner(_ metadata: RuntimeOwnershipMetadata) -> Bool {
    metadata.schemaVersion == 1
      && metadata.ownerId == ownerId
      && metadata.port == port
      && metadata.storageName == storageName
  }

  private static func hasListenerForOwnedRuntime(_ metadata: RuntimeOwnershipMetadata) -> Bool {
    listeningProcesses(onPort: port).contains { listener in
      listenerBelongsToRuntime(listener, metadataPid: metadata.pid)
    }
  }

  private static func listenerBelongsToRuntime(
    _ listener: ListenerDiagnostic,
    metadataPid: Int
  ) -> Bool {
    /*
     CDXC:SourceRuntimeOwnership 2026-06-28-04:37:
     code-server is launched through a shell wrapper that records the parent PID
     in owner.json, while the TCP listener can be the forked Node child. Treat
     either the recorded PID or its direct listener child as the same owned
     runtime so Source retries reuse Ghostex's own server instead of reporting a
     false cross-app ownership conflict.
     */
    listener.pid == metadataPid || listener.parentPid == metadataPid
  }

  /**
   CDXC:EditorPanes 2026-05-06-15:00
   code-server can take a few seconds to fork its IPC child and bind the local
   editor port. Repeated editor-open commands during that window should observe
   the in-flight launch instead of treating the missing health endpoint as a
   dead runtime.
   */
  static let startupGraceInterval: TimeInterval = 10.0

  /**
   CDXC:EditorPanes 2026-05-06-14:21
   ghostex project editor panes embed the user's custom code-server checkout as a
   shared localhost VS Code runtime. Native owns launch, storage directories,
   auth disabling, and localhost binding so each project can attach a clean
   Chromium view without browser chrome or split-pane participation.

   CDXC:EditorPanes 2026-05-15-18:53:
   Reconnecting/page-not-found repros must prove whether the shared code-server
   process exited, the localhost listener disappeared, or CEF navigated to an
   error page. Keep launch arguments, runtime paths, and bounded process output
   in the same native-t3-code-pane-repro log the user will send after reproducing.
   */
  static func createLaunch(
    cwd: String,
    linkVscodeUserConfig: Bool,
    vscodeUserConfigDir: String?
  ) throws -> NativeCodeServerRuntimeLaunch {
    let repoRoot = try resolveCodeServerRepoRoot()
    let entrypoint = repoRoot.appendingPathComponent("out/node/entry.js").path
    let nodePath = try resolveCodeServerNodePath(repoRoot: repoRoot)
    let storage = try runtimeStorage()
    let userDataDirURL = storage.appendingPathComponent("user-data", isDirectory: true)
    let extensionsDirURL = storage.appendingPathComponent("extensions", isDirectory: true)
    let linkedVscodeUserConfigDir: String? =
      linkVscodeUserConfig ? normalizedVscodeUserConfigDirectory(vscodeUserConfigDir) : nil
    let configKey = runtimeConfigKey(
      linkVscodeUserConfig: linkVscodeUserConfig,
      vscodeUserConfigDir: vscodeUserConfigDir)
    if NativeCodeServerUserSettings.shouldSeedDefaultTheme(
      linkedVscodeUserConfigDir: linkedVscodeUserConfigDir)
    {
      try NativeCodeServerUserSettings.ensureDefaultTheme(in: userDataDirURL)
    }
    let userDataDir = userDataDirURL.path
    let extensionsDir = extensionsDirURL.path
    var launchArguments = [
      "exec",
      shellQuote(nodePath),
      shellQuote(entrypoint),
    ]
    if let linkedVscodeUserConfigDir {
      /**
       CDXC:EditorPanes 2026-05-06-15:00
       code-server editor panes should use the user's local VS Code settings
       by default. The sidebar chooses stable VS Code or Insiders and native
       passes code-server's supported CLI flags during process launch.
       */
      launchArguments.append("--link-vscode-user-config")
      launchArguments.append("--vscode-user-config-dir \(shellQuote(linkedVscodeUserConfigDir))")
    }
    launchArguments.append(contentsOf: [
      "--auth none",
      "--bind-addr \(host):\(port)",
      "--disable-telemetry",
      "--disable-update-check",
      "--disable-workspace-trust",
      "--disable-getting-started-override",
      "--ignore-last-opened",
      "--app-name \(shellQuote("ghostex Code"))",
      "--user-data-dir \(shellQuote(userDataDir))",
      "--extensions-dir \(shellQuote(extensionsDir))",
    ])
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/bin/zsh")
    process.arguments = [
      "-lc",
      launchArguments.joined(separator: " "),
    ]
    process.currentDirectoryURL = URL(fileURLWithPath: cwd, isDirectory: true)
    process.environment = runtimeEnvironment(repoRoot: repoRoot)
    process.standardInput = FileHandle.nullDevice
    let outputCapture = NativeT3RuntimeOutputCapture()
    outputCapture.attach(to: process)
    NativeT3CodePaneReproLog.append("nativeCodeServerRuntime.launch.created", [
      "cwd": cwd,
      "entrypoint": entrypoint,
      "linkVscodeUserConfig": linkVscodeUserConfig,
      "node": nodePath,
      "origin": origin,
      "runtimeConfigKey": configKey,
      "runtimeOwnerId": ownerId,
      "runtimeStorageName": storageName,
      "repoRoot": repoRoot.path,
      "storage": storage.path,
      "vscodeUserConfigDir": linkedVscodeUserConfigDir ?? NSNull(),
    ])
    return NativeCodeServerRuntimeLaunch(outputCapture: outputCapture, process: process)
  }

  static func hasResponsiveRuntimeListener() -> Bool {
    guard let url = URL(string: "\(origin)/healthz") else {
      return false
    }
    var request = URLRequest(url: url)
    request.cachePolicy = .reloadIgnoringLocalCacheData
    request.timeoutInterval = 1.0

    let semaphore = DispatchSemaphore(value: 0)
    var isResponsive = false
    URLSession.shared.dataTask(with: request) { data, response, error in
      defer { semaphore.signal() }
      let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
      isResponsive = error == nil && statusCode == 200
      NativeT3CodePaneReproLog.append("nativeCodeServerRuntime.health", [
        "bodyBytes": data?.count ?? 0,
        "error": error?.localizedDescription ?? NSNull(),
        "responsive": isResponsive,
        "statusCode": statusCode,
        "url": url.absoluteString,
      ])
    }.resume()

    let result = semaphore.wait(timeout: .now() + 1.5)
    if result == .timedOut {
      NativeT3CodePaneReproLog.append("nativeCodeServerRuntime.health.timeout", [
        "url": url.absoluteString
      ])
      return false
    }
    return isResponsive
  }

  static func waitUntilResponsive(timeout: TimeInterval) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      if hasResponsiveRuntimeListener() {
        return true
      }
      Thread.sleep(forTimeInterval: 0.2)
    }
    return hasResponsiveRuntimeListener()
  }

  static func waitUntilNotResponsive(timeout: TimeInterval) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      if !hasResponsiveRuntimeListener() {
        return true
      }
      Thread.sleep(forTimeInterval: 0.2)
    }
    return !hasResponsiveRuntimeListener()
  }

  private static func listeningProcesses(onPort port: Int) -> [ListenerDiagnostic] {
    let process = Process()
    let pipe = Pipe()
    process.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
    process.arguments = ["-nP", "-tiTCP:\(port)", "-sTCP:LISTEN"]
    process.standardOutput = pipe
    process.standardError = FileHandle.nullDevice
    do {
      try process.run()
      process.waitUntilExit()
    } catch {
      NativeT3CodePaneReproLog.append("nativeCodeServerRuntime.listenerProbe.failed", [
        "error": error.localizedDescription,
        "port": port,
      ])
      return []
    }
    return String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
      .split(separator: "\n", omittingEmptySubsequences: true)
      .compactMap { Int(String($0).trimmingCharacters(in: .whitespacesAndNewlines)) }
      .map { pid in
        let command = processCommand(pid: pid)
        let parentPid = processParentPid(pid: pid)
        let parentCommand = parentPid.map { processCommand(pid: $0) } ?? ""
        return ListenerDiagnostic(
          ownerKind: listenerOwnerKind(command),
          parentOwnerKind: listenerOwnerKind(parentCommand),
          parentPid: parentPid,
          pid: pid,
          runtimeAgeSeconds: runtimeAgeSeconds(pid: pid))
      } ?? []
  }

  private static func listenerOwnerKind(_ command: String) -> String {
    let normalized = command.lowercased()
    if normalized.isEmpty {
      return "unknown"
    }
    if normalized.contains("ghostexgpui.app") ||
      (normalized.contains("/gpui/") && normalized.contains("code-server"))
    {
      return "ghostex-gpui-code-server"
    }
    if normalized.contains("ghostex.app") && normalized.contains("code-server") {
      return "ghostex-app-code-server"
    }
    if normalized.contains("ghostex") && normalized.contains("code-server") {
      return "ghostex-code-server"
    }
    if normalized.contains("code-server") {
      return "code-server"
    }
    if normalized.contains("node") {
      return "node"
    }
    return "foreign"
  }

  private static func processCommand(pid: Int) -> String {
    let process = Process()
    let pipe = Pipe()
    process.executableURL = URL(fileURLWithPath: "/bin/ps")
    process.arguments = ["-p", String(pid), "-o", "command="]
    process.standardOutput = pipe
    process.standardError = FileHandle.nullDevice
    do {
      try process.run()
      process.waitUntilExit()
    } catch {
      return ""
    }
    return String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
      .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
  }

  private static func processParentPid(pid: Int) -> Int? {
    let process = Process()
    let pipe = Pipe()
    process.executableURL = URL(fileURLWithPath: "/bin/ps")
    process.arguments = ["-p", String(pid), "-o", "ppid="]
    process.standardOutput = pipe
    process.standardError = FileHandle.nullDevice
    do {
      try process.run()
      process.waitUntilExit()
    } catch {
      return nil
    }
    let raw = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
      .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return Int(raw)
  }

  private static func runtimeAgeSeconds(pid: Int) -> Int? {
    let process = Process()
    let pipe = Pipe()
    process.executableURL = URL(fileURLWithPath: "/bin/ps")
    process.arguments = ["-p", String(pid), "-o", "etime="]
    process.standardOutput = pipe
    process.standardError = FileHandle.nullDevice
    do {
      try process.run()
      process.waitUntilExit()
    } catch {
      return nil
    }
    let raw = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
      .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return parsePsElapsedSeconds(raw)
  }

  private static func parsePsElapsedSeconds(_ raw: String) -> Int? {
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else {
      return nil
    }
    let daySplit = trimmed.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)
    let days: Int
    let timePart: Substring
    if daySplit.count == 2 {
      guard let parsedDays = Int(daySplit[0]) else {
        return nil
      }
      days = parsedDays
      timePart = daySplit[1]
    } else {
      days = 0
      timePart = Substring(trimmed)
    }
    let parts = timePart.split(separator: ":", omittingEmptySubsequences: false)
    guard parts.count == 2 || parts.count == 3 else {
      return nil
    }
    let secondsIndex = parts.count - 1
    let minutesIndex = parts.count - 2
    guard
      let seconds = Int(parts[secondsIndex]),
      let minutes = Int(parts[minutesIndex])
    else {
      return nil
    }
    let hours = parts.count == 3 ? Int(parts[0]) : 0
    guard let hours else {
      return nil
    }
    return days * 86_400 + hours * 3_600 + minutes * 60 + seconds
  }

  private static func resolveCodeServerRepoRoot() throws -> URL {
    let environment = ProcessInfo.processInfo.environment
    let configuredRoot =
      environment["GHOSTEX_CODE_SERVER_ROOT"]?.trimmingCharacters(in: .whitespacesAndNewlines)
      ?? environment["ghostex_CODE_SERVER_ROOT"]?.trimmingCharacters(in: .whitespacesAndNewlines)
    let sourceRoot = codeServerSourceRoot()
    var candidates: [String] = []
    func appendCandidate(_ path: String) {
      if !candidates.contains(path) {
        candidates.append(path)
      }
    }
    if configuredRoot?.isEmpty == false {
      appendCandidate(configuredRoot!)
    } else {
      /**
       CDXC:CodeServerSubmodule 2026-06-07-11:20:
       Ghostex owns the embedded legacy code-server checkout as a root submodule, so the native launcher must resolve code-server from ghostex_REPO_ROOT or the current repo directory instead of probing maintainer-specific home paths.
       GHOSTEX_CODE_SERVER_ROOT remains the explicit development override when a test needs a different checkout.

       CDXC:CodeServerSubmodule 2026-06-08-11:46:
       Local LaunchServices starts can keep an already-running app process whose environment predates `bun run start`. Resolve the compiled source root as a development candidate so the Source tab can still find the reviewed code-server submodule instead of showing an initialize-submodule toast while the checkout is present.
       */
      if let resourceURL = Bundle.main.resourceURL {
        appendCandidate(resourceURL.appendingPathComponent("Web/code-server", isDirectory: true).path)
        appendCandidate(resourceURL.appendingPathComponent("code-server", isDirectory: true).path)
      }
      if let repoRootPath = environment["ghostex_REPO_ROOT"]?.trimmingCharacters(
        in: .whitespacesAndNewlines),
        !repoRootPath.isEmpty
      {
        appendCandidate(
          URL(fileURLWithPath: repoRootPath, isDirectory: true)
            .appendingPathComponent("code-server", isDirectory: true).path)
      }
      appendCandidate(
        URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
          .appendingPathComponent("code-server", isDirectory: true).path)
      appendCandidate(sourceRoot.appendingPathComponent("code-server", isDirectory: true).path)
    }
    for candidate in candidates {
      let repoRoot = URL(fileURLWithPath: candidate, isDirectory: true)
      if FileManager.default.fileExists(
        atPath: repoRoot.appendingPathComponent("out/node/entry.js").path)
      {
        try validateCodeServerDevelopmentPayload(repoRoot: repoRoot)
        return repoRoot
      }
    }
    throw NSError(
      domain: "NativeCodeServerRuntimeLauncher",
      code: 1,
      userInfo: [
        NSLocalizedDescriptionKey:
          "Unable to resolve the embedded code-server checkout. Initialize the code-server submodule or set GHOSTEX_CODE_SERVER_ROOT."
      ])
  }

  private static func validateCodeServerDevelopmentPayload(repoRoot: URL) throws {
    /**
     CDXC:EditorPanes 2026-06-08-09:08:
     The Source tab uses the legacy code-server checkout in VS Code dev mode, so a healthy /healthz listener is not enough. Refuse to launch when the nested VS Code submodule or compiled server-main.js payload is absent, because otherwise CEF navigates to code-server's raw 500 page instead of the sidebar receiving a startup failure.
     */
    guard FileManager.default.fileExists(
      atPath: repoRoot.appendingPathComponent("lib/vscode/package.json").path)
    else {
      throw NSError(
        domain: "NativeCodeServerRuntimeLauncher",
        code: 5,
        userInfo: [
          NSLocalizedDescriptionKey:
            "Embedded code-server VS Code submodule is missing. Run `git -C code-server submodule update --init lib/vscode` from the Ghostex checkout."
        ])
    }

    guard FileManager.default.fileExists(
      atPath: repoRoot.appendingPathComponent("lib/vscode/out/server-main.js").path)
    else {
      throw NSError(
        domain: "NativeCodeServerRuntimeLauncher",
        code: 6,
        userInfo: [
          NSLocalizedDescriptionKey:
            "Embedded code-server VS Code build output is missing. Run `npm --prefix code-server/lib/vscode install` and `npm --prefix code-server/lib/vscode run compile` before opening the Source tab."
        ])
    }

    /**
     CDXC:EditorPanes 2026-06-08-09:18:
     VS Code's built-in Git extension requires @vscode/fs-copyfile's macOS native module. Validate it with the rest of the dev payload so the Source tab does not open and then show a Git activation failure toast for a missing vscode_fs.node file.
     */
    guard FileManager.default.fileExists(
      atPath: repoRoot.appendingPathComponent(
        "lib/vscode/extensions/git/node_modules/@vscode/fs-copyfile/build/Release/vscode_fs.node"
      ).path)
    else {
      throw NSError(
        domain: "NativeCodeServerRuntimeLauncher",
        code: 7,
        userInfo: [
          NSLocalizedDescriptionKey:
            "Embedded VS Code Git extension native module is missing. Run `npm --prefix code-server/lib/vscode/extensions/git/node_modules/@vscode/fs-copyfile run build` before opening the Source tab."
        ])
    }
  }

  private static func runtimeStorage() throws -> URL {
    let storage = GhostexAppStorage.sharedRootDirectory
      .appendingPathComponent(storageName, isDirectory: true)
    try FileManager.default.createDirectory(
      at: storage.appendingPathComponent("user-data", isDirectory: true),
      withIntermediateDirectories: true)
    try FileManager.default.createDirectory(
      at: storage.appendingPathComponent("extensions", isDirectory: true),
      withIntermediateDirectories: true)
    return storage
  }

  private static func normalizedVscodeUserConfigDirectory(_ candidate: String?) -> String {
    let trimmedCandidate = candidate?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if !trimmedCandidate.isEmpty {
      return trimmedCandidate
    }
    return FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent("Library/Application Support/Code/User", isDirectory: true).path
  }

  private static func resolveCodeServerNodePath(repoRoot: URL) throws -> String {
    let requiredMajor = codeServerRequiredNodeMajor(repoRoot: repoRoot) ?? 22
    let configuredNodePath = configuredCodeServerNodePath()

    /**
     CDXC:EditorPanes 2026-05-06-17:36
     The custom code-server checkout is built and tested against its declared
     Node major. Launching it with the Homebrew `node` symlink can silently pick
     a newer major, which leaves the remote extension host reconnecting and
     extension commands stuck on activation. Resolve a matching Node runtime
     before falling back to PATH.

     CDXC:EditorPanes 2026-06-08-12:17:
     The bundled code-server runtime owns Ghostex's single app Node 22 executable at Web/code-server/lib/node. Prefer that app-owned runtime for code-server and gxserver so Source panes do not depend on user PATH, while preserving explicit GHOSTEX_CODE_SERVER_NODE_PATH for targeted development tests.
     */
    if let configuredNodePath {
      let nodePath = expandedPath(configuredNodePath)
      guard let version = nodeRuntimeVersion(at: nodePath), version.major == requiredMajor else {
        throw NSError(
          domain: "NativeCodeServerRuntimeLauncher",
          code: 3,
          userInfo: [
            NSLocalizedDescriptionKey:
              "Configured code-server Node runtime must be Node \(requiredMajor): \(nodePath)."
          ])
      }
      appendResolvedCodeServerNodeLog(
        nodePath: nodePath, requiredMajor: requiredMajor, source: "configured", version: version)
      return nodePath
    }

    var attemptedVersions: [[String: Any]] = []
    for candidate in bundledCodeServerNodeCandidates() {
      let nodePath = expandedPath(candidate.path)
      guard FileManager.default.isExecutableFile(atPath: nodePath),
        let version = nodeRuntimeVersion(at: nodePath)
      else {
        continue
      }
      if version.major == requiredMajor {
        appendResolvedCodeServerNodeLog(
          nodePath: nodePath, requiredMajor: requiredMajor, source: candidate.source, version: version)
        return nodePath
      }
      attemptedVersions.append([
        "node": nodePath,
        "source": candidate.source,
        "version": version.raw,
      ])
    }

    if isBundledCodeServerRepoRoot(repoRoot) {
      throw NSError(
        domain: "NativeCodeServerRuntimeLauncher",
        code: 8,
        userInfo: [
          NSLocalizedDescriptionKey:
            "Ghostex is missing its bundled code-server Node \(requiredMajor) runtime. Reinstall or rebuild Ghostex so Web/code-server/lib/node is present and matches code-server."
        ])
    }

    for candidate in codeServerNodeCandidates(requiredMajor: requiredMajor) {
      let nodePath = expandedPath(candidate)
      guard FileManager.default.isExecutableFile(atPath: nodePath),
        let version = nodeRuntimeVersion(at: nodePath)
      else {
        continue
      }
      if version.major == requiredMajor {
        appendResolvedCodeServerNodeLog(
          nodePath: nodePath, requiredMajor: requiredMajor, source: "auto", version: version)
        return nodePath
      }
      attemptedVersions.append([
        "node": nodePath,
        "version": version.raw,
      ])
    }

    throw NSError(
      domain: "NativeCodeServerRuntimeLauncher",
      code: 4,
      userInfo: [
        NSLocalizedDescriptionKey:
          "Unable to resolve Node \(requiredMajor) for code-server. Set GHOSTEX_CODE_SERVER_NODE_PATH to a compatible node binary.",
        "attemptedVersions": attemptedVersions,
      ])
  }

  private static func codeServerSourceRoot() -> URL {
    var sourceRoot = URL(fileURLWithPath: #filePath, isDirectory: false)
    for _ in 0..<6 {
      sourceRoot.deleteLastPathComponent()
    }
    return sourceRoot
  }

  private static func configuredCodeServerNodePath() -> String? {
    let environment = ProcessInfo.processInfo.environment
    let configuredPath =
      environment["GHOSTEX_CODE_SERVER_NODE_PATH"]?.trimmingCharacters(in: .whitespacesAndNewlines)
      ?? environment["ghostex_CODE_SERVER_NODE_PATH"]?.trimmingCharacters(in: .whitespacesAndNewlines)
    if let configuredPath, !configuredPath.isEmpty {
      return configuredPath
    }
    return nil
  }

  private static func codeServerRequiredNodeMajor(repoRoot: URL) -> Int? {
    let packageJsonURL = repoRoot.appendingPathComponent("package.json")
    guard let data = try? Data(contentsOf: packageJsonURL),
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let engines = json["engines"] as? [String: Any],
      let nodeEngine = engines["node"] as? String
    else {
      return nil
    }
    return firstInteger(in: nodeEngine)
  }

  private static func bundledCodeServerNodeCandidates() -> [(path: String, source: String)] {
    let cwd = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
    let sourceRoot = codeServerSourceRoot()
    var candidates: [(path: String, source: String)] = []
    func appendCandidate(_ url: URL?, source: String) {
      guard let url else {
        return
      }
      let path = url.path
      if !candidates.contains(where: { $0.path == path }) {
        candidates.append((path: path, source: source))
      }
    }
    appendCandidate(
      Bundle.main.resourceURL?.appendingPathComponent("Web/code-server/lib/node"),
      source: "app-bundled")
    appendCandidate(
      Bundle.main.resourceURL?.appendingPathComponent("code-server/lib/node"),
      source: "app-bundled")
    appendCandidate(
      cwd.appendingPathComponent("native/macos/ghostexHost/Web/code-server/lib/node"),
      source: "working-tree-bundled")
    appendCandidate(
      sourceRoot.appendingPathComponent("native/macos/ghostexHost/Web/code-server/lib/node"),
      source: "source-bundled")
    return candidates
  }

  private static func codeServerNodeCandidates(requiredMajor: Int) -> [String] {
    let home = FileManager.default.homeDirectoryForCurrentUser
    var candidates: [String] = []

    candidates.append(contentsOf: nodeInstallCandidates(
      in: home.appendingPathComponent(".local/node", isDirectory: true),
      requiredMajor: requiredMajor))
    candidates.append(contentsOf: nodeInstallCandidates(
      in: home.appendingPathComponent(".local/share/mise/installs/node", isDirectory: true),
      requiredMajor: requiredMajor))
    candidates.append(contentsOf: nodeInstallCandidates(
      in: home.appendingPathComponent(".asdf/installs/nodejs", isDirectory: true),
      requiredMajor: requiredMajor))
    candidates.append(contentsOf: nodeInstallCandidates(
      in: home.appendingPathComponent(".nvm/versions/node", isDirectory: true),
      requiredMajor: requiredMajor))

    candidates.append(contentsOf: [
      "/opt/homebrew/opt/node@\(requiredMajor)/bin/node",
      "/usr/local/opt/node@\(requiredMajor)/bin/node",
    ])

    if let pathNode = try? resolveCommandPath("node") {
      candidates.append(pathNode)
    }

    var seen: Set<String> = []
    return candidates.filter { candidate in
      let nodePath = expandedPath(candidate)
      return seen.insert(nodePath).inserted
    }
  }

  private static func nodeInstallCandidates(in directory: URL, requiredMajor: Int) -> [String] {
    guard
      let entries = try? FileManager.default.contentsOfDirectory(
        at: directory,
        includingPropertiesForKeys: [.isDirectoryKey],
        options: [.skipsHiddenFiles])
    else {
      return []
    }

    return entries
      .filter { entry in
        let name = entry.lastPathComponent
        return name.hasPrefix("node-v\(requiredMajor).")
          || name.hasPrefix("v\(requiredMajor).")
          || name.hasPrefix("\(requiredMajor).")
      }
      .sorted { lhs, rhs in lhs.lastPathComponent.localizedStandardCompare(rhs.lastPathComponent) == .orderedDescending }
      .map { entry in entry.appendingPathComponent("bin/node").path }
  }

  private static func nodeRuntimeVersion(at nodePath: String) -> NodeRuntimeVersion? {
    let process = Process()
    let pipe = Pipe()
    process.executableURL = URL(fileURLWithPath: nodePath)
    process.arguments = ["-v"]
    process.standardOutput = pipe
    process.standardError = FileHandle.nullDevice
    do {
      try process.run()
    } catch {
      return nil
    }
    process.waitUntilExit()
    guard process.terminationStatus == 0 else {
      return nil
    }
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    guard let rawVersion = String(data: data, encoding: .utf8)?
      .trimmingCharacters(in: .whitespacesAndNewlines),
      let major = firstInteger(in: rawVersion)
    else {
      return nil
    }
    return NodeRuntimeVersion(major: major, raw: rawVersion)
  }

  private static func firstInteger(in value: String) -> Int? {
    var digits = ""
    for character in value {
      if character.isNumber {
        digits.append(character)
        continue
      }
      if !digits.isEmpty {
        break
      }
    }
    return digits.isEmpty ? nil : Int(digits)
  }

  private static func expandedPath(_ path: String) -> String {
    (path as NSString).expandingTildeInPath
  }

  private static func appendResolvedCodeServerNodeLog(
    nodePath: String,
    requiredMajor: Int,
    source: String,
    version: NodeRuntimeVersion
  ) {
    NativeT3CodePaneReproLog.append("nativeCodeServerRuntime.node.resolved", [
      "node": nodePath,
      "requiredMajor": requiredMajor,
      "source": source,
      "version": version.raw,
    ])
  }

  private static func runtimeEnvironment(repoRoot: URL) -> [String: String] {
    var environment = ProcessInfo.processInfo.environment
    environment["VSCODE_IPC_HOOK_CLI"] = ""
    /**
     CDXC:EditorPanes 2026-05-06-15:00
     code-server's entrypoint treats CODE_SERVER_PARENT_PID as proof that it is
     the already-forked IPC child. Native ghostex must launch the parent wrapper
     without that variable so code-server can create its IPC child itself and
     bind the embedded editor port.
    */
    environment.removeValue(forKey: "CODE_SERVER_PARENT_PID")
    if isBundledCodeServerRuntime(repoRoot: repoRoot) {
      /*
       CDXC:EditorPanes 2026-06-08-12:17:
       Installed Ghostex builds run code-server from the packaged Web/code-server runtime. Do not force VS Code dev mode there; the staged darwin web-server payload should load as a packaged runtime while source checkouts keep the dev-mode import-map behavior below.
       */
      environment.removeValue(forKey: "VSCODE_DEV")
      environment["NODE_ENV"] = "production"
    } else {
      /**
       CDXC:EditorPanes 2026-05-06-15:00
       The configured custom code-server checkout serves VS Code from source.
       Launch it in VS Code dev mode so the workbench-dev shell installs the CSS
       module import map; otherwise CEF receives CSS files as JavaScript modules
       and the embedded editor renders blank.
       */
      environment["VSCODE_DEV"] = "1"
      environment["NODE_ENV"] = "development"
      environment["PATH"] = [
        repoRoot.appendingPathComponent("node_modules/.bin").path,
        environment["PATH"] ?? "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
      ].joined(separator: ":")
    }
    return environment
  }

  private static func isBundledCodeServerRuntime(repoRoot: URL) -> Bool {
    FileManager.default.isExecutableFile(atPath: repoRoot.appendingPathComponent("lib/node").path)
  }

  private static func isBundledCodeServerRepoRoot(_ repoRoot: URL) -> Bool {
    guard let resourceURL = Bundle.main.resourceURL?.standardizedFileURL else {
      return false
    }
    let resourcePath = resourceURL.path
    let candidatePath = repoRoot.standardizedFileURL.path
    return candidatePath == resourceURL.appendingPathComponent("Web/code-server", isDirectory: true).path
      || candidatePath == resourceURL.appendingPathComponent("code-server", isDirectory: true).path
      || candidatePath.hasPrefix("\(resourcePath)/Web/code-server/")
      || candidatePath.hasPrefix("\(resourcePath)/code-server/")
  }

  private static func resolveCommandPath(_ command: String) throws -> String {
    let process = Process()
    let pipe = Pipe()
    process.executableURL = URL(fileURLWithPath: "/bin/zsh")
    process.arguments = ["-lc", "command -v \(shellQuote(command))"]
    process.standardOutput = pipe
    process.standardError = FileHandle.nullDevice
    try process.run()
    process.waitUntilExit()
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    let resolved = String(data: data, encoding: .utf8)?
      .split(whereSeparator: \.isNewline)
      .first
      .map(String.init)
    if process.terminationStatus == 0, let resolved, !resolved.isEmpty {
      return resolved
    }
    throw NSError(
      domain: "NativeCodeServerRuntimeLauncher",
      code: 2,
      userInfo: [NSLocalizedDescriptionKey: "Unable to resolve required runtime command: \(command)."])
  }

  private static func shellQuote(_ value: String) -> String {
    "'\(value.replacingOccurrences(of: "'", with: "'\\''"))'"
  }
}

private struct NativeT3RuntimeCommand {
  let command: String
  let entrypoint: String
  let kind: String
  let runtime: String
}

enum NativeT3RuntimeLauncher {
  static let host = "127.0.0.1"
  /**
   CDXC:T3RemoteAccess 2026-05-02-01:18
   Native T3 Remote Access uses T3's one-time pairing URLs directly. The
   runtime still renders in-app through 127.0.0.1, but the listener must bind
   all interfaces so Tailscale/local-network QR links can reach the same
   authenticated backend.
   */
  private static let listenHost = "0.0.0.0"
  static let port = 3774
  static let appHeartbeatInterval: TimeInterval = 30.0
  private struct T3NodeRuntimeVersion {
    let major: Int
    let minor: Int
    let patch: Int
    let raw: String
  }
  private static let bootstrapCredentialLock = NSLock()
  private static var bootstrapCredential: String?
  private static var ownerBearerToken: String?
  private static let launchAttemptLock = NSLock()
  private static var launchAttemptStartedAt: Date?
  @MainActor private static var liveManagedPaneHeartbeatTimer: Timer?
  @MainActor private static var liveManagedPaneHeartbeatSessionIds: [String] = []
  /**
   CDXC:T3CodeStartup 2026-06-07-02:46:
   The packaged T3 server can bind late while startup migrations and desktop
   bootstrap complete. Share one native launch grace across the host and sidebar
   entry points so restore-time duplicate start commands retain the first
   wrapper instead of spawning a competing server that leaves panes on loading.
   */
  static let startupGraceInterval: TimeInterval = 30.0
  private static let startupUnresponsiveRetentionSeconds = 90
  private static let staleRuntimeShutdownTimeout: TimeInterval = 2.0
  /**
   CDXC:T3Code 2026-05-10-22:07
   Background managed t3code should be killed after three minutes without a live
   native managed T3 pane, because hidden Bun providers can keep burning CPU/GPU-side
   compositing energy while users are only looking at normal terminals.
   */
  private static let appClosedRuntimeShutdownTimeoutSeconds = 180

  /**
   CDXC:T3Code 2026-04-30-03:39
   Native T3 panes must own the localhost provider they render. If ghostex has no
   tracked runtime but a previous T3 desktop process still owns port 3774, kill
   only that T3-looking listener before launching so the pane does not attach to
   stale unauthenticated UI and new launches do not fail with EADDRINUSE.
   */
  static func clearStaleRuntimeIfNeeded(logPrefix: String, forceOwnedRuntimeStop: Bool = false) {
    let listeners = listeningProcesses(onPort: port)
    if listeners.isEmpty {
      NativeT3CodePaneReproLog.append("\(logPrefix).t3Runtime.port.available", [
        "port": port
      ])
      return
    }

    let heartbeatAgeSeconds = appHeartbeatAgeSeconds()

    for listener in listeners {
      guard isAnyT3RuntimeCommand(listener.command) else {
        NativeT3CodePaneReproLog.append("\(logPrefix).t3Runtime.port.occupiedByForeignProcess", [
          "command": listener.command,
          "pid": listener.pid,
          "port": port,
        ])
        continue
      }

      let shouldRetainOwnedRuntime =
        !forceOwnedRuntimeStop && shouldRetainUnresponsiveManagedRuntime(
          pid: listener.pid, heartbeatAgeSeconds: heartbeatAgeSeconds)
      if shouldRetainOwnedRuntime {
        /**
         CDXC:T3Code 2026-05-08-13:11
         Native T3 startup can report an open port before auth and orchestration
         endpoints answer. Retain an unresponsive managed listener only during a
         short startup grace window; older listeners that still time out are
         wedged providers and must be replaced instead of keeping panes on the
         embedded-workspace loader.
         */
        NativeT3CodePaneReproLog.append("\(logPrefix).t3Runtime.freshHeartbeatRetained", [
          "command": listener.command,
          "heartbeatAgeSeconds": heartbeatAgeSeconds ?? NSNull(),
          "parentCommand": listener.parentCommand,
          "parentPid": listener.parentPid,
          "pid": listener.pid,
          "port": port,
          "runtimeAgeSeconds": runtimeAgeSeconds(pid: listener.pid) ?? NSNull(),
          "startupRetentionSeconds": startupUnresponsiveRetentionSeconds,
        ])
        continue
      }

      NativeT3CodePaneReproLog.append("\(logPrefix).t3Runtime.staleProcess.terminate", [
        "command": listener.command,
        "forceOwnedRuntimeStop": forceOwnedRuntimeStop,
        "heartbeatAgeSeconds": heartbeatAgeSeconds ?? NSNull(),
        "parentCommand": listener.parentCommand,
        "parentPid": listener.parentPid,
        "pid": listener.pid,
        "port": port,
        "runtimeAgeSeconds": runtimeAgeSeconds(pid: listener.pid) ?? NSNull(),
        "startupRetentionSeconds": startupUnresponsiveRetentionSeconds,
      ])
      if isT3RuntimeSupervisorCommand(listener.parentCommand) {
        terminate(pid: listener.parentPid)
      }
      terminate(pid: listener.pid)
      waitForPortToClear(port)
    }

    /**
     CDXC:T3Code 2026-05-02-02:11
     A wedged managed Bun runtime can ignore graceful termination while still
     owning port 3774. That leaves the T3 pane gray because ghostex cannot start a
     replacement runtime or resolve a thread URL. Escalate only still-listening
     owned T3 runtime processes after the graceful timeout expires.
     */
    let remainingOwnedListeners =
      listeningProcesses(onPort: port).filter {
        isOwnedT3RuntimeProcess($0)
          && (forceOwnedRuntimeStop
            || !shouldRetainUnresponsiveManagedRuntime(
              pid: $0.pid, heartbeatAgeSeconds: heartbeatAgeSeconds))
      }
    for listener in remainingOwnedListeners {
      NativeT3CodePaneReproLog.append("\(logPrefix).t3Runtime.staleProcess.forceKill", [
        "command": listener.command,
        "forceOwnedRuntimeStop": forceOwnedRuntimeStop,
        "heartbeatAgeSeconds": heartbeatAgeSeconds ?? NSNull(),
        "parentCommand": listener.parentCommand,
        "parentPid": listener.parentPid,
        "pid": listener.pid,
        "port": port,
        "runtimeAgeSeconds": runtimeAgeSeconds(pid: listener.pid) ?? NSNull(),
      ])
      if isT3RuntimeSupervisorCommand(listener.parentCommand) {
        forceTerminate(pid: listener.parentPid)
      }
      forceTerminate(pid: listener.pid)
    }
    if !remainingOwnedListeners.isEmpty {
      waitForPortToClear(port)
    }
  }

  static func hasManagedRuntimeListener() -> Bool {
    listeningProcesses(onPort: port).contains { isOwnedT3RuntimeProcess($0) }
  }

  static func hasFreshAppHeartbeat() -> Bool {
    isAppHeartbeatFresh(ageSeconds: appHeartbeatAgeSeconds())
  }

  enum LaunchStartClaim {
    case claimed(Date)
    case retained(TimeInterval)
  }

  static func claimLaunchStart() -> LaunchStartClaim {
    let now = Date()
    launchAttemptLock.lock()
    defer { launchAttemptLock.unlock() }
    if let startedAt = launchAttemptStartedAt {
      let ageSeconds = now.timeIntervalSince(startedAt)
      if ageSeconds <= startupGraceInterval {
        return .retained(ageSeconds)
      }
    }
    launchAttemptStartedAt = now
    return .claimed(now)
  }

  static func clearLaunchAttempt(startedAt: Date) {
    launchAttemptLock.lock()
    defer { launchAttemptLock.unlock() }
    if launchAttemptStartedAt == startedAt {
      launchAttemptStartedAt = nil
    }
  }

  static func shouldRetainUnresponsiveManagedRuntime(pid: Int) -> Bool {
    shouldRetainUnresponsiveManagedRuntime(pid: pid, heartbeatAgeSeconds: appHeartbeatAgeSeconds())
  }

  private static func shouldRetainUnresponsiveManagedRuntime(
    pid: Int,
    heartbeatAgeSeconds: Int?
  ) -> Bool {
    guard isAppHeartbeatFresh(ageSeconds: heartbeatAgeSeconds) else {
      return false
    }
    guard hasRecoverableManagedRuntimeAuthMaterial() else {
      /**
       CDXC:T3Code 2026-05-24-17:29:
       A young T3 listener with no owner bearer and no usable desktop bootstrap
       token cannot recover by waiting. Do not spend the 90-second startup grace
       on unrecoverable auth state; replace the runtime so a fresh one-time
       bootstrap can mint the owner bearer needed by the first T3 pane.
       */
      NativeT3CodePaneReproLog.append("nativeT3Runtime.listener.startupGrace.missingAuthMaterial", [
        "heartbeatAgeSeconds": heartbeatAgeSeconds ?? NSNull(),
        "pid": pid,
        "startupRetentionSeconds": startupUnresponsiveRetentionSeconds,
      ])
      return false
    }
    guard let ageSeconds = runtimeAgeSeconds(pid: pid) else {
      NativeT3CodePaneReproLog.append("nativeT3Runtime.listener.startupGrace.missingAge", [
        "heartbeatAgeSeconds": heartbeatAgeSeconds ?? NSNull(),
        "pid": pid,
        "startupRetentionSeconds": startupUnresponsiveRetentionSeconds,
      ])
      return false
    }
    let shouldRetain = ageSeconds <= startupUnresponsiveRetentionSeconds
    NativeT3CodePaneReproLog.append("nativeT3Runtime.listener.startupGrace.evaluated", [
      "heartbeatAgeSeconds": heartbeatAgeSeconds ?? NSNull(),
      "pid": pid,
      "runtimeAgeSeconds": ageSeconds,
      "shouldRetain": shouldRetain,
      "startupRetentionSeconds": startupUnresponsiveRetentionSeconds,
    ])
    return shouldRetain
  }

  /**
   CDXC:T3Code 2026-05-01-14:44
   A T3-looking listener on port 3774 is not enough to reuse it: a wedged Bun
   process can keep the port open while auth endpoints time out, leaving native
   panes on an empty white WKWebView before thread routing starts. Adopt
   existing runtimes only when both the environment descriptor and auth session
   endpoint answer quickly; otherwise treat the listener as stale and launch a
   fresh managed server.
   */
  static func hasResponsiveManagedRuntimeListener() -> Bool {
    let listeners = listeningProcesses(onPort: port).filter { isOwnedT3RuntimeProcess($0) }
    guard !listeners.isEmpty else {
      NativeT3CodePaneReproLog.append("nativeT3Runtime.listener.health.noOwnedListeners", [
        "port": port
      ])
      return false
    }
    NativeT3CodePaneReproLog.append("nativeT3Runtime.listener.health.start", [
      "listenerCount": listeners.count,
      "pids": listeners.map(\.pid),
      "port": port,
      "runtimeAgeSeconds": listeners.map { runtimeAgeSeconds(pid: $0.pid) ?? -1 },
    ])
    guard
      probeManagedRuntimeEndpoint(path: "/.well-known/t3/environment", expectedStatusCode: 200),
      probeManagedRuntimeEndpoint(path: "/api/auth/session", expectedStatusCode: 200)
    else {
      return false
    }

    guard let url = URL(string: "http://\(host):\(port)/.well-known/t3/environment") else {
      return false
    }
    if listeners.contains(where: { isT3RuntimeSupervisorCommand($0.parentCommand) }) {
      return true
    }
    if currentOwnerBearerToken() != nil || readPersistedOwnerBearerToken() != nil {
      return true
    }
    /**
     CDXC:T3Code 2026-05-01-15:07
     A live localhost T3 listener is not safely reusable unless ghostex also has
     the owner bearer signed by that runtime. A stale browser cookie can make
     `/api/auth/session` report authenticated while owner-only snapshot calls
     still fail with `Invalid session token signature`, so native-managed
     listeners without native auth state must be relaunched instead of adopted.
     */
    NativeT3CodePaneReproLog.append("nativeT3Runtime.listener.health.missingNativeOwnerBearer", [
      "listenerCount": listeners.count,
      "port": port,
      "pids": listeners.map(\.pid),
      "url": url.absoluteString,
    ])
    return false
  }

  private static func probeManagedRuntimeEndpoint(
    path: String,
    expectedStatusCode: Int
  ) -> Bool {
    guard let url = URL(string: "http://\(host):\(port)\(path)") else {
      return false
    }
    var request = URLRequest(url: url)
    request.cachePolicy = .reloadIgnoringLocalCacheData
    request.timeoutInterval = 1.0

    let semaphore = DispatchSemaphore(value: 0)
    var isResponsive = false
    URLSession.shared.dataTask(with: request) { data, response, error in
      defer { semaphore.signal() }
      let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
      isResponsive = error == nil && statusCode == expectedStatusCode && (data?.isEmpty == false)
      NativeT3CodePaneReproLog.append("nativeT3Runtime.listener.health", [
        "bodyBytes": data?.count ?? 0,
        "error": error?.localizedDescription ?? NSNull(),
        "path": path,
        "responsive": isResponsive,
        "statusCode": statusCode,
        "url": url.absoluteString,
      ])
    }.resume()

    let result = semaphore.wait(timeout: .now() + 1.5)
    if result == .timedOut {
      NativeT3CodePaneReproLog.append("nativeT3Runtime.listener.health.timeout", [
        "url": url.absoluteString
      ])
      return false
    }
    guard isResponsive else {
      return false
    }
    return true
  }

  /**
   CDXC:T3Code 2026-05-01-07:04
   Native T3 panes must use the same managed T3 Code runtime shape as the
   reference project: bundled assets run through Node from `dist/bin.mjs`, while
   the root `t3code` submodule or an explicit development override runs through Bun from `apps/server/src/bin.ts`.
   ghostex still supplies the desktop bootstrap envelope on fd 3 so the WKWebView
   renders the authenticated provider without opening a browser.

   CDXC:T3Code 2026-05-10-22:07
   A newly spawned provider gets one startup keepalive write so stale heartbeat
   files from earlier sessions cannot make the wrapper kill it immediately.

   CDXC:T3Code 2026-06-06-05:13:
   After startup, only live native managed T3 panes refresh the keepalive. Sidebar
   projection can omit local T3 panes after gxserver presentation, so runtime lifetime
   must follow the native pane registry instead of React hydrate groups.
   */
  static func createLaunch(cwd: String) throws -> NativeT3RuntimeLaunch {
    touchAppHeartbeat(reason: "createLaunch")
    let bootstrap = try writeBootstrapJsonFile()
    rememberBootstrapCredential(bootstrap.credential)
    let bootstrapPath = shellQuote(bootstrap.url.path)
    let heartbeatPath = shellQuote(appHeartbeatURL().path)
    let shutdownTimeout = String(appClosedRuntimeShutdownTimeoutSeconds)
    let runtimeCommand = try resolveManagedT3RuntimeCommand()
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/bin/zsh")
    process.arguments = [
      "-lc",
      [
        "exec 3< \(bootstrapPath)",
        "rm -f \(bootstrapPath)",
        "(\n  runtime_pid=\"\"\n  \(runtimeCommand.command) --mode desktop --host \(listenHost) --port \(port) --no-browser --bootstrap-fd 3 &\n  runtime_pid=$!\n  (\n    while kill -0 \"$runtime_pid\" 2>/dev/null; do\n      now=$(date +%s)\n      last=$(cat \(heartbeatPath) 2>/dev/null || echo \"$now\")\n      if [ $((now - last)) -ge \(shutdownTimeout) ]; then\n        kill \"$runtime_pid\" 2>/dev/null\n        sleep 2\n        kill -9 \"$runtime_pid\" 2>/dev/null\n        exit 0\n      fi\n      sleep 15\n    done\n  ) &\n  monitor_pid=$!\n  wait \"$runtime_pid\"\n  runtime_status=$?\n  kill \"$monitor_pid\" 2>/dev/null\n  exit \"$runtime_status\"\n)",
      ].joined(separator: "\n"),
    ]
    process.currentDirectoryURL = URL(fileURLWithPath: cwd, isDirectory: true)
    process.environment = createRuntimeEnvironment()
    process.standardInput = FileHandle.nullDevice
    let outputCapture = NativeT3RuntimeOutputCapture()
    outputCapture.attach(to: process)
    return NativeT3RuntimeLaunch(outputCapture: outputCapture, process: process)
  }

  /**
   CDXC:T3Code 2026-05-10-22:07
   Despite the historical filename, this heartbeat now represents running T3
   sidebar-session ownership, not generic app liveness. The sidebar refreshes it
   only while a T3 card is shown and not sleeping; the wrapper exits the managed
   runtime when no running T3 card has refreshed it for the shutdown timeout.
   */
  static func touchAppHeartbeat(reason: String) {
    do {
      try FileManager.default.createDirectory(
        at: t3HomeDirectory(), withIntermediateDirectories: true)
      let timestamp = String(Int(Date().timeIntervalSince1970))
      try timestamp.write(to: appHeartbeatURL(), atomically: true, encoding: .utf8)
    } catch {
      NativeT3CodePaneReproLog.append("nativeT3Runtime.appHeartbeat.write.failed", [
        "error": error.localizedDescription,
        "reason": reason,
      ])
    }
  }

  /**
   CDXC:T3Code 2026-06-06-05:13:
   A live native managed T3 pane is the ownership signal for the shared t3code runtime.
   Keep the provider heartbeat alive while at least one managed pane exists in the
   native web-pane registry, including inactive tab siblings, then stop refreshing it
   so the wrapper kills background t3code after three stale minutes.
   */
  @MainActor
  static func setLiveManagedPaneHeartbeat(paneSessionIds: [String], reason: String) {
    let normalizedSessionIds = Array(Set(paneSessionIds)).sorted()
    guard !normalizedSessionIds.isEmpty else {
      if !liveManagedPaneHeartbeatSessionIds.isEmpty || liveManagedPaneHeartbeatTimer != nil {
        NativeT3CodePaneReproLog.append("nativeT3Runtime.livePaneHeartbeat.stopped", [
          "reason": reason,
        ])
      }
      liveManagedPaneHeartbeatSessionIds = []
      liveManagedPaneHeartbeatTimer?.invalidate()
      liveManagedPaneHeartbeatTimer = nil
      return
    }

    let previousSessionIds = liveManagedPaneHeartbeatSessionIds
    liveManagedPaneHeartbeatSessionIds = normalizedSessionIds
    touchAppHeartbeat(reason: "liveT3Panes.\(reason)")
    if liveManagedPaneHeartbeatTimer == nil {
      let timer = Timer(
        timeInterval: appHeartbeatInterval,
        repeats: true
      ) { _ in
        Task { @MainActor in
          guard !liveManagedPaneHeartbeatSessionIds.isEmpty else {
            return
          }
          touchAppHeartbeat(reason: "liveT3Panes.timer")
        }
      }
      liveManagedPaneHeartbeatTimer = timer
      RunLoop.main.add(timer, forMode: .common)
    }
    if previousSessionIds != normalizedSessionIds {
      NativeT3CodePaneReproLog.append("nativeT3Runtime.livePaneHeartbeat.updated", [
        "reason": reason,
        "paneSessionIds": normalizedSessionIds,
      ])
    }
  }

  private static func appHeartbeatAgeSeconds() -> Int? {
    guard
      let text = try? String(contentsOf: appHeartbeatURL(), encoding: .utf8)
        .trimmingCharacters(in: .whitespacesAndNewlines),
      let timestamp = TimeInterval(text)
    else {
      return nil
    }
    return max(0, Int(Date().timeIntervalSince1970 - timestamp))
  }

  private static func isAppHeartbeatFresh(ageSeconds: Int?) -> Bool {
    guard let ageSeconds else {
      return false
    }
    return ageSeconds < appClosedRuntimeShutdownTimeoutSeconds
  }

  static func currentBootstrapCredential() -> String? {
    bootstrapCredentialLock.lock()
    defer { bootstrapCredentialLock.unlock() }
    return bootstrapCredential
  }

  static func currentOwnerBearerToken() -> String? {
    bootstrapCredentialLock.lock()
    defer { bootstrapCredentialLock.unlock() }
    return ownerBearerToken
  }

  static func clearBootstrapCredential(_ credential: String) {
    bootstrapCredentialLock.lock()
    defer { bootstrapCredentialLock.unlock() }
    if bootstrapCredential == credential {
      bootstrapCredential = nil
    }
  }

  static func rememberOwnerBearerToken(_ token: String) {
    bootstrapCredentialLock.lock()
    let currentBootstrapCredential = bootstrapCredential
    ownerBearerToken = token
    bootstrapCredentialLock.unlock()
    try? writeAuthState([
      "desktopBootstrapToken": currentBootstrapCredential ?? NSNull(),
      "ownerBearerToken": token,
      "provider": "t3code",
    ])
    NativeT3CodePaneReproLog.append("nativeT3Runtime.ownerBearer.remembered", [
      "ownerBearerLength": token.count
    ])
  }

  private static func hasRecoverableManagedRuntimeAuthMaterial() -> Bool {
    currentOwnerBearerToken() != nil
      || readPersistedOwnerBearerToken() != nil
      || currentBootstrapCredential() != nil
      || readPersistedDesktopBootstrapToken() != nil
  }

  static func isManagedRuntimeURL(_ url: URL) -> Bool {
    url.host == host && url.port == port
  }

  private static func createRuntimeEnvironment() -> [String: String] {
    var environment = ProcessInfo.processInfo.environment
    environment["T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD"] = "false"
    environment["T3CODE_HOME"] = t3HomeDirectory().path
    environment["T3CODE_HOST"] = host
    environment["T3CODE_NO_BROWSER"] = "true"
    environment["T3CODE_PORT"] = String(port)
    return environment
  }

  private static func writeBootstrapJsonFile() throws -> NativeT3BootstrapFile {
    try FileManager.default.createDirectory(
      at: t3HomeDirectory(), withIntermediateDirectories: true)
    let credential = UUID().uuidString
    try writeAuthState([
      "desktopBootstrapToken": credential,
      "provider": "t3code",
    ])
    let payload: [String: Any] = [
      "desktopBootstrapToken": credential,
      "host": host,
      "mode": "desktop",
      "noBrowser": true,
      "port": port,
      "t3Home": t3HomeDirectory().path,
      /**
       CDXC:T3Code 2026-05-10-18:36
       t3code's desktop bootstrap schema requires explicit Tailscale serve
       exposure fields. ghostex-managed panes run local-only, so send disabled
       state instead of relying on upstream defaults after schema decoding.
       */
      "tailscaleServeEnabled": false,
      "tailscaleServePort": 443,
    ]
    var data = try JSONSerialization.data(withJSONObject: payload, options: [])
    /**
     CDXC:T3Code 2026-05-01-15:07
     t3code's desktop bootstrap reader consumes fd 3 with a line reader. Match
     the managed supervisor's pipe format by terminating the JSON envelope with
     a newline, so the server receives the bootstrap deterministically before
     the temporary file is removed.
     */
    data.append(0x0A)
    let bootstrapURL = t3HomeDirectory().appendingPathComponent(
      "bootstrap-\(UUID().uuidString).json")
    try data.write(to: bootstrapURL, options: [.atomic])
    return NativeT3BootstrapFile(credential: credential, url: bootstrapURL)
  }

  private static func appHeartbeatURL() -> URL {
    t3HomeDirectory().appendingPathComponent("ghostex-app-heartbeat")
  }

  private static func rememberBootstrapCredential(_ credential: String) {
    bootstrapCredentialLock.lock()
    bootstrapCredential = credential
    ownerBearerToken = nil
    bootstrapCredentialLock.unlock()
    NativeT3CodePaneReproLog.append("nativeT3Runtime.bootstrapCredential.remembered", [
      "credentialPresent": true
    ])
  }

  private static func resolveManagedT3RuntimeCommand() throws -> NativeT3RuntimeCommand {
    if let bundledEntrypoint = bundledRuntimeEntrypointPath() {
      let nodePath = try resolveBundledT3NodePath()
      NativeT3CodePaneReproLog.append("nativeT3Runtime.executable.resolved", [
        "entrypoint": bundledEntrypoint,
        "kind": "bundled",
        "runtime": nodePath,
      ])
      return NativeT3RuntimeCommand(
        command: "\(shellQuote(nodePath)) \(shellQuote(bundledEntrypoint))",
        entrypoint: bundledEntrypoint,
        kind: "bundled",
        runtime: nodePath)
    }

    /**
     CDXC:T3CodePackaging 2026-06-06-05:50:
     Installed Ghostex builds must run T3 Code from the bundled Web/t3code-server package.
     Only explicit development overrides or a local ghostex_REPO_ROOT start may use a source checkout, so release users get a clear reinstall/build error instead of silently probing maintainer-local folders and surfacing a misleading network failure.

     CDXC:T3CodeSubmodule 2026-06-07-13:00:
     Local source fallback should resolve the root `t3code` submodule when ghostex_REPO_ROOT is present, keeping native T3 development on the parent-pinned fork branch instead of the old sibling t3code-embed checkout.
     */
    let repoRoot = try resolveManagedT3RepoRoot()
    let entrypoint = repoRoot.appendingPathComponent("apps/server/src/bin.ts").path
    guard FileManager.default.fileExists(atPath: entrypoint) else {
      throw NSError(
        domain: "NativeT3RuntimeLauncher",
        code: 1,
        userInfo: [
          NSLocalizedDescriptionKey:
            "The managed T3 Code runtime source is missing. Expected: \(entrypoint)."
        ])
    }
    let nodeModulesPath = repoRoot.appendingPathComponent("node_modules").path
    guard FileManager.default.fileExists(atPath: nodeModulesPath) else {
      throw NSError(
        domain: "NativeT3RuntimeLauncher",
        code: 2,
        userInfo: [
          NSLocalizedDescriptionKey:
            "Managed T3 Code dependencies are missing. Expected: \(nodeModulesPath). Run 'bun install' in \(repoRoot.path)."
        ])
    }
    let bunPath = try resolveCommandPath("bun")
    NativeT3CodePaneReproLog.append("nativeT3Runtime.executable.resolved", [
      "entrypoint": entrypoint,
      "kind": "external",
      "repoRoot": repoRoot.path,
      "runtime": bunPath,
    ])
    return NativeT3RuntimeCommand(
      command: "\(shellQuote(bunPath)) \(shellQuote(entrypoint))",
      entrypoint: entrypoint,
      kind: "external",
      runtime: bunPath)
  }

  private static func resolveManagedT3RepoRoot() throws -> URL {
    let environment = ProcessInfo.processInfo.environment
    let configuredRoot =
      environment["VSMUX_T3CODE_REPO_ROOT"]?.trimmingCharacters(in: .whitespacesAndNewlines)
      ?? environment["ghostex_T3CODE_REPO_ROOT"]?.trimmingCharacters(in: .whitespacesAndNewlines)
    var candidates: [String] = []
    func appendCandidate(_ path: String) {
      if !candidates.contains(path) {
        candidates.append(path)
      }
    }
    if configuredRoot?.isEmpty == false {
      appendCandidate(configuredRoot!)
    } else {
      if let repoRootPath = environment["ghostex_REPO_ROOT"]?.trimmingCharacters(
        in: .whitespacesAndNewlines),
        !repoRootPath.isEmpty
      {
        appendCandidate(
          URL(fileURLWithPath: repoRootPath, isDirectory: true)
            .appendingPathComponent("t3code", isDirectory: true).path)
      }
      appendCandidate(
        URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
          .appendingPathComponent("t3code", isDirectory: true).path)
    }
    for candidate in candidates {
      let repoRoot = URL(fileURLWithPath: candidate, isDirectory: true)
      if FileManager.default.fileExists(
        atPath: repoRoot.appendingPathComponent("apps/server/src/bin.ts").path)
      {
        return repoRoot
      }
    }
    throw NSError(
      domain: "NativeT3RuntimeLauncher",
      code: 3,
      userInfo: [
        NSLocalizedDescriptionKey:
          "The bundled T3 Code runtime is missing from this Ghostex build. Reinstall Ghostex, rebuild the app so Web/t3code-server is packaged, initialize the t3code submodule, or set VSMUX_T3CODE_REPO_ROOT for development."
      ])
  }

  private static func bundledRuntimeEntrypointPath() -> String? {
    let bundledDirectoryName = "t3code-server"
    var candidates: [URL] = []
    if let resourceURL = Bundle.main.resourceURL {
      /**
       CDXC:T3CodePackaging 2026-06-07-02:30:
       The macOS target copies web assets under Contents/Resources/Web. Resolve
       the bundled T3 server from Web/t3code-server/dist/bin.mjs before legacy
       root/out probes so installed apps launch the packaged server instead of
       falling through to the development-checkout error.
       */
      candidates.append(
        resourceURL.appendingPathComponent("Web/\(bundledDirectoryName)/dist/bin.mjs"))
      candidates.append(
        resourceURL.appendingPathComponent("out/\(bundledDirectoryName)/dist/bin.mjs"))
      candidates.append(resourceURL.appendingPathComponent("\(bundledDirectoryName)/dist/bin.mjs"))
    }
    candidates.append(
      URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
        .appendingPathComponent("Web/\(bundledDirectoryName)/dist/bin.mjs"))
    candidates.append(
      URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
        .appendingPathComponent("out/\(bundledDirectoryName)/dist/bin.mjs"))
    candidates.append(
      URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
        .appendingPathComponent("\(bundledDirectoryName)/dist/bin.mjs"))
    return candidates.first { FileManager.default.fileExists(atPath: $0.path) }?.path
  }

  private static func expandedPath(_ path: String) -> String {
    /**
     CDXC:T3CodePackaging 2026-06-06-06:46:
     Native T3 runtime launch must expand user-configured and discovered Node
     paths inside NativeT3RuntimeLauncher itself. The Code Server runtime has
     its own private helper, but bundled T3 Code startup cannot depend on that
     sibling type or the macOS app fails to build before launch.
     */
    return (path as NSString).expandingTildeInPath
  }

  private static func resolveBundledT3NodePath() throws -> String {
    let environment = ProcessInfo.processInfo.environment
    let configuredPath =
      environment["GHOSTEX_T3CODE_NODE_PATH"]?.trimmingCharacters(in: .whitespacesAndNewlines)
      ?? environment["T3CODE_NODE"]?.trimmingCharacters(in: .whitespacesAndNewlines)
    if let configuredPath, !configuredPath.isEmpty {
      let nodePath = expandedPath(configuredPath)
      guard let version = t3NodeRuntimeVersion(at: nodePath), t3NodeVersionIsSupported(version) else {
        throw NSError(
          domain: "NativeT3RuntimeLauncher",
          code: 4,
          userInfo: [
            NSLocalizedDescriptionKey:
              "Configured T3 Code Node runtime must be Node 22.16+, 23.11+, or 24.10+: \(nodePath)."
          ])
      }
      NativeT3CodePaneReproLog.append("nativeT3Runtime.node.resolved", [
        "node": nodePath,
        "source": "configured",
        "version": version.raw,
      ])
      return nodePath
    }

    var attemptedVersions: [[String: Any]] = []
    for candidate in bundledT3NodeCandidates() {
      let nodePath = expandedPath(candidate.path)
      guard FileManager.default.isExecutableFile(atPath: nodePath),
        let version = t3NodeRuntimeVersion(at: nodePath)
      else {
        continue
      }
      if t3NodeVersionIsSupported(version) {
        NativeT3CodePaneReproLog.append("nativeT3Runtime.node.resolved", [
          "node": nodePath,
          "source": candidate.source,
          "version": version.raw,
        ])
        return nodePath
      }
      attemptedVersions.append([
        "node": nodePath,
        "source": candidate.source,
        "version": version.raw,
      ])
    }

    if bundledRuntimeEntrypointPath() != nil {
      throw NSError(
        domain: "NativeT3RuntimeLauncher",
        code: 6,
        userInfo: [
          NSLocalizedDescriptionKey:
            "Ghostex is missing a compatible bundled Node runtime for T3 Code. Reinstall or rebuild Ghostex so Web/code-server/lib/node is present and supports T3 Code.",
          "attemptedVersions": attemptedVersions,
        ])
    }

    for candidate in t3NodeCandidates() {
      let nodePath = expandedPath(candidate)
      guard FileManager.default.isExecutableFile(atPath: nodePath),
        let version = t3NodeRuntimeVersion(at: nodePath)
      else {
        continue
      }
      if t3NodeVersionIsSupported(version) {
        NativeT3CodePaneReproLog.append("nativeT3Runtime.node.resolved", [
          "node": nodePath,
          "source": "auto",
          "version": version.raw,
        ])
        return nodePath
      }
      attemptedVersions.append([
        "node": nodePath,
        "version": version.raw,
      ])
    }

    throw NSError(
      domain: "NativeT3RuntimeLauncher",
      code: 5,
      userInfo: [
        NSLocalizedDescriptionKey:
          "T3 Code requires Node 22.16+, 23.11+, or 24.10+. Install a compatible Node runtime from nodejs.org or set GHOSTEX_T3CODE_NODE_PATH.",
        "attemptedVersions": attemptedVersions,
      ])
  }

  private static func bundledT3NodeCandidates() -> [(path: String, source: String)] {
    let cwd = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
    var sourceRoot = URL(fileURLWithPath: #filePath, isDirectory: false)
    for _ in 0..<6 {
      sourceRoot.deleteLastPathComponent()
    }
    /*
     CDXC:T3CodePackaging 2026-06-08-12:17:
     T3 Code is bundled under Web/t3code-server, but it still needs Node to launch. Reuse code-server's bundled Node at Web/code-server/lib/node before checking any developer/system Node so installed Ghostex does not show a Node install error through the T3 Code path.
     */
    var candidates: [(path: String, source: String)] = []
    func appendCandidate(_ url: URL?, source: String) {
      guard let url else {
        return
      }
      let path = url.path
      if !candidates.contains(where: { $0.path == path }) {
        candidates.append((path: path, source: source))
      }
    }
    appendCandidate(
      Bundle.main.resourceURL?.appendingPathComponent("Web/code-server/lib/node"),
      source: "app-bundled")
    appendCandidate(
      Bundle.main.resourceURL?.appendingPathComponent("code-server/lib/node"),
      source: "app-bundled")
    appendCandidate(
      cwd.appendingPathComponent("native/macos/ghostexHost/Web/code-server/lib/node"),
      source: "working-tree-bundled")
    appendCandidate(
      sourceRoot.appendingPathComponent("native/macos/ghostexHost/Web/code-server/lib/node"),
      source: "source-bundled")
    return candidates
  }

  private static func t3NodeCandidates() -> [String] {
    let home = FileManager.default.homeDirectoryForCurrentUser
    var candidates: [String] = []
    for requiredMajor in [24, 23, 22] {
      candidates.append(contentsOf: t3NodeInstallCandidates(
        in: home.appendingPathComponent(".local/node", isDirectory: true),
        requiredMajor: requiredMajor))
      candidates.append(contentsOf: t3NodeInstallCandidates(
        in: home.appendingPathComponent(".local/share/mise/installs/node", isDirectory: true),
        requiredMajor: requiredMajor))
      candidates.append(contentsOf: t3NodeInstallCandidates(
        in: home.appendingPathComponent(".asdf/installs/nodejs", isDirectory: true),
        requiredMajor: requiredMajor))
      candidates.append(contentsOf: t3NodeInstallCandidates(
        in: home.appendingPathComponent(".nvm/versions/node", isDirectory: true),
        requiredMajor: requiredMajor))
      candidates.append(contentsOf: [
        "/opt/homebrew/opt/node@\(requiredMajor)/bin/node",
        "/usr/local/opt/node@\(requiredMajor)/bin/node",
      ])
    }
    candidates.append(contentsOf: [
      "/opt/homebrew/bin/node",
      "/usr/local/bin/node",
      "/usr/bin/node",
    ])
    if let pathNode = try? resolveCommandPath("node") {
      candidates.append(pathNode)
    }
    var seen: Set<String> = []
    return candidates.filter { candidate in
      let nodePath = expandedPath(candidate)
      return seen.insert(nodePath).inserted
    }
  }

  private static func t3NodeInstallCandidates(in directory: URL, requiredMajor: Int) -> [String] {
    guard
      let entries = try? FileManager.default.contentsOfDirectory(
        at: directory,
        includingPropertiesForKeys: [.isDirectoryKey],
        options: [.skipsHiddenFiles])
    else {
      return []
    }
    return entries
      .filter { entry in
        let name = entry.lastPathComponent
        return name.hasPrefix("node-v\(requiredMajor).")
          || name.hasPrefix("v\(requiredMajor).")
          || name.hasPrefix("\(requiredMajor).")
      }
      .sorted { lhs, rhs in lhs.lastPathComponent.localizedStandardCompare(rhs.lastPathComponent) == .orderedDescending }
      .map { entry in entry.appendingPathComponent("bin/node").path }
  }

  private static func t3NodeRuntimeVersion(at nodePath: String) -> T3NodeRuntimeVersion? {
    let process = Process()
    let pipe = Pipe()
    process.executableURL = URL(fileURLWithPath: nodePath)
    process.arguments = ["-v"]
    process.standardOutput = pipe
    process.standardError = FileHandle.nullDevice
    do {
      try process.run()
    } catch {
      return nil
    }
    process.waitUntilExit()
    guard process.terminationStatus == 0 else {
      return nil
    }
    let rawVersion = (String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? "")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    let components = rawVersion.trimmingCharacters(in: CharacterSet(charactersIn: "v"))
      .split(separator: ".")
      .compactMap { Int(String($0)) }
    guard components.count >= 2 else {
      return nil
    }
    return T3NodeRuntimeVersion(
      major: components[0],
      minor: components[1],
      patch: components.count > 2 ? components[2] : 0,
      raw: rawVersion)
  }

  private static func t3NodeVersionIsSupported(_ version: T3NodeRuntimeVersion) -> Bool {
    (version.major == 22 && version.minor >= 16)
      || (version.major == 23 && version.minor >= 11)
      || (version.major == 24 && version.minor >= 10)
      || version.major > 24
  }

  private static func resolveCommandPath(_ command: String) throws -> String {
    let process = Process()
    let pipe = Pipe()
    process.executableURL = URL(fileURLWithPath: "/bin/zsh")
    process.arguments = ["-lc", "command -v \(shellQuote(command))"]
    process.standardOutput = pipe
    process.standardError = FileHandle.nullDevice
    try process.run()
    process.waitUntilExit()
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    let resolved = String(data: data, encoding: .utf8)?
      .split(whereSeparator: \.isNewline)
      .first
      .map(String.init)
    if process.terminationStatus == 0, let resolved, !resolved.isEmpty {
      return resolved
    }
    throw NSError(
      domain: "NativeT3RuntimeLauncher",
      code: 4,
      userInfo: [NSLocalizedDescriptionKey: "Unable to resolve required runtime command: \(command)."])
  }

  private static func t3HomeDirectory() -> URL {
    GhostexAppStorage.sharedRootDirectory
      .appendingPathComponent("t3-runtime", isDirectory: true)
      .appendingPathComponent("managed-home-t3code-0.0.0", isDirectory: true)
  }

  private static func runtimeStorageDirectory() -> URL {
    GhostexAppStorage.sharedRootDirectory.appendingPathComponent("t3-runtime", isDirectory: true)
  }

  private static func authStateURL() -> URL {
    runtimeStorageDirectory().appendingPathComponent("auth-state.json")
  }

  /**
   CDXC:T3Code 2026-05-01-14:57
   Native T3 runtime adoption must survive ghostex host restarts. Persist the
   same managed auth state used by the extension runtime manager so a freshly
   launched native host can reuse an already-running localhost server and still
   authorize owner-only snapshot/dispatch calls instead of rendering a blank or
   unbound thread page.
   */
  private static func writeAuthState(_ state: [String: Any]) throws {
    try FileManager.default.createDirectory(
      at: runtimeStorageDirectory(), withIntermediateDirectories: true)
    let normalized = state.filter { _, value in !(value is NSNull) }
    let data = try JSONSerialization.data(withJSONObject: normalized, options: [.prettyPrinted])
    try data.write(to: authStateURL(), options: [.atomic])
  }

  static func readPersistedOwnerBearerToken() -> String? {
    let url = authStateURL()
    let authStateMtime = (try? FileManager.default.attributesOfItem(atPath: url.path)[.modificationDate])
      as? Date
    guard let data = try? Data(contentsOf: url),
      let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      (payload["provider"] as? String) == "t3code",
      let ownerBearerToken = payload["ownerBearerToken"] as? String,
      !ownerBearerToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    else {
      NativeT3CodePaneReproLog.append("nativeT3Runtime.ownerBearer.persisted.missing", [
        "path": url.path
      ])
      return nil
    }
    NativeT3CodePaneReproLog.append("nativeT3Runtime.ownerBearer.persisted.read", [
      "ownerBearerLength": ownerBearerToken.count,
      "path": url.path,
      "mtime": authStateMtime.map { ISO8601DateFormatter().string(from: $0) } ?? NSNull(),
    ])
    return ownerBearerToken
  }

  static func readPersistedDesktopBootstrapToken() -> String? {
    let url = authStateURL()
    let authStateMtime = (try? FileManager.default.attributesOfItem(atPath: url.path)[.modificationDate])
      as? Date
    guard let data = try? Data(contentsOf: url),
      let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      (payload["provider"] as? String) == "t3code",
      let desktopBootstrapToken = payload["desktopBootstrapToken"] as? String,
      !desktopBootstrapToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    else {
      NativeT3CodePaneReproLog.append("nativeT3Runtime.bootstrapCredential.persisted.missing", [
        "path": url.path
      ])
      return nil
    }
    /**
     CDXC:T3Code 2026-05-24-17:11:
     Ghostex app restarts lose NativeT3RuntimeLauncher's in-memory desktop
     bootstrap while the managed t3code process can keep running. Recover the
     persisted one-time bootstrap token so the restarted host can mint the
     matching owner bearer instead of replacing a healthy provider or looping
     on `missingCredential`.
     */
    NativeT3CodePaneReproLog.append("nativeT3Runtime.bootstrapCredential.persisted.read", [
      "path": url.path,
      "mtime": authStateMtime.map { ISO8601DateFormatter().string(from: $0) } ?? NSNull(),
    ])
    return desktopBootstrapToken
  }

  static func discardDesktopBootstrapCredential(_ credential: String, reason: String) {
    bootstrapCredentialLock.lock()
    if bootstrapCredential == credential {
      bootstrapCredential = nil
    }
    bootstrapCredentialLock.unlock()

    let url = authStateURL()
    guard let data = try? Data(contentsOf: url),
      let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      (payload["provider"] as? String) == "t3code",
      (payload["desktopBootstrapToken"] as? String) == credential
    else {
      NativeT3CodePaneReproLog.append("nativeT3Runtime.bootstrapCredential.discard.skipped", [
        "path": url.path,
        "reason": reason,
      ])
      return
    }

    var nextState: [String: Any] = ["provider": "t3code"]
    if let ownerBearerToken = payload["ownerBearerToken"] as? String,
      !ownerBearerToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    {
      nextState["ownerBearerToken"] = ownerBearerToken
    }
    do {
      try writeAuthState(nextState)
      NativeT3CodePaneReproLog.append("nativeT3Runtime.bootstrapCredential.discarded", [
        "path": url.path,
        "reason": reason,
      ])
    } catch {
      NativeT3CodePaneReproLog.append("nativeT3Runtime.bootstrapCredential.discard.failed", [
        "error": error.localizedDescription,
        "path": url.path,
        "reason": reason,
      ])
    }
  }

  private static func listeningProcesses(onPort port: Int) -> [NativeT3ListeningProcess] {
    let process = Process()
    let pipe = Pipe()
    process.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
    process.arguments = ["-nP", "-tiTCP:\(port)", "-sTCP:LISTEN"]
    process.standardOutput = pipe
    process.standardError = FileHandle.nullDevice
    do {
      try process.run()
      process.waitUntilExit()
    } catch {
      NativeT3CodePaneReproLog.append("nativeT3Runtime.lsof.failed", [
        "error": error.localizedDescription,
        "port": port,
      ])
      return []
    }
    return String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
      .split(separator: "\n", omittingEmptySubsequences: true)
      .compactMap { Int(String($0).trimmingCharacters(in: .whitespacesAndNewlines)) }
      .map {
        let parentPid = processParentPid(pid: $0)
        return NativeT3ListeningProcess(
          command: processCommand(pid: $0),
          parentCommand: parentPid.map { processCommand(pid: $0) } ?? "",
          parentPid: parentPid ?? 0,
          pid: $0
        )
      } ?? []
  }

  private static func processCommand(pid: Int) -> String {
    let process = Process()
    let pipe = Pipe()
    process.executableURL = URL(fileURLWithPath: "/bin/ps")
    process.arguments = ["-p", String(pid), "-o", "command="]
    process.standardOutput = pipe
    process.standardError = FileHandle.nullDevice
    do {
      try process.run()
      process.waitUntilExit()
    } catch {
      return ""
    }
    return String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
      .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
  }

  private static func processParentPid(pid: Int) -> Int? {
    let process = Process()
    let pipe = Pipe()
    process.executableURL = URL(fileURLWithPath: "/bin/ps")
    process.arguments = ["-p", String(pid), "-o", "ppid="]
    process.standardOutput = pipe
    process.standardError = FileHandle.nullDevice
    do {
      try process.run()
      process.waitUntilExit()
    } catch {
      return nil
    }
    let raw = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
      .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return Int(raw)
  }

  private static func runtimeAgeSeconds(pid: Int) -> Int? {
    let process = Process()
    let pipe = Pipe()
    process.executableURL = URL(fileURLWithPath: "/bin/ps")
    /**
     CDXC:T3Code 2026-05-14-10:23:
     macOS ps does not support Linux's etimes field. Use etime and parse its
     elapsed wall-clock format so startup-grace decisions can retain a still
     booting t3code listener instead of killing it on every liveness probe.
     */
    process.arguments = ["-p", String(pid), "-o", "etime="]
    process.standardOutput = pipe
    process.standardError = FileHandle.nullDevice
    do {
      try process.run()
      process.waitUntilExit()
    } catch {
      return nil
    }
    let raw = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
      .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return parsePsElapsedSeconds(raw)
  }

  private static func parsePsElapsedSeconds(_ raw: String) -> Int? {
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else {
      return nil
    }
    let daySplit = trimmed.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)
    let days: Int
    let timePart: Substring
    if daySplit.count == 2 {
      guard let parsedDays = Int(daySplit[0]) else {
        return nil
      }
      days = parsedDays
      timePart = daySplit[1]
    } else {
      days = 0
      timePart = Substring(trimmed)
    }
    let parts = timePart.split(separator: ":", omittingEmptySubsequences: false)
    guard parts.count == 2 || parts.count == 3 else {
      return nil
    }
    let secondsIndex = parts.count - 1
    let minutesIndex = parts.count - 2
    guard
      let seconds = Int(parts[secondsIndex]),
      let minutes = Int(parts[minutesIndex])
    else {
      return nil
    }
    let hours = parts.count == 3 ? Int(parts[0]) : 0
    guard let hours else {
      return nil
    }
    return days * 86_400 + hours * 3_600 + minutes * 60 + seconds
  }

  private static func isAnyT3RuntimeCommand(_ command: String) -> Bool {
    let normalized = command.lowercased()
    return normalized.contains("t3")
      && normalized.contains("--mode desktop")
      && normalized.contains("--port \(port)")
  }

  /**
   CDXC:T3Code 2026-05-01-12:59
   Attached ghostex windows may share the T3 provider launched by the VS Code
   extension supervisor. Reuse that supervised provider instead of killing it;
   the native WKWebView authenticates through an owner-issued browser pairing
   credential. For unsupervised listeners, only reuse runtimes from this app's
   managed home, bundled resources, or the root t3code submodule.
   */
  private static func isOwnedT3RuntimeProcess(_ process: NativeT3ListeningProcess) -> Bool {
    guard isAnyT3RuntimeCommand(process.command) else {
      return false
    }

    if isT3RuntimeSupervisorCommand(process.parentCommand) {
      return true
    }

    let normalized = process.command.lowercased()
    var ownedMarkers = [
      t3HomeDirectory().path,
    ].map { $0.lowercased() }
    if let repoRootPath = ProcessInfo.processInfo.environment["ghostex_REPO_ROOT"]?.trimmingCharacters(
      in: .whitespacesAndNewlines),
      !repoRootPath.isEmpty
    {
      ownedMarkers.append(
        URL(fileURLWithPath: repoRootPath, isDirectory: true)
          .appendingPathComponent("t3code/apps/server/src/bin.ts").path.lowercased())
    }
    if let resourcePath = Bundle.main.resourceURL?.path {
      ownedMarkers.append(resourcePath.lowercased())
    }
    ownedMarkers.append(Bundle.main.bundleURL.path.lowercased())
    return ownedMarkers.contains { normalized.contains($0) }
  }

  private static func isT3RuntimeSupervisorCommand(_ command: String) -> Bool {
    let normalized = command.lowercased()
    return normalized.contains("t3-runtime-supervisor.js")
      && normalized.contains(".vscode/extensions/maddada.vsmux")
  }

  private static func terminate(pid: Int) {
    kill(pid_t(pid), SIGTERM)
  }

  private static func forceTerminate(pid: Int) {
    kill(pid_t(pid), SIGKILL)
  }

  private static func shellQuote(_ value: String) -> String {
    "'\(value.replacingOccurrences(of: "'", with: "'\\''"))'"
  }

  private static func waitForPortToClear(_ port: Int) {
    let deadline = Date().addingTimeInterval(staleRuntimeShutdownTimeout)
    while Date() < deadline {
      if listeningProcesses(onPort: port).isEmpty {
        return
      }
      Thread.sleep(forTimeInterval: 0.1)
    }
  }
}

private struct NativeT3BootstrapFile {
  let credential: String
  let url: URL
}

struct NativeT3ThreadRoute {
  let environmentId: String
  let projectId: String
  let threadId: String
  let url: URL
}

enum NativeT3RuntimeSessionBootstrap {
  private static let defaultModelSelection: [String: Any] = [
    "model": "gpt-5-codex",
    "provider": "codex",
  ]

  /**
   CDXC:T3Code 2026-04-30-09:23
   T3 Code's desktop root URL is only a boot shell. Native panes must resolve
   enough project and environment identity to load a concrete chat surface
   instead of the blank gray splash surface.
   CDXC:T3Code 2026-05-01-14:31
   T3 Code routes threads by execution environment, not projection
   project. A native pane that navigates to `/{projectId}/{threadId}` can
   authenticate and load React but cannot bind the active thread, leaving the
   user on "No active thread"; always resolve the runtime environment
   descriptor before building the route.
   CDXC:T3Code 2026-06-23-07:21:
   New Ghostex-opened T3 panes must not create server-backed T3 threads until
   the first user message. Use T3 draft routes for missing or pending thread
   ids so the T3 sidebar does not fill with empty real threads, while still
   restoring existing persisted threads through their server routes.
   CDXC:T3Code 2026-06-23-06:09:
   Draft bootstrap retries must reuse the same draft and thread ids for one
   native pane. The WebKit startup retry loop can call this route preparation
   repeatedly before navigation completes, so random ids here create a stream
   of distinct T3 bindings and sidebar sessions.
   */
  static func prepareThreadRoute(
    origin: URL,
    projectId requestedProjectId: String?,
    sessionId: String,
    threadId requestedThreadId: String?,
    title _: String,
    workspaceRoot: String?,
    completion: @escaping (Result<NativeT3ThreadRoute, Error>) -> Void
  ) {
    guard NativeT3RuntimeLauncher.isManagedRuntimeURL(origin) else {
      DispatchQueue.main.async {
        completion(
          .success(NativeT3ThreadRoute(environmentId: "", projectId: "", threadId: "", url: origin)))
      }
      return
    }
    guard let workspaceRoot, !workspaceRoot.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    else {
      DispatchQueue.main.async {
        completion(.failure(error("T3 Code pane is missing its workspace root.")))
      }
      return
    }

    getEnvironmentDescriptor(origin: origin, sessionId: sessionId) { descriptorResult in
      switch descriptorResult {
      case .success(let environment):
        guard let environmentId = environment["environmentId"] as? String,
          !environmentId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
          DispatchQueue.main.async {
            completion(.failure(error("T3 environment descriptor is missing an environment id.")))
          }
          return
        }
        getSnapshot(origin: origin, sessionId: sessionId) { result in
          switch result {
          case .success(let snapshot):
            createThreadRoute(
              origin: origin,
              environmentId: environmentId,
              sessionId: sessionId,
              snapshot: snapshot,
              requestedProjectId: requestedProjectId,
              requestedThreadId: requestedThreadId,
              workspaceRoot: workspaceRoot,
              completion: completion
            )
          case .failure(let error):
            DispatchQueue.main.async { completion(.failure(error)) }
          }
        }
      case .failure(let error):
        DispatchQueue.main.async { completion(.failure(error)) }
      }
    }
  }

  private static func createThreadRoute(
    origin: URL,
    environmentId: String,
    sessionId: String,
    snapshot: [String: Any],
    requestedProjectId: String?,
    requestedThreadId: String?,
    workspaceRoot: String,
    completion: @escaping (Result<NativeT3ThreadRoute, Error>) -> Void
  ) {
    /**
     CDXC:T3Code 2026-05-01-13:28
     Native T3 restore must follow the reference `ensureThreadSession` behavior:
     reuse the stored bound thread when it still exists, choose its project,
     and open a local draft route when the stored thread is pending or missing.
     The draft route carries the stable thread id that T3 will promote on first
     send, so the sidebar can keep Ghostex session metadata in sync without
     creating empty upstream T3 threads.
     */
    let existingThread = findThread(in: snapshot, threadId: requestedThreadId)
    let project =
      findProjectForThread(in: snapshot, thread: existingThread, workspaceRoot: workspaceRoot)
      ?? findProject(in: snapshot, projectId: requestedProjectId, workspaceRoot: workspaceRoot)
      ?? findProject(in: snapshot, workspaceRoot: workspaceRoot)
    let ensureProject: (@escaping (Result<[String: Any], Error>) -> Void) -> Void = { callback in
      if let project {
        callback(.success(project))
        return
      }
      createProject(origin: origin, sessionId: sessionId, workspaceRoot: workspaceRoot, completion: callback)
    }

    ensureProject { projectResult in
      switch projectResult {
      case .success(let project):
        guard let projectId = project["id"] as? String else {
          DispatchQueue.main.async { completion(.failure(error("T3 project is missing an id."))) }
          return
        }
        if let existingThread, let existingThreadId = existingThread["id"] as? String {
          guard
            let route = routeURL(
              origin: origin, environmentId: environmentId, threadId: existingThreadId)
          else {
            DispatchQueue.main.async {
              completion(.failure(error("Failed to build T3 thread route URL.")))
            }
            return
          }
          NativeT3CodePaneReproLog.append("nativeT3Runtime.threadRoute.reused", [
            "projectId": projectId,
            "routeUrl": route.absoluteString,
            "sessionId": sessionId,
            "threadId": existingThreadId,
            "environmentId": environmentId,
            "workspaceRoot": workspaceRoot,
          ])
          DispatchQueue.main.async {
            completion(
              .success(
                NativeT3ThreadRoute(
                  environmentId: environmentId, projectId: projectId, threadId: existingThreadId,
                  url: route)))
          }
          return
        }

        let draftId = stableDraftId(sessionId: sessionId)
        let threadId = stableDraftThreadId(sessionId: sessionId)
        let createdAt = isoNow()
        guard
          let route = draftRouteURL(
            origin: origin,
            draftId: draftId,
            environmentId: environmentId,
            projectId: projectId,
            threadId: threadId,
            createdAt: createdAt)
        else {
          DispatchQueue.main.async {
            completion(.failure(error("Failed to build T3 draft route URL.")))
          }
          return
        }
        NativeT3CodePaneReproLog.append("nativeT3Runtime.threadRoute.draftReady", [
          "projectId": projectId,
          "requestedThreadId": requestedThreadId ?? NSNull(),
          "sessionId": sessionId,
          "threadId": threadId,
          "environmentId": environmentId,
        ])
        DispatchQueue.main.async {
          completion(
            .success(
              NativeT3ThreadRoute(
                environmentId: environmentId, projectId: projectId, threadId: threadId,
                url: route)))
        }
      case .failure(let error):
        DispatchQueue.main.async { completion(.failure(error)) }
      }
    }
  }

  private static func getEnvironmentDescriptor(
    origin: URL,
    sessionId: String,
    completion: @escaping (Result<[String: Any], Error>) -> Void
  ) {
    guard let url = endpointURL(origin: origin, path: "/.well-known/t3/environment") else {
      completion(.failure(error("Invalid T3 environment descriptor URL.")))
      return
    }
    requestJSON(url: url, sessionId: sessionId, method: "GET", body: nil, requiresOwnerBearer: false) {
      result in
      if case .success(let payload) = result {
        NativeT3CodePaneReproLog.append("nativeT3Runtime.environment.loaded", [
          "environmentId": payload["environmentId"] as? String ?? NSNull(),
          "label": payload["label"] as? String ?? NSNull(),
          "sessionId": sessionId,
        ])
      }
      completion(result)
    }
  }

  private static func getSnapshot(
    origin: URL,
    sessionId: String,
    completion: @escaping (Result<[String: Any], Error>) -> Void
  ) {
    guard let url = endpointURL(origin: origin, path: "/api/orchestration/snapshot") else {
      completion(.failure(error("Invalid T3 snapshot URL.")))
      return
    }
    requestJSON(url: url, sessionId: sessionId, method: "GET", body: nil, requiresOwnerBearer: true) {
      result in
      if case .success(let payload) = result {
        NativeT3CodePaneReproLog.append("nativeT3Runtime.snapshot.loaded", [
          "projectCount": (payload["projects"] as? [Any])?.count ?? 0,
          "sessionId": sessionId,
          "threadCount": (payload["threads"] as? [Any])?.count ?? 0,
        ])
      }
      completion(result)
    }
  }

  private static func createProject(
    origin: URL,
    sessionId: String,
    workspaceRoot: String,
    completion: @escaping (Result<[String: Any], Error>) -> Void
  ) {
    let projectId = UUID().uuidString
    let now = isoNow()
    let title = URL(fileURLWithPath: workspaceRoot).lastPathComponent.isEmpty
      ? "project"
      : URL(fileURLWithPath: workspaceRoot).lastPathComponent
    let project: [String: Any] = [
      "createdAt": now,
      "defaultModelSelection": defaultModelSelection,
      "deletedAt": NSNull(),
      "id": projectId,
      "title": title,
      "updatedAt": now,
      "workspaceRoot": workspaceRoot,
    ]
    let command: [String: Any] = [
      "commandId": UUID().uuidString,
      "createdAt": now,
      "defaultModelSelection": defaultModelSelection,
      "projectId": projectId,
      "title": title,
      "type": "project.create",
      "workspaceRoot": workspaceRoot,
    ]
    dispatchCommand(origin: origin, sessionId: sessionId, command: command) { result in
      switch result {
      case .success:
        NativeT3CodePaneReproLog.append("nativeT3Runtime.project.created", [
          "projectId": projectId,
          "sessionId": sessionId,
          "workspaceRoot": workspaceRoot,
        ])
        completion(.success(project))
      case .failure(let error):
        completion(.failure(error))
      }
    }
  }

  private static func dispatchCommand(
    origin: URL,
    sessionId: String,
    command: [String: Any],
    completion: @escaping (Result<[String: Any], Error>) -> Void
  ) {
    guard let url = endpointURL(origin: origin, path: "/api/orchestration/dispatch") else {
      completion(.failure(error("Invalid T3 dispatch URL.")))
      return
    }
    let body = try? JSONSerialization.data(withJSONObject: command, options: [])
    requestJSON(
      url: url,
      sessionId: sessionId,
      method: "POST",
      body: body,
      requiresOwnerBearer: true,
      completion: completion
    )
  }

  private static func requestJSON(
    url: URL,
    sessionId: String,
    method: String,
    body: Data?,
    requiresOwnerBearer: Bool,
    completion: @escaping (Result<[String: Any], Error>) -> Void
  ) {
    var request = URLRequest(url: url)
    request.cachePolicy = .reloadIgnoringLocalCacheData
    request.httpMethod = method
    request.timeoutInterval = 30
    /**
     CDXC:T3Code 2026-05-01-13:46
     T3 orchestration APIs are owner-only management endpoints. For native-
     spawned runtimes, use the owner bearer produced from that runtime's
     desktop bootstrap before falling back to a VS Code-owned bearer. Bearer
     tokens are signed by the runtime's local key, so a VS Code bearer cannot
     manage a separately spawned native server.

     CDXC:T3Code 2026-05-24-17:11:
     Owner-only orchestration requests must fail before network I/O when the
     native owner bearer is not ready. Letting URLSession send a stale browser
     cookie to `/api/orchestration/snapshot` turns a startup/auth race into a
     permanent "Only owner sessions can manage projects" pane error.
     */
    if requiresOwnerBearer {
      request.httpShouldHandleCookies = false
      guard let ownerBearerToken = NativeT3RuntimeBrowserAuth.readOwnerBearerTokenForManagedRuntime()
      else {
        NativeT3CodePaneReproLog.append("nativeT3Runtime.api.ownerBearer.notReady", [
          "method": method,
          "sessionId": sessionId,
          "url": url.absoluteString,
        ])
        completion(.failure(error("T3 owner bearer is not ready for \(method) \(url.path).")))
        return
      }
      request.setValue("Bearer \(ownerBearerToken)", forHTTPHeaderField: "authorization")
    }
    if let body {
      request.httpBody = body
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }
    URLSession.shared.dataTask(with: request) { data, response, requestError in
      let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
      NativeT3CodePaneReproLog.append("nativeT3Runtime.api.response", [
        "bodyBytes": data?.count ?? 0,
        "error": requestError?.localizedDescription ?? NSNull(),
        "method": method,
        "sessionId": sessionId,
        "statusCode": statusCode,
        "url": url.absoluteString,
      ])
      if let requestError {
        completion(.failure(requestError))
        return
      }
      guard (200..<300).contains(statusCode) else {
        let bodyText = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
        completion(.failure(error("T3 API \(method) \(url.path) returned \(statusCode): \(bodyText)")))
        return
      }
      guard let data, !data.isEmpty else {
        completion(.success([:]))
        return
      }
      guard let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        completion(.failure(error("T3 API \(method) \(url.path) did not return JSON.")))
        return
      }
      completion(.success(payload))
    }.resume()
  }

  private static func findProject(in snapshot: [String: Any], workspaceRoot: String) -> [String: Any]? {
    guard let projects = snapshot["projects"] as? [[String: Any]] else {
      return nil
    }
    return projects.first { project in
      let deletedAt = project["deletedAt"]
      let isDeleted = !(deletedAt == nil || deletedAt is NSNull)
      return !isDeleted && project["workspaceRoot"] as? String == workspaceRoot
    }
  }

  private static func findProject(
    in snapshot: [String: Any], projectId: String?, workspaceRoot: String
  ) -> [String: Any]? {
    guard let projectId, !projectId.hasPrefix("native-"),
      let projects = snapshot["projects"] as? [[String: Any]]
    else {
      return nil
    }
    return projects.first { project in
      let deletedAt = project["deletedAt"]
      let isDeleted = !(deletedAt == nil || deletedAt is NSNull)
      return !isDeleted && project["id"] as? String == projectId
        && project["workspaceRoot"] as? String == workspaceRoot
    }
  }

  private static func findProjectForThread(
    in snapshot: [String: Any], thread: [String: Any]?, workspaceRoot: String
  ) -> [String: Any]? {
    guard let projectId = thread?["projectId"] as? String else {
      return nil
    }
    return findProject(in: snapshot, projectId: projectId, workspaceRoot: workspaceRoot)
  }

  private static func findThread(in snapshot: [String: Any], threadId: String?) -> [String: Any]? {
    guard let threadId = threadId?.trimmingCharacters(in: .whitespacesAndNewlines),
      !threadId.isEmpty,
      !threadId.hasPrefix("pending-"),
      let threads = snapshot["threads"] as? [[String: Any]]
    else {
      return nil
    }
    return threads.first { thread in
      let deletedAt = thread["deletedAt"]
      let isDeleted = !(deletedAt == nil || deletedAt is NSNull)
      return !isDeleted && thread["id"] as? String == threadId
    }
  }

  private static func endpointURL(origin: URL, path: String) -> URL? {
    var components = URLComponents()
    components.scheme = origin.scheme ?? "http"
    components.host = origin.host
    components.port = origin.port
    components.path = path
    return components.url
  }

  private static func routeURL(origin: URL, environmentId: String, threadId: String) -> URL? {
    var components = URLComponents()
    components.scheme = origin.scheme ?? "http"
    components.host = origin.host
    components.port = origin.port
    components.path = "/\(environmentId)/\(threadId)"
    return components.url
  }

  private static func draftRouteURL(
    origin: URL,
    draftId: String,
    environmentId: String,
    projectId: String,
    threadId: String,
    createdAt: String
  ) -> URL? {
    var components = URLComponents()
    components.scheme = origin.scheme ?? "http"
    components.host = origin.host
    components.port = origin.port
    components.path = "/draft/\(draftId)"
    components.queryItems = [
      URLQueryItem(name: "ghostexDraft", value: "1"),
      URLQueryItem(name: "environmentId", value: environmentId),
      URLQueryItem(name: "projectId", value: projectId),
      URLQueryItem(name: "threadId", value: threadId),
      URLQueryItem(name: "createdAt", value: createdAt),
    ]
    return components.url
  }

  private static func stableDraftId(sessionId: String) -> String {
    "ghostex-draft-\(stableDraftIdentityComponent(sessionId))"
  }

  private static func stableDraftThreadId(sessionId: String) -> String {
    "ghostex-thread-\(stableDraftIdentityComponent(sessionId))"
  }

  private static func stableDraftIdentityComponent(_ sessionId: String) -> String {
    let allowed = CharacterSet.alphanumerics
    let normalized = sessionId.lowercased().unicodeScalars.map { scalar -> String in
      allowed.contains(scalar) ? String(scalar) : "-"
    }.joined()
    let trimmed = normalized.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
    return trimmed.isEmpty ? "session" : trimmed
  }

  private static func isoNow() -> String {
    ISO8601DateFormatter().string(from: Date())
  }

  private static func error(_ message: String) -> NSError {
    NSError(
      domain: "NativeT3RuntimeSessionBootstrap",
      code: 1,
      userInfo: [NSLocalizedDescriptionKey: message]
    )
  }
}

enum NativeT3RuntimeFailureNotice {
  static let autoStartBackoffInterval: TimeInterval = 60.0
  static let message =
    "T3 Code runtime failed to start. Ghostex paused auto-retry; send support logs to report this."

  /**
   CDXC:T3CodeStartup 2026-06-09-07:07:
   T3 runtime failure feedback must be short and privacy-safe because it is shown
   in a user-facing toast and written into pane error state. Keep the retry
   pause tied to actual launch/auth failures so passive liveness checks do not
   repaint existing T3 panes every ten seconds while terminal input is active.
   */
  static func error(reason: String) -> NSError {
    NSError(
      domain: "NativeT3RuntimeFailureNotice",
      code: 1,
      userInfo: [NSLocalizedDescriptionKey: message, "reason": reason]
    )
  }

  static func shouldNotifyLaunchExit(status: Int32) -> Bool {
    status != 0 && status != 15 && status != 130 && status != 143
  }
}

enum NativeT3RuntimeBrowserAuth {
  private static let authRetryDelay: TimeInterval = 0.5
  private static let authRequestTimeout: TimeInterval = 3
  private static let maxAuthAttempts = 40
  private static let queue = DispatchQueue(label: "com.madda.ghostex.t3-browser-auth")
  private static var isAuthenticating = false
  private static var pendingCompletions:
    [(sessionId: String, completion: (Result<Void, Error>) -> Void)] = []

  /**
   CDXC:T3Code 2026-04-30-09:10
   Native T3 Code panes must render the already-owned desktop provider, not the
   unauthenticated pairing shell. Before WKWebView loads the app, exchange the
   desktop bootstrap credential for a scoped owner bearer through upstream's
   OAuth token exchange, then mint the browser-session cookie through
   `/api/auth/browser-session`. Serialize exchanges because the desktop
   bootstrap credential is single-use. If the pane command arrives before the
   runtime-start command registers that credential, retry auth instead of
   loading the unauthenticated boot shell.
   CDXC:T3CodeUpstreamReset 2026-06-22-22:47:
   Upstream main removed the older `/api/auth/bootstrap` and
   `/api/auth/bootstrap/bearer` endpoints. Use `/oauth/token` for owner
   bearer access and `/api/auth/browser-session` for WKWebView cookies so the
   native pane follows the current upstream auth contract exactly.
   */
  static func prepareManagedWebSession(
    for url: URL,
    sessionId: String,
    completion: @escaping (Result<Void, Error>) -> Void
  ) {
    guard NativeT3RuntimeLauncher.isManagedRuntimeURL(url) else {
      DispatchQueue.main.async {
        completion(.success(()))
      }
      return
    }

    queue.async {
      pendingCompletions.append((sessionId: sessionId, completion: completion))
      guard !isAuthenticating else {
        NativeT3CodePaneReproLog.append("nativeT3Runtime.browserAuth.queued", [
          "pendingCount": pendingCompletions.count,
          "sessionId": sessionId,
        ])
        return
      }
      isAuthenticating = true
      checkSession(origin: url, attemptsRemaining: maxAuthAttempts)
    }
  }

  private static func checkSession(origin: URL, attemptsRemaining: Int) {
    guard let sessionURL = endpointURL(origin: origin, path: "/api/auth/session") else {
      finishPending(
        reason: "invalidSessionUrl",
        result: .failure(NativeT3RuntimeFailureNotice.error(reason: "invalidSessionUrl")))
      return
    }
    var request = URLRequest(url: sessionURL)
    request.cachePolicy = .reloadIgnoringLocalCacheData
    /**
     CDXC:T3Code 2026-04-30-09:30
     Native T3 panes can begin auth while the managed provider is being
     replaced. Session probes must fail quickly so the existing retry loop
     can catch the newly launched provider instead of leaving a gray pane
     until URLSession's default timeout expires.
     */
    request.timeoutInterval = authRequestTimeout
    URLSession.shared.dataTask(with: request) { data, response, error in
      let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
      let authenticated = parseAuthenticated(data)
      NativeT3CodePaneReproLog.append("nativeT3Runtime.browserAuth.session.response", [
        "authenticated": authenticated ?? NSNull(),
        "error": error?.localizedDescription ?? NSNull(),
        "statusCode": statusCode,
        "url": sessionURL.absoluteString,
      ])

      if authenticated == true,
        NativeT3RuntimeLauncher.currentOwnerBearerToken() != nil
          || NativeT3RuntimeLauncher.readPersistedOwnerBearerToken() != nil
      {
        finishPending(reason: "alreadyAuthenticatedWithNativeOwnerBearer")
        return
      }
      if authenticated == true {
        /**
         CDXC:T3Code 2026-05-01-15:07
         Browser auth alone is insufficient for native T3 panes because thread
         routing performs owner-only orchestration HTTP calls outside WKWebView.
         Continue through the desktop bootstrap exchange until ghostex owns the
         matching bearer for this runtime, rather than trusting a stale cookie.
         */
        NativeT3CodePaneReproLog.append("nativeT3Runtime.browserAuth.session.nativeOwnerMissing", [
          "authenticated": true,
          "statusCode": statusCode,
          "url": sessionURL.absoluteString,
        ])
      }
      exchangeBootstrapCredential(origin: origin, attemptsRemaining: attemptsRemaining)
    }.resume()
  }

  private static func exchangeBootstrapCredential(origin: URL, attemptsRemaining: Int) {
    guard
      let credential =
        NativeT3RuntimeLauncher.currentBootstrapCredential()
        ?? NativeT3RuntimeLauncher.readPersistedDesktopBootstrapToken()
    else {
      exchangeExtensionPairingCredential(
        origin: origin,
        attemptsRemaining: attemptsRemaining,
        originalReason: "missingCredential"
      )
      return
    }
    exchangeNativeBootstrapForOwnerBearer(
      origin: origin,
      credential: credential,
      attemptsRemaining: attemptsRemaining
    )
  }

  /**
   CDXC:T3Code 2026-05-01-13:45
   The native-spawned t3code server signs bearer sessions with its own local
   key. Match the reference runtime manager by exchanging the desktop bootstrap
   for a scoped owner access token first, then deriving the browser session
   from that owner bearer. Spending the bootstrap directly on a browser cookie
   leaves orchestration calls using an unrelated VS Code bearer and produces
   `Invalid session token signature` 500s instead of creating/restoring the
   requested thread.
   */
  private static func exchangeNativeBootstrapForOwnerBearer(
    origin: URL,
    credential: String,
    attemptsRemaining: Int
  ) {
    guard let bearerURL = endpointURL(origin: origin, path: "/oauth/token") else {
      finishPending(
        reason: "invalidTokenExchangeUrl",
        result: .failure(NativeT3RuntimeFailureNotice.error(reason: "invalidTokenExchangeUrl")))
      return
    }

    var request = URLRequest(url: bearerURL)
    request.cachePolicy = .reloadIgnoringLocalCacheData
    request.httpMethod = "POST"
    request.timeoutInterval = authRequestTimeout
    request.httpShouldHandleCookies = false
    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    request.httpBody = formURLEncodedData([
      ("grant_type", "urn:ietf:params:oauth:grant-type:token-exchange"),
      ("subject_token", credential),
      ("subject_token_type", "urn:t3:params:oauth:token-type:environment-bootstrap"),
      ("requested_token_type", "urn:ietf:params:oauth:token-type:access_token"),
      (
        "scope",
        "orchestration:read orchestration:operate terminal:operate review:write relay:read access:read access:write relay:write"
      ),
      ("client_label", "Ghostex Native"),
      ("client_device_type", "desktop"),
      ("client_os", "macOS"),
    ])
    NativeT3CodePaneReproLog.append("nativeT3Runtime.ownerBearer.bootstrap.start", [
      "credentialPresent": true,
      "url": bearerURL.absoluteString,
    ])
    URLSession.shared.dataTask(with: request) { data, response, error in
      guard let httpResponse = response as? HTTPURLResponse else {
        NativeT3CodePaneReproLog.append("nativeT3Runtime.ownerBearer.bootstrap.noResponse", [
          "error": error?.localizedDescription ?? NSNull(),
          "url": bearerURL.absoluteString,
        ])
        retryAuth(origin: origin, reason: "bearerBootstrapNoResponse", attemptsRemaining: attemptsRemaining)
        return
      }

      let ownerBearerToken = parseAccessToken(data)
      NativeT3CodePaneReproLog.append("nativeT3Runtime.ownerBearer.bootstrap.response", [
        "error": error?.localizedDescription ?? NSNull(),
        "ownerBearerPresent": ownerBearerToken != nil,
        "statusCode": httpResponse.statusCode,
        "url": bearerURL.absoluteString,
      ])
      guard httpResponse.statusCode == 200, let ownerBearerToken else {
        if httpResponse.statusCode == 401 {
          if let extensionOwnerBearerToken = readVSmuxOwnerBearerToken() {
            exchangePairingCredential(
              origin: origin,
              ownerBearerToken: extensionOwnerBearerToken,
              ownerBearerSource: "extensionOwnerBearer",
              attemptsRemaining: attemptsRemaining,
              originalReason: "bearerBootstrapStatus401"
            )
            return
          }
          /**
           CDXC:T3Code 2026-05-24-17:29:
           The desktop bootstrap token is one-time auth material. A 401 from the
           managed runtime means this listener cannot become owner-authenticated
           by retrying the same token, so discard it and stop the stale runtime
           immediately instead of waiting through startup grace.
           */
          NativeT3RuntimeLauncher.discardDesktopBootstrapCredential(
            credential,
            reason: "bearerBootstrapStatus401"
          )
          NativeT3RuntimeLauncher.clearStaleRuntimeIfNeeded(
            logPrefix: "nativeT3Runtime.browserAuth",
            forceOwnedRuntimeStop: true
          )
          retryAuth(
            origin: origin,
            reason: "bearerBootstrapStatus401RuntimeReplaced",
            attemptsRemaining: attemptsRemaining
          )
          return
        }
        retryAuth(
          origin: origin,
          reason: "bearerBootstrapStatus\(httpResponse.statusCode)",
          attemptsRemaining: attemptsRemaining
        )
        return
      }

      NativeT3RuntimeLauncher.clearBootstrapCredential(credential)
      NativeT3RuntimeLauncher.rememberOwnerBearerToken(ownerBearerToken)
      exchangePairingCredential(
        origin: origin,
        ownerBearerToken: ownerBearerToken,
        ownerBearerSource: "nativeDesktopBootstrap",
        attemptsRemaining: attemptsRemaining,
        originalReason: "nativeOwnerBearerReady"
      )
    }.resume()
  }

  private static func exchangeBrowserCredential(
    origin: URL,
    credential: String,
    credentialSource: String,
    clearStoredCredentialOnSuccess: Bool,
    attemptsRemaining: Int
  ) {
    guard let bootstrapURL = endpointURL(origin: origin, path: "/api/auth/browser-session") else {
      finishPending(
        reason: "invalidBootstrapUrl",
        result: .failure(NativeT3RuntimeFailureNotice.error(reason: "invalidBootstrapUrl")))
      return
    }

    var request = URLRequest(url: bootstrapURL)
    request.cachePolicy = .reloadIgnoringLocalCacheData
    request.httpMethod = "POST"
    request.timeoutInterval = authRequestTimeout
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try? JSONSerialization.data(withJSONObject: ["credential": credential])
    NativeT3CodePaneReproLog.append("nativeT3Runtime.browserAuth.bootstrap.start", [
      "credentialPresent": true,
      "credentialSource": credentialSource,
      "url": bootstrapURL.absoluteString,
    ])
    URLSession.shared.dataTask(with: request) { data, response, error in
      guard let httpResponse = response as? HTTPURLResponse else {
        NativeT3CodePaneReproLog.append("nativeT3Runtime.browserAuth.bootstrap.noResponse", [
          "error": error?.localizedDescription ?? NSNull(),
          "url": bootstrapURL.absoluteString,
        ])
        retryAuth(origin: origin, reason: "bootstrapNoResponse", attemptsRemaining: attemptsRemaining)
        return
      }

      let headers = httpResponse.allHeaderFields.reduce(into: [String: String]()) { result, entry in
        if let key = entry.key as? String {
          result[key] = String(describing: entry.value)
        }
      }
      let cookies = HTTPCookie.cookies(withResponseHeaderFields: headers, for: bootstrapURL)
      NativeT3CodePaneReproLog.append("nativeT3Runtime.browserAuth.bootstrap.response", [
        "authenticated": parseAuthenticated(data) ?? NSNull(),
        "cookieCount": cookies.count,
        "credentialSource": credentialSource,
        "error": error?.localizedDescription ?? NSNull(),
        "statusCode": httpResponse.statusCode,
        "url": bootstrapURL.absoluteString,
      ])

      guard httpResponse.statusCode == 200 else {
        if credentialSource == "nativeDesktopBootstrap", httpResponse.statusCode == 401 {
          exchangeExtensionPairingCredential(
            origin: origin,
            attemptsRemaining: attemptsRemaining,
            originalReason: "bootstrapStatus401"
          )
          return
        }
        retryAuth(
          origin: origin,
          reason: "bootstrapStatus\(httpResponse.statusCode)",
          attemptsRemaining: attemptsRemaining
        )
        return
      }
      if clearStoredCredentialOnSuccess {
        NativeT3RuntimeLauncher.clearBootstrapCredential(credential)
      }
      setCookies(cookies, reason: "bootstrapComplete")
    }.resume()
  }

  /**
   CDXC:T3Code 2026-05-01-12:59
   When ghostex is attached to VS Code, the extension may already own the desktop
   T3 provider and consume the single-use desktop bootstrap through the bearer
   endpoint. Native WKWebView panes must then mint a browser pairing credential
   from the extension-owned owner bearer and exchange that one-time credential
   for cookies, instead of retrying the stale desktop token until the pane
   falls through to the gray/500 error surface.
   */
  private static func exchangeExtensionPairingCredential(
    origin: URL,
    attemptsRemaining: Int,
    originalReason: String
  ) {
    guard let ownerBearerToken = readVSmuxOwnerBearerToken() else {
      retryAuth(origin: origin, reason: originalReason, attemptsRemaining: attemptsRemaining)
      return
    }
    exchangePairingCredential(
      origin: origin,
      ownerBearerToken: ownerBearerToken,
      ownerBearerSource: "extensionOwnerBearer",
      attemptsRemaining: attemptsRemaining,
      originalReason: originalReason
    )
  }

  private static func exchangePairingCredential(
    origin: URL,
    ownerBearerToken: String,
    ownerBearerSource: String,
    attemptsRemaining: Int,
    originalReason: String
  ) {
    guard let pairingURL = endpointURL(origin: origin, path: "/api/auth/pairing-token") else {
      finishPending(
        reason: "invalidPairingUrl",
        result: .failure(NativeT3RuntimeFailureNotice.error(reason: "invalidPairingUrl")))
      return
    }

    var request = URLRequest(url: pairingURL)
    request.cachePolicy = .reloadIgnoringLocalCacheData
    request.httpMethod = "POST"
    request.timeoutInterval = authRequestTimeout
    /**
     CDXC:T3Code 2026-05-01-13:08
     T3 authenticates cookies before bearer headers. Native pairing requests
     must not inherit stale URLSession cookies, otherwise the server rejects
     the old cookie and never evaluates the valid VS Code owner bearer.

     CDXC:T3CodeUpstreamReset 2026-06-22-22:52:
     Current upstream validates the pairing-token request as JSON. Send an
     explicit empty object instead of a typeless zero-length POST so the bearer
     owner can mint the one-time browser credential.
     */
    request.httpShouldHandleCookies = false
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try? JSONSerialization.data(withJSONObject: [:])
    request.setValue("Bearer \(ownerBearerToken)", forHTTPHeaderField: "authorization")
    NativeT3CodePaneReproLog.append("nativeT3Runtime.browserAuth.pairing.start", [
      "ownerBearerLength": ownerBearerToken.count,
      "ownerBearerSource": ownerBearerSource,
      "originalReason": originalReason,
      "url": pairingURL.absoluteString,
    ])
    URLSession.shared.dataTask(with: request) { data, response, error in
      guard let httpResponse = response as? HTTPURLResponse else {
        NativeT3CodePaneReproLog.append("nativeT3Runtime.browserAuth.pairing.noResponse", [
          "error": error?.localizedDescription ?? NSNull(),
          "originalReason": originalReason,
          "url": pairingURL.absoluteString,
        ])
        retryAuth(origin: origin, reason: originalReason, attemptsRemaining: attemptsRemaining)
        return
      }

      let credential = parseCredential(data)
      NativeT3CodePaneReproLog.append("nativeT3Runtime.browserAuth.pairing.response", [
        "credentialPresent": credential != nil,
        "error": error?.localizedDescription ?? NSNull(),
        "ownerBearerSource": ownerBearerSource,
        "originalReason": originalReason,
        "statusCode": httpResponse.statusCode,
        "url": pairingURL.absoluteString,
      ])
      guard httpResponse.statusCode == 200, let credential else {
        retryAuth(
          origin: origin,
          reason: "pairingStatus\(httpResponse.statusCode)",
          attemptsRemaining: attemptsRemaining
        )
        return
      }
      exchangeBrowserCredential(
        origin: origin,
        credential: credential,
        credentialSource: "\(ownerBearerSource)Pairing",
        clearStoredCredentialOnSuccess: false,
        attemptsRemaining: attemptsRemaining
      )
    }.resume()
  }

  private static func retryAuth(origin: URL, reason: String, attemptsRemaining: Int) {
    guard attemptsRemaining > 0 else {
      NativeT3CodePaneReproLog.append("nativeT3Runtime.browserAuth.retry.exhausted", [
        "reason": reason,
        "url": origin.absoluteString,
      ])
      finishPending(
        reason: reason,
        result: .failure(NativeT3RuntimeFailureNotice.error(reason: reason)))
      return
    }

    NativeT3CodePaneReproLog.append("nativeT3Runtime.browserAuth.retry.scheduled", [
      "attemptsRemaining": attemptsRemaining,
      "reason": reason,
      "url": origin.absoluteString,
    ])
    queue.asyncAfter(deadline: .now() + authRetryDelay) {
      checkSession(origin: origin, attemptsRemaining: attemptsRemaining - 1)
    }
  }

  private static func setCookies(_ cookies: [HTTPCookie], reason: String) {
    DispatchQueue.main.async {
      guard !cookies.isEmpty else {
        finishPending(
          reason: "\(reason)NoCookies",
          result: .failure(NativeT3RuntimeFailureNotice.error(reason: "\(reason)NoCookies")))
        return
      }

      let group = DispatchGroup()
      let store = WKWebsiteDataStore.default().httpCookieStore
      for cookie in cookies {
        group.enter()
        store.setCookie(cookie) {
          NativeT3CodePaneReproLog.append("nativeT3Runtime.browserAuth.cookie.set", [
            "domain": cookie.domain,
            "expiresDate": cookie.expiresDate?.description ?? NSNull(),
            "name": cookie.name,
            "path": cookie.path,
          ])
          group.leave()
        }
      }
      group.notify(queue: .main) {
        finishPending(reason: reason, result: .success(()))
      }
    }
  }

  private static func finishPending(
    reason: String,
    result: Result<Void, Error> = .success(())
  ) {
    queue.async {
      let completions = pendingCompletions
      pendingCompletions = []
      isAuthenticating = false
      NativeT3CodePaneReproLog.append("nativeT3Runtime.browserAuth.finish", [
        "completionCount": completions.count,
        "reason": reason,
        "sessionIds": completions.map(\.sessionId),
      ])
      DispatchQueue.main.async {
        completions.forEach { $0.completion(result) }
      }
    }
  }

  private static func endpointURL(origin: URL, path: String) -> URL? {
    var components = URLComponents()
    components.scheme = origin.scheme ?? "http"
    components.host = origin.host
    components.port = origin.port
    components.path = path
    return components.url
  }

  private static func formURLEncodedData(_ fields: [(String, String)]) -> Data {
    var components = URLComponents()
    components.queryItems = fields.map { URLQueryItem(name: $0.0, value: $0.1) }
    return Data((components.percentEncodedQuery ?? "").utf8)
  }

  private static func parseAuthenticated(_ data: Data?) -> Bool? {
    guard let data,
      let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let authenticated = payload["authenticated"] as? Bool
    else {
      return nil
    }
    return authenticated
  }

  private static func parseCredential(_ data: Data?) -> String? {
    guard let data,
      let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let credential = payload["credential"] as? String,
      !credential.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    else {
      return nil
    }
    return credential
  }

  private static func parseAccessToken(_ data: Data?) -> String? {
    guard let data,
      let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let accessToken = payload["access_token"] as? String,
      !accessToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    else {
      return nil
    }
    return accessToken
  }

  fileprivate static func readOwnerBearerTokenForManagedRuntime() -> String? {
    if let ownerBearerToken = NativeT3RuntimeLauncher.currentOwnerBearerToken() {
      NativeT3CodePaneReproLog.append("nativeT3Runtime.ownerBearer.native.read", [
        "ownerBearerLength": ownerBearerToken.count
      ])
      return ownerBearerToken
    }
    if let ownerBearerToken = NativeT3RuntimeLauncher.readPersistedOwnerBearerToken() {
      return ownerBearerToken
    }
    return readVSmuxOwnerBearerToken()
  }

  fileprivate static func readVSmuxOwnerBearerToken() -> String? {
    let authStateURL = FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent(
        "Library/Application Support/Code/User/globalStorage/maddada.vsmux/t3-runtime/auth-state.json"
      )
    let authStateMtime = (try? FileManager.default.attributesOfItem(atPath: authStateURL.path)[.modificationDate])
      as? Date
    guard let data = try? Data(contentsOf: authStateURL),
      let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let ownerBearerToken = payload["ownerBearerToken"] as? String,
      !ownerBearerToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    else {
      NativeT3CodePaneReproLog.append("nativeT3Runtime.browserAuth.pairing.authStateMissing", [
        "path": authStateURL.path
      ])
      return nil
    }
    /**
     CDXC:T3Code 2026-05-01-13:10
     Owner-bearer pairing is the native/VS Code handoff for attached ghostex
     windows. Log only non-secret auth-state metadata so a 401 can be
     distinguished between stale file reads and rejected HTTP credentials.
     */
    NativeT3CodePaneReproLog.append("nativeT3Runtime.browserAuth.pairing.authStateRead", [
      "ownerBearerLength": ownerBearerToken.count,
      "path": authStateURL.path,
      "mtime": authStateMtime.map { ISO8601DateFormatter().string(from: $0) } ?? NSNull(),
    ])
    return ownerBearerToken
  }
}

private struct NativeT3ListeningProcess {
  let command: String
  let parentCommand: String
  let parentPid: Int
  let pid: Int
}
