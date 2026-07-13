#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const usage = `
Usage: bun run release:gpui -- <version> [options]

Dispatches the modular GitHub Actions release. Every enabled platform runs in
its own reusable workflow and the release is published only after all enabled
artifacts pass validation.

Options:
  --disable-macos
  --disable-linux
  --disable-windows-x64
  --disable-windows-arm64
  --disable-android
  --skip-sparkle
  --skip-windows-signing
  --prerelease
  --help
`;

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.length === 0) {
  console.log(usage.trim());
  process.exit(argv.length === 0 ? 2 : 0);
}
const version = argv.shift();
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  throw new Error(`Version must be MAJOR.MINOR.PATCH, got ${version ?? "<empty>"}`);
}
const enabled = {
  macos: true,
  linux: true,
  windows_x64: true,
  windows_arm64: true,
  android: true,
};
let prerelease = false;
let updateSparkle = true;
let signWindows = true;
while (argv.length > 0) {
  const argument = argv.shift();
  switch (argument) {
    case "--disable-macos": enabled.macos = false; break;
    case "--disable-linux": enabled.linux = false; break;
    case "--disable-windows-x64": enabled.windows_x64 = false; break;
    case "--disable-windows-arm64": enabled.windows_arm64 = false; break;
    case "--disable-android": enabled.android = false; break;
    case "--skip-sparkle": updateSparkle = false; break;
    case "--skip-windows-signing": signWindows = false; break;
    case "--prerelease": prerelease = true; break;
    default: throw new Error(`Unknown option: ${argument}`);
  }
}
if (!Object.values(enabled).some(Boolean)) {
  throw new Error("At least one release platform must be enabled");
}
if (prerelease && enabled.macos && updateSparkle) {
  throw new Error("A prerelease cannot advance the production macOS Sparkle feed; pass --skip-sparkle");
}

const args = [
  "workflow", "run", "release-gpui.yml", "--ref", "main",
  "-f", `version=${version}`,
  ...Object.entries(enabled).flatMap(([name, value]) => ["-f", `${name}=${value}`]),
  "-f", `update_sparkle=${updateSparkle}`,
  "-f", `sign_windows=${signWindows}`,
  "-f", `prerelease=${prerelease}`,
];
const result = spawnSync("gh", args, { stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
