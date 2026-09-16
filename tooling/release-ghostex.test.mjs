import { describe, expect, test } from 'vitest';
import {
  ReleaseError,
  buildGithubReleaseNotes,
  changelogNotesFormat,
  changelogNotesItems,
  extractChangelogSectionFromText,
  isHomebrewHostToolchainVersionError,
  missingRemoteGxserverLinuxPackageResources,
  onDemandAssetNames,
  releaseBuildVersion,
  releasePhaseNames,
  renderGhostexCask,
  renderGhostexCaskForTap,
  selectLatestAndroidBuildTool,
  validateGhostexCask,
  validateMajorMinorReleaseNotes,
} from './release-ghostex.mjs';

const sha256 = 'b'.repeat(64);

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

describe('Ghostex release automation helpers', () => {
  test('renders a deterministic arm64-only Homebrew cask from the live cask shape', () => {
    /*
     * CDXC:Release 2026-06-14-09:07:
     * The release script must accept the live cask's old Web/cli compatibility
     * guard while rendering a canonical arm64-only wrapper cask. The guard is
     * compatibility text, not a legacy distribution stanza.
     */
    const cask = renderGhostexCaskForTap(liveCaskShape, {
      sha256,
      version: '4.13.0',
    });

    expect(validateGhostexCask(cask, { sha256, version: '4.13.0' })).toBe(true);
    expect(cask).toContain('version "4.13.0"');
    expect(cask).toContain(`sha256 "${sha256}"`);
    expect(cask).toContain('preflight do');
    expect(cask).toContain('postflight do');
    expect(cask).toContain('uninstall_preflight do');
    expect(cask).toContain('depends_on arch: :arm64');
    expect(cask).toContain('depends_on macos: :ventura');
    expect(cask).toContain('next if command_target.include?("ghostex.app/Contents/Resources/Web/cli/#{command}")');
    expect(cask).not.toMatch(/^\s*binary\s+"/m);
    expect(cask).not.toContain('x86_64');
    expect(cask).not.toContain('#{arch}');
    expect(cask).not.toContain('intel:');
  });

  test('rejects Homebrew casks that reintroduce binary aliases', () => {
    const cask = `${renderGhostexCask({ sha256, version: '4.13.0' })}
  binary "#{appdir}/ghostex.app/Contents/Resources/CLI/ghostex"
`;

    expect(() => validateGhostexCask(cask, { sha256, version: '4.13.0' })).toThrow(ReleaseError);
  });

  test('builds final GitHub notes with Major, Minor, and Android checksum', async () => {
    const notes = await buildGithubReleaseNotes(
      '4.12.0',
      [
        {
          arch: 'arm64',
          finalDmg: '/tmp/ghostex-4.12.0-arm64.dmg',
          sha256: 'a'.repeat(64),
        },
      ],
      {
        androidArtifact: {
          name: 'ghostex-android.apk',
          sha256,
        },
      }
    );

    expect(notes).toContain('- Major\n  - ');
    expect(notes).toContain('- Minor\n  - ');
    expect(notes).toContain('- Android');
    expect(notes).toContain('`ghostex-android.apk`');
    expect(notes).toContain(`SHA256: \`${sha256}\``);
  });

  test('allows Major, Minor, and GPUI as changelog top-level bullets', () => {
    expect(() => validateMajorMinorReleaseNotes('- Fixed a thing\n- Minor\n  - Polish', '9.9.9')).toThrow(ReleaseError);
    expect(() => validateMajorMinorReleaseNotes('- Major\n  - Big\n- Minor\n  - Small', '9.9.9')).not.toThrow();
    expect(() =>
      validateMajorMinorReleaseNotes('- Major\n  - Big\n- Minor\n  - Small\n- GPUI\n  - Cross-platform work.', '9.9.9')
    ).not.toThrow();
    expect(() =>
      validateMajorMinorReleaseNotes('- Major\n  - Big\n- GPUI\n  - Cross-platform work.\n- Minor\n  - Small', '9.9.9')
    ).toThrow(ReleaseError);
  });

  test('requires every release-note item to occupy one physical bullet line', () => {
    expect(() =>
      validateMajorMinorReleaseNotes(
        '- Major\n  - Session Chat controls.\n    Includes model and reasoning controls.\n- Minor\n  - Smaller fix.',
        '9.9.9'
      )
    ).toThrow(/every change item on one physical/u);
    expect(() => validateMajorMinorReleaseNotes('- Major\n  - \n- Minor\n  - Smaller fix.', '9.9.9')).toThrow(
      /every change item on one physical/u
    );
  });

  test('accepts the emoji-headed changelog format with flat items', () => {
    const headed = [
      '### ✨ New Features',
      '',
      '- One user-facing sentence per item.',
      '- Another item.',
      '',
      '### 🚀 Major Improvements',
      '',
      '- Item.',
      '',
      '### 🔧 Minor Improvements',
      '',
      '- Item.',
      '',
      '### 🩹 Stabilization',
      '',
      '- Item.',
    ].join('\n');
    expect(() => validateMajorMinorReleaseNotes(headed, '9.8.0')).not.toThrow();
    expect(() => validateMajorMinorReleaseNotes('### 🩹 Stabilization\n\n- Only a fix.', '9.8.0')).not.toThrow();
    expect(() =>
      validateMajorMinorReleaseNotes('### ✨ New Features\n- Feature.\n### 🩹 Stabilization\n- Fix.', '9.8.0')
    ).not.toThrow();
    expect(changelogNotesFormat(headed)).toBe('headed');
    expect(changelogNotesItems(headed)).toEqual([
      'One user-facing sentence per item.',
      'Another item.',
      'Item.',
      'Item.',
      'Item.',
    ]);
  });

  test('rejects malformed emoji-headed changelog sections with a precise reason', () => {
    expect(() =>
      validateMajorMinorReleaseNotes('### 🩹 Stabilization\n- Fix.\n### ✨ New Features\n- Feature.', '9.8.0')
    ).toThrow(/order; ### ✨ New Features cannot follow ### 🩹 Stabilization/u);
    expect(() =>
      validateMajorMinorReleaseNotes('### ✨ New Features\n- One.\n### ✨ New Features\n- Two.', '9.8.0')
    ).toThrow(/repeats the ### ✨ New Features heading/u);
    expect(() =>
      validateMajorMinorReleaseNotes('### ✨ New Features\n\n### 🩹 Stabilization\n- Fix.', '9.8.0')
    ).toThrow(/no items under ### ✨ New Features/u);
    expect(() => validateMajorMinorReleaseNotes('### ✨ New Features\n- One.\n### 🩹 Stabilization', '9.8.0')).toThrow(
      /no items under ### 🩹 Stabilization/u
    );
    expect(() => validateMajorMinorReleaseNotes('### ✨ New Features\n- One.\n  - Nested.', '9.8.0')).toThrow(
      /one physical `- ` line at column 0 under ### ✨ New Features; found `  - Nested\.`/u
    );
    expect(() =>
      validateMajorMinorReleaseNotes('### ✨ New Features\n- Session Chat controls.\n  Includes wrapping.', '9.8.0')
    ).toThrow(/found `  Includes wrapping\.`/u);
    expect(() => validateMajorMinorReleaseNotes('### ✨ New Features\n- ', '9.8.0')).toThrow(/found `- `/u);
    expect(() => validateMajorMinorReleaseNotes('### ✨ New Features\n- One.\n- Major\n  - Big.', '9.8.0')).toThrow(
      /must not mix .* with the `- Major` bullet heading/u
    );
    expect(() =>
      validateMajorMinorReleaseNotes('### ✨ New Features\n- One.\n- Stabilization\n  - Fix.', '9.8.0')
    ).toThrow(/with the `- Stabilization` bullet heading/u);
    expect(() => validateMajorMinorReleaseNotes('- Loose item.\n### ✨ New Features\n- One.', '9.8.0')).toThrow(
      /must start with one of .*; its first line is `- Loose item\.`/u
    );
    expect(() => validateMajorMinorReleaseNotes('### New Features\n- One.', '9.8.0')).toThrow(
      /unknown group heading `### New Features`/u
    );
    expect(() => validateMajorMinorReleaseNotes('## ✨ New Features\n- One.', '9.8.0')).toThrow(
      /unknown group heading `## ✨ New Features`/u
    );
  });

  test('keeps both bullet changelog formats valid and lists their items without headings', () => {
    const bullets = '- New Features\n\n  - Feature one.\n\n- Stabilization\n\n  - Fix one.';
    expect(() => validateMajorMinorReleaseNotes(bullets, '9.7.0')).not.toThrow();
    expect(changelogNotesFormat(bullets)).toBe('bullets');
    expect(changelogNotesItems(bullets)).toEqual(['Feature one.', 'Fix one.']);
    const legacy = '- Major\n  - Big.\n- Minor\n  - Small.';
    expect(changelogNotesFormat(legacy)).toBe('legacy');
    expect(changelogNotesItems(legacy)).toEqual(['Big.', 'Small.']);
    expect(() => validateMajorMinorReleaseNotes('- New Features\n  - One.\n- Major\n  - Big.', '9.7.0')).toThrow(
      /must not mix Major\/Minor headings/u
    );
  });

  test('selects the latest Android build tool without GNU sort', () => {
    expect(
      selectLatestAndroidBuildTool(
        [
          '/sdk/build-tools/9.0.0/apksigner',
          '/sdk/build-tools/35.0.0/apksigner',
          '/sdk/build-tools/34.0.0/apksigner',
          '',
        ],
        'apksigner'
      )
    ).toBe('/sdk/build-tools/35.0.0/apksigner');
  });

  test('detects Homebrew host toolchain version diagnostics narrowly', () => {
    /*
     * CDXC:Release 2026-06-16-20:32:
     * Release automation may skip only local Homebrew validation commands that
     * are blocked by the host's Xcode/CLT minimum-version diagnostic. Other
     * Homebrew failures must still fail so cask mistakes do not ship.
     */
    expect(
      isHomebrewHostToolchainVersionError('Error: Your Xcode (26.5) at /Applications/Xcode.app is too outdated.')
    ).toBe(true);
    expect(isHomebrewHostToolchainVersionError('Error: Your Command Line Tools are too outdated.')).toBe(true);
    expect(
      isHomebrewHostToolchainVersionError(
        [
          "Command failed (1): HOMEBREW_NO_INSTALL_FROM_API=1 brew audit --cask --skip-style 'Casks/ghostex.rb'",
          'Error: Your Xcode (26.5) at /Applications/Xcode.app is too outdated.',
          'Error: Your Command Line Tools are too outdated.',
        ].join('\n')
      )
    ).toBe(true);
    expect(isHomebrewHostToolchainVersionError('Error: Cask is missing a sha256.')).toBe(false);
  });

  test('extracts a changelog section between headings and rejects comment-bearing sections', () => {
    const changelog = [
      '# Changelog',
      '',
      '## 9.9.9 - 2026-07-02',
      '',
      '- Major',
      '  - Big improvement.',
      '- Minor',
      '  - Small polish.',
      '',
      '## 9.9.8 - 2026-06-20',
      '',
      '- Major',
      '  - Older change.',
      '- Minor',
      '  - Older polish.',
    ].join('\n');

    const notes = extractChangelogSectionFromText(changelog, '9.9.9');
    expect(notes).toContain('Big improvement.');
    expect(notes).not.toContain('Older change.');
    /* `###` group headings must not end the section the way `## ` version headings do. */
    const headed = extractChangelogSectionFromText(
      [
        '# Changelog',
        '',
        '## 9.8.0 - 2026-09-20',
        '',
        '### ✨ New Features',
        '',
        '- Feature.',
        '',
        '### 🩹 Stabilization',
        '',
        '- Fix.',
        '',
        ...changelog.split('\n').slice(2),
      ].join('\n'),
      '9.8.0'
    );
    expect(headed).toBe('### ✨ New Features\n\n- Feature.\n\n### 🩹 Stabilization\n\n- Fix.');
    expect(() => extractChangelogSectionFromText(changelog, '1.0.0')).toThrow(ReleaseError);
    expect(() =>
      extractChangelogSectionFromText(
        '## 9.9.9 - 2026-07-02\n\n<!-- CDXC: hidden -->\n- Major\n  - X\n- Minor\n  - Y\n',
        '9.9.9'
      )
    ).toThrow(ReleaseError);
  });

  test('lists on-demand component checksums in GitHub release notes', async () => {
    /*
     * buildGithubReleaseNotes reads the real CHANGELOG.md, so use a version
     * that has already shipped (same approach as the Android notes test).
     */
    const notes = await buildGithubReleaseNotes(
      '5.4.0',
      [{ arch: 'arm64', finalDmg: '/tmp/ghostex-5.4.0-arm64.dmg', sha256: 'a'.repeat(64) }],
      {
        onDemandAssets: onDemandAssetNames.map((name) => ({ name, sha256: 'c'.repeat(64) })),
      }
    );

    expect(notes).toContain('## On-demand components');
    for (const name of onDemandAssetNames) {
      expect(notes).toContain(`\`${name}\``);
    }
    expect(notes).toContain(`SHA256: \`${'c'.repeat(64)}\``);
    /*
     * The install section must stay last so the on-demand block does not
     * displace the brew command users copy.
     */
    expect(notes.indexOf('## On-demand components')).toBeLessThan(notes.indexOf('## Install'));
  });

  test('keeps the resumable phase order stable for --from/--only', () => {
    expect(releasePhaseNames).toEqual([
      'preflight',
      'prepare-remote-linux',
      'publish-macos',
      'publish-android',
      'publish-homebrew',
      'verify-live',
    ]);
    expect(releaseBuildVersion('5.5.0')).toBe(50500);
  });

  test('requires complete remote Ubuntu gxserver package resources for release', () => {
    /*
     * CDXC:RemotePairing 2026-06-29-19:45:
     * Release automation must prove the prebuilt Ubuntu remote gxserver package
     * contains every runtime resource that macOS app packaging will stage for
     * remote first-run installs, including the x64 path added after arm64.
     */
    const packageDir = '/package';
    const existing = new Set([
      '/package/bin/gxserver',
      '/package/bin/zmx',
      '/package/bin/ghostex',
      '/package/build-identity.json',
    ]);

    expect(missingRemoteGxserverLinuxPackageResources(packageDir, (candidate) => existing.has(candidate))).toEqual([]);

    existing.delete('/package/bin/ghostex');
    existing.delete('/package/build-identity.json');

    expect(missingRemoteGxserverLinuxPackageResources(packageDir, (candidate) => existing.has(candidate))).toEqual([
      'bin/ghostex',
      'build-identity.json',
    ]);
  });
});
