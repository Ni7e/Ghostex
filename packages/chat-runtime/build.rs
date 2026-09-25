use std::{env, path::PathBuf, process::Command};

fn main() {
    let root = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap()).join("../..");
    for path in ["apps/desktop/sidebar", "packages/core-ui", "packages/shared", "packages/core-ui/chat", "packages/client-storage", "agent-model-catalog.json", "tooling/build-service-runtime.mjs"] {
        println!("cargo:rerun-if-changed={}", root.join(path).display());
    }
    let output = PathBuf::from(env::var("OUT_DIR").unwrap()).join("service-runtime.js");
    let status = Command::new("bun")
        .current_dir(&root)
        .arg("tooling/build-service-runtime.mjs")
        .arg(output)
        .status()
        .expect("building the app runtime bundle requires bun on PATH");
    assert!(status.success(), "app runtime bundle build failed");
}
