import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const gxserverClientSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/GxserverClient.swift", import.meta.url),
  "utf8",
);
const buildGhostexHostSource = readFileSync(new URL("../macos/ghostexHost/build-ghostex-host.sh", import.meta.url), "utf8");
const ghostexCliSource = readFileSync(new URL("../../scripts/ghostex-cli.mjs", import.meta.url), "utf8");
const startGhostexSource = readFileSync(new URL("../../scripts/start-ghostex.mjs", import.meta.url), "utf8");

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("gxserver release packaging source contract", () => {
  test("macOS gxserver startup defaults to bundled TypeScript while keeping explicit Rust hard selection", () => {
    /*
    CDXC:GxserverPackaging 2026-06-16-03:08:
    This release temporarily makes the packaged TypeScript daemon the default macOS control plane. Explicit GHOSTEX_GXSERVER_CLI/BIN selections stay hard selections for Rust/source testing and still refuse to stop a different fixed-port owner.
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
    expect(gxserverClientSource).toContain("Selected Rust gxserver");
    expect(gxserverClientSource).toContain("TypeScript gxserver was not started because this launch explicitly opted into Rust");
    expect(gxserverClientSource).toContain("Bundled gxserver TypeScript CLI or gxserver binary is missing");
    expect(gxserverClientSource).not.toContain("resolveDefaultGxserverCliURL");

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

  test("local starts publish and clear explicit gxserver opt-in environment", () => {
    /*
    CDXC:GxserverRustPort 2026-06-14-21:09:
    LaunchServices drops shell environment, so local app starts must forward only explicit gxserver opt-in keys and clear stale values when the packaged default should be used.
    */
    expect(startGhostexSource).toContain('const gxserverOptInLaunchEnvironmentKeys = ["GHOSTEX_GXSERVER_CLI", "GHOSTEX_GXSERVER_BIN"]');
    expect(startGhostexSource).toContain("publishLaunchServicesGxserverOptInEnvironment()");

    const publisherSource = sourceBetween(
      startGhostexSource,
      "function publishLaunchServicesGxserverOptInEnvironment()",
      "function preflightInstalledGxserverBundle",
    );
    expect(publisherSource).toContain('run("launchctl", ["setenv", key, value]');
    expect(publisherSource).toContain('run("launchctl", ["unsetenv", key]');
  });

  test("native macOS build packages TypeScript gxserver by default while keeping Rust opt-in", () => {
    /*
    CDXC:GxserverPackaging 2026-06-16-03:06:
    This release temporarily packages the TypeScript gxserver daemon by default, including Node runtime metadata and the database addon. Rust packaging remains available through GHOSTEX_GXSERVER_PACKAGE_MODE=rust.
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
    expect(buildGhostexHostSource).toContain('GHOSTEX_GXSERVER_PACKAGE_MODE="${GHOSTEX_GXSERVER_PACKAGE_MODE:-typescript}"');
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

  test("installed CLI defaults to packaged TypeScript gxserver and keeps binary fallback", () => {
    /*
    CDXC:GxserverPackaging 2026-06-16-03:10:
    The public `gx server` launcher should discover Web/gxserver/dist/src/cli.js from app resources by default while retaining Web/gxserver/bin/gxserver for Rust opt-in packages and older bundles.
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
    expect(defaultResolverSource).toContain("Bundled gxserver TypeScript CLI or gxserver binary is missing");
  });
});
