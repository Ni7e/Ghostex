/*
 * Same-version amend of an existing public Ghostex release.
 *
 * This is the generalization of Android APK replacement: an explicitly
 * authorized run may add products the original scope skipped, or replace
 * products already on the tag. Unrelated live assets stay byte-identical.
 * The durable provenance record is merged, never rewritten from scratch.
 *
 * Pack dependencies (gxserver tarballs Windows/macOS/Linux embed) are brought
 * into the *build* scope so the platform job can stage them, but they are only
 * mutated when missing from the live release or when the operator selected them.
 */

import { PRODUCT_IDS, productDefinition } from "./product-inputs.mjs";
import {
  buildReleaseProvenanceRecord,
  compactPlanForRecord,
  renderBuildProvenanceNotes,
} from "./publish-provenance.mjs";
import { releaseProvenanceAssetName, validateReleaseProvenance } from "./provenance.mjs";

export const AMEND_EXISTING_WORKFLOW_FILE = "release-amend-existing.yml";

const SCOPE_FLAG_TO_PRODUCT = Object.freeze(
  Object.fromEntries(PRODUCT_IDS.map((productId) => [productDefinition(productId).scopeFlag, productId])),
);

export function productIdsFromScopeFlags(scope) {
  return PRODUCT_IDS.filter((productId) => Boolean(scope?.[productDefinition(productId).scopeFlag]));
}

export function packDependencies(productId) {
  productDefinition(productId);
  if (productId === "macos-arm64") return ["gxserver-linux-x64", "gxserver-linux-arm64"];
  if (productId === "linux-deb-x64" || productId === "linux-rpm-x64") return ["gxserver-linux-x64"];
  if (productId === "windows-x64" || productId === "gxserver-wsl-windows-x64") return ["gxserver-linux-x64"];
  if (productId === "windows-arm64" || productId === "gxserver-wsl-windows-arm64") return ["gxserver-linux-arm64"];
  return [];
}

export function companionProducts(productId) {
  productDefinition(productId);
  if (productId === "windows-x64") return ["gxserver-wsl-windows-x64"];
  if (productId === "windows-arm64") return ["gxserver-wsl-windows-arm64"];
  return [];
}

export function consumersOfGxserver(arch) {
  if (arch === "x64") return ["windows-x64", "gxserver-wsl-windows-x64", "linux-deb-x64", "linux-rpm-x64", "macos-arm64"];
  if (arch === "arm64") return ["windows-arm64", "gxserver-wsl-windows-arm64", "macos-arm64"];
  throw new Error(`Unknown gxserver architecture: ${arch}`);
}

function sortedProductIds(ids) {
  const wanted = new Set(ids);
  return PRODUCT_IDS.filter((productId) => wanted.has(productId));
}

/*
 * `selected` is the operator's mutate set. `liveProductIds` is what the existing
 * public provenance record already contains. Missing pack/companion products are
 * added to the mutate set so the first publication of Windows onto a macOS-only
 * tag also ships the WSL zips and, if needed, the gxserver archives.
 */
export function resolveAmendIntent({ liveProductIds, selected }) {
  const live = new Set(liveProductIds);
  const selectedIds = [...new Set(selected)].map((productId) => {
    productDefinition(productId);
    return productId;
  });
  if (selectedIds.length === 0) {
    throw new Error("Select at least one product to add or replace on the existing release");
  }

  const mutate = new Set(selectedIds);
  const scope = new Set(selectedIds);
  for (const productId of selectedIds) {
    for (const dependency of packDependencies(productId)) {
      scope.add(dependency);
      if (!live.has(dependency)) mutate.add(dependency);
    }
    for (const companion of companionProducts(productId)) {
      scope.add(companion);
      if (!live.has(companion)) mutate.add(companion);
    }
  }

  const mutateIds = sortedProductIds(mutate);
  for (const productId of mutateIds) {
    if (!productId.startsWith("gxserver-linux-")) continue;
    /* Replacing a live gxserver archive without rebuilding the packages that
     * embed it would desynchronize the tag. Adding a missing archive is the
     * opposite: it fills a hole the live consumers already name. */
    if (!live.has(productId)) continue;
    const arch = productId.slice("gxserver-linux-".length);
    for (const consumer of consumersOfGxserver(arch)) {
      if (live.has(consumer) && !mutate.has(consumer)) {
        throw new Error(
          `Amending ${productId} would desynchronize live ${consumer}, which embeds that archive. ` +
            `Select ${consumer} as well.`,
        );
      }
    }
  }

  const scopeFlags = {};
  for (const productId of PRODUCT_IDS) {
    scopeFlags[productDefinition(productId).scopeFlag] = scope.has(productId);
  }
  return {
    forceProducts: mutateIds,
    mutate: mutateIds,
    scope: sortedProductIds(scope),
    scopeFlags,
  };
}

export function artifactNamesForProduct(productId, version) {
  const product = productDefinition(productId);
  return {
    optional: product.optionalArtifacts?.(version) ?? [],
    required: product.artifacts(version),
  };
}

export function mutateArtifactNames({ mutate, version }) {
  const names = new Set();
  for (const productId of mutate) {
    const { required, optional } = artifactNamesForProduct(productId, version);
    for (const name of [...required, ...optional]) names.add(name);
  }
  names.add(releaseProvenanceAssetName(version));
  return names;
}

export function liveAssetDigestMap(assets) {
  const map = new Map();
  for (const asset of assets ?? []) {
    const digest =
      typeof asset.digest === "string" && asset.digest.startsWith("sha256:")
        ? asset.digest.slice("sha256:".length)
        : typeof asset.sha256 === "string"
          ? asset.sha256
          : "";
    map.set(asset.name, { digest, size: asset.size });
  }
  return map;
}

export function assertUnrelatedAssetsUnchanged({ afterAssets, beforeAssets, mutateNames }) {
  const before = liveAssetDigestMap(beforeAssets);
  const after = liveAssetDigestMap(afterAssets);
  const allowed = new Set(mutateNames);
  for (const [name, previous] of before) {
    if (allowed.has(name)) continue;
    const next = after.get(name);
    if (!next) throw new Error(`Unrelated release asset disappeared during amend: ${name}`);
    if (next.digest !== previous.digest) {
      throw new Error(`Unrelated release asset changed during amend: ${name}`);
    }
    if (previous.size !== undefined && next.size !== undefined && Number(next.size) !== Number(previous.size)) {
      throw new Error(`Unrelated release asset size changed during amend: ${name}`);
    }
  }
  for (const [name] of after) {
    if (before.has(name) || allowed.has(name)) continue;
    throw new Error(`Unexpected asset appeared during amend: ${name}`);
  }
}

export function assertLiveDependencyAlignment({ liveAssets, mutate, packedShaByName }) {
  const live = liveAssetDigestMap(liveAssets);
  const mutateSet = new Set(mutate);
  for (const [name, sha] of Object.entries(packedShaByName ?? {})) {
    const productId = name.startsWith("gxserver-linux-") ? name.replace(/\.tar\.gz$/u, "") : null;
    if (!productId || mutateSet.has(productId)) continue;
    const recorded = live.get(name);
    if (!recorded?.digest) {
      throw new Error(`${name} is packed into a mutated product but is not on the live release`);
    }
    if (recorded.digest !== sha) {
      throw new Error(
        `Packed ${name} digest ${sha.slice(0, 12)} does not match the live release ${recorded.digest.slice(0, 12)}`,
      );
    }
  }
}

function replaceOrAppendSection(body, headingPattern, headingLine, contentLines) {
  const block = [headingLine, "", ...contentLines, ""].join("\n");
  if (headingPattern.test(body)) {
    return body.replace(headingPattern, block.trimEnd());
  }
  return `${body.trimEnd()}\n\n${block}`;
}

function platformSectionPattern(platform) {
  const escaped = platform.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`### ${escaped}\\n\\n(?:- \`[^\`]+ \` — SHA256 \`[0-9a-f]{64}\`\\n)+`, "u");
}

export function checksumLine(name, sha256) {
  return `- \`${name}\` — SHA256 \`${sha256}\``;
}

export function mergeReleaseNotes({
  liveBody,
  mutatedManifests,
  provenanceAssetName,
  provenanceNotes,
  provenanceSha,
}) {
  let body = String(liveBody ?? "").replaceAll("\r\n", "\n").trimEnd();
  if (!body) throw new Error("Existing release notes are empty");

  const platformBlocks = [...mutatedManifests]
    .sort((left, right) => left.platform.localeCompare(right.platform))
    .map((manifest) => {
      const lines = (manifest.artifacts ?? []).map((artifact) => checksumLine(artifact.name, artifact.sha256));
      return { lines, platform: manifest.platform };
    });

  if (!/^## Downloads\s*$/mu.test(body)) {
    const downloadLines = ["## Downloads", ""];
    for (const block of platformBlocks) {
      downloadLines.push(`### ${block.platform}`, "", ...block.lines, "");
    }
    downloadLines.push("### provenance", "", checksumLine(provenanceAssetName, provenanceSha), "");
    body = `${body}\n\n${downloadLines.join("\n")}`;
  } else {
    for (const block of platformBlocks) {
      const section = [`### ${block.platform}`, "", ...block.lines, ""].join("\n");
      const pattern = platformSectionPattern(block.platform);
      if (pattern.test(body)) body = body.replace(pattern, section);
      else {
        body = body.replace(
          /(### provenance\n)/u,
          `${section}\n$1`,
        );
        if (!body.includes(`### ${block.platform}\n`)) {
          body = `${body.trimEnd()}\n\n${section}`;
        }
      }
    }
    const provenanceLine = checksumLine(provenanceAssetName, provenanceSha);
    const provenancePattern = new RegExp(
      `- \`${provenanceAssetName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\` — SHA256 \`[0-9a-f]{64}\``,
      "u",
    );
    if (provenancePattern.test(body)) body = body.replace(provenancePattern, provenanceLine);
    else {
      body = replaceOrAppendSection(
        body,
        /### provenance\n\n(?:- `[^`]+` — SHA256 `[0-9a-f]{64}`\n)+/u,
        "### provenance",
        [provenanceLine],
      );
    }
  }

  if (provenanceNotes) {
    body = replaceOrAppendSection(
      body,
      /## Build provenance\n[\s\S]*$/u,
      "## Build provenance",
      provenanceNotes.replace(/^## Build provenance\n\n/u, "").trimEnd().split("\n"),
    );
  }
  return `${body.trimEnd()}\n`;
}

export function mergeAmendProvenance({
  amendPlan,
  live,
  mutatedRecords,
  publishedAt,
  sourceSha,
  version,
  workflowRunId,
}) {
  const published = validateReleaseProvenance(live);
  if (published.version !== version || published.tag !== `v${version}`) {
    throw new Error(`Live provenance describes ${published.tag}, not v${version}`);
  }
  const products = { ...published.products, ...mutatedRecords };
  const ordered = {};
  for (const productId of PRODUCT_IDS) {
    if (products[productId]) ordered[productId] = products[productId];
  }

  const livePlan = published.plan ?? {};
  const livePlanProducts = { ...(livePlan.products ?? {}) };
  for (const [productId, entry] of Object.entries(amendPlan.products ?? {})) {
    if (entry.action !== "skip") livePlanProducts[productId] = entry;
  }
  const expectedPlatforms = PRODUCT_IDS.filter((productId) => ordered[productId]);
  const mergedPlan = compactPlanForRecord({
    ...livePlan,
    ...amendPlan,
    expectedPlatforms,
    products: livePlanProducts,
    scope: {
      ...(livePlan.scope ?? {}),
      ...(amendPlan.scope ?? {}),
    },
    sourceSha,
  });

  return buildReleaseProvenanceRecord({
    plan: mergedPlan,
    productRecords: ordered,
    publishedAt,
    sourceSha,
    version,
    workflowRunId,
  });
}

export function scopeEnvFromFlags(scopeFlags) {
  return {
    GHOSTEX_RELEASE_ANDROID: String(Boolean(scopeFlags.android)),
    GHOSTEX_RELEASE_GXSERVER_LINUX_ARM64: String(Boolean(scopeFlags.gxserverLinuxArm64)),
    GHOSTEX_RELEASE_GXSERVER_LINUX_X64: String(Boolean(scopeFlags.gxserverLinuxX64)),
    GHOSTEX_RELEASE_GXSERVER_WSL_WINDOWS_ARM64: String(Boolean(scopeFlags.gxserverWslWindowsArm64)),
    GHOSTEX_RELEASE_GXSERVER_WSL_WINDOWS_X64: String(Boolean(scopeFlags.gxserverWslWindowsX64)),
    GHOSTEX_RELEASE_LINUX_DEB: String(Boolean(scopeFlags.linuxDeb)),
    GHOSTEX_RELEASE_LINUX_RPM: String(Boolean(scopeFlags.linuxRpm)),
    GHOSTEX_RELEASE_MACOS: String(Boolean(scopeFlags.macos)),
    GHOSTEX_RELEASE_WINDOWS_ARM64: String(Boolean(scopeFlags.windowsArm64)),
    GHOSTEX_RELEASE_WINDOWS_X64: String(Boolean(scopeFlags.windowsX64)),
  };
}

export function githubOutputsForIntent(intent, { updateSparkle, version }) {
  const sparkle = Boolean(updateSparkle) && intent.mutate.includes("macos-arm64");
  return {
    amend_products: intent.mutate.join(","),
    expected_platforms: intent.scope.join(","),
    force_products: intent.forceProducts.join(","),
    update_sparkle: String(sparkle),
    version,
    ...Object.fromEntries(
      Object.entries(intent.scopeFlags).map(([flag, enabled]) => [flag, String(Boolean(enabled))]),
    ),
  };
}

export { SCOPE_FLAG_TO_PRODUCT, renderBuildProvenanceNotes, releaseProvenanceAssetName };
