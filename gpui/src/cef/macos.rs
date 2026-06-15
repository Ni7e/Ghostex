use anyhow::{Context as _, Result};
use cef::rc::Rc as _;
use cef::{
    App, BrowserProcessHandler, CefString, CommandLine, ImplApp, ImplBrowser as _,
    ImplBrowserHost as _, ImplBrowserProcessHandler, ImplCommandLine as _, ImplFrame as _, WrapApp,
    WrapBrowserProcessHandler, wrap_app, wrap_browser_process_handler,
};
use gpui::{Bounds, Pixels};
use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
    ffi::{c_double, c_int, c_longlong, c_void},
    path::PathBuf,
    sync::{Mutex, OnceLock},
};

unsafe extern "C" {
    fn GhostexGpuiCEFPrepareApplication();
    fn GhostexGpuiCEFInstallApplicationHooks();
    fn GhostexGpuiCEFInstallMessagePump();
    fn GhostexGpuiCEFInvalidateMessagePump();
    fn GhostexGpuiCEFScheduleMessagePumpWork(delay_ms: c_longlong);
    fn GhostexGpuiCEFSetNativeViewFrame(
        native_view: *mut c_void,
        x: c_double,
        y: c_double,
        width: c_double,
        height: c_double,
    );
    fn GhostexGpuiCEFSetNativeViewVisible(native_view: *mut c_void, visible: bool);
    fn GhostexGpuiCEFPrepareNativeViewForFocus(native_view: *mut c_void);
    fn GhostexGpuiCEFFocusNativeView(native_view: *mut c_void);
}

struct CefRuntimeState {
    _loader: cef::library_loader::LibraryLoader,
    _app: cef::App,
}

static CEF_RUNTIME: OnceLock<Mutex<Option<CefRuntimeState>>> = OnceLock::new();

thread_local! {
    static CEF_BROWSERS_BY_NATIVE_VIEW: RefCell<HashMap<usize, cef::Browser>> = RefCell::new(HashMap::new());
    static ACTIVE_CEF_NATIVE_VIEW: Cell<Option<usize>> = const { Cell::new(None) };
}

pub fn prepare_application() {
    unsafe {
        GhostexGpuiCEFPrepareApplication();
    }
}

pub fn focus_native_view(native_view: *mut c_void) {
    unsafe {
        GhostexGpuiCEFFocusNativeView(native_view);
    }
}

pub fn initialize() -> Result<()> {
    let state = CEF_RUNTIME.get_or_init(|| Mutex::new(None));
    let mut state = state
        .lock()
        .expect("CEF runtime mutex should not be poisoned");
    if state.is_some() {
        return Ok(());
    }

    let args = cef::args::Args::new();
    let executable = std::env::current_exe().context("failed to resolve GPUI executable path")?;
    let loader = cef::library_loader::LibraryLoader::new(&executable, false);
    if !loader.load() {
        anyhow::bail!("CEF framework could not be loaded from the app bundle");
    }

    let _ = cef::api_hash(cef::sys::CEF_API_VERSION_LAST, 0);
    unsafe { GhostexGpuiCEFInstallApplicationHooks() };

    let mut app = GhostexGpuiCefApp::new();
    let process_exit_code = cef::execute_process(
        Some(args.as_main_args()),
        Some(&mut app),
        std::ptr::null_mut(),
    );
    if process_exit_code >= 0 {
        std::process::exit(process_exit_code);
    }

    let cache_path = cef_cache_path()?;
    let settings = cef::Settings {
        no_sandbox: 1,
        external_message_pump: 1,
        cache_path: cef::CefString::from(cache_path.to_string_lossy().as_ref()),
        root_cache_path: cef::CefString::from(cache_path.to_string_lossy().as_ref()),
        log_severity: cef::LogSeverity::WARNING,
        remote_debugging_port: remote_debugging_port(),
        ..Default::default()
    };

    /*
    CDXC:GPUIPhase1 2026-06-14-15:25:
    The GPUI shell must use Tauri's cef-rs binding path instead of the earlier GhostexCEFBridge.mm browser wrapper. Initialize CEF through cef-rs, keep GPUI as the AppKit loop owner, and scope profile data to the prototype so the React sidebar and main browser share a stable Chromium runtime without production-host coupling.

    CDXC:GPUIPhase1 2026-06-14-16:29:
    GPUI runs a blocking NSApplication loop, so the cef-rs port must use CEF's external_message_pump together with BrowserProcessHandler::on_schedule_message_pump_work. CEF schedules each pump step and the AppKit shim executes it on the main queue, avoiding the Chromium run-loop observer trap caused by an unconditional timer.

    CDXC:GPUIPhase1 2026-06-14-16:54:
    CEF can call on_schedule_message_pump_work during cef::initialize before the first browser is created. Install the GPUI pump gate before initialization so those startup callbacks reach the main queue instead of leaving Chromium partially initialized with only helper processes alive.
    */
    unsafe { GhostexGpuiCEFInstallMessagePump() };
    let initialized = cef::initialize(
        Some(args.as_main_args()),
        Some(&settings),
        Some(&mut app),
        std::ptr::null_mut(),
    );
    if initialized != 1 {
        unsafe { GhostexGpuiCEFInvalidateMessagePump() };
        anyhow::bail!("CEF initialization returned false");
    }

    *state = Some(CefRuntimeState {
        _loader: loader,
        _app: app,
    });
    Ok(())
}

wrap_app! {
    struct GhostexGpuiCefApp;

    impl App {
        fn browser_process_handler(&self) -> Option<BrowserProcessHandler> {
            Some(GhostexGpuiBrowserProcessHandler::new())
        }

        fn on_before_command_line_processing(
            &self,
            _process_type: Option<&CefString>,
            command_line: Option<&mut CommandLine>,
        ) {
            /*
            CDXC:GPUIPhase1 2026-06-14-17:00:
            The GPUI shell is a local prototype and must not block CEF startup on macOS Keychain prompts or locks. Match production Ghostex's CEF switch set by using Chromium's mock keychain and keeping browser subprocesses foreground-capable for embedded child views.
            */
            if let Some(command_line) = command_line {
                command_line.append_switch(Some(&CefString::from("use-mock-keychain")));
                command_line.append_switch(Some(&CefString::from("enable-fullscreen")));
                command_line.append_switch(Some(&CefString::from("allow-insecure-localhost")));
                command_line.append_switch_with_value(
                    Some(&CefString::from("remote-allow-origins")),
                    Some(&CefString::from("*")),
                );
            }
        }
    }
}

wrap_browser_process_handler! {
    struct GhostexGpuiBrowserProcessHandler;

    impl BrowserProcessHandler {
        fn on_before_child_process_launch(&self, command_line: Option<&mut CommandLine>) {
            if let Some(command_line) = command_line {
                command_line.append_switch(Some(&CefString::from("disable-background-mode")));
                command_line.append_switch(Some(&CefString::from(
                    "disable-backgrounding-occluded-windows",
                )));
            }
        }

        fn on_schedule_message_pump_work(&self, delay_ms: i64) {
            unsafe {
                GhostexGpuiCEFScheduleMessagePumpWork(delay_ms as c_longlong);
            }
        }
    }
}

#[allow(dead_code)]
pub fn shutdown() {
    let Some(state) = CEF_RUNTIME.get() else {
        return;
    };
    let mut state = state
        .lock()
        .expect("CEF runtime mutex should not be poisoned");
    if state.take().is_none() {
        return;
    }
    unsafe { GhostexGpuiCEFInvalidateMessagePump() };
    cef::shutdown();
}

pub struct CefBrowser {
    browser: RefCell<cef::Browser>,
    last_bounds: RefCell<Option<cef::Rect>>,
}

impl CefBrowser {
    pub fn new(parent_ns_view: *mut c_void, url: &str, profile: &str) -> Self {
        let _ = profile;
        let initial_bounds = cef::Rect {
            x: 0,
            y: 0,
            width: 1,
            height: 1,
        };
        let window_info =
            cef::WindowInfo::default().set_as_child(parent_ns_view.cast(), &initial_bounds);
        let browser_settings = cef::BrowserSettings::default();
        let url = cef::CefString::from(url);
        let browser = cef::browser_host_create_browser_sync(
            Some(&window_info),
            None::<&mut cef::Client>,
            Some(&url),
            Some(&browser_settings),
            None,
            None,
        )
        .expect("failed to create cef-rs child browser");
        if let Some(host) = browser.host() {
            let native_view = host.window_handle();
            unsafe {
                GhostexGpuiCEFPrepareNativeViewForFocus(native_view.cast());
            }
            register_native_view_browser(native_view.cast(), &browser);
        }

        Self {
            browser: RefCell::new(browser),
            last_bounds: RefCell::new(None),
        }
    }

    pub fn set_bounds(&self, bounds: Bounds<Pixels>) {
        let rect = cef::Rect {
            x: bounds.origin.x.as_f32().round() as i32,
            y: bounds.origin.y.as_f32().round() as i32,
            width: bounds.size.width.as_f32().round().max(0.0) as i32,
            height: bounds.size.height.as_f32().round().max(0.0) as i32,
        };
        {
            let mut last_bounds = self.last_bounds.borrow_mut();
            if last_bounds.as_ref().is_some_and(|last| {
                last.x == rect.x
                    && last.y == rect.y
                    && last.width == rect.width
                    && last.height == rect.height
            }) {
                return;
            }
            *last_bounds = Some(rect.clone());
        }

        let browser = self.browser.borrow();
        let Some(host) = browser.host() else {
            return;
        };
        let native_view = host.window_handle();
        unsafe {
            /*
            CDXC:GPUIPhase1 2026-06-14-15:25:
            Match Tauri's CEF child-view model: cef-rs owns the browser host while a thin platform adapter positions the native child view inside the GPUI-owned parent. The shim respects the parent NSView's flipped coordinate system so CEF never overlaps GPUI chrome or sibling surfaces.
            */
            GhostexGpuiCEFSetNativeViewFrame(
                native_view.cast(),
                rect.x as c_double,
                rect.y as c_double,
                rect.width as c_double,
                rect.height as c_double,
            );
        }
        host.was_resized();
    }

    pub fn set_visible(&self, visible: bool) {
        let browser = self.browser.borrow();
        let Some(host) = browser.host() else {
            return;
        };
        unsafe {
            GhostexGpuiCEFSetNativeViewVisible(host.window_handle().cast(), visible);
        }
    }

    pub fn focus(&self) {
        let browser = self.browser.borrow();
        let Some(host) = browser.host() else {
            return;
        };
        /*
        CDXC:GPUIPhase1 2026-06-14-16:31:
        Web-page text fields inside CEF must regain both AppKit first-responder ownership and Chromium browser focus after GPUI chrome has been focused. Without this handoff, macOS command shortcuts such as Cmd+A can stay routed to GPUI instead of selecting text in the active page input.
        */
        unsafe {
            GhostexGpuiCEFFocusNativeView(host.window_handle().cast());
        }
        host.set_focus(1);
    }

    pub fn select_all(&self) {
        self.focus();
        let browser = self.browser.borrow();
        select_all_in_browser(&browser);
    }

    pub fn load_url(&self, url: &str) {
        let browser = self.browser.borrow();
        if let Some(frame) = browser.main_frame() {
            frame.load_url(Some(&cef::CefString::from(url)));
        }
    }
}

impl Drop for CefBrowser {
    fn drop(&mut self) {
        if let Some(host) = self.browser.borrow().host() {
            unregister_native_view_browser(host.window_handle().cast());
            host.close_browser(1);
            for _ in 0..50 {
                cef::do_message_loop_work();
            }
        }
    }
}

fn cef_cache_path() -> Result<PathBuf> {
    let path = std::env::var_os("GHOSTEX_GPUI_CEF_CACHE_DIR")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".ghostex-gpui/cef"))
        })
        .unwrap_or_else(|| std::env::temp_dir().join("ghostex-gpui/cef"));
    std::fs::create_dir_all(&path).context("failed to create GPUI CEF cache directory")?;
    Ok(path)
}

fn remote_debugging_port() -> i32 {
    std::env::var("GHOSTEX_GPUI_CEF_REMOTE_DEBUGGING_PORT")
        .ok()
        .and_then(|value| value.parse::<i32>().ok())
        .filter(|port| *port > 0)
        .unwrap_or(9334)
}

fn register_native_view_browser(native_view: *mut c_void, browser: &cef::Browser) {
    if native_view.is_null() {
        return;
    }

    CEF_BROWSERS_BY_NATIVE_VIEW.with(|browsers| {
        browsers
            .borrow_mut()
            .insert(native_view as usize, browser.clone());
    });
}

fn unregister_native_view_browser(native_view: *mut c_void) {
    if native_view.is_null() {
        return;
    }

    CEF_BROWSERS_BY_NATIVE_VIEW.with(|browsers| {
        browsers.borrow_mut().remove(&(native_view as usize));
    });
    ACTIVE_CEF_NATIVE_VIEW.with(|active| {
        if active.get() == Some(native_view as usize) {
            active.set(None);
        }
    });
}

fn select_all_in_browser(browser: &cef::Browser) -> bool {
    if let Some(frame) = browser.focused_frame().or_else(|| browser.main_frame()) {
        frame.select_all();
        true
    } else {
        false
    }
}

fn select_all_for_native_view(native_view: *mut c_void) -> c_int {
    if native_view.is_null() {
        return 0;
    }

    let browser = CEF_BROWSERS_BY_NATIVE_VIEW
        .with(|browsers| browsers.borrow().get(&(native_view as usize)).cloned());
    let Some(browser) = browser else {
        return 0;
    };

    ACTIVE_CEF_NATIVE_VIEW.with(|active| active.set(Some(native_view as usize)));

    if let Some(host) = browser.host() {
        unsafe {
            GhostexGpuiCEFFocusNativeView(host.window_handle().cast());
        }
        host.set_focus(1);
    }

    if select_all_in_browser(&browser) {
        1
    } else {
        0
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn GhostexGpuiCEFDoMessageLoopWork() {
    cef::do_message_loop_work();
}

#[unsafe(no_mangle)]
pub extern "C" fn GhostexGpuiCEFHandleSelectAllForNativeView(native_view: *mut c_void) -> c_int {
    /*
    CDXC:GPUIPhase1 2026-06-14-17:25:
    Native AppKit command dispatch can reach CEF's NSView even when GPUI still remembers the address input as its focused element. Keep a main-thread native-view to cef-rs browser registry so the standard selectAll: command can call Chromium's Frame::select_all for the focused page field instead of selecting GPUI chrome.
    */
    select_all_for_native_view(native_view)
}

#[unsafe(no_mangle)]
pub extern "C" fn GhostexGpuiCEFHandleSelectAllForActiveNativeView() -> c_int {
    let native_view = ACTIVE_CEF_NATIVE_VIEW.with(|active| active.get());
    let Some(native_view) = native_view else {
        return 0;
    };
    select_all_for_native_view(native_view as *mut c_void)
}

#[unsafe(no_mangle)]
pub extern "C" fn GhostexGpuiCEFMarkNativeViewFocused(native_view: *mut c_void) -> c_int {
    if native_view.is_null() {
        return 0;
    }

    let is_cef_view = CEF_BROWSERS_BY_NATIVE_VIEW
        .with(|browsers| browsers.borrow().contains_key(&(native_view as usize)));
    if !is_cef_view {
        return 0;
    }

    ACTIVE_CEF_NATIVE_VIEW.with(|active| active.set(Some(native_view as usize)));
    1
}

#[unsafe(no_mangle)]
pub extern "C" fn GhostexGpuiCEFClearActiveNativeView() {
    ACTIVE_CEF_NATIVE_VIEW.with(|active| active.set(None));
}
