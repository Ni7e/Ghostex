//! The desktop host for `packages/gx-chat-core`: the Rust chat brain's socket, storage and timers.
//!
//! `docs/2026-09-21/rust-chat/PLAN.md` step 4. The core performs no I/O and reads no clock, so this
//! directory is everything around it: one [`ChatCore`](ghostex_gx_chat_core::ChatCore) per retained
//! session, the effects it asks for, the client-storage records it does not own, and the frame
//! envelope `apps/desktop/src/app/native_chat/` already consumes.
//!
//! **The renderer does not change.** `state.rs`'s `apply_output` destructures the exact object
//! `nativeChat.take(lastRevision)` returns, so [`frame::envelope`] builds that same object from
//! [`Frame`](ghostex_gx_chat_core::Frame) and turns the effects the UI thread must perform into the
//! same `requests` entries the QuickJS brain pushes today. Everything else the host performs itself,
//! off the UI thread.
//!
//! Per-concern files:
//!
//! - `identity.rs` names a retained chat and builds its storage session key.
//! - `worker.rs` is the one background thread and the per-view handle; `store.rs` is the retained
//!   map and the retention limits `apps/desktop/sidebar/session-chat-runtime/store.ts` set.
//! - `events.rs` turns the renderer's calls into `Event`s, `effects.rs` performs or forwards each
//!   `Effect`, `frame.rs` builds the drained envelope, `queries.rs` answers the five pure helpers.
//! - `storage.rs` is the chat half of `packages/client-storage/catalog.ts` and the two doors into
//!   the one client-storage database; `host_records.rs` owns the four records the core left to the
//!   host; `boot.rs` answers `Effect::ReadComposerBoot`.
//! - `draft_ops.rs` performs the three draft operations the core names as stores, `outbox.rs` is
//!   the durable save outbox and its retry ladder, `saves.rs` connects that queue to a chat,
//!   `dismissals.rs` folds the recovery markers a retirement leaves into ranges, `locale.rs` the
//!   two formatted stamps the host owes the core.
//! - `diagnostics.rs` writes the periodic counters, behind the usual two gates.

mod boot;
mod diagnostics;
mod dismissals;
mod draft_ops;
mod effects;
mod events;
mod frame;
mod host_records;
mod identity;
mod locale;
mod outbox;
mod queries;
mod saves;
mod storage;
mod store;
mod worker;

pub(crate) use identity::LOCAL_MACHINE_ID;
pub(crate) use worker::{ChatHostHandle, ChatHostOutput};
