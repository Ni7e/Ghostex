import Foundation

struct GxserverClientStatus {
  let alwaysStart: Bool
  let authToken: String?
  let health: [String: Any]?
  let message: String
  let nodeModuleVersion: String?
  let nodePath: String?
  let nodeVersion: String?
  let ok: Bool
  let expectedNodeMajor: Int?
  let expectedNodeModuleVersion: String?
  let state: String

  init(
    alwaysStart: Bool,
    authToken: String?,
    health: [String: Any]?,
    message: String,
    nodeModuleVersion: String? = nil,
    nodePath: String? = nil,
    nodeVersion: String? = nil,
    ok: Bool,
    expectedNodeMajor: Int? = nil,
    expectedNodeModuleVersion: String? = nil,
    state: String
  ) {
    self.alwaysStart = alwaysStart
    self.authToken = authToken
    self.health = health
    self.message = message
    self.nodeModuleVersion = nodeModuleVersion
    self.nodePath = nodePath
    self.nodeVersion = nodeVersion
    self.ok = ok
    self.expectedNodeMajor = expectedNodeMajor
    self.expectedNodeModuleVersion = expectedNodeModuleVersion
    self.state = state
  }

  func payload(baseURL: String, tokenFile: String) -> [String: Any] {
    var payload: [String: Any] = [
      "alwaysStart": alwaysStart,
      "baseUrl": baseURL,
      "message": message,
      "ok": ok,
      "protocolVersion": GxserverClient.protocolVersion,
      "state": state,
      "tokenFile": tokenFile,
    ]
    if let authToken {
      payload["authToken"] = authToken
    }
    if let health {
      payload["health"] = health
    }
    if let nodeModuleVersion {
      payload["nodeModuleVersion"] = nodeModuleVersion
    }
    if let nodePath {
      payload["nodePath"] = nodePath
    }
    if let nodeVersion {
      payload["nodeVersion"] = nodeVersion
    }
    if let expectedNodeMajor {
      payload["expectedNodeMajor"] = expectedNodeMajor
    }
    if let expectedNodeModuleVersion {
      payload["expectedNodeModuleVersion"] = expectedNodeModuleVersion
    }
    return payload
  }
}

enum GxserverBuildIdentityReuseDecision: Equatable {
  case compatible
  case incompatible
  case unknownExpected
}

struct GxserverNativeNodeRuntime: Equatable {
  let nativeModules: [String]
  let nodeMajor: Int
  let nodeModuleVersion: String
  let nodeRequirement: String?
  let nodeVersion: String?
}

enum GxserverNativeNodeRuntimeLoadResult: Equatable {
  case invalid(String)
  case loaded(GxserverNativeNodeRuntime)
  case unavailable
}

final class GxserverClient {
  static let localBaseURL = "http://127.0.0.1:58744"
  static let protocolVersion = 1

  private static let alwaysStartOnLaunchDefaultsKey = "ghostex.gxserver.alwaysStartOnLaunch"
  private static let expectedProduct = "gxserver"
  private static let colorDisablingEnvironmentKeys = [
    "ANSI_COLORS_DISABLED",
    "NO_COLOR",
    "NODE_DISABLE_COLORS",
  ]
  private static let sessionIdentityEnvironmentKeys = [
    "GHOSTEX_AGENT",
    "GHOSTEX_GLOBAL_SESSION_REF",
    "GHOSTEX_GXSERVER_AUTH_TOKEN_FILE",
    "GHOSTEX_GXSERVER_BASE_URL",
    "GHOSTEX_GXSERVER_PROTOCOL_VERSION",
    "GHOSTEX_NATIVE_SESSION_ID",
    "GHOSTEX_SESSION_ID",
    "GHOSTEX_SESSION_STATE_FILE",
    "GHOSTEX_WORKSPACE_ID",
    "GHOSTEX_WORKSPACE_ROOT",
    "VSMUX_AGENT",
    "VSMUX_SESSION_ID",
    "VSMUX_SESSION_STATE_FILE",
    "VSMUX_WORKSPACE_ID",
    "VSMUX_WORKSPACE_ROOT",
    "ZMX_SESSION",
    "ZMX_SESSION_PREFIX",
    "ghostex_AGENT",
    "ghostex_SESSION_ID",
    "ghostex_SESSION_STATE_FILE",
    "ghostex_WORKSPACE_ID",
    "ghostex_WORKSPACE_ROOT",
  ]
  private static let gxserverLaunchEnvironmentKeys = [
    "GHOSTEX_GXSERVER_CLI",
    "GHOSTEX_GXSERVER_BIN",
  ]
  private let fileManager = FileManager.default

  private enum GxserverLaunchExecutableKind {
    case javascriptCli
    case nativeExecutable
  }

  private struct GxserverLaunchPlan {
    let executableURL: URL
    let expectedBuildIdentity: String?
    let isExplicitSelection: Bool
    let kind: GxserverLaunchExecutableKind
  }

  private enum GxserverLaunchPlanResolution {
    case failure(message: String, explicit: Bool)
    case success(GxserverLaunchPlan)
  }

  /*
   CDXC:GxserverBootstrap 2026-05-30-15:39:
   The macOS app hard-cutover starts or reuses the local gxserver control plane on 127.0.0.1:58744, authenticates with ~/.ghostex/gxserver/auth/token, and never owns daemon shutdown after launch.

   CDXC:GxserverBootstrap 2026-05-31-03:56:
   LaunchServices does not inherit the user's interactive shell PATH after a Mac restart. Resolve gxserver's runtime from deterministic app resources, surface the exact daemon status to React, and let users disable future auto-start without adding sidebar restore fallbacks.

   CDXC:GxserverBootstrap 2026-06-08-12:17:
   Legacy JavaScript gxserver selections must launch with code-server's bundled Node 22 runtime under app resources so users never need to install Node, fix PATH, or match the database-module ABI before the sidebar can start.

   CDXC:GxserverRustPort 2026-06-14-21:09:
   Phase 2 Rust testing used explicit opt-in through GHOSTEX_GXSERVER_CLI/BIN. Keep those hard-selection hooks for source/reference testing, skip Node validation for native gxserver binaries, and report fixed-port startup failures instead of silently switching daemons.

   CDXC:GxserverRustPackaging 2026-06-16-10:35:
   Phase 8 app bundles launch Web/gxserver/bin/gxserver as the default daemon. Explicit gxserver selections still refuse to stop a different fixed-port owner, but the packaged default may restart an older build after the build identity check.
  */
  func startOrReuse(allowStart: Bool? = nil) async -> GxserverClientStatus {
    let shouldStart = allowStart ?? alwaysStartOnLaunch
    let launchResolution = resolveGxserverLaunchPlan()
    let launchPlan: GxserverLaunchPlan?
    switch launchResolution {
    case .success(let resolvedPlan):
      launchPlan = resolvedPlan
    case .failure(let message, let explicit):
      if explicit || shouldStart {
        return GxserverClientStatus(
          alwaysStart: alwaysStartOnLaunch,
          authToken: readAuthToken(),
          health: nil,
          message: message,
          ok: false,
          state: "missingGxserverCli"
        )
      }
      launchPlan = nil
    }
    let expectedBuildIdentity = launchPlan?.expectedBuildIdentity
    if let running = await authenticatedHealthStatus(expectedBuildIdentity: expectedBuildIdentity) {
      if !Self.reuseFailureRequiresRestart(running.state) {
        return running
      }
      guard shouldStart else {
        return running
      }
      if launchPlan?.kind == .nativeExecutable && launchPlan?.isExplicitSelection == true {
        return GxserverClientStatus(
          alwaysStart: alwaysStartOnLaunch,
          authToken: running.authToken,
          health: running.health,
          message:
            "Rust gxserver was selected, but 127.0.0.1:58744 is already owned by a different gxserver. Stop the current control plane before starting the Rust opt-in.",
          ok: false,
          state: "portConflict"
        )
      }
      await stopRunningGxserverControlPlane()
    }

    guard shouldStart else {
      let stoppedMessage = alwaysStartOnLaunch
        ? "gxserver is stopped."
        : "gxserver is stopped. Enable Always start or start it from Resources when you need session restore."
      return GxserverClientStatus(
        alwaysStart: alwaysStartOnLaunch,
        authToken: readAuthToken(),
        health: nil,
        message: stoppedMessage,
        ok: true,
        state: "stopped"
      )
    }

    guard let launchPlan else {
      return GxserverClientStatus(
        alwaysStart: alwaysStartOnLaunch,
        authToken: readAuthToken(),
        health: nil,
        message:
          "Bundled Rust gxserver is missing. Run `bun run build` for development, or reinstall Ghostex so Web/gxserver/bin/gxserver is present.",
        ok: false,
        state: "missingGxserverCli"
      )
    }

    var expectedNativeRuntime: GxserverNativeNodeRuntime?
    var nodeResolution: BundledNodeResolution?
    if launchPlan.kind == .javascriptCli {
      switch expectedBundledNativeNodeRuntime(for: launchPlan.executableURL) {
      case .loaded(let runtime):
        expectedNativeRuntime = runtime
      case .unavailable:
        expectedNativeRuntime = nil
      case .invalid(let message):
        return GxserverClientStatus(
          alwaysStart: alwaysStartOnLaunch,
          authToken: readAuthToken(),
          health: nil,
          message: message,
          ok: false,
          state: "runtimeUnavailable"
        )
      }

      let resolvedNode = resolveBundledNode()
      if let nodeError = bundledNodeDependencyError(resolution: resolvedNode, expectedRuntime: expectedNativeRuntime) {
        return GxserverClientStatus(
          alwaysStart: alwaysStartOnLaunch,
          authToken: readAuthToken(),
          health: nil,
          message: nodeError,
          nodeModuleVersion: resolvedNode.moduleVersion,
          nodePath: resolvedNode.path,
          nodeVersion: resolvedNode.version,
          ok: false,
          expectedNodeMajor: expectedNativeRuntime?.nodeMajor,
          expectedNodeModuleVersion: expectedNativeRuntime?.nodeModuleVersion,
          state: "runtimeUnavailable"
        )
      }
      nodeResolution = resolvedNode
    }

    if let launchError = launchGxserverForeground(plan: launchPlan, nodePath: nodeResolution?.path) {
      return GxserverClientStatus(
        alwaysStart: alwaysStartOnLaunch,
        authToken: readAuthToken(),
        health: nil,
        message: launchError,
        nodeModuleVersion: nodeResolution?.moduleVersion,
        nodePath: nodeResolution?.path,
        nodeVersion: nodeResolution?.version,
        ok: false,
        expectedNodeMajor: expectedNativeRuntime?.nodeMajor,
        expectedNodeModuleVersion: expectedNativeRuntime?.nodeModuleVersion,
        state: "startFailed"
      )
    }

    let deadline = Date().addingTimeInterval(15)
    while Date() < deadline {
      if let running = await authenticatedHealthStatus(expectedBuildIdentity: expectedBuildIdentity) {
        return running
      }
      try? await Task.sleep(nanoseconds: 150_000_000)
    }

    let launchOutput = recentGxserverLaunchOutput()
    let launchMessage = launchOutput.map {
      "gxserver launch completed, but authenticated health did not become ready on 127.0.0.1:58744. Recent startup output: \($0)"
    } ?? "gxserver launch completed, but authenticated health did not become ready on 127.0.0.1:58744."
    return GxserverClientStatus(
      alwaysStart: alwaysStartOnLaunch,
      authToken: readAuthToken(),
      health: nil,
      message: launchMessage,
      nodeModuleVersion: nodeResolution?.moduleVersion,
      nodePath: nodeResolution?.path,
      nodeVersion: nodeResolution?.version,
      ok: false,
      expectedNodeMajor: expectedNativeRuntime?.nodeMajor,
      expectedNodeModuleVersion: expectedNativeRuntime?.nodeModuleVersion,
      state: "starting"
    )
  }

  var alwaysStartOnLaunch: Bool {
    get {
      if UserDefaults.standard.object(forKey: Self.alwaysStartOnLaunchDefaultsKey) == nil {
        return true
      }
      return UserDefaults.standard.bool(forKey: Self.alwaysStartOnLaunchDefaultsKey)
    }
    set {
      UserDefaults.standard.set(newValue, forKey: Self.alwaysStartOnLaunchDefaultsKey)
    }
  }

  func startingStatus(message: String = "Starting gxserver...") -> GxserverClientStatus {
    GxserverClientStatus(
      alwaysStart: alwaysStartOnLaunch,
      authToken: readAuthToken(),
      health: nil,
      message: message,
      ok: true,
      state: "starting"
    )
  }

  func stoppedStatus(message: String = "gxserver is stopped.") -> GxserverClientStatus {
    GxserverClientStatus(
      alwaysStart: alwaysStartOnLaunch,
      authToken: readAuthToken(),
      health: nil,
      message: message,
      ok: true,
      state: "stopped"
    )
  }

  func stopControlPlane() async -> GxserverClientStatus {
    await stopRunningGxserverControlPlane()
    return stoppedStatus()
  }

  func stopAllControlPlane() async -> GxserverClientStatus {
    /*
     CDXC:MenuBarStatusIndicator 2026-06-15-03:16:
     Quit Ghostex Fully is the explicit RAM-recovery path from the menu bar
     status item. Use gxserver's destructive stop-all control API so tracked zmx
     provider sessions are killed before the control plane shuts down; normal
     app quits must continue leaving gxserver and provider sessions alive.
     */
    let response = await stopRunningGxserverControlPlane(killTrackedSessions: true)
    let result = response?["result"] as? [String: Any]
    let killedSessions = Self.integerValue(result?["killedSessions"]) ?? 0
    let failedSessions = Self.integerValue(result?["failedSessions"]) ?? 0
    let attemptedSessions = Self.integerValue(result?["attemptedSessions"]) ?? 0
    let message =
      response == nil
      ? "gxserver stop-all did not return a response before app quit."
      : "gxserver stop-all completed. zmx sessions attempted: \(attemptedSessions); killed: \(killedSessions); failed: \(failedSessions)."
    return GxserverClientStatus(
      alwaysStart: alwaysStartOnLaunch,
      authToken: readAuthToken(),
      health: nil,
      message: message,
      ok: response != nil && failedSessions == 0,
      state: response == nil ? "stopping" : "stopped"
    )
  }

  func webBootstrap(status: GxserverClientStatus? = nil) -> [String: Any] {
    var bootstrap: [String: Any] = [
      "baseUrl": Self.localBaseURL,
      "protocolVersion": Self.protocolVersion,
      "tokenFile": authTokenURL.path,
    ]
    if let status {
      /*
       CDXC:GxserverBootstrap 2026-06-07-12:02:
       Web bootstrap must include the first daemon state, not just endpoint config, because the host event carrying that same state can race WebKit listener setup during local starts.
       */
      bootstrap.merge(statusPayload(status)) { _, newValue in newValue }
    }
    if let authToken = readAuthToken() {
      bootstrap["authToken"] = authToken
    }
    return bootstrap
  }

  func statusPayload(_ status: GxserverClientStatus) -> [String: Any] {
    status.payload(baseURL: Self.localBaseURL, tokenFile: authTokenURL.path)
  }

  /*
   CDXC:GxserverMacClient 2026-05-31-01:32:
   Some native sidebar calls still travel through the authenticated Swift bridge instead of direct WebKit fetch so React never reads the bearer token from disk. Keep this bridge path on the same fixed local gxserver endpoint, bearer-token header, and protocol header as the bootstrap client.
   */
  static func request(_ command: GxserverRequest) async -> HostEvent {
    await withCheckedContinuation { continuation in
      DispatchQueue.global(qos: .utility).async {
        do {
          let token = try readBridgeAuthToken()
          let response = try performBridgeRequest(command, token: token)
          continuation.resume(returning: .gxserverResponse(
            requestId: command.requestId,
            path: command.path,
            ok: (200..<300).contains(response.statusCode),
            statusCode: response.statusCode,
            bodyJson: response.body,
            error: nil
          ))
        } catch {
          continuation.resume(returning: .gxserverResponse(
            requestId: command.requestId,
            path: command.path,
            ok: false,
            statusCode: nil,
            bodyJson: nil,
            error: error.localizedDescription
          ))
        }
      }
    }
  }

  private func authenticatedHealthStatus(expectedBuildIdentity: String?) async -> GxserverClientStatus? {
    guard let token = readAuthToken() else {
      return nil
    }
    guard
      let response = await fetchJSON(
        path: "/api/health/server",
        token: token,
        timeoutSeconds: 1
      )
    else {
      return nil
    }
    let product = response["product"] as? String
    let protocolVersion = response["protocolVersion"] as? Int
    guard product == Self.expectedProduct else {
      return nil
    }
    guard protocolVersion == Self.protocolVersion else {
      return GxserverClientStatus(
        alwaysStart: alwaysStartOnLaunch,
        authToken: token,
        health: response,
        message:
          "gxserver protocol mismatch. Expected protocol \(Self.protocolVersion), got \(String(describing: response["protocolVersion"])). Update Ghostex and gxserver so their protocol versions match.",
        ok: false,
        state: "protocolMismatch"
      )
    }
    switch Self.buildIdentityReuseDecision(response: response, expectedBuildIdentity: expectedBuildIdentity) {
    case .compatible, .unknownExpected:
      break
    case .incompatible:
      return GxserverClientStatus(
        alwaysStart: alwaysStartOnLaunch,
        authToken: token,
        health: response,
        message:
          "gxserver build identity changed. Relaunching gxserver from the current Ghostex bundle before loading the sidebar.",
        ok: false,
        state: "buildIdentityMismatch"
      )
    }
    let usableTools = requiredBundledToolsAvailable(in: response)
    return GxserverClientStatus(
      alwaysStart: alwaysStartOnLaunch,
      authToken: token,
      health: response,
      message: usableTools
        ? "gxserver is running and uses the expected protocol."
        : "gxserver is running, but its bundled zmx/zehn/bd tools are unavailable. Relaunching gxserver from the current Ghostex bundle.",
      ok: usableTools,
      state: usableTools ? "running" : "toolchainUnavailable"
    )
  }

  /*
   CDXC:GxserverBootstrap 2026-05-30-23:47:
   A Ghostex app update can keep the gxserver protocol stable while changing server behavior. Compare authenticated daemon health against the build identity bundled beside the current app's gxserver CLI, and restart only on a definite mismatch so same-build daemon reuse still avoids unnecessary zmx control-plane churn.
   */
  static func buildIdentityReuseDecision(
    response: [String: Any],
    expectedBuildIdentity: String?
  ) -> GxserverBuildIdentityReuseDecision {
    guard let expected = expectedBuildIdentity?.trimmingCharacters(in: .whitespacesAndNewlines), !expected.isEmpty else {
      return .unknownExpected
    }
    return (response["buildIdentity"] as? String) == expected ? .compatible : .incompatible
  }

  private static func reuseFailureRequiresRestart(_ state: String) -> Bool {
    state == "toolchainUnavailable" || state == "buildIdentityMismatch"
  }

  /*
   CDXC:GxserverBootstrap 2026-05-30-17:01:
   `bun run start` can replace `/Applications/Ghostex.app` while a previous gxserver control plane still points at an older app bundle. Reusing that daemon breaks zmx persistence and Project board startup because bundled zmx/zehn/bd paths go stale, so macOS startup must restart only the gxserver control plane when required bundled tools are unavailable. The gxserver stop API deliberately does not signal or kill zmx sessions.

   CDXC:ProjectBoardBeads 2026-06-08-10:46:
   Project/Kanban first-open setup now relies on bundled upstream `bd`, so daemon reuse must also reject an old gxserver whose health report lacks an available Beads tool. Restart from the current app bundle instead of letting the Project board fall back to a missing PATH dependency.
   */
  private func requiredBundledToolsAvailable(in response: [String: Any]) -> Bool {
    guard let tools = response["tools"] as? [[String: Any]] else {
      return true
    }
    for requiredTool in ["zmx", "zehn", "bd"] {
      guard let tool = tools.first(where: { ($0["tool"] as? String) == requiredTool }) else {
        return false
      }
      if (tool["availability"] as? String) != "available" {
        return false
      }
    }
    return true
  }

  @discardableResult
  private func stopRunningGxserverControlPlane(
    killTrackedSessions: Bool = false
  ) async -> [String: Any]? {
    guard let token = readAuthToken(),
      let url = URL(
        string:
          "\(Self.localBaseURL)/api/control/\(killTrackedSessions ? "stopAll" : "stop")")
    else {
      return nil
    }
    var request = URLRequest(url: url, timeoutInterval: killTrackedSessions ? 12 : 2)
    request.httpMethod = "POST"
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.setValue(String(Self.protocolVersion), forHTTPHeaderField: "x-gxserver-protocol-version")
    let responsePayload: [String: Any]?
    if let (data, _) = try? await URLSession.shared.data(for: request) {
      responsePayload = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    } else {
      responsePayload = nil
    }

    let deadline = Date().addingTimeInterval(5)
    while Date() < deadline {
      if await authenticatedHealthStatus(expectedBuildIdentity: nil) == nil {
        return responsePayload
      }
      try? await Task.sleep(nanoseconds: 100_000_000)
    }
    return responsePayload
  }

  private static func integerValue(_ value: Any?) -> Int? {
    if let number = value as? NSNumber {
      return number.intValue
    }
    if let int = value as? Int {
      return int
    }
    if let string = value as? String {
      return Int(string.trimmingCharacters(in: .whitespacesAndNewlines))
    }
    return nil
  }

  private func fetchJSON(path: String, token: String, timeoutSeconds: TimeInterval) async -> [String: Any]? {
    guard let url = URL(string: "\(Self.localBaseURL)\(path)") else {
      return nil
    }
    var request = URLRequest(url: url, timeoutInterval: timeoutSeconds)
    request.httpMethod = "GET"
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.setValue(String(Self.protocolVersion), forHTTPHeaderField: "x-gxserver-protocol-version")
    do {
      let (data, response) = try await URLSession.shared.data(for: request)
      guard let httpResponse = response as? HTTPURLResponse, (200..<300).contains(httpResponse.statusCode) else {
        return nil
      }
      return try JSONSerialization.jsonObject(with: data) as? [String: Any]
    } catch {
      return nil
    }
  }

  private func launchGxserverForeground(plan: GxserverLaunchPlan, nodePath: String?) -> String? {
    /*
     CDXC:GxserverBootstrap 2026-05-30-17:06:
     LaunchServices-started macOS apps should create gxserver as an app-independent background daemon by running `nohup node <gxserver> --foreground &` and then polling authenticated health. The UI app must not retain a Swift Process handle as daemon ownership, because gxserver must survive closing the macOS app and continue managing zmx sessions.

     CDXC:GxserverRustPort 2026-06-14-21:09:
     A selected Rust gxserver is a native executable launch, not a Node CLI launch. Keep the foreground args identical while preserving the single fixed port and writing startup stderr where the timeout path can surface it to the user.
     */
    let launchLogPath = gxserverLaunchLogURL.path
    try? fileManager.createDirectory(
      at: gxserverLaunchLogURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    let launchCommand: String
    switch plan.kind {
    case .javascriptCli:
      guard let nodePath, !nodePath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        return "gxserver JavaScript CLI was selected, but the bundled Node runtime is unavailable."
      }
      launchCommand = "\(shellQuote(nodePath)) \(shellQuote(plan.executableURL.path)) --foreground"
    case .nativeExecutable:
      launchCommand = "\(shellQuote(plan.executableURL.path)) --foreground"
    }
    let command = "nohup \(launchCommand) >>\(shellQuote(launchLogPath)) 2>&1 </dev/null &"
    let result = runProcess(
      executable: "/bin/sh",
      arguments: ["-c", command],
      timeoutSeconds: 3
    )
    if result.exitCode != 0 {
      let stderr = result.stderr.trimmingCharacters(in: .whitespacesAndNewlines)
      let stdout = result.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
      return stderr.isEmpty ? (stdout.isEmpty ? "gxserver failed to launch." : stdout) : stderr
    }
    return nil
  }

  private func recentGxserverLaunchOutput() -> String? {
    guard
      let text = try? String(contentsOf: gxserverLaunchLogURL, encoding: .utf8)
    else {
      return nil
    }
    let lines = text
      .components(separatedBy: .newlines)
      .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty }
      .suffix(6)
    let output = lines.joined(separator: " ")
    return output.isEmpty ? nil : output
  }

  private func shellQuote(_ value: String) -> String {
    "'\(value.replacingOccurrences(of: "'", with: "'\\''"))'"
  }

  private var gxserverLaunchLogURL: URL {
    FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent(".ghostex", isDirectory: true)
      .appendingPathComponent("gxserver", isDirectory: true)
      .appendingPathComponent("logs", isDirectory: true)
      .appendingPathComponent("macos-launch.log", isDirectory: false)
  }

  private var authTokenURL: URL {
    FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent(".ghostex", isDirectory: true)
      .appendingPathComponent("gxserver", isDirectory: true)
      .appendingPathComponent("auth", isDirectory: true)
      .appendingPathComponent("token", isDirectory: false)
  }

  private func readAuthToken() -> String? {
    guard let data = try? Data(contentsOf: authTokenURL),
      let token = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
      !token.isEmpty
    else {
      return nil
    }
    return token
  }

  private static func readBridgeAuthToken() throws -> String {
    let tokenURL = FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent(".ghostex", isDirectory: true)
      .appendingPathComponent("gxserver", isDirectory: true)
      .appendingPathComponent("auth", isDirectory: true)
      .appendingPathComponent("token", isDirectory: false)
    let token = try String(contentsOf: tokenURL, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
    if token.isEmpty {
      throw NSError(
        domain: "GxserverAuth",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "gxserver auth token file is empty at \(tokenURL.path)."])
    }
    return token
  }

  private static func performBridgeRequest(_ command: GxserverRequest, token: String) throws -> (statusCode: Int, body: String?) {
    guard command.path.hasPrefix("/api/") else {
      throw NSError(
        domain: "GxserverRequest",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Invalid gxserver API path: \(command.path)"])
    }
    guard let url = URL(string: "\(Self.localBaseURL)\(command.path)") else {
      throw NSError(
        domain: "GxserverRequest",
        code: 2,
        userInfo: [NSLocalizedDescriptionKey: "Invalid gxserver API URL for \(command.path)."])
    }
    var request = URLRequest(url: url)
    request.httpMethod = command.method.uppercased()
    /*
     CDXC:ProjectBoard 2026-06-02-13:31:
     Project-board Beads actions now flow through gxserver from the WK bridge. Preserve the board's existing 60-second command window for create/update/delete/search while keeping ordinary sidebar gxserver bridge calls on the shorter timeout.
     */
    request.timeoutInterval = command.path == "/api/runBeadsAction" ? 60 : 10
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.setValue(String(Self.protocolVersion), forHTTPHeaderField: "x-gxserver-protocol-version")
    if request.httpMethod == "POST" {
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      let paramsJson = command.paramsJson?.trimmingCharacters(in: .whitespacesAndNewlines)
      let params = (paramsJson?.isEmpty == false) ? paramsJson! : "{}"
      request.httpBody = Data(#"{"protocolVersion":\#(protocolVersion),"params":\#(params)}"#.utf8)
    }
    return try sendSynchronousBridgeRequest(request)
  }

  private static func sendSynchronousBridgeRequest(_ request: URLRequest) throws -> (statusCode: Int, body: String?) {
    let semaphore = DispatchSemaphore(value: 0)
    var result: Result<(statusCode: Int, body: String?), Error>?
    URLSession.shared.dataTask(with: request) { data, response, error in
      defer { semaphore.signal() }
      if let error {
        result = .failure(error)
        return
      }
      let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
      result = .success((statusCode, data.flatMap { String(data: $0, encoding: .utf8) }))
    }.resume()
    _ = semaphore.wait(timeout: .now() + 12)
    guard let result else {
      throw NSError(
        domain: "GxserverRequest",
        code: 3,
        userInfo: [NSLocalizedDescriptionKey: "gxserver request timed out."])
    }
    return try result.get()
  }

  private func resolveGxserverLaunchPlan() -> GxserverLaunchPlanResolution {
    if let explicit = explicitGxserverLaunchPath() {
      guard let url = resolveExplicitGxserverLaunchURL(explicit.path) else {
        return .failure(
          message: "Selected gxserver path from \(explicit.key) does not exist: \(explicit.path). TypeScript gxserver was not started because this launch explicitly opted into another daemon.",
          explicit: true
        )
      }
      if url.pathExtension == "js" {
        return .success(GxserverLaunchPlan(
          executableURL: url,
          expectedBuildIdentity: expectedBundledBuildIdentity(for: url),
          isExplicitSelection: true,
          kind: .javascriptCli
        ))
      }
      guard fileManager.isExecutableFile(atPath: url.path) else {
        return .failure(
          message: "Selected gxserver binary from \(explicit.key) is not executable: \(url.path). TypeScript gxserver was not started because this launch explicitly opted into another daemon.",
          explicit: true
        )
      }
      let versionResult = runProcess(executable: url.path, arguments: ["--version"], timeoutSeconds: 3)
      guard versionResult.exitCode == 0 else {
        let detail = startupProbeMessage(stdout: versionResult.stdout, stderr: versionResult.stderr)
        return .failure(
          message: "Selected Rust gxserver from \(explicit.key) did not report a version.\(detail) TypeScript gxserver was not started because this launch explicitly opted into Rust.",
          explicit: true
        )
      }
      let version = versionResult.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !version.isEmpty else {
        return .failure(
          message: "Selected Rust gxserver from \(explicit.key) returned an empty version. TypeScript gxserver was not started because this launch explicitly opted into Rust.",
          explicit: true
        )
      }
      return .success(GxserverLaunchPlan(
        executableURL: url,
        expectedBuildIdentity: expectedBundledBuildIdentity(for: url) ?? "gxserver:\(version):rust-source",
        isExplicitSelection: true,
        kind: .nativeExecutable
      ))
    }

    guard let defaultPlan = resolveDefaultGxserverLaunchPlan() else {
      return .failure(
        message: "Bundled Rust gxserver is missing. Run `bun run build` for development, or reinstall Ghostex so Web/gxserver/bin/gxserver is present.",
        explicit: false
      )
    }
    return .success(defaultPlan)
  }

  private func explicitGxserverLaunchPath() -> (key: String, path: String)? {
    let environment = ProcessInfo.processInfo.environment
    for key in Self.gxserverLaunchEnvironmentKeys {
      if let value = environment[key]?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty {
        return (key, value)
      }
    }
    return nil
  }

  private func resolveExplicitGxserverLaunchURL(_ pathValue: String) -> URL? {
    let expandedPath = expandedUserPath(pathValue)
    if expandedPath.hasPrefix("/") {
      let url = URL(fileURLWithPath: expandedPath, isDirectory: false)
      return fileManager.fileExists(atPath: url.path) ? url : nil
    }
    for root in gxserverDevelopmentRoots() {
      let candidate = root.appendingPathComponent(expandedPath, isDirectory: false)
      if fileManager.fileExists(atPath: candidate.path) {
        return candidate
      }
    }
    return nil
  }

  private func expandedUserPath(_ value: String) -> String {
    if value == "~" {
      return FileManager.default.homeDirectoryForCurrentUser.path
    }
    if value.hasPrefix("~/") {
      return FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(String(value.dropFirst(2)))
        .path
    }
    return value
  }

  private func resolveDefaultGxserverLaunchPlan() -> GxserverLaunchPlan? {
    var candidates: [URL] = []
    if let webBinary = Bundle.main.resourceURL?.appendingPathComponent("Web/gxserver/bin/gxserver") {
      candidates.append(webBinary)
    }
    if let resourceBinary = Bundle.main.resourceURL?.appendingPathComponent("gxserver/bin/gxserver") {
      candidates.append(resourceBinary)
    }
    candidates.append(contentsOf: gxserverDevelopmentRoots().map {
      $0.appendingPathComponent("native/macos/ghostexHost/Web/gxserver/bin/gxserver")
    })
    guard let binaryURL = candidates.first(where: { fileManager.isExecutableFile(atPath: $0.path) }) else {
      return nil
    }
    return GxserverLaunchPlan(
      executableURL: binaryURL,
      expectedBuildIdentity: expectedBundledBuildIdentity(for: binaryURL),
      isExplicitSelection: false,
      kind: .nativeExecutable
    )
  }

  private func gxserverDevelopmentRoots() -> [URL] {
    let cwd = URL(fileURLWithPath: fileManager.currentDirectoryPath, isDirectory: true)
    var sourceRoot = URL(fileURLWithPath: #filePath, isDirectory: false)
    for _ in 0..<6 {
      sourceRoot.deleteLastPathComponent()
    }
    let environment = ProcessInfo.processInfo.environment
    let candidates = [
      cwd,
      environment["GHOSTEX_SOURCE_ROOT"].map { URL(fileURLWithPath: expandedUserPath($0), isDirectory: true) },
      environment["ghostex_REPO_ROOT"].map { URL(fileURLWithPath: expandedUserPath($0), isDirectory: true) },
      sourceRoot,
    ].compactMap { $0 }
    var seen = Set<String>()
    return candidates.filter { url in
      let key = url.standardizedFileURL.path
      if seen.contains(key) {
        return false
      }
      seen.insert(key)
      return true
    }
  }

  private func startupProbeMessage(stdout: String, stderr: String) -> String {
    let detail = stderr.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      ? stdout.trimmingCharacters(in: .whitespacesAndNewlines)
      : stderr.trimmingCharacters(in: .whitespacesAndNewlines)
    return detail.isEmpty ? "" : " \(detail)"
  }

  private func expectedBundledBuildIdentity(for cliURL: URL) -> String? {
    let packageRoot = Self.gxserverPackageRoot(for: cliURL)
    let identityURL = packageRoot.appendingPathComponent("build-identity.json", isDirectory: false)
    if fileManager.fileExists(atPath: identityURL.path) {
      guard
        let data = try? Data(contentsOf: identityURL),
        let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let buildIdentity = json["buildIdentity"] as? String,
        !buildIdentity.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      else {
        return "invalid-gxserver-build-identity:\(identityURL.path)"
      }
      return buildIdentity
    }
    let packageJsonURL = packageRoot.appendingPathComponent("package.json", isDirectory: false)
    guard
      let data = try? Data(contentsOf: packageJsonURL),
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let version = json["version"] as? String,
      !version.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    else {
      return nil
    }
    return "gxserver:\(version):source"
  }

  private func expectedBundledNativeNodeRuntime(for cliURL: URL) -> GxserverNativeNodeRuntimeLoadResult {
    let packageRoot = Self.gxserverPackageRoot(for: cliURL)
    let runtimeURL = packageRoot.appendingPathComponent("native-runtime.json", isDirectory: false)
    if !fileManager.fileExists(atPath: runtimeURL.path) {
      let bundledBetterSqliteURL = packageRoot
        .appendingPathComponent("node_modules", isDirectory: true)
        .appendingPathComponent("better-sqlite3", isDirectory: true)
      if Self.isAppBundleResource(cliURL), fileManager.fileExists(atPath: bundledBetterSqliteURL.path) {
        return .invalid(
          "gxserver includes a bundled database module, but its Node runtime metadata is missing. Reinstall Ghostex so the app can verify its bundled Node runtime before startup."
        )
      }
      return .unavailable
    }
    guard
      let data = try? Data(contentsOf: runtimeURL),
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let nodeMajor = json["nodeMajor"] as? Int,
      let nodeModuleVersion = json["nodeModuleVersion"] as? String,
      !nodeModuleVersion.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    else {
      return .invalid(
        "gxserver Node runtime metadata is invalid. Reinstall Ghostex so the app can verify its bundled Node runtime before startup."
      )
    }
    let nativeModules = (json["nativeModules"] as? [String]) ?? []
    if !nativeModules.contains("better-sqlite3") {
      return .invalid(
        "gxserver Node runtime metadata does not identify the bundled database module. Reinstall Ghostex so the app can verify its bundled Node runtime before startup."
      )
    }
    return .loaded(GxserverNativeNodeRuntime(
      nativeModules: nativeModules,
      nodeMajor: nodeMajor,
      nodeModuleVersion: nodeModuleVersion,
      nodeRequirement: json["nodeRequirement"] as? String,
      nodeVersion: json["nodeVersion"] as? String
    ))
  }

  private static func gxserverPackageRoot(for executableURL: URL) -> URL {
    let parent = executableURL.deletingLastPathComponent()
    if parent.lastPathComponent == "bin" {
      return parent.deletingLastPathComponent()
    }
    return executableURL
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
  }

  private static func isAppBundleResource(_ url: URL) -> Bool {
    guard let resourceURL = Bundle.main.resourceURL else {
      return false
    }
    let resourcePath = resourceURL.standardizedFileURL.path
    let candidatePath = url.standardizedFileURL.path
    return candidatePath == resourcePath || candidatePath.hasPrefix("\(resourcePath)/")
  }

  private struct BundledNodeResolution {
    let moduleVersion: String
    let path: String
    let source: String
    let version: String
  }

  private func resolveBundledNode() -> BundledNodeResolution {
    for candidate in bundledNodeCandidates() where fileManager.isExecutableFile(atPath: candidate.path) {
      if let resolution = probeBundledNode(path: candidate.path, source: candidate.source) {
        return resolution
      }
    }
    return BundledNodeResolution(moduleVersion: "", path: "", source: "app bundle", version: "")
  }

  private func bundledNodeCandidates() -> [(path: String, source: String)] {
    let cwd = URL(fileURLWithPath: fileManager.currentDirectoryPath, isDirectory: true)
    var sourceRoot = URL(fileURLWithPath: #filePath, isDirectory: false)
    for _ in 0..<6 {
      sourceRoot.deleteLastPathComponent()
    }
    /*
     CDXC:GxserverBootstrap 2026-06-08-12:17:
     gxserver must run on the Node 22 runtime bundled inside Web/code-server, not the user's PATH. Resolve the installed app resource first, with source-build resource paths only for local Xcode/dev starts that have not been copied into /Applications yet.
     */
    var candidates: [(path: String, source: String)] = []
    if let resourcePath = Bundle.main.resourceURL?.appendingPathComponent("Web/code-server/lib/node").path {
      candidates.append((path: resourcePath, source: "app resource"))
    }
    if let resourcePath = Bundle.main.resourceURL?.appendingPathComponent("code-server/lib/node").path {
      candidates.append((path: resourcePath, source: "app resource"))
    }
    candidates.append((
      path: cwd.appendingPathComponent("native/macos/ghostexHost/Web/code-server/lib/node").path,
      source: "working tree resource"
    ))
    candidates.append((
      path: sourceRoot.appendingPathComponent("native/macos/ghostexHost/Web/code-server/lib/node").path,
      source: "source resource"
    ))
    return candidates
  }

  private func probeBundledNode(path: String, source: String) -> BundledNodeResolution? {
    let result = runProcess(
      executable: path,
      arguments: [
        "-p",
        "JSON.stringify({version: process.version, modules: process.versions.modules})",
      ],
      timeoutSeconds: 3
    )
    guard
      result.exitCode == 0,
      let data = result.stdout.data(using: .utf8),
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let version = json["version"] as? String,
      let moduleVersion = json["modules"] as? String,
      Self.nodeVersionMajor(version) != nil
    else {
      return nil
    }
    return BundledNodeResolution(
      moduleVersion: moduleVersion.trimmingCharacters(in: .whitespacesAndNewlines),
      path: path,
      source: source,
      version: version.trimmingCharacters(in: .whitespacesAndNewlines)
    )
  }

  private static func nodeResolution(
    _ resolution: BundledNodeResolution,
    satisfies expectedRuntime: GxserverNativeNodeRuntime?
  ) -> Bool {
    guard let major = nodeVersionMajor(resolution.version) else {
      return false
    }
    guard let expectedRuntime else {
      return major >= 22
    }
    return major == expectedRuntime.nodeMajor && resolution.moduleVersion == expectedRuntime.nodeModuleVersion
  }

  private func bundledNodeDependencyError(
    resolution: BundledNodeResolution,
    expectedRuntime: GxserverNativeNodeRuntime?
  ) -> String? {
    /*
     CDXC:GxserverBootstrap 2026-06-08-12:17:
     Ghostex macOS reuses code-server's bundled Node 22 runtime for gxserver. Missing or mismatched runtime metadata is an app packaging problem, so report reinstall/rebuild guidance instead of asking users to install Node or repair PATH.
     */
    if resolution.path.isEmpty {
      return "Ghostex is missing its bundled code-server Node runtime. Reinstall or rebuild Ghostex so gxserver can start from Web/code-server/lib/node."
    }
    if let expectedRuntime {
      let requirement =
        expectedRuntime.nodeRequirement ??
        "bundled Node.js \(expectedRuntime.nodeMajor).x with NODE_MODULE_VERSION \(expectedRuntime.nodeModuleVersion)"
      if !Self.nodeResolution(resolution, satisfies: expectedRuntime) {
        let version = resolution.version.isEmpty ? "an unknown Node version" : resolution.version
        let moduleVersion = resolution.moduleVersion.isEmpty
          ? "unknown NODE_MODULE_VERSION"
          : "NODE_MODULE_VERSION \(resolution.moduleVersion)"
        return
          "Ghostex bundled gxserver native modules require \(requirement), but the bundled runtime at \(resolution.path) is \(version) (\(moduleVersion)). Reinstall or rebuild Ghostex so the app-owned Node runtime and native modules match."
      }
      return nil
    }
    let major = Self.nodeVersionMajor(resolution.version)
    if major == nil || major! < 22 {
      return "Ghostex bundled code-server Node runtime is too old: \(resolution.version.isEmpty ? "unknown" : resolution.version). Reinstall or rebuild Ghostex so gxserver uses Web/code-server/lib/node."
    }
    return nil
  }

  private static func nodeVersionMajor(_ version: String) -> Int? {
    let normalized = version.hasPrefix("v") ? String(version.dropFirst()) : version
    let majorText = normalized.split(separator: ".").first.map(String.init) ?? ""
    return Int(majorText)
  }

  private func runProcess(
    executable: String,
    arguments: [String],
    timeoutSeconds: TimeInterval
  ) -> (exitCode: Int32, stdout: String, stderr: String) {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    process.environment = normalizedProcessEnvironment()
    let stdout = Pipe()
    let stderr = Pipe()
    process.standardOutput = stdout
    process.standardError = stderr
    do {
      try process.run()
    } catch {
      return (127, "", error.localizedDescription)
    }
    let deadline = Date().addingTimeInterval(timeoutSeconds)
    while process.isRunning && Date() < deadline {
      Thread.sleep(forTimeInterval: 0.05)
    }
    if process.isRunning {
      process.terminate()
      return (124, readPipe(stdout), "Timed out running \(executable) \(arguments.joined(separator: " ")).")
    }
    return (process.terminationStatus, readPipe(stdout), readPipe(stderr))
  }

  private func readPipe(_ pipe: Pipe) -> String {
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    return String(data: data, encoding: .utf8) ?? ""
  }

  private func normalizedProcessEnvironment() -> [String: String] {
    var environment = ProcessInfo.processInfo.environment
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    /*
     CDXC:GxserverBootstrap 2026-05-30-17:14:
     App-packaged gxserver is launched by absolute bundled Node path. Keep normal command locations available for gxserver-managed tools without putting the app runtime ahead of user shells or asking LaunchServices to inherit an interactive PATH.

     CDXC:GxserverBootstrap 2026-06-08-12:17:
     The bundled code-server Node runtime is an app implementation detail. Do not prepend Web/code-server to PATH, because zmx sessions and agent providers should not accidentally see Ghostex's private Node before the user's chosen toolchain.

     CDXC:GxserverBootstrap 2026-06-07-00:38:
     gxserver is the owner of forked zmx provider launches, so its daemon environment must never inherit NO_COLOR from the GUI app or local dev shell. Strip color-disabling keys before Node starts the daemon instead of relying on later terminal-surface cleanup.

     CDXC:PromptEditor 2026-06-09-21:50:
     gxserver must not inherit Ghostex pane identity from the terminal that
     launched the app. Provider scripts export the current S:P:G identity
     explicitly, so strip local/native session keys before starting the daemon
     to keep Ctrl+G prompt-editor return focus from targeting a stale pane.
     */
    for key in Self.colorDisablingEnvironmentKeys + Self.sessionIdentityEnvironmentKeys {
      environment.removeValue(forKey: key)
    }
    /*
     CDXC:PromptEditor 2026-06-11-18:24:
     gxserver starts missing zmx providers before the native Ghostty attach
     process exists. Export the current app executable so gxserver-created agent
     shells can point EDITOR at the same prompt-editor wrapper path as app-created
     terminals without relying on a Homebrew `ghostex` command being on PATH.
     */
    if let appExecutable = Bundle.main.executableURL?.path, !appExecutable.isEmpty {
      environment["GHOSTEX_CLI_EXECUTABLE"] = appExecutable
    }
    let defaultEntries = [
      "/opt/homebrew/bin",
      "/opt/homebrew/sbin",
      "/usr/local/bin",
      "/usr/local/sbin",
      "\(home)/.volta/bin",
      "\(home)/.local/share/mise/shims",
      "\(home)/.local/bin",
      "\(home)/.asdf/shims",
      "\(home)/.nodenv/shims",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
    ]
    let existingEntries = (environment["PATH"] ?? "").split(separator: ":").map(String.init)
    var seen = Set<String>()
    environment["PATH"] = (defaultEntries + existingEntries)
      .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { entry in
        guard !entry.isEmpty, !seen.contains(entry) else {
          return false
        }
        seen.insert(entry)
        return true
      }
      .joined(separator: ":")
    return environment
  }
}
