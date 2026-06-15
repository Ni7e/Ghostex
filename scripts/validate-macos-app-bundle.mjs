import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

export class MacosAppBundleValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "MacosAppBundleValidationError";
  }
}

/**
 * CDXC:LocalStartReleaseParity 2026-06-09-09:07:
 * Local production starts should validate the same bundled runtime shape as release builds without paying notarization or DMG costs. Keep app-bundle resource checks in one module so `bun run start` and release automation reject stale cross-architecture Web resources before the app opens.
 */
export async function validateMacosAppBundle({ appPath, arch, appName = "Ghostex" }) {
  if (!appPath || !arch) {
    throw new MacosAppBundleValidationError("validateMacosAppBundle requires appPath and arch.");
  }
  if (!existsSync(appPath)) {
    throw new MacosAppBundleValidationError(`${arch} app is missing: ${appPath}`);
  }

  const resourcesRoot = path.join(appPath, "Contents", "Resources", "Web");
  const expectedNodePtyPrebuild = expectedNodePtyPrebuildForArch(arch);
  await assertMachOContainsArch(path.join(appPath, "Contents", "MacOS", appName), arch);
  await assertMachOContainsArch(
    path.join(appPath, "Contents", "Frameworks", "Chromium Embedded Framework.framework", "Chromium Embedded Framework"),
    arch,
  );
  await validateBundledCodeServerRuntime({ arch, resourcesRoot });
  await validateBundledResourceShape({ arch, resourcesRoot, expectedNodePtyPrebuild });
  await validateBundledT3Runtime({ arch, resourcesRoot, expectedNodePtyPrebuild });
}

function expectedNodePtyPrebuildForArch(arch) {
  if (arch === "arm64") {
    return "darwin-arm64";
  }
  if (arch === "x86_64") {
    return "darwin-x64";
  }
  throw new MacosAppBundleValidationError(`Unsupported macOS app architecture: ${arch}`);
}

async function validateBundledCodeServerRuntime({ arch, resourcesRoot }) {
  const codeServerRoot = path.join(resourcesRoot, "code-server");
  const codeServerNode = path.join(codeServerRoot, "lib", "node");
  const codeServerEntrypoint = path.join(codeServerRoot, "out", "node", "entry.js");
  const codeServerVscodeEntrypoint = path.join(codeServerRoot, "lib", "vscode", "out", "server-main.js");
  const codeServerVscodeRipgrep = path.join(codeServerRoot, "lib", "vscode", "node_modules", "@vscode", "ripgrep", "bin", "rg");
  const obsoleteWebNode = path.join(resourcesRoot, "bin", "node");

  /*
   CDXC:CodeServerRuntime 2026-06-09-17:06:
   Embedded VS Code search shells out to @vscode/ripgrep/bin/rg. Treat that binary as a required app resource, not an optional npm postinstall side effect, so local starts and releases fail before users see ENOENT in the search panel.
   */
  await assertRequiredPaths(arch, "bundled code-server runtime resource", [
    codeServerRoot,
    codeServerNode,
    codeServerEntrypoint,
    codeServerVscodeEntrypoint,
    codeServerVscodeRipgrep,
  ]);
  if (existsSync(obsoleteWebNode)) {
    throw new MacosAppBundleValidationError(
      `${arch} app still bundles duplicate Node at ${obsoleteWebNode}; gxserver must reuse Web/code-server/lib/node.`,
    );
  }
  /*
   CDXC:LocalStartRuntimePolicy 2026-06-12-09:58:
   macOS policy assessment can hang when a Node/Bun validator child-executes the app-bundled Node runtime. Validate bundle shape from Mach-O slices and package-time native-runtime.json metadata here; package builders own runtime smoke tests before resources are sealed into the app.
   */
  await assertMachOContainsArch(codeServerNode, arch);
  await assertMachOContainsArch(codeServerVscodeRipgrep, arch);
  runFile(codeServerVscodeRipgrep, ["--version"], { label: "VS Code ripgrep --version smoke test" });

  await validateBundledGxserverRuntime({ arch, resourcesRoot });
}

async function validateBundledGxserverRuntime({ arch, resourcesRoot }) {
  const gxserverRoot = path.join(resourcesRoot, "gxserver");
  const gxserverRuntimePath = path.join(gxserverRoot, "native-runtime.json");
  const rustGxserverBinary = path.join(gxserverRoot, "bin", "gxserver");
  const bundledDatabaseModulePath = path.join(
    gxserverRoot,
    "node_modules",
    "better-sqlite3",
    "build",
    "Release",
    "better_sqlite3.node",
  );
  /*
   CDXC:GxserverRustPackaging 2026-06-16-01:30:
   Phase 8 app validation must accept the Rust gxserver package shape without Node ABI metadata while still rejecting stale TypeScript packages that lost native-runtime.json. A Rust package is identified by its native bin/gxserver plus no bundled better-sqlite3 module.
   */
  if (existsSync(rustGxserverBinary) && !existsSync(gxserverRuntimePath) && !existsSync(bundledDatabaseModulePath)) {
    await assertRequiredPaths(arch, "bundled Rust gxserver resource", [
      rustGxserverBinary,
      path.join(gxserverRoot, "build-identity.json"),
      path.join(gxserverRoot, "dist", "protocol", "index.js"),
      path.join(gxserverRoot, "dist", "protocol", "index.d.ts"),
    ]);
    await assertMachOContainsArch(rustGxserverBinary, arch);
    return;
  }

  await assertRequiredPaths(arch, "gxserver native runtime metadata", [gxserverRuntimePath]);
  const nativeRuntime = JSON.parse(await readFile(gxserverRuntimePath, "utf8"));
  if (
    nativeRuntime.nodeMajor !== 22 ||
    typeof nativeRuntime.nodeModuleVersion !== "string" ||
    nativeRuntime.nodeModuleVersion.trim().length === 0 ||
    typeof nativeRuntime.nodeVersion !== "string" ||
    nativeRuntime.nodeVersion.trim().length === 0 ||
    !nativeRuntime.nativeModules?.includes?.("better-sqlite3")
  ) {
    throw new MacosAppBundleValidationError(
      `${arch} gxserver native-runtime.json must target bundled Node 22, record NODE_MODULE_VERSION, and include better-sqlite3.`,
    );
  }
  await assertMachOContainsArch(bundledDatabaseModulePath, arch);
}

async function validateBundledResourceShape({ arch, resourcesRoot, expectedNodePtyPrebuild }) {
  const sharedBd = path.join(resourcesRoot, "bin", "bd");
  const gxserverBd = path.join(resourcesRoot, "gxserver", "bin", "bd");

  await assertRequiredPaths(arch, "shared Beads binary", [sharedBd]);
  await assertMachOContainsArch(sharedBd, arch);
  if (existsSync(gxserverBd)) {
    const gxserverBdStat = await lstat(gxserverBd);
    if (gxserverBdStat.size > 1024 * 1024) {
      throw new MacosAppBundleValidationError(
        `${arch} app duplicates the large Beads binary at Web/gxserver/bin/bd; gxserver should use the shared Web/bin/bd launcher/resource.`,
      );
    }
  }

  await assertOnlyExpectedNodePtyPrebuilds(
    arch,
    path.join(resourcesRoot, "code-server", "lib", "vscode", "node_modules", "node-pty", "prebuilds"),
    expectedNodePtyPrebuild,
  );
}

async function validateBundledT3Runtime({ arch, resourcesRoot, expectedNodePtyPrebuild }) {
  const t3Root = path.join(resourcesRoot, "t3code-server");
  const t3Entrypoint = path.join(t3Root, "dist", "bin.mjs");
  const t3PackageJson = path.join(t3Root, "package.json");
  const t3NodeModules = path.join(t3Root, "node_modules");
  const t3NodePtyRoot = path.join(t3NodeModules, "node-pty");
  const t3NodePtyPrebuildRoot = path.join(t3NodePtyRoot, "prebuilds", expectedNodePtyPrebuild);

  await assertRequiredPaths(arch, "bundled T3 Code runtime resource", [
    t3Root,
    t3Entrypoint,
    t3PackageJson,
    t3NodeModules,
    t3NodePtyRoot,
  ]);
  await assertOnlyExpectedNodePtyPrebuilds(
    arch,
    path.join(t3NodePtyRoot, "prebuilds"),
    expectedNodePtyPrebuild,
  );
  await assertMachOContainsArch(path.join(t3NodePtyPrebuildRoot, "pty.node"), arch);
  await assertMachOContainsArch(path.join(t3NodePtyPrebuildRoot, "spawn-helper"), arch);

  const t3SourceMap = findFirstFileWithExtension(t3Root, ".map");
  if (t3SourceMap) {
    throw new MacosAppBundleValidationError(`${arch} app still bundles T3 Code source map: ${t3SourceMap}`);
  }
}

async function assertRequiredPaths(arch, label, requiredPaths) {
  for (const requiredPath of requiredPaths) {
    if (!existsSync(requiredPath)) {
      throw new MacosAppBundleValidationError(`${arch} app is missing ${label}: ${requiredPath}`);
    }
  }
}

async function assertMachOContainsArch(binaryPath, arch) {
  await assertRequiredPaths(arch, "architecture-checked binary", [binaryPath]);
  const archs = runFile("/usr/bin/lipo", ["-archs", binaryPath], { label: `lipo -archs ${binaryPath}` }).stdout
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!archs.includes(arch)) {
    throw new MacosAppBundleValidationError(`${binaryPath} does not contain required ${arch} slice. Found: ${archs.join(", ") || "none"}.`);
  }
}

async function assertOnlyExpectedNodePtyPrebuilds(arch, prebuildsRoot, expectedNodePtyPrebuild) {
  if (!existsSync(prebuildsRoot)) {
    throw new MacosAppBundleValidationError(
      `${arch} app is missing node-pty prebuild directory ${expectedNodePtyPrebuild} under ${prebuildsRoot}.`,
    );
  }
  const entries = await readdir(prebuildsRoot, { withFileTypes: true });
  const platformDirs = entries.filter((candidate) => candidate.isDirectory()).map((candidate) => candidate.name);
  const unexpected = platformDirs.filter((platformDir) => platformDir !== expectedNodePtyPrebuild);
  if (unexpected.length > 0) {
    throw new MacosAppBundleValidationError(
      `${arch} app bundles wrong-arch node-pty prebuilds under ${prebuildsRoot}: ${unexpected.join(", ")}. Expected only ${expectedNodePtyPrebuild}.`,
    );
  }
  if (!platformDirs.includes(expectedNodePtyPrebuild)) {
    throw new MacosAppBundleValidationError(
      `${arch} app is missing expected node-pty prebuild ${expectedNodePtyPrebuild} under ${prebuildsRoot}.`,
    );
  }
}

function findFirstFileWithExtension(root, extension) {
  if (!existsSync(root)) {
    return undefined;
  }
  /*
   CDXC:LocalStartReleaseParity 2026-06-09-09:07:
   Local starts validate the installed T3 bundle before opening Ghostex, so source-map checks must stay fast even with a large production node_modules tree. Use the system find implementation instead of JS-recursing every dependency file.
   */
  const result = spawnSync("/usr/bin/find", [root, "-type", "f", "-name", `*${extension}`, "-print", "-quit"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const output = [result.stderr, result.stdout]
      .join("\n")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 3)
      .join("\n");
    throw new MacosAppBundleValidationError(`T3 Code source-map scan failed.${output ? `\n${output}` : ""}`);
  }
  return result.stdout.split(/\r?\n/).find(Boolean);
}

function runFile(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const output = [result.stderr, result.stdout]
      .join("\n")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 8)
      .join("\n");
    throw new MacosAppBundleValidationError(
      `${options.label ?? command} failed with status ${result.status}.${output ? `\n${output}` : ""}`,
    );
  }
  return result;
}
