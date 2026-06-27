import Foundation

enum GhostexAppStorage {
  private struct SharedSidebarStorageFile {
    let fileName: String
    let localStorageKey: String
  }

  private struct LegacyLocalStorageValueCandidate {
    let databasePath: String
    let modifiedAt: TimeInterval
    let value: String
  }

  private static let sharedSidebarStorageFiles: [String: SharedSidebarStorageFile] = [
    "settings": SharedSidebarStorageFile(
      fileName: "native-sidebar-settings.json",
      localStorageKey: "ghostex-native-settings"),
  ]

  /**
   CDXC:ProjectSidebarOwnership 2026-06-02-12:29:
   gxserver owns canonical project, worktree, session, and shared sidebar presentation state after the hard cutover. The macOS host must not expose `native-sidebar-projects.json` as active shared sidebar storage or copy WK `ghostex-native-projects` back into that file; native project localStorage is only a window-local pane/layout cache while gxserver supplies shared inventory through its APIs.

   CDXC:PreviousSessions 2026-06-02-12:44:
   gxserver owns previous-session history and search results after the hard cutover. The macOS host must not expose `native-sidebar-previous-sessions.json` as active shared sidebar storage or copy WK `ghostex-native-previous-sessions` back into that file; legacy previous-session imports belong to gxserver's migration path, while the native sidebar requests current history through gxserver APIs.
   */

  /**
   CDXC:DevAppFlavor 2026-04-28-02:01
   Bundle metadata owns the diagnostic and workflow directory names so
   LaunchServices launches get the same storage split as shell-launched builds.
   CDXC:DevAppFlavor 2026-05-11-12:10
   Legacy ghostex-dev bundle metadata must not share settings, projects,
   sessions, hooks, browser profiles, or runtime files with the installed app.
   ghostex-dev therefore points both diagnostics and shared workflow state at
   ~/.ghostex-dev.
   CDXC:LocalStartSingleApp 2026-06-09-09:27
   Local dev start and build entry points were removed so agents stop launching
   the alternate app by mistake; keep bundle-derived storage names only for old
   bundles that already exist.
   */
  static var diagnosticsHomeDirectoryName: String {
    let candidate = Bundle.main.object(forInfoDictionaryKey: "GHOSTEXHomeDirectoryName") as? String
    let trimmed = candidate?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return trimmed.isEmpty ? ".ghostex" : trimmed
  }

  static var sharedHomeDirectoryName: String {
    let candidate = Bundle.main.object(forInfoDictionaryKey: "GHOSTEXSharedHomeDirectoryName")
      as? String
    let trimmed = candidate?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return trimmed.isEmpty ? ".ghostex" : trimmed
  }

  static var diagnosticsRootDirectory: URL {
    FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(
      diagnosticsHomeDirectoryName, isDirectory: true)
  }

  static var sharedRootDirectory: URL {
    FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(
      sharedHomeDirectoryName, isDirectory: true)
  }

  static var sharedStateDirectory: URL {
    sharedRootDirectory.appendingPathComponent("state", isDirectory: true)
  }

  /**
   CDXC:AppIconPicker 2026-06-25-21:50:
   User-supplied app icons live in ~/.ghostex/icons (the shared home, so
   ghostex-dev keeps its own ~/.ghostex-dev/icons). Masked 1024² squircle PNGs
   are cached under a sibling cache directory keyed to source filename+mtime.
   Both directories are created lazily, mirroring the ~/.ghostex state-dir
   handling above.
   */
  static var iconsDirectory: URL {
    sharedRootDirectory.appendingPathComponent("icons", isDirectory: true)
  }

  static var maskedIconCacheDirectory: URL {
    sharedStateDirectory.appendingPathComponent("app-icon-cache", isDirectory: true)
  }

  // CDXC:AppIconPicker 2026-06-25-21:50: Create the icons and masked-cache directories on first run so the picker, file copy, Finder reveal, and cache writes all have a stable home. Best-effort; failures fall back to the default icon.
  @discardableResult
  static func ensureAppIconDirectories() -> Bool {
    do {
      try FileManager.default.createDirectory(
        at: iconsDirectory, withIntermediateDirectories: true)
      try FileManager.default.createDirectory(
        at: maskedIconCacheDirectory, withIntermediateDirectories: true)
      return true
    } catch {
      return false
    }
  }

  /**
   CDXC:AppIconPicker 2026-06-25-21:50:
   Folder scan for the sidebar picker. Enumerate *.png in ~/.ghostex/icons,
   keep only files that pass the AppIconImage guardrails (PNG magic bytes,
   <=5MB, header dims <=2048), sort by contentModificationDate descending with a
   filename tiebreak, take the 10 most recent, then always include the selected
   id if it is a valid file not already in that set. Returns just filenames; no
   absolute paths leave this function.
   */
  static func scanAppIconFileNames(selectedId: String) -> [String] {
    ensureAppIconDirectories()
    let directory = iconsDirectory
    guard let entries = try? FileManager.default.contentsOfDirectory(
      at: directory,
      includingPropertiesForKeys: [.contentModificationDateKey],
      options: [.skipsHiddenFiles]
    ) else {
      return appendSelectedAppIconIfValid(to: [], selectedId: selectedId)
    }

    struct AppIconFileEntry {
      let fileName: String
      let modifiedAt: TimeInterval
    }

    let validEntries: [AppIconFileEntry] = entries.compactMap { url in
      guard url.pathExtension.lowercased() == "png" else {
        return nil
      }
      guard AppIconImage.isValidSourcePNG(at: url) else {
        return nil
      }
      let modifiedAt =
        (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate)?
        .timeIntervalSince1970 ?? 0
      return AppIconFileEntry(fileName: url.lastPathComponent, modifiedAt: modifiedAt)
    }

    let sorted = validEntries.sorted { lhs, rhs in
      if lhs.modifiedAt != rhs.modifiedAt {
        return lhs.modifiedAt > rhs.modifiedAt
      }
      return lhs.fileName < rhs.fileName
    }

    let topFileNames = sorted.prefix(10).map { $0.fileName }
    return appendSelectedAppIconIfValid(to: Array(topFileNames), selectedId: selectedId)
  }

  // CDXC:AppIconPicker 2026-06-25-21:50: Always include the persisted selection so a selected-but-older icon never disappears from the list even when 10 newer icons exist. Ignores "" (default) and invalid/missing files.
  private static func appendSelectedAppIconIfValid(
    to fileNames: [String],
    selectedId: String
  ) -> [String] {
    /**
     CDXC:AppIconPicker 2026-06-26-23:42:
     The persisted selected id must pass the same filename-only validation as
     runtime set/apply paths before joining it to ~/.ghostex/icons. Invalid
     persisted values are treated as absent instead of scanning outside the
     managed folder.
     */
    guard let trimmed = AppIconImage.normalizedSourceId(selectedId), !fileNames.contains(trimmed) else {
      return fileNames
    }
    let url = iconsDirectory.appendingPathComponent(trimmed, isDirectory: false)
    guard AppIconImage.isValidSourcePNG(at: url) else {
      return fileNames
    }
    return fileNames + [trimmed]
  }

  static var logsDirectory: URL {
    diagnosticsRootDirectory.appendingPathComponent("logs", isDirectory: true)
  }

  static var cliDirectory: URL {
    sharedRootDirectory.appendingPathComponent("cli", isDirectory: true)
  }

  static var cliBridgeTokenURL: URL {
    cliDirectory.appendingPathComponent("bridge-token")
  }

  static var sharedSidebarSettingsURL: URL {
    sharedStateDirectory.appendingPathComponent("native-sidebar-settings.json")
  }

  static func readSharedSidebarStorage() -> [String: String] {
    sharedSidebarStorageFiles.reduce(into: [String: String]()) { result, entry in
      let key = entry.key
      let file = entry.value
      let sharedValue = readSharedSidebarStorageFile(file.fileName)
      let legacyValue = readLegacyDefaultAppLocalStorageValue(key: file.localStorageKey)
      let selectedValue = selectSharedSidebarStorageValue(
        sharedValue: sharedValue,
        legacyValue: legacyValue
      )
      if selectedValue == legacyValue, sharedValue != legacyValue, let selectedValue {
        try? persistSharedSidebarStorage(key: key, payloadJson: selectedValue)
      }
      if let selectedValue,
        selectedValue == sharedValue,
        !isSharedSidebarStorageFileNormalized(file.fileName, payloadJson: selectedValue)
      {
        try? persistSharedSidebarStorage(key: key, payloadJson: selectedValue)
      }
      if let selectedValue {
        result[key] = selectedValue
      }
    }
  }

  static func persistSharedSidebarStorage(key: String, payloadJson: String) throws {
    guard let file = sharedSidebarStorageFiles[key] else {
      throw NSError(
        domain: "GhostexAppStorage",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Unknown shared sidebar storage key: \(key)"])
    }
    guard let data = payloadJson.data(using: .utf8) else {
      throw NSError(
        domain: "GhostexAppStorage",
        code: 2,
        userInfo: [NSLocalizedDescriptionKey: "Shared sidebar storage payload is not UTF-8."])
    }
    _ = try JSONSerialization.jsonObject(with: data)
    try FileManager.default.createDirectory(
      at: sharedStateDirectory, withIntermediateDirectories: true)
    let url = sharedStateDirectory.appendingPathComponent(file.fileName)
    /**
     CDXC:NativeGpu 2026-05-08-16:45
     Shared sidebar storage can receive frequent snapshots from routine
     status/layout publishes. Byte-identical payloads do not represent a state
     change, so avoid atomic rewrites that wake filesystem observers and keep
     the native app doing work while the workspace is visually idle.
     */
    if let existingData = try? Data(contentsOf: url), existingData == data {
      return
    }
    try data.write(to: url, options: [.atomic])
  }

  private static func readSharedSidebarStorageFile(_ fileName: String) -> String? {
    let url = sharedStateDirectory.appendingPathComponent(fileName)
    guard let data = try? Data(contentsOf: url) else {
      return nil
    }
    return decodeJsonStorageData(data)
  }

  private static func isSharedSidebarStorageFileNormalized(
    _ fileName: String,
    payloadJson: String
  ) -> Bool {
    let url = sharedStateDirectory.appendingPathComponent(fileName)
    guard let existingData = try? Data(contentsOf: url),
      let normalizedData = payloadJson.data(using: .utf8)
    else {
      return false
    }
    return existingData == normalizedData
  }

  private static func selectSharedSidebarStorageValue(
    sharedValue: String?,
    legacyValue: String?
  ) -> String? {
    sharedValue ?? legacyValue
  }

  private static func readLegacyDefaultAppLocalStorageValue(key: String) -> String? {
    /**
     CDXC:DevAppFlavor 2026-04-28-02:01
     Existing user state lives in the default app's WKWebView localStorage under
     com.madda.ghostex.host. Production can import missing shared
     settings snapshots from that localStorage before falling back to empty
     defaults.
     CDXC:DevAppFlavor 2026-05-11-12:10
     ghostex-dev must start from its own ~/.ghostex-dev state instead of cloning or
     reading production localStorage. Only the production shared home may run
     the legacy import.
     */
    guard sharedHomeDirectoryName == ".ghostex",
      Bundle.main.bundleIdentifier == "com.madda.ghostex.host"
    else {
      return nil
    }
    let webKitRoot = FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent("Library/WebKit/com.madda.ghostex.host", isDirectory: true)
    guard let enumerator = FileManager.default.enumerator(
      at: webKitRoot,
      includingPropertiesForKeys: nil,
      options: [.skipsHiddenFiles]
    ) else {
      return nil
    }
    let databaseURLs = enumerator
      .compactMap { $0 as? URL }
      .filter { $0.lastPathComponent == "localstorage.sqlite3" }
      .sorted { $0.path < $1.path }
    var selectedCandidate: LegacyLocalStorageValueCandidate?
    for url in databaseURLs {
      guard let value = readLocalStorageValue(databaseURL: url, key: key) else {
        continue
      }
      let modifiedAt =
        (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate)?
        .timeIntervalSince1970 ?? 0
      let candidate = LegacyLocalStorageValueCandidate(
        databasePath: url.path,
        modifiedAt: modifiedAt,
        value: value
      )
      selectedCandidate = selectLegacyLocalStorageValueCandidate(
        current: selectedCandidate,
        candidate: candidate
      )
    }
    return selectedCandidate?.value
  }

  /**
   CDXC:GxserverMigration 2026-05-30-19:55:
   WKWebView may retain more than one `localstorage.sqlite3` with Ghostex sidebar settings. Native bootstrap picks the richest settings payload, then database freshness and path, so filesystem enumeration order cannot choose a stale settings snapshot.
   */
  private static func selectLegacyLocalStorageValueCandidate(
    current: LegacyLocalStorageValueCandidate?,
    candidate: LegacyLocalStorageValueCandidate
  ) -> LegacyLocalStorageValueCandidate {
    guard let current else {
      return candidate
    }
    let currentScore = legacyLocalStorageValueScore(current.value)
    let candidateScore = legacyLocalStorageValueScore(candidate.value)
    if candidateScore != currentScore {
      return candidateScore > currentScore ? candidate : current
    }
    if candidate.modifiedAt != current.modifiedAt {
      return candidate.modifiedAt > current.modifiedAt ? candidate : current
    }
    if candidate.value.count != current.value.count {
      return candidate.value.count > current.value.count ? candidate : current
    }
    return candidate.databasePath < current.databasePath ? candidate : current
  }

  private static func legacyLocalStorageValueScore(_ value: String) -> Int {
    genericJsonPayloadScore(value)
  }

  private static func genericJsonPayloadScore(_ payloadJson: String) -> Int {
    guard let data = payloadJson.data(using: .utf8),
      let object = try? JSONSerialization.jsonObject(with: data)
    else {
      return payloadJson.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0 : 1
    }
    if let array = object as? [Any] {
      return (array.count * 1_000) + payloadJson.count
    }
    if let dictionary = object as? [String: Any] {
      return (dictionary.keys.count * 1_000) + payloadJson.count
    }
    return payloadJson.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0 : 1
  }

  private static func readLocalStorageValue(databaseURL: URL, key: String) -> String? {
    let escapedKey = key.replacingOccurrences(of: "'", with: "''")
    let process = Process()
    let output = Pipe()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/sqlite3")
    process.arguments = [
      "-readonly",
      databaseURL.path,
      "select hex(value) from ItemTable where key = '\(escapedKey)' limit 1;",
    ]
    process.standardOutput = output
    process.standardError = FileHandle.nullDevice
    do {
      try process.run()
      let data = output.fileHandleForReading.readDataToEndOfFile()
      process.waitUntilExit()
      guard process.terminationStatus == 0 else {
        return nil
      }
      let hexValue = String(data: data, encoding: .utf8)?
        .trimmingCharacters(in: .whitespacesAndNewlines)
      guard let hexValue, !hexValue.isEmpty, let valueData = dataFromHexString(hexValue) else {
        return nil
      }
      return decodeJsonStorageData(valueData)
    } catch {
      return nil
    }
  }

  private static func decodeJsonStorageData(_ data: Data) -> String? {
    /**
     CDXC:DevAppFlavor 2026-04-28-03:05
     WKWebView localStorage stores sidebar snapshots as UTF-16 blobs on this
     machine. Shared ghostex-dev state must normalize those blobs to UTF-8 JSON
     before the sidebar can read imported settings.
     */
    for encoding in [String.Encoding.utf8, .utf16LittleEndian, .utf16] {
      guard let value = String(data: data, encoding: encoding),
        !value.contains("\u{0}"),
        let jsonData = value.data(using: .utf8),
        (try? JSONSerialization.jsonObject(with: jsonData)) != nil
      else {
        continue
      }
      return value
    }
    return nil
  }

  private static func dataFromHexString(_ hex: String) -> Data? {
    guard hex.count.isMultiple(of: 2) else {
      return nil
    }
    var data = Data()
    data.reserveCapacity(hex.count / 2)
    var index = hex.startIndex
    while index < hex.endIndex {
      let nextIndex = hex.index(index, offsetBy: 2)
      guard let byte = UInt8(hex[index..<nextIndex], radix: 16) else {
        return nil
      }
      data.append(byte)
      index = nextIndex
    }
    return data
  }
}

enum NativeDebugLogging {
  private static let isEnabledCacheInterval: TimeInterval = 0.25
  private static var cachedIsEnabled: Bool?
  private static var cachedIsEnabledReadAt: TimeInterval = 0

  /**
   CDXC:Diagnostics 2026-04-29-09:16
   Non-error native diagnostics must honor the sidebar Settings debug switch so
   routine title, focus, restore, and workspace updates cannot create persistent
   memory and disk pressure when debugging UI is disabled.
   CDXC:NativeTerminalFocus 2026-05-11-11:48
   Keyboard-route probes can run for every keyDown during a repro. Cache the
   debug switch briefly so disabled diagnostics do not read shared settings
   from disk on every keystroke, while still reacting quickly when the user
   enables Debugging Mode before reproducing.
   CDXC:Diagnostics 2026-05-16-07:23
   Regular non-error console, OSLog, and persistent diagnostic logging must run
   only while Settings Debugging Mode is enabled. Error logs remain outside this
   gate so actual failures are still captured when the app is not in debug mode.

   CDXC:DiagnosticsSettings 2026-06-27-22:07:
   Debugging Mode remains a debug-UI and legacy console/OSLog gate. New routine
   persistent support logs must use NativeDiagnosticLogging scenarios so users
   can enable one repro area without turning on every noisy file writer.
   */
  static var isEnabled: Bool {
    let now = ProcessInfo.processInfo.systemUptime
    if let cachedIsEnabled, now - cachedIsEnabledReadAt < isEnabledCacheInterval {
      return cachedIsEnabled
    }
    let value: Bool
    guard let data = try? Data(contentsOf: GhostexAppStorage.sharedSidebarSettingsURL),
      let object = try? JSONSerialization.jsonObject(with: data),
      let settings = object as? [String: Any]
    else {
      value = false
      cachedIsEnabled = value
      cachedIsEnabledReadAt = now
      return value
    }
    value = settings["debuggingMode"] as? Bool ?? false
    cachedIsEnabled = value
    cachedIsEnabledReadAt = now
    return value
  }
}

enum NativeDiagnosticLoggingScenario: String {
  case nativeAgentDetection = "native.agent.detection"
  case nativeAppModal = "native.app.modal"
  case nativeBrowserImport = "native.browser.import"
  case nativeGhosttyConfig = "native.ghostty.config"
  case nativeHostLifecycle = "native.host.lifecycle"
  case nativeLayoutLayering = "native.layout.layering"
  case nativeModeSwitcher = "native.mode.switcher"
  case nativePaneReorder = "native.pane.reorder"
  case nativePaneTabs = "native.pane.tabs"
  case nativeProjectBoard = "native.project.board"
  case nativePromptEditor = "native.prompt.editor"
  case nativeSessionTitle = "native.session.title"
  case nativeSidebarCollapse = "native.sidebar.collapse"
  case nativeSidebarRefresh = "native.sidebar.refresh"
  case nativeT3CodePane = "native.t3.codePane"
  case nativeTerminalFocus = "native.terminal.focus"
  case nativeWorkspaceDock = "native.workspace.dock"
  case nativeWorkspaceRestore = "native.workspace.restore"
}

enum NativeDiagnosticLogging {
  private static let cacheInterval: TimeInterval = 0.25
  private static let isoFormatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }()
  private static var cachedSettings: [String: Any]?
  private static var cachedSettingsReadAt: TimeInterval = 0

  /*
   CDXC:DiagnosticsSettings 2026-06-27-22:07:
   Routine native disk logs are controlled by exact diagnostic scenario ids in
   shared Settings instead of broad Debugging Mode. Keep warnings/errors routed
   through each writer's important-diagnostic check, but require the matching
   scenario for debug/info breadcrumbs and honor expiresAt at the native writer
   boundary so stale UI state cannot keep logs noisy.
   */
  static func isScenarioEnabled(_ scenario: NativeDiagnosticLoggingScenario) -> Bool {
    guard let diagnosticLogging = cachedSettingsObject()["diagnosticLogging"] as? [String: Any],
      let scenarios = diagnosticLogging["scenarios"] as? [String: Any],
      let scenarioState = scenarios[scenario.rawValue]
    else {
      return false
    }
    if let enabled = scenarioState as? Bool {
      return enabled
    }
    guard let state = scenarioState as? [String: Any],
      state["enabled"] as? Bool == true
    else {
      return false
    }
    guard let expiresAt = state["expiresAt"] as? String, !expiresAt.isEmpty else {
      return true
    }
    guard let expiryDate = isoFormatter.date(from: expiresAt) else {
      return false
    }
    return expiryDate.timeIntervalSinceNow > 0
  }

  private static func cachedSettingsObject() -> [String: Any] {
    let now = ProcessInfo.processInfo.systemUptime
    if let cachedSettings, now - cachedSettingsReadAt < cacheInterval {
      return cachedSettings
    }
    let settings: [String: Any]
    if let data = try? Data(contentsOf: GhostexAppStorage.sharedSidebarSettingsURL),
      let object = try? JSONSerialization.jsonObject(with: data),
      let dictionary = object as? [String: Any]
    {
      settings = dictionary
    } else {
      settings = [:]
    }
    cachedSettings = settings
    cachedSettingsReadAt = now
    return settings
  }
}
