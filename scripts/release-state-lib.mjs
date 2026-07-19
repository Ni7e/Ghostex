import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const RELEASE_REPO = process.env.GHOSTEX_RELEASE_REPO ?? "maddada/Ghostex";
export const STATE_ASSET = "release-state.json";
export const METADATA_SUFFIX = ".metadata.json";

export function assertVersion(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
    throw new Error(`Version must be MAJOR.MINOR.PATCH, got ${version ?? "<empty>"}`);
  }
}

export function assertSha(sourceSha) {
  if (!/^[0-9a-f]{40}$/.test(sourceSha ?? "")) {
    throw new Error(`source_sha must be a full 40-character Git commit SHA, got ${sourceSha ?? "<empty>"}`);
  }
}

export function releaseContracts(version) {
  assertVersion(version);
  return new Map([
    ["android", {
      architecture: "universal",
      assets: ["ghostex-android.apk"],
      label: "Android",
      workflow: "release-build-android.yml",
    }],
    ["gxserver-linux-x64", {
      architecture: "x86_64",
      assets: ["gxserver-linux-x64.tar.gz"],
      label: "gxserver Linux x64",
      workflow: "release-build-gxserver-x64.yml",
    }],
    ["gxserver-linux-arm64", {
      architecture: "aarch64",
      assets: ["gxserver-linux-arm64.tar.gz"],
      label: "gxserver Linux ARM64",
      workflow: "release-build-gxserver-arm64.yml",
    }],
    ["macos-arm64", {
      architecture: "arm64",
      assets: [`ghostex-${version}-arm64.dmg`, "bd-darwin-arm64.tar.gz"],
      dependencies: ["gxserver-linux-x64", "gxserver-linux-arm64"],
      label: "macOS",
      workflow: "release-build-macos.yml",
    }],
  ]);
}

export function expectedAssets(version) {
  return [...releaseContracts(version).values()].flatMap((contract) => contract.assets);
}

export function run(command, args, { allowFailure = false, capture = false, cwd, env, input } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: env ? { ...process.env, ...env } : process.env,
    input,
    maxBuffer: 64 * 1024 * 1024,
    stdio: capture || allowFailure || input !== undefined ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.status})${result.stderr ? `\n${result.stderr.trim()}` : ""}`);
  }
  return { status: result.status ?? 1, stderr: result.stderr?.trim() ?? "", stdout: result.stdout?.trim() ?? "" };
}

function runBytes(command, args) {
  const result = spawnSync(command, args, { encoding: null, maxBuffer: 512 * 1024 * 1024, stdio: "pipe" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.status})`);
  return result.stdout;
}

export function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

export function getRelease(version, { required = true } = {}) {
  assertVersion(version);
  let response = run("gh", ["api", `repos/${RELEASE_REPO}/releases/tags/v${version}`], { allowFailure: true, capture: true });
  if (response.status !== 0) {
    const releases = run("gh", ["api", `repos/${RELEASE_REPO}/releases?per_page=100`], { allowFailure: true, capture: true });
    if (releases.status === 0) {
      const match = JSON.parse(releases.stdout).find((candidate) => candidate.tag_name === `v${version}`);
      if (match) return match;
    }
    if (!required && /HTTP 404|Not Found/i.test(response.stderr)) return null;
    throw new Error(`Could not read staged release v${version}: ${response.stderr || response.stdout}`);
  }
  return JSON.parse(response.stdout);
}

export function findAsset(release, name) {
  return (release.assets ?? []).find((asset) => asset.name === name) ?? null;
}

export function downloadAsset(asset) {
  return runBytes("gh", [
    "api",
    "-H", "Accept: application/octet-stream",
    `repos/${RELEASE_REPO}/releases/assets/${asset.id}`,
  ]);
}

export function assetSha256(asset) {
  if (typeof asset.digest === "string" && asset.digest.startsWith("sha256:")) {
    return asset.digest.slice("sha256:".length);
  }
  return createHash("sha256").update(downloadAsset(asset)).digest("hex");
}

export function readJsonAsset(release, name, { required = true } = {}) {
  const asset = findAsset(release, name);
  if (!asset) {
    if (!required) return null;
    throw new Error(`Release v${release.tag_name?.replace(/^v/, "")} is missing ${name}`);
  }
  return JSON.parse(downloadAsset(asset).toString("utf8"));
}

function uploadFile(tag, file, name = path.basename(file)) {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "ghostex-release-upload-"));
  try {
    const uploadPath = path.join(temporary, name);
    writeFileSync(uploadPath, readFileSync(file));
    run("gh", ["release", "upload", tag, uploadPath, "--repo", RELEASE_REPO]);
  } finally {
    rmSync(temporary, { force: true, recursive: true });
  }
}

export function uploadImmutableAsset(version, file, name = path.basename(file)) {
  if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`Staged file is missing: ${file}`);
  let release = getRelease(version);
  const expectedSha = sha256(file);
  const existing = findAsset(release, name);
  if (existing) {
    const existingSha = assetSha256(existing);
    if (existingSha !== expectedSha) {
      throw new Error(
        `Refusing to overwrite staged asset ${name}: existing SHA256 ${existingSha}, new SHA256 ${expectedSha}. ` +
        "Use an explicit replacement procedure after auditing the release state.",
      );
    }
    console.log(`${name}: already staged with expected checksum; reusing it`);
    return { asset: existing, reused: true, sha256: expectedSha };
  }
  uploadFile(`v${version}`, file, name);
  release = getRelease(version);
  const uploaded = findAsset(release, name);
  if (!uploaded || assetSha256(uploaded) !== expectedSha) throw new Error(`Upload verification failed for ${name}`);
  console.log(`${name}: staged and verified`);
  return { asset: uploaded, reused: false, sha256: expectedSha };
}

export function replaceReleaseState(version, state) {
  const release = getRelease(version);
  const existing = findAsset(release, STATE_ASSET);
  const temporary = mkdtempSync(path.join(os.tmpdir(), "ghostex-release-state-"));
  const statePath = path.join(temporary, STATE_ASSET);
  try {
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
    // release-state.json is the mutable orchestration record. Deliverables and
    // their metadata never use this replacement path.
    if (existing) run("gh", ["api", "--method", "DELETE", `repos/${RELEASE_REPO}/releases/assets/${existing.id}`]);
    uploadFile(`v${version}`, statePath, STATE_ASSET);
  } finally {
    rmSync(temporary, { force: true, recursive: true });
  }
  return state;
}

export function createInitialState({ channel = "stable", sourceSha, updateSparkle = true, version, workflowSha = null }) {
  assertVersion(version);
  assertSha(sourceSha);
  if (!new Set(["stable", "prerelease", "test"]).has(channel)) throw new Error(`Unsupported release channel: ${channel}`);
  if (channel !== "stable" && updateSparkle) throw new Error(`${channel} releases cannot update the production Sparkle feed`);
  return {
    channel,
    completed: {},
    created_at: new Date().toISOString(),
    expected: expectedAssets(version),
    github_release: { published: false },
    macos_notarization: {},
    schemaVersion: 1,
    source_sha: sourceSha,
    sparkle: { published: false, requested: Boolean(updateSparkle) },
    version,
    workflow_sha: workflowSha,
  };
}

export function ensureDraftRelease({ channel = "stable", sourceSha, updateSparkle = true, version, workflowSha = null }) {
  let release = getRelease(version, { required: false });
  if (!release) {
    const notes = `Durable staging release for Ghostex ${version}. Assets remain draft until release-assemble verifies the complete manifest.`;
    const args = [
      "release", "create", `v${version}`,
      "--repo", RELEASE_REPO,
      "--target", sourceSha,
      "--title", `Ghostex ${version}`,
      "--notes", notes,
      "--draft",
    ];
    if (channel !== "stable") args.push("--prerelease");
    run("gh", args);
    release = getRelease(version);
  }
  let state = readJsonAsset(release, STATE_ASSET, { required: false });
  if (!state) {
    if (!release.draft) throw new Error(`Refusing to initialize resumable state on already-public release v${version}`);
    state = createInitialState({ channel, sourceSha, updateSparkle, version, workflowSha });
    replaceReleaseState(version, state);
  }
  validateStateIdentity(state, { sourceSha, version });
  if (release.draft && release.target_commitish !== state.source_sha) {
    throw new Error(`Draft target ${release.target_commitish} does not match immutable source_sha ${state.source_sha}`);
  }
  if (state.channel !== channel) {
    throw new Error(`Release state channel ${state.channel} does not match ${channel}`);
  }
  if (Boolean(state.sparkle?.requested) !== Boolean(updateSparkle)) {
    throw new Error(`Release state Sparkle setting ${state.sparkle?.requested} does not match ${updateSparkle}`);
  }
  if (!release.draft && !state.github_release?.published) {
    state.github_release = { published: true, published_at: release.published_at ?? null };
    replaceReleaseState(version, state);
  }
  return { release: getRelease(version), state };
}

export function validateStateIdentity(state, { sourceSha, version }) {
  if (state.schemaVersion !== 1) throw new Error(`Unsupported release-state schema: ${state.schemaVersion}`);
  if (state.version !== version) throw new Error(`Release state version ${state.version} does not match ${version}`);
  if (sourceSha && state.source_sha !== sourceSha) {
    throw new Error(`Release state source_sha ${state.source_sha} does not match ${sourceSha}`);
  }
  assertSha(state.source_sha);
  const exactExpected = expectedAssets(version);
  if (JSON.stringify(state.expected) !== JSON.stringify(exactExpected)) {
    throw new Error(`Release expected allowlist is invalid: ${JSON.stringify(state.expected)} != ${JSON.stringify(exactExpected)}`);
  }
}

export function createMetadata({ architecture, asset, packageName, sourceSha, version, workflowRunId, workflowSha }) {
  assertVersion(version);
  assertSha(sourceSha);
  return {
    architecture,
    asset: path.basename(asset),
    created_at: new Date().toISOString(),
    package: packageName,
    schemaVersion: 1,
    sha256: sha256(asset),
    size: statSync(asset).size,
    source_sha: sourceSha,
    version,
    workflow_run_id: Number(workflowRunId || 0),
    workflow_sha: workflowSha || null,
  };
}

export function stagePackage({ artifactDirectory, channel, packageName, sourceSha, updateSparkle, version, workflowRunId, workflowSha }) {
  ensureDraftRelease({ channel, sourceSha, updateSparkle, version, workflowSha });
  const contract = releaseContracts(version).get(packageName);
  if (!contract) throw new Error(`Unexpected release package: ${packageName}`);
  const metadata = [];
  for (const assetName of contract.assets) {
    const assetPath = path.join(artifactDirectory, assetName);
    if (!existsSync(assetPath)) throw new Error(`${packageName} is missing required asset ${assetName}`);
    let entry = createMetadata({
      architecture: contract.architecture,
      asset: assetPath,
      packageName,
      sourceSha,
      version,
      workflowRunId,
      workflowSha,
    });
    uploadImmutableAsset(version, assetPath, assetName);
    const metadataName = `${assetName}${METADATA_SUFFIX}`;
    const currentRelease = getRelease(version);
    const existingMetadataAsset = findAsset(currentRelease, metadataName);
    if (existingMetadataAsset) {
      const existing = JSON.parse(downloadAsset(existingMetadataAsset).toString("utf8"));
      if (
        existing.schemaVersion !== 1 || existing.version !== version || existing.source_sha !== sourceSha ||
        existing.package !== packageName || existing.architecture !== contract.architecture ||
        existing.asset !== assetName || existing.sha256 !== entry.sha256 || Number(existing.size) !== entry.size
      ) {
        throw new Error(`Refusing to overwrite mismatched staged metadata ${metadataName}`);
      }
      console.log(`${metadataName}: already staged for the same immutable asset; reusing it`);
      entry = existing;
      metadata.push(entry);
      continue;
    }
    const temporary = mkdtempSync(path.join(os.tmpdir(), "ghostex-release-metadata-"));
    try {
      const metadataPath = path.join(temporary, metadataName);
      writeFileSync(metadataPath, `${JSON.stringify(entry, null, 2)}\n`);
      uploadImmutableAsset(version, metadataPath, metadataName);
    } finally {
      rmSync(temporary, { force: true, recursive: true });
    }
    metadata.push(entry);
  }
  const nextState = readJsonAsset(getRelease(version), STATE_ASSET);
  validateStateIdentity(nextState, { sourceSha, version });
  nextState.completed[packageName] = {
    assets: Object.fromEntries(metadata.map((entry) => [entry.asset, entry.sha256])),
    completed_at: new Date().toISOString(),
    run_id: Number(workflowRunId || 0),
    workflow_sha: workflowSha || null,
  };
  if (packageName === "macos-arm64") {
    nextState.macos_notarization = {
      ...nextState.macos_notarization,
      accepted_at: new Date().toISOString(),
      stapled: true,
      status: "accepted",
    };
  }
  replaceReleaseState(version, nextState);
  return { metadata, state: nextState };
}

export function validateStagedRelease(version, { requireComplete = false, sourceSha = null } = {}) {
  const release = getRelease(version);
  const state = readJsonAsset(release, STATE_ASSET);
  validateStateIdentity(state, { sourceSha, version });
  if (release.draft && release.target_commitish !== state.source_sha) {
    throw new Error(`Draft target ${release.target_commitish} does not match immutable source_sha ${state.source_sha}`);
  }
  const contracts = releaseContracts(version);
  const allowed = new Set([STATE_ASSET]);
  for (const name of state.expected) {
    allowed.add(name);
    allowed.add(`${name}${METADATA_SUFFIX}`);
  }
  const unexpected = (release.assets ?? []).map((asset) => asset.name).filter((name) => !allowed.has(name));
  if (unexpected.length > 0) throw new Error(`Draft contains unexpected or disabled assets: ${unexpected.join(", ")}`);

  const completed = {};
  const errors = [];
  for (const [packageName, contract] of contracts) {
    const entries = [];
    for (const name of contract.assets) {
      const asset = findAsset(release, name);
      const metadataAsset = findAsset(release, `${name}${METADATA_SUFFIX}`);
      if (!asset || !metadataAsset) {
        errors.push(`${packageName}: missing ${!asset ? name : `${name}${METADATA_SUFFIX}`}`);
        continue;
      }
      const metadata = JSON.parse(downloadAsset(metadataAsset).toString("utf8"));
      const actualSha = assetSha256(asset);
      const actualSize = Number(asset.size);
      if (
        metadata.schemaVersion !== 1 || metadata.version !== version || metadata.source_sha !== state.source_sha ||
        metadata.package !== packageName || metadata.architecture !== contract.architecture ||
        metadata.asset !== name || metadata.sha256 !== actualSha || Number(metadata.size) !== actualSize
      ) {
        errors.push(`${packageName}: invalid metadata/checksum for ${name}`);
        continue;
      }
      entries.push(metadata);
    }
    if (entries.length === contract.assets.length) {
      const recorded = state.completed?.[packageName];
      const recordedAssetsMatch = recorded?.assets && entries.every((entry) => recorded.assets[entry.asset] === entry.sha256);
      completed[packageName] = {
        assets: Object.fromEntries(entries.map((entry) => [entry.asset, entry.sha256])),
        run_id: recordedAssetsMatch ? recorded.run_id : entries[0].workflow_run_id,
        workflow_sha: recordedAssetsMatch ? recorded.workflow_sha : entries[0].workflow_sha,
      };
    }
  }
  if (requireComplete && errors.length > 0) throw new Error(`Release staging is incomplete or invalid:\n- ${errors.join("\n- ")}`);
  return { completed, errors, release, state };
}

export function printStatus(version) {
  const result = validateStagedRelease(version);
  const lines = [];
  for (const [packageName, contract] of releaseContracts(version)) {
    const ready = result.completed[packageName];
    if (ready) {
      lines.push(`${contract.label.padEnd(26)} ready — reuse run ${ready.run_id || "unknown"}`);
    } else if (packageName === "macos-arm64" && result.state.macos_notarization?.submission_id) {
      lines.push(`${contract.label.padEnd(26)} failed — resume notarization ${result.state.macos_notarization.submission_id}`);
    } else if (packageName === "macos-arm64" && result.state.macos_notarization?.signed_dmg_run_id) {
      lines.push(`${contract.label.padEnd(26)} signed — submit preserved run ${result.state.macos_notarization.signed_dmg_run_id}`);
    } else {
      const reason = result.errors.find((entry) => entry.startsWith(`${packageName}:`))?.split(": ").slice(1).join(": ") ?? "not built";
      lines.push(`${contract.label.padEnd(26)} missing — ${reason}`);
    }
  }
  const complete = Object.keys(result.completed).length === releaseContracts(version).size;
  lines.push(`${"GitHub release".padEnd(26)} ${result.release.draft ? (complete ? "ready to assemble" : "waiting for packages") : "published"}`);
  lines.push(`${"Sparkle".padEnd(26)} ${result.state.sparkle?.published ? "published" : result.state.sparkle?.requested ? "not published" : "disabled"}`);
  console.log(lines.join("\n"));
  return result;
}

export function dispatchWorkflow(workflow, fields) {
  const args = ["workflow", "run", workflow, "--repo", RELEASE_REPO, "--ref", "main"];
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === "") continue;
    args.push("-f", `${name}=${value}`);
  }
  run("gh", args);
}

export function dispatchMissing(version, { dryRun = false } = {}) {
  const result = printStatus(version);
  const decisions = [];
  for (const [packageName, contract] of releaseContracts(version)) {
    if (result.completed[packageName]) continue;
    const dependenciesReady = (contract.dependencies ?? []).every((dependency) => result.completed[dependency]);
    if (!dependenciesReady) continue;
    const fields = {
      channel: result.state.channel,
      source_sha: result.state.source_sha,
      update_sparkle: result.state.sparkle.requested,
      version,
    };
    if (packageName === "macos-arm64") {
      fields.gxserver_x64_run_id = result.completed["gxserver-linux-x64"].run_id;
      fields.gxserver_arm64_run_id = result.completed["gxserver-linux-arm64"].run_id;
      const notarization = result.state.macos_notarization ?? {};
      if (notarization.submission_id) {
        fields.macos_stage = "poll-staple";
        fields.prerequisite_run_id = notarization.signed_dmg_run_id;
        fields.submission_id = notarization.submission_id;
      } else if (notarization.signed_dmg_run_id) {
        fields.macos_stage = "submit";
        fields.prerequisite_run_id = notarization.signed_dmg_run_id;
      }
    }
    decisions.push({ fields, label: contract.label, workflow: contract.workflow });
  }
  if (decisions.length === 0) {
    const complete = Object.keys(result.completed).length === releaseContracts(version).size;
    const assemblyNeeded = result.release.draft || !result.state.github_release?.published ||
      (result.state.sparkle?.requested && !result.state.sparkle?.published);
    if (complete && assemblyNeeded) {
      console.log(`All packages are ready; dispatching ${result.release.draft ? "assembly" : "publication recovery"}.`);
      if (!dryRun) dispatchWorkflow("release-assemble.yml", {
        channel: result.state.channel,
        source_sha: result.state.source_sha,
        update_sparkle: result.state.sparkle.requested,
        version,
      });
    } else {
      console.log("No package workflow is currently dispatchable.");
    }
    return decisions;
  }
  console.log("\nDispatch plan:");
  for (const decision of decisions) console.log(`  ${decision.label}: build/resume via ${decision.workflow}`);
  if (!dryRun) for (const decision of decisions) dispatchWorkflow(decision.workflow, decision.fields);
  return decisions;
}

export function recordMacosSubmission(version, { dmgSha256, signedDmgRunId, sourceSha, submissionId }) {
  const release = getRelease(version);
  const state = readJsonAsset(release, STATE_ASSET);
  validateStateIdentity(state, { sourceSha, version });
  state.macos_notarization = {
    dmg_sha256: dmgSha256,
    signed_dmg_run_id: Number(signedDmgRunId),
    status: "submitted",
    submission_id: submissionId,
    submitted_at: new Date().toISOString(),
  };
  replaceReleaseState(version, state);
}

export function recordMacosSigned(version, { channel, dmgSha256, signedDmgRunId, sourceSha, updateSparkle, workflowSha }) {
  ensureDraftRelease({ channel, sourceSha, updateSparkle, version, workflowSha });
  const release = getRelease(version);
  const state = readJsonAsset(release, STATE_ASSET);
  validateStateIdentity(state, { sourceSha, version });
  state.macos_notarization = {
    dmg_sha256: dmgSha256,
    signed_at: new Date().toISOString(),
    signed_dmg_run_id: Number(signedDmgRunId),
    status: "signed",
  };
  replaceReleaseState(version, state);
}

export function markPublished(version, { githubPublished = false, sparklePublished = false } = {}) {
  const release = getRelease(version);
  const state = readJsonAsset(release, STATE_ASSET);
  if (githubPublished) state.github_release = { published: true, published_at: new Date().toISOString() };
  if (sparklePublished) state.sparkle = { ...state.sparkle, published: true, published_at: new Date().toISOString() };
  replaceReleaseState(version, state);
  return state;
}

export function replaceStagedAsset(version, { assetName, expectedOldSha }) {
  const release = getRelease(version);
  if (!release.draft) throw new Error("Staged assets can only be explicitly replaced while the release is a draft");
  const state = readJsonAsset(release, STATE_ASSET);
  validateStateIdentity(state, { version });
  if (!state.expected.includes(assetName)) throw new Error(`${assetName} is not in the release deliverable allowlist`);
  const asset = findAsset(release, assetName);
  if (!asset) throw new Error(`Staged asset is already absent: ${assetName}`);
  const actual = assetSha256(asset);
  if (actual !== expectedOldSha) throw new Error(`Expected old SHA256 ${expectedOldSha}, but ${assetName} is ${actual}`);
  const metadata = findAsset(release, `${assetName}${METADATA_SUFFIX}`);
  run("gh", ["api", "--method", "DELETE", `repos/${RELEASE_REPO}/releases/assets/${asset.id}`]);
  if (metadata) run("gh", ["api", "--method", "DELETE", `repos/${RELEASE_REPO}/releases/assets/${metadata.id}`]);
  const packageName = [...releaseContracts(version)].find(([, contract]) => contract.assets.includes(assetName))?.[0];
  if (packageName) delete state.completed[packageName];
  if (packageName === "macos-arm64") state.macos_notarization = {};
  replaceReleaseState(version, state);
  console.log(`Removed explicitly authorized draft asset ${assetName} and its metadata; the package is now missing.`);
}
