//! The periodic line of the runtime facts channel and of the command route that replaced the
//! sidebar page, in a sibling because `diagnostics.rs` is over the size ceiling and waiting for a
//! quiet window.
//!
//! CDXC:Sidebar 2026-09-21 WHY:
//! The line rides the same periodic path as `gxStore.sidebarShadow.summary`, for the reason that
//! cost two live rounds before it: a record emitted only when something differs has no line at all
//! in a run where nothing did, and the zeros are exactly what says the channel is alive and
//! agreeing. The first line of a run goes out with every counter at zero on purpose. Nothing here
//! carries an id, a title or a path: the channel's payload never reaches the log, only its counts.
//!
//! SEE-ALSO: apps/desktop/src/app/gx_store/runtime_facts.rs,
//! apps/desktop/src/app/gx_store/sidebar_runtime_route.rs.

use std::time::Instant;

use serde_json::json;

use super::diagnostics::{GxStoreDiagnostics, log_text, record, routine_logging_enabled};
use super::runtime_facts::RuntimeFactsCounters;
use super::sidebar_runtime_route::SidebarRuntimeRouteCounters;

/// How many differences a run spells out before it goes back to counting them. Twenty is enough to
/// see that one family repeats and whether the kind is always the same, and small enough that a run
/// where the channel is badly wrong does not fill the log.
const MAX_DIFFERENCE_DETAILS: u32 = 20;

/// CDXC:Sidebar 2026-09-21 WHY:
/// The counters alone said "per-project diff stats disagree about three times per comparison" and
/// nothing else, which cost a live round: a count cannot say whether an entry was missing on one
/// side or held a different number, and those two have opposite fixes. Each difference is named
/// once here by its family, by which side lacked it, and by the field that moved, all of them fixed
/// words chosen in this file. No id, title or path is ever passed in, so the payload of the channel
/// still never reaches the log.
pub(super) fn runtime_facts_difference(
    emitted: &mut u32,
    family: &'static str,
    kind: &'static str,
    field: Option<&'static str>,
) {
    if !routine_logging_enabled() || *emitted >= MAX_DIFFERENCE_DETAILS {
        return;
    }
    *emitted += 1;
    record(
        "gxStore.runtimeFacts.difference",
        json!({
            "family": family,
            // `missingInChannel`: the publish carries the entry and the channel does not.
            // `valueDiffers`: both carry it and `field` names the first one that moved.
            // The channel-only direction is counted only, in `projectDiffStatsChannelOnly`.
            "kind": kind,
            "field": log_text(field.unwrap_or("none")),
        }),
    );
}

impl GxStoreDiagnostics {
    /// The channel's totals and the differences against the publish, at most once a minute and
    /// only when they moved.
    pub(super) fn runtime_facts_summary(
        &mut self,
        counters: RuntimeFactsCounters,
        route: SidebarRuntimeRouteCounters,
    ) {
        if self.runtime_facts_summary_written == Some((counters, route))
            || self
                .runtime_facts_summary_at
                .is_some_and(|at| at.elapsed() < super::diagnostics::SHADOW_SUMMARY_INTERVAL)
        {
            return;
        }
        self.runtime_facts_summary_at = Some(Instant::now());
        if !routine_logging_enabled() {
            return;
        }
        self.runtime_facts_summary_written = Some((counters, route));
        record(
            "gxStore.runtimeFacts.summary",
            json!({
                "hudPosts": counters.hud_posts,
                "rowPosts": counters.row_posts,
                "revealPosts": counters.reveal_posts,
                "unparsable": counters.unparsable,
                "comparisons": counters.comparisons,
                "beforeFirstPost": counters.before_first_post,
                // The gate of this step: every one of these stays at zero while the channel
                // carries what the publish carries.
                "hudChannelDifferences": {
                    "hud": counters.hud_differences,
                    "projectDiffStats": counters.project_diff_stats_differences,
                    "closeAfterDone": counters.close_after_done_differences,
                    "delayedSend": counters.delayed_send_differences,
                    "reveal": counters.reveal_differences,
                },
                // Not a difference: the daemon's own delayed sends ride the presentation and this
                // app's timers never hold them.
                "delayedSendPublishOnly": counters.delayed_send_publish_only,
                // The other direction of the diff-stats check: a project the channel offers and no
                // published group asks about. Harmless for the step 3 reader, which looks entries
                // up per drawn row, and the only thing that would show the channel over-posting.
                "projectDiffStatsChannelOnly": counters.project_diff_stats_channel_only,
                // The other half of "no page in the route": what the sidebar dispatch's
                // fall-through did with a command the store did not perform itself.
                "runtimeRoute": {
                    "routed": route.routed,
                    "uiOnly": route.ui_only,
                    // Above zero means a command has no owner on either side any more.
                    "unroutable": route.unroutable,
                    // Dropped at the door because the list was not ready yet (the launch window).
                    "beforeReady": route.before_ready,
                },
            }),
        );
    }

    /// A command that arrived before the list was ready. The TYPE only, which is a fixed word from
    /// the renderer's own closed set, never the payload.
    pub(super) fn sidebar_command_before_ready(&mut self, kind: Option<&str>) {
        if !routine_logging_enabled() {
            return;
        }
        record(
            "gxStore.sidebarCommandBeforeReady",
            json!({ "type": log_text(kind.unwrap_or("none")) }),
        );
    }

    /// A command that reached the end of the dispatch in a shape the runtime has no arm for. The
    /// TYPE only, which is a fixed word from the renderer's own closed set, never the payload.
    pub(super) fn sidebar_command_unroutable(&mut self, kind: Option<&str>) {
        if self.unroutable_command_warnings >= 8 {
            return;
        }
        self.unroutable_command_warnings += 1;
        record(
            "gxStore.sidebarCommandUnroutable",
            json!({ "type": log_text(kind.unwrap_or("none")) }),
        );
    }
}
