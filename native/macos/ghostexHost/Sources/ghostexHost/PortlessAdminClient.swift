import Darwin
import Foundation

final class PortlessAdminClient {
  static let shared = PortlessAdminClient()

  private let fileManager: FileManager

  init(fileManager: FileManager = .default) {
    self.fileManager = fileManager
  }

  func run(_ command: PortlessAdminActionCommand, completion: @escaping (HostEvent) -> Void) {
    Task.detached { [weak self] in
      let event = (self ?? PortlessAdminClient()).perform(command)
      await MainActor.run {
        completion(event)
      }
    }
  }

  private func perform(_ command: PortlessAdminActionCommand) -> HostEvent {
    guard let serviceProtocol = resolvedProtocol(for: command) else {
      return result(
        command,
        portlessProtocol: nil,
        ok: false,
        exitCode: nil,
        status: "missing-protocol",
        errorCode: "missing-protocol")
    }
    guard let runtime = resolveRuntime() else {
      return result(
        command,
        portlessProtocol: serviceProtocol,
        ok: false,
        exitCode: nil,
        status: "missing-bundled-portless-runtime",
        errorCode: "missing-bundled-portless-runtime")
    }

    do {
      let scriptURL = try writeAdminScript(
        action: command.action,
        portlessProtocol: serviceProtocol,
        runtime: runtime)
      defer { try? fileManager.removeItem(at: scriptURL) }
      let scriptResult = runPrivilegedScript(scriptURL)
      return result(
        command,
        portlessProtocol: serviceProtocol,
        ok: scriptResult.ok,
        exitCode: scriptResult.exitCode,
        status: scriptResult.status,
        errorCode: scriptResult.ok ? nil : scriptResult.status)
    } catch {
      return result(
        command,
        portlessProtocol: serviceProtocol,
        ok: false,
        exitCode: nil,
        status: "admin-script-unavailable",
        errorCode: "admin-script-unavailable")
    }
  }

  private func resolvedProtocol(for command: PortlessAdminActionCommand) -> PortlessAdminProtocol? {
    switch command.action {
    case .install, .reconfigure, .retry:
      return command.serviceProtocol
    case .remove:
      return command.serviceProtocol ?? .https
    }
  }

  private func result(
    _ command: PortlessAdminActionCommand,
    portlessProtocol: PortlessAdminProtocol?,
    ok: Bool,
    exitCode: Int32?,
    status: String,
    errorCode: String?
  ) -> HostEvent {
    .portlessAdminResult(
      requestId: command.requestId,
      action: command.action,
      portlessProtocol: command.action == .remove ? nil : portlessProtocol,
      ok: ok,
      exitCode: exitCode,
      status: status,
      errorCode: errorCode)
  }

  private struct Runtime {
    let nodeURL: URL
    let portlessCliURL: URL
  }

  private func resolveRuntime() -> Runtime? {
    /*
     CDXC:PortlessIntegration 2026-06-23-00:15:
     Native Portless admin actions must use Ghostex's bundled code-server Node and bundled Portless CLI under Web/. Do not resolve node or portless from user PATH, global npm installs, gxserver-rs, or per-developer state directories.
     */
    guard let webURL = Bundle.main.resourceURL?.appendingPathComponent("Web", isDirectory: true) else {
      return nil
    }
    let nodeURL = webURL.appendingPathComponent("code-server/lib/node", isDirectory: false)
    let portlessCliURL = webURL.appendingPathComponent("portless/dist/cli.js", isDirectory: false)
    guard fileManager.isExecutableFile(atPath: nodeURL.path),
      fileManager.fileExists(atPath: portlessCliURL.path)
    else {
      return nil
    }
    return Runtime(nodeURL: nodeURL, portlessCliURL: portlessCliURL)
  }

  private func writeAdminScript(
    action: PortlessAdminActionKind,
    portlessProtocol: PortlessAdminProtocol,
    runtime: Runtime
  ) throws -> URL {
    let scriptURL = fileManager.temporaryDirectory
      .appendingPathComponent("ghostex-portless-admin-\(UUID().uuidString).sh")
    let homeDirectory = fileManager.homeDirectoryForCurrentUser.path
    let userName = NSUserName()
    let userId = String(getuid())
    let groupId = String(getgid())
    let adminCommands = portlessAdminCommands(
      action: action,
      portlessProtocol: portlessProtocol,
      runtime: runtime,
      homeDirectory: homeDirectory,
      userId: userId,
      groupId: groupId)
    let script = """
      #!/bin/sh
      set -eu

      USER_HOME=\(shellQuote(homeDirectory))
      USER_NAME=\(shellQuote(userName))
      USER_UID=\(shellQuote(userId))
      USER_GID=\(shellQuote(groupId))
      HOME="$USER_HOME"
      GHOSTEX_DIR="$HOME/.ghostex"
      GXSERVER_DIR="$GHOSTEX_DIR/gxserver"
      PORTLESS_STATE_DIR="$HOME/.ghostex/gxserver/portless"
      NODE_PATH=\(shellQuote(runtime.nodeURL.path))
      PORTLESS_CLI_PATH=\(shellQuote(runtime.portlessCliURL.path))
      SERVICE_LABEL="sh.portless.proxy"
      PLIST_PATH="/Library/LaunchDaemons/$SERVICE_LABEL.plist"

      if [ "$(/usr/bin/id -u)" -ne 0 ]; then
        exit 91
      fi

      /bin/mkdir -p "$PORTLESS_STATE_DIR"
      /usr/sbin/chown "$USER_UID:$USER_GID" "$GHOSTEX_DIR" "$GXSERVER_DIR" "$PORTLESS_STATE_DIR" 2>/dev/null || true
      /usr/sbin/chown -R "$USER_UID:$USER_GID" "$PORTLESS_STATE_DIR" 2>/dev/null || true

      run_portless_cli() {
        /usr/bin/env -i \\
          HOME="$HOME" \\
          USER="$USER_NAME" \\
          LOGNAME="$USER_NAME" \\
          SUDO_USER="$USER_NAME" \\
          SUDO_UID="$USER_UID" \\
          SUDO_GID="$USER_GID" \\
          PATH="/usr/bin:/bin:/usr/sbin:/sbin" \\
          PORTLESS_STATE_DIR="$PORTLESS_STATE_DIR" \\
          PORTLESS_SYNC_HOSTS=0 \\
          "$NODE_PATH" "$PORTLESS_CLI_PATH" "$@"
      }

      \(adminCommands)
      """
    try script.write(to: scriptURL, atomically: true, encoding: .utf8)
    try fileManager.setAttributes([.posixPermissions: 0o700], ofItemAtPath: scriptURL.path)
    return scriptURL
  }

  private func portlessAdminCommands(
    action: PortlessAdminActionKind,
    portlessProtocol: PortlessAdminProtocol,
    runtime: Runtime,
    homeDirectory: String,
    userId: String,
    groupId: String
  ) -> String {
    switch action {
    case .install, .reconfigure, .retry:
      let plist = portlessLaunchdPlist(
        portlessProtocol: portlessProtocol,
        runtime: runtime,
        homeDirectory: homeDirectory,
        userId: userId,
        groupId: groupId)
      let proxyPort: String
      let trustCommand: String
      switch portlessProtocol {
      case .https:
        proxyPort = "443"
        trustCommand = "run_portless_cli trust >/dev/null 2>&1 || true\n"
      case .http:
        proxyPort = "80"
        trustCommand = ""
      }
      return """
        # CDXC:PortlessServiceInstall 2026-06-23-05:11:
        # Ghostex installs the macOS LaunchDaemon plist itself instead of delegating to `portless service install` because Portless 0.14.0 hardcodes launchd stdout/stderr to service.log under the state directory. The root service must use /dev/null output sinks and PORTLESS_SYNC_HOSTS=0 so support bundles never persist Portless paths, hostnames, command/env values, or proxy output.
        \(trustCommand)        /bin/launchctl bootout system "$PLIST_PATH" >/dev/null 2>&1 || true
        run_portless_cli proxy stop --port \(proxyPort) >/dev/null 2>&1 || true
        /bin/cat > "$PLIST_PATH" <<'EOF_PLIST'
        \(plist)
        EOF_PLIST
        /usr/sbin/chown root:wheel "$PLIST_PATH"
        /bin/chmod 644 "$PLIST_PATH"
        /bin/launchctl bootstrap system "$PLIST_PATH"
        /bin/launchctl enable "system/$SERVICE_LABEL"
        /bin/launchctl kickstart -k "system/$SERVICE_LABEL"
        """
    case .remove:
      return """
        /bin/launchctl bootout system "$PLIST_PATH" >/dev/null 2>&1 || true
        /bin/rm -f "$PLIST_PATH"
        """
    }
  }

  private func portlessLaunchdPlist(
    portlessProtocol: PortlessAdminProtocol,
    runtime: Runtime,
    homeDirectory: String,
    userId: String,
    groupId: String
  ) -> String {
    let port: String
    let https: String
    let protocolFlag: String
    switch portlessProtocol {
    case .https:
      port = "443"
      https = "1"
      protocolFlag = "--https"
    case .http:
      port = "80"
      https = "0"
      protocolFlag = "--no-tls"
    }
    let stateDir = "\(homeDirectory)/.ghostex/gxserver/portless"
    return """
      <?xml version="1.0" encoding="UTF-8"?>
      <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
      <plist version="1.0">
      <dict>
        <key>Label</key>
        <string>sh.portless.proxy</string>
        <key>ProgramArguments</key>
        <array>
          <string>\(xmlEscape(runtime.nodeURL.path))</string>
          <string>\(xmlEscape(runtime.portlessCliURL.path))</string>
          <string>proxy</string>
          <string>start</string>
          <string>--foreground</string>
          <string>--port</string>
          <string>\(port)</string>
          <string>\(protocolFlag)</string>
          <string>--tld</string>
          <string>localhost</string>
          <string>--skip-trust</string>
        </array>
        <key>EnvironmentVariables</key>
        <dict>
          <key>HOME</key>
          <string>\(xmlEscape(homeDirectory))</string>
          <key>SUDO_UID</key>
          <string>\(xmlEscape(userId))</string>
          <key>SUDO_GID</key>
          <string>\(xmlEscape(groupId))</string>
          <key>PORTLESS_STATE_DIR</key>
          <string>\(xmlEscape(stateDir))</string>
          <key>PORTLESS_PORT</key>
          <string>\(port)</string>
          <key>PORTLESS_HTTPS</key>
          <string>\(https)</string>
          <key>PORTLESS_TLD</key>
          <string>localhost</string>
          <key>PORTLESS_LAN</key>
          <string>0</string>
          <key>PORTLESS_WILDCARD</key>
          <string>0</string>
          <key>PORTLESS_SYNC_HOSTS</key>
          <string>0</string>
        </dict>
        <key>RunAtLoad</key>
        <true/>
        <key>KeepAlive</key>
        <true/>
        <key>StandardOutPath</key>
        <string>/dev/null</string>
        <key>StandardErrorPath</key>
        <string>/dev/null</string>
      </dict>
      </plist>
      """
  }

  private func runPrivilegedScript(_ scriptURL: URL) -> (ok: Bool, exitCode: Int32, status: String) {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    process.arguments = [
      "-e",
      "do shell script \(appleScriptString("/bin/sh \(shellQuote(scriptURL.path))")) with administrator privileges",
    ]
    process.standardInput = FileHandle.nullDevice

    let pipe = Pipe()
    process.standardOutput = pipe
    process.standardError = pipe
    let outputLock = NSLock()
    var outputData = Data()
    let outputHandle = pipe.fileHandleForReading
    outputHandle.readabilityHandler = { handle in
      let data = handle.availableData
      guard !data.isEmpty else {
        return
      }
      outputLock.lock()
      appendCapped(data, to: &outputData)
      outputLock.unlock()
    }

    do {
      try process.run()
      process.waitUntilExit()
      outputHandle.readabilityHandler = nil
      let remainingData = outputHandle.readDataToEndOfFile()
      outputLock.lock()
      appendCapped(remainingData, to: &outputData)
      let output = String(data: outputData, encoding: .utf8) ?? ""
      outputLock.unlock()
      if process.terminationStatus == 0 {
        return (true, process.terminationStatus, "completed")
      }
      return (
        false,
        process.terminationStatus,
        failureStatus(exitCode: process.terminationStatus, output: output)
      )
    } catch {
      outputHandle.readabilityHandler = nil
      return (false, 127, "admin-launch-failed")
    }
  }

  private func failureStatus(exitCode: Int32, output: String) -> String {
    let normalizedOutput = output.lowercased()
    if normalizedOutput.contains("user canceled") || normalizedOutput.contains("user cancelled") {
      return "authorization-cancelled"
    }
    if exitCode == 91 {
      return "admin-required"
    }
    return "portless-cli-failed"
  }

  private func shellQuote(_ value: String) -> String {
    "'\(value.replacingOccurrences(of: "'", with: "'\\''"))'"
  }

  private func appleScriptString(_ value: String) -> String {
    "\"\(value.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\""))\""
  }

  private func xmlEscape(_ value: String) -> String {
    value
      .replacingOccurrences(of: "&", with: "&amp;")
      .replacingOccurrences(of: "<", with: "&lt;")
      .replacingOccurrences(of: ">", with: "&gt;")
      .replacingOccurrences(of: "\"", with: "&quot;")
      .replacingOccurrences(of: "'", with: "&apos;")
  }
}

private func appendCapped(_ data: Data, to outputData: inout Data) {
  let maxBytes = 4096
  guard outputData.count < maxBytes else {
    return
  }
  let remainingByteCount = maxBytes - outputData.count
  outputData.append(contentsOf: data.prefix(remainingByteCount))
}
