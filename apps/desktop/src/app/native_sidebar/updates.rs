use super::model::{NativeSidebarGroup, NativeSidebarSession, NativeSidebarSnapshot};
use serde::Deserialize;
use serde_json::{Map, Value};
use std::{collections::HashMap, sync::Arc};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeSidebarPatch {
    pub(crate) version: u32,
    fields: Map<String, Value>,
    hud: Map<String, Value>,
    group_order: Option<Vec<String>>,
    groups: Vec<GroupPatch>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GroupPatch {
    group_id: String,
    fields: Map<String, Value>,
    session_order: Option<Vec<String>>,
    sessions: Vec<SessionPatch>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionPatch {
    session_id: String,
    fields: Map<String, Value>,
}

macro_rules! apply_fields {
    ($target:expr, $fields:expr, { $($wire:literal => $field:ident),* $(,)? }, $unknown:expr) => {
        for (key, value) in $fields {
            match key.as_str() {
                $($wire => $target.$field = if value.is_null() { Default::default() } else { serde_json::from_value(value)? },)*
                _ => ($unknown)(key, value),
            }
        }
    };
}

/// CDXC:Sidebar 2026-09-17 WHY:
/// Apply only changed fields so focus/activity updates retain unchanged session allocations and image data.
/// Validate a complete update before publishing it, and use explicit order arrays for moves and removals.
/// SEE-ALSO: apps/desktop/sidebar/native-sidebar/updates.ts.
impl NativeSidebarPatch {
    pub(crate) fn apply(
        self,
        previous: &NativeSidebarSnapshot,
    ) -> serde_json::Result<NativeSidebarSnapshot> {
        let mut snapshot = previous.clone();
        apply_fields!(snapshot, self.fields, {
            "revision" => revision,
            "scrollScope" => scroll_scope,
            "renameRequest" => rename_request,
            "revealRequest" => reveal_request,
            "ready" => ready,
            "emptyState" => empty_state,
            "hud" => hud,
            "selectedMachineId" => selected_machine_id,
            "machines" => machines,
            "spaces" => spaces,
            "spacesEnabled" => spaces_enabled,
            "collections" => collections,
            "order" => order,
            "moreMenu" => more_menu,
            "searchShortcut" => search_shortcut,
            "commandsShortcut" => commands_shortcut
        }, |_, _| {});
        if let Some(hud) = snapshot.hud.as_object_mut() {
            hud.extend(self.hud);
        }
        for patch in self.groups {
            let index = snapshot
                .groups
                .iter()
                .position(|group| group.group_id == patch.group_id);
            let group = if let Some(index) = index {
                let group = &mut snapshot.groups[index];
                apply_fields!(group, patch.fields, {
                    "collectionColor" => collection_color,
                    "titleTooltip" => title_tooltip,
                    "groupId" => group_id,
                    "storageId" => storage_id,
                    "summary" => summary,
                    "collapsed" => collapsed,
                    "expanded" => expanded,
                    "hiddenSessionCount" => hidden_session_count,
                    "showListToggle" => show_list_toggle,
                    "hoverActionsExpanded" => hover_actions_expanded,
                    "menu" => menu,
                    "headerActions" => header_actions,
                    "sections" => sections,
                    "title" => title,
                    "isActive" => is_active,
                    "isChatCollection" => is_chat_collection,
                    "isStale" => is_stale,
                    "projectContext" => project_context,
                    "remoteMachineContext" => remote_machine_context
                }, |_, _| {});
                group
            } else {
                let mut fields = patch.fields;
                fields.insert("sessions".into(), Value::Array(vec![]));
                snapshot
                    .groups
                    .push(serde_json::from_value::<NativeSidebarGroup>(
                        Value::Object(fields),
                    )?);
                snapshot.groups.last_mut().unwrap()
            };
            for session_patch in patch.sessions {
                if let Some(session) = group
                    .sessions
                    .iter_mut()
                    .find(|session| session.session_id == session_patch.session_id)
                {
                    let session = Arc::make_mut(session);
                    apply_fields!(session, session_patch.fields, {
                        "sessionId" => session_id,
                        "displayTitle" => display_title,
                        "alias" => alias,
                        "activity" => activity,
                        "agentIcon" => agent_icon,
                        "kind" => kind,
                        "sessionKind" => session_kind,
                        "isFocused" => is_focused,
                        "isVisible" => is_visible,
                        "isPinned" => is_pinned,
                        "isParked" => is_parked,
                        "isDraft" => is_draft,
                        "lastInteractionAt" => last_interaction_at,
                        "lifecycleState" => lifecycle_state,
                        "sessionNote" => session_note,
                        "faviconDataUrl" => favicon_data_url,
                        "hasComposerDraft" => has_composer_draft,
                        "queuedPromptCount" => queued_prompt_count
                    }, |key, value| { session.details.insert(key, value); });
                } else {
                    group
                        .sessions
                        .push(Arc::new(serde_json::from_value::<NativeSidebarSession>(
                            Value::Object(session_patch.fields),
                        )?));
                }
            }
            if let Some(order) = patch.session_order {
                let mut sessions: HashMap<_, _> = std::mem::take(&mut group.sessions)
                    .into_iter()
                    .map(|session| (session.session_id.clone(), session))
                    .collect();
                group.sessions = order
                    .into_iter()
                    .map(|id| {
                        sessions
                            .remove(&id)
                            .ok_or_else(|| invalid_order("session", &id))
                    })
                    .collect::<Result<_, _>>()?;
            }
        }
        if let Some(order) = self.group_order {
            let mut groups: HashMap<_, _> = std::mem::take(&mut snapshot.groups)
                .into_iter()
                .map(|group| (group.group_id.clone(), group))
                .collect();
            snapshot.groups = order
                .into_iter()
                .map(|id| {
                    groups
                        .remove(&id)
                        .ok_or_else(|| invalid_order("group", &id))
                })
                .collect::<Result<_, _>>()?;
        }
        Ok(snapshot)
    }
}

fn invalid_order(kind: &str, id: &str) -> serde_json::Error {
    <serde_json::Error as serde::de::Error>::custom(format!(
        "Sidebar patch refers to missing {kind} {id}"
    ))
}
