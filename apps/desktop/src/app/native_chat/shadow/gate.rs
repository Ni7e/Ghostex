//! Whether a chat runs a shadow core at all.

use crate::{shared_settings, support_logs};

/// True while both "Show debug UI controls" and the `native.chat.shadow` scenario are on and
/// unexpired. Read once, when a chat's runtime thread boots.
///
/// CDXC:SessionChat 2026-09-22 WHY:
/// A shadow chat is a second brain per open chat: its own `ChatCore`, its own in-memory client
/// storage, its own thread, and the replay hooks installed inside QuickJS, which route the live
/// brain's clock, `Math.random` and `crypto.randomUUID` through a driver. None of that may cost a
/// user anything, so it is gated exactly like the recorder beside it
/// (`super::super::replay_recording`): with the scenario off nothing is constructed, no thread is
/// spawned, and the shipped functions inside the runtime are untouched.
pub(crate) fn shadow_enabled() -> bool {
    shared_settings::shared_sidebar_settings_snapshot().debugging_mode()
        && support_logs::scenario_enabled(support_logs::GpuiDiagnosticScenario::ChatShadow)
}
