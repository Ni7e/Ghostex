#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  access,
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile, spawn } from "node:child_process";

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const gxserverRoot = path.dirname(scriptPath);
const repoRoot = path.resolve(gxserverRoot, "..");
const defaultNodeVersion = "22.19.0";
const nodeDownloadBaseUrl = "https://nodejs.org/dist";

const archConfigs = {
  x64: {
    elfMachine: 0x3e,
    goArch: "amd64",
    nodeArch: "x64",
    rustTarget: "x86_64-unknown-linux-gnu",
    zigTarget: "x86_64-linux-musl",
  },
  arm64: {
    elfMachine: 0xb7,
    goArch: "arm64",
    nodeArch: "arm64",
    rustTarget: "aarch64-unknown-linux-gnu",
    zigTarget: "aarch64-linux-musl",
  },
};

const helpText = `
Usage: node gxserver-rs/package-remote-linux.mjs [--arch x64|arm64] [--out <dir>]

Builds the self-contained Linux remote gxserver package that the macOS app
stages as Web/gxserver-linux-<arch> and uploads to Ubuntu after the user clicks
Install gxserver.

Run this on Ubuntu or in Linux CI. The default output is:
  build/remote-gxserver-linux/<arch>/package

Inputs can be overridden with:
  --zmx-root <dir>       default: zmx
  --zehn-root <dir>      default: zehn
  --beads-root <dir>     default: BEADS_ROOT/GHOSTEX_BEADS_ROOT or common checkouts
  --bd-bin <path>        use a prebuilt Linux bd binary instead of building Beads
  --node-bin <path>      use a prebuilt Linux Node binary instead of downloading Node
  --portless-dir <dir>   default: node_modules/portless
  --rust-target <triple> default: arch-specific Linux GNU target
  --tui-root <dir>       default: tui
  --tui-bin <path>       use a prebuilt Linux ghostex-tui binary instead of building TUI
  --tui-zig-bin <path>   default: TUI_ZIG, ZMX_ZIG, ZIG, or zig
  --zig-target <triple>  default: arch-specific Linux musl target
  --zmx-zig-bin <path>   default: ZMX_ZIG, ZIG, or zig
  --zehn-zig-bin <path>  default: ZEHN_ZIG, ZIG, or zig
  --allow-cross          allow running outside Linux when cross toolchains are configured
`;

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(helpText.trimStart());
    return;
  }

  const arch = normalizeArch(options.arch || process.arch);
  const archConfig = archConfigs[arch];
  if (!archConfig) {
    throw new Error(`Unsupported Linux package arch: ${options.arch || process.arch}`);
  }
  if (process.platform !== "linux" && !options.allowCross) {
    throw new Error(
      "Remote gxserver Linux packages must be built on Ubuntu/Linux CI, or pass --allow-cross after configuring Rust, Zig, Go, and C toolchains for Linux.",
    );
  }

  const outputDir = path.resolve(
    repoRoot,
    options.out || path.join("build", "remote-gxserver-linux", arch, "package"),
  );
  await assertSafeOutputDir(outputDir);

  const workRoot = await mkdtemp(path.join(os.tmpdir(), `ghostex-remote-gxserver-${arch}-`));
  try {
    const config = {
      ...archConfig,
      arch,
      bdBin: options.bdBin ? path.resolve(repoRoot, options.bdBin) : "",
      beadsRoot: await resolveBeadsRoot(options.beadsRoot),
      nodeBin: options.nodeBin ? path.resolve(repoRoot, options.nodeBin) : "",
      packageVersion: options.packageVersion || await gxserverPackageVersion(),
      portlessDir: path.resolve(repoRoot, options.portlessDir || "node_modules/portless"),
      rustTarget: options.rustTarget || archConfig.rustTarget,
      tuiBin: options.tuiBin ? path.resolve(repoRoot, options.tuiBin) : "",
      tuiRoot: path.resolve(repoRoot, options.tuiRoot || "tui"),
      tuiZigBin: options.tuiZigBin || process.env.TUI_ZIG || process.env.ZMX_ZIG || process.env.ZIG || "zig",
      zmxRoot: path.resolve(repoRoot, options.zmxRoot || "zmx"),
      zmxZigBin: options.zmxZigBin || process.env.ZMX_ZIG || process.env.ZIG || "zig",
      zehnRoot: path.resolve(repoRoot, options.zehnRoot || "zehn"),
      zehnZigBin: options.zehnZigBin || process.env.ZEHN_ZIG || process.env.ZIG || "zig",
      zigTarget: options.zigTarget || archConfig.zigTarget,
    };

    /*
     * CDXC:RemoteMachines 2026-06-23-10:07:
     * Ubuntu install must be a first-run package, not an on-host source build.
     * Build gxserver-rs, zmx, zehn, bd, ghostex-tui, bundled Linux Node,
     * Portless, and the Ghostex CLI into one package directory so the macOS app
     * can upload it over SSH and start the same Rust control plane without PATH
     * fallbacks.
     *
     * CDXC:RemoteUbuntuTui 2026-06-25-19:33:
     * Bare `ghostex` on Ubuntu is the documented terminal UI entry point, so the
     * remote package must include `bin/ghostex-tui` instead of telling users to
     * build from a source checkout or a Homebrew-only Zig path after install.
     */
    await buildPackage({ config, outputDir, workRoot });
    console.log(`Remote gxserver Linux ${arch} package written to ${outputDir}`);
  } finally {
    await rm(workRoot, { force: true, recursive: true });
  }
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--allow-cross") {
      options.allowCross = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    options[key] = value;
    index += 1;
  }
  return options;
}

function normalizeArch(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "x64" || normalized === "amd64" || normalized === "x86_64") {
    return "x64";
  }
  if (normalized === "arm64" || normalized === "aarch64") {
    return "arm64";
  }
  return normalized;
}

async function buildPackage({ config, outputDir, workRoot }) {
  const stageDir = path.join(workRoot, "stage");
  const binsDir = path.join(stageDir, "bin");
  await rm(stageDir, { force: true, recursive: true });
  await mkdir(binsDir, { recursive: true });

  const gxserverBin = await buildGxserver(config);
  /*
   * CDXC:RemoteMachines 2026-06-24-05:42:
   * zmx and zehn share Ghostex packaging but intentionally pin different Zig versions.
   * Build each tool with its own Zig binary so the Ubuntu remote package contains both tools without forcing either source tree onto the wrong compiler.
   */
  const zmxBin = await buildZigTool({
    binName: "zmx",
    root: config.zmxRoot,
    target: config.zigTarget,
    workRoot,
    zigBin: config.zmxZigBin,
  });
  const zehnBin = await buildZigTool({
    binName: "zehn",
    root: config.zehnRoot,
    target: config.zigTarget,
    workRoot,
    zigBin: config.zehnZigBin,
  });
  const bdBin = config.bdBin || await buildBeads(config, workRoot);
  const tuiBin = config.tuiBin || await buildGhostexTui(config);
  const nodeBin = config.nodeBin || await prepareLinuxNode(config, workRoot);

  await copyExecutable(gxserverBin, path.join(binsDir, "gxserver"), "gxserver");
  await copyExecutable(zmxBin, path.join(binsDir, "zmx"), "zmx");
  await copyExecutable(zehnBin, path.join(binsDir, "zehn"), "zehn");
  await copyExecutable(bdBin, path.join(binsDir, "bd"), "bd");
  await copyExecutable(tuiBin, path.join(binsDir, "ghostex-tui"), "ghostex-tui");
  await copyExecutable(nodeBin, path.join(stageDir, "code-server", "lib", "node"), "node");

  await copyPortlessPackage(config.portlessDir, path.join(stageDir, "portless"));
  await copyGhostexCli(path.join(stageDir, "CLI"));
  await writePackageManifest(stageDir, config.packageVersion);
  await stageProtocolExports(stageDir, workRoot);
  await validateLinuxPackage(stageDir, config);
  await writeBuildIdentity(stageDir, config.packageVersion);

  await rm(outputDir, { force: true, recursive: true });
  await mkdir(path.dirname(outputDir), { recursive: true });
  await cp(stageDir, outputDir, { recursive: true });
}

async function buildGxserver(config) {
  await run("cargo", [
    "build",
    "--release",
    "--manifest-path",
    path.join(gxserverRoot, "Cargo.toml"),
    "--target",
    config.rustTarget,
  ], { cwd: repoRoot });
  return path.join(gxserverRoot, "target", config.rustTarget, "release", "gxserver");
}

async function buildGhostexTui(config) {
  await assertDirectory(config.tuiRoot, "Ghostex TUI root");
  await run("cargo", [
    "build",
    "--release",
    "--bin",
    "ghostex-tui",
    "--manifest-path",
    path.join(config.tuiRoot, "Cargo.toml"),
    "--target",
    config.rustTarget,
  ], {
    cwd: repoRoot,
    env: {
      /* CDXC:RemoteUbuntuTui 2026-06-25-19:33: Host shell compiler/linker flags can leak into Zig's build-runner link step during cross builds and fail before the Linux TUI archive is produced. Clear generic CPPFLAGS/LDFLAGS for this package-owned Cargo/Zig build while still passing the pinned Zig executable explicitly. */
      CPPFLAGS: "",
      LDFLAGS: "",
      ZIG: config.tuiZigBin || "zig",
    },
  });
  return path.join(config.tuiRoot, "target", config.rustTarget, "release", "ghostex-tui");
}

async function buildZigTool({ binName, root, target, workRoot, zigBin }) {
  await assertDirectory(root, `${binName} root`);
  const prefix = path.join(workRoot, binName);
  await run(zigBin || "zig", [
    "build",
    "-Doptimize=ReleaseSafe",
    `-Dtarget=${target}`,
    "--prefix",
    prefix,
  ], { cwd: root });
  return path.join(prefix, "bin", binName);
}

async function buildBeads(config, workRoot) {
  if (!config.beadsRoot) {
    throw new Error(
      "Beads root is required to build the Linux bd binary. Set BEADS_ROOT, GHOSTEX_BEADS_ROOT, or pass --bd-bin <linux-bd>.",
    );
  }
  const outputPath = path.join(workRoot, "bd");
  const commit = await gitOutput(config.beadsRoot, ["rev-parse", "HEAD"], "dev");
  const branch = await gitOutput(config.beadsRoot, ["rev-parse", "--abbrev-ref", "HEAD"], "unknown");
  const shortCommit = commit.slice(0, 12) || "dev";
  await run("go", [
    "build",
    "-tags",
    "gms_pure_go",
    "-trimpath",
    "-ldflags",
    `-s -w -X main.Build=${shortCommit} -X main.Commit=${commit} -X main.Branch=${branch}`,
    "-o",
    outputPath,
    "./cmd/bd",
  ], {
    cwd: config.beadsRoot,
    env: {
      CGO_ENABLED: "0",
      GOARCH: config.goArch,
      GOOS: "linux",
    },
  });
  return outputPath;
}

async function prepareLinuxNode(config, workRoot) {
  const nodeVersion = await codeServerNodeVersion();
  const packageName = `node-v${nodeVersion}-linux-${config.nodeArch}`;
  const cacheRoot = path.join(repoRoot, "build", "remote-gxserver-linux", "cache");
  const tarballPath = path.join(cacheRoot, `${packageName}.tar.xz`);
  const sumsPath = path.join(cacheRoot, `node-v${nodeVersion}-SHASUMS256.txt`);
  const extractRoot = path.join(workRoot, packageName);
  await mkdir(cacheRoot, { recursive: true });

  if (!await fileExists(tarballPath)) {
    await downloadFile(`${nodeDownloadBaseUrl}/v${nodeVersion}/${packageName}.tar.xz`, tarballPath);
  }
  if (!await fileExists(sumsPath)) {
    await downloadFile(`${nodeDownloadBaseUrl}/v${nodeVersion}/SHASUMS256.txt`, sumsPath);
  }
  await verifyNodeTarball(tarballPath, sumsPath, `${packageName}.tar.xz`);
  await run("tar", ["-xJf", tarballPath, "-C", workRoot], { cwd: repoRoot });
  return path.join(extractRoot, "bin", "node");
}

async function copyPortlessPackage(sourceDir, targetDir) {
  await assertDirectory(sourceDir, "Portless package");
  const packageJson = JSON.parse(await readFile(path.join(sourceDir, "package.json"), "utf8"));
  if (packageJson.version !== "0.14.0") {
    throw new Error(`Expected portless@0.14.0, found ${packageJson.version || "unknown"}. Run bun install with the root lockfile.`);
  }
  const cliPath = path.join(sourceDir, "dist", "cli.js");
  await assertFile(cliPath, "Portless CLI");
  await cp(sourceDir, targetDir, { recursive: true });
  await chmod(path.join(targetDir, "dist", "cli.js"), 0o755);
}

async function copyGhostexCli(targetDir) {
  await mkdir(targetDir, { recursive: true });
  await cp(path.join(repoRoot, "scripts", "ghostex-cli.mjs"), path.join(targetDir, "ghostex-cli.mjs"));
  const wsDir = path.join(repoRoot, "node_modules", "ws");
  if (await fileExists(wsDir)) {
    await mkdir(path.join(targetDir, "node_modules"), { recursive: true });
    await cp(wsDir, path.join(targetDir, "node_modules", "ws"), { recursive: true });
  }
}

async function writePackageManifest(packageDir, version) {
  await writeFile(
    path.join(packageDir, "package.json"),
    `${JSON.stringify({
      name: "gxserver",
      version,
      private: true,
      description: "Ghostex gxserver daemon and shared protocol package.",
      type: "module",
      bin: {
        gxserver: "./bin/gxserver",
        "ghostex-tui": "./bin/ghostex-tui",
      },
      exports: {
        "./protocol": {
          types: "./dist/protocol/index.d.ts",
          default: "./dist/protocol/index.js",
        },
      },
    }, null, 2)}\n`,
    "utf8",
  );
}

async function stageProtocolExports(packageDir, workRoot) {
  const protocolStage = path.join(workRoot, "protocol");
  const sourceDir = path.join(protocolStage, "src");
  const typesDir = path.join(protocolStage, "types");
  const outDir = path.join(packageDir, "dist", "protocol");
  const sourceFile = path.join(sourceDir, "index.ts");
  await mkdir(sourceDir, { recursive: true });
  await mkdir(outDir, { recursive: true });
  await cp(path.join(repoRoot, "shared", "gxserver-protocol.ts"), sourceFile);
  await run(process.env.BUN || "bun", [
    "build",
    sourceFile,
    "--outfile",
    path.join(outDir, "index.js"),
    "--format",
    "esm",
    "--target",
    "node",
  ], { cwd: repoRoot });
  const tscBin = path.join(repoRoot, "node_modules", "typescript", "bin", "tsc");
  await assertFile(tscBin, "TypeScript compiler");
  await run(process.execPath, [
    tscBin,
    "--declaration",
    "--emitDeclarationOnly",
    "--isolatedModules",
    "--module",
    "ESNext",
    "--moduleResolution",
    "bundler",
    "--outDir",
    typesDir,
    "--rootDir",
    sourceDir,
    "--skipLibCheck",
    "--strict",
    "--target",
    "ES2023",
    sourceFile,
  ], { cwd: repoRoot });
  await cp(path.join(typesDir, "index.d.ts"), path.join(outDir, "index.d.ts"));
}

async function validateLinuxPackage(packageDir, config) {
  const requiredFiles = [
    "bin/gxserver",
    "bin/zmx",
    "bin/zehn",
    "bin/bd",
    "bin/ghostex-tui",
    "code-server/lib/node",
    "portless/dist/cli.js",
    "CLI/ghostex-cli.mjs",
    "dist/protocol/index.js",
    "dist/protocol/index.d.ts",
    "package.json",
  ];
  for (const relativePath of requiredFiles) {
    await assertFile(path.join(packageDir, relativePath), relativePath);
  }
  for (const relativePath of ["bin/gxserver", "bin/zmx", "bin/zehn", "bin/bd", "bin/ghostex-tui", "code-server/lib/node"]) {
    const fullPath = path.join(packageDir, relativePath);
    if (!await isElf(fullPath)) {
      throw new Error(`Linux remote package expected an ELF binary at ${relativePath}.`);
    }
    if (await elfMachine(fullPath) !== config.elfMachine) {
      throw new Error(`Linux remote package expected ${config.arch} ELF architecture at ${relativePath}.`);
    }
    await chmod(fullPath, 0o755);
  }
}

async function writeBuildIdentity(packageDir, version) {
  const hash = createHash("sha256");
  await hashDirectory(packageDir, packageDir, hash);
  const fingerprint = `sha256:${hash.digest("hex")}`;
  await writeFile(
    path.join(packageDir, "build-identity.json"),
    `${JSON.stringify({
      buildIdentity: `gxserver:${version}:${fingerprint}`,
      fingerprint,
      packageVersion: version,
    }, null, 2)}\n`,
    "utf8",
  );
}

async function hashDirectory(root, dir, hash) {
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    const relativePath = path.relative(root, entryPath).split(path.sep).join("/");
    if (relativePath === "build-identity.json") {
      continue;
    }
    if (entry.isDirectory()) {
      await hashDirectory(root, entryPath, hash);
      continue;
    }
    if (!entry.isFile() && !entry.isSymbolicLink()) {
      continue;
    }
    hash.update(relativePath);
    hash.update("\0");
    hash.update(await readFile(entryPath));
    hash.update("\0");
  }
}

async function gxserverPackageVersion() {
  const { stdout } = await execFileAsync("cargo", [
    "metadata",
    "--format-version",
    "1",
    "--no-deps",
    "--manifest-path",
    path.join(gxserverRoot, "Cargo.toml"),
  ], { cwd: repoRoot });
  const metadata = JSON.parse(stdout);
  const rootPackageId = metadata.root_package_id || metadata.resolve?.root;
  const rootPackage =
    metadata.packages.find((pkg) => pkg.id === rootPackageId) ||
    metadata.packages.find((pkg) => pkg.name === "gxserver") ||
    metadata.packages[0];
  if (!rootPackage?.version) {
    throw new Error("Could not read gxserver-rs package version from Cargo metadata.");
  }
  return rootPackage.version;
}

async function codeServerNodeVersion() {
  const explicit = process.env.CODE_SERVER_APP_NODE_VERSION?.trim();
  if (explicit) {
    return explicit.replace(/^v/u, "");
  }
  const versionPath = path.join(repoRoot, "code-server", ".node-version");
  if (await fileExists(versionPath)) {
    return (await readFile(versionPath, "utf8")).trim().replace(/^v/u, "");
  }
  return defaultNodeVersion;
}

async function resolveBeadsRoot(explicitRoot) {
  const candidates = [
    explicitRoot,
    process.env.BEADS_ROOT,
    process.env.GHOSTEX_BEADS_ROOT,
    path.join(repoRoot, "beads"),
    path.join(os.homedir(), "dev", "_active", "beads"),
    path.join(os.homedir(), "dev", "_references", "beads"),
    path.join(os.homedir(), "dev", "custom", "beads"),
  ].filter(Boolean).map((candidate) => path.resolve(repoRoot, candidate));
  for (const candidate of candidates) {
    if (await fileExists(path.join(candidate, "go.mod")) && await fileExists(path.join(candidate, "cmd", "bd"))) {
      return candidate;
    }
  }
  return "";
}

async function assertSafeOutputDir(outputDir) {
  const resolvedRepo = await realpath(repoRoot);
  const resolvedParent = await realpath(path.dirname(outputDir)).catch(() => path.dirname(outputDir));
  const unsafe = new Set([
    path.parse(outputDir).root,
    os.homedir(),
    resolvedRepo,
    path.dirname(resolvedRepo),
  ]);
  if (unsafe.has(outputDir) || unsafe.has(resolvedParent)) {
    throw new Error(`Refusing to use unsafe package output directory: ${outputDir}`);
  }
}

async function copyExecutable(source, destination, label) {
  await assertFile(source, label);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination);
  await chmod(destination, 0o755);
}

async function assertDirectory(candidate, label) {
  const info = await stat(candidate).catch(() => undefined);
  if (!info?.isDirectory()) {
    throw new Error(`${label} is missing or not a directory: ${candidate}`);
  }
}

async function assertFile(candidate, label) {
  const info = await stat(candidate).catch(() => undefined);
  if (!info?.isFile()) {
    throw new Error(`${label} is missing or not a file: ${candidate}`);
  }
}

async function fileExists(candidate) {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function isElf(candidate) {
  const data = await readFile(candidate).catch(() => Buffer.alloc(0));
  return data.length >= 4 &&
    data[0] === 0x7f &&
    data[1] === 0x45 &&
    data[2] === 0x4c &&
    data[3] === 0x46;
}

async function elfMachine(candidate) {
  const data = await readFile(candidate).catch(() => Buffer.alloc(0));
  if (data.length < 20 || !await isElf(candidate)) {
    return undefined;
  }
  if (data[5] === 1) {
    return data.readUInt16LE(18);
  }
  if (data[5] === 2) {
    return data.readUInt16BE(18);
  }
  return undefined;
}

async function verifyNodeTarball(tarballPath, sumsPath, tarballName) {
  const sums = await readFile(sumsPath, "utf8");
  const line = sums.split(/\r?\n/u).find((entry) => entry.endsWith(`  ${tarballName}`));
  if (!line) {
    throw new Error(`Node checksum file does not contain ${tarballName}.`);
  }
  const expected = line.split(/\s+/u)[0];
  const actual = await sha256File(tarballPath);
  if (actual !== expected) {
    throw new Error(`Node tarball checksum mismatch for ${tarballName}.`);
  }
}

async function sha256File(candidate) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(candidate);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

async function downloadFile(url, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  await new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode || 0) && response.headers.location) {
        response.resume();
        downloadFile(new URL(response.headers.location, url).toString(), destination).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Download failed (${response.statusCode}) for ${url}`));
        return;
      }
      const file = createWriteStream(destination);
      file.on("error", reject);
      file.on("finish", resolve);
      response.pipe(file);
    });
    request.on("error", reject);
  });
}

async function gitOutput(cwd, args, fallback) {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd });
    return stdout.trim() || fallback;
  } catch {
    return fallback;
  }
}

async function run(command, args, options = {}) {
  console.log(`$ ${command} ${args.join(" ")}`);
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env || {}) },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with ${signal || code}`));
    });
  });
}
