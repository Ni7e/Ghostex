use std::{env, path::PathBuf, process::Command};

fn main() {
    let root = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap()).join("../..");
    for path in ["apps/desktop/sidebar", "packages/core-ui", "packages/shared", "packages/core-ui/chat", "packages/client-storage", "agent-model-catalog.json", "tooling/build-chat-runtime.mjs"] {
        println!("cargo:rerun-if-changed={}", root.join(path).display());
    }
    let output = PathBuf::from(env::var("OUT_DIR").unwrap()).join("chat-runtime.js");
    let status = Command::new("bun")
        .current_dir(&root)
        .arg("tooling/build-chat-runtime.mjs")
        .arg(output)
        .status()
        .expect("building the shared chat runtime requires bun on PATH");
    assert!(status.success(), "shared chat runtime build failed");
}

