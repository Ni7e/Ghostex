//! Clicking a row that lives on ANOTHER machine: which session, which pane, and the one native
//! action that opens it.
//!
//! CDXC:RemoteMachines 2026-09-21 WHY:
//! The old runtime's remote branch of `focusSession` is four steps and the ORDER of them is the
//! whole contract: acknowledge the attention, work out `keepView` from the group that is active
//! right now, read the agent's Default Agent View off THAT machine's presentation, and post
//! `openRemoteSessionTerminal` through the fixed native project-path bridge. Only if that post is
//! accepted does the focus move. The post is the one thing this crate cannot do, so the plan ends
//! at the payload and the host performs it; the marks it then applies are the core's own focus
//! intent rather than a second copy of the runtime's bookkeeping.
//!
//! **What the payload actually reaches.** The bridge arm for this action is
//! `handle_gpui_remote_session_native_action`, which resolves the machine's SSH configuration and
//! its tunnel target and ends in `begin_gpui_remote_attach_terminal_open`. That is the function the
//! old path ends in, and it is the function the host calls, through the same
//! `receive_sidebar_native_project_path_action_payload` entry the bridge message lands on, so the
//! remote revalidation contract stays one implementation.
//!
//! **`keepView` is read from the sidebar group id, not from the typed active group.** The
//! TypeScript asks `parseGpuiRemotePresentationGroupId(activeGroupId)` and compares the machine and
//! the project it finds, so a Space's subgroup id, the machine's Chats group and a local group all
//! answer "this focus changes the project". Reproducing that on the string keeps the two sides
//! reading one rule instead of two.
//!
//! Refused, each with its reason: a LOCAL row (the store's own focus path owns it), a browser row
//! (an app tab, not a session), an id that does not parse as a remote session, and a machine whose
//! rows did not come from THIS run's stream (not loaded yet, or drawn from the stored last-seen
//! copy), because the old runtime reads the agent from its live presentations only and so sends a
//! different payload for such a row than the store's rows would give.
//!
//! SEE-ALSO: apps/desktop/sidebar/gxserver-runtime/sessions-and-focus.ts (`focusSession`'s remote
//! branch, `focusChangesActiveProject`, `sessionPreferredAgentInterface`, `splitSessionRight`),
//! apps/desktop/src/app/gx_store/sidebar_remote_focus.rs,
//! apps/desktop/src/app/remote_conn/native_action.rs.

use serde_json::{json, Map, Value};

use crate::core::Core;
use crate::keys::{MachineId, ProjectKey, SessionKey};

use super::resolve::{
    text_field, NATIVE_PROJECT_PATH_ACTION_MESSAGE_TYPE, NATIVE_PROJECT_PATH_ACTION_MESSAGE_VERSION,
};

/// The two messages whose remote branch is this file's. `focusSession` is what
/// `selectNativeSidebarSession` posts for a row click, and what a Space restore posts with
/// `keepView`; `splitSessionRight` is the same open with a placement.
pub const REMOTE_FOCUS_MESSAGE_TYPES: [&str; 2] = ["focusSession", "splitSessionRight"];

/// `resolveEffectivePreferredAgentInterface`'s two inputs, as plain data.
///
/// The Default Agent View lives in the shared settings document, which this crate does not read.
/// The host hands over the normalized global value and the per-agent overrides it already parses
/// (`gpui_preferred_agent_interface_from_settings` and its override sibling), so the resolution
/// itself stays here where the gate can drive it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PreferredInterfaceSettings {
    /// `"chat"` or `"terminal"`, already normalized.
    pub default_interface: String,
    /// Agent id to `"chat"` or `"terminal"`. Any other value is an absent override.
    pub overrides: Vec<(String, String)>,
}

impl PreferredInterfaceSettings {
    /// `sessionPreferredAgentInterface`: nothing at all for a row with no agent id, because the
    /// desktop drops the intent for such a row anyway and an unset value keeps the extra
    /// attach-metadata preview off the plain-terminal path.
    pub fn resolve(&self, agent_id: Option<&str>) -> Option<&str> {
        let agent_id = agent_id.map(str::trim).filter(|id| !id.is_empty())?;
        let override_value = self
            .overrides
            .iter()
            .find(|(id, _)| id == agent_id)
            .map(|(_, value)| value.as_str())
            .filter(|value| *value == "chat" || *value == "terminal");
        Some(override_value.unwrap_or(self.default_interface.as_str()))
    }
}

/// A remote row's click, resolved.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RemoteFocusPlan {
    /// The row, as a key that carries its machine.
    pub session: SessionKey,
    /// Queued for the old runtime, which owns the attention timers and their minimum visible
    /// window; a click acknowledges before anything else happens, exactly as Split Right does.
    pub acknowledge_attention: bool,
    /// Whether the destination keeps its own remembered view instead of switching to Agents.
    pub keep_view: bool,
    /// The agent's Default Agent View, absent for a row with no agent.
    pub preferred_interface: Option<String>,
    /// Split Right, which is this same open with a placement.
    pub split_right: bool,
    /// The `openRemoteSessionTerminal` payload, ready for the native project-path entry point.
    pub native_action: Value,
}

impl RemoteFocusPlan {
    pub fn machine_id(&self) -> &str {
        self.session.machine.remote_id().unwrap_or_default()
    }

    /// The plan in the shape the parity gate compares: the payload that opens the pane and the
    /// marks that follow it.
    pub fn to_json(&self) -> Value {
        json!({
            "session": self.session.to_sidebar_session_id(),
            "acknowledgeAttention": self.acknowledge_attention,
            "keepView": self.keep_view,
            "preferredInterface": self.preferred_interface,
            "splitRight": self.split_right,
            "nativeAction": self.native_action,
        })
    }
}

/// What a click on a remote row does, or `None` when this file does not own the payload and the old
/// runtime must answer it whole.
pub fn plan_remote_focus(
    core: &Core,
    message: &Value,
    settings: &PreferredInterfaceSettings,
) -> Option<RemoteFocusPlan> {
    let kind = text_field(message, "type")?;
    if !REMOTE_FOCUS_MESSAGE_TYPES.contains(&kind) {
        return None;
    }
    let sidebar_session_id = text_field(message, "sessionId")?;
    // A browser row is an app tab and never reaches the remote branch: `focusSession` answers it
    // one arm earlier, before the id is parsed at all.
    if sidebar_session_id.starts_with("gpui-browser:") {
        return None;
    }
    let session = SessionKey::parse_remote_scoped_session_id(sidebar_session_id)?;
    // CDXC:RemoteMachines 2026-09-21 WHY:
    // Only a machine THIS run's stream delivered is answered here. `sessionPreferredAgentInterface`
    // reads the row out of `this.remotePresentations`, which holds only what a stream delivered and
    // loses the machine on disconnect; it never reads the last-seen map it draws faded rows from.
    // So for a machine that is offline and showing its last-seen rows, or connected with no snapshot
    // yet, the old runtime still posts the open but WITHOUT `preferredInterface`, while the store's
    // last-seen rows would name the agent and add the field. Handing the click back keeps the one
    // payload that has always been sent, exactly as `loaded_live` does for the set planners.
    if core.presentation().loaded_live(&session.machine).is_none() {
        return None;
    }
    let split_right = kind == "splitSessionRight";
    // Split Right hands `focusLocalWorkspaceSession` a placement and NOTHING else: no `keepView`,
    // and no preferred interface either, so the two fields are the focus click's alone.
    let keep_view = match split_right {
        true => false,
        false => {
            message.get("keepView") == Some(&Value::Bool(true))
                || focus_changes_active_project(core, &session)
        }
    };
    let preferred_interface = match split_right {
        true => None,
        false => settings
            .resolve(agent_id_of(core, &session))
            .map(str::to_string),
    };
    let native_action = open_remote_session_terminal(
        sidebar_session_id,
        keep_view,
        preferred_interface.as_deref(),
        split_right,
    );
    Some(RemoteFocusPlan {
        session,
        acknowledge_attention: true,
        keep_view,
        preferred_interface,
        split_right,
        native_action,
    })
}

/// `postNativeProjectPathAction`'s payload, with the three options that ride only when they are
/// set: the TypeScript spreads `options.placement ? { placement } : {}`, and an absent key is a
/// different message from a `false` or a `null` to the strict parser on the other side.
fn open_remote_session_terminal(
    scoped_session_id: &str,
    keep_view: bool,
    preferred_interface: Option<&str>,
    split_right: bool,
) -> Value {
    let mut payload = Map::new();
    payload.insert(
        "action".to_string(),
        Value::String("openRemoteSessionTerminal".to_string()),
    );
    if split_right {
        payload.insert(
            "placement".to_string(),
            Value::String("splitRight".to_string()),
        );
    }
    if let Some(preferred_interface) = preferred_interface {
        payload.insert(
            "preferredInterface".to_string(),
            Value::String(preferred_interface.to_string()),
        );
    }
    if keep_view {
        payload.insert("keepView".to_string(), Value::Bool(true));
    }
    payload.insert(
        "projectId".to_string(),
        Value::String(scoped_session_id.to_string()),
    );
    payload.insert(
        "type".to_string(),
        Value::String(NATIVE_PROJECT_PATH_ACTION_MESSAGE_TYPE.to_string()),
    );
    payload.insert(
        "version".to_string(),
        Value::from(NATIVE_PROJECT_PATH_ACTION_MESSAGE_VERSION),
    );
    Value::Object(payload)
}

/// `focusChangesActiveProject` for a remote target: the active group id is parsed as a remote
/// PROJECT group, and the focus stays inside the project only when that parse names this machine
/// and this project. A subgroup id, the machine's Chats group and every local group all fail that
/// parse and answer "the project changes", which is the rule the string form encodes.
fn focus_changes_active_project(core: &Core, session: &SessionKey) -> bool {
    let Some(active) = core.focus().active_group.as_ref() else {
        return true;
    };
    let Some(project) = ProjectKey::parse_sidebar_group_id(&active.to_sidebar_group_id()) else {
        return true;
    };
    project.machine != session.machine || project.project_id != session.project_id
}

/// The agent id of the row on ITS machine, which is what `sessionPreferredAgentInterface` reads out
/// of `remotePresentations.get(machineId)`: the live rows only, never the last-seen copy. A row that
/// machine does not list has none.
fn agent_id_of<'a>(core: &'a Core, session: &SessionKey) -> Option<&'a str> {
    let machine: &MachineId = &session.machine;
    core.presentation()
        .loaded_live(machine)?
        .server_session(&session.project_id, &session.session_id)?
        .agent_id
        .as_deref()
}
