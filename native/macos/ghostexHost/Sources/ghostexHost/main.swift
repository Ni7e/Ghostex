import AppKit
import Darwin
import GhosttyKit

private let ghostexColorDisablingEnvironmentKeys = [
  "ANSI_COLORS_DISABLED",
  "NO_COLOR",
  "NODE_DISABLE_COLORS",
]

private let ghostexConditionallyColorDisablingEnvironmentKeys = [
  "FORCE_COLOR",
]

private func ghostexEnvironmentValueDisablesColor(_ value: String?) -> Bool {
  guard let normalized = value?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() else {
    return false
  }
  return normalized == "0" || normalized == "false"
}

private func ghostexProcessEnvironmentValue(_ key: String) -> String? {
  guard let value = getenv(key) else {
    return nil
  }
  return String(cString: value)
}

private func removeGhostexProcessColorDisablingEnvironment() {
  /**
   CDXC:ProcessColorEnv 2026-06-07-00:38:
   Ghostex can be launched from agent terminals that export NO_COLOR, but the GUI app is a color-capable host for Ghostty, gxserver, zmx, and forked agent sessions. Strip inherited color-disabling keys at process start so they cannot leak into app-wide environment snapshots.

   CDXC:ProcessColorEnv 2026-06-30-22:56:
   Factory-created Droid sessions can inherit FORCE_COLOR=0 from the shell that launched Ghostex. Treat only disabling FORCE_COLOR values as color blockers so positive FORCE_COLOR overrides remain available.
   */
  for key in ghostexColorDisablingEnvironmentKeys {
    unsetenv(key)
  }
  for key in ghostexConditionallyColorDisablingEnvironmentKeys
  where ghostexEnvironmentValueDisablesColor(ghostexProcessEnvironmentValue(key)) {
    unsetenv(key)
  }
}

private func terminalCliArguments() -> [String] {
  CommandLine.arguments.dropFirst().filter { argument in
    !argument.hasPrefix("-psn_")
  }
}

private func isTerminalCliInvocation() -> Bool {
  isatty(STDIN_FILENO) == 1 || isatty(STDOUT_FILENO) == 1 || isatty(STDERR_FILENO) == 1
}

private func runBundledCli(arguments: [String]) -> Never {
  guard
    let cliScriptPath = Bundle.main.resourceURL?
      .appendingPathComponent("CLI/ghostex-cli.mjs").path,
    FileManager.default.fileExists(atPath: cliScriptPath)
  else {
    fputs("Ghostex CLI is missing from this app bundle. Rebuild or reinstall Ghostex.\n", stderr)
    exit(1)
  }

  let process = Process()
  process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
  process.arguments = ["node", cliScriptPath] + arguments
  process.currentDirectoryURL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
  var environment = ProcessInfo.processInfo.environment
  /**
   CDXC:DevAppFlavor 2026-05-11-12:10
   LaunchServices does not preserve the shell environment that built ghostex-dev.
   Pass the bundle-derived dev home and bridge port into the bundled CLI so
   `ghostex-dev sessions` uses ~/.ghostex-dev and the dev WebSocket bridge instead
   of production state.
   CDXC:GxserverBootstrap 2026-05-30-15:39:
   gxserver owns 58744. Dev CLI bridge automation must use 58742 so launching ghostex-dev cannot occupy or hide the daemon API port.

   CDXC:GxserverMacBootstrap 2026-05-30-15:13:
   gxserver reserves local API port 58744. Keep ghostex-dev CLI bridge traffic
   on 58742 so launching the dev app cannot block daemon startup.
   */
  environment["GHOSTEX_HOME"] = GhostexAppStorage.sharedRootDirectory.path
  if isGhostexDevBundleIdentifier(Bundle.main.bundleIdentifier) {
    environment["GHOSTEX_APP_VARIANT"] = "dev"
    environment["GHOSTEX_CLI_PORT"] = "58742"
  }
  process.environment = environment
  process.standardInput = FileHandle.standardInput
  process.standardOutput = FileHandle.standardOutput
  process.standardError = FileHandle.standardError
  do {
    try process.run()
    process.waitUntilExit()
    exit(process.terminationStatus)
  } catch {
    fputs("Ghostex CLI failed to start node: \(error.localizedDescription)\n", stderr)
    exit(1)
  }
}

private func isGhostexDevBundleIdentifier(_ bundleIdentifier: String?) -> Bool {
  /**
   CDXC:GxserverVerification 2026-05-30-16:25:
   Worktree verification needs a uniquely named dev bundle so LaunchServices does not reuse /Applications/Ghostex-dev.app. Treat every com.madda.ghostex-dev... bundle as the dev flavor so the CLI bridge stays off gxserver port 58744 while preserving the production bundle's existing port.
   */
  bundleIdentifier?.hasPrefix("com.madda.ghostex-dev") == true
}

removeGhostexProcessColorDisablingEnvironment()

let cliArguments = terminalCliArguments()
if !cliArguments.isEmpty || isTerminalCliInvocation() {
  /**
   CDXC:CliSessions 2026-05-10-03:28
   The installed executable is also what shells resolve from PATH. When users
   run a CLI command, treat argv as CLI intent and proxy to the bundled Node
   CLI before AppKit, CEF, or Ghostty can launch the GUI/browser path.
   CDXC:CliBranding 2026-05-26-15:11
   Public CLI commands are `ghostex` and `gx`; the older `gtx` short alias is
   no longer preserved because setup should install only the current concise
   command when that binary name is available.
   LaunchServices `-psn_*` arguments are ignored above so Dock and Finder
   launches still start the app normally.
   CDXC:CliEntrypoint 2026-06-03-20:28:
   Nightly's gxserver cutover keeps `ghostex`/`gx` as terminal CLI entrypoints.
   If PATH resolves the command to the app executable rather than the bundled
   shell launcher, a bare terminal invocation still means CLI/TUI intent while
   Dock/Finder launches remain non-TTY GUI launches.
   CDXC:CliInstall 2026-06-07-13:53:
   The app-owned CLI now lives under Contents/Resources/CLI instead of Web/cli,
   so app-executable terminal invocations proxy to the same runtime that DMG and
   Homebrew symlinks expose.
   */
  runBundledCli(arguments: cliArguments)
}

/**
 CDXC:ChromiumBrowserPanes 2026-05-04-16:38
 Chromium browser panes require CEF's NSApplication subclass before AppKit
 creates the shared application. Prepare it first; the app still reports a
 browser-pane error instead of using WebKit if the CEF runtime is not bundled.
 */
let preparedCEFApplication = GhostexCEFPrepareApplication()

/**
 CDXC:NativeTerminals 2026-04-26-07:21
 Ghostty resolves bundled themes from global runtime state created during
 `ghostty_init`. Set the embedded app's resource directory first so named
 themes from the user's Ghostty config, such as GitHub Dark Default, load
 from Ghostex.app/Contents/Resources/ghostty.
 */
if let resourcesPath = Bundle.main.resourceURL?.appendingPathComponent("ghostty").path {
  setenv("GHOSTTY_RESOURCES_DIR", resourcesPath, 1)
}

if ghostty_init(UInt(CommandLine.argc), CommandLine.unsafeArgv) != GHOSTTY_SUCCESS {
  Ghostty.logger.critical("ghostty_init failed")
  exit(1)
}

private let app = NSApplication.shared
private let delegate = AppDelegate()

app.delegate = delegate
let runsCEFMessageLoop =
  preparedCEFApplication && GhostexCEFInitialize(Int32(CommandLine.argc), CommandLine.unsafeArgv)
if runsCEFMessageLoop {
  app.finishLaunching()
  GhostexCEFRunMessageLoop()
  GhostexCEFShutdown()
} else {
  app.run()
}
