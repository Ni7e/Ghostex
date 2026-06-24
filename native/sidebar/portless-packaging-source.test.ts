import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const buildGhostexHostSource = readFileSync(
  new URL("../macos/ghostexHost/build-ghostex-host.sh", import.meta.url),
  "utf8",
);
const bundleValidatorSource = readFileSync(new URL("../../scripts/validate-macos-app-bundle.mjs", import.meta.url), "utf8");

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("Portless runtime packaging", () => {
  test("macOS build stages the published Portless CLI package without another Node runtime", () => {
    /*
    CDXC:PortlessPackaging 2026-06-22-22:30:
    Phase 2 packages the pinned published Portless dependency from node_modules/portless into Web/portless, requires dist/cli.js, and smoke-checks the staged CLI with CODE_SERVER_NODE_BIN. The build script must not add a Portless-local Node runtime because Portless runs with Web/code-server/lib/node.
    */
    const smokeCheck = sourceBetween(
      buildGhostexHostSource,
      "portless_staged_cli_smoke_check()",
      "package_portless_if_needed()",
    );
    const packagePortless = sourceBetween(
      buildGhostexHostSource,
      "package_portless_if_needed()",
      "resolve_beads_root()",
    );

    expect(packagePortless).toContain('local source_dir="$REPO_ROOT/node_modules/portless"');
    expect(packagePortless).toContain('local source_cli="$source_dir/dist/cli.js"');
    expect(packagePortless).toContain('local target_dir="$WEB_DIR/portless"');
    expect(packagePortless).toContain('if [[ ! -f "$source_cli" ]]');
    expect(packagePortless).toContain("dist/cli.js is required");
    expect(packagePortless).toContain('rsync -a --delete "$source_dir/" "$target_dir/"');
    expect(packagePortless).toContain('chmod 755 "$target_dir/dist/cli.js"');
    expect(packagePortless).toContain('portless_staged_cli_smoke_check "$target_dir"');
    expect(smokeCheck).toContain('PATH="$CODE_SERVER_NODE_DIR:$PATH" "$CODE_SERVER_NODE_BIN" "$target_dir/dist/cli.js" --help');
    expect(packagePortless).not.toContain('cp "$CODE_SERVER_NODE_BIN" "$target_dir');
    expect(packagePortless).not.toContain('"$target_dir/node"');
    expect(packagePortless).not.toContain('"$target_dir/bin/node"');
    expect(packagePortless).not.toContain('"$target_dir/lib/node"');
  });

  test("bundle validator requires Portless CLI payload and rejects Portless-local Node paths", () => {
    /*
    CDXC:PortlessPackaging 2026-06-22-22:30:
    App-bundle validation must fail if Web/portless/dist/cli.js is absent or if a duplicate node executable shape appears under Web/portless, while retaining the existing code-server runtime requirement for Web/code-server/lib/node.

    CDXC:ContributorStart 2026-06-22-23:23:
    Full Source-editor code-server files can be optional in contributor local starts, but the shared Web/code-server/lib/node runtime remains required because Portless and native helper scripts still launch through it.
    */
    const validateBundle = sourceBetween(
      bundleValidatorSource,
      "export async function validateMacosAppBundle",
      "function expectedNodePtyPrebuildForArch",
    );
    const portlessValidator = sourceBetween(
      bundleValidatorSource,
      "async function validateBundledPortlessRuntime",
      "async function validateBundledGxserverRuntime",
    );

    expect(validateBundle).toContain("await validateSharedCodeServerNodeRuntime({ arch, resourcesRoot });");
    expect(validateBundle).toContain("shouldValidateOptionalResource");
    expect(validateBundle).toContain("await validateBundledCodeServerRuntime({ arch, resourcesRoot, expectedNodePtyPrebuild });");
    expect(validateBundle).toContain("await validateBundledPortlessRuntime({ arch, resourcesRoot });");
    expect(portlessValidator).toContain('path.join(resourcesRoot, "portless")');
    expect(portlessValidator).toContain('path.join(portlessRoot, "dist", "cli.js")');
    expect(portlessValidator).toContain("bundled Portless CLI payload");
    expect(portlessValidator).toContain("assertNoBundledPortlessNodeRuntime");
    expect(portlessValidator).toContain('path.join(portlessRoot, "node")');
    expect(portlessValidator).toContain('path.join(portlessRoot, "bin", "node")');
    expect(portlessValidator).toContain("*/node_modules/node/bin/node");
    expect(portlessValidator).toContain("*/node_modules/.bin/node");
    expect(portlessValidator).toContain("*/bin/node");
    expect(portlessValidator).toContain("Web/code-server/lib/node");
    expect(portlessValidator).not.toContain("--help");
    expect(portlessValidator).not.toContain("runFile(");
  });
});
