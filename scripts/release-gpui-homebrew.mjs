#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const [version] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/u.test(version ?? "")) {
  throw new Error(`Version must be MAJOR.MINOR.PATCH, got ${version ?? "nothing"}`);
}

function run(command, args, options = {}) {
  const output = execFileSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: { ...process.env, HOMEBREW_NO_AUTO_UPDATE: "1", HOMEBREW_NO_INSTALL_FROM_API: "1" },
    stdio: options.capture === false ? "inherit" : "pipe",
  });
  return typeof output === "string" ? output.trim() : "";
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

const release = JSON.parse(
  run("gh", [
    "release",
    "view",
    `v${version}`,
    "--repo",
    "maddada/Ghostex",
    "--json",
    "isDraft,assets,url",
  ]),
);
if (release.isDraft) throw new Error(`v${version} is still a draft`);
const dmgName = `ghostex-${version}-arm64.dmg`;
const dmg = release.assets.find((asset) => asset.name === dmgName);
const dmgSha = typeof dmg?.digest === "string" && dmg.digest.startsWith("sha256:")
  ? dmg.digest.slice("sha256:".length)
  : "";
if (!/^[0-9a-f]{64}$/u.test(dmgSha)) {
  throw new Error(`${release.url} has no SHA256 digest for ${dmgName}`);
}

const tapCheckout = mkdtempSync(path.join(os.tmpdir(), `ghostex-${version}-homebrew-tap-`));
run("git", ["clone", "--depth", "1", "https://github.com/maddada/homebrew-tap.git", tapCheckout], {
  capture: false,
});
const caskPath = path.join(tapCheckout, "Casks/ghostex.rb");
const current = readFileSync(caskPath, "utf8");
const updated = current
  .replace(/^\s*version "[^"]+"/mu, `  version "${version}"`)
  .replace(/^\s*sha256 "[0-9a-f]+"/mu, `  sha256 "${dmgSha}"`);
if (!updated.includes(`version "${version}"`) || !updated.includes(`sha256 "${dmgSha}"`)) {
  throw new Error("Could not update the canonical Ghostex cask version and SHA256");
}
if (updated !== current) writeFileSync(caskPath, updated);

run("ruby", ["-c", "Casks/ghostex.rb"], { cwd: tapCheckout, capture: false });
run("brew", ["style", "--fix", "Casks/ghostex.rb"], { cwd: tapCheckout, capture: false });
run("brew", ["style", "Casks/ghostex.rb"], { cwd: tapCheckout, capture: false });
run("git", ["diff", "--check"], { cwd: tapCheckout, capture: false });
const tapStatus = run("git", ["status", "--porcelain"], { cwd: tapCheckout });
if (tapStatus) {
  run("git", ["add", "Casks/ghostex.rb"], { cwd: tapCheckout, capture: false });
  run("git", ["commit", "-m", `chore: update Ghostex cask to ${version}`], {
    cwd: tapCheckout,
    capture: false,
  });
  run("git", ["push", "origin", "main"], { cwd: tapCheckout, capture: false });
}

run("brew", ["tap", "maddada/tap"], { capture: false });
const installedTap = run("brew", ["--repo", "maddada/tap"]);
run("git", ["fetch", "origin", "main"], { cwd: installedTap, capture: false });
run("git", ["merge", "--ff-only", "origin/main"], { cwd: installedTap, capture: false });
run("brew", ["info", "--cask", "maddada/tap/ghostex"], { capture: false });
let cachePath = run("brew", ["--cache", "--cask", "maddada/tap/ghostex"]);
if (!existsSync(cachePath) || sha256(cachePath) !== dmgSha) {
  run("brew", ["fetch", "--force", "--cask", "--arch=arm", "maddada/tap/ghostex"], {
    capture: false,
  });
  cachePath = run("brew", ["--cache", "--cask", "maddada/tap/ghostex"]);
}
if (!existsSync(cachePath) || sha256(cachePath) !== dmgSha) {
  throw new Error(`Homebrew cache does not contain the verified ${dmgName}`);
}

console.log(`Homebrew cask ${version} is live with SHA256 ${dmgSha}.`);
console.log(`DMG_PATH=${cachePath}`);
