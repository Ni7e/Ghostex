use super::drag::SidebarDropTarget;
use super::{appearance::SidebarAppearance, model::NativeSidebarGroup};
use crate::GhostexGpuiApp;
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, InteractiveElement, IntoElement, ParentElement, StatefulInteractiveElement, Styled,
    div, px,
};
use gpui_component::v_flex;
use serde_json::{Value, json};

impl GhostexGpuiApp {
    pub(crate) fn render_native_sidebar_group(
        &self,
        group: &NativeSidebarGroup,
        hud: &Value,
        appearance: &SidebarAppearance,
        cx: &mut gpui::Context<Self>,
    ) -> AnyElement {
        let view = cx.entity().clone();
        let group_id = group.group_id.clone();
        let key = format!("group:{}", group.group_id);
        let scale = appearance.scale;
        let body = self
            .native_sidebar
            .disclosures
            .present(&key, group.collapsed)
            .then(|| {
                let content = v_flex()
                    .w_full()
                    .pb(px(3.0 * scale))
                    .when(
                        group.sessions.is_empty() && group.project_context.is_some(),
                        |column| {
                            let id = group.group_id.clone();
                            column.child(
                                div()
                                    .id(format!("native-empty-project-{id}"))
                                    .h(px(34.0 * scale))
                                    .mx(px(3.0 * scale))
                                    .pl(px(26.0 * scale))
                                    .flex()
                                    .items_center()
                                    .rounded(px(5.0 * scale))
                                    .hover(|row| row.bg(appearance.hover))
                                    .relative()
                                    .child("New Session")
                                    .sidebar_drop_target("session-group", id.clone(), None, cx)
                                    .on_click(cx.listener(move |app, _, _, cx| {
                                        cx.stop_propagation();
                                        app.dispatch_native_sidebar_command(
                                            json!({"type": "createProjectTerminal", "groupId": id}),
                                            cx,
                                        );
                                    })),
                            )
                        },
                    )
                    .children(group.sections.iter().enumerate().map(|(index, section)| {
                        let key = format!("section:{}:{}", group.group_id, section.id);
                        let ids = self.native_sidebar.disclosures.section_ids(
                            &key,
                            &section.session_ids,
                            section.collapsed,
                        );
                        let body = self
                            .native_sidebar
                            .disclosures
                            .present(&key, section.collapsed)
                            .then(|| {
                                let sessions = group
                                    .sessions
                                    .iter()
                                    .map(|session| (session.session_id.as_str(), session))
                                    .collect::<std::collections::HashMap<_, _>>();
                                let rows = self.render_native_session_list(
                                    group,
                                    ids.iter()
                                        .filter_map(|id| {
                                            sessions
                                                .get(id.as_str())
                                                .map(|session| (*session).clone())
                                        })
                                        .collect(),
                                    appearance,
                                    cx,
                                );
                                self.render_native_disclosure(key, rows, cx)
                            });
                        v_flex()
                            .w_full()
                            .flex_shrink_0()
                            .when(index > 0 && group.sections[index - 1].collapsed, |column| {
                                column.mt(px(8.0 * scale))
                            })
                            .child(
                                self.render_native_section_header(group, section, appearance, cx),
                            )
                            .children(body)
                    }))
                    .when(
                        group.hidden_session_count > 0 && !group.expanded,
                        |column| {
                            let storage_id = group.storage_id.clone();
                            column.child(
                                div()
                                    .id(format!("native-sidebar-list-toggle-{}", group.group_id))
                                    .mx(px(3.0 * scale))
                                    .h(px(34.0 * scale))
                                    .pl(px(26.0 * scale))
                                    .flex()
                                    .items_center()
                                    .rounded(px(5.0 * scale))
                                    .hover(|row| row.bg(appearance.session_hover))
                                    .child(format!(
                                        "Show all ({})",
                                        group
                                            .sections
                                            .iter()
                                            .filter(|section| !section.collapsed)
                                            .map(|section| section.count)
                                            .sum::<usize>()
                                    ))
                                    .on_click(cx.listener(move |app, _, _, cx| {
                                        cx.stop_propagation();
                                        app.dispatch_native_sidebar_ui(
                                            json!({"type": "toggleList", "groupId": storage_id}),
                                            cx,
                                        );
                                    })),
                            )
                        },
                    );
                self.render_native_disclosure(key, content.into_any_element(), cx)
            });
        v_flex()
            .when(
                self.native_sidebar.is_dragging("group", &group.group_id),
                |row| row.opacity(0.18),
            )
            .on_children_prepainted(move |bounds, _, cx| {
                if let (Some(first), Some(last)) = (bounds.first(), bounds.last()) {
                    let bounds = gpui::Bounds {
                        origin: first.origin,
                        size: gpui::size(first.size.width, last.bottom() - first.top()),
                    };
                    view.update(cx, |app, cx| {
                        app.record_native_project_bounds(&group_id, bounds, cx)
                    });
                }
            })
            .w_full()
            .flex_shrink_0()
            .child(self.render_native_project_header(group, hud, appearance, cx))
            .children(body)
            .into_any_element()
    }
}
