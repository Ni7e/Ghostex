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
const SIDEBAR_PROJECT_CONTEXT_INSTALL_MESSAGE_NAME: &str =
    "ghostex.gpui.sidebar.installActiveProjectContextBridge";
const SIDEBAR_RUNTIME_SETTINGS_UPDATE_MESSAGE_NAME: &str =
    "ghostex.gpui.sidebar.runtimeSettingsChanged";
const SIDEBAR_PROJECT_CONTEXT_JS_NAMESPACE: &str = "ghostexGpui";
const SIDEBAR_PROJECT_CONTEXT_JS_FUNCTION: &str = "postActiveProjectContext";
const SIDEBAR_SOURCE_WORKAREA_READINESS_JS_FUNCTION: &str = "postSourceWorkareaReadiness";
const SIDEBAR_BROWSER_WORKAREA_READINESS_JS_FUNCTION: &str = "postBrowserWorkareaReadiness";
const SIDEBAR_PROJECT_WORKAREA_READINESS_JS_FUNCTION: &str = "postProjectWorkareaReadiness";
const SIDEBAR_MANAGE_FILE_WORKAREA_OPERATION_REQUEST_JS_FUNCTION: &str =
    "postManageFileWorkareaOperationRequest";
const SIDEBAR_RUNTIME_SETTINGS_JS_OBJECT: &str = "runtimeSettings";
const SIDEBAR_RUNTIME_SETTINGS_CHANGED_JS_CALLBACK: &str = "onRuntimeSettingsChanged";
const SIDEBAR_RUNTIME_SETTINGS_DEBUGGING_MODE_JS_FIELD: &str = "debuggingMode";
const SIDEBAR_RUNTIME_SETTINGS_SHOW_BETA_FEATURES_JS_FIELD: &str = "showBetaFeatures";
const SIDEBAR_RUNTIME_SETTINGS_DEBUGGING_MODE_ARGUMENT_INDEX: usize = 0;
const SIDEBAR_RUNTIME_SETTINGS_SHOW_BETA_FEATURES_ARGUMENT_INDEX: usize = 1;
const SIDEBAR_RUNTIME_SETTINGS_ARGUMENT_COUNT: usize = 2;
const SIDEBAR_BRIDGE_PAYLOAD_MAX_CHARS: usize = 32 * 1024;
const BROWSER_APP_OWNED_SCRIPT_URL: &str = "ghostex://gpui/browser-feedback";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SidebarBridgeEventKind {
    ActiveProjectContext,
    SourceWorkareaReadiness,
    BrowserWorkareaReadiness,
    ProjectWorkareaReadiness,
    ManageFileWorkareaOperationRequest,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct SidebarBridgeFunctionSpec {
    js_function_name: &'static str,
    process_message_name: &'static str,
    event_kind: SidebarBridgeEventKind,
}

const SIDEBAR_BRIDGE_FUNCTION_SPECS: [SidebarBridgeFunctionSpec; 5] = [
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
}

pub type SidebarBridgeEventHandler = StdRc<dyn Fn(SidebarBridgeEvent)>;

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

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SidebarRuntimeSettingsSnapshot {
    pub debugging_mode: bool,
    pub show_beta_features: bool,
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
            */
            if source_process != ProcessId::RENDERER {
                return 0;
            }

            let Some(message) = message else {
                return 0;
            };
            let message_name = CefString::from(&message.name()).to_string();
            let Some(event_kind) = sidebar_bridge_event_kind_for_process_message(&message_name)
            else {
                return 0;
            };

            if frame.map(|frame| frame.is_main() == 0).unwrap_or(true) {
                return 1;
            }

            let Some(handler) = self.sidebar_bridge_event_handler.clone() else {
                return 0;
            };
            let Some(arguments) = message.argument_list() else {
                return 1;
            };
            if arguments.size() != 1 || arguments.get_type(0) != ValueType::STRING {
                return 1;
            }

            let payload = CefString::from(&arguments.string(0)).to_string();
            if payload.chars().count() > SIDEBAR_BRIDGE_PAYLOAD_MAX_CHARS {
                return 1;
            }

            handler(event_kind.with_payload(payload));
            1
        }
    }
}

wrap_load_handler! {
    struct GhostexGpuiSidebarProjectContextLoadHandler {
        runtime_settings: SidebarRuntimeSettingsSnapshot,
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
            CDXC:GPUIProjectSidebarBridge 2026-06-23-18:29:
            Install renderer-side `window.ghostexGpui` only for sidebar CEF clients with the fixed allowlisted post functions plus the runtime-only sidebar settings snapshot. The private install process message carries exactly two strict booleans, debuggingMode and showBetaFeatures; ordinary Browser tabs never attach this load handler and receive no GPUI bridge or settings object.
            */
            send_sidebar_runtime_settings_process_message(
                frame,
                SIDEBAR_PROJECT_CONTEXT_INSTALL_MESSAGE_NAME,
                self.runtime_settings,
            );
        }
    }
}

wrap_render_process_handler! {
    struct GhostexGpuiRenderProcessHandler;

    impl RenderProcessHandler {
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
            if !is_install_message && !is_runtime_settings_update {
                return 0;
            }
            let runtime_settings = sidebar_runtime_settings_from_install_message(message);
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
            if is_install_message {
                install_sidebar_project_context_v8_bridge(Some(&mut context), runtime_settings);
            } else {
                update_sidebar_runtime_settings_v8_bridge(Some(&mut context), runtime_settings);
            }
            context.exit();
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
) {
    /*
    CDXC:GPUIProjectSidebarBridge 2026-06-23-18:29:
    The renderer-side sidebar bridge exposes only fixed typed string-payload functions for active-project context, Source readiness, Browser readiness, project-workarea readiness, and Manage operation requests, plus `window.ghostexGpui.runtimeSettings` with only debuggingMode and showBetaFeatures booleans. It does not expose generic message names, event buses, filesystem/project detection, URL/title inspection, logging, persistence, or fallback project inference.

    CDXC:GPUIProjectSidebarBridge 2026-06-23-06:57:
    After initial install, runtime settings refresh uses a second private browser-to-renderer CEF message that can replace only the two existing runtimeSettings booleans and notify the page through `window.ghostexGpui.onRuntimeSettingsChanged(settings)`. This keeps ordinary Browser tabs out of the sidebar bridge and avoids a generic event/settings bus.
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
        let mut function =
            cef::v8_value_create_function(Some(&function_name), Some(&mut handler));
        let Some(function) = function.as_mut() else {
            return;
        };

        namespace.set_value_bykey(
            Some(&function_name),
            Some(function),
            V8Propertyattribute::default(),
        );
    }
    let _ = install_sidebar_runtime_settings_v8_object(namespace, runtime_settings);
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
        install_sidebar_runtime_settings_v8_object(namespace, runtime_settings)
    else {
        return;
    };
    notify_sidebar_runtime_settings_changed(context, namespace, runtime_settings_object);
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
}

fn sidebar_runtime_settings_from_install_message(
    message: &mut ProcessMessage,
) -> SidebarRuntimeSettingsSnapshot {
    let Some(arguments) = message.argument_list() else {
        return SidebarRuntimeSettingsSnapshot::default();
    };
    if arguments.size() != SIDEBAR_RUNTIME_SETTINGS_ARGUMENT_COUNT {
        return SidebarRuntimeSettingsSnapshot::default();
    }
    if arguments.get_type(SIDEBAR_RUNTIME_SETTINGS_DEBUGGING_MODE_ARGUMENT_INDEX)
        != ValueType::BOOL
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
    }
}

fn install_sidebar_runtime_settings_v8_object(
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

    let runtime_settings_key = CefString::from(SIDEBAR_RUNTIME_SETTINGS_JS_OBJECT);
    namespace.set_value_bykey(
        Some(&runtime_settings_key),
        Some(&mut runtime_settings_object),
        V8Propertyattribute::default(),
    );
    Some(runtime_settings_object)
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

fn set_v8_bool_property(object: &mut V8Value, key: &str, value: bool) {
    let key = CefString::from(key);
    let mut value = cef::v8_value_create_bool(bool_to_cef_int(value));
    object.set_value_bykey(
        Some(&key),
        value.as_mut(),
        V8Propertyattribute::default(),
    );
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
    let mut message = match cef::process_message_create(Some(&CefString::from(process_message_name)))
    {
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
        sidebar_bridge_event_handler: Option<SidebarBridgeEventHandler>,
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
            sidebar_bridge_installed_for_handler(sidebar_bridge_event_handler.is_some()).then(
                || {
                    GhostexGpuiSidebarProjectContextLoadHandler::new(
                        sidebar_runtime_settings.unwrap_or_default(),
                    )
                },
            );
        let mut client = if popup_open_handler.is_some()
            || page_metadata_handler.is_some()
            || sidebar_bridge_event_handler.is_some()
        {
            Some(GhostexGpuiCefClient::new(
                popup_open_handler.map(GhostexGpuiLifeSpanHandler::new),
                page_metadata_handler.map(GhostexGpuiDisplayHandler::new),
                load_handler,
                sidebar_bridge_event_handler,
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
    */
    #[test]
    fn sidebar_bridge_allowlist_maps_only_fixed_functions_to_private_messages() {
        assert_eq!(SIDEBAR_BRIDGE_FUNCTION_SPECS.len(), 5);
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
    }
}
