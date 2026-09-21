//! The Rust chat core run in SHADOW beside the live QuickJS brain.
//!
//! Step 4 of `docs/2026-09-21/rust-chat/PLAN.md` switches the desktop chat onto
//! `packages/gx-chat-core`. Before that happens the two brains run side by side on the user's own
//! chats and the differences are counted: the live brain does all the work and draws everything,
//! the shadow one is fed the same calls and answers and produces a document nobody looks at.
//!
//! The seam is the recorder's (`packages/shared/session-chat-controller/native-host-replay.ts`):
//! every call reaching `globalThis.nativeChat`, plus the clock, `Math.random()` and
//! `crypto.randomUUID()` reads the brain made during it, arrive here as the same JSONL lines the
//! `native.chat.replay` scenario writes to a file, read in memory instead. The translation into
//! core events is `gx_chat_core::bridge`, shared with `examples/replay.rs` so the shadow and the
//! replay gate can never grade differently.

mod capture;
mod compare;
mod counters;
mod gate;
mod log;
mod runner;

pub(crate) use runner::ShadowHost;
