use anyhow::Result;
use gpui::{Bounds, Pixels};

pub fn prepare_application() {}

pub fn initialize() -> Result<()> {
    /*
    CDXC:GPUIPhase1 2026-06-14-12:06:
    Phase 1 is macOS-first, but the app structure must make Linux and Windows CEF support a platform backend decision instead of mixing platform checks into UI code. Non-macOS builds fail explicitly until their CEF child-window implementations are added.
    */
    anyhow::bail!("CEF phase 1 currently has only a macOS backend")
}

pub struct CefBrowser;

impl CefBrowser {
    pub fn new(_parent_ns_view: *mut std::ffi::c_void, _url: &str, _profile: &str) -> Self {
        Self
    }

    pub fn set_bounds(&self, _bounds: Bounds<Pixels>) {}

    pub fn set_visible(&self, _visible: bool) {}

    pub fn load_url(&self, _url: &str) {}
}
