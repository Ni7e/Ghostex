//! One host for every client-owned document: the stored key, the debounced push, and the echo the
//! guard judges.
//!
//! CDXC:Sessions 2026-09-21 WHY:
//! gx-core gave the three documents one guard; this gives them one HOST. The edges a guard cannot
//! have are the same three every time (a clock, a client-storage key, a socket) and so are the ways
//! they go wrong, all of which cost this port a review round on K4 alone: a read that marks itself
//! done before it succeeds leaves an empty document that then adopts the daemon's copy over the
//! user's; a read on the render thread takes the connection mutex the write paths hold across
//! `BEGIN IMMEDIATE`; a write that loses the lock race and is only counted is a rename that died
//! with the app; a retry ladder that gives up refuses every edit for the rest of the run; and a
//! hand-back marked delivered when the script was QUEUED leaves the page computing its next edit
//! from a stale base. Writing that three times is how one of the three ends up without the fix.
//!
//! What a document still says for itself is the four things in [`ClientDocument`]: its stored key
//! (or that it has none), its push path, the script that hands it back to the sidebar page, and
//! where its host lives on the app.
//!
//! **K4 is not on this host yet, and the list of what keeps it apart is now short enough to say
//! exactly.** Three of the four things that did have moved here (2026-09-21): the hand-OFF is the
//! same shape for all three, the refused-hand-off recovery is `page_holds_newer` plus
//! [`ClientDocument::request_script`], and the ordering between the recovery and the hand-back is
//! `gx_document_settle`. What is left is TWO: the PRUNE, which walks the loaded presentations and
//! has no analogue for a document whose members are not sessions, and three counters
//! (`reconcile_seen`, `reconcile_entered`, `side_state_held`, plus the process-wide
//! `hostMessagesDropped`) that two live rounds were spent adding and that this host does not carry.
//! So K4 CAN move now, and the reason it has not is that **no gate drives any of the three hosts**:
//! the guard, launch and prune gates drive gx-core, and the round-trip gates drive the page code
//! against the message type and the script template, so a host refactor is covered by `cargo check`
//! and by the live counters and by nothing else. Whoever moves it moves the prune in as a hook and
//! the three counters in as fields, and changes nothing else.
//!
//! SEE-ALSO: packages/gx-core/src/doc_sync/, apps/desktop/src/app/gx_store/workspace_groups.rs,
//! apps/desktop/src/app/gx_store/project_docs.rs.

use std::time::Duration;

use ghostex_gx_core::{AdoptOutcome, DocumentSync, SyncEffect, SyncedDocument};
use serde_json::Value;

use super::sidebar_ui_storage;
use crate::GhostexGpuiApp;
use crate::app::helpers::board_gxserver::gxserver_health_and_daemon::gpui_gxserver_rpc_result;

/// The push is a plain write-through, so it gets the same timeout every other sidebar call has.
const PUSH_TIMEOUT: Duration = Duration::from_secs(10);
/// The same push on the quit path, where the app is holding the user's quit while it waits. Long
/// enough for the local daemon to answer, short enough that a daemon that is not there costs a
/// blink.
const QUIT_PUSH_TIMEOUT: Duration = Duration::from_millis(1_500);
/// How long a storage write that lost the lock race waits before it is tried again, and how many
/// times. Nothing is lost while it fails: the owed write stays owed and the quit path flushes it.
const STORAGE_RETRY: Duration = Duration::from_millis(400);
const MAX_STORAGE_RETRIES: u32 = 3;
/// How long a failed read of the stored key waits. A lock race clears in milliseconds and a missing
/// database never will, so the ladder is fast at first and then standing: giving up entirely would
/// refuse every edit of this document for the rest of the run.
const READ_RETRY: Duration = Duration::from_secs(5);
const MAX_READ_RETRIES: u32 = 6;
const READ_RETRY_SLOW: Duration = Duration::from_secs(30);

/// What one document says for itself.
pub(crate) trait ClientDocument: SyncedDocument + 'static {
    /// A short word naming the document in records and warnings.
    const NAME: &'static str;
    /// The client-storage key, or `None` for a document gxserver owns outright (Spaces).
    const STORAGE_KEY: Option<&'static str>;
    /// The gxserver path the push goes to.
    const RPC_PATH: &'static str;

    /// The stored key's payload. Only called when `STORAGE_KEY` is set.
    ///
    /// NOT named `from_storage_json`, which is what the document's own inherent method is called:
    /// a trait method sharing a name with an inherent one resolves to the inherent one at some call
    /// sites and to the trait at others, and the impl that wrote `Self::from_storage_json(value)`
    /// inside `fn from_storage_json` would have been a silent infinite recursion.
    fn parse_storage(value: &Value) -> Self;

    /// The script that hands the held document back to the sidebar page, so the page's own copy is
    /// never the stale base of its next edit.
    fn hand_back_script(&self) -> String;

    /// The script that asks the page to post the document it holds, for a document that can refuse
    /// a hand-off. `None` for one that cannot: a document with no stored key is ready from the
    /// first frame, so there is no window in which the page is the only holder of an edit, and a
    /// request path nothing can reach would be a second way for a document to cross.
    fn request_script() -> Option<String>;

    /// Where this document's host lives on the app.
    fn host(app: &mut GhostexGpuiApp) -> &mut ClientDocumentHost<Self>
    where
        Self: Sized;

    /// Puts the held document into the store, which is what makes the list draw it.
    fn apply_to_store(
        app: &mut GhostexGpuiApp,
        document: &Self,
        cx: &mut gpui::Context<GhostexGpuiApp>,
    ) where
        Self: Sized;

    /// The daemon's copy, read out of the store's side state. Asked again when a deferred echo is
    /// recovered, because nothing consumed the first one: the side state still holds it.
    fn server_state(app: &GhostexGpuiApp) -> Option<Value>;
}

/// What this app run did with one document. Memory only; the record lines are built from it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct ClientDocumentCounters {
    /// Local edits, which is one per move that writes.
    pub(crate) edits: u64,
    /// Documents this run STORED, and keys it REMOVED: one per payload that reached the database,
    /// not one per try.
    pub(crate) storage_writes: u64,
    pub(crate) storage_removes: u64,
    /// Every call into the storage door, including the retries and the quit flush.
    pub(crate) storage_attempts: u64,
    pub(crate) storage_failures: u64,
    /// Documents a storage bound refused. Not retried: the payload does not shrink by trying again.
    pub(crate) storage_refusals: u64,
    pub(crate) pushes: u64,
    pub(crate) push_failures: u64,
    /// Echoes the guard refused because a push was outstanding. This is the counter the guard
    /// exists for: a run with moves and a zero here means the window never opened.
    pub(crate) echoes_refused: u64,
    /// Reconciles where the daemon had sent no document at all.
    pub(crate) echoes_absent: u64,
    /// Echoes that were not a document at all.
    ///
    /// **This is the LOUD half of the wire-parse decision.** Both new documents parse an echo
    /// through the wire types, so one malformed entry takes the whole echo with it where the
    /// TypeScript keeps the other entries. A user whose collections silently stopped updating
    /// would never find that cause, so it is counted here, warned once per run, and carried in
    /// every record.
    pub(crate) echoes_unparsable: u64,
    pub(crate) echoes_adopted: u64,
    pub(crate) echoes_equal: u64,
    pub(crate) echoes_pushed_back: u64,
    /// Times the held document was handed back to the sidebar page.
    pub(crate) hand_backs: u64,
    /// Hand-backs whose script the service refused to evaluate. The page's copy is then the stale
    /// base of its next edit, so the record of what it was told is NOT advanced and the next change
    /// tells it again.
    pub(crate) hand_backs_dropped: u64,
    /// Reads of the stored key that failed. Until one succeeds nothing is adopted and nothing is
    /// edited, so a non-zero value here beside a zero `edits` is this app refusing to guess.
    pub(crate) read_failures: u64,
    /// Times the page was asked to hand its document over again after a refusal. Read beside the
    /// document's own `hand_offs_refused`: a refusal with no request behind it is an edit this app
    /// refused and never went back for.
    pub(crate) hand_offs_requested: u64,
    /// Daemon echoes left unjudged because the read had not landed. Read beside
    /// `deferred_recovered`: equal means every deferral was judged when the read landed.
    pub(crate) echoes_deferred: u64,
    pub(crate) deferred_recovered: u64,
}

/// One document's host state.
pub(crate) struct ClientDocumentHost<D: ClientDocument> {
    pub(crate) sync: DocumentSync<D>,
    pub(crate) counters: ClientDocumentCounters,
    /// Bumped by every booking, so a fired timer of a booking that was replaced does nothing.
    booking: u64,
    /// Whether the stored key is in hand. Always true for a document that has none.
    restored: bool,
    /// A read is on the background executor right now, so nothing books a second one.
    restoring: bool,
    read_retries: u32,
    read_retry_scheduled: bool,
    /// An echo that arrived before the read landed and still owes a judgement, held AS IT ARRIVED.
    ///
    /// The value is carried rather than re-read from the side state when the read lands, because by
    /// then the side state no longer holds it: the restore puts the app's OWN stored document there
    /// (`apply_to_store`), which is the same field `server_state` reads back, so a settle that
    /// re-read it judged this app's document as if it were the daemon's. For the collections
    /// document that spent the first-echo push-back token on a self-echo and left the daemon's copy
    /// unjudged for the whole run.
    deferred_echo: Option<Option<Value>>,
    /// The page holds an edit this app refused and has not handed over again yet, so nothing may be
    /// told to the page until it does: a hand-back would replace that edit.
    page_holds_newer: bool,
    /// The storage write that has not landed yet: `None` is the REMOVE, `Some(raw)` the value, and
    /// the whole field absent is "nothing owed".
    owed_write: Option<Option<String>>,
    write_retries: u32,
    /// The document the page was last told about, so it is told again only when the held document
    /// really moved.
    handed_back: Option<D>,
}

impl<D: ClientDocument> Default for ClientDocumentHost<D> {
    fn default() -> Self {
        Self {
            sync: DocumentSync::default(),
            counters: ClientDocumentCounters::default(),
            booking: 0,
            // A document with no stored key has nothing to read, so it is ready from the start.
            restored: D::STORAGE_KEY.is_none(),
            restoring: false,
            read_retries: 0,
            read_retry_scheduled: false,
            deferred_echo: None,
            page_holds_newer: false,
            owed_write: None,
            write_retries: 0,
            handed_back: None,
        }
    }
}

impl GhostexGpuiApp {
    /// Whether the stored key is in hand, booking the read that puts it there.
    ///
    /// The read runs on the background executor behind one flag, because the caller asks this on
    /// every burst of daemon frames and a synchronous read would take the connection mutex on the
    /// render thread for the life of a run in which it keeps failing. Until it lands nothing may
    /// adopt an echo, take a hand-off or answer a drop: all three would be computed against a
    /// document this app does not have.
    pub(crate) fn gx_document_restored<D: ClientDocument>(
        &mut self,
        cx: &mut gpui::Context<Self>,
    ) -> bool {
        if D::host(self).restored {
            return true;
        }
        let Some(key) = D::STORAGE_KEY else {
            return true;
        };
        let host = D::host(self);
        if host.restoring || host.read_retry_scheduled {
            return false;
        }
        host.restoring = true;
        cx.spawn(async move |this, cx| {
            let stored = cx
                .background_executor()
                .spawn(async move { sidebar_ui_storage::read_preference_value(key) })
                .await;
            let _ = this.update(cx, |this, cx| {
                D::host(this).restoring = false;
                match stored {
                    Ok(stored) => this.gx_document_adopt_stored::<D>(stored, cx),
                    Err(code) => {
                        D::host(this).counters.read_failures += 1;
                        this.gx_store
                            .diagnostics
                            .client_document_read_failed(D::NAME, code);
                        this.gx_document_schedule_read_retry::<D>(cx);
                    }
                }
            });
        })
        .detach();
        false
    }

    /// The stored key, once it has been read. `restored` is set HERE, on the success path only.
    fn gx_document_adopt_stored<D: ClientDocument>(
        &mut self,
        stored: Option<String>,
        cx: &mut gpui::Context<Self>,
    ) {
        D::host(self).restored = true;
        // A key that is absent, or holding something that is not JSON, is the EMPTY document and
        // not a failure: that is a first launch, and every parse answers the same way for a
        // damaged payload.
        if let Some(document) = stored
            .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
            .map(|value| D::parse_storage(&value))
        {
            D::host(self).sync.restore(document.clone());
            D::apply_to_store(self, &document, cx);
        }
        self.gx_document_settle::<D>(cx);
    }

    /// Books another read after a failure. It never gives up, because giving up means this app
    /// never learns the user's document and every edit of it is refused for the rest of the run.
    fn gx_document_schedule_read_retry<D: ClientDocument>(&mut self, cx: &mut gpui::Context<Self>) {
        let host = D::host(self);
        if host.read_retry_scheduled {
            return;
        }
        let exhausted = host.read_retries >= MAX_READ_RETRIES;
        host.read_retries += 1;
        host.read_retry_scheduled = true;
        if exhausted && host.read_retries == MAX_READ_RETRIES + 1 {
            self.gx_store
                .diagnostics
                .client_document_read_unavailable(D::NAME);
        }
        let delay = match exhausted {
            true => READ_RETRY_SLOW,
            false => READ_RETRY,
        };
        cx.spawn(async move |this, cx| {
            cx.background_executor().timer(delay).await;
            let _ = this.update(cx, |this, cx| {
                D::host(this).read_retry_scheduled = false;
                this.gx_document_restored::<D>(cx);
            });
        })
        .detach();
    }

    /// A local edit: write the key, book the push, put the document into the store, tell the page.
    pub(crate) fn gx_document_edit<D: ClientDocument>(
        &mut self,
        document: D,
        cx: &mut gpui::Context<Self>,
    ) {
        D::host(self).counters.edits += 1;
        let effects = D::host(self).sync.edit(document.clone());
        self.gx_document_run_effects::<D>(effects, cx);
        D::apply_to_store(self, &document, cx);
        self.gx_document_hand_back::<D>(cx);
    }

    /// The daemon's copy just landed in the store. Asks the guard what it means and, when the guard
    /// refuses it, puts the held document back.
    ///
    /// A deferral is REMEMBERED: `side_state` reports a change only on the frame that moved the
    /// document, and on a normal launch that is the initial snapshot, so an echo deferred while the
    /// read was in flight would otherwise never be judged at all.
    pub(crate) fn gx_document_reconcile<D: ClientDocument>(
        &mut self,
        server_state: Option<Value>,
        cx: &mut gpui::Context<Self>,
    ) {
        if !self.gx_document_restored::<D>(cx) {
            let host = D::host(self);
            host.counters.echoes_deferred += 1;
            // The echo is kept as it arrived. A later one replaces it, because the reconcile runs
            // again for every frame that moves the document.
            host.deferred_echo = Some(server_state);
            return;
        }
        let (outcome, effects) = D::host(self).sync.adopt(server_state.as_ref());
        let host = D::host(self);
        match outcome {
            AdoptOutcome::NoEcho => host.counters.echoes_absent += 1,
            AdoptOutcome::Unparsable => host.counters.echoes_unparsable += 1,
            AdoptOutcome::Adopted => host.counters.echoes_adopted += 1,
            AdoptOutcome::IgnoredEqual => host.counters.echoes_equal += 1,
            AdoptOutcome::IgnoredPending => host.counters.echoes_refused += 1,
            AdoptOutcome::ScheduledPush => host.counters.echoes_pushed_back += 1,
        }
        if outcome == AdoptOutcome::Unparsable {
            // Warned as well as counted: the whole echo was dropped, so this document has silently
            // stopped following the daemon and nothing else would say so.
            self.gx_store
                .diagnostics
                .client_document_echo_unparsable(D::NAME);
        }
        self.gx_document_run_effects::<D>(effects, cx);
        // Whatever the guard decided, the store must end up holding the document the guard holds:
        // the daemon's value is already in the side state by the time this runs, so a refusal is
        // only a refusal if it is put back. Written only when the two really differ: an
        // unconditional write puts this app's round trip of the daemon's own document back into the
        // side state, and any byte the sanitizer moves makes the next frame report a change and
        // book another reconcile and another list rebuild, for ever.
        let held = D::host(self).sync.document().clone();
        let echoed = server_state.as_ref().and_then(D::parse_echo);
        if echoed.as_ref() != Some(&held) {
            D::apply_to_store(self, &held, cx);
        }
        self.gx_document_hand_back::<D>(cx);
        let counters = D::host(self).counters;
        self.gx_store
            .diagnostics
            .client_document_record(D::NAME, None, counters);
    }

    /// Runs whatever a deferred echo owes, once the read has landed, and then settles with the page.
    ///
    /// This is the deferral's only other chance: `side_state` reports a change on the frame that
    /// moved the document and on no later one, and on a normal launch that frame is the initial
    /// snapshot.
    fn gx_document_settle<D: ClientDocument>(&mut self, cx: &mut gpui::Context<Self>) {
        if let Some(server_state) = D::host(self).deferred_echo.take() {
            D::host(self).counters.deferred_recovered += 1;
            // The echo the reconcile was handed, not whatever the side state holds now: the restore
            // that got us here put this app's own document there a moment ago.
            self.gx_document_reconcile::<D>(server_state, cx);
        }
        // An edit the page made while the read was on its way is only in the page's copy, and
        // handing the stored document back would replace it: the user would watch the rename they
        // just made revert. So the page is asked to hand its own document over again instead, which
        // is one ordinary hand-off and therefore the same path every other edit takes.
        if D::host(self).page_holds_newer {
            self.gx_document_ask_page::<D>(cx);
            return;
        }
        self.gx_document_hand_back::<D>(cx);
    }

    /// Asks the page to post the document it holds. Dropped rather than retried when the page is
    /// not there: it has not edited anything in that state either.
    fn gx_document_ask_page<D: ClientDocument>(&mut self, cx: &mut gpui::Context<Self>) {
        let Some(script) = D::request_script() else {
            return;
        };
        let Some(service) = self.sidebar.clone() else {
            return;
        };
        if service.update(cx, |surface, _| surface.execute_app_owned_script(&script)) {
            D::host(self).counters.hand_offs_requested += 1;
        }
    }

    /// Whether the page is holding an edit this app could not take. Set when a hand-off is refused
    /// and cleared when the page's document finally arrives, so a hand-back in between cannot
    /// replace it.
    pub(crate) fn gx_document_page_holds_newer<D: ClientDocument>(&mut self, holds: bool) {
        D::host(self).page_holds_newer = holds;
    }

    /// Hands the held document to the sidebar page, which no longer reads the daemon's copy itself.
    ///
    /// Told only when the document really moved, and the record of what it was told is updated ONLY
    /// when the script was dispatched, so a page that was not there yet is told on the next change
    /// rather than never.
    pub(crate) fn gx_document_hand_back<D: ClientDocument>(
        &mut self,
        cx: &mut gpui::Context<Self>,
    ) {
        // While the page is the only holder of an edit this app had to refuse, telling it anything
        // would replace that edit. It is asked for its document instead, and told again once it
        // arrives.
        if D::host(self).page_holds_newer {
            return;
        }
        let held = D::host(self).sync.document().clone();
        if D::host(self).handed_back.as_ref() == Some(&held) {
            return;
        }
        let Some(service) = self.sidebar.clone() else {
            return;
        };
        let script = held.hand_back_script();
        // The return value decides whether this counts as told. `evaluate` reports an error and
        // discards the script, so recording it as handed back from the CALL rather than from the
        // answer would leave the page holding a stale base for ever.
        let sent = service.update(cx, |surface, _| surface.execute_app_owned_script(&script));
        let host = D::host(self);
        if !sent {
            host.counters.hand_backs_dropped += 1;
            return;
        }
        host.counters.hand_backs += 1;
        host.handed_back = Some(held);
    }

    fn gx_document_run_effects<D: ClientDocument>(
        &mut self,
        effects: Vec<SyncEffect>,
        cx: &mut gpui::Context<Self>,
    ) {
        for effect in effects {
            match effect {
                SyncEffect::WriteStorage { document, remove } => {
                    self.gx_document_write_storage::<D>(&document, remove, cx);
                }
                SyncEffect::SchedulePush { delay_ms } => {
                    self.gx_document_book_push::<D>(delay_ms, cx);
                }
            }
        }
    }

    /// A write that does not reach storage is OWED again rather than counted and dropped: the
    /// database is WAL, so reads never block, but a second connection's write really does fail
    /// after the busy timeout while the QuickJS service holds a write transaction.
    fn gx_document_write_storage<D: ClientDocument>(
        &mut self,
        document: &Value,
        remove: bool,
        cx: &mut gpui::Context<Self>,
    ) {
        let raw = match remove {
            true => None,
            false => Some(document.to_string()),
        };
        // The newest write replaces whatever was owed: same key, same document lineage.
        let host = D::host(self);
        host.owed_write = Some(raw.clone());
        host.write_retries = 0;
        self.gx_document_run_storage_write::<D>(raw, cx);
    }

    fn gx_document_run_storage_write<D: ClientDocument>(
        &mut self,
        raw: Option<String>,
        cx: &mut gpui::Context<Self>,
    ) {
        let Some(key) = D::STORAGE_KEY else {
            return;
        };
        D::host(self).counters.storage_attempts += 1;
        let attempted = raw.clone();
        let background = cx.background_executor().clone();
        cx.spawn(async move |this, cx| {
            let result = background
                .spawn(async move {
                    sidebar_ui_storage::write_client_document_value(key, raw.as_deref())
                })
                .await;
            let _ = this.update(cx, |this, cx| {
                this.gx_document_note_write::<D>(attempted, result, cx);
            });
        })
        .detach();
    }

    /// What a storage attempt came back with. A refusal is not retried, because the payload does
    /// not shrink by trying again; a failure is, because it is a lock race.
    fn gx_document_note_write<D: ClientDocument>(
        &mut self,
        attempted: Option<String>,
        result: Result<Option<&'static str>, &'static str>,
        cx: &mut gpui::Context<Self>,
    ) {
        let host = D::host(self);
        // An owed write that a newer one replaced is not this attempt's to clear.
        let current = host.owed_write.as_ref() == Some(&attempted);
        match result {
            Ok(refusal) => {
                if current {
                    host.owed_write = None;
                    host.write_retries = 0;
                }
                match (refusal, attempted.is_none()) {
                    // A refusal stored nothing, so it is neither a write nor a remove.
                    (Some(_), _) => {}
                    (None, true) => host.counters.storage_removes += 1,
                    (None, false) => host.counters.storage_writes += 1,
                }
                if let Some(bound) = refusal {
                    host.counters.storage_refusals += 1;
                    self.gx_store
                        .diagnostics
                        .client_document_write_refused(D::NAME, bound);
                }
            }
            Err(code) => {
                host.counters.storage_failures += 1;
                let retry = current && host.write_retries < MAX_STORAGE_RETRIES;
                if current {
                    host.write_retries += 1;
                }
                self.gx_store
                    .diagnostics
                    .client_document_write_failed(D::NAME, code);
                if retry {
                    self.gx_document_book_storage_retry::<D>(attempted, cx);
                }
            }
        }
    }

    fn gx_document_book_storage_retry<D: ClientDocument>(
        &mut self,
        raw: Option<String>,
        cx: &mut gpui::Context<Self>,
    ) {
        cx.spawn(async move |this, cx| {
            cx.background_executor().timer(STORAGE_RETRY).await;
            let _ = this.update(cx, |this, cx| {
                // Only if nothing newer is owed, which would already be on its way.
                if D::host(this).owed_write.as_ref() == Some(&raw) {
                    this.gx_document_run_storage_write::<D>(raw, cx);
                }
            });
        })
        .detach();
    }

    /// Stores whatever the document still owes, synchronously, on the quit path. Without it an edit
    /// made in the last four hundred milliseconds, or one whose write lost a lock race, dies with
    /// the app: the push has not gone out either.
    pub(crate) fn gx_document_flush_write<D: ClientDocument>(&mut self) {
        let Some(key) = D::STORAGE_KEY else {
            return;
        };
        let Some(raw) = D::host(self).owed_write.take() else {
            return;
        };
        D::host(self).counters.storage_attempts += 1;
        let result = sidebar_ui_storage::write_client_document_value(key, raw.as_deref());
        let host = D::host(self);
        match result {
            Ok(refusal) => {
                match (refusal, raw.is_none()) {
                    (Some(_), _) => {}
                    (None, true) => host.counters.storage_removes += 1,
                    (None, false) => host.counters.storage_writes += 1,
                }
                if let Some(bound) = refusal {
                    host.counters.storage_refusals += 1;
                    self.gx_store
                        .diagnostics
                        .client_document_write_refused(D::NAME, bound);
                }
            }
            Err(code) => {
                host.counters.storage_failures += 1;
                self.gx_store
                    .diagnostics
                    .client_document_write_failed(D::NAME, code);
            }
        }
    }

    /// Sends what the daemon has not got yet, synchronously and bounded, on the quit path.
    ///
    /// CDXC:Spaces 2026-09-21 WHY:
    /// The Spaces document has no stored key at all, so between the gesture and the daemon's
    /// acknowledgement a 400 ms debounce and one RPC are the only things carrying it, and a quit in
    /// that window took the edit with it: there was nothing on disk behind it and nothing to flush.
    /// The collections document has the key but the same hole one step further on, because a launch
    /// adopts a daemon copy that is older than the stored one. So the PUSH is flushed here, with its
    /// own short timeout rather than the ten seconds a background push gets: a quit may wait for the
    /// local daemon, not for a network that is down. A failure is counted and dropped, and the retry
    /// the guard asks for is not booked, because the timer would never fire.
    pub(crate) fn gx_document_flush_push<D: ClientDocument>(&mut self) {
        if !D::host(self).sync.is_pending() {
            return;
        }
        let (document, revision) = D::host(self).sync.push_started();
        D::host(self).counters.pushes += 1;
        let params = serde_json::json!({ "state": document });
        let ok = gpui_gxserver_rpc_result(D::RPC_PATH, &params, QUIT_PUSH_TIMEOUT).is_ok();
        let host = D::host(self);
        if !ok {
            host.counters.push_failures += 1;
        }
        let _ = host.sync.push_finished(revision, ok);
    }

    /// Books the push, replacing whatever booking was outstanding. A drag that moves a row five
    /// times therefore pushes once, after the last move.
    fn gx_document_book_push<D: ClientDocument>(
        &mut self,
        delay_ms: u64,
        cx: &mut gpui::Context<Self>,
    ) {
        D::host(self).booking += 1;
        let booking = D::host(self).booking;
        let background = cx.background_executor().clone();
        cx.spawn(async move |this, cx| {
            background.timer(Duration::from_millis(delay_ms)).await;
            let _ = this.update(cx, |this, cx| {
                // A booking that was replaced fires nothing: `clearTimeout` is what the TypeScript
                // does, and a timer that cannot be cancelled has to check instead.
                if D::host(this).booking == booking {
                    this.gx_document_push::<D>(cx);
                }
            });
        })
        .detach();
    }

    fn gx_document_push<D: ClientDocument>(&mut self, cx: &mut gpui::Context<Self>) {
        let (document, revision) = D::host(self).sync.push_started();
        D::host(self).counters.pushes += 1;
        let params = serde_json::json!({ "state": document });
        let background = cx.background_executor().clone();
        cx.spawn(async move |this, cx| {
            let result = background
                .spawn(async move { gpui_gxserver_rpc_result(D::RPC_PATH, &params, PUSH_TIMEOUT) })
                .await;
            let _ = this.update(cx, |this, cx| {
                let ok = result.is_ok();
                if !ok {
                    D::host(this).counters.push_failures += 1;
                }
                let effects = D::host(this).sync.push_finished(revision, ok);
                this.gx_document_run_effects::<D>(effects, cx);
                let counters = D::host(this).counters;
                this.gx_store
                    .diagnostics
                    .client_document_record(D::NAME, Some(ok), counters);
            });
        })
        .detach();
    }
}
