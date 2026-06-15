use std::{
    env, fs,
    path::{Path, PathBuf},
};

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

#[derive(Clone, Debug)]
pub struct GxserverResolvedTool {
    pub executable_path: String,
    pub source: String,
    pub tool: String,
}

/*
CDXC:GxserverToolchain 2026-06-14-20:37:
Managed terminal/search/project-board tools must resolve only from Ghostex-pinned development or bundled resources. Rust Phase 1 reports the same health status surface without falling back to arbitrary PATH binaries.
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
    let inspected = candidates.iter().find_map(|candidate| {
        if is_executable_file(&candidate.executable_path) {
            Some(candidate)
        } else {
            None
        }
    });
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
    let candidates = bundled_bd_tool_candidates();
    if let Some(candidate) = candidates
        .iter()
        .find(|candidate| is_executable_file(&candidate.executable_path))
    {
        return ToolCapabilityStatus {
            availability: "available".to_string(),
            candidate_paths: None,
            capability: "beadsProjectBoard".to_string(),
            executable_path: Some(candidate.executable_path.to_string_lossy().to_string()),
            guidance: None,
            message: "bd resolved from appResource. gxserver will use Ghostex's bundled Beads CLI."
                .to_string(),
            source: Some(candidate.source.as_str().to_string()),
            tool: "bd".to_string(),
        };
    }
    ToolCapabilityStatus {
        availability: "missing".to_string(),
        candidate_paths: Some(
            candidates
                .iter()
                .map(|candidate| candidate.executable_path.to_string_lossy().to_string())
                .collect(),
        ),
        capability: "beadsProjectBoard".to_string(),
        executable_path: None,
        guidance: None,
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
    dedupe_candidates(vec![
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
    ])
}

fn bundled_bd_tool_candidates() -> Vec<ToolCandidate> {
    let gxserver_root = default_gxserver_root();
    let repo_root = gxserver_root
        .parent()
        .unwrap_or(Path::new("."))
        .to_path_buf();
    let inferred_source_root = gxserver_root.join("..").join("..");
    dedupe_candidates(vec![
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
    ])
}

fn default_gxserver_root() -> PathBuf {
    env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("gxserver")
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
