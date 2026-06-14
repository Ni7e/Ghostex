use std::{env, path::PathBuf};

fn main() {
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir
        .parent()
        .expect("gpui crate should live under the repository root");
    let arch = env::var("CARGO_CFG_TARGET_ARCH").expect("CARGO_CFG_TARGET_ARCH");
    let cef_arch = match arch.as_str() {
        "aarch64" => "arm64",
        "x86_64" => "x86_64",
        other => panic!("unsupported macOS target arch for CEF: {other}"),
    };

    let cef_root = repo_root
        .join("native/macos/ghostexHost/Vendor")
        .join(format!("cef-{cef_arch}"));
    let cef_wrapper = cef_root.join("build/libcef_dll_wrapper/libcef_dll_wrapper.a");
    let cef_framework =
        cef_root.join("Release/Chromium Embedded Framework.framework/Chromium Embedded Framework");
    let ghostex_bridge =
        repo_root.join("native/macos/ghostexHost/Sources/ghostexHost/GhostexCEFBridge.mm");
    let gpui_bridge = manifest_dir.join("native/macos/GpuiCefBridge.mm");

    if !cef_wrapper.exists() || !cef_framework.exists() {
        panic!(
            "CEF runtime is missing for {cef_arch}. Run native/macos/ghostexHost/vendor-cef.sh first."
        );
    }

    println!("cargo:rerun-if-changed={}", ghostex_bridge.display());
    println!("cargo:rerun-if-changed={}", gpui_bridge.display());
    println!("cargo:rerun-if-changed={}", cef_wrapper.display());

    cc::Build::new()
        .cpp(true)
        .flag("-std=c++20")
        .flag("-ObjC++")
        .flag("-fobjc-arc")
        .flag("-fblocks")
        .flag("-w")
        .flag("-Wno-deprecated-declarations")
        .include(&cef_root)
        .include(repo_root.join("native/macos/ghostexHost/Sources/ghostexHost"))
        .file(ghostex_bridge)
        .file(gpui_bridge)
        .compile("ghostex_gpui_cef_bridge");

    println!(
        "cargo:rustc-link-search=native={}",
        cef_root.join("build/libcef_dll_wrapper").display()
    );
    println!(
        "cargo:rustc-link-search=framework={}",
        cef_root.join("Release").display()
    );
    println!("cargo:rustc-link-lib=static=cef_dll_wrapper");
    println!("cargo:rustc-link-lib=framework=Chromium Embedded Framework");
    println!("cargo:rustc-link-lib=framework=Cocoa");
    println!("cargo:rustc-link-lib=framework=Foundation");
    println!("cargo:rustc-link-lib=framework=QuartzCore");
    println!("cargo:rustc-link-lib=c++");
    println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../Frameworks");
}
