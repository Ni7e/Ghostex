import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const gxserverClientSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/GxserverClient.swift", import.meta.url),
  "utf8",
);
const buildGhostexHostSource = readFileSync(new URL("../macos/ghostexHost/build-ghostex-host.sh", import.meta.url), "utf8");
const ghostexCliSource = readFileSync(new URL("../../scripts/ghostex-cli.mjs", import.meta.url), "utf8");
const startGhostexSource = readFileSync(new URL("../../scripts/start-ghostex.mjs", import.meta.url), "utf8");
const nativeSidebarGxserverClientSource = readFileSync(new URL("gxserver-client.ts", import.meta.url), "utf8");
const gxserverRustServerSource = readFileSync(new URL("../../gxserver-rs/src/server.rs", import.meta.url), "utf8");
const gxserverRustPathsSource = readFileSync(new URL("../../gxserver-rs/src/paths.rs", import.meta.url), "utf8");

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("gxserver release packaging source contract", () => {
  test("macOS gxserver startup defaults to bundled Rust while keeping explicit hard selection", () => {
    /*
    CDXC:GxserverPackaging 2026-06-21-13:45:
    The macOS app now defaults to the packaged gxserver-rs control plane. Explicit GHOSTEX_GXSERVER_CLI/BIN selections stay hard selections for source validation and still refuse to stop a different fixed-port owner.
    */
    expect(gxserverClientSource).toContain('"GHOSTEX_GXSERVER_CLI"');
    expect(gxserverClientSource).toContain('"GHOSTEX_GXSERVER_BIN"');
    expect(gxserverClientSource).toContain("Web/gxserver/dist/src/cli.js");
    expect(gxserverClientSource).toContain("native/macos/ghostexHost/Web/gxserver/dist/src/cli.js");
    expect(gxserverClientSource).toContain("Web/gxserver/bin/gxserver");
    expect(gxserverClientSource).toContain("native/macos/ghostexHost/Web/gxserver/bin/gxserver");
    expect(gxserverClientSource).toContain("case nativeExecutable");
    expect(gxserverClientSource).toContain('expectedBundledBuildIdentity(for: url) ?? "gxserver:\\(version):rust-source"');
    expect(gxserverClientSource).toContain("isExplicitSelection: true");
    expect(gxserverClientSource).toContain("isExplicitSelection: false");
    expect(gxserverClientSource).toContain("Selected native gxserver");
    expect(gxserverClientSource).toContain("The packaged gxserver was not started because this launch explicitly selected another daemon");
    expect(gxserverClientSource).toContain("Bundled gxserver binary is missing");
    expect(gxserverClientSource).not.toContain("resolveDefaultGxserverCliURL");

    const defaultResolverSource = sourceBetween(
      gxserverClientSource,
      "private func resolveDefaultGxserverLaunchPlan()",
      "private func gxserverDevelopmentRoots()",
    );
    expect(defaultResolverSource.indexOf("Web/gxserver/bin/gxserver")).toBeLessThan(
      defaultResolverSource.indexOf("Web/gxserver/dist/src/cli.js"),
    );
    expect(defaultResolverSource).toContain("isRustGxserverPackageExecutable($0)");
    expect(gxserverClientSource).toContain("Both Rust and TypeScript app packages contain bin/gxserver");

    const startOrReuseSource = sourceBetween(
      gxserverClientSource,
      "func startOrReuse(allowStart: Bool? = nil)",
      "var alwaysStartOnLaunch",
    );
    expect(startOrReuseSource).toContain("if launchPlan?.kind == .nativeExecutable && launchPlan?.isExplicitSelection == true");
    expect(startOrReuseSource.indexOf("if launchPlan?.kind == .nativeExecutable && launchPlan?.isExplicitSelection == true")).toBeLessThan(
      startOrReuseSource.indexOf("await stopRunningGxserverControlPlane()"),
    );

    const launchSource = sourceBetween(
      gxserverClientSource,
      "private func launchGxserverForeground(plan:",
      "private func shellQuote",
    );
    expect(launchSource).toContain("case .javascriptCli");
    expect(launchSource).toContain("case .nativeExecutable");
    expect(launchSource).toContain("--foreground");
  });

  test("local starts publish and clear explicit gxserver selection environment", () => {
    /*
    CDXC:GxserverRustPort 2026-06-21-13:45:
    LaunchServices drops shell environment, so local app starts must forward only explicit gxserver selection keys and clear stale values when the packaged Rust default should be used.
    */
    expect(startGhostexSource).toContain('const gxserverExplicitLaunchEnvironmentKeys = ["GHOSTEX_GXSERVER_CLI", "GHOSTEX_GXSERVER_BIN"]');
    expect(startGhostexSource).toContain("publishLaunchServicesGxserverExplicitEnvironment()");

    const publisherSource = sourceBetween(
      startGhostexSource,
      "function publishLaunchServicesGxserverExplicitEnvironment()",
      "function preflightInstalledGxserverBundle",
    );
    expect(publisherSource).toContain('run("launchctl", ["setenv", key, value]');
    expect(publisherSource).toContain('run("launchctl", ["unsetenv", key]');
  });

  test("native macOS build packages Rust gxserver by default while keeping TypeScript validation mode", () => {
    /*
    CDXC:GxserverPackaging 2026-06-21-13:45:
    Local and release macOS builds package gxserver-rs by default so the rebuilt app launches the Rust daemon. TypeScript packaging stays explicit through GHOSTEX_GXSERVER_PACKAGE_MODE=typescript for validation only.
    */
    const rustBuildSource = sourceBetween(
      buildGhostexHostSource,
      "build_gxserver_rust_if_needed()",
      "build_zehn_if_needed()",
    );
    expect(rustBuildSource).toContain("cargo_target=\"$(gxserver_rust_cargo_target)\"");
    expect(rustBuildSource).toContain("build --release");
    expect(rustBuildSource).toContain("--manifest-path \"$GXSERVER_RS_ROOT/Cargo.toml\"");
    expect(rustBuildSource).toContain("--target \"$cargo_target\"");

    const packageSource = sourceBetween(
      buildGhostexHostSource,
      "package_gxserver_if_needed()",
      "# CDXC:CodeServerRuntime",
    );
    expect(buildGhostexHostSource).toContain('GHOSTEX_GXSERVER_PACKAGE_MODE="${GHOSTEX_GXSERVER_PACKAGE_MODE:-rust}"');
    expect(packageSource).toContain('--value "mode=typescript"');
    expect(packageSource).toContain('--value "mode=rust"');
    expect(packageSource).toContain("rust_bin=\"$(build_gxserver_rust_if_needed)\"");
    expect(packageSource).toContain("--rust-bin \"$rust_bin\"");
    expect(packageSource).toContain("run package:app --");
    expect(packageSource).toContain("--native-node \"$GXSERVER_NODE_BIN\"");
    expect(packageSource).toContain("--native-npm \"$GXSERVER_NPM_BIN\"");
    expect(packageSource).toContain("native-runtime.json");
    expect(buildGhostexHostSource).toContain("better-sqlite3/build/Release/better_sqlite3.node");
    expect(packageSource).toContain("$target_dir/bin/gxserver");
    expect(packageSource).toContain("$target_dir/dist/protocol/index.js");
    expect(packageSource).toContain("$target_dir/dist/protocol/index.d.ts");
  });

  test("installed CLI defaults to packaged Rust gxserver and keeps TypeScript validation fallback", () => {
    /*
    CDXC:GxserverPackaging 2026-06-21-13:45:
    The public `gx server` launcher should discover Web/gxserver/bin/gxserver from app resources before any TypeScript CLI so shell and macOS app starts use the same Rust daemon by default.
    */
    expect(ghostexCliSource).toContain("function resolveGxserverCliLaunchFromRoot(root)");
    expect(ghostexCliSource).toContain('path.join(root, "gxserver", "dist", "src", "cli.js")');
    expect(ghostexCliSource).toContain(
      'path.join(root, "native", "macos", "ghostexHost", "Web", "gxserver", "dist", "src", "cli.js")',
    );
    expect(ghostexCliSource).toContain('path.join(root, "gxserver", "bin", "gxserver")');
    expect(ghostexCliSource).toContain('path.join(root, "native", "macos", "ghostexHost", "Web", "gxserver", "bin", "gxserver")');
    expect(ghostexCliSource).toContain("set GHOSTEX_GXSERVER_CLI/BIN for an explicit source/reference daemon");

    const defaultResolverSource = sourceBetween(
      ghostexCliSource,
      "function resolveGxserverCliLaunch()",
      "function resolveGxserverCliLaunchFromRoot(root)",
    );
    const rootResolverSource = sourceBetween(
      ghostexCliSource,
      "function resolveGxserverCliLaunchFromRoot(root)",
      "function resolveGxserverCliLaunchForPath",
    );
    expect(rootResolverSource.indexOf('path.join(root, "gxserver", "bin", "gxserver")')).toBeLessThan(
      rootResolverSource.indexOf('path.join(root, "gxserver", "dist", "src", "cli.js")'),
    );
    expect(defaultResolverSource).toContain("Bundled gxserver binary is missing");
  });

  test("Rust cutover preserves the macOS sidebar sessions contract", () => {
    /*
    CDXC:GxserverSidebarSessions 2026-06-21-13:45:
    Before cutting macOS over from TypeScript gxserver to gxserver-rs, the Rust daemon must read the same ~/.ghostex/gxserver/state.db project/session tables and expose the same listProjects plus readPresentationSnapshot startup surface that the sidebar uses to render visible sessions.
    */
    expect(gxserverRustPathsSource).toContain('home_dir.join(".ghostex").join("gxserver")');
    expect(gxserverRustPathsSource).toContain('state_db_file: root_dir.join("state.db")');
    expect(nativeSidebarGxserverClientSource).toContain('rpc<{ projects: GxserverProjectDomainState[] }>("/api/listProjects")');
    expect(nativeSidebarGxserverClientSource).toContain('rpc<{ snapshot: GxserverPresentationSnapshot }>("/api/readPresentationSnapshot")');
    expect(gxserverRustServerSource).toContain('"/api/listProjects" => handle_domain_http');
    expect(gxserverRustServerSource).toContain('repository\n                    .list_projects()');
    expect(gxserverRustServerSource).toContain('"/api/readPresentationSnapshot" => handle_domain_http');
    expect(gxserverRustServerSource).toContain('read_presentation_snapshot(db, server_id)');
  });
});
