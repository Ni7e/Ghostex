use std::{env, path::PathBuf};

const GHOSTTYKIT_HEADER: &str =
    "../ghostty/macos/GhosttyKit.xcframework/macos-arm64_x86_64/Headers/ghostty.h";
const GHOSTTYKIT_ARCHIVE: &str =
    "../ghostty/macos/GhosttyKit.xcframework/macos-arm64_x86_64/ghostty-internal.a";
const GPUI_MACOS_DEPLOYMENT_TARGET_FLAG: &str = "-mmacosx-version-min=13.0";

fn gpui_macos_objc_build() -> cc::Build {
    /*
    CDXC:GPUIAppShots 2026-06-26-04:18:
    GPUI Objective-C shims must compile against Ghostex's supported macOS 13.0 deployment target, matching the native Xcode project and GPUI package metadata. Do not inherit the current host OS as the minimum target because newer SDKs mark App Shots' real WindowServer capture API unavailable for future deployment targets.
    */
    let mut build = cc::Build::new();
    build
        .flag("-fobjc-arc")
        .flag("-fblocks")
        .flag("-Wno-deprecated-declarations")
        .flag(GPUI_MACOS_DEPLOYMENT_TARGET_FLAG);
    build
}

fn main() {
    println!("cargo:rerun-if-changed={GHOSTTYKIT_HEADER}");
    println!("cargo:rerun-if-changed={GHOSTTYKIT_ARCHIVE}");

    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let ghosttykit_archive = manifest_dir.join(GHOSTTYKIT_ARCHIVE);
    let gpui_hooks = manifest_dir.join("native/macos/GpuiCefAppKitHooks.m");
    let gpui_terminal_appkit_adapter =
        manifest_dir.join("native/macos/GpuiTerminalAppKitAdapter.m");
    let gpui_settings_notifications = manifest_dir.join("native/macos/GpuiSettingsNotifications.m");
    let gpui_app_shots = manifest_dir.join("native/macos/GpuiAppShots.m");
    let gpui_lid_sleep_helper_client = manifest_dir.join("native/macos/GpuiLidSleepHelperClient.m");

    println!("cargo:rerun-if-changed={}", gpui_hooks.display());
    println!(
        "cargo:rerun-if-changed={}",
        gpui_terminal_appkit_adapter.display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        gpui_settings_notifications.display()
    );
    println!("cargo:rerun-if-changed={}", gpui_app_shots.display());
    println!(
        "cargo:rerun-if-changed={}",
        gpui_lid_sleep_helper_client.display()
    );

    /*
    CDXC:GPUIPhase1 2026-06-14-15:25:
    CEF browser creation now comes from tauri-apps/cef-rs instead of GhostexCEFBridge.mm. Keep this build script limited to the AppKit protocol/message-pump shim required because GPUI owns NSApplication and the main run loop.
    */
    gpui_macos_objc_build()
        .file(gpui_hooks)
        .compile("ghostex_gpui_cef_appkit_hooks");

    /*
    CDXC:GPUTerminalAppKitAdapter 2026-06-22-20:58:
    Compile the GPUI-local terminal AppKit adapter as a separate shim from CEF so real terminal host views can be positioned and shown or hidden through the owner path without fake views, logging, overlays, hit-test routing, or process behavior.

    CDXC:GPUTerminalAppKitAdapter 2026-06-22-22:42:
    GhosttyKit link flags are now declared separately below because Rust owns the real focused one-pane surface lifecycle; keep this Objective-C shim limited to AppKit view frame and visibility operations.
    */
    gpui_macos_objc_build()
        .file(gpui_terminal_appkit_adapter)
        .compile("ghostex_gpui_terminal_appkit_adapter");

    /*
    CDXC:GPUISettingsNotifications 2026-06-24-12:44:
    Compile the GPUI Settings notification shim separately from CEF and terminal AppKit adapters. It owns only UserNotifications permission/status/test-banner calls, requests alert authorization, emits no notification sound, and must not grow into session attention routing or persistent logging.
    */
    gpui_macos_objc_build()
        .file(gpui_settings_notifications)
        .compile("ghostex_gpui_settings_notifications");

    /*
    CDXC:GPUIAppShots 2026-06-25-23:07:
    Compile App Shots as a dedicated macOS shim because it owns only shared-settings hotkey monitoring, WindowServer capture, and the `~/.ghostex/i` PNG write path. Keep it separate from CEF, terminal AppKit, and notification shims so the feature does not add overlays, hit-test routing, persistent logging, or renderer-provided screenshot authority.
    */
    gpui_macos_objc_build()
        .file(gpui_app_shots)
        .compile("ghostex_gpui_app_shots");

    /*
    CDXC:GPUITitlebarKeepAwake 2026-06-26-00:09:
    Compile the GPUI lid-sleep helper client as its own macOS shim. Rust owns only start/heartbeat/disable decisions; this Objective-C boundary mirrors the Swift XPC installer/client and returns generic status without exposing helper paths, signing text, installer output, or privileged command details.
    */
    gpui_macos_objc_build()
        .file(gpui_lid_sleep_helper_client)
        .compile("ghostex_gpui_lid_sleep_helper_client");

    /*
    CDXC:GPUIGhosttyKitAdapter 2026-06-22-22:29:
    GPUI now references real GhosttyKit/libghostty runtime and surface symbols from Rust, so macOS builds intentionally link the repo-local static archive plus the system libraries used by the native GhosttyKit embedding path. This build-time path output is allowed, but runtime code must still avoid logging private paths, terminal content, command text, URLs, tokens, or fallback surface state.

    CDXC:GPUIGhosttyKitAdapter 2026-06-23-03:27:
    The Ghostty Metal renderer now pulls IOSurface symbols from the static GhosttyKit archive, so local GPUI builds must link IOSurface explicitly instead of relying on transitive framework flags from other crates.
    */
    if let Some(ghosttykit_archive_dir) = ghosttykit_archive.parent() {
        println!(
            "cargo:rustc-link-search=native={}",
            ghosttykit_archive_dir.display()
        );
        println!("cargo:rustc-link-arg={}", ghosttykit_archive.display());
        println!("cargo:rustc-link-lib=c++");
        println!("cargo:rustc-link-lib=z");
    }

    println!("cargo:rustc-link-lib=framework=Cocoa");
    println!("cargo:rustc-link-lib=framework=Foundation");
    println!("cargo:rustc-link-lib=framework=Carbon");
    println!("cargo:rustc-link-lib=framework=Metal");
    println!("cargo:rustc-link-lib=framework=QuartzCore");
    println!("cargo:rustc-link-lib=framework=CoreText");
    println!("cargo:rustc-link-lib=framework=CoreGraphics");
    println!("cargo:rustc-link-lib=framework=CoreFoundation");
    println!("cargo:rustc-link-lib=framework=Security");
    println!("cargo:rustc-link-lib=framework=ApplicationServices");
    println!("cargo:rustc-link-lib=framework=IOKit");
    println!("cargo:rustc-link-lib=framework=IOSurface");
    println!("cargo:rustc-link-lib=framework=UniformTypeIdentifiers");
    println!("cargo:rustc-link-lib=framework=UserNotifications");
}
