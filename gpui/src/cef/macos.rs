use std::{
    ffi::{CString, c_char, c_double, c_int, c_void},
    ptr,
};

use anyhow::{Context as _, Result};
use gpui::{Bounds, Pixels};

#[link(name = "ghostex_gpui_cef_bridge", kind = "static")]
unsafe extern "C" {
    fn GhostexGpuiCEFPrepareApplication();
    fn GhostexCEFInitialize(argc: c_int, argv: *mut *mut c_char) -> bool;
    fn GhostexCEFShutdown();
    fn GhostexGpuiCEFInstallApplicationHooks();
    fn GhostexGpuiCEFLoadFramework() -> bool;
    fn GhostexGpuiCEFInstallMessagePump();
    fn GhostexGpuiCEFCreateBrowserView(
        parent: *mut c_void,
        url: *const c_char,
        profile: *const c_char,
    ) -> *mut c_void;
    fn GhostexGpuiCEFSetBrowserFrame(
        browser: *mut c_void,
        x: c_double,
        y: c_double,
        width: c_double,
        height: c_double,
    );
    fn GhostexGpuiCEFSetBrowserVisible(browser: *mut c_void, visible: bool);
    fn GhostexGpuiCEFLoadURL(browser: *mut c_void, url: *const c_char);
    fn GhostexGpuiCEFReleaseBrowserView(browser: *mut c_void);
}

pub fn prepare_application() {
    unsafe {
        GhostexGpuiCEFPrepareApplication();
    }
}

pub fn initialize() -> Result<()> {
    let args = std::env::args()
        .map(|arg| CString::new(arg).context("process argument contained an interior NUL byte"))
        .collect::<Result<Vec<_>>>()?;
    let mut arg_ptrs = args
        .iter()
        .map(|arg| arg.as_ptr() as *mut c_char)
        .collect::<Vec<_>>();

    unsafe {
        GhostexGpuiCEFInstallApplicationHooks();
    }
    let loaded = unsafe { GhostexGpuiCEFLoadFramework() };
    if !loaded {
        anyhow::bail!("CEF framework could not be loaded from the app bundle");
    }
    let initialized =
        unsafe { GhostexCEFInitialize(arg_ptrs.len() as c_int, arg_ptrs.as_mut_ptr()) };
    if !initialized {
        anyhow::bail!("CEF initialization returned false");
    }
    unsafe {
        GhostexGpuiCEFInstallMessagePump();
    }
    Ok(())
}

#[allow(dead_code)]
pub fn shutdown() {
    unsafe {
        GhostexCEFShutdown();
    }
}

pub struct CefBrowser {
    ptr: *mut c_void,
}

impl CefBrowser {
    pub fn new(parent_ns_view: *mut c_void, url: &str, profile: &str) -> Self {
        let url = c_string(url);
        let profile = c_string(profile);
        let ptr = unsafe {
            GhostexGpuiCEFCreateBrowserView(parent_ns_view, url.as_ptr(), profile.as_ptr())
        };
        Self { ptr }
    }

    pub fn set_bounds(&self, bounds: Bounds<Pixels>) {
        if self.ptr.is_null() {
            return;
        }
        unsafe {
            GhostexGpuiCEFSetBrowserFrame(
                self.ptr,
                bounds.origin.x.as_f32() as c_double,
                bounds.origin.y.as_f32() as c_double,
                bounds.size.width.as_f32() as c_double,
                bounds.size.height.as_f32() as c_double,
            );
        }
    }

    pub fn set_visible(&self, visible: bool) {
        if self.ptr.is_null() {
            return;
        }
        unsafe {
            GhostexGpuiCEFSetBrowserVisible(self.ptr, visible);
        }
    }

    pub fn load_url(&self, url: &str) {
        if self.ptr.is_null() {
            return;
        }
        let url = c_string(url);
        unsafe {
            GhostexGpuiCEFLoadURL(self.ptr, url.as_ptr());
        }
    }
}

impl Drop for CefBrowser {
    fn drop(&mut self) {
        if self.ptr.is_null() {
            return;
        }
        unsafe {
            GhostexGpuiCEFReleaseBrowserView(self.ptr);
        }
        self.ptr = ptr::null_mut();
    }
}

fn c_string(value: &str) -> CString {
    CString::new(value).unwrap_or_else(|_| CString::new("").expect("empty string is valid"))
}
