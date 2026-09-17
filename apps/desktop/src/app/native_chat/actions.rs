use super::{state::NativeChatView, transcript::text};
use crate::app::context_menu::GpuiContextMenu;
use gpui::{Context, Window};
use serde_json::{Value, json};

#[derive(Clone, Debug, PartialEq, gpui::Action)]
#[action(namespace = ghostex_gpui, no_json)]
pub(crate) struct NativeChatAction {
    pub(crate) command: Value,
}

impl NativeChatView {
    pub(crate) fn show_send_actions(
        &self,
        position: gpui::Point<gpui::Pixels>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let enabled = self.composer_ready && !self.pending_send && !self.draft.trim().is_empty();
        let can_queue = enabled && self.snapshot["queue"]["capabilities"]["canQueue"] == true;
        if let Some(app) = self.config.app.upgrade() {
            GpuiContextMenu::new()
                .menu_with_disabled(
                    "Compact & Send",
                    !can_queue,
                    Box::new(NativeChatAction {
                        command: json!({"type":"submit","mode":"compact"}),
                    }),
                )
                .show_for_app(app, position, window, cx);
        }
    }
    pub(crate) fn show_actions(
        &mut self,
        position: gpui::Point<gpui::Pixels>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let appearance = super::appearance::ChatAppearance::current(&self.snapshot);
        let mut rows = Vec::new();
        if self.snapshot["composerOverflow"]["optionsOverflowed"] == true {
            rows.push(json!({"heading":true,"label":"Model settings"}));
            if self.snapshot["optionLabels"]["showOptions"] == true {
                rows.push(json!({
                "label": self.snapshot["optionLabels"]["optionsTitle"].as_str().unwrap_or("Options"),
                "detail":self.snapshot["optionLabels"]["options"],
                "disabled":self.snapshot["optionLabels"]["options"].as_str().is_none_or(str::is_empty),
                "openOnHover":false,
                "children":self.snapshot["optionMenus"]["options"],
            }));
            }
            if self.snapshot["contextMeter"].is_object() {
                rows.push(json!({"label":"Context window","detail":self.snapshot["contextMeter"]["percentage"],"openOnHover":false,"children":self.context_menu_rows()}));
            }
            rows.push(json!({"separator":true}));
        }
        rows.push(json!({"heading":true,"label":"Chat"}));
        rows.push(json!({"label":"Verbose mode","checked":appearance.verbose,"command":{"type":"setVerbose","enabled":!appearance.verbose}}));
        rows.push(json!({"label":"Simple mode","checked":appearance.simple,"command":{"type":"host","action":"setSimpleMode","enabled":!appearance.simple}}));
        if self.composer_control_overflowed("summary") {
            rows.push(json!({"label":"Summary mode","checked":self.snapshot["summaryMode"]==true,"command":{"type":"toggleSummary"}}));
        }
        let host_row = |action: &Value| {
            json!({
                "label":action["label"],"hotkeyAction":action["hotkey"],
                "command":{"type":"host","action":action["id"]},
            })
        };
        let actions: Vec<_> = self.snapshot["hostActions"]
            .as_array()
            .into_iter()
            .flatten()
            .collect();
        for action in actions.iter().filter(|action| {
            matches!(
                text(action, "id").as_str(),
                "delayedActions" | "closeAfterDone" | "splitSessionRight"
            )
        }) {
            rows.push(host_row(action));
        }
        for (id, action, label, _) in super::toolbar::COMPOSER_CONTROLS {
            if id != "summary" && self.composer_control_overflowed(id) {
                let label = if id == "maximize" && self.maximized_window.is_some() {
                    "Exit maximize"
                } else {
                    label
                };
                let mut row =
                    json!({"label":label,"command":{"type":"composerHost","action":action}});
                if id == "note" {
                    row["checked"] = self.snapshot["note"]["open"].clone();
                }
                rows.push(row);
            }
        }
        let agent_actions: Vec<_> = actions
            .iter()
            .filter(|action| action["group"] == "agent")
            .collect();
        if !agent_actions.is_empty() {
            rows.push(json!({"separator":true}));
            rows.push(json!({"heading":true,"label":"Agent"}));
            for action in agent_actions {
                if action["id"] == "switchAccount" {
                    let accounts: Vec<_> = self.snapshot["switchableAgents"].as_array().into_iter().flatten().map(|account| json!({
                        "label":account["name"],"icon":account["icon"],
                        "command":{"type":"host","action":"switchAccount","agentId":account["agentId"]},
                    })).collect();
                    if !accounts.is_empty() {
                        rows.push(json!({"label":"Switch Account","children":accounts}));
                    }
                } else {
                    rows.push(host_row(action));
                }
            }
        }
        let other: Vec<_> = actions
            .iter()
            .filter(|action| {
                action["group"] != "agent"
                    && !matches!(
                        text(action, "id").as_str(),
                        "delayedActions" | "closeAfterDone" | "splitSessionRight"
                    )
            })
            .collect();
        if !other.is_empty() {
            rows.push(json!({"separator":true}));
            rows.extend(other.into_iter().map(|action| host_row(action)));
        }
        self.show_chat_menu(
            rows,
            gpui::Bounds::new(position, gpui::size(gpui::px(0.0), gpui::px(0.0))),
            240.0,
            window,
            cx,
        );
    }

    pub(crate) fn handle_action(
        &mut self,
        action: &NativeChatAction,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if action.command["type"] == "submit" {
            self.submit(
                action.command["mode"].as_str().unwrap_or("send"),
                window,
                cx,
            );
        } else if action.command["type"] == "composerHost" {
            self.perform_composer_action(
                action.command["action"].as_str().unwrap_or_default(),
                window.mouse_position(),
                window,
                cx,
            );
        } else if action.command["type"] == "host" {
            self.host(
                action.command["action"].as_str().unwrap_or_default(),
                action.command.clone(),
                cx,
            );
        } else {
            self.invoke(action.command.clone(), cx);
        }
    }
}
