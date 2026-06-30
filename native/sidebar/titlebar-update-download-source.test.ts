import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const appDelegateSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift", import.meta.url),
  "utf8",
);
const sparkleUserDriverSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/GhostexSparkleUserDriver.swift", import.meta.url),
  "utf8",
);
const titlebarHostSource = readFileSync(new URL("./titlebar-host.tsx", import.meta.url), "utf8");

describe("titlebar update download state source", () => {
  test("keeps the disabled circular progress button driven by Sparkle download state", () => {
    /*
     * CDXC:AutoUpdate 2026-06-30-22:18:
     * The titlebar download button must become a disabled circular progress
     * button while Sparkle is downloading an accepted update. Keep the native
     * callbacks, bootstrap/bridge progress ratio, React click guard, tooltip
     * percent copy, and ring CSS connected without exposing byte counts.
     */
    expect(sparkleUserDriverSource).toContain("var onDownloadActiveChanged: ((Bool) -> Void)?");
    expect(sparkleUserDriverSource).toContain("var onDownloadProgressChanged: ((Double?) -> Void)?");
    expect(sparkleUserDriverSource).toContain("downloadExpectedContentLength");
    expect(sparkleUserDriverSource).toContain("downloadReceivedContentLength");
    expect(sparkleUserDriverSource).toMatch(
      /override func showDownloadInitiated\(cancellation: @escaping \(\) -> Void\) \{[\s\S]*onDownloadActiveChanged\?\(true\)[\s\S]*\}/,
    );
    expect(sparkleUserDriverSource).toContain("override func showDownloadDidReceiveExpectedContentLength");
    expect(sparkleUserDriverSource).toContain("override func showDownloadDidReceiveData");
    expect(sparkleUserDriverSource).toContain("onDownloadProgressChanged?(progress)");
    expect(sparkleUserDriverSource).toMatch(
      /override func showDownloadDidStartExtractingUpdate\(\) \{[\s\S]*onDownloadActiveChanged\?\(false\)[\s\S]*\}/,
    );

    expect(appDelegateSource).toContain("private var isSparkleUpdateDownloading = false");
    expect(appDelegateSource).toContain("private var sparkleUpdateDownloadProgress: Double?");
    expect(appDelegateSource).toContain("userDriver.onDownloadActiveChanged");
    expect(appDelegateSource).toContain("userDriver.onDownloadProgressChanged");
    expect(appDelegateSource).toContain("self?.setSparkleUpdateDownloading(downloading)");
    expect(appDelegateSource).toContain("self?.setSparkleUpdateDownloadProgress(progress)");
    expect(appDelegateSource).toContain("initialUpdateDownloading: isSparkleUpdateDownloading");
    expect(appDelegateSource).toContain("initialUpdateDownloadProgress: sparkleUpdateDownloadProgress");
    expect(appDelegateSource).toContain('"updateDownloading": initialUpdateDownloading');
    expect(appDelegateSource).toContain('"updateDownloadProgress": initialUpdateDownloadProgress ?? NSNull()');
    expect(appDelegateSource).toContain("func setTitlebarUpdateDownloading(_ downloading: Bool, progress: Double?)");
    expect(appDelegateSource).toContain('"updateDownloading": downloading');
    expect(appDelegateSource).toContain('"updateDownloadProgress": normalizedProgress ?? NSNull()');
    expect(appDelegateSource).toContain("__ghostex_PENDING_TITLEBAR_UPDATE_DOWNLOADING__");
    expect(appDelegateSource).toContain("__ghostex_PENDING_TITLEBAR_UPDATE_DOWNLOAD_PROGRESS__");
    expect(appDelegateSource).toContain("setSparkleUpdateDownloading(false)");

    expect(titlebarHostSource).toContain("updateDownloading: boolean;");
    expect(titlebarHostSource).toContain("updateDownloadProgress: number | null;");
    expect(titlebarHostSource).toContain("__ghostex_PENDING_TITLEBAR_UPDATE_DOWNLOADING__?: boolean;");
    expect(titlebarHostSource).toContain("__ghostex_PENDING_TITLEBAR_UPDATE_DOWNLOAD_PROGRESS__?: number | null;");
    expect(titlebarHostSource).toContain("readInitialTitlebarUpdateDownloading(bootstrap)");
    expect(titlebarHostSource).toContain("readInitialTitlebarUpdateDownloadProgress(bootstrap)");
    expect(titlebarHostSource).toContain('Object.prototype.hasOwnProperty.call(state, "updateDownloadProgress")');
    expect(titlebarHostSource).toContain("projectState.updateAvailable || projectState.updateDownloading");
    expect(titlebarHostSource).toContain("if (projectState.updateDownloading)");
    expect(titlebarHostSource).toContain('aria-disabled={projectState.updateDownloading ? true : undefined}');
    expect(titlebarHostSource).toContain('data-disabled={projectState.updateDownloading ? "true" : undefined}');
    expect(titlebarHostSource).toContain('data-downloading={projectState.updateDownloading ? "true" : undefined}');
    expect(titlebarHostSource).toContain("titlebar-update-download-icon");
    expect(titlebarHostSource).toMatch(
      /\.titlebar-update-download-icon \{[\s\S]*transform: translateY\(2px\);/,
    );
    expect(titlebarHostSource).toContain("function TitlebarUpdateProgressRing");
    expect(titlebarHostSource).toContain("formatTitlebarUpdateDownloadingTooltip");
    expect(titlebarHostSource).toContain("formatTitlebarUpdateDownloadPercent");
    expect(titlebarHostSource).toContain("titlebar-update-progress-ring");
    expect(titlebarHostSource).toContain("titlebar-update-progress-fill");
    expect(titlebarHostSource).not.toContain("titlebar-update-spinner");
    expect(titlebarHostSource).not.toContain("titlebar-update-download-spin");
    expect(titlebarHostSource).toContain("TITLEBAR_UPDATE_AVAILABLE_TOOLTIP");
    expect(titlebarHostSource).toContain("Update to Latest (Recommended)");
    expect(titlebarHostSource).toContain(
      "Note: All your terminals & agents will keep running even while the app restarts to update",
    );
  });
});
