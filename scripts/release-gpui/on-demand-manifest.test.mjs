import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { buildOnDemandManifestV2, validateOnDemandManifestV2 } from "./on-demand-manifest.mjs";
import {
  componentAssetsFromDirectory,
  planComponentRelease,
  sha256File,
  verifyPublishedComponent,
} from "./publish-component.mjs";
import { validateMacosAppBundle } from "../validate-macos-app-bundle.mjs";

const digest = "a".repeat(64);

function manifest() {
  return buildOnDemandManifestV2({
    version: "6.13.0",
    assets: {
      "gxserver-linux-arm64": { bytes: 123, name: "gxserver-linux-arm64.tar.gz", sha256: digest },
    },
    components: {
      cef: {
        name: "cef",
        componentVersion: "138.0.1",
        downloadTag: "cef-138.0.1",
        platforms: {
          "darwin-arm64": { assetName: "cef-138.0.1-darwin-arm64.tar.gz", sha256: digest, sizeBytes: 456 },
        },
      },
    },
  });
}

describe("on-demand manifest v2", () => {
  test("accepts release assets and versioned components", () => {
    expect(validateOnDemandManifestV2(manifest()).schemaVersion).toBe(2);
  });

  test("rejects malformed component data instead of dropping it", () => {
    const malformed = manifest();
    malformed.components.cef.platforms["darwin-arm64"].sha256 = "bad";
    expect(() => validateOnDemandManifestV2(malformed)).toThrow(/sha256/);
  });

  test("rejects component tags and asset names that do not match the immutable naming contract", () => {
    const malformedTag = manifest();
    malformedTag.components.cef.downloadTag = "cef-latest";
    expect(() => validateOnDemandManifestV2(malformedTag)).toThrow(/downloadTag must equal cef-138\.0\.1/);

    const malformedAsset = manifest();
    malformedAsset.components.cef.platforms["darwin-arm64"].assetName = "cef.tar.gz";
    expect(() => validateOnDemandManifestV2(malformedAsset)).toThrow(
      /assetName must equal cef-138\.0\.1-darwin-arm64\.tar\.gz/,
    );
  });
});

describe("component-tag publisher idempotency", () => {
  test("creates identical component archives from identical files with different mtimes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ghostex-deterministic-component-"));
    const first = path.join(root, "first");
    const second = path.join(root, "second");
    await mkdir(first);
    await mkdir(second);
    await writeFile(path.join(first, "payload"), "same bytes");
    await writeFile(path.join(second, "payload"), "same bytes");
    await utimes(path.join(first, "payload"), new Date("2024-01-01"), new Date("2024-01-01"));
    await utimes(path.join(second, "payload"), new Date("2026-01-01"), new Date("2026-01-01"));
    const script = path.resolve("scripts/release-gpui/create-deterministic-tar.sh");
    const firstArchive = path.join(root, "first.tar.gz");
    const secondArchive = path.join(root, "second.tar.gz");
    execFileSync(script, [first, firstArchive]);
    execFileSync(script, [second, secondArchive]);
    expect(sha256File(firstArchive)).toBe(sha256File(secondArchive));
  });

  test("plans create-if-missing, no-op-if-matching, and error-if-sha-mismatch", async () => {
    const assetDir = await mkdtemp(path.join(tmpdir(), "ghostex-component-publisher-"));
    await writeFile(path.join(assetDir, "cef-138.0.1-darwin-arm64.tar.gz"), "fake-cef");
    const assets = componentAssetsFromDirectory({ assetDir, component: "cef", componentVersion: "138.0.1" });

    expect(planComponentRelease({ assets, release: { exists: false, assets: [] } })).toMatchObject({
      createRelease: true,
      uploads: assets,
    });
    expect(
      planComponentRelease({
        assets,
        release: { exists: true, assets: [{ name: assets[0].assetName, size: assets[0].sizeBytes, digest: `sha256:${assets[0].sha256}` }] },
      }),
    ).toMatchObject({ createRelease: false, noops: assets, uploads: [] });
    expect(() =>
      planComponentRelease({
        assets,
        release: { exists: true, assets: [{ name: assets[0].assetName, size: assets[0].sizeBytes, digest: `sha256:${"b".repeat(64)}` }] },
      }),
    ).toThrow(/Refusing to replace/);
  });

  test("reports missing and mismatched component tags with the publisher fix command", () => {
    const component = manifest().components.cef;
    expect(() => verifyPublishedComponent({ component, release: { exists: false, assets: [] } })).toThrow(
      /Fix: bun run release:component -- --component cef --version 138\.0\.1/,
    );
    expect(() =>
      verifyPublishedComponent({
        component,
        release: {
          exists: true,
          assets: [{
            name: component.platforms["darwin-arm64"].assetName,
            size: component.platforms["darwin-arm64"].sizeBytes,
            digest: `sha256:${"b".repeat(64)}`,
          }],
        },
      }),
    ).toThrow(/mismatched size\/digest.*Fix: publish a newly versioned component/s);
  });
});

describe("macOS release bundle shape", () => {
  test("rejects a legacy-shaped bundle before architecture checks", async () => {
    const appPath = await mkdtemp(path.join(tmpdir(), "ghostex-legacy-app-"));
    await mkdir(path.join(appPath, "Contents", "Resources", "Web", "code-server"), { recursive: true });
    await mkdir(path.join(appPath, "Contents", "Frameworks", "Chromium Embedded Framework.framework"), {
      recursive: true,
    });
    await expect(validateMacosAppBundle({ appPath, arch: "arm64" })).rejects.toThrow(
      /must contain a sealed on-demand manifest v2.*legacy bundles are not valid release output/,
    );
  });
});
