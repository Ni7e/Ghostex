use anyhow::Result;
use gpui::{Bounds, Pixels};
use std::rc::Rc;

pub fn prepare_application() {}

pub fn initialize() -> Result<()> {
    /*
    CDXC:GPUIPhase1 2026-06-14-12:06:
    Phase 1 is macOS-first, but the app structure must make Linux and Windows CEF support a platform backend decision instead of mixing platform checks into UI code. Non-macOS builds fail explicitly until their CEF child-window implementations are added.
    */
    anyhow::bail!("CEF phase 1 currently has only a macOS backend")
}

pub type BrowserPopupOpenHandler = Rc<dyn Fn(String)>;

pub enum BrowserPageMetadataEvent {
    AddressChanged(String),
    FaviconUrlChanged(Option<String>),
    TitleChanged(String),
}

pub type BrowserPageMetadataHandler = Rc<dyn Fn(BrowserPageMetadataEvent)>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SidebarBridgeEvent {
    ActiveProjectContext(String),
    SourceWorkareaReadiness(String),
    BrowserWorkareaReadiness(String),
    ProjectWorkareaReadiness(String),
    ManageFileWorkareaOperationRequest(String),
}

pub type SidebarBridgeEventHandler = Rc<dyn Fn(SidebarBridgeEvent)>;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SidebarRuntimeSettingsSnapshot {
    pub debugging_mode: bool,
    pub show_beta_features: bool,
}

pub struct CefBrowser;

impl CefBrowser {
    pub fn new(
        _parent_ns_view: *mut std::ffi::c_void,
        _url: &str,
        _profile: &str,
        _popup_open_handler: Option<BrowserPopupOpenHandler>,
        _page_metadata_handler: Option<BrowserPageMetadataHandler>,
        _sidebar_runtime_settings: Option<SidebarRuntimeSettingsSnapshot>,
        _sidebar_bridge_event_handler: Option<SidebarBridgeEventHandler>,
    ) -> Self {
        Self
    }

    pub fn set_bounds(&self, _bounds: Bounds<Pixels>) {}

    pub fn set_visible(&self, _visible: bool) {}

    pub fn focus(&self) {
        /*
        CDXC:GPUIBrowserBackendParity 2026-06-23-12:48:
        Non-macOS CEF is still an explicit unsupported backend, but the stub must keep the same public Browser runtime API as macOS so shared GPUI source can express focus handoff without platform-specific UI branches. This no-op does not create a fallback browser, synthetic focus, logging, persistence, or native hit routing.
        */
    }

    pub fn blur(&self) {}

    pub fn load_url(&self, _url: &str) {}

    pub fn select_all(&self) {}

    pub fn execute_java_script_in_main_frame(&self, _script: &str) -> bool {
        false
    }

    pub fn refresh_sidebar_runtime_settings(
        &self,
        _runtime_settings: SidebarRuntimeSettingsSnapshot,
    ) {
    }

    pub fn can_go_back(&self) -> bool {
        false
    }

    pub fn go_back(&self) {}

    pub fn can_go_forward(&self) -> bool {
        false
    }

    pub fn go_forward(&self) {}

    pub fn reload(&self) {}

    pub fn zoom_level(&self) -> f64 {
        0.0
    }

    pub fn reset_zoom(&self) {}

    pub fn toggle_dev_tools(&self) {}
}
