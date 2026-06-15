import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const nativeT3LogSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/NativeT3CodePaneReproLog.swift", import.meta.url),
  "utf8",
);
const appDelegateSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift", import.meta.url),
  "utf8",
);
const terminalWorkspaceSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift", import.meta.url),
  "utf8",
);
const hostProtocolSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/HostProtocol.swift", import.meta.url),
  "utf8",
);
const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");
const buildGhostexHostSource = readFileSync(
  new URL("../macos/ghostexHost/build-ghostex-host.sh", import.meta.url),
  "utf8",
);
const codeSignGhostexHostSource = readFileSync(
  new URL("../macos/ghostexHost/codesign-ghostex-host.sh", import.meta.url),
  "utf8",
);
const codeServerBuildVscodeSource = readFileSync(
  new URL("../../code-server/ci/build/build-vscode.sh", import.meta.url),
  "utf8",
);
const runGhostexHostSource = readFileSync(
  new URL("../macos/ghostexHost/run-ghostex-host.sh", import.meta.url),
  "utf8",
);
const startGhostexSource = readFileSync(new URL("../../scripts/start-ghostex.mjs", import.meta.url), "utf8");
const releaseGhostexSource = readFileSync(new URL("../../scripts/release-ghostex.mjs", import.meta.url), "utf8");
const bundleValidatorSource = readFileSync(new URL("../../scripts/validate-macos-app-bundle.mjs", import.meta.url), "utf8");
const packageJsonSource = readFileSync(new URL("../../package.json", import.meta.url), "utf8");
const automationVerifierSource = readFileSync(
  new URL("../../scripts/verify-automations-runtime.mjs", import.meta.url),
  "utf8",
);
const projectOverviewSource = readFileSync(new URL("../../docs/product/PROJECT-OVERVIEW.md", import.meta.url), "utf8");
const removedDevScriptName = `start-${"ghostex"}-${"dev"}.mjs`;
const removedDevPackageScriptName = `start${":dev"}`;
const devStartWrapperUrl = new URL(`../../scripts/${removedDevScriptName}`, import.meta.url);

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("T3 runtime packaging", () => {
  test("native runtime launcher resolves the packaged Web/t3code-server entrypoint", () => {
    /*
    CDXC:T3CodePackaging 2026-06-07-02:30:
    The macOS build stages T3 Code under Contents/Resources/Web/t3code-server. Native startup must check that Web path before falling back to legacy probes, or installed apps show the T3 loading pane forever while the packaged runtime is present but unused.
    */
    const resolver = sourceBetween(
      nativeT3LogSource,
      "private static func bundledRuntimeEntrypointPath",
      "private static func expandedPath",
    );
    expect(resolver).toContain('"Web/\\(bundledDirectoryName)/dist/bin.mjs"');
    expect(resolver.indexOf('"Web/\\(bundledDirectoryName)/dist/bin.mjs"')).toBeLessThan(
      resolver.indexOf('"out/\\(bundledDirectoryName)/dist/bin.mjs"'),
    );
  });

  test("native runtime startup retains one in-flight packaged server launch", () => {
    /*
    CDXC:T3CodeStartup 2026-06-07-02:46:
    Opening or restoring a T3 pane can send start requests through both native host surfaces while the packaged server is still migrating and bootstrapping auth. Both callers must share one launch claim and retain young unresponsive processes so the first server finishes instead of being replaced by a duplicate launch.
    */
    const launcher = sourceBetween(
      nativeT3LogSource,
      "enum NativeT3RuntimeLauncher",
      "struct NativeT3ThreadRoute",
    );
    expect(launcher).toContain("static let startupGraceInterval: TimeInterval = 30.0");
    expect(launcher).toContain("private static let launchAttemptLock = NSLock()");
    expect(launcher).toContain("static func claimLaunchStart() -> LaunchStartClaim");
    expect(launcher).toContain("case retained(TimeInterval)");

    expect(appDelegateSource.match(/private var t3CodeRuntimeStartedAt: Date\?/g)).toHaveLength(2);
    expect(appDelegateSource.match(/NativeT3RuntimeLauncher\.claimLaunchStart\(\)/g)).toHaveLength(2);
    expect(appDelegateSource.match(/t3Runtime\.start\.launchInProgressRetained/g)).toHaveLength(2);
    expect(appDelegateSource.match(/t3CodeRuntimeStartedAt = launchStartedAt/g)).toHaveLength(2);
    expect(appDelegateSource).not.toContain('reloadManagedT3WebPanes(reason: "runtimeRetainedDuringStartup")');
    expect(appDelegateSource.match(/reloadManagedT3WebPanes\(reason: "runtimeSpawned"\)/g)).toHaveLength(2);
    expect(appDelegateSource.match(/t3Runtime\.start\.backoffActive/g)).toHaveLength(2);
    expect(appDelegateSource.match(/NativeT3RuntimeFailureNotice\.shouldNotifyLaunchExit/g)).toHaveLength(2);
    expect(
      appDelegateSource.match(/NativeT3RuntimeLauncher\.clearLaunchAttempt\(startedAt: launchStartedAt\)/g)
        ?.length,
    ).toBeGreaterThanOrEqual(4);
  });

  test("native runtime auth failures stop the loading loop and show a capped toast", () => {
    /*
    CDXC:T3CodeStartup 2026-06-09-07:07:
    Failed managed T3 startup must not keep entering the auth/thread-route retry loop or repaint existing panes every liveness tick. Native should emit a dedicated failure event, render a stable pane error, and let React show a short capped toast.
    */
    const browserAuth = sourceBetween(
      nativeT3LogSource,
      "enum NativeT3RuntimeBrowserAuth",
      "fileprivate static func readOwnerBearerTokenForManagedRuntime",
    );
    expect(browserAuth).toContain("completion: @escaping (Result<Void, Error>) -> Void");
    expect(browserAuth).toContain("nativeT3Runtime.browserAuth.retry.exhausted");
    expect(browserAuth).toContain("result: .failure(NativeT3RuntimeFailureNotice.error(reason: reason))");

    const webPaneLoader = sourceBetween(
      terminalWorkspaceSource,
      "private func loadWebPane(sessionId: String, url: URL, reason: String)",
      "func reloadManagedT3WebPanes(reason: String)",
    );
    expect(webPaneLoader).toContain("authResult");
    expect(webPaneLoader).toContain("handleT3WebPaneRuntimeFailure");

    const failureHandler = sourceBetween(
      terminalWorkspaceSource,
      "private func handleT3WebPaneRuntimeFailure",
      "private func loadWebPaneStatus",
    );
    expect(failureHandler).toContain(".t3RuntimeStartFailed(sessionId: session.sessionId, message: notice)");
    expect(failureHandler).toContain("loadWebPaneError(session: session, message: notice)");

    expect(hostProtocolSource).toContain("case t3RuntimeStartFailed(sessionId: String?, message: String)");
    expect(hostProtocolSource).toContain('try container.encode("t3RuntimeStartFailed", forKey: .type)');
    expect(nativeSidebarSource).toContain('type: "t3RuntimeStartFailed"');
    expect(nativeSidebarSource).toContain("const MAX_T3_RUNTIME_TOAST_MESSAGE_LINES = 3");
    expect(nativeSidebarSource).toContain("compactT3RuntimeToastMessage(hostEvent.message)");
    expect(nativeSidebarSource).toContain("toastId: T3_RUNTIME_TOAST_ID");
  });

  test("local starts validate the same packaged T3 architecture shape as release", () => {
    /*
    CDXC:LocalStartReleaseParity 2026-06-09-09:07:
    Production `bun run start` should test a Release-shaped bundled app without notarization. The local start path must clear stale dev LaunchServices overrides, run the shared release bundle validator, and reject cross-architecture T3 node-pty staging before opening Ghostex.

    CDXC:LocalStartSingleApp 2026-06-09-09:27:
    Ghostex-dev local start and build entry points were removed because agents were invoking the alternate app by mistake. Source-level tests should keep package scripts, docs, verifier instructions, and native build gates aligned on the single Ghostex app path.
    */
    const configurationResolver = sourceBetween(
      startGhostexSource,
      "function resolveLocalStartConfiguration",
      "function normalizeMacosArch",
    );
    expect(startGhostexSource).toContain("import { validateMacosAppBundle } from \"./validate-macos-app-bundle.mjs\"");
    expect(startGhostexSource).toContain("CONFIGURATION: configuration");
    expect(startGhostexSource).toContain("resolveLocalStartCodeSignIdentity(startEnvironment)");
    expect(startGhostexSource).toContain("GHOSTEX_CODE_SIGN_IDENTITY: localStartCodeSignIdentity");
    expect(startGhostexSource).toContain('GHOSTEX_LOCAL_START: "1"');
    expect(configurationResolver).toContain('return "Release"');
    const signingResolver = sourceBetween(
      startGhostexSource,
      "function resolveLocalStartCodeSignIdentity",
      "function normalizeMacosArch",
    );
    expect(signingResolver).toContain('identity.name.startsWith("Apple Development: ")');
    expect(signingResolver).toContain('identity.name.startsWith("Developer ID Application: ")');
    expect(signingResolver).toContain("falling back to ad-hoc signing");
    const installedSignatureSource = sourceBetween(
      startGhostexSource,
      "function hasReusableInstalledAppCodeSignature",
      "function hasLinkerSignedBundledNativeModules",
    );
    expect(installedSignatureSource).toContain("function signatureDetailsMatchesExpectedIdentity");
    expect(installedSignatureSource).toContain("Signature=adhoc");
    expect(installedSignatureSource).toContain("Authority=${identity}");
    expect(startGhostexSource).toContain('run(path.join(hostScriptDir, "codesign-ghostex-host.sh"), [appPath], { env: buildEnv })');
    expect(buildGhostexHostSource).toContain("CDXC:MacOSPermissions 2026-06-16-02:27");
    expect(buildGhostexHostSource).toContain("local_start_build_signing()");
    expect(buildGhostexHostSource).toContain("local_start_build_cache_reusable");
    expect(buildGhostexHostSource).toContain("signature_matches_requested_identity");
    expect(codeSignGhostexHostSource).toContain("CDXC:MacOSPermissions 2026-06-16-02:27");
    expect(codeSignGhostexHostSource).toContain("local_start_signing()");
    expect(codeSignGhostexHostSource).toContain("can_reuse_local_signature");
    expect(startGhostexSource).toContain("await validateMacosAppBundle({ appName, appPath: installedApp, arch })");
    expect(startGhostexSource).toContain("CDXC:LocalStartGxserver 2026-06-12-09:58");
    expect(startGhostexSource).toContain("resolveBundledNodeForGxserverPreflight(appPath, runtime)");
    expect(startGhostexSource).toContain("runtime.nodeVersion || `v${runtime.nodeMajor}.0.0`");
    expect(startGhostexSource).not.toContain("preflightNativeNodeModuleLoad");
    expect(startGhostexSource).toContain("clearLaunchServicesDevelopmentEnvironment");
    expect(startGhostexSource).toContain('"VSMUX_T3CODE_REPO_ROOT"');
    expect(startGhostexSource).toContain("validateStartArguments(process.argv.slice(2), process.env.GHOSTEX_APP_VARIANT)");
    expect(startGhostexSource).toContain('GHOSTEX_APP_VARIANT: "prod"');
    expect(startGhostexSource).toContain("GHOSTEX_APP_NAME: appName");
    expect(startGhostexSource).toContain("GHOSTEX_BUNDLE_ID: bundleId");
    expect(startGhostexSource).toContain("Ghostex-dev local starts were removed");
    expect(startGhostexSource).not.toContain('const appName = variant === "dev"');
    expect(packageJsonSource).not.toContain(`"${removedDevPackageScriptName}"`);
    expect(packageJsonSource).not.toContain('"build:dev"');
    expect(existsSync(devStartWrapperUrl)).toBe(false);
    expect(buildGhostexHostSource).toContain("Ghostex-dev builds were removed");
    expect(buildGhostexHostSource).toContain("uses_removed_dev_app_value");
    expect(runGhostexHostSource).toContain("Ghostex-dev local starts were removed");
    expect(automationVerifierSource).toContain('"  bun run start"');
    expect(automationVerifierSource).not.toContain(removedDevPackageScriptName);
    expect(projectOverviewSource).not.toContain(removedDevPackageScriptName);

    const t3Package = sourceBetween(
      buildGhostexHostSource,
      "package_t3code_server()",
      "build_zmx_if_needed",
    );
    expect(buildGhostexHostSource).toContain("node_pty_prebuilds_match_arch()");
    expect(buildGhostexHostSource).toContain("code_server_vscode_payload_digest()");
    expect(buildGhostexHostSource).toContain("code_server_vscode_ripgrep_bin()");
    expect(buildGhostexHostSource).toContain("code-server-vscode-payload-$GHOSTEX_MACOS_ARCH");
    expect(buildGhostexHostSource).toContain("$target_dir/lib/vscode/node_modules/@vscode/ripgrep/bin/rg");
    expect(codeServerBuildVscodeSource).toContain("ensure-vscode-ripgrep-platform()");
    expect(codeServerBuildVscodeSource).toContain('env npm_config_arch="$(vscode-ripgrep-node-arch)"');
    expect(codeServerBuildVscodeSource).toContain("ensure-github-token-for-vscode-build");
    expect(codeServerBuildVscodeSource).toContain("gh auth token -h github.com");
    expect(t3Package).toContain("expected_node_pty_prebuild");
    expect(t3Package).toContain("node_modules/node-pty/prebuilds/$(node_pty_prebuild_platform_dir)/pty.node");
    expect(t3Package).toContain('node_pty_prebuilds_match_arch "$target_dir"');

    expect(releaseGhostexSource).toContain("import { validateMacosAppBundle } from \"./validate-macos-app-bundle.mjs\"");
    expect(releaseGhostexSource).toContain("await validateMacosAppBundle({ appName: config.appName, appPath: entry.appPath, arch: entry.arch })");
    expect(bundleValidatorSource).toContain("CDXC:LocalStartRuntimePolicy 2026-06-12-09:58");
    expect(bundleValidatorSource).not.toContain("T3 Code --help smoke test");
    expect(bundleValidatorSource).not.toContain("assertNativeModuleLoads");
    expect(bundleValidatorSource).toContain("nativeRuntime.nodeModuleVersion");
    expect(bundleValidatorSource).toContain('path.join(t3NodePtyPrebuildRoot, "pty.node")');
    expect(bundleValidatorSource).toContain('path.join(t3NodePtyPrebuildRoot, "spawn-helper")');
    expect(bundleValidatorSource).toContain('path.join(codeServerRoot, "lib", "vscode", "node_modules", "@vscode", "ripgrep", "bin", "rg")');
    expect(bundleValidatorSource).toContain("VS Code ripgrep --version smoke test");
    expect(bundleValidatorSource).toContain("Expected only");
  });

  test("native setup checks Cua Driver permissions without prompting", () => {
    /*
    CDXC:CuaPermissions 2026-06-16-02:27:
    Rebuilding or opening Ghostex must not trigger macOS Screen Recording prompts through a passive Cua Driver status refresh. The native setup probe must pass prompt:false exactly like the bundled agent skill.
    */
    const cuaStatusSource = sourceBetween(
      nativeSidebarSource,
      "const cuaDriverPath = which(\"cua-driver\")",
      "let detail;",
    );

    expect(cuaStatusSource).toContain("CDXC:CuaPermissions 2026-06-16-02:27");
    expect(cuaStatusSource).toContain('["check_permissions", JSON.stringify({ prompt: false })]');
    expect(cuaStatusSource).not.toContain('["check_permissions"],');
  });
});
