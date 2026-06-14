import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");
const releaseGhostexSource = readFileSync(new URL("../../scripts/release-ghostex.mjs", import.meta.url), "utf8");

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("Ghostex CLI command wrappers", () => {
  test("native startup writes PATH wrapper files instead of app-bundled symlinks", () => {
    /*
     * CDXC:CliInstall 2026-06-12-09:31:
     * Public ghostex/gx commands must be executable wrapper files outside
     * Ghostex.app so macOS does not directly execute sealed app-bundled shell
     * scripts and kill the process during syspolicyd assessment.
     */
    const installer = sourceBetween(
      nativeSidebarSource,
      "function getNativeGhostexCliCommandInstallNodeScript",
      "async function installNativeBrowserControlSkill",
    );

    expect(installer).toContain("const cliScriptPath = path.join(cliDir, \"ghostex-cli.mjs\")");
    expect(installer).toContain("function commandWrapperContent()");
    expect(installer).toContain("CDXC:CliInstall 2026-06-12-09:31");
    expect(installer).toContain("exec /usr/bin/env node ");
    expect(installer).toContain("function clearMacosExecutionPolicyXattrs(filePath)");
    expect(installer).toContain('"com.apple.provenance", "com.apple.quarantine"');
    expect(installer).toContain("fs.writeFileSync(linkPath, wrapper, { mode: 0o755 })");
    expect(installer).toContain("isGhostexWrapperFile(filePath)");
    expect(installer).not.toContain("fs.symlinkSync(target, linkPath)");
  });

  test("native status treats Ghostex-owned wrappers as usable commands", () => {
    /*
     * CDXC:CliInstall 2026-06-12-09:31:
     * Settings and first launch status must recognize the wrapper command
     * shape after startup repairs old Ghostex-owned symlinks.
     */
    const statusScript = sourceBetween(
      nativeSidebarSource,
      "function getNativeGhostexCliStatusNodeScript",
      "function createNativeAgentHookStatusErrorMessage",
    );

    expect(statusScript).toContain("function isGhostexCommandWrapper(filePath)");
    expect(statusScript).toContain("CDXC:CliInstall 2026-06-12-09:31");
    expect(statusScript).toContain(
      'const ghostexUsable = isGhostexCommandWrapper(ghostexPath) || isGhostexCommandRealpath(ghostexRealpath, "ghostex")',
    );
    expect(statusScript).toContain(
      'const gxUsable = isGhostexCommandWrapper(gxPath) || isGhostexCommandRealpath(gxRealpath, "gx")',
    );
  });

  test("Homebrew cask generation installs wrappers instead of CLI binary aliases", () => {
    /*
     * CDXC:CliInstall 2026-06-12-09:31:
     * Release automation must not reintroduce Homebrew binary stanzas for
     * ghostex/gx, because those stanzas create symlinks back into Ghostex.app.
     */
    const renderer = sourceBetween(
      releaseGhostexSource,
      "function renderGhostexCaskForTap",
      "async function main",
    );

    expect(renderer).toContain("function renderGhostexCask");
    expect(renderer).toContain("function validateGhostexCask");
    expect(renderer).toContain("postflight do");
    expect(renderer).toContain("command_path.write <<~EOS");
    expect(renderer).toContain('exec /usr/bin/env node "#{cli_script}" "$@"');
    expect(renderer).toContain('system "/usr/bin/xattr", "-d", attribute, command_path.to_s');
    expect(renderer).toContain("uninstall_preflight do");
    expect(renderer).toContain("Ghostex cask must install wrapper files, not Homebrew binary aliases.");
    expect(releaseGhostexSource).toContain("--except-cops Homebrew/OSDependsOn");
    expect(releaseGhostexSource).toContain('depends_on macos: ">= :ventura"');
    expect(releaseGhostexSource).not.toContain(
      '.replace(/^  depends_on macos: ">= :ventura"$/m, "  depends_on macos: :ventura")',
    );
    expect(renderer).not.toContain("const ghostexBinary");
    expect(renderer).not.toContain("const gxBinary");
  });
});
