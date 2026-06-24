use std::{
    env, fs,
    path::{Path, PathBuf},
};

use crate::platform::resources;
use crate::protocol::ToolCapabilityStatus;

#[derive(Clone, Copy)]
enum ToolSource {
    DevSubmodule,
    AppResource,
    GxserverBundle,
}

impl ToolSource {
    fn as_str(self) -> &'static str {
        match self {
            Self::DevSubmodule => "devSubmodule",
            Self::AppResource => "appResource",
            Self::GxserverBundle => "gxserverBundle",
        }
    }
}

struct ToolCandidate {
    executable_path: PathBuf,
    source: ToolSource,
}

enum CandidateInspection {
    Available,
    Missing,
    NotExecutable,
}

#[derive(Clone, Debug)]
pub struct GxserverResolvedTool {
    pub executable_path: String,
    pub source: String,
    pub tool: String,
}

/*
CDXC:GxserverToolchain 2026-06-14-20:37:
Managed terminal/search/project-board tools must resolve only from Ghostex-pinned development or bundled resources. Rust Phase 1 reports the same health status surface without falling back to arbitrary PATH binaries.

CDXC:GxserverUbuntu 2026-06-23-07:52:
The same gxserver-rs binary must resolve zmx, zehn, and bd from package-relative resources on macOS and Ubuntu. Add Linux-compatible bundle roots without adding user PATH fallbacks so tool behavior remains pinned to Ghostex-owned artifacts.
*/
pub fn get_gxserver_tool_statuses() -> Vec<ToolCapabilityStatus> {
    vec![
        resolve_bundled_tool_status("zmx"),
        resolve_bundled_tool_status("zehn"),
        get_bd_tool_status(),
    ]
}

pub fn require_bundled_zmx() -> Result<GxserverResolvedTool, String> {
    require_bundled_tool("zmx")
}

pub fn require_bundled_bd() -> Result<GxserverResolvedTool, String> {
    let status = get_bd_tool_status();
    if status.availability == "available" {
        if let (Some(executable_path), Some(source)) = (status.executable_path, status.source) {
            return Ok(GxserverResolvedTool {
                executable_path,
                source,
                tool: "bd".to_string(),
            });
        }
    }
    Err(status.message)
}

fn require_bundled_tool(tool: &str) -> Result<GxserverResolvedTool, String> {
    let status = resolve_bundled_tool_status(tool);
    if status.availability == "available" {
        if let (Some(executable_path), Some(source)) = (status.executable_path, status.source) {
            return Ok(GxserverResolvedTool {
                executable_path,
                source,
                tool: tool.to_string(),
            });
        }
    }
    Err(status.message)
}

fn resolve_bundled_tool_status(tool: &str) -> ToolCapabilityStatus {
    let candidates = bundled_tool_candidates(tool);
    let inspected = candidates
        .iter()
        .find(|candidate| is_executable_file(&candidate.executable_path));
    if let Some(candidate) = inspected {
        return ToolCapabilityStatus {
            availability: "available".to_string(),
            candidate_paths: None,
            capability: if tool == "zmx" {
                "zmxLifecycle".to_string()
            } else {
                "previousSessionHistory".to_string()
            },
            executable_path: Some(candidate.executable_path.to_string_lossy().to_string()),
            guidance: None,
            message: format!("{tool} resolved from {}.", candidate.source.as_str()),
            source: Some(candidate.source.as_str().to_string()),
            tool: tool.to_string(),
        };
    }
    let candidate_paths = candidates
        .iter()
        .map(|candidate| candidate.executable_path.to_string_lossy().to_string())
        .collect();
    ToolCapabilityStatus {
        availability: "missing".to_string(),
        candidate_paths: Some(candidate_paths),
        capability: if tool == "zmx" {
            "zmxLifecycle".to_string()
        } else {
            "previousSessionHistory".to_string()
        },
        executable_path: None,
        guidance: None,
        message: if tool == "zmx" {
            "Ghostex-managed zmx sessions require bundled zmx, but bundled zmx was not found."
                .to_string()
        } else {
            "Ghostex CLI search requires bundled zehn, but bundled zehn was not found.".to_string()
        },
        source: None,
        tool: tool.to_string(),
    }
}

fn get_bd_tool_status() -> ToolCapabilityStatus {
    get_bd_tool_status_for_candidates(&bundled_bd_tool_candidates())
}

fn get_bd_tool_status_for_candidates(candidates: &[ToolCandidate]) -> ToolCapabilityStatus {
    if let Some(candidate) = candidates
        .iter()
        .find(|candidate| matches!(inspect_candidate(candidate), CandidateInspection::Available))
    {
        return ToolCapabilityStatus {
            availability: "available".to_string(),
            candidate_paths: None,
            capability: "beadsProjectBoard".to_string(),
            executable_path: Some(candidate.executable_path.to_string_lossy().to_string()),
            guidance: None,
            message: format!(
                "bd resolved from {}. gxserver will use Ghostex's bundled Beads CLI.",
                candidate.source.as_str()
            ),
            source: Some(candidate.source.as_str().to_string()),
            tool: "bd".to_string(),
        };
    }
    let candidate_paths = candidates
        .iter()
        .map(|candidate| candidate.executable_path.to_string_lossy().to_string())
        .collect::<Vec<_>>();
    if let Some(candidate) = candidates.iter().find(|candidate| {
        matches!(
            inspect_candidate(candidate),
            CandidateInspection::NotExecutable
        )
    }) {
        return ToolCapabilityStatus {
            availability: "notExecutable".to_string(),
            candidate_paths: Some(candidate_paths),
            capability: "beadsProjectBoard".to_string(),
            executable_path: None,
            guidance: Some("Packaged Ghostex builds must place an executable pinned Beads CLI at the bundled bd resource path. Rebuild the app resources so Project board operations can run.".to_string()),
            message: format!(
                "Ghostex Project board requires bundled bd, but bundled bd exists and is not executable: {}.",
                candidate.executable_path.to_string_lossy()
            ),
            source: None,
            tool: "bd".to_string(),
        };
    }
    ToolCapabilityStatus {
        availability: "missing".to_string(),
        candidate_paths: Some(candidate_paths),
        capability: "beadsProjectBoard".to_string(),
        executable_path: None,
        guidance: Some("Packaged Ghostex builds include the pinned Beads CLI. For source checkouts, build/stage Beads into Ghostex app resources; in a repository, run `gx bd init` if the project has not been initialized.".to_string()),
        message: "Bundled bd was not found in Ghostex resources.".to_string(),
        source: None,
        tool: "bd".to_string(),
    }
}

fn bundled_tool_candidates(tool: &str) -> Vec<ToolCandidate> {
    let gxserver_root = default_gxserver_root();
    let repo_root = gxserver_root
        .parent()
        .unwrap_or(Path::new("."))
        .to_path_buf();
    let mut candidates = vec![
        ToolCandidate {
            executable_path: repo_root.join(tool).join("zig-out").join("bin").join(tool),
            source: ToolSource::DevSubmodule,
        },
        ToolCandidate {
            executable_path: gxserver_root.join("bin").join(tool),
            source: ToolSource::GxserverBundle,
        },
        ToolCandidate {
            executable_path: gxserver_root.join("..").join("bin").join(tool),
            source: ToolSource::AppResource,
        },
        ToolCandidate {
            executable_path: gxserver_root.join("..").join("Web").join("bin").join(tool),
            source: ToolSource::AppResource,
        },
        ToolCandidate {
            executable_path: gxserver_root
                .join("..")
                .join("..")
                .join("Web")
                .join("bin")
                .join(tool),
            source: ToolSource::AppResource,
        },
    ];
    if let Some(path) = resources::source_web_resource(&format!("bin/{tool}")) {
        candidates.push(ToolCandidate {
            executable_path: path,
            source: ToolSource::AppResource,
        });
    }
    dedupe_candidates(candidates)
}

fn bundled_bd_tool_candidates() -> Vec<ToolCandidate> {
    let gxserver_root = default_gxserver_root();
    let repo_root = gxserver_root
        .parent()
        .unwrap_or(Path::new("."))
        .to_path_buf();
    let inferred_source_root = gxserver_root.join("..").join("..");
    let mut candidates = vec![
        ToolCandidate {
            executable_path: gxserver_root.join("bin").join("bd"),
            source: ToolSource::GxserverBundle,
        },
        ToolCandidate {
            executable_path: gxserver_root.join("..").join("bin").join("bd"),
            source: ToolSource::AppResource,
        },
        ToolCandidate {
            executable_path: gxserver_root.join("..").join("Web").join("bin").join("bd"),
            source: ToolSource::AppResource,
        },
        ToolCandidate {
            executable_path: gxserver_root
                .join("..")
                .join("..")
                .join("Web")
                .join("bin")
                .join("bd"),
            source: ToolSource::AppResource,
        },
        ToolCandidate {
            executable_path: repo_root
                .join("native")
                .join("macos")
                .join("ghostexHost")
                .join("Web")
                .join("bin")
                .join("bd"),
            source: ToolSource::AppResource,
        },
        ToolCandidate {
            executable_path: inferred_source_root
                .join("native")
                .join("macos")
                .join("ghostexHost")
                .join("Web")
                .join("bin")
                .join("bd"),
            source: ToolSource::AppResource,
        },
    ];
    if let Some(path) = resources::source_web_resource("bin/bd") {
        candidates.push(ToolCandidate {
            executable_path: path,
            source: ToolSource::AppResource,
        });
    }
    dedupe_candidates(candidates)
}

fn default_gxserver_root() -> PathBuf {
    if let Ok(current_exe) = env::current_exe() {
        if let Some(root) = gxserver_root_from_executable_path(&current_exe) {
            return root;
        }
    }
    env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("gxserver")
}

fn gxserver_root_from_executable_path(executable_path: &Path) -> Option<PathBuf> {
    /*
    CDXC:GxserverToolchain 2026-06-21-13:59:
    The macOS app launches gxserver-rs from Web/gxserver/bin/gxserver while the process current directory is not the package root. Resolve bundled zmx/zehn/bd from the running executable's package root first so Rust starts with the same app resources the TypeScript daemon used.
    */
    let parent = executable_path.parent()?;
    if parent.file_name().and_then(|name| name.to_str()) != Some("bin") {
        return None;
    }
    parent.parent().map(Path::to_path_buf)
}

fn dedupe_candidates(candidates: Vec<ToolCandidate>) -> Vec<ToolCandidate> {
    let mut seen = std::collections::HashSet::new();
    candidates
        .into_iter()
        .filter(|candidate| {
            let key = candidate
                .executable_path
                .components()
                .collect::<PathBuf>()
                .to_string_lossy()
                .to_string();
            seen.insert(key)
        })
        .collect()
}

#[cfg(test)]
#[allow(clippy::items_after_test_module)]
mod tests {
    use super::*;

    #[test]
    fn gxserver_root_from_packaged_executable_uses_package_parent() {
        let root = gxserver_root_from_executable_path(Path::new(
            "/Applications/Ghostex.app/Contents/Resources/Web/gxserver/bin/gxserver",
        ))
        .expect("packaged root");
        assert_eq!(
            root,
            PathBuf::from("/Applications/Ghostex.app/Contents/Resources/Web/gxserver")
        );
    }

    #[test]
    fn gxserver_root_from_dev_target_executable_keeps_cwd_fallback() {
        assert!(gxserver_root_from_executable_path(Path::new(
            "/repo/gxserver-rs/target/release/gxserver"
        ))
        .is_none());
    }

    #[test]
    fn bd_status_reports_actual_resolution_source() {
        let dir = tempfile::tempdir().expect("tempdir");
        let bd = dir.path().join("gxserver").join("bin").join("bd");
        fs::create_dir_all(bd.parent().expect("bd parent")).expect("create bd parent");
        fs::write(&bd, "#!/bin/sh\nexit 0\n").expect("write bd");
        make_executable(&bd);
        let status = get_bd_tool_status_for_candidates(&[ToolCandidate {
            executable_path: bd.clone(),
            source: ToolSource::GxserverBundle,
        }]);

        assert_eq!(status.availability, "available");
        assert_eq!(
            status.executable_path.as_deref(),
            Some(bd.to_str().unwrap())
        );
        assert_eq!(status.source.as_deref(), Some("gxserverBundle"));
        assert!(status.message.contains("gxserverBundle"));
    }

    #[cfg(unix)]
    #[test]
    fn bd_status_reports_present_but_not_executable() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().expect("tempdir");
        let bd = dir.path().join("app").join("bin").join("bd");
        fs::create_dir_all(bd.parent().expect("bd parent")).expect("create bd parent");
        fs::write(&bd, "#!/bin/sh\nexit 0\n").expect("write bd");
        fs::set_permissions(&bd, fs::Permissions::from_mode(0o644)).expect("chmod bd");
        let status = get_bd_tool_status_for_candidates(&[ToolCandidate {
            executable_path: bd.clone(),
            source: ToolSource::AppResource,
        }]);

        assert_eq!(status.availability, "notExecutable");
        assert!(status.message.contains("not executable"));
        assert!(status
            .guidance
            .unwrap_or_default()
            .contains("Rebuild the app resources"));
    }

    #[test]
    fn bd_status_reports_missing_with_project_board_guidance() {
        let dir = tempfile::tempdir().expect("tempdir");
        let missing = dir.path().join("missing").join("bd");
        let status = get_bd_tool_status_for_candidates(&[ToolCandidate {
            executable_path: missing,
            source: ToolSource::AppResource,
        }]);

        assert_eq!(status.availability, "missing");
        assert!(status.message.contains("Bundled bd was not found"));
        assert!(status
            .guidance
            .unwrap_or_default()
            .contains("Packaged Ghostex builds include"));
    }
}

fn is_executable_file(path: &Path) -> bool {
    let Ok(metadata) = fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

#[cfg(test)]
fn make_executable(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).expect("chmod executable");
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
}

fn inspect_candidate(candidate: &ToolCandidate) -> CandidateInspection {
    let Ok(metadata) = fs::metadata(&candidate.executable_path) else {
        return CandidateInspection::Missing;
    };
    if !metadata.is_file() {
        return CandidateInspection::Missing;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o111 != 0 {
            CandidateInspection::Available
        } else {
            CandidateInspection::NotExecutable
        }
    }
    #[cfg(not(unix))]
    {
        let _ = candidate;
        CandidateInspection::Available
    }
}
