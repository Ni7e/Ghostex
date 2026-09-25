//! `normalizeghostexHotkeySettings`: the user's hotkey map resolved against the defaults, the
//! retired defaults, the reserved chords and the New Agent Session / New Terminal layout.

use std::collections::BTreeMap;

use serde_json::Value;

use super::hotkey_table::HOTKEY_DEFINITIONS;
use super::text::{normalize_hotkey_text, HotkeyPlatform};
use crate::sidebar_view::text::js_trim;

const NEW_SESSION_PRIMARY_KEY: &str = "cmd+t";
const NEW_SESSION_SECONDARY_KEY: &str = "cmd+shift+t";

/// `GHOSTEX_RESERVED_HOTKEY_CHORDS`: the terminal owns Cmd+K on macOS only.
fn is_reserved(value: &str, platform: HotkeyPlatform) -> bool {
    let normalized = normalize_hotkey_text(value);
    let opening = normalized.split(' ').next().unwrap_or("");
    platform == HotkeyPlatform::Mac && !opening.is_empty() && opening == "cmd+k"
}

/// Every hotkey id resolved to the chord it runs on, `""` for one the user unassigned.
pub(crate) fn normalize_hotkey_settings(
    candidate: &Value,
    preferred_agent_interface: Option<&str>,
    platform: HotkeyPlatform,
) -> BTreeMap<&'static str, String> {
    let source = candidate.as_object();
    let read = |id: &str| -> Option<&Value> { source.and_then(|source| source.get(id)) };
    let mut normalized: BTreeMap<&'static str, String> = BTreeMap::new();
    for definition in HOTKEY_DEFINITIONS {
        let platform_default = if platform == HotkeyPlatform::Mac {
            definition.default_key
        } else {
            definition
                .windows_linux_default_key
                .unwrap_or(definition.default_key)
        };
        let value = read(definition.id)
            .filter(|value| !value.is_null())
            .or_else(|| legacy_project_jump(definition.id).and_then(read));
        if let Some(Value::String(value)) = value {
            let hotkey = if js_trim(value).is_empty() {
                String::new()
            } else {
                normalize_hotkey_text(value)
            };
            let retired = definition.retired_default_keys.contains(&hotkey.as_str());
            let mac_default_elsewhere = platform != HotkeyPlatform::Mac
                && definition.windows_linux_default_key.is_some()
                && hotkey == definition.default_key;
            let chord = if retired || mac_default_elsewhere || is_reserved(&hotkey, platform) {
                platform_default.to_string()
            } else {
                hotkey
            };
            normalized.insert(definition.id, chord);
            continue;
        }
        normalized.insert(definition.id, platform_default.to_string());
    }
    apply_new_session_layout(
        &mut normalized,
        read("createAgentSession").is_some_and(Value::is_string),
        preferred_agent_interface,
    );
    normalized
}

/// `jumpToProject1..5` keep a chord the user saved under the old `focusGroup1..5` id.
fn legacy_project_jump(id: &str) -> Option<&'static str> {
    Some(match id {
        "jumpToProject1" => "focusGroup1",
        "jumpToProject2" => "focusGroup2",
        "jumpToProject3" => "focusGroup3",
        "jumpToProject4" => "focusGroup4",
        "jumpToProject5" => "focusGroup5",
        _ => return None,
    })
}

/// `applyNewSessionHotkeyLayout`.
fn apply_new_session_layout(
    normalized: &mut BTreeMap<&'static str, String>,
    agent_session_saved: bool,
    preferred_agent_interface: Option<&str>,
) {
    if !agent_session_saved
        && normalized.get("createSession").map(String::as_str) == Some(NEW_SESSION_PRIMARY_KEY)
    {
        normalized.insert("createSession", NEW_SESSION_SECONDARY_KEY.to_string());
    }
    let agent = normalized
        .get("createAgentSession")
        .cloned()
        .unwrap_or_default();
    let terminal = normalized.get("createSession").cloned().unwrap_or_default();
    let pair = [agent.as_str(), terminal.as_str()];
    if !pair.contains(&NEW_SESSION_PRIMARY_KEY) || !pair.contains(&NEW_SESSION_SECONDARY_KEY) {
        return;
    }
    let terminal_first = preferred_agent_interface == Some("terminal");
    normalized.insert(
        "createAgentSession",
        if terminal_first {
            NEW_SESSION_SECONDARY_KEY
        } else {
            NEW_SESSION_PRIMARY_KEY
        }
        .to_string(),
    );
    normalized.insert(
        "createSession",
        if terminal_first {
            NEW_SESSION_PRIMARY_KEY
        } else {
            NEW_SESSION_SECONDARY_KEY
        }
        .to_string(),
    );
}
