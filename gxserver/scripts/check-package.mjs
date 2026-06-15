#!/usr/bin/env node
import { constants as fsConstants } from "node:fs";
import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const gxserverRoot = path.resolve(scriptDir, "..");
const distRoot = path.join(gxserverRoot, "dist");
const defaultPackageDir = path.join(distRoot, "server-package");
const packageDir = path.resolve(process.argv.includes("--package-dir") ? process.argv[process.argv.indexOf("--package-dir") + 1] : defaultPackageDir);
const formulaPath = path.join(distRoot, "homebrew", "gxserver.rb");
const appNativeNodeMajor = 22;

/*
CDXC:GxserverPackagingChecks 2026-05-30-15:49:
Packaging checks must prove the server-only artifact is headless, uses system Node, contains the expected compiled daemon plus pinned zmx/zehn/bd artifacts, and does not accidentally depend on macOS UI bundle resources.

CDXC:GxserverPackagingChecks 2026-06-08-10:46:
Project board first-open behavior depends on a bundled upstream Beads CLI. Treat `bin/bd` as a required package executable beside zmx and zehn so release artifacts cannot silently fall back to a missing PATH dependency.
*/
await assertInsideDist(packageDir, "server package");
const packageMode = await detectPackageMode(packageDir);
await assertFile(path.join(packageDir, "dist", "protocol", "index.js"));
await assertFile(path.join(packageDir, "dist", "protocol", "index.d.ts"));
await assertFile(path.join(packageDir, "build-identity.json"));
await assertFile(path.join(packageDir, "package.json"));
if (packageMode === "typescript") {
  await assertFile(path.join(packageDir, "dist", "src", "cli.js"));
  await assertFile(path.join(packageDir, "package-lock.json"));
} else {
  await assertAbsent(path.join(packageDir, "dist", "src", "cli.js"), "Rust gxserver package must not stage the JavaScript daemon.");
  await assertAbsent(path.join(packageDir, "package-lock.json"), "Rust gxserver package must not carry npm runtime metadata.");
}
await assertExecutable(path.join(packageDir, "bin", "gxserver"));
await assertExecutable(path.join(packageDir, "bin", "zmx"));
await assertExecutable(path.join(packageDir, "bin", "zehn"));
await assertExecutable(path.join(packageDir, "bin", "bd"));
await assertNoBundledNodeRuntime(packageDir);
await assertNoMacosUiDependency(packageDir);
const packageVersion = await assertPackageManifest(path.join(packageDir, "package.json"), packageMode);
await assertBuildIdentity(path.join(packageDir, "build-identity.json"), packageVersion);
await assertNativeRuntimeContract(packageDir, packageMode);

if (packageDir === defaultPackageDir && (await exists(formulaPath))) {
  await assertHomebrewFormula(formulaPath, packageMode);
}

console.log(`gxserver package checks passed for ${packageDir}`);

async function assertInsideDist(candidatePath, label) {
  const relative = path.relative(distRoot, candidatePath);
  if (relative.startsWith("..") || path.isAbsolute(relative) || relative === "") {
    throw new Error(`${label} output must be under ${distRoot}.`);
  }
}

async function detectPackageMode(root) {
  if (await exists(path.join(root, "dist", "src", "cli.js"))) {
    return "typescript";
  }
  /*
  CDXC:GxserverRustPackaging 2026-06-16-01:30:
  Phase 8 adds a Rust package shape where bin/gxserver is the daemon entrypoint and dist/protocol remains for TypeScript clients. Accept that shape without requiring Node, npm lockfiles, or better-sqlite3 metadata.
  */
  return "rust";
}

async function assertFile(filePath) {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    throw new Error(`Expected file: ${filePath}`);
  }
}

async function assertExecutable(filePath) {
  await assertFile(filePath);
  await access(filePath, fsConstants.X_OK);
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function assertAbsent(filePath, message) {
  if (await exists(filePath)) {
    throw new Error(message);
  }
}

async function assertPackageManifest(manifestPath, packageMode) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (packageMode === "typescript") {
    if (!manifest.engines?.node || !String(manifest.engines.node).includes(">=22")) {
      throw new Error("gxserver package manifest must declare Node >=22.");
    }
    return manifest.version ?? "0.0.0";
  }
  if (manifest.engines?.node) {
    throw new Error("Rust gxserver package manifest must not declare a Node runtime requirement.");
  }
  if (manifest.bin?.gxserver !== "./bin/gxserver") {
    throw new Error("Rust gxserver package manifest must point bin.gxserver at ./bin/gxserver.");
  }
  if (manifest.dependencies?.["better-sqlite3"] || manifest.devDependencies?.["@types/better-sqlite3"]) {
    throw new Error("Rust gxserver package manifest must not depend on better-sqlite3.");
  }
  if (!manifest.exports?.["./protocol"]?.default || !manifest.exports?.["./protocol"]?.types) {
    throw new Error("Rust gxserver package manifest must preserve the ./protocol export.");
  }
  if (!manifest.version) {
    throw new Error("Rust gxserver package manifest must declare a package version.");
  }
  return manifest.version ?? "0.0.0";
}

async function assertBuildIdentity(identityPath, version) {
  const identity = JSON.parse(await readFile(identityPath, "utf8"));
  if (
    identity.packageVersion !== version ||
    typeof identity.fingerprint !== "string" ||
    !identity.fingerprint.startsWith("sha256:") ||
    identity.buildIdentity !== `gxserver:${version}:${identity.fingerprint}`
  ) {
    throw new Error("gxserver package build identity must match the package version and sha256 fingerprint.");
  }
}

async function assertNativeRuntimeContract(root, packageMode) {
  const hasBundledBetterSqlite = await exists(path.join(root, "node_modules", "better-sqlite3"));
  if (packageMode === "rust") {
    if (hasBundledBetterSqlite) {
      throw new Error("Rust gxserver package must not bundle better-sqlite3.");
    }
    if (await exists(path.join(root, "native-runtime.json"))) {
      throw new Error("Rust gxserver package must not include gxserver native-runtime.json.");
    }
    return;
  }
  if (!hasBundledBetterSqlite) {
    return;
  }
  /*
  CDXC:GxserverPackagingChecks 2026-06-06-22:00:
  App packages include prebuilt better-sqlite3, so package checks must fail when the staged artifact lacks the Node ABI metadata macOS uses to verify the bundled app Node runtime.

  CDXC:GxserverPackagingChecks 2026-06-08-12:17:
  Ghostex macOS reuses code-server's bundled Node 22 runtime for gxserver. Native runtime metadata must target that shared app-owned runtime so users are never asked to install Node before the sidebar can start gxserver.
  */
  const runtimePath = path.join(root, "native-runtime.json");
  await assertFile(runtimePath);
  const runtime = JSON.parse(await readFile(runtimePath, "utf8"));
  if (
    runtime.nodeMajor !== appNativeNodeMajor ||
    typeof runtime.nodeModuleVersion !== "string" ||
    runtime.nodeModuleVersion.length === 0 ||
    typeof runtime.nodeVersion !== "string" ||
    runtime.nodeVersion.length === 0 ||
    !Array.isArray(runtime.nativeModules) ||
    !runtime.nativeModules.includes("better-sqlite3")
  ) {
    throw new Error("App-bundled gxserver native runtime metadata must target Node 22 and include better-sqlite3.");
  }
}

async function assertHomebrewFormula(homebrewFormulaPath, packageMode) {
  const formula = await readFile(homebrewFormulaPath, "utf8");
  if (packageMode === "rust") {
    if (formula.includes('depends_on "node@22"') || formula.includes('"npm", "ci"') || formula.includes("dist/src/cli.js")) {
      throw new Error("Rust Homebrew gxserver formula must not install Node or npm dependencies.");
    }
    if (!formula.includes('exec "#{libexec}/bin/gxserver" "$@"')) {
      throw new Error("Rust Homebrew gxserver formula must launch the packaged native binary.");
    }
    return;
  }
  if (!formula.includes('depends_on "node@22"')) {
    throw new Error("Homebrew gxserver formula must declare node@22.");
  }
  if (!formula.includes('"npm", "ci", "--omit=dev"')) {
    throw new Error("Homebrew gxserver formula must install production npm dependencies with system Node.");
  }
  for (const forbidden of ["cask ", ".app", "AppKit", "WebKit", "xcodebuild"]) {
    if (formula.includes(forbidden)) {
      throw new Error(`Homebrew gxserver formula must not depend on macOS UI packaging: ${forbidden}`);
    }
  }
}

async function assertNoBundledNodeRuntime(root) {
  for await (const entry of walk(root)) {
    const base = path.basename(entry);
    if (base === "node" || base === "node.exe") {
      throw new Error(`gxserver server package must use system Node and must not bundle a Node runtime: ${entry}`);
    }
  }
}

async function assertNoMacosUiDependency(root) {
  const forbiddenPathParts = new Set(["Contents", "MacOS", "Frameworks", "native", "ghostexHost"]);
  for await (const entry of walk(root)) {
    const parts = entry.split(path.sep);
    if (parts.some((part) => forbiddenPathParts.has(part)) || entry.endsWith(".app")) {
      throw new Error(`gxserver server-only package must not include macOS UI bundle content: ${entry}`);
    }
  }
}

async function* walk(root) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walk(entryPath);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      yield entryPath;
    }
  }
}
