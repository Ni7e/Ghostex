//! The three app-wide Ghostex pages the view panel can show: Ask Ghostex, Tips & Tricks and
//! Resources. Each is drawn by GPUI, so none of them loads a page, takes a CEF surface, or counts
//! against the view panel's awake cap.

use gpui::AnyElement;
use gpui::Entity;
use gpui::FontWeight;
use gpui::InteractiveElement as _;
use gpui::IntoElement;
use gpui::MouseButton;
use gpui::MouseDownEvent;
use gpui::ParentElement as _;
use gpui::Styled as _;
use gpui::div;
use gpui::prelude::FluentBuilder as _;
use gpui::px;
use gpui_component::h_flex;
use gpui_component::v_flex;

use crate::app::consts::*;
use crate::app::helpers::*;
use crate::app::model::*;
use crate::app::titlebar::help_menu::GPUI_TITLEBAR_HELP_ASK_ANYTHING_ICON;
use crate::app::titlebar::help_menu::GPUI_TITLEBAR_HELP_ASK_ANYTHING_INDEX;
use crate::app::titlebar::help_menu::GPUI_TITLEBAR_HELP_ASK_ANYTHING_LABEL;
use crate::app::titlebar::help_menu::GPUI_TITLEBAR_HELP_ASK_ANYTHING_SUMMARY;
use crate::app::titlebar::help_menu::GPUI_TITLEBAR_HELP_QUESTIONS;
use crate::app::window::*;
use crate::*;

impl GhostexGpuiApp {
    /// CDXC:Titlebar 2026-09-20 DECISION:
    /// User (screen 07): Tips & Tricks and Resources are pages you can read, search and keep open
    /// instead of dropdowns that close when you click away. The page is the same panel the dropdown
    /// drew, hosted in the view panel rather than in a child window, so the two can never drift.
    pub(crate) fn build_ghostex_page_panel(
        &self,
        page: GhostexPage,
        cx: &mut gpui::Context<Self>,
    ) -> Option<Entity<GpuiTitlebarReadingPanel>> {
        let main_app = cx.weak_entity();
        match page {
            // Ask Ghostex is drawn from the question list itself, so it owns no panel state.
            GhostexPage::Ask => None,
            GhostexPage::Resources => {
                let snapshot = self.gpui_native_resources_snapshot(cx);
                Some(cx.new(|_| {
                    GpuiTitlebarReadingPanel::resources(
                        GpuiTitlebarPanelHost::ViewPanel,
                        main_app,
                        snapshot,
                    )
                }))
            }
            GhostexPage::Tips => {
                let live_agent_ids = self
                    .agents_workspace
                    .terminal_sessions
                    .iter()
                    .filter(|session| session.presentation_state.is_running())
                    .filter_map(|session| session.agent_icon)
                    .filter_map(gpui_default_sidebar_agent_by_icon)
                    .map(|agent| agent.agent_id.to_string())
                    .collect();
                Some(cx.new(|_| {
                    GpuiTitlebarReadingPanel::tips(
                        GpuiTitlebarPanelHost::ViewPanel,
                        main_app,
                        self.titlebar_tips_cli_status.clone(),
                        self.titlebar_tips_agent_hook_status.clone(),
                        live_agent_ids,
                        self.titlebar_tips_sidebar_agent_ids.clone(),
                    )
                }))
            }
        }
    }

    pub(crate) fn render_ghostex_page(
        &mut self,
        page: GhostexPage,
        cx: &mut gpui::Context<Self>,
    ) -> AnyElement {
        if page == GhostexPage::Ask {
            return self.render_ask_ghostex_page(cx);
        }
        let Some(panel) = self.ghostex_page_panels.get(&page).cloned() else {
            // A tab restored from the previous run reaches render before any mode change has built
            // its page. Build it after this frame rather than during it, so a Resources snapshot is
            // never sampled inside a layout pass.
            let app = cx.entity().downgrade();
            cx.defer(move |cx| {
                let _ = app.update(cx, |app, cx| {
                    app.ensure_ghostex_page_panel(TitlebarMode::Ghostex(page), cx);
                    cx.notify();
                });
            });
            return div()
                .size_full()
                .bg(titlebar_popup_menu_background())
                .into_any_element();
        };
        div()
            .id(format!("ghostex-gpui-ghostex-page-{}", page.slug()))
            .size_full()
            .min_w_0()
            .min_h_0()
            .overflow_hidden()
            .child(panel)
            .into_any_element()
    }

    /// CDXC:Onboarding 2026-09-20 DECISION:
    /// User (screen 07): the Help dropdown's seven sample questions become starter chips in a real
    /// Ask Ghostex view, so it can stay open beside the session you are asking about. Picking one
    /// still only stages the question as an editable draft, which is the 2026-09-09 rule that a Help
    /// row never sends; only the dropdown it used to live in is gone.
    fn render_ask_ghostex_page(&mut self, cx: &mut gpui::Context<Self>) -> AnyElement {
        let mut chips = v_flex()
            .w_full()
            .max_w(px(GHOSTEX_PAGE_CONTENT_WIDTH))
            .gap(px(8.0))
            .child(self.render_ask_ghostex_intro())
            .child(self.render_ask_ghostex_question(
                GPUI_TITLEBAR_HELP_ASK_ANYTHING_INDEX,
                GPUI_TITLEBAR_HELP_ASK_ANYTHING_ICON,
                GPUI_TITLEBAR_HELP_ASK_ANYTHING_LABEL,
                "",
                cx,
            ));
        for (index, question) in GPUI_TITLEBAR_HELP_QUESTIONS.iter().enumerate() {
            chips = chips.child(self.render_ask_ghostex_question(
                index + 1,
                question.icon_path,
                question.label,
                question.question,
                cx,
            ));
        }
        v_flex()
            .id("ghostex-gpui-ghostex-page-ask")
            .size_full()
            .min_w_0()
            .min_h_0()
            .items_center()
            .overflow_y_scroll()
            .track_scroll(&self.ghostex_ask_page_scroll)
            .p(px(22.0))
            .bg(titlebar_popup_menu_background())
            .font_family("Inter Variable")
            .text_color(chrome_ink())
            .child(chips)
            .into_any_element()
    }

    fn render_ask_ghostex_intro(&self) -> impl IntoElement {
        v_flex()
            .w_full()
            .gap(px(2.0))
            .pb(px(6.0))
            .child(
                div()
                    .text_size(px(17.0))
                    .font_weight(FontWeight::SEMIBOLD)
                    .child("Ask anything about Ghostex"),
            )
            .child(
                div()
                    .text_size(px(12.5))
                    .line_height(px(18.0))
                    .text_color(chrome_ink().opacity(0.7))
                    .child(GPUI_TITLEBAR_HELP_ASK_ANYTHING_SUMMARY),
            )
    }

    /// One starter chip: the short label the dropdown row showed, with the full question it stages
    /// under it, so the page says both what the row is and exactly what will land in the composer.
    fn render_ask_ghostex_question(
        &self,
        question_index: usize,
        icon_path: &'static str,
        label: &'static str,
        question: &'static str,
        cx: &mut gpui::Context<Self>,
    ) -> impl IntoElement {
        h_flex()
            .id(format!("ghostex-gpui-ask-question-{question_index}"))
            .w_full()
            .items_center()
            .gap(px(10.0))
            .px(px(12.0))
            .py(px(9.0))
            .rounded(px(10.0))
            .border_1()
            .border_color(titlebar_popup_menu_border_color())
            .cursor_default()
            .hover(|this| this.bg(chrome_ink().opacity(0.06)))
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(move |this, _event: &MouseDownEvent, _window, cx| {
                    cx.stop_propagation();
                    this.run_gpui_titlebar_help_question(question_index, cx);
                }),
            )
            .child(titlebar_svg_icon(
                icon_path,
                15.0,
                chrome_ink().opacity(0.62).into(),
            ))
            .child(
                v_flex()
                    .flex_1()
                    .min_w_0()
                    .gap(px(1.0))
                    .child(
                        div()
                            .text_size(px(13.0))
                            .line_height(px(18.0))
                            .font_weight(FontWeight::MEDIUM)
                            .child(label),
                    )
                    .when(!question.is_empty(), |this| {
                        this.child(
                            div()
                                .text_size(px(12.0))
                                .line_height(px(16.0))
                                .text_color(chrome_ink().opacity(0.66))
                                .child(question),
                        )
                    }),
            )
    }
}
