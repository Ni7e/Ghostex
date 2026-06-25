use anyhow::{Context as _, Result};
use cef::rc::Rc as _;
use cef::{
    App, BrowserProcessHandler, BrowserSettings, CefString, Client, CommandLine, DictionaryValue,
    DisplayHandler, Frame, ImplApp, ImplBrowser as _, ImplBrowserHost as _,
    ImplBrowserProcessHandler, ImplClient, ImplCommandLine as _, ImplDisplayHandler,
    ImplFrame as _, ImplLifeSpanHandler, ImplListValue as _, ImplLoadHandler,
    ImplProcessMessage as _, ImplRenderProcessHandler, ImplV8Context as _, ImplV8Handler,
    ImplV8Value as _, LifeSpanHandler, LoadHandler, PopupFeatures, ProcessId, ProcessMessage,
    RenderProcessHandler, V8Handler, V8Propertyattribute, V8Value, ValueType, WindowInfo,
    WindowOpenDisposition, WrapApp, WrapBrowserProcessHandler, WrapClient, WrapDisplayHandler,
    WrapLifeSpanHandler, WrapLoadHandler, WrapRenderProcessHandler, WrapV8Handler, wrap_app,
    wrap_browser_process_handler, wrap_client, wrap_display_handler, wrap_life_span_handler,
    wrap_load_handler, wrap_render_process_handler, wrap_v8_handler,
};
use gpui::{Bounds, Pixels};
use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
    ffi::{c_double, c_int, c_longlong, c_void},
    path::PathBuf,
    rc::Rc as StdRc,
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
const SIDEBAR_PROJECT_CONTEXT_PROCESS_MESSAGE_NAME: &str =
    "ghostex.gpui.sidebar.activeProjectContext";
const SIDEBAR_SOURCE_WORKAREA_READINESS_PROCESS_MESSAGE_NAME: &str =
    "ghostex.gpui.sidebar.sourceWorkareaReadiness";
const SIDEBAR_BROWSER_WORKAREA_READINESS_PROCESS_MESSAGE_NAME: &str =
    "ghostex.gpui.sidebar.browserWorkareaReadiness";
const SIDEBAR_PROJECT_WORKAREA_READINESS_PROCESS_MESSAGE_NAME: &str =
    "ghostex.gpui.sidebar.projectWorkareaReadiness";
const SIDEBAR_MANAGE_FILE_WORKAREA_OPERATION_REQUEST_PROCESS_MESSAGE_NAME: &str =
    "ghostex.gpui.sidebar.manageFileWorkareaOperationRequest";
const SIDEBAR_NATIVE_PROJECT_PATH_ACTION_PROCESS_MESSAGE_NAME: &str =
    "ghostex.gpui.sidebar.nativeProjectPathAction";
const SIDEBAR_COMMAND_ACTION_PROCESS_MESSAGE_NAME: &str = "ghostex.gpui.sidebar.commandAction";
const SIDEBAR_COMMAND_RUN_END_PROCESS_MESSAGE_NAME: &str = "ghostex.gpui.sidebar.commandRunEnd";
const SIDEBAR_GXSERVER_FOCUS_STATE_PROCESS_MESSAGE_NAME: &str =
    "ghostex.gpui.sidebar.gxserverPresentationFocusState";
const SIDEBAR_PROJECT_CONTEXT_INSTALL_MESSAGE_NAME: &str =
    "ghostex.gpui.sidebar.installActiveProjectContextBridge";
const SIDEBAR_RUNTIME_SETTINGS_UPDATE_MESSAGE_NAME: &str =
    "ghostex.gpui.sidebar.runtimeSettingsChanged";
const SIDEBAR_GXSERVER_BOOTSTRAP_UPDATE_MESSAGE_NAME: &str =
    "ghostex.gpui.sidebar.gxserverBootstrapChanged";
const SIDEBAR_PROJECT_CONTEXT_JS_NAMESPACE: &str = "ghostexGpui";
const SIDEBAR_PROJECT_CONTEXT_JS_FUNCTION: &str = "postActiveProjectContext";
const SIDEBAR_SOURCE_WORKAREA_READINESS_JS_FUNCTION: &str = "postSourceWorkareaReadiness";
const SIDEBAR_BROWSER_WORKAREA_READINESS_JS_FUNCTION: &str = "postBrowserWorkareaReadiness";
const SIDEBAR_PROJECT_WORKAREA_READINESS_JS_FUNCTION: &str = "postProjectWorkareaReadiness";
const SIDEBAR_MANAGE_FILE_WORKAREA_OPERATION_REQUEST_JS_FUNCTION: &str =
    "postManageFileWorkareaOperationRequest";
const SIDEBAR_NATIVE_PROJECT_PATH_ACTION_JS_FUNCTION: &str = "postNativeProjectPathAction";
const SIDEBAR_COMMAND_ACTION_JS_FUNCTION: &str = "postSidebarCommandAction";
const SIDEBAR_COMMAND_RUN_END_JS_FUNCTION: &str = "postSidebarCommandRunEnd";
const SIDEBAR_GXSERVER_FOCUS_STATE_JS_FUNCTION: &str = "postGxserverPresentationFocusState";
const SIDEBAR_RUNTIME_SETTINGS_JS_OBJECT: &str = "runtimeSettings";
const SIDEBAR_RUNTIME_SETTINGS_CHANGED_JS_CALLBACK: &str = "onRuntimeSettingsChanged";
const SIDEBAR_RUNTIME_SETTINGS_DEBUGGING_MODE_JS_FIELD: &str = "debuggingMode";
const SIDEBAR_RUNTIME_SETTINGS_SHOW_BETA_FEATURES_JS_FIELD: &str = "showBetaFeatures";
const SIDEBAR_RUNTIME_SETTINGS_SAVED_SETTINGS_JS_FIELD: &str = "settings";
const SIDEBAR_GXSERVER_BOOTSTRAP_JS_OBJECT: &str = "gxserverBootstrap";
const SIDEBAR_GXSERVER_BOOTSTRAP_CHANGED_JS_CALLBACK: &str = "onGxserverBootstrapChanged";
const SIDEBAR_GXSERVER_BOOTSTRAP_BASE_URL_JS_FIELD: &str = "baseUrl";
const SIDEBAR_GXSERVER_BOOTSTRAP_AUTH_TOKEN_JS_FIELD: &str = "authToken";
const SIDEBAR_GXSERVER_BOOTSTRAP_PROTOCOL_VERSION_JS_FIELD: &str = "protocolVersion";
const SIDEBAR_GXSERVER_BOOTSTRAP_CLIENT_ID_JS_FIELD: &str = "clientId";
const SIDEBAR_GXSERVER_BOOTSTRAP_INITIAL_ACTIVE_PROJECT_ID_JS_FIELD: &str =
    "initialActiveProjectId";
const SIDEBAR_GXSERVER_BOOTSTRAP_FOCUSED_SESSION_ID_JS_FIELD: &str = "focusedSessionId";
const SIDEBAR_GXSERVER_BOOTSTRAP_VISIBLE_SESSION_IDS_JS_FIELD: &str = "visibleSessionIds";
const PROJECT_WORKAREA_BRIDGE_INSTALL_MESSAGE_NAME: &str =
    "ghostex.gpui.projectWorkarea.installBridge";
const PROJECT_WORKAREA_PROJECT_BEADS_REQUEST_PROCESS_MESSAGE_NAME: &str =
    "ghostex.gpui.projectWorkarea.projectBeadsRequest";
const PROJECT_WORKAREA_PROJECT_BOARD_REQUEST_PROCESS_MESSAGE_NAME: &str =
    "ghostex.gpui.projectWorkarea.projectBoardRequest";
const PROJECT_WORKAREA_PROJECT_BOARD_IMAGE_REQUEST_PROCESS_MESSAGE_NAME: &str =
    "ghostex.gpui.projectWorkarea.projectBoardImageRequest";
const PROJECT_WORKAREA_MANAGE_FILES_REQUEST_PROCESS_MESSAGE_NAME: &str =
    "ghostex.gpui.projectWorkarea.manageFilesRequest";
const PROJECT_WORKAREA_PROJECT_BEADS_REQUEST_JS_FUNCTION: &str = "postProjectBeadsRequest";
const PROJECT_WORKAREA_PROJECT_BOARD_REQUEST_JS_FUNCTION: &str = "postProjectBoardRequest";
const PROJECT_WORKAREA_PROJECT_BOARD_IMAGE_REQUEST_JS_FUNCTION: &str =
    "postProjectBoardImageRequest";
const PROJECT_WORKAREA_MANAGE_FILES_REQUEST_JS_FUNCTION: &str = "postManageFilesRequest";
const APP_MODAL_HOST_BRIDGE_PROCESS_MESSAGE_NAME: &str = "ghostex.gpui.appModalHost.message";
const APP_MODAL_HOST_SURFACE_JS_FIELD: &str = "__ghostex_APP_MODAL_HOST_SURFACE__";
const APP_MODAL_HOST_ID_JS_FIELD: &str = "__ghostex_APP_MODAL_HOST_ID__";
const APP_MODAL_HOST_SURFACE_VALUE: &str = "nativeWindow";
const APP_MODAL_HOST_ID_VALUE: &str = "gpui";
const WEBKIT_JS_OBJECT: &str = "webkit";
const WEBKIT_MESSAGE_HANDLERS_JS_OBJECT: &str = "messageHandlers";
const WEBKIT_APP_MODAL_HOST_MESSAGE_HANDLER_JS_OBJECT: &str = "ghostexAppModalHost";
const WEBKIT_POST_MESSAGE_JS_FUNCTION: &str = "postMessage";
const SIDEBAR_RUNTIME_SETTINGS_DEBUGGING_MODE_ARGUMENT_INDEX: usize = 0;
const SIDEBAR_RUNTIME_SETTINGS_SHOW_BETA_FEATURES_ARGUMENT_INDEX: usize = 1;
const SIDEBAR_RUNTIME_SETTINGS_SAVED_SETTINGS_JSON_ARGUMENT_INDEX: usize = 2;
const SIDEBAR_RUNTIME_SETTINGS_ARGUMENT_COUNT: usize = 3;
const SIDEBAR_RUNTIME_SETTINGS_SAVED_SETTINGS_JSON_MAX_CHARS: usize = 1024 * 1024;
const SIDEBAR_GXSERVER_BOOTSTRAP_PRESENT_ARGUMENT_INDEX: usize = 0;
const SIDEBAR_GXSERVER_BOOTSTRAP_BASE_URL_ARGUMENT_INDEX: usize = 1;
const SIDEBAR_GXSERVER_BOOTSTRAP_AUTH_TOKEN_ARGUMENT_INDEX: usize = 2;
const SIDEBAR_GXSERVER_BOOTSTRAP_PROTOCOL_VERSION_ARGUMENT_INDEX: usize = 3;
const SIDEBAR_GXSERVER_BOOTSTRAP_CLIENT_ID_ARGUMENT_INDEX: usize = 4;
const SIDEBAR_GXSERVER_BOOTSTRAP_INITIAL_ACTIVE_PROJECT_ID_ARGUMENT_INDEX: usize = 5;
const SIDEBAR_GXSERVER_BOOTSTRAP_FOCUSED_SESSION_ID_ARGUMENT_INDEX: usize = 6;
const SIDEBAR_GXSERVER_BOOTSTRAP_VISIBLE_SESSION_COUNT_ARGUMENT_INDEX: usize = 7;
const SIDEBAR_GXSERVER_BOOTSTRAP_ARGUMENT_COUNT_WITHOUT_VISIBLE_IDS: usize = 8;
const SIDEBAR_BRIDGE_PAYLOAD_MAX_CHARS: usize = 32 * 1024;
const PROJECT_WORKAREA_BRIDGE_PAYLOAD_MAX_CHARS: usize = 3 * 1024 * 1024;
const APP_MODAL_HOST_BRIDGE_PAYLOAD_MAX_CHARS: usize = 1024 * 1024;
const BROWSER_APP_OWNED_SCRIPT_URL: &str = "ghostex://gpui/browser-feedback";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SidebarBridgeEventKind {
    ActiveProjectContext,
    SourceWorkareaReadiness,
    BrowserWorkareaReadiness,
    ProjectWorkareaReadiness,
    ManageFileWorkareaOperationRequest,
    NativeProjectPathAction,
    SidebarCommandAction,
    SidebarCommandRunEnd,
    GxserverPresentationFocusState,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct SidebarBridgeFunctionSpec {
    js_function_name: &'static str,
    process_message_name: &'static str,
    event_kind: SidebarBridgeEventKind,
}

const SIDEBAR_BRIDGE_FUNCTION_SPECS: [SidebarBridgeFunctionSpec; 9] = [
    SidebarBridgeFunctionSpec {
        js_function_name: SIDEBAR_PROJECT_CONTEXT_JS_FUNCTION,
        process_message_name: SIDEBAR_PROJECT_CONTEXT_PROCESS_MESSAGE_NAME,
        event_kind: SidebarBridgeEventKind::ActiveProjectContext,
    },
    SidebarBridgeFunctionSpec {
        js_function_name: SIDEBAR_SOURCE_WORKAREA_READINESS_JS_FUNCTION,
        process_message_name: SIDEBAR_SOURCE_WORKAREA_READINESS_PROCESS_MESSAGE_NAME,
        event_kind: SidebarBridgeEventKind::SourceWorkareaReadiness,
    },
    SidebarBridgeFunctionSpec {
        js_function_name: SIDEBAR_BROWSER_WORKAREA_READINESS_JS_FUNCTION,
        process_message_name: SIDEBAR_BROWSER_WORKAREA_READINESS_PROCESS_MESSAGE_NAME,
        event_kind: SidebarBridgeEventKind::BrowserWorkareaReadiness,
    },
    SidebarBridgeFunctionSpec {
        js_function_name: SIDEBAR_PROJECT_WORKAREA_READINESS_JS_FUNCTION,
        process_message_name: SIDEBAR_PROJECT_WORKAREA_READINESS_PROCESS_MESSAGE_NAME,
        event_kind: SidebarBridgeEventKind::ProjectWorkareaReadiness,
    },
    SidebarBridgeFunctionSpec {
        js_function_name: SIDEBAR_MANAGE_FILE_WORKAREA_OPERATION_REQUEST_JS_FUNCTION,
        process_message_name: SIDEBAR_MANAGE_FILE_WORKAREA_OPERATION_REQUEST_PROCESS_MESSAGE_NAME,
        event_kind: SidebarBridgeEventKind::ManageFileWorkareaOperationRequest,
    },
    SidebarBridgeFunctionSpec {
        js_function_name: SIDEBAR_NATIVE_PROJECT_PATH_ACTION_JS_FUNCTION,
        process_message_name: SIDEBAR_NATIVE_PROJECT_PATH_ACTION_PROCESS_MESSAGE_NAME,
        event_kind: SidebarBridgeEventKind::NativeProjectPathAction,
    },
    SidebarBridgeFunctionSpec {
        js_function_name: SIDEBAR_COMMAND_ACTION_JS_FUNCTION,
        process_message_name: SIDEBAR_COMMAND_ACTION_PROCESS_MESSAGE_NAME,
        event_kind: SidebarBridgeEventKind::SidebarCommandAction,
    },
    SidebarBridgeFunctionSpec {
        js_function_name: SIDEBAR_COMMAND_RUN_END_JS_FUNCTION,
        process_message_name: SIDEBAR_COMMAND_RUN_END_PROCESS_MESSAGE_NAME,
        event_kind: SidebarBridgeEventKind::SidebarCommandRunEnd,
    },
    SidebarBridgeFunctionSpec {
        js_function_name: SIDEBAR_GXSERVER_FOCUS_STATE_JS_FUNCTION,
        process_message_name: SIDEBAR_GXSERVER_FOCUS_STATE_PROCESS_MESSAGE_NAME,
        event_kind: SidebarBridgeEventKind::GxserverPresentationFocusState,
    },
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ProjectWorkareaBridgeEventKind {
    ProjectBeadsRequest,
    ProjectBoardRequest,
    ProjectBoardImageRequest,
    ManageFilesRequest,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ProjectWorkareaBridgeFunctionSpec {
    js_function_name: &'static str,
    process_message_name: &'static str,
    event_kind: ProjectWorkareaBridgeEventKind,
}

const PROJECT_WORKAREA_BRIDGE_FUNCTION_SPECS: [ProjectWorkareaBridgeFunctionSpec; 4] = [
    ProjectWorkareaBridgeFunctionSpec {
        js_function_name: PROJECT_WORKAREA_PROJECT_BEADS_REQUEST_JS_FUNCTION,
        process_message_name: PROJECT_WORKAREA_PROJECT_BEADS_REQUEST_PROCESS_MESSAGE_NAME,
        event_kind: ProjectWorkareaBridgeEventKind::ProjectBeadsRequest,
    },
    ProjectWorkareaBridgeFunctionSpec {
        js_function_name: PROJECT_WORKAREA_PROJECT_BOARD_REQUEST_JS_FUNCTION,
        process_message_name: PROJECT_WORKAREA_PROJECT_BOARD_REQUEST_PROCESS_MESSAGE_NAME,
        event_kind: ProjectWorkareaBridgeEventKind::ProjectBoardRequest,
    },
    ProjectWorkareaBridgeFunctionSpec {
        js_function_name: PROJECT_WORKAREA_PROJECT_BOARD_IMAGE_REQUEST_JS_FUNCTION,
        process_message_name: PROJECT_WORKAREA_PROJECT_BOARD_IMAGE_REQUEST_PROCESS_MESSAGE_NAME,
        event_kind: ProjectWorkareaBridgeEventKind::ProjectBoardImageRequest,
    },
    ProjectWorkareaBridgeFunctionSpec {
        js_function_name: PROJECT_WORKAREA_MANAGE_FILES_REQUEST_JS_FUNCTION,
        process_message_name: PROJECT_WORKAREA_MANAGE_FILES_REQUEST_PROCESS_MESSAGE_NAME,
        event_kind: ProjectWorkareaBridgeEventKind::ManageFilesRequest,
    },
];

#[derive(Clone, Copy, PartialEq, Eq)]
enum BrowserPopupDispatchPolicy {
    DispatchShellOpen,
    HandleWithoutDispatch,
}

impl BrowserPopupDispatchPolicy {
    /*
    CDXC:GPUIBrowserRuntimePolicy 2026-06-23-12:48:
    The CEF backend must mirror the shell popup policy before crossing into GPUI app state. Non-empty target URLs dispatch the shell-owned Browser tab path; empty targets are handled inside CEF with no shell callback, no address-only tab, no content transfer fallback, no filesystem/browser-store access, and no URL/title/page logging.
    */
    fn for_target_url(target_url: &str) -> Self {
        if target_url.trim().is_empty() {
            Self::HandleWithoutDispatch
        } else {
            Self::DispatchShellOpen
        }
    }

    fn dispatches_shell_open(self) -> bool {
        matches!(self, Self::DispatchShellOpen)
    }
}

fn browser_popup_target_url_for_shell(target_url: Option<&CefString>) -> Option<String> {
    let requested_url = target_url.map(CefString::to_string).unwrap_or_default();
    BrowserPopupDispatchPolicy::for_target_url(&requested_url)
        .dispatches_shell_open()
        .then_some(requested_url)
}

fn is_gpui_first_party_cef_entry_url(url: &str, entry_file_name: &str) -> bool {
    let Some(base) = url.split(['?', '#']).next() else {
        return false;
    };
    base.starts_with("file://")
        && base.ends_with(&format!("/{entry_file_name}"))
        && (base.contains("/Contents/Resources/sidebar/") || base.contains("/dist/sidebar/"))
}

fn is_app_modal_host_frame_url(url: &str) -> bool {
    is_gpui_first_party_cef_entry_url(url, "modal-host.html")
}

fn is_gpui_titlebar_host_frame_url(url: &str) -> bool {
    is_gpui_first_party_cef_entry_url(url, "titlebar-host.html")
}

fn is_gpui_sidebar_frame_url(url: &str) -> bool {
    is_gpui_first_party_cef_entry_url(url, "index.html")
}

thread_local! {
    static CEF_BROWSERS_BY_NATIVE_VIEW: RefCell<HashMap<usize, cef::Browser>> = RefCell::new(HashMap::new());
    static CEF_REQUEST_CONTEXTS_BY_PROFILE: RefCell<HashMap<String, cef::RequestContext>> = RefCell::new(HashMap::new());
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

pub type BrowserPopupOpenHandler = StdRc<dyn Fn(String)>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SidebarBridgeEvent {
    ActiveProjectContext(String),
    SourceWorkareaReadiness(String),
    BrowserWorkareaReadiness(String),
    ProjectWorkareaReadiness(String),
    ManageFileWorkareaOperationRequest(String),
    NativeProjectPathAction(String),
    SidebarCommandAction(String),
    SidebarCommandRunEnd(String),
    GxserverPresentationFocusState(String),
}

pub type SidebarBridgeEventHandler = StdRc<dyn Fn(SidebarBridgeEvent)>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProjectWorkareaBridgeEvent {
    ProjectBeadsRequest(String),
    ProjectBoardRequest(String),
    ProjectBoardImageRequest(String),
    ManageFilesRequest(String),
}

pub type ProjectWorkareaBridgeEventHandler = StdRc<dyn Fn(ProjectWorkareaBridgeEvent)>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AppModalHostBridgeEvent {
    Message(String),
}

pub type AppModalHostBridgeEventHandler = StdRc<dyn Fn(AppModalHostBridgeEvent)>;

impl SidebarBridgeEventKind {
    fn with_payload(self, payload: String) -> SidebarBridgeEvent {
        match self {
            Self::ActiveProjectContext => SidebarBridgeEvent::ActiveProjectContext(payload),
            Self::SourceWorkareaReadiness => SidebarBridgeEvent::SourceWorkareaReadiness(payload),
            Self::BrowserWorkareaReadiness => SidebarBridgeEvent::BrowserWorkareaReadiness(payload),
            Self::ProjectWorkareaReadiness => SidebarBridgeEvent::ProjectWorkareaReadiness(payload),
            Self::ManageFileWorkareaOperationRequest => {
                SidebarBridgeEvent::ManageFileWorkareaOperationRequest(payload)
            }
            Self::NativeProjectPathAction => SidebarBridgeEvent::NativeProjectPathAction(payload),
            Self::SidebarCommandAction => SidebarBridgeEvent::SidebarCommandAction(payload),
            Self::SidebarCommandRunEnd => SidebarBridgeEvent::SidebarCommandRunEnd(payload),
            Self::GxserverPresentationFocusState => {
                SidebarBridgeEvent::GxserverPresentationFocusState(payload)
            }
        }
    }
}

fn sidebar_bridge_function_spec_for_js_function(
    function_name: &str,
) -> Option<&'static SidebarBridgeFunctionSpec> {
    SIDEBAR_BRIDGE_FUNCTION_SPECS
        .iter()
        .find(|spec| spec.js_function_name == function_name)
}

fn sidebar_bridge_event_kind_for_process_message(
    process_message_name: &str,
) -> Option<SidebarBridgeEventKind> {
    SIDEBAR_BRIDGE_FUNCTION_SPECS
        .iter()
        .find(|spec| spec.process_message_name == process_message_name)
        .map(|spec| spec.event_kind)
}

fn sidebar_bridge_installed_for_handler(handler_present: bool) -> bool {
    handler_present
}

impl ProjectWorkareaBridgeEventKind {
    fn with_payload(self, payload: String) -> ProjectWorkareaBridgeEvent {
        match self {
            Self::ProjectBeadsRequest => ProjectWorkareaBridgeEvent::ProjectBeadsRequest(payload),
            Self::ProjectBoardRequest => ProjectWorkareaBridgeEvent::ProjectBoardRequest(payload),
            Self::ProjectBoardImageRequest => {
                ProjectWorkareaBridgeEvent::ProjectBoardImageRequest(payload)
            }
            Self::ManageFilesRequest => ProjectWorkareaBridgeEvent::ManageFilesRequest(payload),
        }
    }
}

fn project_workarea_bridge_function_spec_for_js_function(
    function_name: &str,
) -> Option<&'static ProjectWorkareaBridgeFunctionSpec> {
    PROJECT_WORKAREA_BRIDGE_FUNCTION_SPECS
        .iter()
        .find(|spec| spec.js_function_name == function_name)
}

fn project_workarea_bridge_event_kind_for_process_message(
    process_message_name: &str,
) -> Option<ProjectWorkareaBridgeEventKind> {
    PROJECT_WORKAREA_BRIDGE_FUNCTION_SPECS
        .iter()
        .find(|spec| spec.process_message_name == process_message_name)
        .map(|spec| spec.event_kind)
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SidebarRuntimeSettingsSnapshot {
    pub debugging_mode: bool,
    pub show_beta_features: bool,
    pub saved_settings_json: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SidebarGxserverBootstrap {
    pub base_url: String,
    pub auth_token: String,
    pub protocol_version: i32,
    pub client_id: String,
    pub initial_active_project_id: Option<String>,
    pub focused_session_id: Option<String>,
    pub visible_session_ids: Vec<String>,
}

pub enum BrowserPageMetadataEvent {
    AddressChanged(String),
    FaviconUrlChanged(Option<String>),
    TitleChanged(String),
}

pub type BrowserPageMetadataHandler = StdRc<dyn Fn(BrowserPageMetadataEvent)>;

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

    let root_cache_path = cef_root_cache_path()?;
    /*
    CDXC:GPUIPrivacyAudit 2026-06-23-13:18:
    Phase 10 persistence re-audit keeps Browser profile storage memory-backed while avoiding CEF's default user-data directory. Set only root_cache_path for CEF installation metadata, leave cache_path/log_file empty, disable CEF file logging, and keep Chromium runtime data such as cookies, history, page cache, URLs, titles, and page content out of GPUI-owned persistent data and support-bundle logs.
    */
    let settings = cef::Settings {
        no_sandbox: 1,
        external_message_pump: 1,
        root_cache_path: cef::CefString::from(root_cache_path.to_string_lossy().as_ref()),
        log_severity: cef::LogSeverity::DISABLE,
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

        fn render_process_handler(&self) -> Option<RenderProcessHandler> {
            Some(GhostexGpuiRenderProcessHandler::new())
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

wrap_client! {
    struct GhostexGpuiCefClient {
        life_span_handler: Option<LifeSpanHandler>,
        display_handler: Option<DisplayHandler>,
        load_handler: Option<LoadHandler>,
        sidebar_bridge_event_handler: Option<SidebarBridgeEventHandler>,
        project_workarea_bridge_event_handler: Option<ProjectWorkareaBridgeEventHandler>,
        app_modal_host_bridge_event_handler: Option<AppModalHostBridgeEventHandler>,
    }

    impl Client {
        fn life_span_handler(&self) -> Option<LifeSpanHandler> {
            self.life_span_handler.clone()
        }

        fn display_handler(&self) -> Option<DisplayHandler> {
            self.display_handler.clone()
        }

        fn load_handler(&self) -> Option<LoadHandler> {
            self.load_handler.clone()
        }

        fn on_process_message_received(
            &self,
            _browser: Option<&mut cef::Browser>,
            frame: Option<&mut Frame>,
            source_process: ProcessId,
            message: Option<&mut ProcessMessage>,
        ) -> c_int {
            /*
            CDXC:GPUIProjectSidebarBridge 2026-06-23-18:29:
            The GPUI sidebar bridge may carry only the allowlisted typed sidebar events from `window.ghostexGpui`, each as one bounded string payload. Ordinary Browser CEF surfaces construct clients without this handler, and CEF only classifies the private event kind; strict JSON parsing and stale/private-shape rejection stay in the GPUI app stores with no logging or persistence at this boundary.

            CDXC:GPUISidebarProjectPathActions 2026-06-24-14:18:
            Sidebar-native project path actions use the same fixed-function CEF bridge as project-context/readiness events. CEF forwards only a bounded string from the bundled sidebar main frame; Rust app code must parse the small action/project-id JSON and resolve project paths through gxserver, not from renderer-provided absolute path data.

            CDXC:GPUISidebarGit 2026-06-24-15:43:
            Existing-PR browser open and changed-file IDE open are still sidebar-only native side effects on this fixed bridge. CEF does not trust or inspect URLs or paths; app-side Rust must re-query gxserver and treat any file path as a relative candidate only.

            CDXC:GPUICommandPane 2026-06-24-23:17:
            Sidebar command actions use their own fixed sidebar bridge function so the shared SidebarApp and command palette can ask GPUI to run the gxserver-projected action through Rust-owned Browser or command-pane paths. CEF still forwards only one bounded string from the sidebar main frame and does not log, persist, inspect, or execute command text.
            */
            if source_process != ProcessId::RENDERER {
                return 0;
            }

            let Some(message) = message else {
                return 0;
            };
            let message_name = CefString::from(&message.name()).to_string();
            let sidebar_event_kind = sidebar_bridge_event_kind_for_process_message(&message_name);
            let project_workarea_event_kind =
                project_workarea_bridge_event_kind_for_process_message(&message_name);
            let is_app_modal_host_message =
                message_name == APP_MODAL_HOST_BRIDGE_PROCESS_MESSAGE_NAME;
            if sidebar_event_kind.is_none()
                && project_workarea_event_kind.is_none()
                && !is_app_modal_host_message
            {
                return 0;
            }
            if frame.map(|frame| frame.is_main() == 0).unwrap_or(true) {
                return 1;
            }

            let Some(arguments) = message.argument_list() else {
                return 1;
            };
            if arguments.size() != 1 || arguments.get_type(0) != ValueType::STRING {
                return 1;
            }

            let payload = CefString::from(&arguments.string(0)).to_string();
            if let Some(event_kind) = sidebar_event_kind {
                let Some(handler) = self.sidebar_bridge_event_handler.clone() else {
                    return 0;
                };
                if payload.chars().count() > SIDEBAR_BRIDGE_PAYLOAD_MAX_CHARS {
                    return 1;
                }

                handler(event_kind.with_payload(payload));
                return 1;
            }

            if let Some(event_kind) = project_workarea_event_kind {
                let Some(handler) = self.project_workarea_bridge_event_handler.clone() else {
                    return 0;
                };
                /*
                CDXC:GPUIProjectWorkareaCefBridge 2026-06-24-11:03:
                Project-workarea CEF process messages are fixed-function and main-frame-only like the sidebar bridge, but their payload budget is larger because Manage save requests carry bounded file contents. The CEF boundary forwards only in-memory strings to the app handler and does not log, persist, inspect URL/title state, expose generic IPC, or create a WKWebView/WebKit path.
                */
                if payload.chars().count() > PROJECT_WORKAREA_BRIDGE_PAYLOAD_MAX_CHARS {
                    return 1;
                }

                handler(event_kind.with_payload(payload));
                return 1;
            }

            if is_app_modal_host_message {
                let Some(handler) = self.app_modal_host_bridge_event_handler.clone() else {
                    return 0;
                };
                /*
                CDXC:GPUITitlebarAppModalHost 2026-06-24-10:42:
                The GPUI app-modal host and titlebar Tips panel reuse the macOS React bridge shape, but CEF forwards each message as a single bounded JSON string from first-party bundled pages only. Keep this main-frame-only and handler-scoped so Browser tabs, workarea pages, logs, persistence, raw URLs, page titles, and generic IPC never receive app-modal payloads.
                */
                if payload.chars().count() > APP_MODAL_HOST_BRIDGE_PAYLOAD_MAX_CHARS {
                    return 1;
                }

                handler(AppModalHostBridgeEvent::Message(payload));
                return 1;
            }

            0
        }
    }
}

wrap_load_handler! {
    struct GhostexGpuiSidebarProjectContextLoadHandler {
        runtime_settings: SidebarRuntimeSettingsSnapshot,
        gxserver_bootstrap: Option<SidebarGxserverBootstrap>,
    }

    impl LoadHandler {
        fn on_load_end(
            &self,
            _browser: Option<&mut cef::Browser>,
            frame: Option<&mut Frame>,
            _http_status_code: c_int,
        ) {
            let Some(frame) = frame else {
                return;
            };
            if frame.is_main() == 0 {
                return;
            }

            /*
            CDXC:GPUIProjectSidebarBridge 2026-06-24-11:17:
            Install renderer-side `window.ghostexGpui` only for sidebar CEF clients with fixed allowlisted post functions, strict debug/beta booleans, saved shared Settings, and the real gxserver bootstrap when the local token helper can construct it. The private install message may carry the loopback base URL, bearer token, protocol version, stable client id, and only explicit gxserver ids from app state; ordinary Browser, workarea, and modal CEF clients never attach this load handler or receive the bootstrap.

            CDXC:GPUISettingsSidebarHandoff 2026-06-24-11:22:
            The same sidebar-only runtime message must carry the saved shared Settings object so the mounted React SidebarApp can normalize real user preferences instead of booting from hardcoded GPUI defaults plus debug/beta flags. Keep this as a bounded first-party CEF payload scoped to the sidebar renderer; Browser, workarea, and modal-host clients must not receive it.
            */
            send_sidebar_install_process_message(
                frame,
                self.runtime_settings.clone(),
                self.gxserver_bootstrap.clone(),
            );
        }
    }
}

wrap_load_handler! {
    struct GhostexGpuiProjectWorkareaBridgeLoadHandler;

    impl LoadHandler {
        fn on_load_end(
            &self,
            _browser: Option<&mut cef::Browser>,
            frame: Option<&mut Frame>,
            _http_status_code: c_int,
        ) {
            let Some(frame) = frame else {
                return;
            };
            if frame.is_main() == 0 {
                return;
            }

            /*
            CDXC:GPUIProjectWorkareaCefBridge 2026-06-24-11:03:
            Project workarea CEF clients install only the Kanban/Manage fixed bridge functions after the first-party CEF entry loads. Sidebar and ordinary Browser clients do not receive this handler, keeping project file/board messages out of generic Browser tabs and avoiding WKWebView/WebKit compatibility at the native runtime layer.
            */
            let mut message =
                match cef::process_message_create(Some(&CefString::from(
                    PROJECT_WORKAREA_BRIDGE_INSTALL_MESSAGE_NAME,
                ))) {
                    Some(message) => message,
                    None => return,
                };
            frame.send_process_message(ProcessId::RENDERER, Some(&mut message));
        }
    }
}

wrap_render_process_handler! {
    struct GhostexGpuiRenderProcessHandler;

    impl RenderProcessHandler {
        fn on_context_created(
            &self,
            _browser: Option<&mut cef::Browser>,
            frame: Option<&mut Frame>,
            context: Option<&mut cef::V8Context>,
        ) {
            let Some(frame) = frame else {
                return;
            };
            if frame.is_main() == 0 {
                return;
            }
            let frame_url = CefString::from(&frame.url()).to_string();
            let is_modal_host = is_app_modal_host_frame_url(&frame_url);
            let is_titlebar_host = is_gpui_titlebar_host_frame_url(&frame_url);
            let is_sidebar = is_gpui_sidebar_frame_url(&frame_url);
            if !is_modal_host && !is_titlebar_host && !is_sidebar {
                return;
            }
            /*
            CDXC:GPUITitlebarAppModalHost 2026-06-24-11:09:
            Install the CEF-compatible `window.webkit.messageHandlers.ghostexAppModalHost` shim at V8 context creation for only bundled modal-host.html, titlebar-host.html, and sidebar index.html entries. The shared React modal host posts `ready` during mount, the titlebar Tips panel posts sidebarCommand header actions, and the shared sidebar can emit Settings/Hotkeys/Command Palette opens after hydration, so waiting for load-end would race real presentation. Only modal-host.html receives the native-window identity fields; Browser tabs, project workareas, arbitrary pages, raw URLs, titles, logs, persistence, and generic IPC do not receive this bridge.
            */
            install_app_modal_host_v8_bridge(context, is_modal_host);
        }

        fn on_process_message_received(
            &self,
            _browser: Option<&mut cef::Browser>,
            frame: Option<&mut Frame>,
            source_process: ProcessId,
            message: Option<&mut ProcessMessage>,
        ) -> c_int {
            if source_process != ProcessId::BROWSER {
                return 0;
            }
            let Some(message) = message else {
                return 0;
            };
            let message_name = CefString::from(&message.name()).to_string();
            let is_install_message = message_name == SIDEBAR_PROJECT_CONTEXT_INSTALL_MESSAGE_NAME;
            let is_runtime_settings_update =
                message_name == SIDEBAR_RUNTIME_SETTINGS_UPDATE_MESSAGE_NAME;
            let is_gxserver_bootstrap_update =
                message_name == SIDEBAR_GXSERVER_BOOTSTRAP_UPDATE_MESSAGE_NAME;
            let is_project_workarea_install_message =
                message_name == PROJECT_WORKAREA_BRIDGE_INSTALL_MESSAGE_NAME;
            if !is_install_message
                && !is_runtime_settings_update
                && !is_gxserver_bootstrap_update
                && !is_project_workarea_install_message
            {
                return 0;
            }
            let Some(frame) = frame else {
                return 1;
            };
            if frame.is_main() == 0 {
                return 1;
            }

            let Some(mut context) = frame.v8_context() else {
                return 1;
            };
            if context.enter() == 0 {
                return 1;
            }
            if is_project_workarea_install_message {
                install_project_workarea_v8_bridge(Some(&mut context));
            } else if is_install_message {
                let runtime_settings = sidebar_runtime_settings_from_install_message(message);
                let gxserver_bootstrap = sidebar_gxserver_bootstrap_from_process_message(
                    message,
                    SIDEBAR_RUNTIME_SETTINGS_ARGUMENT_COUNT,
                );
                install_sidebar_project_context_v8_bridge(
                    Some(&mut context),
                    runtime_settings,
                    gxserver_bootstrap,
                );
            } else if is_runtime_settings_update {
                let runtime_settings = sidebar_runtime_settings_from_install_message(message);
                update_sidebar_runtime_settings_v8_bridge(Some(&mut context), runtime_settings);
            } else {
                let gxserver_bootstrap = sidebar_gxserver_bootstrap_from_process_message(message, 0);
                update_sidebar_gxserver_bootstrap_v8_bridge(
                    Some(&mut context),
                    gxserver_bootstrap,
                );
            }
            context.exit();
            1
        }
    }
}

wrap_v8_handler! {
    struct GhostexGpuiProjectWorkareaBridgeV8Handler;

    impl V8Handler {
        fn execute(
            &self,
            name: Option<&CefString>,
            _object: Option<&mut V8Value>,
            arguments: Option<&[Option<V8Value>]>,
            retval: Option<&mut Option<V8Value>>,
            _exception: Option<&mut CefString>,
        ) -> c_int {
            let name = name.map(CefString::to_string);
            let Some(spec) = name
                .as_deref()
                .and_then(project_workarea_bridge_function_spec_for_js_function)
            else {
                return 0;
            };

            let payload = arguments
                .and_then(|arguments| arguments.first())
                .and_then(Option::as_ref)
                .filter(|argument| argument.is_string() != 0)
                .map(|argument| CefString::from(&argument.string_value()).to_string());
            let Some(payload) = payload else {
                set_v8_bool_return(retval, false);
                return 1;
            };

            let sent =
                send_project_workarea_bridge_process_message(spec.process_message_name, &payload);
            set_v8_bool_return(retval, sent);
            1
        }
    }
}

wrap_v8_handler! {
    struct GhostexGpuiAppModalHostBridgeV8Handler;

    impl V8Handler {
        fn execute(
            &self,
            name: Option<&CefString>,
            _object: Option<&mut V8Value>,
            arguments: Option<&[Option<V8Value>]>,
            retval: Option<&mut Option<V8Value>>,
            _exception: Option<&mut CefString>,
        ) -> c_int {
            let name = name.map(CefString::to_string);
            if name.as_deref() != Some(WEBKIT_POST_MESSAGE_JS_FUNCTION) {
                return 0;
            }

            let payload = arguments
                .and_then(|arguments| arguments.first())
                .and_then(Option::as_ref)
                .and_then(app_modal_host_payload_from_v8_value);
            let Some(payload) = payload else {
                set_v8_bool_return(retval, false);
                return 1;
            };

            let sent = send_app_modal_host_bridge_process_message(&payload);
            set_v8_bool_return(retval, sent);
            1
        }
    }
}

wrap_v8_handler! {
    struct GhostexGpuiSidebarBridgeV8Handler;

    impl V8Handler {
        fn execute(
            &self,
            name: Option<&CefString>,
            _object: Option<&mut V8Value>,
            arguments: Option<&[Option<V8Value>]>,
            retval: Option<&mut Option<V8Value>>,
            _exception: Option<&mut CefString>,
        ) -> c_int {
            let name = name.map(CefString::to_string);
            let Some(spec) = name
                .as_deref()
                .and_then(sidebar_bridge_function_spec_for_js_function)
            else {
                return 0;
            };

            let payload = arguments
                .and_then(|arguments| arguments.first())
                .and_then(Option::as_ref)
                .filter(|argument| argument.is_string() != 0)
                .map(|argument| CefString::from(&argument.string_value()).to_string());
            let Some(payload) = payload else {
                set_v8_bool_return(retval, false);
                return 1;
            };

            let sent = send_sidebar_bridge_process_message(spec.process_message_name, &payload);
            set_v8_bool_return(retval, sent);
            1
        }
    }
}

fn install_sidebar_project_context_v8_bridge(
    context: Option<&mut cef::V8Context>,
    runtime_settings: SidebarRuntimeSettingsSnapshot,
    gxserver_bootstrap: Option<SidebarGxserverBootstrap>,
) {
    /*
    CDXC:GPUIProjectSidebarBridge 2026-06-23-18:29:
    The renderer-side sidebar bridge exposes only fixed typed string-payload functions for active-project context, Source readiness, Browser readiness, project-workarea readiness, Manage operation requests, sidebar-native side-effect requests, and gxserver focus-state hints, plus `window.ghostexGpui.runtimeSettings` with strict debuggingMode/showBetaFeatures booleans and the saved shared Settings object. It does not expose generic message names, event buses, filesystem/project detection, trusted file paths, URL/title inspection, logging, persistence, or fallback project inference.

    CDXC:GPUIProjectSidebarBridge 2026-06-23-06:57:
    After initial install, runtime settings refresh uses a second private browser-to-renderer CEF message that can replace the sidebar runtimeSettings object and notify the page through `window.ghostexGpui.onRuntimeSettingsChanged(settings)`. This keeps ordinary Browser tabs out of the sidebar bridge and avoids a generic event/settings bus.

    CDXC:GPUISettingsSidebarHandoff 2026-06-24-11:22:
    The runtimeSettings object also carries the saved shared Settings object for the sidebar renderer to normalize with the shared TypeScript schema. This remains a narrow sidebar-owned handoff: the CEF boundary accepts only the serialized object already read by GPUI, parses it into one V8 object property, and does not expose a generic settings API, persistence hook, logging path, URL/title state, command text, tokens, or fallback project inference.

    CDXC:GPUISidebarGxserverBootstrap 2026-06-24-11:17:
    The same sidebar-only private install message may set `window.ghostexGpui.gxserverBootstrap` from real local gxserver facts: loopback base URL, bearer token, protocol version, stable client id, and optional gxserver ids only when app state already owns them. Do not derive ids from paths, titles, fixtures, shell placeholders, Browser tabs, terminal state, logs, persistence, or fallback project detection.

    CDXC:GPUISidebarGxserverFocusState 2026-06-24-21:07:
    The focus-state bridge is a fixed sidebar-only string payload used to return React-owned gxserver presentation session ids to Rust for bootstrap replay. It must remain separate from native path actions and must not carry paths, titles, command text, terminal contents, tokens, daemon response bodies, or renderer-derived labels.

    CDXC:GPUICommandPane 2026-06-24-23:17:
    The sidebar command-action bridge is a fixed-function handoff for the shared SidebarApp `runSidebarCommand` message. It may carry the selected gxserver HUD action fields to app Rust, but it must not expose generic IPC, filesystem/project discovery, logs, persistence, terminal content, stdout/stderr, or renderer-side execution authority.
    */
    let Some(context) = context else {
        return;
    };
    let Some(global) = context.global() else {
        return;
    };

    let namespace_key = CefString::from(SIDEBAR_PROJECT_CONTEXT_JS_NAMESPACE);
    let mut namespace = global
        .value_bykey(Some(&namespace_key))
        .filter(|value| value.is_object() != 0)
        .or_else(|| cef::v8_value_create_object(None, None));
    let Some(namespace) = namespace.as_mut() else {
        return;
    };

    for spec in SIDEBAR_BRIDGE_FUNCTION_SPECS {
        let mut handler = GhostexGpuiSidebarBridgeV8Handler::new();
        let function_name = CefString::from(spec.js_function_name);
        let mut function = cef::v8_value_create_function(Some(&function_name), Some(&mut handler));
        let Some(function) = function.as_mut() else {
            return;
        };

        namespace.set_value_bykey(
            Some(&function_name),
            Some(function),
            V8Propertyattribute::default(),
        );
    }
    let _ = install_sidebar_runtime_settings_v8_object(context, namespace, runtime_settings);
    let _ = install_sidebar_gxserver_bootstrap_v8_object(namespace, gxserver_bootstrap);
    global.set_value_bykey(
        Some(&namespace_key),
        Some(namespace),
        V8Propertyattribute::default(),
    );
}

fn update_sidebar_runtime_settings_v8_bridge(
    context: Option<&mut cef::V8Context>,
    runtime_settings: SidebarRuntimeSettingsSnapshot,
) {
    let Some(context) = context else {
        return;
    };
    let Some(global) = context.global() else {
        return;
    };
    let namespace_key = CefString::from(SIDEBAR_PROJECT_CONTEXT_JS_NAMESPACE);
    let mut namespace = global
        .value_bykey(Some(&namespace_key))
        .filter(|value| value.is_object() != 0);
    let Some(namespace) = namespace.as_mut() else {
        return;
    };
    for spec in SIDEBAR_BRIDGE_FUNCTION_SPECS {
        let function_key = CefString::from(spec.js_function_name);
        if namespace
            .value_bykey(Some(&function_key))
            .filter(|value| value.is_function() != 0)
            .is_none()
        {
            return;
        }
    }

    let Some(runtime_settings_object) =
        install_sidebar_runtime_settings_v8_object(context, namespace, runtime_settings)
    else {
        return;
    };
    notify_sidebar_runtime_settings_changed(context, namespace, runtime_settings_object);
}

fn update_sidebar_gxserver_bootstrap_v8_bridge(
    context: Option<&mut cef::V8Context>,
    gxserver_bootstrap: Option<SidebarGxserverBootstrap>,
) {
    let Some(context) = context else {
        return;
    };
    let Some(global) = context.global() else {
        return;
    };
    let namespace_key = CefString::from(SIDEBAR_PROJECT_CONTEXT_JS_NAMESPACE);
    let mut namespace = global
        .value_bykey(Some(&namespace_key))
        .filter(|value| value.is_object() != 0);
    let Some(namespace) = namespace.as_mut() else {
        return;
    };
    for spec in SIDEBAR_BRIDGE_FUNCTION_SPECS {
        let function_key = CefString::from(spec.js_function_name);
        if namespace
            .value_bykey(Some(&function_key))
            .filter(|value| value.is_function() != 0)
            .is_none()
        {
            return;
        }
    }

    /*
    CDXC:GPUISidebarGxserverBootstrap 2026-06-24-11:17:
    Post-load gxserver bootstrap refresh is a narrow sidebar bridge update, not a generic host event bus or JavaScript injection channel. It can replace only `window.ghostexGpui.gxserverBootstrap` and call the fixed optional `onGxserverBootstrapChanged(bootstrap)` callback, so token availability changes reach the React runtime while Browser/workarea/modal CEF clients remain outside the token path.
    */
    let Some(bootstrap_object) =
        install_sidebar_gxserver_bootstrap_v8_object(namespace, gxserver_bootstrap)
    else {
        return;
    };
    notify_sidebar_gxserver_bootstrap_changed(context, namespace, bootstrap_object);
}

fn install_project_workarea_v8_bridge(context: Option<&mut cef::V8Context>) {
    let Some(context) = context else {
        return;
    };
    let Some(global) = context.global() else {
        return;
    };

    let namespace_key = CefString::from(SIDEBAR_PROJECT_CONTEXT_JS_NAMESPACE);
    let mut namespace = global
        .value_bykey(Some(&namespace_key))
        .filter(|value| value.is_object() != 0)
        .or_else(|| cef::v8_value_create_object(None, None));
    let Some(namespace) = namespace.as_mut() else {
        return;
    };

    for spec in PROJECT_WORKAREA_BRIDGE_FUNCTION_SPECS {
        let mut handler = GhostexGpuiProjectWorkareaBridgeV8Handler::new();
        let function_name = CefString::from(spec.js_function_name);
        let mut function = cef::v8_value_create_function(Some(&function_name), Some(&mut handler));
        let Some(function) = function.as_mut() else {
            return;
        };

        namespace.set_value_bykey(
            Some(&function_name),
            Some(function),
            V8Propertyattribute::default(),
        );
    }

    global.set_value_bykey(
        Some(&namespace_key),
        Some(namespace),
        V8Propertyattribute::default(),
    );
}

fn install_app_modal_host_v8_bridge(
    context: Option<&mut cef::V8Context>,
    expose_native_window_identity: bool,
) {
    let Some(context) = context else {
        return;
    };
    let Some(global) = context.global() else {
        return;
    };

    if expose_native_window_identity {
        let _ = set_v8_string_property(
            &global,
            APP_MODAL_HOST_SURFACE_JS_FIELD,
            APP_MODAL_HOST_SURFACE_VALUE,
        );
        let _ =
            set_v8_string_property(&global, APP_MODAL_HOST_ID_JS_FIELD, APP_MODAL_HOST_ID_VALUE);
    }

    let Some(mut webkit) = v8_object_property_or_new(&global, WEBKIT_JS_OBJECT) else {
        return;
    };
    let Some(mut message_handlers) =
        v8_object_property_or_new(&webkit, WEBKIT_MESSAGE_HANDLERS_JS_OBJECT)
    else {
        return;
    };
    let Some(mut app_modal_host) = cef::v8_value_create_object(None, None) else {
        return;
    };

    let mut handler = GhostexGpuiAppModalHostBridgeV8Handler::new();
    let function_name = CefString::from(WEBKIT_POST_MESSAGE_JS_FUNCTION);
    let mut post_message =
        match cef::v8_value_create_function(Some(&function_name), Some(&mut handler)) {
            Some(function) => function,
            None => return,
        };
    app_modal_host.set_value_bykey(
        Some(&function_name),
        Some(&mut post_message),
        V8Propertyattribute::default(),
    );

    let app_modal_host_key = CefString::from(WEBKIT_APP_MODAL_HOST_MESSAGE_HANDLER_JS_OBJECT);
    message_handlers.set_value_bykey(
        Some(&app_modal_host_key),
        Some(&mut app_modal_host),
        V8Propertyattribute::default(),
    );

    let message_handlers_key = CefString::from(WEBKIT_MESSAGE_HANDLERS_JS_OBJECT);
    webkit.set_value_bykey(
        Some(&message_handlers_key),
        Some(&mut message_handlers),
        V8Propertyattribute::default(),
    );

    let webkit_key = CefString::from(WEBKIT_JS_OBJECT);
    global.set_value_bykey(
        Some(&webkit_key),
        Some(&mut webkit),
        V8Propertyattribute::default(),
    );
}

fn v8_object_property_or_new(parent: &V8Value, key: &str) -> Option<V8Value> {
    let key = CefString::from(key);
    parent
        .value_bykey(Some(&key))
        .filter(|value| value.is_object() != 0)
        .or_else(|| cef::v8_value_create_object(None, None))
}

fn set_v8_string_property(parent: &V8Value, key: &str, value: &str) -> bool {
    let key = CefString::from(key);
    let value = CefString::from(value);
    let Some(mut value) = cef::v8_value_create_string(Some(&value)) else {
        return false;
    };
    parent.set_value_bykey(Some(&key), Some(&mut value), V8Propertyattribute::default()) != 0
}

fn app_modal_host_payload_from_v8_value(value: &V8Value) -> Option<String> {
    if value.is_string() != 0 {
        return Some(CefString::from(&value.string_value()).to_string());
    }

    let Some(context) = cef::v8_context_get_current_context() else {
        return None;
    };
    let Some(global) = context.global() else {
        return None;
    };
    let json_key = CefString::from("JSON");
    let mut json = global
        .value_bykey(Some(&json_key))
        .filter(|value| value.is_object() != 0)?;
    let stringify_key = CefString::from("stringify");
    let stringify = json
        .value_bykey(Some(&stringify_key))
        .filter(|value| value.is_function() != 0)?;
    let argument = value.clone();
    let result = stringify.execute_function(Some(&mut json), Some(&[Some(argument)]))?;
    if result.is_string() == 0 {
        return None;
    }
    Some(CefString::from(&result.string_value()).to_string())
}

fn send_sidebar_install_process_message(
    frame: &mut Frame,
    runtime_settings: SidebarRuntimeSettingsSnapshot,
    gxserver_bootstrap: Option<SidebarGxserverBootstrap>,
) {
    let mut message = match cef::process_message_create(Some(&CefString::from(
        SIDEBAR_PROJECT_CONTEXT_INSTALL_MESSAGE_NAME,
    ))) {
        Some(message) => message,
        None => return,
    };
    attach_sidebar_runtime_settings_to_process_message(&mut message, runtime_settings);
    attach_sidebar_gxserver_bootstrap_to_process_message(
        &mut message,
        SIDEBAR_RUNTIME_SETTINGS_ARGUMENT_COUNT,
        gxserver_bootstrap.as_ref(),
    );
    frame.send_process_message(ProcessId::RENDERER, Some(&mut message));
}

fn send_sidebar_runtime_settings_process_message(
    frame: &mut Frame,
    message_name: &str,
    runtime_settings: SidebarRuntimeSettingsSnapshot,
) {
    let mut message = match cef::process_message_create(Some(&CefString::from(message_name))) {
        Some(message) => message,
        None => return,
    };
    attach_sidebar_runtime_settings_to_process_message(&mut message, runtime_settings);
    frame.send_process_message(ProcessId::RENDERER, Some(&mut message));
}

fn send_sidebar_gxserver_bootstrap_process_message(
    frame: &mut Frame,
    gxserver_bootstrap: Option<SidebarGxserverBootstrap>,
) {
    let mut message = match cef::process_message_create(Some(&CefString::from(
        SIDEBAR_GXSERVER_BOOTSTRAP_UPDATE_MESSAGE_NAME,
    ))) {
        Some(message) => message,
        None => return,
    };
    attach_sidebar_gxserver_bootstrap_to_process_message(
        &mut message,
        0,
        gxserver_bootstrap.as_ref(),
    );
    frame.send_process_message(ProcessId::RENDERER, Some(&mut message));
}

fn attach_sidebar_runtime_settings_to_process_message(
    message: &mut ProcessMessage,
    runtime_settings: SidebarRuntimeSettingsSnapshot,
) {
    let Some(arguments) = message.argument_list() else {
        return;
    };
    arguments.set_size(SIDEBAR_RUNTIME_SETTINGS_ARGUMENT_COUNT);
    arguments.set_bool(
        SIDEBAR_RUNTIME_SETTINGS_DEBUGGING_MODE_ARGUMENT_INDEX,
        bool_to_cef_int(runtime_settings.debugging_mode),
    );
    arguments.set_bool(
        SIDEBAR_RUNTIME_SETTINGS_SHOW_BETA_FEATURES_ARGUMENT_INDEX,
        bool_to_cef_int(runtime_settings.show_beta_features),
    );
    arguments.set_string(
        SIDEBAR_RUNTIME_SETTINGS_SAVED_SETTINGS_JSON_ARGUMENT_INDEX,
        Some(&CefString::from(bounded_sidebar_saved_settings_json(
            &runtime_settings.saved_settings_json,
        ))),
    );
}

fn attach_sidebar_gxserver_bootstrap_to_process_message(
    message: &mut ProcessMessage,
    offset: usize,
    gxserver_bootstrap: Option<&SidebarGxserverBootstrap>,
) {
    let Some(arguments) = message.argument_list() else {
        return;
    };
    let Some(gxserver_bootstrap) = gxserver_bootstrap else {
        arguments.set_size(offset + 1);
        arguments.set_bool(
            offset + SIDEBAR_GXSERVER_BOOTSTRAP_PRESENT_ARGUMENT_INDEX,
            bool_to_cef_int(false),
        );
        return;
    };

    let visible_session_count = gxserver_bootstrap.visible_session_ids.len();
    arguments.set_size(
        offset
            + SIDEBAR_GXSERVER_BOOTSTRAP_ARGUMENT_COUNT_WITHOUT_VISIBLE_IDS
            + visible_session_count,
    );
    arguments.set_bool(
        offset + SIDEBAR_GXSERVER_BOOTSTRAP_PRESENT_ARGUMENT_INDEX,
        bool_to_cef_int(true),
    );
    arguments.set_string(
        offset + SIDEBAR_GXSERVER_BOOTSTRAP_BASE_URL_ARGUMENT_INDEX,
        Some(&CefString::from(gxserver_bootstrap.base_url.as_str())),
    );
    arguments.set_string(
        offset + SIDEBAR_GXSERVER_BOOTSTRAP_AUTH_TOKEN_ARGUMENT_INDEX,
        Some(&CefString::from(gxserver_bootstrap.auth_token.as_str())),
    );
    arguments.set_int(
        offset + SIDEBAR_GXSERVER_BOOTSTRAP_PROTOCOL_VERSION_ARGUMENT_INDEX,
        gxserver_bootstrap.protocol_version,
    );
    arguments.set_string(
        offset + SIDEBAR_GXSERVER_BOOTSTRAP_CLIENT_ID_ARGUMENT_INDEX,
        Some(&CefString::from(gxserver_bootstrap.client_id.as_str())),
    );
    arguments.set_string(
        offset + SIDEBAR_GXSERVER_BOOTSTRAP_INITIAL_ACTIVE_PROJECT_ID_ARGUMENT_INDEX,
        Some(&CefString::from(
            gxserver_bootstrap
                .initial_active_project_id
                .as_deref()
                .unwrap_or(""),
        )),
    );
    arguments.set_string(
        offset + SIDEBAR_GXSERVER_BOOTSTRAP_FOCUSED_SESSION_ID_ARGUMENT_INDEX,
        Some(&CefString::from(
            gxserver_bootstrap
                .focused_session_id
                .as_deref()
                .unwrap_or(""),
        )),
    );
    arguments.set_int(
        offset + SIDEBAR_GXSERVER_BOOTSTRAP_VISIBLE_SESSION_COUNT_ARGUMENT_INDEX,
        visible_session_count as c_int,
    );
    for (index, session_id) in gxserver_bootstrap.visible_session_ids.iter().enumerate() {
        arguments.set_string(
            offset + SIDEBAR_GXSERVER_BOOTSTRAP_ARGUMENT_COUNT_WITHOUT_VISIBLE_IDS + index,
            Some(&CefString::from(session_id.as_str())),
        );
    }
}

fn sidebar_runtime_settings_from_install_message(
    message: &mut ProcessMessage,
) -> SidebarRuntimeSettingsSnapshot {
    let Some(arguments) = message.argument_list() else {
        return SidebarRuntimeSettingsSnapshot::default();
    };
    if arguments.size() < SIDEBAR_RUNTIME_SETTINGS_ARGUMENT_COUNT {
        return SidebarRuntimeSettingsSnapshot::default();
    }
    if arguments.get_type(SIDEBAR_RUNTIME_SETTINGS_DEBUGGING_MODE_ARGUMENT_INDEX) != ValueType::BOOL
        || arguments.get_type(SIDEBAR_RUNTIME_SETTINGS_SHOW_BETA_FEATURES_ARGUMENT_INDEX)
            != ValueType::BOOL
    {
        return SidebarRuntimeSettingsSnapshot::default();
    }

    SidebarRuntimeSettingsSnapshot {
        debugging_mode: arguments.bool(SIDEBAR_RUNTIME_SETTINGS_DEBUGGING_MODE_ARGUMENT_INDEX) != 0,
        show_beta_features: arguments
            .bool(SIDEBAR_RUNTIME_SETTINGS_SHOW_BETA_FEATURES_ARGUMENT_INDEX)
            != 0,
        saved_settings_json: sidebar_saved_settings_json_from_arguments(arguments),
    }
}

fn sidebar_gxserver_bootstrap_from_process_message(
    message: &mut ProcessMessage,
    offset: usize,
) -> Option<SidebarGxserverBootstrap> {
    let arguments = message.argument_list()?;
    if arguments.size() <= offset
        || arguments.get_type(offset + SIDEBAR_GXSERVER_BOOTSTRAP_PRESENT_ARGUMENT_INDEX)
            != ValueType::BOOL
        || arguments.bool(offset + SIDEBAR_GXSERVER_BOOTSTRAP_PRESENT_ARGUMENT_INDEX) == 0
    {
        return None;
    }
    if arguments.size() < offset + SIDEBAR_GXSERVER_BOOTSTRAP_ARGUMENT_COUNT_WITHOUT_VISIBLE_IDS {
        return None;
    }
    for index in [
        SIDEBAR_GXSERVER_BOOTSTRAP_BASE_URL_ARGUMENT_INDEX,
        SIDEBAR_GXSERVER_BOOTSTRAP_AUTH_TOKEN_ARGUMENT_INDEX,
        SIDEBAR_GXSERVER_BOOTSTRAP_CLIENT_ID_ARGUMENT_INDEX,
        SIDEBAR_GXSERVER_BOOTSTRAP_INITIAL_ACTIVE_PROJECT_ID_ARGUMENT_INDEX,
        SIDEBAR_GXSERVER_BOOTSTRAP_FOCUSED_SESSION_ID_ARGUMENT_INDEX,
    ] {
        if arguments.get_type(offset + index) != ValueType::STRING {
            return None;
        }
    }
    if arguments.get_type(offset + SIDEBAR_GXSERVER_BOOTSTRAP_PROTOCOL_VERSION_ARGUMENT_INDEX)
        != ValueType::INT
        || arguments
            .get_type(offset + SIDEBAR_GXSERVER_BOOTSTRAP_VISIBLE_SESSION_COUNT_ARGUMENT_INDEX)
            != ValueType::INT
    {
        return None;
    }

    let visible_session_count =
        arguments.int(offset + SIDEBAR_GXSERVER_BOOTSTRAP_VISIBLE_SESSION_COUNT_ARGUMENT_INDEX);
    if visible_session_count < 0 {
        return None;
    }
    let visible_session_count = visible_session_count as usize;
    if arguments.size()
        < offset
            + SIDEBAR_GXSERVER_BOOTSTRAP_ARGUMENT_COUNT_WITHOUT_VISIBLE_IDS
            + visible_session_count
    {
        return None;
    }
    let mut visible_session_ids = Vec::with_capacity(visible_session_count);
    for index in 0..visible_session_count {
        let argument_index =
            offset + SIDEBAR_GXSERVER_BOOTSTRAP_ARGUMENT_COUNT_WITHOUT_VISIBLE_IDS + index;
        if arguments.get_type(argument_index) != ValueType::STRING {
            return None;
        }
        let value = CefString::from(&arguments.string(argument_index)).to_string();
        if !value.trim().is_empty() {
            visible_session_ids.push(value);
        }
    }

    Some(SidebarGxserverBootstrap {
        base_url: CefString::from(
            &arguments.string(offset + SIDEBAR_GXSERVER_BOOTSTRAP_BASE_URL_ARGUMENT_INDEX),
        )
        .to_string(),
        auth_token: CefString::from(
            &arguments.string(offset + SIDEBAR_GXSERVER_BOOTSTRAP_AUTH_TOKEN_ARGUMENT_INDEX),
        )
        .to_string(),
        protocol_version: arguments
            .int(offset + SIDEBAR_GXSERVER_BOOTSTRAP_PROTOCOL_VERSION_ARGUMENT_INDEX),
        client_id: CefString::from(
            &arguments.string(offset + SIDEBAR_GXSERVER_BOOTSTRAP_CLIENT_ID_ARGUMENT_INDEX),
        )
        .to_string(),
        initial_active_project_id: non_empty_cef_argument_string(
            &arguments,
            offset + SIDEBAR_GXSERVER_BOOTSTRAP_INITIAL_ACTIVE_PROJECT_ID_ARGUMENT_INDEX,
        ),
        focused_session_id: non_empty_cef_argument_string(
            &arguments,
            offset + SIDEBAR_GXSERVER_BOOTSTRAP_FOCUSED_SESSION_ID_ARGUMENT_INDEX,
        ),
        visible_session_ids,
    })
}

fn non_empty_cef_argument_string(arguments: &cef::ListValue, index: usize) -> Option<String> {
    let value = CefString::from(&arguments.string(index)).to_string();
    (!value.trim().is_empty()).then_some(value)
}

fn install_sidebar_runtime_settings_v8_object(
    context: &mut cef::V8Context,
    namespace: &mut V8Value,
    runtime_settings: SidebarRuntimeSettingsSnapshot,
) -> Option<V8Value> {
    let Some(mut runtime_settings_object) = cef::v8_value_create_object(None, None) else {
        return None;
    };
    set_v8_bool_property(
        &mut runtime_settings_object,
        SIDEBAR_RUNTIME_SETTINGS_DEBUGGING_MODE_JS_FIELD,
        runtime_settings.debugging_mode,
    );
    set_v8_bool_property(
        &mut runtime_settings_object,
        SIDEBAR_RUNTIME_SETTINGS_SHOW_BETA_FEATURES_JS_FIELD,
        runtime_settings.show_beta_features,
    );
    if let Some(mut settings_object) =
        parse_sidebar_saved_settings_json_v8_object(context, &runtime_settings.saved_settings_json)
    {
        let settings_key = CefString::from(SIDEBAR_RUNTIME_SETTINGS_SAVED_SETTINGS_JS_FIELD);
        runtime_settings_object.set_value_bykey(
            Some(&settings_key),
            Some(&mut settings_object),
            V8Propertyattribute::default(),
        );
    }

    let runtime_settings_key = CefString::from(SIDEBAR_RUNTIME_SETTINGS_JS_OBJECT);
    namespace.set_value_bykey(
        Some(&runtime_settings_key),
        Some(&mut runtime_settings_object),
        V8Propertyattribute::default(),
    );
    Some(runtime_settings_object)
}

fn sidebar_saved_settings_json_from_arguments(arguments: cef::ListValue) -> String {
    if arguments.size() <= SIDEBAR_RUNTIME_SETTINGS_SAVED_SETTINGS_JSON_ARGUMENT_INDEX
        || arguments.get_type(SIDEBAR_RUNTIME_SETTINGS_SAVED_SETTINGS_JSON_ARGUMENT_INDEX)
            != ValueType::STRING
    {
        return String::new();
    }
    let value = CefString::from(
        &arguments.string(SIDEBAR_RUNTIME_SETTINGS_SAVED_SETTINGS_JSON_ARGUMENT_INDEX),
    )
    .to_string();
    bounded_sidebar_saved_settings_json(&value).to_string()
}

fn bounded_sidebar_saved_settings_json(value: &str) -> &str {
    if value.chars().count() > SIDEBAR_RUNTIME_SETTINGS_SAVED_SETTINGS_JSON_MAX_CHARS {
        return "";
    }
    value
}

fn parse_sidebar_saved_settings_json_v8_object(
    context: &mut cef::V8Context,
    saved_settings_json: &str,
) -> Option<V8Value> {
    if saved_settings_json.trim().is_empty() {
        return None;
    }
    let global = context.global()?;
    let json_key = CefString::from("JSON");
    let mut json = global
        .value_bykey(Some(&json_key))
        .filter(|value| value.is_object() != 0)?;
    let parse_key = CefString::from("parse");
    let parse = json
        .value_bykey(Some(&parse_key))
        .filter(|value| value.is_function() != 0)?;
    let settings_json = CefString::from(saved_settings_json);
    let settings_json_value = cef::v8_value_create_string(Some(&settings_json))?;
    let result = parse.execute_function(Some(&mut json), Some(&[Some(settings_json_value)]))?;
    (result.is_object() != 0).then_some(result)
}

fn install_sidebar_gxserver_bootstrap_v8_object(
    namespace: &mut V8Value,
    gxserver_bootstrap: Option<SidebarGxserverBootstrap>,
) -> Option<V8Value> {
    let Some(mut bootstrap_object) = cef::v8_value_create_object(None, None) else {
        return None;
    };
    if let Some(gxserver_bootstrap) = gxserver_bootstrap {
        set_v8_string_property(
            &bootstrap_object,
            SIDEBAR_GXSERVER_BOOTSTRAP_BASE_URL_JS_FIELD,
            &gxserver_bootstrap.base_url,
        );
        set_v8_string_property(
            &bootstrap_object,
            SIDEBAR_GXSERVER_BOOTSTRAP_AUTH_TOKEN_JS_FIELD,
            &gxserver_bootstrap.auth_token,
        );
        set_v8_int_property(
            &mut bootstrap_object,
            SIDEBAR_GXSERVER_BOOTSTRAP_PROTOCOL_VERSION_JS_FIELD,
            gxserver_bootstrap.protocol_version,
        );
        set_v8_string_property(
            &bootstrap_object,
            SIDEBAR_GXSERVER_BOOTSTRAP_CLIENT_ID_JS_FIELD,
            &gxserver_bootstrap.client_id,
        );
        if let Some(initial_active_project_id) = gxserver_bootstrap.initial_active_project_id {
            set_v8_string_property(
                &bootstrap_object,
                SIDEBAR_GXSERVER_BOOTSTRAP_INITIAL_ACTIVE_PROJECT_ID_JS_FIELD,
                &initial_active_project_id,
            );
        }
        if let Some(focused_session_id) = gxserver_bootstrap.focused_session_id {
            set_v8_string_property(
                &bootstrap_object,
                SIDEBAR_GXSERVER_BOOTSTRAP_FOCUSED_SESSION_ID_JS_FIELD,
                &focused_session_id,
            );
        }
        if !gxserver_bootstrap.visible_session_ids.is_empty() {
            set_v8_string_array_property(
                &mut bootstrap_object,
                SIDEBAR_GXSERVER_BOOTSTRAP_VISIBLE_SESSION_IDS_JS_FIELD,
                &gxserver_bootstrap.visible_session_ids,
            );
        }
    }

    let bootstrap_key = CefString::from(SIDEBAR_GXSERVER_BOOTSTRAP_JS_OBJECT);
    namespace.set_value_bykey(
        Some(&bootstrap_key),
        Some(&mut bootstrap_object),
        V8Propertyattribute::default(),
    );
    Some(bootstrap_object)
}

fn notify_sidebar_runtime_settings_changed(
    context: &mut cef::V8Context,
    namespace: &mut V8Value,
    runtime_settings_object: V8Value,
) {
    let callback_key = CefString::from(SIDEBAR_RUNTIME_SETTINGS_CHANGED_JS_CALLBACK);
    let Some(callback) = namespace
        .value_bykey(Some(&callback_key))
        .filter(|value| value.is_function() != 0)
    else {
        return;
    };
    let arguments = [Some(runtime_settings_object)];
    callback.execute_function_with_context(Some(context), Some(namespace), Some(&arguments));
}

fn notify_sidebar_gxserver_bootstrap_changed(
    context: &mut cef::V8Context,
    namespace: &mut V8Value,
    bootstrap_object: V8Value,
) {
    let callback_key = CefString::from(SIDEBAR_GXSERVER_BOOTSTRAP_CHANGED_JS_CALLBACK);
    let Some(callback) = namespace
        .value_bykey(Some(&callback_key))
        .filter(|value| value.is_function() != 0)
    else {
        return;
    };
    let arguments = [Some(bootstrap_object)];
    callback.execute_function_with_context(Some(context), Some(namespace), Some(&arguments));
}

fn set_v8_bool_property(object: &mut V8Value, key: &str, value: bool) {
    let key = CefString::from(key);
    let mut value = cef::v8_value_create_bool(bool_to_cef_int(value));
    object.set_value_bykey(Some(&key), value.as_mut(), V8Propertyattribute::default());
}

fn set_v8_int_property(object: &mut V8Value, key: &str, value: i32) {
    let key = CefString::from(key);
    let mut value = cef::v8_value_create_int(value);
    object.set_value_bykey(Some(&key), value.as_mut(), V8Propertyattribute::default());
}

fn set_v8_string_array_property(object: &mut V8Value, key: &str, values: &[String]) {
    let Some(mut array) = cef::v8_value_create_array(values.len() as c_int) else {
        return;
    };
    for (index, value) in values.iter().enumerate() {
        let value = CefString::from(value.as_str());
        let Some(mut value) = cef::v8_value_create_string(Some(&value)) else {
            return;
        };
        array.set_value_byindex(index as c_int, Some(&mut value));
    }
    let key = CefString::from(key);
    object.set_value_bykey(Some(&key), Some(&mut array), V8Propertyattribute::default());
}

fn bool_to_cef_int(value: bool) -> c_int {
    if value { 1 } else { 0 }
}

fn send_sidebar_bridge_process_message(process_message_name: &str, payload: &str) -> bool {
    if sidebar_bridge_event_kind_for_process_message(process_message_name).is_none() {
        return false;
    }
    if payload.chars().count() > SIDEBAR_BRIDGE_PAYLOAD_MAX_CHARS {
        return false;
    }

    let Some(context) = cef::v8_context_get_current_context() else {
        return false;
    };
    let Some(frame) = context.frame() else {
        return false;
    };
    let mut message =
        match cef::process_message_create(Some(&CefString::from(process_message_name))) {
            Some(message) => message,
            None => return false,
        };
    let Some(arguments) = message.argument_list() else {
        return false;
    };
    arguments.set_size(1);
    arguments.set_string(0, Some(&CefString::from(payload)));
    frame.send_process_message(ProcessId::BROWSER, Some(&mut message));
    true
}

fn send_project_workarea_bridge_process_message(process_message_name: &str, payload: &str) -> bool {
    if project_workarea_bridge_event_kind_for_process_message(process_message_name).is_none() {
        return false;
    }
    if payload.chars().count() > PROJECT_WORKAREA_BRIDGE_PAYLOAD_MAX_CHARS {
        return false;
    }

    let Some(context) = cef::v8_context_get_current_context() else {
        return false;
    };
    let Some(frame) = context.frame() else {
        return false;
    };
    let mut message =
        match cef::process_message_create(Some(&CefString::from(process_message_name))) {
            Some(message) => message,
            None => return false,
        };
    let Some(arguments) = message.argument_list() else {
        return false;
    };
    arguments.set_size(1);
    arguments.set_string(0, Some(&CefString::from(payload)));
    frame.send_process_message(ProcessId::BROWSER, Some(&mut message));
    true
}

fn send_app_modal_host_bridge_process_message(payload: &str) -> bool {
    if payload.chars().count() > APP_MODAL_HOST_BRIDGE_PAYLOAD_MAX_CHARS {
        return false;
    }

    let Some(context) = cef::v8_context_get_current_context() else {
        return false;
    };
    let Some(frame) = context.frame() else {
        return false;
    };
    let mut message = match cef::process_message_create(Some(&CefString::from(
        APP_MODAL_HOST_BRIDGE_PROCESS_MESSAGE_NAME,
    ))) {
        Some(message) => message,
        None => return false,
    };
    let Some(arguments) = message.argument_list() else {
        return false;
    };
    arguments.set_size(1);
    arguments.set_string(0, Some(&CefString::from(payload)));
    frame.send_process_message(ProcessId::BROWSER, Some(&mut message));
    true
}

fn set_v8_bool_return(retval: Option<&mut Option<V8Value>>, value: bool) {
    if let Some(retval) = retval {
        *retval = cef::v8_value_create_bool(if value { 1 } else { 0 });
    }
}

wrap_life_span_handler! {
    struct GhostexGpuiLifeSpanHandler {
        popup_open_handler: BrowserPopupOpenHandler,
    }

    impl LifeSpanHandler {
        fn on_before_popup(
            &self,
            _browser: Option<&mut cef::Browser>,
            _frame: Option<&mut Frame>,
            _popup_id: c_int,
            target_url: Option<&CefString>,
            _target_frame_name: Option<&CefString>,
            _target_disposition: WindowOpenDisposition,
            _user_gesture: c_int,
            _popup_features: Option<&PopupFeatures>,
            _window_info: Option<&mut WindowInfo>,
            _client: Option<&mut Option<Client>>,
            _settings: Option<&mut BrowserSettings>,
            _extra_info: Option<&mut Option<DictionaryValue>>,
            no_javascript_access: Option<&mut c_int>,
        ) -> c_int {
            /*
            CDXC:GPUIBrowserPopups 2026-06-22-07:14:
            Browser-mode target=_blank and window.open requests must stay inside the GPUI Browser workspace. Intercept CEF popup creation through cef-rs LifeSpanHandler, forward only the requested target URL to the shell tab model, and return handled so Chromium does not create a separate native CEF window.

            CDXC:GPUIBrowserPopups 2026-06-23-11:43:
            Match native macOS CEF popup policy: empty target URLs are handled here without dispatching a shell popup callback because there is no transferable URL/content and no fallback transfer/import path. Non-empty targets remain shell-owned Browser tab requests.
            */
            if let Some(no_javascript_access) = no_javascript_access {
                *no_javascript_access = 1;
            }

            if let Some(requested_url) = browser_popup_target_url_for_shell(target_url) {
                (self.popup_open_handler)(requested_url);
            }
            1
        }
    }
}

wrap_display_handler! {
    struct GhostexGpuiDisplayHandler {
        page_metadata_handler: BrowserPageMetadataHandler,
    }

    impl DisplayHandler {
        fn on_address_change(
            &self,
            _browser: Option<&mut cef::Browser>,
            frame: Option<&mut Frame>,
            url: Option<&CefString>,
        ) {
            /*
            CDXC:GPUIBrowserMetadata 2026-06-22-07:23:
            Browser-tab URL state must be driven by CEF's DisplayHandler rather than synthetic shell guesses. Forward only main-frame address changes to the GPUI tab model, where raw runtime URLs can update the active address field while persistence remains guarded by the existing sanitizer.
            */
            if let Some(frame) = frame
                && frame.is_main() == 0
            {
                return;
            }

            let url = url.map(CefString::to_string).unwrap_or_default();
            (self.page_metadata_handler)(BrowserPageMetadataEvent::AddressChanged(url));
        }

        fn on_title_change(&self, _browser: Option<&mut cef::Browser>, title: Option<&CefString>) {
            /*
            CDXC:GPUIBrowserMetadata 2026-06-22-07:23:
            Page titles may contain user-owned content, so CEF title callbacks may update only runtime tab-strip presentation. The GPUI shell-state writer must continue deriving restored titles from sanitized URLs instead of storing raw page titles.
            */
            let title = title.map(CefString::to_string).unwrap_or_default();
            (self.page_metadata_handler)(BrowserPageMetadataEvent::TitleChanged(title));
        }

        fn on_favicon_urlchange(
            &self,
            _browser: Option<&mut cef::Browser>,
            icon_urls: Option<&mut cef::CefStringList>,
        ) {
            /*
            CDXC:GPUIBrowserFavicons 2026-06-22-09:11:
            CEF favicon URL callbacks are runtime browser metadata only. Forward a single representative non-empty URL so the GPUI tab strip can show favicon presence, but keep bitmap download/cache and shell-state persistence of favicon URLs out of this slice.
            */
            let representative_url = icon_urls.and_then(|icon_urls| {
                let icon_urls = (*icon_urls).clone();
                icon_urls.into_iter().find_map(|url| {
                    let url = url.trim().to_string();
                    if url.is_empty() { None } else { Some(url) }
                })
            });
            (self.page_metadata_handler)(BrowserPageMetadataEvent::FaviconUrlChanged(
                representative_url,
            ));
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
    CEF_REQUEST_CONTEXTS_BY_PROFILE.with(|contexts| {
        contexts.borrow_mut().clear();
    });
    unsafe { GhostexGpuiCEFInvalidateMessagePump() };
    cef::shutdown();
}

pub struct CefBrowser {
    browser: RefCell<cef::Browser>,
    _client: Option<cef::Client>,
    _request_context: cef::RequestContext,
    last_bounds: RefCell<Option<cef::Rect>>,
}

impl CefBrowser {
    pub fn new(
        parent_ns_view: *mut c_void,
        url: &str,
        profile: &str,
        popup_open_handler: Option<BrowserPopupOpenHandler>,
        page_metadata_handler: Option<BrowserPageMetadataHandler>,
        sidebar_runtime_settings: Option<SidebarRuntimeSettingsSnapshot>,
        sidebar_gxserver_bootstrap: Option<SidebarGxserverBootstrap>,
        sidebar_bridge_event_handler: Option<SidebarBridgeEventHandler>,
        project_workarea_bridge_event_handler: Option<ProjectWorkareaBridgeEventHandler>,
        app_modal_host_bridge_event_handler: Option<AppModalHostBridgeEventHandler>,
    ) -> Self {
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
        let load_handler =
            if sidebar_bridge_installed_for_handler(sidebar_bridge_event_handler.is_some()) {
                Some(GhostexGpuiSidebarProjectContextLoadHandler::new(
                    sidebar_runtime_settings.unwrap_or_default(),
                    sidebar_gxserver_bootstrap,
                ))
            } else if project_workarea_bridge_event_handler.is_some() {
                Some(GhostexGpuiProjectWorkareaBridgeLoadHandler::new())
            } else {
                None
            };
        let mut client = if popup_open_handler.is_some()
            || page_metadata_handler.is_some()
            || sidebar_bridge_event_handler.is_some()
            || project_workarea_bridge_event_handler.is_some()
            || app_modal_host_bridge_event_handler.is_some()
        {
            Some(GhostexGpuiCefClient::new(
                popup_open_handler.map(GhostexGpuiLifeSpanHandler::new),
                page_metadata_handler.map(GhostexGpuiDisplayHandler::new),
                load_handler,
                sidebar_bridge_event_handler,
                project_workarea_bridge_event_handler,
                app_modal_host_bridge_event_handler,
            ))
        } else {
            None
        };
        let mut request_context = cef_request_context_for_profile(profile)
            .expect("failed to create GPUI CEF request context");
        let browser = cef::browser_host_create_browser_sync(
            Some(&window_info),
            client.as_mut(),
            Some(&url),
            Some(&browser_settings),
            None,
            Some(&mut request_context),
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
            _client: client,
            _request_context: request_context,
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
        if !visible {
            self.blur();
        }

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

    pub fn blur(&self) {
        let browser = self.browser.borrow();
        let Some(host) = browser.host() else {
            return;
        };
        /*
        CDXC:GPUIBrowserLifecycle 2026-06-23-11:32:
        Hiding a GPUI Browser CEF child view for sleep, mode switch, or tab drag must also release Chromium focus and runtime active-view bookkeeping so hidden pages cannot keep command-dispatch ownership. This is a narrow native-view boundary blur; it does not destroy the CEF browser, change layout, persist data, log content, or synthesize native hit routing.
        */
        let native_view = host.window_handle();
        host.set_focus(0);
        clear_active_native_view_if_matching(native_view.cast());
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

    pub fn execute_java_script_in_main_frame(&self, script: &str) -> bool {
        self.focus();
        let browser = self.browser.borrow();
        let Some(frame) = browser.main_frame() else {
            return false;
        };
        /*
        CDXC:GPUIBrowserFeedback 2026-06-23-11:04:
        GPUI Browser feedback tools now use CEF's normal main-frame JavaScript execution path for app-owned injection scripts. Pass a synthetic script URL and return only main-frame availability so this backend does not log page URLs, titles, script bodies, user content, JS errors, cookies, tokens, paths, command text, or terminal content.
        */
        frame.execute_java_script(
            Some(&cef::CefString::from(script)),
            Some(&cef::CefString::from(BROWSER_APP_OWNED_SCRIPT_URL)),
            1,
        );
        true
    }

    pub fn refresh_sidebar_runtime_settings(
        &self,
        runtime_settings: SidebarRuntimeSettingsSnapshot,
    ) {
        let browser = self.browser.borrow();
        let Some(mut frame) = browser.main_frame() else {
            return;
        };
        send_sidebar_runtime_settings_process_message(
            &mut frame,
            SIDEBAR_RUNTIME_SETTINGS_UPDATE_MESSAGE_NAME,
            runtime_settings,
        );
    }

    pub fn refresh_sidebar_gxserver_bootstrap(
        &self,
        gxserver_bootstrap: Option<SidebarGxserverBootstrap>,
    ) {
        let browser = self.browser.borrow();
        let Some(mut frame) = browser.main_frame() else {
            return;
        };
        send_sidebar_gxserver_bootstrap_process_message(&mut frame, gxserver_bootstrap);
    }

    pub fn can_go_back(&self) -> bool {
        self.browser.borrow().can_go_back() != 0
    }

    pub fn go_back(&self) {
        if !self.can_go_back() {
            return;
        }
        self.focus();
        self.browser.borrow().go_back();
    }

    pub fn can_go_forward(&self) -> bool {
        self.browser.borrow().can_go_forward() != 0
    }

    pub fn go_forward(&self) {
        if !self.can_go_forward() {
            return;
        }
        self.focus();
        self.browser.borrow().go_forward();
    }

    pub fn reload(&self) {
        self.focus();
        self.browser.borrow().reload();
    }

    pub fn zoom_level(&self) -> f64 {
        let browser = self.browser.borrow();
        let Some(host) = browser.host() else {
            return 0.0;
        };
        host.zoom_level()
    }

    pub fn reset_zoom(&self) {
        let browser = self.browser.borrow();
        let Some(host) = browser.host() else {
            return;
        };
        /*
        CDXC:GPUIBrowserToolbar 2026-06-22-11:59:
        Zoom reset in the GPUI browser toolbar must use Chromium's browser-host zoom level, matching native CEF behavior and avoiding CSS, JavaScript, overlay, or fallback scaling.
        */
        host.set_zoom_level(0.0);
    }

    pub fn toggle_dev_tools(&self) {
        let browser = self.browser.borrow();
        let Some(host) = browser.host() else {
            return;
        };
        /*
        CDXC:GPUIBrowserToolbar 2026-06-22-11:50:
        Browser toolbar DevTools is a real CEF host action in GPUI. Toggle the browser's associated DevTools surface through CEF itself so the toolbar action is not a silent placeholder and no GPUI overlay, hidden hit region, or synthetic coordinate routing is introduced.
        */
        if host.has_dev_tools() != 0 {
            host.close_dev_tools();
            return;
        }
        let window_info = cef::WindowInfo {
            window_name: cef::CefString::from("Chromium DevTools"),
            ..Default::default()
        };
        let browser_settings = cef::BrowserSettings::default();
        host.show_dev_tools(Some(&window_info), None, Some(&browser_settings), None);
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

fn cef_root_cache_path() -> Result<PathBuf> {
    /*
    CDXC:GPUIPrivacyAudit 2026-06-23-13:18:
    The explicit CEF root cache path prevents Chromium from falling back to its platform default user-data folder. GPUI may create this directory for installation metadata only; Browser request contexts must keep cache_path empty and cookies disabled so profile/page data does not persist here.
    */
    let path = std::env::var_os("GHOSTEX_GPUI_CEF_CACHE_DIR")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".ghostex-gpui/cef"))
        })
        .unwrap_or_else(|| std::env::temp_dir().join("ghostex-gpui/cef"));
    std::fs::create_dir_all(&path).context("failed to create GPUI CEF root cache directory")?;
    Ok(path)
}

fn cef_request_context_for_profile(profile: &str) -> Result<cef::RequestContext> {
    /*
    CDXC:GPUIBrowserProfiles 2026-06-23-13:18:
    Generated Browser profiles remain separate only inside this process. Phase 10 privacy re-audit removed per-profile CEF cache directories and disabled session-cookie persistence so profile ids can persist in shell state without writing profile paths, cookies, credentials, history, page cache, URLs, page titles, command text, terminal content, tokens, or other runtime data.

    CDXC:GPUIBrowserProfiles 2026-06-23-13:24:
    Keep CEF's normal in-memory cookieable scheme behavior while cache_path is empty and session-cookie persistence is disabled. The privacy requirement is no durable cookies/profile stores, not blocking ordinary page behavior inside the live process.
    */
    let profile_segment = cef_profile_cache_segment(profile)
        .unwrap_or("default")
        .to_string();
    CEF_REQUEST_CONTEXTS_BY_PROFILE.with(|contexts| {
        if let Some(context) = contexts.borrow().get(&profile_segment) {
            return Ok(context.clone());
        }

        let settings = cef::RequestContextSettings {
            persist_session_cookies: 0,
            ..Default::default()
        };
        let context = cef::request_context_create_context(Some(&settings), None)
            .context("failed to create GPUI CEF profile request context")?;
        contexts
            .borrow_mut()
            .insert(profile_segment, context.clone());
        Ok(context)
    })
}

fn cef_profile_cache_segment(profile: &str) -> Option<&str> {
    let profile = profile.trim();
    if profile.is_empty() || profile.len() > 64 {
        return None;
    }
    if !profile
        .bytes()
        .next()
        .is_some_and(|byte| byte.is_ascii_alphanumeric())
        || !profile
            .bytes()
            .last()
            .is_some_and(|byte| byte.is_ascii_alphanumeric())
    {
        return None;
    }
    profile
        .bytes()
        .all(|byte| matches!(byte, b'a'..=b'z' | b'0'..=b'9' | b'-'))
        .then_some(profile)
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
    clear_active_native_view_if_matching(native_view);
}

fn clear_active_native_view_if_matching(native_view: *mut c_void) {
    if native_view.is_null() {
        return;
    }

    ACTIVE_CEF_NATIVE_VIEW.with(|active| {
        if active.get() == Some(native_view as usize) {
            active.set(None);
        }
    });
}

fn clear_active_native_view() {
    ACTIVE_CEF_NATIVE_VIEW.with(|active| active.set(None));
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
    clear_active_native_view();
}

#[cfg(test)]
mod tests {
    use super::*;

    /*
    CDXC:GPUIProjectSidebarBridge 2026-06-23-18:29:
    Sidebar bridge tests are source-only privacy and scope evidence. They prove the CEF renderer namespace is a fixed allowlist of typed one-string entry points and that bridge installation is gated by the sidebar handler, without adding Browser-page exposure, generic event names, logging, persistence, validation, or app launch.

    CDXC:GPUISidebarProjectPathActions 2026-06-24-14:18:
    The native project path action is included in the same allowlist evidence because it is a fixed sidebar-only one-string bridge whose app-side parser accepts project ids for path actions and only a relative file candidate for the changed-file Git action, never renderer absolute paths.

    CDXC:GPUISidebarGit 2026-06-24-15:43:
    The same allowlisted bridge may carry existing-PR open and changed-file open requests, but CEF tests should continue proving only fixed function/message routing; Rust owns URL and file-candidate validation through gxserver.

    CDXC:GPUISidebarGxserverFocusState 2026-06-24-21:07:
    Gxserver focus-state publication is included as an allowlisted bridge function because Rust needs the real presentation session ids React receives from gxserver create/focus/fork/restore flows. The payload is still one bounded string and is parsed by Rust before it can update bootstrap state.

    CDXC:GPUICommandPane 2026-06-24-23:17:
    Sidebar command actions are included as an allowlisted bridge function so `runSidebarCommand` reaches the same GPUI app action path as titlebar Actions. The test proves only fixed function/message routing; Rust owns strict payload parsing and command-pane launch boundaries.

    CDXC:GPUICommandPane 2026-06-25-10:34:
    `endSidebarCommandRun` has its own allowlisted bridge function because closing a mapped command-pane run needs only a command id. Keep it separate from Action launch payloads so renderer code cannot reuse the launch bridge to smuggle command text, URLs, project paths, cwd/env, status paths, run ids, or terminal output.
    */
    #[test]
    fn sidebar_bridge_allowlist_maps_only_fixed_functions_to_private_messages() {
        assert_eq!(SIDEBAR_BRIDGE_FUNCTION_SPECS.len(), 9);
        assert_eq!(SIDEBAR_BRIDGE_PAYLOAD_MAX_CHARS, 32 * 1024);

        for (function_name, process_message_name, event_kind) in [
            (
                SIDEBAR_PROJECT_CONTEXT_JS_FUNCTION,
                SIDEBAR_PROJECT_CONTEXT_PROCESS_MESSAGE_NAME,
                SidebarBridgeEventKind::ActiveProjectContext,
            ),
            (
                SIDEBAR_SOURCE_WORKAREA_READINESS_JS_FUNCTION,
                SIDEBAR_SOURCE_WORKAREA_READINESS_PROCESS_MESSAGE_NAME,
                SidebarBridgeEventKind::SourceWorkareaReadiness,
            ),
            (
                SIDEBAR_BROWSER_WORKAREA_READINESS_JS_FUNCTION,
                SIDEBAR_BROWSER_WORKAREA_READINESS_PROCESS_MESSAGE_NAME,
                SidebarBridgeEventKind::BrowserWorkareaReadiness,
            ),
            (
                SIDEBAR_PROJECT_WORKAREA_READINESS_JS_FUNCTION,
                SIDEBAR_PROJECT_WORKAREA_READINESS_PROCESS_MESSAGE_NAME,
                SidebarBridgeEventKind::ProjectWorkareaReadiness,
            ),
            (
                SIDEBAR_MANAGE_FILE_WORKAREA_OPERATION_REQUEST_JS_FUNCTION,
                SIDEBAR_MANAGE_FILE_WORKAREA_OPERATION_REQUEST_PROCESS_MESSAGE_NAME,
                SidebarBridgeEventKind::ManageFileWorkareaOperationRequest,
            ),
            (
                SIDEBAR_NATIVE_PROJECT_PATH_ACTION_JS_FUNCTION,
                SIDEBAR_NATIVE_PROJECT_PATH_ACTION_PROCESS_MESSAGE_NAME,
                SidebarBridgeEventKind::NativeProjectPathAction,
            ),
            (
                SIDEBAR_COMMAND_ACTION_JS_FUNCTION,
                SIDEBAR_COMMAND_ACTION_PROCESS_MESSAGE_NAME,
                SidebarBridgeEventKind::SidebarCommandAction,
            ),
            (
                SIDEBAR_COMMAND_RUN_END_JS_FUNCTION,
                SIDEBAR_COMMAND_RUN_END_PROCESS_MESSAGE_NAME,
                SidebarBridgeEventKind::SidebarCommandRunEnd,
            ),
            (
                SIDEBAR_GXSERVER_FOCUS_STATE_JS_FUNCTION,
                SIDEBAR_GXSERVER_FOCUS_STATE_PROCESS_MESSAGE_NAME,
                SidebarBridgeEventKind::GxserverPresentationFocusState,
            ),
        ] {
            let spec = sidebar_bridge_function_spec_for_js_function(function_name)
                .expect("function should be allowlisted");
            assert_eq!(spec.process_message_name, process_message_name);
            assert_eq!(spec.event_kind, event_kind);
            assert_eq!(
                sidebar_bridge_event_kind_for_process_message(process_message_name),
                Some(event_kind)
            );
        }

        for unexpected in [
            "",
            "postMessage",
            "send",
            "emit",
            "postWorkareaEvent",
            "ghostex.gpui.projectWorkarea.readiness",
            "ghostex.gpui.manageFileWorkarea.operationRequest",
        ] {
            assert!(sidebar_bridge_function_spec_for_js_function(unexpected).is_none());
            assert!(sidebar_bridge_event_kind_for_process_message(unexpected).is_none());
        }
    }

    #[test]
    fn sidebar_bridge_events_are_typed_and_installed_only_with_sidebar_handler() {
        assert!(!sidebar_bridge_installed_for_handler(false));
        assert!(sidebar_bridge_installed_for_handler(true));

        assert_eq!(
            SidebarBridgeEventKind::ActiveProjectContext.with_payload("active".to_string()),
            SidebarBridgeEvent::ActiveProjectContext("active".to_string())
        );
        assert_eq!(
            SidebarBridgeEventKind::SourceWorkareaReadiness.with_payload("source".to_string()),
            SidebarBridgeEvent::SourceWorkareaReadiness("source".to_string())
        );
        assert_eq!(
            SidebarBridgeEventKind::BrowserWorkareaReadiness.with_payload("browser".to_string()),
            SidebarBridgeEvent::BrowserWorkareaReadiness("browser".to_string())
        );
        assert_eq!(
            SidebarBridgeEventKind::ProjectWorkareaReadiness.with_payload("project".to_string()),
            SidebarBridgeEvent::ProjectWorkareaReadiness("project".to_string())
        );
        assert_eq!(
            SidebarBridgeEventKind::ManageFileWorkareaOperationRequest
                .with_payload("manage".to_string()),
            SidebarBridgeEvent::ManageFileWorkareaOperationRequest("manage".to_string())
        );
        assert_eq!(
            SidebarBridgeEventKind::NativeProjectPathAction.with_payload("native".to_string()),
            SidebarBridgeEvent::NativeProjectPathAction("native".to_string())
        );
        assert_eq!(
            SidebarBridgeEventKind::SidebarCommandAction.with_payload("command".to_string()),
            SidebarBridgeEvent::SidebarCommandAction("command".to_string())
        );
        assert_eq!(
            SidebarBridgeEventKind::SidebarCommandRunEnd.with_payload("command-end".to_string()),
            SidebarBridgeEvent::SidebarCommandRunEnd("command-end".to_string())
        );
        assert_eq!(
            SidebarBridgeEventKind::GxserverPresentationFocusState
                .with_payload("focus".to_string()),
            SidebarBridgeEvent::GxserverPresentationFocusState("focus".to_string())
        );
    }
}
