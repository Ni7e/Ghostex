#!/usr/bin/env bun
import { copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const macIconSet = path.join(
  repoRoot,
  "native",
  "macos",
  "ghostexHost",
  "Resources",
  "Assets.xcassets",
  "AppIcon.appiconset",
);
const iosIconSet = path.join(
  repoRoot,
  "iOS",
  "VVTerm",
  "Resources",
  "Assets.xcassets",
  "AppIcon.appiconset",
);

/*
CDXC:AppIcon 2026-06-22-05:32:
The iOS app icon must visually match the macOS Ghostex app icon so the product identity is consistent across Apple platforms.
Copy mac idiom slots byte-for-byte from the macOS asset catalog, but flatten the iOS universal 1024 icon to an opaque PNG because iOS app icon assets cannot rely on transparency.
*/
const iconCopies = [
  ["icon_16x16.png", "icon-mac-16.png"],
  ["icon_16x16@2x.png", "icon-mac-16@2x.png"],
  ["icon_32x32.png", "icon-mac-32.png"],
  ["icon_32x32@2x.png", "icon-mac-32@2x.png"],
  ["icon_128x128.png", "icon-mac-128.png"],
  ["icon_128x128@2x.png", "icon-mac-128@2x.png"],
  ["icon_256x256.png", "icon-mac-256.png"],
  ["icon_256x256@2x.png", "icon-mac-256@2x.png"],
  ["icon_512x512.png", "icon-mac-512.png"],
  ["icon_512x512@2x.png", "icon-mac-512@2x.png"],
];

for (const [sourceName, destinationName] of iconCopies) {
  await copyFile(path.join(macIconSet, sourceName), path.join(iosIconSet, destinationName));
}

const magick = Bun.spawnSync([
  process.env.MAGICK_BIN ?? "magick",
  path.join(macIconSet, "icon_512x512@2x.png"),
  "-background",
  "black",
  "-alpha",
  "remove",
  "-alpha",
  "off",
  path.join(iosIconSet, "icon-ios-1024.png"),
]);

if (!magick.success) {
  const stderr = new TextDecoder().decode(magick.stderr).trim();
  throw new Error(`Failed to flatten iOS 1024 icon with ImageMagick: ${stderr}`);
}
