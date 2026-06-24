use std::{env, path::PathBuf};

const GHOSTTYKIT_HEADER: &str =
    "../ghostty/macos/GhosttyKit.xcframework/macos-arm64_x86_64/Headers/ghostty.h";
const GHOSTTYKIT_ARCHIVE: &str =
    "../ghostty/macos/GhosttyKit.xcframework/macos-arm64_x86_64/ghostty-internal.a";

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

    println!("cargo:rerun-if-changed={}", gpui_hooks.display());
    println!(
        "cargo:rerun-if-changed={}",
        gpui_terminal_appkit_adapter.display()
    );

    /*
    CDXC:GPUIPhase1 2026-06-14-15:25:
    CEF browser creation now comes from tauri-apps/cef-rs instead of GhostexCEFBridge.mm. Keep this build script limited to the AppKit protocol/message-pump shim required because GPUI owns NSApplication and the main run loop.
    */
    cc::Build::new()
        .flag("-fobjc-arc")
        .flag("-fblocks")
        .flag("-Wno-deprecated-declarations")
        .file(gpui_hooks)
        .compile("ghostex_gpui_cef_appkit_hooks");

    /*
    CDXC:GPUTerminalAppKitAdapter 2026-06-22-20:58:
    Compile the GPUI-local terminal AppKit adapter as a separate shim from CEF so real terminal host views can be positioned and shown or hidden through the owner path without fake views, logging, overlays, hit-test routing, or process behavior.

    CDXC:GPUTerminalAppKitAdapter 2026-06-22-22:42:
    GhosttyKit link flags are now declared separately below because Rust owns the real focused one-pane surface lifecycle; keep this Objective-C shim limited to AppKit view frame and visibility operations.
    */
    cc::Build::new()
        .flag("-fobjc-arc")
        .flag("-fblocks")
        .flag("-Wno-deprecated-declarations")
        .file(gpui_terminal_appkit_adapter)
        .compile("ghostex_gpui_terminal_appkit_adapter");

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
}
