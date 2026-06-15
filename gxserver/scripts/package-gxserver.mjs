#!/usr/bin/env node
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, chmod, cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const gxserverRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(gxserverRoot, "..");
const distRoot = path.join(gxserverRoot, "dist");
const defaultPackageDir = path.join(distRoot, "server-package");
const defaultHomebrewDir = path.join(distRoot, "homebrew");
const executableMode = 0o755;
const appNativeNodeMajor = 22;
const nativeRuntimeFileName = "native-runtime.json";

const args = parseArgs(process.argv.slice(2));
const packageDir = path.resolve(args.packageDir ?? defaultPackageDir);
const homebrewDir = path.resolve(args.homebrewDir ?? defaultHomebrewDir);
const packageMode = args.rustBin ? "rust" : "typescript";

/*
CDXC:GxserverPackaging 2026-05-30-15:49:
App-bundled gxserver and standalone/server-only gxserver must be the same compiled daemon package. The package stage lives under gxserver/dist, keeps the server tarball on system Node through a launcher, and bundles pinned zmx/zehn/bd artifacts.

CDXC:GxserverPackaging 2026-06-08-12:17:
The macOS app bundles one Node 22 runtime inside Web/code-server/lib/node. gxserver records that shared code-server runtime ABI for native modules while the reusable server tarball keeps using system Node.

CDXC:GxserverPackaging 2026-06-08-10:46:
Project board must work in packaged Ghostex without requiring a separate Beads install. Package the full pinned upstream `bd` binary beside zmx and zehn so arm and Intel app builds can ship the matching Beads CLI without a Ghostex fork.
*/
await assertInsideDist(packageDir, "server package");
if (args.generateHomebrew) {
  await assertInsideDist(homebrewDir, "Homebrew helper");
}
if (args.rustBin && args.includeNodeModules) {
  throw new Error("--rust-bin packages the native Rust daemon and cannot be combined with --include-node-modules.");
}

await assertBuilt(packageMode);
const zmxBin = await resolveToolBin("zmx", args.zmxBin);
const zehnBin = await resolveToolBin("zehn", args.zehnBin);
const bdBin = await resolveToolBin("bd", args.bdBin);

await rm(packageDir, { force: true, recursive: true });
await mkdir(packageDir, { recursive: true });
if (packageMode === "rust") {
  await stageRustPackage(packageDir, {
    bdBin,
    rustBin: args.rustBin,
    zehnBin,
    zmxBin,
  });
} else {
  await stageTypeScriptPackage(packageDir, {
    bdBin,
    zehnBin,
    zmxBin,
  });
}

await writeFile(path.join(packageDir, "README.md"), serverReadme(packageMode), "utf8");

if (args.includeNodeModules) {
  if (!args.nativeNode) {
    throw new Error(
      "--include-node-modules requires --native-node so app-bundled native modules can record the exact app Node ABI they were rebuilt for.",
    );
  }
  await copyProductionNodeModules(packageDir, args);
  const nativeRuntime = await rebuildPackagedNativeModules(packageDir, args);
  await writeNativeRuntime(packageDir, nativeRuntime);
}

await writeBuildIdentity(packageDir);
const tarballPath = await createTarball(packageDir);
if (args.generateHomebrew) {
  await mkdir(homebrewDir, { recursive: true });
  const sha256 = await sha256File(tarballPath);
  await writeFile(
    path.join(homebrewDir, "gxserver.rb"),
    homebrewFormula({
      sha256,
      url: args.homebrewUrl ?? `file://${tarballPath}`,
      version: await packageVersion(),
      packageMode,
    }),
    "utf8",
  );
}

console.log(`Packaged gxserver at ${packageDir}`);

function parseArgs(argv) {
  const parsed = {
    generateHomebrew: false,
    includeNodeModules: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--generate-homebrew") {
      parsed.generateHomebrew = true;
    } else if (arg === "--include-node-modules") {
      parsed.includeNodeModules = true;
    } else if (arg === "--package-dir") {
      parsed.packageDir = requiredValue(argv, ++index, arg);
    } else if (arg === "--homebrew-dir") {
      parsed.homebrewDir = requiredValue(argv, ++index, arg);
    } else if (arg === "--homebrew-url") {
      parsed.homebrewUrl = requiredValue(argv, ++index, arg);
    } else if (arg === "--zmx-bin") {
      parsed.zmxBin = requiredValue(argv, ++index, arg);
    } else if (arg === "--zehn-bin") {
      parsed.zehnBin = requiredValue(argv, ++index, arg);
    } else if (arg === "--bd-bin") {
      parsed.bdBin = requiredValue(argv, ++index, arg);
    } else if (arg === "--native-node") {
      parsed.nativeNode = requiredValue(argv, ++index, arg);
    } else if (arg === "--native-npm") {
      parsed.nativeNpm = requiredValue(argv, ++index, arg);
    } else if (arg === "--rust-bin") {
      parsed.rustBin = requiredValue(argv, ++index, arg);
    } else {
      throw new Error(`Unknown package-gxserver option: ${arg}`);
    }
  }
  return parsed;
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

async function assertInsideDist(candidatePath, label) {
  const relative = path.relative(distRoot, candidatePath);
  if (relative.startsWith("..") || path.isAbsolute(relative) || relative === "") {
    throw new Error(`${label} output must be under ${distRoot}.`);
  }
}

async function assertBuilt(mode) {
  await assertFile(path.join(distRoot, "protocol", "index.js"), "Run `npm run build` in gxserver/ before packaging.");
  await assertFile(path.join(distRoot, "protocol", "index.d.ts"), "Run `npm run build` in gxserver/ before packaging.");
  if (mode === "typescript") {
    await assertFile(path.join(distRoot, "src", "cli.js"), "Run `npm run build` in gxserver/ before packaging.");
  }
}

async function resolveToolBin(toolName, explicitPath) {
  const candidates = [
    explicitPath,
    ...(toolName === "bd" ? [] : [path.join(repoRoot, toolName, "zig-out", "bin", toolName)]),
    path.join(distRoot, "bin", toolName),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (await isExecutableFile(candidate)) {
      return path.resolve(candidate);
    }
  }
  const guidance =
    toolName === "zmx"
      ? "Build the pinned zmx submodule first: `git submodule update --init --recursive zmx && cd zmx && zig build -Doptimize=ReleaseSafe`."
      : toolName === "zehn"
        ? "Build the pinned zehn submodule first: `git submodule update --init zehn && cd zehn && zig build -Doptimize=ReleaseFast`."
        : "Build the pinned upstream Beads CLI first and pass it with `--bd-bin /path/to/bd`.";
  throw new Error(`Missing bundled ${toolName} artifact. ${guidance} PATH ${toolName} is intentionally ignored.`);
}

async function isExecutableFile(filePath) {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      return false;
    }
    await access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function assertFile(filePath, guidance) {
  try {
    const fileStat = await stat(filePath);
    if (fileStat.isFile()) {
      return;
    }
  } catch {
    // Handled below.
  }
  throw new Error(`${filePath} is missing. ${guidance}`);
}

async function stageTypeScriptPackage(targetDir, tools) {
  await cp(path.join(distRoot, "src"), path.join(targetDir, "dist", "src"), { recursive: true });
  await cp(path.join(distRoot, "protocol"), path.join(targetDir, "dist", "protocol"), { recursive: true });
  await cp(path.join(gxserverRoot, "package.json"), path.join(targetDir, "package.json"));
  await cp(path.join(gxserverRoot, "package-lock.json"), path.join(targetDir, "package-lock.json"));

  await mkdir(path.join(targetDir, "bin"), { recursive: true });
  await writeLauncher(path.join(targetDir, "bin", "gxserver"));
  await stageToolBinaries(targetDir, tools);
  await chmod(path.join(targetDir, "bin", "gxserver"), executableMode);
}

async function stageRustPackage(targetDir, options) {
  /*
  CDXC:GxserverRustPackaging 2026-06-16-01:30:
  Phase 8 needs a Rust package shape that keeps generated TypeScript protocol exports for clients while making the native gxserver binary the daemon entrypoint. Do not copy the JavaScript daemon, node_modules, or package-lock into this staged package.
  */
  await assertExecutableFile(options.rustBin, "Build Rust gxserver first with `cargo build --manifest-path gxserver-rs/Cargo.toml --release` or pass the desired compiled binary.");
  await cp(path.join(distRoot, "protocol"), path.join(targetDir, "dist", "protocol"), { recursive: true });
  await writeRustPackageManifest(targetDir);

  await mkdir(path.join(targetDir, "bin"), { recursive: true });
  await cp(options.rustBin, path.join(targetDir, "bin", "gxserver"));
  await stageToolBinaries(targetDir, options);
  await chmod(path.join(targetDir, "bin", "gxserver"), executableMode);
}

async function stageToolBinaries(targetDir, tools) {
  await cp(tools.zmxBin, path.join(targetDir, "bin", "zmx"));
  await cp(tools.zehnBin, path.join(targetDir, "bin", "zehn"));
  await cp(tools.bdBin, path.join(targetDir, "bin", "bd"));
  await chmod(path.join(targetDir, "bin", "zmx"), executableMode);
  await chmod(path.join(targetDir, "bin", "zehn"), executableMode);
  await chmod(path.join(targetDir, "bin", "bd"), executableMode);
}

async function writeRustPackageManifest(targetDir) {
  const manifest = JSON.parse(await readFile(path.join(gxserverRoot, "package.json"), "utf8"));
  await writeFile(
    path.join(targetDir, "package.json"),
    `${JSON.stringify({
      name: manifest.name ?? "gxserver",
      version: manifest.version ?? "0.0.0",
      private: manifest.private ?? true,
      description: manifest.description ?? "Ghostex gxserver daemon and shared protocol package.",
      type: "module",
      bin: {
        gxserver: "./bin/gxserver",
      },
      exports: {
        "./protocol": manifest.exports?.["./protocol"] ?? {
          types: "./dist/protocol/index.d.ts",
          default: "./dist/protocol/index.js",
        },
      },
    }, null, 2)}\n`,
    "utf8",
  );
}

async function writeLauncher(launcherPath) {
  /*
  CDXC:GxserverPackaging 2026-06-08-12:17:
  The packaged launcher must use Web/code-server/lib/node when gxserver is inside the macOS app, so direct resource launches share code-server's bundled Node and avoid system-Node missing errors. Standalone server tarballs keep their system Node behavior because that app resource is absent there.
  */
  await writeFile(
    launcherPath,
    `#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
APP_NODE="$HERE/../../code-server/lib/node"
if [[ -x "$APP_NODE" ]]; then
  exec "$APP_NODE" "$HERE/../dist/src/cli.js" "$@"
fi
NODE_BIN="\${NODE:-node}"
exec "$NODE_BIN" "$HERE/../dist/src/cli.js" "$@"
`,
    "utf8",
  );
}

async function copyProductionNodeModules(targetDir, options) {
  const source = path.join(gxserverRoot, "node_modules");
  await assertDirectory(source, "Run `npm install` in gxserver/ before packaging app resources.");
  await cp(source, path.join(targetDir, "node_modules"), {
    recursive: true,
    /*
    CDXC:GxserverPackaging 2026-05-30-16:47:
    macOS app signing rejects node_modules/.bin symlinks that point outside the app bundle. The embedded gxserver runtime executes its own launcher and production libraries only, so exclude development command shims from app resources instead of copying invalid bundle links.
    */
    filter: (entry) =>
      !entry.includes(`${path.sep}.cache${path.sep}`) &&
      path.basename(entry) !== ".bin" &&
      !entry.includes(`${path.sep}.bin${path.sep}`),
  });
  const nodePath = path.resolve(options.nativeNode);
  const npmPath = await resolveNativeNpm(options.nativeNpm, nodePath);
  const prune = spawnSync(npmPath, ["prune", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: targetDir,
    encoding: "utf8",
    env: nativeModuleBuildEnv(nodePath),
    stdio: "pipe",
  });
  if (prune.status !== 0) {
    throw new Error(`Failed to prune gxserver production node_modules:\n${prune.stderr || prune.stdout}`);
  }
}

async function rebuildPackagedNativeModules(targetDir, options) {
  /*
  CDXC:GxserverPackaging 2026-06-01-16:22:
  The macOS app launches gxserver with its app-bundled Node, but the repository may be installed with a different Node ABI. Rebuild native production modules inside the staged app package and smoke-test SQLite there so app packaging does not mutate the repository's node_modules or ship an ABI mismatch.

  CDXC:GxserverPackaging 2026-06-06-22:00:
  App-bundled native modules publish the Node major and NODE_MODULE_VERSION they were rebuilt against, and macOS startup must verify the bundled app Node instead of trying whichever installed Node appears first.

  CDXC:GxserverPackaging 2026-06-08-12:17:
  Ghostex macOS reuses code-server's bundled Node 22 runtime for gxserver, so package-time ABI checks must reject other Node majors and point build authors at Web/code-server/lib/node instead of user install guidance.
  */
  const nodePath = path.resolve(options.nativeNode);
  await assertExecutableFile(nodePath, "Selected --native-node is not executable.");
  const nativeRuntime = await readNativeRuntime(nodePath);
  if (nativeRuntime.nodeMajor !== appNativeNodeMajor) {
    throw new Error(
      `App-bundled gxserver native modules must target code-server's bundled Node.js ${appNativeNodeMajor} runtime, but --native-node is ${nativeRuntime.nodeVersion}. Pass the app-packaged Web/code-server/lib/node executable from the macOS build.`,
    );
  }
  const npmPath = await resolveNativeNpm(options.nativeNpm, nodePath);
  const betterSqliteRoot = path.join(targetDir, "node_modules", "better-sqlite3");
  await assertDirectory(betterSqliteRoot, "Packaged better-sqlite3 is missing from production node_modules.");
  const env = nativeModuleBuildEnv(nodePath);
  const rebuild = spawnSync(npmPath, ["exec", "--yes", "--", "node-gyp", "rebuild", "--release"], {
    cwd: betterSqliteRoot,
    encoding: "utf8",
    env,
    stdio: "pipe",
  });
  if (rebuild.status !== 0) {
    throw new Error(`Failed to rebuild packaged better-sqlite3:\n${rebuild.stderr || rebuild.stdout}`);
  }
  const smoke = spawnSync(
    nodePath,
    [
      "-e",
      "const Database = require(process.argv[1]); const db = new Database(':memory:'); db.prepare('select 1').get(); db.close();",
      path.join(targetDir, "node_modules", "better-sqlite3"),
    ],
    {
      cwd: targetDir,
      encoding: "utf8",
      env,
      stdio: "pipe",
    },
  );
  if (smoke.status !== 0) {
    throw new Error(`Packaged better-sqlite3 did not load under ${nodePath}:\n${smoke.stderr || smoke.stdout}`);
  }
  return {
    ...nativeRuntime,
    nativeModules: ["better-sqlite3"],
    nodeRequirement: `Bundled Node.js ${nativeRuntime.nodeMajor}.x with NODE_MODULE_VERSION ${nativeRuntime.nodeModuleVersion}`,
  };
}

async function readNativeRuntime(nodePath) {
  const probe = spawnSync(
    nodePath,
    [
      "-p",
      "JSON.stringify({nodeMajor: Number(process.versions.node.split('.')[0]), nodeModuleVersion: process.versions.modules, nodeVersion: process.version})",
    ],
    {
      encoding: "utf8",
      stdio: "pipe",
    },
  );
  if (probe.status !== 0) {
    throw new Error(`Could not read Node runtime identity from ${nodePath}:\n${probe.stderr || probe.stdout}`);
  }
  const parsed = JSON.parse(probe.stdout);
  if (
    !Number.isInteger(parsed.nodeMajor) ||
    typeof parsed.nodeModuleVersion !== "string" ||
    parsed.nodeModuleVersion.length === 0 ||
    typeof parsed.nodeVersion !== "string" ||
    parsed.nodeVersion.length === 0
  ) {
    throw new Error(`Node runtime identity from ${nodePath} is invalid.`);
  }
  return parsed;
}

async function writeNativeRuntime(sourceDir, nativeRuntime) {
  await writeFile(path.join(sourceDir, nativeRuntimeFileName), `${JSON.stringify(nativeRuntime, null, 2)}\n`, "utf8");
}

async function assertExecutableFile(filePath, guidance) {
  try {
    const fileStat = await stat(filePath);
    if (fileStat.isFile()) {
      await access(filePath, fsConstants.X_OK);
      return;
    }
  } catch {
    // Handled below.
  }
  throw new Error(`${filePath} is missing or not executable. ${guidance}`);
}

async function resolveNativeNpm(explicitPath, nodePath) {
  const nodeDir = path.dirname(nodePath);
  const candidates = [
    explicitPath,
    path.join(nodeDir, "npm"),
    path.join(nodeDir, "npm-cli.js"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (await isExecutableFile(resolved)) {
      return resolved;
    }
  }
  throw new Error(`Could not resolve npm beside --native-node ${nodePath}. Pass --native-npm explicitly.`);
}

function nativeModuleBuildEnv(nodePath) {
  const nodeDir = path.dirname(nodePath);
  return {
    ...process.env,
    PATH: [nodeDir, process.env.PATH].filter(Boolean).join(path.delimiter),
  };
}

async function assertDirectory(dirPath, guidance) {
  try {
    const dirStat = await stat(dirPath);
    if (dirStat.isDirectory()) {
      return;
    }
  } catch {
    // Handled below.
  }
  throw new Error(`${dirPath} is missing. ${guidance}`);
}

async function createTarball(sourceDir) {
  const version = await packageVersion();
  const tarballPath = path.join(distRoot, `gxserver-${version}-server.tar.gz`);
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gxserver-package-"));
  try {
    const archiveRoot = path.join(tempRoot, `gxserver-${version}`);
    await cp(sourceDir, archiveRoot, { recursive: true });
    const tar = spawnSync("tar", ["-czf", tarballPath, "-C", tempRoot, path.basename(archiveRoot)], {
      encoding: "utf8",
      stdio: "pipe",
    });
    if (tar.status !== 0) {
      throw new Error(`Failed to create gxserver tarball:\n${tar.stderr || tar.stdout}`);
    }
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
  return tarballPath;
}

/*
CDXC:GxserverPackaging 2026-05-30-23:47:
The macOS launcher compares its bundled gxserver build identity with authenticated daemon health before sidebar hydration. Generate the identity from the staged daemon package so same-version server rebuilds force a control-plane restart instead of reusing stale code.
*/
async function writeBuildIdentity(sourceDir) {
  const version = await packageVersion();
  const fingerprint = `sha256:${await sha256Directory(sourceDir)}`;
  await writeFile(
    path.join(sourceDir, "build-identity.json"),
    `${JSON.stringify({
      buildIdentity: `gxserver:${version}:${fingerprint}`,
      fingerprint,
      packageVersion: version,
    }, null, 2)}\n`,
    "utf8",
  );
}

async function sha256Directory(root) {
  const hash = createHash("sha256");
  for (const filePath of await listPackageFiles(root)) {
    const relativePath = path.relative(root, filePath).split(path.sep).join("/");
    hash.update(relativePath);
    hash.update("\0");
    hash.update(await readFile(filePath));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function listPackageFiles(root) {
  const files = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      const relativePath = path.relative(root, entryPath).split(path.sep).join("/");
      if (relativePath === "build-identity.json") {
        continue;
      }
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        files.push(entryPath);
      }
    }
  }
  await walk(root);
  return files;
}

async function packageVersion() {
  const manifest = JSON.parse(await readFile(path.join(gxserverRoot, "package.json"), "utf8"));
  return manifest.version ?? "0.0.0";
}

async function sha256File(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function homebrewFormula({ packageMode, sha256, url, version }) {
  if (packageMode === "rust") {
    return `class Gxserver < Formula
  desc "Ghostex gxserver daemon for local and remote/headless project sessions"
  homepage "https://github.com/maddada/Ghostex"
  url "${url}"
  sha256 "${sha256}"
  license "MIT"
  version "${version}"

  def install
    libexec.install Dir["*"]
    (bin/"gxserver").write <<~EOS
      #!/usr/bin/env bash
      exec "#{libexec}/bin/gxserver" "$@"
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/gxserver --version")
  end
end
`;
  }
  return `class Gxserver < Formula
  desc "Ghostex gxserver daemon for local and remote/headless project sessions"
  homepage "https://github.com/maddada/Ghostex"
  url "${url}"
  sha256 "${sha256}"
  license "MIT"
  version "${version}"

  depends_on "node@22"

  def install
    libexec.install Dir["*"]
    system Formula["node@22"].opt_bin/"npm", "ci", "--omit=dev", "--no-audit", "--no-fund", chdir: libexec
    (bin/"gxserver").write <<~EOS
      #!/usr/bin/env bash
      exec "#{Formula["node@22"].opt_bin}/node" "#{libexec}/dist/src/cli.js" "$@"
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/gxserver --version")
  end
end
`;
}

function serverReadme(packageMode) {
  if (packageMode === "rust") {
    return `# gxserver server package

gxserver is the Ghostex daemon used by the desktop app and server-only remote installs.

## Runtime dependency

This package uses the bundled native gxserver executable in \`bin/gxserver\` and does not require Node.js or better-sqlite3 at runtime.

## Commands

- \`bin/gxserver\`: run gxserver in the foreground.
- \`bin/gxserver start\`: start gxserver in the background.
- \`bin/gxserver status --json\`: check runtime state for health/status automation.
- \`bin/gxserver stop\`: stop only the gxserver control plane; zmx sessions are not killed.
- \`bin/gxserver stop-all\`: kill gxserver-tracked zmx sessions, then stop the control plane.

The package includes Ghostex's pinned zmx, zehn, and upstream Beads \`bd\` artifacts in \`bin/\`. Project board operations require the bundled \`bd\`; shell-installed \`bd\` is intentionally ignored so Ghostex and agent workflows share one pinned Beads binary.
`;
  }
  return `# gxserver server package

gxserver is the Ghostex daemon used by the desktop app and server-only remote installs.

## Runtime dependency

Install Node.js 22 LTS or newer from https://nodejs.org/en/download or through your system package manager. This package does not bundle, auto-install, or fall back to a private Node runtime.

## Commands

When installing from this tarball without Homebrew, install production JavaScript dependencies first:

\`\`\`sh
npm ci --omit=dev --no-audit --no-fund
\`\`\`

- \`bin/gxserver\`: run gxserver in the foreground.
- \`bin/gxserver start\`: start gxserver in the background.
- \`bin/gxserver status --json\`: check runtime state for health/status automation.
- \`bin/gxserver stop\`: stop only the gxserver control plane; zmx sessions are not killed.
- \`bin/gxserver stop-all\`: kill gxserver-tracked zmx sessions, then stop the control plane.

The package includes Ghostex's pinned zmx, zehn, and upstream Beads \`bd\` artifacts in \`bin/\`. Project board operations require the bundled \`bd\`; shell-installed \`bd\` is intentionally ignored so Ghostex and agent workflows share one pinned Beads binary.
`;
}
