#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SidebarBridgeFunctionId {
    ActiveProjectContext,
    SourceWorkareaReadiness,
    BrowserWorkareaReadiness,
    ProjectWorkareaReadiness,
    ManageFileWorkareaOperationRequest,
    NativeProjectPathAction,
    NativeAppShotPrompt,
    SidebarCommandAction,
    SidebarCommandRunEnd,
    GhostexHotkeyAction,
    GxserverPresentationFocusState,
    WorkspaceTerminalFocus,
    T3SessionFocus,
    T3SessionCreate,
    WorkspaceTerminalRenameCommand,
    WorkspaceTerminalLifecycleResult,
    SessionStatusIndicators,
    PetOverlayState,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct SidebarBridgeFunctionSpec {
    #[allow(dead_code)]
    pub(crate) id: SidebarBridgeFunctionId,
    pub(crate) js_function_name: &'static str,
    pub(crate) process_message_name: &'static str,
}

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
const SIDEBAR_NATIVE_APP_SHOT_PROMPT_PROCESS_MESSAGE_NAME: &str =
    "ghostex.gpui.sidebar.nativeAppShotPrompt";
const SIDEBAR_COMMAND_ACTION_PROCESS_MESSAGE_NAME: &str = "ghostex.gpui.sidebar.commandAction";
const SIDEBAR_COMMAND_RUN_END_PROCESS_MESSAGE_NAME: &str = "ghostex.gpui.sidebar.commandRunEnd";
const SIDEBAR_GHOSTEX_HOTKEY_ACTION_PROCESS_MESSAGE_NAME: &str =
    "ghostex.gpui.sidebar.ghostexHotkeyAction";
const SIDEBAR_GXSERVER_FOCUS_STATE_PROCESS_MESSAGE_NAME: &str =
    "ghostex.gpui.sidebar.gxserverPresentationFocusState";
const SIDEBAR_WORKSPACE_TERMINAL_FOCUS_PROCESS_MESSAGE_NAME: &str =
    "ghostex.gpui.sidebar.workspaceTerminalFocus";
const SIDEBAR_T3_SESSION_FOCUS_PROCESS_MESSAGE_NAME: &str = "ghostex.gpui.sidebar.t3SessionFocus";
const SIDEBAR_T3_SESSION_CREATE_PROCESS_MESSAGE_NAME: &str = "ghostex.gpui.sidebar.t3SessionCreate";
const SIDEBAR_WORKSPACE_TERMINAL_RENAME_COMMAND_PROCESS_MESSAGE_NAME: &str =
    "ghostex.gpui.sidebar.workspaceTerminalRenameCommand";
const SIDEBAR_WORKSPACE_TERMINAL_LIFECYCLE_RESULT_PROCESS_MESSAGE_NAME: &str =
    "ghostex.gpui.sidebar.workspaceTerminalLifecycleResult";
const SIDEBAR_SESSION_STATUS_INDICATORS_PROCESS_MESSAGE_NAME: &str =
    "ghostex.gpui.sidebar.sessionStatusIndicators";
const SIDEBAR_PET_OVERLAY_STATE_PROCESS_MESSAGE_NAME: &str = "ghostex.gpui.sidebar.petOverlayState";

pub(crate) const SIDEBAR_PROJECT_CONTEXT_JS_NAMESPACE: &str = "ghostexGpui";
const SIDEBAR_PROJECT_CONTEXT_JS_FUNCTION: &str = "postActiveProjectContext";
const SIDEBAR_SOURCE_WORKAREA_READINESS_JS_FUNCTION: &str = "postSourceWorkareaReadiness";
const SIDEBAR_BROWSER_WORKAREA_READINESS_JS_FUNCTION: &str = "postBrowserWorkareaReadiness";
const SIDEBAR_PROJECT_WORKAREA_READINESS_JS_FUNCTION: &str = "postProjectWorkareaReadiness";
const SIDEBAR_MANAGE_FILE_WORKAREA_OPERATION_REQUEST_JS_FUNCTION: &str =
    "postManageFileWorkareaOperationRequest";
const SIDEBAR_NATIVE_PROJECT_PATH_ACTION_JS_FUNCTION: &str = "postNativeProjectPathAction";
const SIDEBAR_NATIVE_APP_SHOT_PROMPT_JS_FUNCTION: &str = "postNativeAppShotPromptToSession";
const SIDEBAR_COMMAND_ACTION_JS_FUNCTION: &str = "postSidebarCommandAction";
const SIDEBAR_COMMAND_RUN_END_JS_FUNCTION: &str = "postSidebarCommandRunEnd";
const SIDEBAR_GHOSTEX_HOTKEY_ACTION_JS_FUNCTION: &str = "postGhostexHotkeyAction";
const SIDEBAR_GXSERVER_FOCUS_STATE_JS_FUNCTION: &str = "postGxserverPresentationFocusState";
const SIDEBAR_WORKSPACE_TERMINAL_FOCUS_JS_FUNCTION: &str = "postWorkspaceTerminalFocus";
const SIDEBAR_T3_SESSION_FOCUS_JS_FUNCTION: &str = "postT3SessionFocus";
const SIDEBAR_T3_SESSION_CREATE_JS_FUNCTION: &str = "postT3SessionCreate";
const SIDEBAR_WORKSPACE_TERMINAL_RENAME_COMMAND_JS_FUNCTION: &str =
    "postWorkspaceTerminalRenameCommand";
const SIDEBAR_WORKSPACE_TERMINAL_LIFECYCLE_RESULT_JS_FUNCTION: &str =
    "postWorkspaceTerminalLifecycleResult";
const SIDEBAR_SESSION_STATUS_INDICATORS_JS_FUNCTION: &str = "postSessionStatusIndicators";
const SIDEBAR_PET_OVERLAY_STATE_JS_FUNCTION: &str = "postPetOverlayState";

pub(crate) const SIDEBAR_BRIDGE_PAYLOAD_MAX_CHARS: usize = 32 * 1024;

/*
CDXC:GPUISidebarBridgeOwnership 2026-06-28-23:24:
The sidebar CEF post-function allowlist must have one Rust manifest shared by main-process macOS CEF and the helper renderer, so packaged helper-backed sidebars cannot lose supported calls such as workspace terminal rename.
*/
pub(crate) const SIDEBAR_BRIDGE_FUNCTION_SPECS: [SidebarBridgeFunctionSpec; 18] = [
    SidebarBridgeFunctionSpec {
        id: SidebarBridgeFunctionId::ActiveProjectContext,
        js_function_name: SIDEBAR_PROJECT_CONTEXT_JS_FUNCTION,
        process_message_name: SIDEBAR_PROJECT_CONTEXT_PROCESS_MESSAGE_NAME,
    },
    SidebarBridgeFunctionSpec {
        id: SidebarBridgeFunctionId::SourceWorkareaReadiness,
        js_function_name: SIDEBAR_SOURCE_WORKAREA_READINESS_JS_FUNCTION,
        process_message_name: SIDEBAR_SOURCE_WORKAREA_READINESS_PROCESS_MESSAGE_NAME,
    },
    SidebarBridgeFunctionSpec {
        id: SidebarBridgeFunctionId::BrowserWorkareaReadiness,
        js_function_name: SIDEBAR_BROWSER_WORKAREA_READINESS_JS_FUNCTION,
        process_message_name: SIDEBAR_BROWSER_WORKAREA_READINESS_PROCESS_MESSAGE_NAME,
    },
    SidebarBridgeFunctionSpec {
        id: SidebarBridgeFunctionId::ProjectWorkareaReadiness,
        js_function_name: SIDEBAR_PROJECT_WORKAREA_READINESS_JS_FUNCTION,
        process_message_name: SIDEBAR_PROJECT_WORKAREA_READINESS_PROCESS_MESSAGE_NAME,
    },
    SidebarBridgeFunctionSpec {
        id: SidebarBridgeFunctionId::ManageFileWorkareaOperationRequest,
        js_function_name: SIDEBAR_MANAGE_FILE_WORKAREA_OPERATION_REQUEST_JS_FUNCTION,
        process_message_name: SIDEBAR_MANAGE_FILE_WORKAREA_OPERATION_REQUEST_PROCESS_MESSAGE_NAME,
    },
    SidebarBridgeFunctionSpec {
        id: SidebarBridgeFunctionId::NativeProjectPathAction,
        js_function_name: SIDEBAR_NATIVE_PROJECT_PATH_ACTION_JS_FUNCTION,
        process_message_name: SIDEBAR_NATIVE_PROJECT_PATH_ACTION_PROCESS_MESSAGE_NAME,
    },
    SidebarBridgeFunctionSpec {
        id: SidebarBridgeFunctionId::NativeAppShotPrompt,
        js_function_name: SIDEBAR_NATIVE_APP_SHOT_PROMPT_JS_FUNCTION,
        process_message_name: SIDEBAR_NATIVE_APP_SHOT_PROMPT_PROCESS_MESSAGE_NAME,
    },
    SidebarBridgeFunctionSpec {
        id: SidebarBridgeFunctionId::SidebarCommandAction,
        js_function_name: SIDEBAR_COMMAND_ACTION_JS_FUNCTION,
        process_message_name: SIDEBAR_COMMAND_ACTION_PROCESS_MESSAGE_NAME,
    },
    SidebarBridgeFunctionSpec {
        id: SidebarBridgeFunctionId::SidebarCommandRunEnd,
        js_function_name: SIDEBAR_COMMAND_RUN_END_JS_FUNCTION,
        process_message_name: SIDEBAR_COMMAND_RUN_END_PROCESS_MESSAGE_NAME,
    },
    SidebarBridgeFunctionSpec {
        id: SidebarBridgeFunctionId::GhostexHotkeyAction,
        js_function_name: SIDEBAR_GHOSTEX_HOTKEY_ACTION_JS_FUNCTION,
        process_message_name: SIDEBAR_GHOSTEX_HOTKEY_ACTION_PROCESS_MESSAGE_NAME,
    },
    SidebarBridgeFunctionSpec {
        id: SidebarBridgeFunctionId::GxserverPresentationFocusState,
        js_function_name: SIDEBAR_GXSERVER_FOCUS_STATE_JS_FUNCTION,
        process_message_name: SIDEBAR_GXSERVER_FOCUS_STATE_PROCESS_MESSAGE_NAME,
    },
    SidebarBridgeFunctionSpec {
        id: SidebarBridgeFunctionId::WorkspaceTerminalFocus,
        js_function_name: SIDEBAR_WORKSPACE_TERMINAL_FOCUS_JS_FUNCTION,
        process_message_name: SIDEBAR_WORKSPACE_TERMINAL_FOCUS_PROCESS_MESSAGE_NAME,
    },
    SidebarBridgeFunctionSpec {
        id: SidebarBridgeFunctionId::T3SessionFocus,
        js_function_name: SIDEBAR_T3_SESSION_FOCUS_JS_FUNCTION,
        process_message_name: SIDEBAR_T3_SESSION_FOCUS_PROCESS_MESSAGE_NAME,
    },
    SidebarBridgeFunctionSpec {
        id: SidebarBridgeFunctionId::T3SessionCreate,
        js_function_name: SIDEBAR_T3_SESSION_CREATE_JS_FUNCTION,
        process_message_name: SIDEBAR_T3_SESSION_CREATE_PROCESS_MESSAGE_NAME,
    },
    SidebarBridgeFunctionSpec {
        id: SidebarBridgeFunctionId::WorkspaceTerminalRenameCommand,
        js_function_name: SIDEBAR_WORKSPACE_TERMINAL_RENAME_COMMAND_JS_FUNCTION,
        process_message_name: SIDEBAR_WORKSPACE_TERMINAL_RENAME_COMMAND_PROCESS_MESSAGE_NAME,
    },
    SidebarBridgeFunctionSpec {
        id: SidebarBridgeFunctionId::WorkspaceTerminalLifecycleResult,
        js_function_name: SIDEBAR_WORKSPACE_TERMINAL_LIFECYCLE_RESULT_JS_FUNCTION,
        process_message_name: SIDEBAR_WORKSPACE_TERMINAL_LIFECYCLE_RESULT_PROCESS_MESSAGE_NAME,
    },
    SidebarBridgeFunctionSpec {
        id: SidebarBridgeFunctionId::SessionStatusIndicators,
        js_function_name: SIDEBAR_SESSION_STATUS_INDICATORS_JS_FUNCTION,
        process_message_name: SIDEBAR_SESSION_STATUS_INDICATORS_PROCESS_MESSAGE_NAME,
    },
    SidebarBridgeFunctionSpec {
        id: SidebarBridgeFunctionId::PetOverlayState,
        js_function_name: SIDEBAR_PET_OVERLAY_STATE_JS_FUNCTION,
        process_message_name: SIDEBAR_PET_OVERLAY_STATE_PROCESS_MESSAGE_NAME,
    },
];

pub(crate) fn sidebar_bridge_function_spec_for_js_function(
    function_name: &str,
) -> Option<&'static SidebarBridgeFunctionSpec> {
    SIDEBAR_BRIDGE_FUNCTION_SPECS
        .iter()
        .find(|spec| spec.js_function_name == function_name)
}
