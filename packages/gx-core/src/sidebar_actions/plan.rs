//! What an action does, as data the host performs.
//!
//! CDXC:ContextMenus 2026-09-20 WHY:
//! A sidebar action is not a state change: it is one or more calls the host makes (a clipboard
//! write, the fixed native project-path bridge, a toast). Those calls are the thing that has to
//! match the TypeScript exactly, and a wrong one is invisible in any comparison of the drawn list,
//! so they are modelled as values here rather than performed where they are decided. The host runs
//! them; the parity gate enumerates them and diffs them against the calls the shipped TypeScript
//! makes for the same payload.
//!
//! SEE-ALSO: apps/desktop/src/app/gx_store/sidebar_actions.rs (the host that runs them),
//! tooling/gx-core/action-parity.ts (the gate).

use serde_json::{json, Map, Value};

/// The four levels `AppToastLevel` has.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToastLevel {
    Info,
    Success,
    Warning,
    Error,
}

impl ToastLevel {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Info => "info",
            Self::Success => "success",
            Self::Warning => "warning",
            Self::Error => "error",
        }
    }
}

/// One call the host makes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ActionEffect {
    /// `postAppModalHostMessage({ type: 'copySessionDetails', detailsText })`: the text goes to the
    /// clipboard and the copy sound plays. The text is passed on exactly as it arrived, because
    /// `normalizeNonEmptyString` tests the trimmed value and returns the original.
    CopyText { text: String },
    /// `window.ghostexGpui.postNativeProjectPathAction(payload)`: the fixed native bridge, with
    /// the payload already in its wire shape.
    NativeProjectPathAction { payload: Value },
    /// `postAppModalHostMessage(createAppToastRequest(...))`.
    Toast {
        level: ToastLevel,
        title: String,
        description: Option<String>,
    },
    /// `closeAppModal(...)`: `postAppModalHostMessage({ type: 'close' })`. The area string the
    /// TypeScript passes is a log label for its own error path and never reaches the host, so it is
    /// not carried here.
    CloseAppModal,
    /// `openAppModal(payload)`, which is `postAppModalHostMessage(payload)` with the payload
    /// already built. Quick Access is one of these too: `openQuickAccess` is a translation table
    /// over the same call, so the store does the translating and the host opens one thing.
    OpenAppModal { payload: Value },
    /// `runtime.startLocalGxserver()`: the one payload of the open family that opens nothing.
    StartLocalGxserver,
}

impl ActionEffect {
    /// The effect as the parity gate compares it. Keys are sorted by `serde_json`, so two sides
    /// that agree produce the same text.
    pub fn to_json(&self) -> Value {
        match self {
            Self::CopyText { text } => json!({ "call": "copyText", "text": text }),
            Self::NativeProjectPathAction { payload } => {
                json!({ "call": "nativeProjectPathAction", "payload": payload })
            }
            Self::Toast {
                level,
                title,
                description,
            } => {
                let mut object = Map::new();
                object.insert("call".to_string(), Value::String("toast".to_string()));
                object.insert(
                    "level".to_string(),
                    Value::String(level.as_str().to_string()),
                );
                object.insert("title".to_string(), Value::String(title.clone()));
                if let Some(description) = description {
                    object.insert(
                        "description".to_string(),
                        Value::String(description.clone()),
                    );
                }
                Value::Object(object)
            }
            Self::CloseAppModal => json!({ "call": "closeAppModal" }),
            Self::OpenAppModal { payload } => {
                json!({ "call": "openAppModal", "payload": payload })
            }
            Self::StartLocalGxserver => json!({ "call": "startLocalGxserver" }),
        }
    }
}

/// Everything one command payload does.
///
/// An empty plan is a real answer and is not the same as no plan: it is
/// `handleUnsupportedSidebarMessage`, which the TypeScript documents as a deliberate no-op. No
/// plan at all means this payload is not ported and must go to the old runtime untouched.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SidebarActionPlan {
    pub effects: Vec<ActionEffect>,
}

impl SidebarActionPlan {
    /// The TypeScript's `handleUnsupportedSidebarMessage`: the payload is ported, and doing
    /// nothing is what it does.
    pub fn nothing() -> Self {
        Self::default()
    }

    pub(crate) fn one(effect: ActionEffect) -> Self {
        Self {
            effects: vec![effect],
        }
    }

    pub fn to_json(&self) -> Value {
        Value::Array(self.effects.iter().map(ActionEffect::to_json).collect())
    }
}
