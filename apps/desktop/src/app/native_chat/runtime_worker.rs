//! The chat view's runtime on the desktop: the Rust chat host in `src/app/gx_chat/`.
//!
//! `state.rs` is compiled by `apps/gpui-web` too, whose own `runtime_worker.rs` still runs the
//! TypeScript chat bundle in an iframe behind these two names and the same five methods, so the
//! view keeps them instead of naming the desktop host directly.

/// CDXC:SessionChat 2026-09-25 DECISION:
/// User: "can we please disable quick js and delete it". The desktop chat always runs on `packages/gx-chat-core` through `src/app/gx_chat/`: the `chatBrain` setting, the QuickJS chat runtime, the shadow comparison and the QuickJS chat recorder are deleted, and an old saved `chatBrain` value is ignored. Supersedes the 2026-09-24 decision that made Rust the default and kept QuickJS selectable. QuickJS itself stays in the app for the app runtime (`apps/desktop/sidebar/gxserver-runtime/`) until that is ported.
pub(crate) use crate::app::gx_chat::{
    ChatHostHandle as ChatRuntimeWorker, ChatHostOutput as ChatRuntimeOutput,
};
