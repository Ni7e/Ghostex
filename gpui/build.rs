use std::{env, path::PathBuf};

fn main() {
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let gpui_hooks = manifest_dir.join("native/macos/GpuiCefAppKitHooks.m");

    println!("cargo:rerun-if-changed={}", gpui_hooks.display());

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

    println!("cargo:rustc-link-lib=framework=Cocoa");
    println!("cargo:rustc-link-lib=framework=Foundation");
}
