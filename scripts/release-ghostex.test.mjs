import { describe, expect, test } from "vitest";
import {
  ReleaseError,
  buildGithubReleaseNotes,
  isHomebrewHostToolchainVersionError,
  renderGhostexCask,
  renderGhostexCaskForTap,
  selectLatestAndroidBuildTool,
  validateGhostexCask,
  validateMajorMinorReleaseNotes,
} from "./release-ghostex.mjs";

const sha256 = "b".repeat(64);

const liveCaskShape = `cask "ghostex" do
  version "4.12.0"
  sha256 "b99f5983287746d9a7b8d8d05c9aaafbcf1b2ea11e09be22df69d5db8dbab2a2"

  url "https://github.com/maddada/Ghostex/releases/download/v#{version}/ghostex-#{version}-arm64.dmg"
  name "Ghostex"
  desc "Workspace and session UI for agent terminals"
  homepage "https://github.com/maddada/Ghostex"

  conflicts_with cask: "zmux"
  depends_on arch: :arm64
  depends_on macos: :ventura

  app "ghostex.app"

  preflight do
    commands = ["ghostex", "gx"]
    commands.each do |command|
      command_candidates = [HOMEBREW_PREFIX/"bin/#{command}"]
      ENV.fetch("PATH", "").split(File::PATH_SEPARATOR).each do |entry|
        command_candidates << (Pathname(entry)/command) unless entry.empty?
      end

      command_candidates.uniq.each do |command_path|
        next if [command_path.exist?, command_path.symlink?].none?

        command_target = command_path.symlink? ? command_path.readlink.to_s : command_path.to_s
        next if command_target.include?("ghostex.app/Contents/Resources/CLI/#{command}")
        next if command_target.include?("ghostex.app/Contents/Resources/Web/cli/#{command}")
      end
    end
  end

  zap trash: [
    "~/Library/Application Support/com.madda.zmux.host",
  ]
end
`;

describe("Ghostex release automation helpers", () => {
  test("renders a deterministic arm64-only Homebrew cask from the live cask shape", () => {
    /*
     * CDXC:ReleaseAutomation 2026-06-14-09:07:
     * The release script must accept the live cask's old Web/cli compatibility
     * guard while rendering a canonical arm64-only wrapper cask. The guard is
     * compatibility text, not a legacy distribution stanza.
     */
    const cask = renderGhostexCaskForTap(liveCaskShape, {
      sha256,
      version: "4.13.0",
    });

    expect(validateGhostexCask(cask, { sha256, version: "4.13.0" })).toBe(true);
    expect(cask).toContain('version "4.13.0"');
    expect(cask).toContain(`sha256 "${sha256}"`);
    expect(cask).toContain("preflight do");
    expect(cask).toContain("postflight do");
    expect(cask).toContain("uninstall_preflight do");
    expect(cask).toContain("depends_on arch: :arm64");
    expect(cask).toContain("depends_on macos: :ventura");
    expect(cask).toContain('next if command_target.include?("ghostex.app/Contents/Resources/Web/cli/#{command}")');
    expect(cask).not.toMatch(/^\s*binary\s+"/m);
    expect(cask).not.toContain("x86_64");
    expect(cask).not.toContain("#{arch}");
    expect(cask).not.toContain("intel:");
  });

  test("rejects Homebrew casks that reintroduce binary aliases", () => {
    const cask = `${renderGhostexCask({ sha256, version: "4.13.0" })}
  binary "#{appdir}/ghostex.app/Contents/Resources/CLI/ghostex"
`;

    expect(() => validateGhostexCask(cask, { sha256, version: "4.13.0" })).toThrow(
      ReleaseError,
    );
  });

  test("builds final GitHub notes with Major and Minor changes plus Android checksum", async () => {
    const notes = await buildGithubReleaseNotes(
      "4.12.0",
      [
        {
          arch: "arm64",
          finalDmg: "/tmp/ghostex-4.12.0-arm64.dmg",
          sha256: "a".repeat(64),
        },
      ],
      {
        androidArtifact: {
          name: "ghostex-android.apk",
          sha256,
        },
      },
    );

    expect(notes).toContain("- Major\n  - ");
    expect(notes).toContain("- Minor\n  - ");
    expect(notes).toContain("- Android");
    expect(notes).toContain("`ghostex-android.apk`");
    expect(notes).toContain(`SHA256: \`${sha256}\``);
  });

  test("requires Major and Minor to be the only top-level changelog bullets", () => {
    expect(() =>
      validateMajorMinorReleaseNotes("- Fixed a thing\n- Minor\n  - Polish", "9.9.9"),
    ).toThrow(ReleaseError);
    expect(() =>
      validateMajorMinorReleaseNotes("- Major\n  - Big\n- Minor\n  - Small", "9.9.9"),
    ).not.toThrow();
  });

  test("selects the latest Android build tool without GNU sort", () => {
    expect(
      selectLatestAndroidBuildTool(
        [
          "/sdk/build-tools/9.0.0/apksigner",
          "/sdk/build-tools/35.0.0/apksigner",
          "/sdk/build-tools/34.0.0/apksigner",
          "",
        ],
        "apksigner",
      ),
    ).toBe("/sdk/build-tools/35.0.0/apksigner");
  });

  test("detects Homebrew host toolchain version diagnostics narrowly", () => {
    /*
     * CDXC:ReleaseAutomation 2026-06-16-20:32:
     * Release automation may skip only local Homebrew validation commands that
     * are blocked by the host's Xcode/CLT minimum-version diagnostic. Other
     * Homebrew failures must still fail so cask mistakes do not ship.
     */
    expect(
      isHomebrewHostToolchainVersionError(
        "Error: Your Xcode (26.5) at /Applications/Xcode.app is too outdated.",
      ),
    ).toBe(true);
    expect(
      isHomebrewHostToolchainVersionError("Error: Your Command Line Tools are too outdated."),
    ).toBe(true);
    expect(
      isHomebrewHostToolchainVersionError(
        [
          "Command failed (1): HOMEBREW_NO_INSTALL_FROM_API=1 brew audit --cask --skip-style 'Casks/ghostex.rb'",
          "Error: Your Xcode (26.5) at /Applications/Xcode.app is too outdated.",
          "Error: Your Command Line Tools are too outdated.",
        ].join("\n"),
      ),
    ).toBe(true);
    expect(isHomebrewHostToolchainVersionError("Error: Cask is missing a sha256.")).toBe(false);
  });
});
