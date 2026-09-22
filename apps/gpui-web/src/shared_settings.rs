//! The shared sidebar settings as the drawing code reads them. The desktop's module owns the settings FILE (watching, migrating, writing); the browser only holds the object gxserver hands it, behind the same two names the shared files call.
mod appearance;
pub use appearance::*;

use std::cell::RefCell;
use std::sync::Arc;

use serde_json::{Map, Value};

#[derive(Clone, Debug, Default)]
pub struct SharedSidebarSettingsSnapshot {
    revision: u64,
    object: Arc<Map<String, Value>>,
}

impl SharedSidebarSettingsSnapshot {
    pub fn revision(&self) -> u64 {
        self.revision
    }

    pub fn content_hash(&self) -> u64 {
        self.revision
    }

    pub fn object(&self) -> &Map<String, Value> {
        &self.object
    }

    pub fn debugging_mode(&self) -> bool {
        self.object.get("debuggingMode").and_then(Value::as_bool) == Some(true)
    }
}

thread_local! {
    static CURRENT: RefCell<SharedSidebarSettingsSnapshot> = RefCell::default();
}

pub fn shared_sidebar_settings_snapshot() -> SharedSidebarSettingsSnapshot {
    CURRENT.with(|current| current.borrow().clone())
}

/// Installs the settings object read from gxserver.
pub fn install(object: Map<String, Value>) {
    CURRENT.with(|current| {
        let mut current = current.borrow_mut();
        current.revision += 1;
        current.object = Arc::new(object);
    });
}
