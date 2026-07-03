/*
CDXC:GPUICefPlatformSeam 2026-07-04:
Windowed-CEF module layout: `shell` owns every OS-agnostic piece (runtime
init/shutdown, app/client/bridge handlers, the CefBrowser wrapper) and calls
into exactly one `platform` module for the truly per-OS glue (framework
loading, message-pump scheduling, child-view frame/visibility/focus,
child WindowInfo construction). Each supported OS provides that module via
`#[path]` so shared code never branches on target_os. OSes without an
adapter keep the explicit `unsupported` stub instead of a fallback backend.
*/
pub(crate) mod sidebar_bridge_manifest;

#[cfg(any(target_os = "macos", target_os = "windows"))]
pub(crate) mod shell;

#[cfg(target_os = "macos")]
#[path = "macos.rs"]
mod platform;
#[cfg(target_os = "windows")]
#[path = "windows.rs"]
mod platform;

#[cfg(any(target_os = "macos", target_os = "windows"))]
pub use shell::*;

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod unsupported;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub use unsupported::*;
