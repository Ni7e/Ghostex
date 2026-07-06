#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  extractChangelogSectionFromText,
  onDemandAssetNames,
  releaseBuildVersion,
  validateGhostexCask,
} from "./release-ghostex.mjs";
import { validateMacosAppBundle } from "./validate-macos-app-bundle.mjs";

/*
 CDXC:ReleaseAutomation 2026-07-02-14:10:
 Final live verification previously lived as a long manual checklist in the
 release skill and re-downloaded the ~800 MB DMG it had already fetched twice.
 This script codifies the whole checklist as one command with a PASS/FAIL
 table, accepts --dmg to reuse an already-verified local artifact, and
 downloads the live DMG only when no verified local copy exists.
*/

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const githubRepo = "maddada/Ghostex";
const appcastUrl = "https://raw.githubusercontent.com/maddada/Ghostex/main/appcast.xml";
const liveCaskUrl = "https://raw.githubusercontent.com/maddada/homebrew-tap/main/Casks/ghostex.rb";
const subrepoCandidates = ["android", "iOS", "tui", "tui2", "crossplatform", "zmx", "zehn", "t3code"];

function usage() {
  return `
Usage:
  node scripts/release-final-verify.mjs <version> [options]

Options:
  --dmg <path>       Reuse an already-downloaded DMG (for example Homebrew's
                     fetch cache) instead of downloading the live asset again.
  --skip-repo        Skip local repo checks (clean worktree, tag at HEAD).
  --skip-brew        Skip all Homebrew checks.
  --skip-brew-fetch  Skip only the brew info/cat/fetch commands; the raw live
                     cask is still validated.
  --skip-android     Skip Android APK checks.
  --skip-sparkle     Skip live appcast checks.
  --skip-dmg         Skip DMG download/mount/bundle validation.
  --skip-subrepos    Skip subrepo cleanliness checks.
  --help             Show this help.
`;
}

function parseArgs(argv) {
  const options = {
    dmg: null,
    skipAndroid: false,
    skipBrew: false,
    skipBrewFetch: false,
    skipDmg: false,
    skipRepo: false,
    skipSparkle: false,
    skipSubrepos: false,
    version: null,
  };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--dmg") {
      options.dmg = argv[index + 1];
      if (!options.dmg) {
        throw new Error("--dmg requires a path.");
      }
      index += 1;
    } else if (arg === "--skip-repo") {
      options.skipRepo = true;
    } else if (arg === "--skip-brew") {
      options.skipBrew = true;
    } else if (arg === "--skip-brew-fetch") {
      options.skipBrewFetch = true;
    } else if (arg === "--skip-android") {
      options.skipAndroid = true;
    } else if (arg === "--skip-sparkle") {
      options.skipSparkle = true;
    } else if (arg === "--skip-dmg") {
      options.skipDmg = true;
    } else if (arg === "--skip-subrepos") {
      options.skipSubrepos = true;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (options.help) {
    return options;
  }
  if (positional.length !== 1 || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(positional[0] ?? "")) {
    throw new Error("Pass exactly one semver version, for example 5.5.0.");
  }
  options.version = positional[0];
  return options;
}

function runCommand(command, { timeoutMs = 120_000, cwd = repoRoot } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, env: process.env, shell: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGTERM");
      resolve({ code: 124, stderr: `${stderr}\n(timed out after ${timeoutMs}ms)`, stdout });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({ code: 127, stderr: String(error.message ?? error), stdout });
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({ code: code ?? 1, stderr, stdout });
    });
  });
}

async function capture(command, options = {}) {
  const result = await runCommand(command, options);
  if (result.code !== 0) {
    throw new Error(`${command} failed (${result.code}): ${(result.stderr || result.stdout).trim().slice(0, 800)}`);
  }
  return result.stdout.trim();
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function parseAssetSha(asset) {
  const digest = asset?.digest;
  return typeof digest === "string" && digest.startsWith("sha256:") ? digest.slice("sha256:".length) : null;
}

const results = [];

async function check(name, fn) {
  const startedAt = Date.now();
  try {
    const detail = await fn();
    if (detail === SKIPPED) {
      results.push({ detail: "", durationMs: Date.now() - startedAt, name, status: "SKIP" });
    } else if (detail && typeof detail === "object" && detail.warn) {
      results.push({ detail: detail.warn, durationMs: Date.now() - startedAt, name, status: "WARN" });
    } else {
      results.push({ detail: detail ?? "", durationMs: Date.now() - startedAt, name, status: "PASS" });
    }
  } catch (error) {
    results.push({
      detail: String(error?.message ?? error).split("\n").slice(0, 3).join(" | "),
      durationMs: Date.now() - startedAt,
      name,
      status: "FAIL",
    });
  }
}

const SKIPPED = Symbol("skipped");

function formatDuration(durationMs) {
  const seconds = durationMs / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage().trim());
    return;
  }
  process.chdir(repoRoot);
  const version = options.version;
  const buildVersion = releaseBuildVersion(version);
  const startedAt = Date.now();
  console.log(`Ghostex final live verification for ${version} (build ${buildVersion})`);

  await check("repo-clean", async () => {
    if (options.skipRepo) {
      return SKIPPED;
    }
    const status = await capture("git status --porcelain --untracked-files=all");
    if (status) {
      throw new Error(`Worktree is dirty:\n${status.split(/\r?\n/).slice(0, 6).join(", ")}`);
    }
    return "clean";
  });

  await check("tag-at-head", async () => {
    if (options.skipRepo) {
      return SKIPPED;
    }
    const tags = await capture("git tag --points-at HEAD");
    if (!tags.split(/\r?\n/).includes(`v${version}`)) {
      throw new Error(`v${version} does not point at HEAD (tags at HEAD: ${tags || "none"}).`);
    }
    return `v${version} at HEAD`;
  });

  let releaseAssets = [];
  let releaseBody = "";
  await check("github-release", async () => {
    const json = await capture(
      `env -u GH_TOKEN -u GITHUB_TOKEN gh release view ${shellQuote(`v${version}`)} --repo ${shellQuote(githubRepo)} --json tagName,url,assets,body`,
    );
    const release = JSON.parse(json);
    releaseAssets = release.assets ?? [];
    releaseBody = release.body ?? "";
    const dmgName = `ghostex-${version}-arm64.dmg`;
    if (!releaseAssets.some((asset) => asset.name === dmgName)) {
      throw new Error(`Release is missing ${dmgName}.`);
    }
    return `${releaseAssets.length} assets at ${release.url}`;
  });

  const dmgAsset = releaseAssets.find((asset) => asset.name === `ghostex-${version}-arm64.dmg`);
  const dmgDigest = parseAssetSha(dmgAsset);

  const onDemandReleaseAssets = onDemandAssetNames
    .map((name) => releaseAssets.find((asset) => asset.name === name))
    .filter(Boolean);
  const expectOnDemand = onDemandReleaseAssets.length === onDemandAssetNames.length;

  await check("on-demand-assets", async () => {
    if (releaseAssets.length === 0) {
      throw new Error("GitHub release assets were not readable.");
    }
    if (!expectOnDemand) {
      if (onDemandReleaseAssets.length > 0) {
        throw new Error(
          `Release has only ${onDemandReleaseAssets.length}/${onDemandAssetNames.length} on-demand assets: ${onDemandReleaseAssets.map((asset) => asset.name).join(", ")}.`,
        );
      }
      return { warn: "No on-demand assets on this release (legacy bundled-payload release)." };
    }
    for (const asset of onDemandReleaseAssets) {
      if (!parseAssetSha(asset)) {
        throw new Error(`GitHub reports no digest for ${asset.name}.`);
      }
    }
    return onDemandReleaseAssets.map((asset) => `${asset.name}`).join(", ");
  });

  let changelogNotes = null;
  await check("changelog-section", async () => {
    const changelog = await readFile(path.join(repoRoot, "CHANGELOG.md"), "utf8");
    changelogNotes = extractChangelogSectionFromText(changelog, version);
    return "present with Major/Minor/GPUI bullets";
  });

  let liveSignature = null;
  await check("live-appcast", async () => {
    if (options.skipSparkle) {
      return SKIPPED;
    }
    const appcastPath = path.join(await mkdtemp(path.join(tmpdir(), `ghostex-verify-${version}-`)), "appcast.xml");
    await capture(`curl -fsSL ${shellQuote(appcastUrl)} -o ${shellQuote(appcastPath)}`);
    await capture(`xmllint --noout ${shellQuote(appcastPath)}`);
    const topVersion = await capture(
      `xmllint --xpath "string((//*[local-name()='item'][1]/*[local-name()='version'])[1])" ${shellQuote(appcastPath)}`,
    );
    const topShortVersion = await capture(
      `xmllint --xpath "string((//*[local-name()='item'][1]/*[local-name()='shortVersionString'])[1])" ${shellQuote(appcastPath)}`,
    );
    const topUrl = await capture(
      `xmllint --xpath "string((//*[local-name()='item'][1]/*[local-name()='enclosure']/@url)[1])" ${shellQuote(appcastPath)}`,
    );
    liveSignature = await capture(
      `xmllint --xpath "string((//*[local-name()='item'][1]/*[local-name()='enclosure']/@*[local-name()='edSignature'])[1])" ${shellQuote(appcastPath)}`,
    );
    const embeddedNotes = await capture(
      `xmllint --xpath "string((//*[local-name()='item'][1]/*[local-name()='description'])[1])" ${shellQuote(appcastPath)}`,
    );
    const expectedUrl = `https://github.com/${githubRepo}/releases/download/v${version}/ghostex-${version}-arm64.dmg`;
    if (topVersion !== String(buildVersion) || topShortVersion !== version) {
      throw new Error(`Top item is ${topShortVersion} (${topVersion}); expected ${version} (${buildVersion}).`);
    }
    if (topUrl !== expectedUrl) {
      throw new Error(`Top enclosure URL is ${topUrl}.`);
    }
    if (!liveSignature) {
      throw new Error("Top enclosure has no EdDSA signature.");
    }
    const notesProbe = changelogNotes
      ?.split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith("- ") && line !== "- Major" && line !== "- Minor" && line !== "- GPUI")
      ?.slice(2);
    if (!embeddedNotes.trim()) {
      throw new Error("Top item has empty embedded release notes.");
    }
    if (notesProbe && !embeddedNotes.includes(notesProbe)) {
      throw new Error(`Embedded notes do not contain expected changelog text: ${notesProbe}`);
    }
    return `top item ${version} (${buildVersion}) with embedded notes`;
  });

  await check("homebrew-cask", async () => {
    if (options.skipBrew) {
      return SKIPPED;
    }
    if (!dmgDigest) {
      throw new Error("GitHub reported no DMG digest to validate the cask sha256 against.");
    }
    const liveCask = await capture(`curl -fsSL ${shellQuote(liveCaskUrl)}`);
    validateGhostexCask(liveCask, { sha256: dmgDigest, version });
    return `live cask at ${version}, arm64-only, :ventura`;
  });

  await check("homebrew-commands", async () => {
    if (options.skipBrew || options.skipBrewFetch) {
      return SKIPPED;
    }
    await capture("HOMEBREW_NO_INSTALL_FROM_API=1 brew info --cask maddada/tap/ghostex", { timeoutMs: 300_000 });
    const catOutput = await capture("HOMEBREW_NO_INSTALL_FROM_API=1 brew cat --cask maddada/tap/ghostex", {
      timeoutMs: 300_000,
    });
    validateGhostexCask(catOutput, { sha256: dmgDigest, version });
    await capture("HOMEBREW_NO_INSTALL_FROM_API=1 brew fetch --force --cask --arch=arm maddada/tap/ghostex", {
      timeoutMs: 900_000,
    });
    return "brew info/cat/fetch validated";
  });

  let dmgPath = null;
  await check("dmg-artifact", async () => {
    if (options.skipDmg) {
      return SKIPPED;
    }
    if (options.dmg && existsSync(options.dmg)) {
      dmgPath = options.dmg;
    } else {
      const downloadPath = path.join(tmpdir(), `ghostex-${version}-final-verify.dmg`);
      await capture(
        `curl -fsSL ${shellQuote(`https://github.com/${githubRepo}/releases/download/v${version}/ghostex-${version}-arm64.dmg`)} -o ${shellQuote(downloadPath)}`,
        { timeoutMs: 1_800_000 },
      );
      dmgPath = downloadPath;
    }
    const sha = await capture(`shasum -a 256 ${shellQuote(dmgPath)} | awk '{print $1}'`);
    if (dmgDigest && sha !== dmgDigest) {
      throw new Error(`DMG SHA256 ${sha} does not match GitHub digest ${dmgDigest}.`);
    }
    return `${path.basename(dmgPath)} (${sha.slice(0, 12)}...)`;
  });

  await check("sparkle-signature", async () => {
    if (options.skipSparkle || options.skipDmg) {
      return SKIPPED;
    }
    if (!dmgPath || !liveSignature) {
      throw new Error("DMG path or live signature unavailable.");
    }
    const findCommand = [
      "find",
      shellQuote(path.join(repoRoot, "build/arm64/SourcePackages/artifacts/sparkle")),
      shellQuote(path.join(repoRoot, "build/SourcePackages/artifacts/sparkle")),
      "'/tmp/ghostex-xcodebuild/SourcePackages/artifacts/sparkle'",
      "-path '*/Sparkle/bin/sign_update' -print -quit 2>/dev/null",
    ].join(" ");
    const signUpdate = (await runCommand(findCommand)).stdout.trim();
    if (!signUpdate) {
      return { warn: "Sparkle sign_update tool not found locally; signature not re-verified against the DMG." };
    }
    await capture(`${shellQuote(signUpdate)} --verify ${shellQuote(dmgPath)} ${shellQuote(liveSignature)}`);
    return "live EdDSA signature verifies the DMG bytes";
  });

  await check("dmg-bundle-validation", async () => {
    if (options.skipDmg) {
      return SKIPPED;
    }
    if (!dmgPath) {
      throw new Error("No DMG available to mount.");
    }
    const attachOutput = await capture(`hdiutil attach -nobrowse -readonly ${shellQuote(dmgPath)}`);
    const mountPoint = attachOutput.split("\n").filter(Boolean).at(-1)?.split(/\t+/).at(-1)?.trim();
    if (!mountPoint || !mountPoint.startsWith("/Volumes/")) {
      throw new Error(`Could not parse mount point from hdiutil output.`);
    }
    try {
      const appPath = path.join(mountPoint, "ghostex.app");
      await capture(`codesign --verify --deep --strict --verbose=2 ${shellQuote(appPath)}`, { timeoutMs: 600_000 });
      const shortVersion = await capture(
        `plutil -extract CFBundleShortVersionString raw ${shellQuote(path.join(appPath, "Contents/Info.plist"))}`,
      );
      const bundleVersion = await capture(
        `plutil -extract CFBundleVersion raw ${shellQuote(path.join(appPath, "Contents/Info.plist"))}`,
      );
      if (shortVersion !== version || bundleVersion !== String(buildVersion)) {
        throw new Error(`Mounted app is ${shortVersion} (${bundleVersion}); expected ${version} (${buildVersion}).`);
      }
      await validateMacosAppBundle({ appName: "Ghostex", appPath, arch: "arm64" });

      const manifestPath = path.join(appPath, "Contents/Resources/Web/on-demand-resources.json");
      if (expectOnDemand) {
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        if (manifest.version !== version) {
          throw new Error(`Sealed on-demand manifest records ${manifest.version}; expected ${version}.`);
        }
        for (const asset of onDemandReleaseAssets) {
          const sealed = Object.values(manifest.assets ?? {}).find((entry) => entry?.name === asset.name);
          const liveSha = parseAssetSha(asset);
          if (!sealed || sealed.sha256 !== liveSha) {
            throw new Error(
              `Sealed checksum for ${asset.name} (${sealed?.sha256 ?? "missing"}) does not match the live asset digest (${liveSha}).`,
            );
          }
        }
      } else if (existsSync(manifestPath)) {
        throw new Error("Mounted app declares on-demand assets but the release has none.");
      }
      return expectOnDemand
        ? "mounted app valid; sealed manifest matches live asset digests"
        : "mounted app valid (legacy bundled payloads)";
    } finally {
      await runCommand(`hdiutil detach ${shellQuote(mountPoint)}`);
    }
  });

  await check("android-apk", async () => {
    if (options.skipAndroid) {
      return SKIPPED;
    }
    const apkAsset = releaseAssets.find((asset) => asset.name === "ghostex-android.apk");
    if (!apkAsset) {
      throw new Error("Release is missing ghostex-android.apk.");
    }
    const apkSha = parseAssetSha(apkAsset);
    if (!apkSha) {
      return { warn: "GitHub reported no digest for ghostex-android.apk; checksum not cross-checked." };
    }
    if (!releaseBody.includes(apkSha)) {
      throw new Error("Release notes do not contain the Android APK SHA256.");
    }
    return `APK digest ${apkSha.slice(0, 12)}... present in release notes`;
  });

  await check("subrepos-clean", async () => {
    if (options.skipSubrepos) {
      return SKIPPED;
    }
    const problems = [];
    for (const repo of subrepoCandidates) {
      const repoPath = path.join(repoRoot, repo);
      if (!existsSync(repoPath)) {
        continue;
      }
      const isRepo = await runCommand(`git -C ${shellQuote(repoPath)} rev-parse --git-dir`, { timeoutMs: 10_000 });
      if (isRepo.code !== 0) {
        continue;
      }
      const status = await capture(`git -C ${shellQuote(repoPath)} status --porcelain --untracked-files=all`);
      if (status) {
        problems.push(repo);
      }
    }
    if (problems.length > 0) {
      throw new Error(`Dirty subrepos: ${problems.join(", ")}`);
    }
    return "all clean";
  });

  console.log("");
  const nameWidth = Math.max(...results.map((result) => result.name.length)) + 2;
  for (const result of results) {
    console.log(
      `${result.status.padEnd(4)}  ${result.name.padEnd(nameWidth)} ${formatDuration(result.durationMs).padStart(8)}  ${result.detail}`,
    );
  }
  const failed = results.filter((result) => result.status === "FAIL");
  if (failed.length > 0) {
    console.error(`\nFinal verification FAILED (${failed.map((result) => result.name).join(", ")}) in ${formatDuration(Date.now() - startedAt)}.`);
    process.exitCode = 1;
    return;
  }
  const warned = results.filter((result) => result.status === "WARN");
  console.log(
    `\nFinal verification PASSED in ${formatDuration(Date.now() - startedAt)}${warned.length > 0 ? ` with ${warned.length} warning(s)` : ""}.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
