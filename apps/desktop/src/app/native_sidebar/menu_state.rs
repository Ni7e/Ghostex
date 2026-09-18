use gpui::{Bounds, FocusHandle, Pixels, Point};
use serde_json::Value;

#[derive(Clone)]
pub(crate) struct SidebarMenuPanel {
    pub(crate) items: Vec<Value>,
    pub(crate) scroll: gpui::ScrollHandle,
    pub(crate) anchor: Point<Pixels>,
    pub(crate) selected: Option<usize>,
    pub(crate) pages: Vec<Vec<Value>>,
}

pub(crate) struct SidebarMenuState {
    pub(crate) window: gpui::AnyWindowHandle,
    pub(crate) account_panel: Option<(String, usize)>,
    pub(crate) panels: Vec<SidebarMenuPanel>,
    pub(crate) focus: FocusHandle,
    pub(crate) previous_focus: Option<FocusHandle>,
    pub(crate) scale: f32,
}

impl SidebarMenuPanel {
    pub(crate) fn bounds(
        &self,
        sidebar: Bounds<Pixels>,
        scale: f32,
        nested: bool,
    ) -> Bounds<Pixels> {
        let margin = gpui::px(12.0 * scale);
        let launcher = self
            .items
            .iter()
            .any(|item| item.get("secondary").is_some() || item.get("detail").is_some());
        let width = gpui::px(
            if launcher {
                260.0
            } else if nested {
                204.0
            } else {
                178.0
            } * scale,
        )
        .min((sidebar.size.width - margin * 2.0).max(gpui::px(0.0)));
        let height = gpui::px(
            (14.0
                + self
                    .items
                    .iter()
                    .map(|item| {
                        if item["separator"] == true {
                            13.0
                        } else if item["heading"] == true {
                            24.0
                        } else {
                            34.0
                        }
                    })
                    .sum::<f32>())
                * scale,
        )
        .min((sidebar.size.height - margin * 2.0).max(gpui::px(0.0)));
        Bounds {
            origin: Point::new(
                sidebar.left() + (sidebar.size.width - width) / 2.0,
                self.anchor
                    .y
                    .min(sidebar.bottom() - height - margin)
                    .max(sidebar.top() + margin),
            ),
            size: gpui::size(width, height),
        }
    }

    pub(crate) fn move_selection(&mut self, key: &str) {
        let enabled: Vec<_> = self
            .items
            .iter()
            .enumerate()
            .filter(|(_, item)| {
                item["separator"] != true && item["heading"] != true && item["disabled"] != true
            })
            .map(|(index, _)| index)
            .collect();
        if enabled.is_empty() {
            return;
        }
        let current = self
            .selected
            .and_then(|selected| enabled.iter().position(|index| *index == selected));
        let index = match key {
            "home" => 0,
            "end" => enabled.len() - 1,
            "up" => current
                .map(|index| (index + enabled.len() - 1) % enabled.len())
                .unwrap_or(enabled.len() - 1),
            _ => current
                .map(|index| (index + 1) % enabled.len())
                .unwrap_or(0),
        };
        self.selected = Some(enabled[index]);
        self.scroll.scroll_to_item(enabled[index]);
    }
}

impl SidebarMenuState {
    pub(crate) fn refresh(&mut self, snapshot: &super::model::NativeSidebarSnapshot) {
        fn collect(value: &Value, items: &mut std::collections::HashMap<String, Value>) {
            match value {
                Value::Array(values) => {
                    for value in values {
                        collect(value, items);
                    }
                }
                Value::Object(object) => {
                    if let Some(command) = object.get("command") {
                        items.insert(command.to_string(), value.clone());
                    }
                    if let Some(children) = object.get("children") {
                        collect(children, items);
                    }
                }
                _ => {}
            }
        }
        let mut current = std::collections::HashMap::new();
        collect(&snapshot.more_menu, &mut current);
        for group in &snapshot.groups {
            collect(&group.menu, &mut current);
        }
        for collection in &snapshot.collections {
            collect(&collection.menu, &mut current);
        }
        for panel in &mut self.panels {
            for item in panel
                .items
                .iter_mut()
                .chain(panel.pages.iter_mut().flatten())
            {
                if let Some(updated) = item
                    .get("command")
                    .and_then(|command| current.get(&command.to_string()))
                {
                    for key in ["label", "checked", "disabled"] {
                        if let Some(value) = updated.get(key) {
                            item[key] = value.clone();
                        }
                    }
                }
            }
        }
    }
}
