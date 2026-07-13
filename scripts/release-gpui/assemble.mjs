#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const [version, artifactsRoot] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) throw new Error("Version must be MAJOR.MINOR.PATCH");
if (!artifactsRoot || !existsSync(artifactsRoot)) throw new Error(`Artifact root is missing: ${artifactsRoot}`);

const expected = new Set(
  (process.env.GHOSTEX_RELEASE_EXPECTED_PLATFORMS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
if (expected.size === 0) throw new Error("GHOSTEX_RELEASE_EXPECTED_PLATFORMS is empty");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: options.capture ? "pipe" : "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed${result.stderr ? `\n${result.stderr}` : ""}`);
  return result.stdout?.trim() ?? "";
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

const sourceCommit = run("git", ["rev-parse", "HEAD"], { capture: true });
const updateSparkle = process.env.GHOSTEX_RELEASE_UPDATE_SPARKLE !== "0";

const manifests = [];
for (const artifactDirectory of readdirSync(artifactsRoot, { withFileTypes: true })) {
  if (!artifactDirectory.isDirectory()) continue;
  const directory = path.join(artifactsRoot, artifactDirectory.name);
  const manifestPath = path.join(directory, "manifest.json");
  if (!existsSync(manifestPath)) continue;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8").replace(/^\uFEFF/, ""));
  if (manifest.schemaVersion !== 1 || manifest.version !== version || !expected.has(manifest.platform)) {
    throw new Error(`Unexpected manifest ${manifestPath}: ${JSON.stringify(manifest)}`);
  }
  for (const artifact of manifest.artifacts ?? []) {
    const file = path.join(directory, artifact.name);
    if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`Manifest artifact is missing: ${file}`);
    const actual = sha256(file);
    if (actual !== artifact.sha256) throw new Error(`SHA256 mismatch for ${artifact.name}: ${actual} != ${artifact.sha256}`);
    artifact.path = file;
  }
  manifests.push({ directory, ...manifest });
}
const received = new Set(manifests.map((manifest) => manifest.platform));
for (const platform of expected) {
  if (!received.has(platform)) throw new Error(`Enabled platform produced no validated manifest: ${platform}`);
}
if (received.size !== expected.size || manifests.length !== expected.size) {
  throw new Error("Received duplicate or unexpected platform manifests");
}

const [major, minor, patch] = version.split(".").map(Number);
const buildNumber = major * 10000 + minor * 100 + patch;
const macos = manifests.find((manifest) => manifest.platform === "macos-arm64");
if (macos && updateSparkle) {
  const generatedAppcast = path.join(macos.directory, "appcast.xml");
  if (!existsSync(generatedAppcast)) throw new Error("macOS payload is missing appcast.xml");
  const xml = readFileSync(generatedAppcast, "utf8");
  if (!xml.includes(`sparkle:version=\"${buildNumber}\"`) || !xml.includes(`ghostex-${version}-arm64.dmg`)) {
    throw new Error("Generated appcast does not point at the new primary GPUI DMG/build");
  }
  writeFileSync("appcast.xml", xml);
  run("git", ["add", "appcast.xml"]);
  run("git", ["config", "user.name", "github-actions[bot]"]);
  run("git", ["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"]);
  run("git", ["commit", "-m", `chore: release ${version}`]);
}

const tag = `v${version}`;
if (run("git", ["tag", "-l", tag], { capture: true })) throw new Error(`Tag already exists: ${tag}`);
const existingRelease = spawnSync("gh", ["release", "view", tag, "--repo", "maddada/Ghostex"], { stdio: "ignore" });
if (existingRelease.status === 0) throw new Error(`GitHub release already exists: ${tag}`);

const changelog = readFileSync("CHANGELOG.md", "utf8");
const sectionStart = changelog.indexOf(`## ${version} -`);
if (sectionStart < 0) throw new Error(`CHANGELOG.md has no ${version} section`);
const nextSection = changelog.indexOf("\n## ", sectionStart + 4);
const releaseNotes = [changelog.slice(sectionStart, nextSection < 0 ? undefined : nextSection).trim(), ""];
if (process.env.GHOSTEX_RELEASE_PRERELEASE === "1") {
  releaseNotes.push("> Nightly prerelease. Existing macOS installations will not be notified through Sparkle.", "");
}
if (process.env.GHOSTEX_RELEASE_WINDOWS_SIGNED === "0") {
  releaseNotes.push("> Windows nightly packages are not Authenticode-signed and may show a SmartScreen warning.", "");
}
releaseNotes.push("## Downloads", "");
const uploadPaths = [];
for (const manifest of manifests.sort((a, b) => a.platform.localeCompare(b.platform))) {
  releaseNotes.push(`### ${manifest.platform}`, "");
  for (const artifact of manifest.artifacts) {
    releaseNotes.push(`- \`${artifact.name}\` — SHA256 \`${artifact.sha256}\``);
    uploadPaths.push(artifact.path);
  }
  releaseNotes.push("");
}
const notesPath = path.join(artifactsRoot, `release-notes-${version}.md`);
writeFileSync(notesPath, `${releaseNotes.join("\n").trim()}\n`);

const remoteMain = run("git", ["ls-remote", "origin", "refs/heads/main"], { capture: true }).split(/\s+/)[0];
if (remoteMain !== sourceCommit) {
  throw new Error(`origin/main moved during the build (${sourceCommit} -> ${remoteMain}); refusing partial publication`);
}
run("git", ["tag", "-a", tag, "-m", `Release ${tag}`]);
run("git", ["push", "origin", tag]);
const releaseArgs = [
  "release", "create", tag,
  "--repo", "maddada/Ghostex",
  "--title", `Ghostex ${version}${process.env.GHOSTEX_RELEASE_PRERELEASE === "1" ? " Nightly" : ""}`,
  "--notes-file", notesPath,
  "--draft",
  ...uploadPaths,
];
if (process.env.GHOSTEX_RELEASE_PRERELEASE === "1") releaseArgs.push("--prerelease");
run("gh", releaseArgs);
run("gh", ["release", "edit", tag, "--repo", "maddada/Ghostex", "--draft=false"]);

// Keep the Sparkle feed as the final public mutation. Existing users cannot
// observe an appcast entry until the matching signed DMG is already live.
if (macos && updateSparkle) run("git", ["push", "origin", "HEAD:main"]);

const liveRelease = JSON.parse(run("gh", ["api", `repos/maddada/Ghostex/releases/tags/${tag}`], { capture: true }));
if (liveRelease.draft) throw new Error(`Live release ${tag} is still a draft`);
const expectedAssets = new Map(
  manifests.flatMap((manifest) => manifest.artifacts).map((artifact) => [artifact.name, artifact.sha256]),
);
if (expectedAssets.size !== uploadPaths.length) throw new Error("Release artifact names are not globally unique");
if (liveRelease.assets?.length !== expectedAssets.size) {
  throw new Error(`Live release has ${liveRelease.assets?.length ?? 0} assets; expected ${expectedAssets.size}`);
}
for (const asset of liveRelease.assets) {
  const expectedSha = expectedAssets.get(asset.name);
  const liveSha = typeof asset.digest === "string" && asset.digest.startsWith("sha256:")
    ? asset.digest.slice("sha256:".length)
    : null;
  if (!expectedSha || liveSha !== expectedSha) {
    throw new Error(`Live asset digest mismatch for ${asset.name}: ${liveSha ?? "missing"} != ${expectedSha ?? "unexpected asset"}`);
  }
}

if (macos && updateSparkle) {
  const liveAppcastUrl = `https://raw.githubusercontent.com/maddada/Ghostex/main/appcast.xml?release=${version}`;
  let liveAppcast = "";
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = spawnSync("curl", ["-fsSL", liveAppcastUrl], { encoding: "utf8" });
    if (
      response.status === 0 &&
      response.stdout.includes(`sparkle:version=\"${buildNumber}\"`) &&
      response.stdout.includes(`ghostex-${version}-arm64.dmg`)
    ) {
      liveAppcast = response.stdout;
      break;
    }
    spawnSync("sleep", ["5"]);
  }
  if (!liveAppcast) throw new Error(`Live appcast did not advance to ${version} (${buildNumber})`);
}

console.log(`Published and live-verified ${tag} with ${uploadPaths.length} assets.`);
