//! The native Ghostex Quick Access window: one borderless child window whose four tabs
//! (Commands, Projects, Sessions, Saved Prompts) replace the React pages that used to render in
//! the CEF modal host.
//!
//! CDXC:AppModal 2026-09-20 DECISION:
//! User: move Quick Access and every tab inside it from the React webview to GPUI, the way the sidebar and
//! chat view were moved, and make it look exactly like the React one.
//! The sidebar runtime keeps owning data and commands and publishes one resolved snapshot per frame; this
//! window paints it, owns the search field, hover, scroll and keyboard, and posts interactions back.
//! SEE-ALSO: packages/shared/native-quick-access.ts (the contract), apps/desktop/sidebar/native-quick-access/ (the controller),
//! apps/desktop/src/app/quick_access_modal_lifecycle.rs (open, snapshot routing, close),
//! packages/core-ui/command-palette.tsx, recent-projects-modal.tsx, previous-sessions-modal.tsx, stashed-prompts-modal.tsx (the retained React twins).
use super::chrome::{
    QuickAccessMenuState, capture_bounds, quick_access_filter_shelf, quick_access_icon,
    quick_access_search_field, quick_access_segmented, quick_access_select_menu,
    quick_access_select_trigger, quick_access_tab_rail, quick_access_tooltip, visible_options,
};
use super::editor::{quick_access_prompt_editor, quick_access_tag_composer};
use super::model::{
    QuickAccessMenuItem, QuickAccessSnapshot, QuickAccessTabId, QuickAccessToolbar,
};
use super::palette::{
    QUICK_ACCESS_GROUP_HEADING_HEIGHT, QUICK_ACCESS_ITEM_FONT_SIZE, QUICK_ACCESS_LIST_PADDING,
    QUICK_ACCESS_RADIUS_CONTROL, QUICK_ACCESS_RADIUS_MENU_ITEM, QUICK_ACCESS_ROW_PADDING_X,
    QuickAccessPalette, hsla,
};
use super::rows::{RowCallbacks, quick_access_row};
use crate::app::window::native_modal_kit::MODAL_UI_FONT;
use gpui::prelude::FluentBuilder as _;
use gpui::{
    AnyElement, App, AppContext as _, ClickEvent, Context, Entity, FocusHandle, Focusable,
    FontWeight, InteractiveElement as _, IntoElement, KeyDownEvent, MouseDownEvent,
    ParentElement as _, Point, Render, Rgba, ScrollHandle, SharedString,
    StatefulInteractiveElement as _, Styled as _, Subscription, Window, anchored, deferred, div,
    point, px, svg,
};
use gpui_component::input::{InputEvent, InputState};
use gpui_component::{h_flex, v_flex};
use serde_json::json;
use std::rc::Rc;

/// The React dialog is 654px wide inside a 692px window and `100vh - 16px` tall,
/// so the native content column keeps those gutters.
pub(crate) const QUICK_ACCESS_WINDOW_INSET_X: f32 = 19.0;
pub(crate) const QUICK_ACCESS_WINDOW_INSET_Y: f32 = 8.0;

pub(crate) type QuickAccessHost = Rc<dyn Fn(serde_json::Value, &mut App)>;

pub(crate) struct GpuiQuickAccessWindow {
    host: QuickAccessHost,
    pub(crate) snapshot: Option<QuickAccessSnapshot>,
    search: Entity<InputState>,
    query: String,
    applied_query_revision: u64,
    hovered: Option<String>,
    scroll: ScrollHandle,
    pending_scroll: Option<usize>,
    project_menu: QuickAccessMenuState,
    tag_menu: QuickAccessMenuState,
    editor_project_menu: QuickAccessMenuState,
    editor_tag_menu: QuickAccessMenuState,
    pub(crate) editor_input: Option<Entity<InputState>>,
    context_menu: Option<(Point<gpui::Pixels>, Vec<QuickAccessMenuItem>)>,
    tag_name_input: Option<Entity<InputState>>,
    /// Where a row's tag button opened the create-tag popover, since a row has
    /// no captured trigger bounds of its own.
    tag_composer_anchor: Option<Point<gpui::Pixels>>,
    /// A selection the pointer made must not scroll the list under it; only
    /// keyboard moves and re-ranked queries reveal their row.
    suppress_scroll: bool,
    last_load_more: Option<std::time::Instant>,
    /// The inset dialog column. A click on the window's gutters around it
    /// dismisses Quick Access, the way the React backdrop did.
    content_bounds: Rc<std::cell::Cell<Option<gpui::Bounds<gpui::Pixels>>>>,
    focus_handle: FocusHandle,
    subscriptions: Vec<Subscription>,
}

impl GpuiQuickAccessWindow {
    pub(crate) fn new(host: QuickAccessHost, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let search = cx.new(|cx| InputState::new(window, cx));
        let change = cx.subscribe_in(
            &search,
            window,
            |this: &mut Self, input, event: &InputEvent, _window, cx| {
                if matches!(event, InputEvent::Change) {
                    let value = input.read(cx).value().to_string();
                    if value == this.query {
                        return;
                    }
                    this.query = value.clone();
                    this.post(json!({ "type": "query", "query": value }), cx);
                    cx.notify();
                }
            },
        );
        search.update(cx, |input, cx| input.focus(window, cx));
        Self {
            host,
            snapshot: None,
            search,
            query: String::new(),
            applied_query_revision: 0,
            hovered: None,
            scroll: ScrollHandle::new(),
            pending_scroll: None,
            project_menu: QuickAccessMenuState::default(),
            tag_menu: QuickAccessMenuState::default(),
            editor_project_menu: QuickAccessMenuState::default(),
            editor_tag_menu: QuickAccessMenuState::default(),
            editor_input: None,
            context_menu: None,
            tag_name_input: None,
            tag_composer_anchor: None,
            suppress_scroll: false,
            last_load_more: None,
            content_bounds: Rc::new(std::cell::Cell::new(None)),
            focus_handle: cx.focus_handle(),
            subscriptions: vec![change],
        }
    }

    /// Quick Access follows the live app appearance and sidebar theme, the way
    /// the React surface followed `<body data-sidebar-theme>` and the child
    /// window's own fill.
    pub(crate) fn palette(&self) -> QuickAccessPalette {
        let light = crate::CHROME_LIGHT_APPEARANCE.load(std::sync::atomic::Ordering::Relaxed);
        let settings = crate::shared_settings::shared_sidebar_settings_snapshot();
        QuickAccessPalette::resolve(
            light,
            settings
                .object()
                .get("sidebarTheme")
                .and_then(serde_json::Value::as_str),
            self.window_background(),
        )
    }

    fn window_background(&self) -> Rgba {
        if crate::CHROME_LIGHT_APPEARANCE.load(std::sync::atomic::Ordering::Relaxed) {
            gpui::rgb(0xffffff)
        } else {
            Rgba::from(crate::app::helpers::titlebar_background())
        }
    }

    pub(crate) fn post(&self, command: serde_json::Value, cx: &mut App) {
        (self.host)(command, cx);
    }

    pub(crate) fn tab(&self) -> QuickAccessTabId {
        self.snapshot
            .as_ref()
            .map(|snapshot| snapshot.tab)
            .unwrap_or_default()
    }

    pub(crate) fn apply_snapshot(
        &mut self,
        snapshot: QuickAccessSnapshot,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if snapshot.query_revision != self.applied_query_revision {
            self.applied_query_revision = snapshot.query_revision;
            self.query = snapshot.query.clone();
            let query = snapshot.query.clone();
            self.search.update(cx, |input, cx| {
                input.set_value(query, window, cx);
                input.focus(window, cx);
            });
        }
        let placeholder = snapshot.placeholder.clone();
        if self
            .snapshot
            .as_ref()
            .map(|previous| previous.placeholder != placeholder)
            .unwrap_or(true)
        {
            self.search.update(cx, |input, cx| {
                input.set_placeholder(placeholder, window, cx);
            });
        }
        // The editor is a separate text surface; create and release its state with the panel.
        match (&snapshot.editor, self.editor_input.is_some()) {
            (Some(editor), false) => {
                let content = editor.content.clone();
                let input = cx.new(|cx| {
                    InputState::new(window, cx)
                        .multi_line(true)
                        .placeholder("Write a prompt you want to save...")
                        .default_value(content)
                });
                let change = cx.subscribe_in(
                    &input,
                    window,
                    |this: &mut Self, input, event: &InputEvent, _window, cx| {
                        if matches!(event, InputEvent::Change) {
                            let value = input.read(cx).value().to_string();
                            this.post(
                                json!({ "type": "editorField", "field": "content", "value": value }),
                                cx,
                            );
                        }
                    },
                );
                input.update(cx, |input, cx| input.focus(window, cx));
                self.subscriptions.push(change);
                self.editor_input = Some(input);
            }
            (None, true) => {
                self.editor_input = None;
                self.search.update(cx, |input, cx| input.focus(window, cx));
            }
            _ => {}
        }
        match (&snapshot.tag_composer, self.tag_name_input.is_some()) {
            (Some(composer), false) => {
                let name = composer.name.clone();
                let input = cx.new(|cx| {
                    InputState::new(window, cx)
                        .placeholder("Tag name")
                        .default_value(name)
                });
                let change = cx.subscribe_in(
                    &input,
                    window,
                    |this: &mut Self, input, event: &InputEvent, _window, cx| {
                        if matches!(event, InputEvent::Change) {
                            let value = input.read(cx).value().to_string();
                            this.post(
                                json!({ "type": "tagComposerField", "field": "name", "value": value }),
                                cx,
                            );
                        }
                    },
                );
                input.update(cx, |input, cx| input.focus(window, cx));
                self.subscriptions.push(change);
                self.tag_name_input = Some(input);
            }
            (None, true) => {
                self.tag_name_input = None;
                self.search.update(cx, |input, cx| input.focus(window, cx));
            }
            _ => {}
        }
        let selection_changed = self
            .snapshot
            .as_ref()
            .map(|previous| previous.selected_key != snapshot.selected_key)
            .unwrap_or(true);
        self.snapshot = Some(snapshot);
        if selection_changed && !std::mem::take(&mut self.suppress_scroll) {
            self.pending_scroll = self.selected_flat_index();
        }
        cx.notify();
    }

    pub(crate) fn apply_menu(&mut self, items: Vec<QuickAccessMenuItem>, cx: &mut Context<Self>) {
        match &mut self.context_menu {
            Some((_, current)) if !items.is_empty() => *current = items,
            _ if items.is_empty() => self.context_menu = None,
            _ => {}
        }
        cx.notify();
    }

    pub(crate) fn set_context_menu_anchor(&mut self, position: Point<gpui::Pixels>) {
        self.context_menu = Some((position, Vec::new()));
    }

    /// The scroll index of the selected row, counting headings as rows because
    /// the list renders them as siblings so the handle can reach either.
    fn selected_flat_index(&self) -> Option<usize> {
        let snapshot = self.snapshot.as_ref()?;
        if snapshot.selected_key.is_empty() {
            return None;
        }
        let mut index = 0usize;
        for group in &snapshot.groups {
            if !group.heading.is_empty() {
                index += 1;
            }
            for row in &group.rows {
                if row.key() == snapshot.selected_key {
                    return Some(index);
                }
                index += 1;
            }
        }
        None
    }

    fn row_callbacks(&self) -> RowCallbacks<Self> {
        RowCallbacks {
            on_activate: Rc::new(|this: &mut Self, key, _window, cx| {
                this.post(json!({ "type": "activate", "key": key }), cx);
            }),
            on_hover: Rc::new(|this: &mut Self, key, _window, cx| {
                if this.hovered.as_deref() == Some(key.as_str()) {
                    return;
                }
                this.hovered = Some(key.clone());
                this.suppress_scroll = true;
                this.post(json!({ "type": "select", "key": key }), cx);
                cx.notify();
            }),
            on_secondary: Rc::new(|this: &mut Self, key, position, _window, cx| {
                this.set_context_menu_anchor(position);
                this.post(
                    json!({
                        "type": "secondary",
                        "key": key,
                        "x": f32::from(position.x),
                        "y": f32::from(position.y),
                    }),
                    cx,
                );
                cx.notify();
            }),
            on_row_action: Rc::new(|this: &mut Self, key, action, position, _window, cx| {
                if action == "tag" {
                    this.tag_composer_anchor = Some(position);
                    this.post(
                        json!({ "type": "tagComposerOpen", "anchor": format!("row:{key}") }),
                        cx,
                    );
                    cx.notify();
                    return;
                }
                this.post(
                    json!({ "type": "rowAction", "key": key, "action": action }),
                    cx,
                );
            }),
        }
    }

    fn close(&mut self, cx: &mut Context<Self>) {
        self.post(json!({ "type": "close" }), cx);
    }

    fn move_selection(&mut self, direction: i32, cx: &mut Context<Self>) -> bool {
        let Some(snapshot) = self.snapshot.as_ref() else {
            return false;
        };
        let keys = snapshot
            .rows()
            .map(|row| row.key().to_string())
            .collect::<Vec<_>>();
        if keys.is_empty() {
            return false;
        }
        let current = keys
            .iter()
            .position(|key| key == &snapshot.selected_key)
            .map(|index| index as i32);
        let next = match current {
            Some(index) => (index + direction).rem_euclid(keys.len() as i32),
            None if direction > 0 => 0,
            None => keys.len() as i32 - 1,
        } as usize;
        self.hovered = None;
        self.suppress_scroll = false;
        let key = keys[next].clone();
        if let Some(snapshot) = self.snapshot.as_mut() {
            snapshot.selected_key = key.clone();
        }
        self.pending_scroll = self.selected_flat_index();
        self.post(json!({ "type": "select", "key": key }), cx);
        true
    }

    /// The open picker owns Up/Down/Enter/Escape and, when it is searchable,
    /// the typed filter, exactly like the React `Command` inside each popover.
    fn menu_key(&mut self, event: &KeyDownEvent, cx: &mut Context<Self>) -> bool {
        let key = event.keystroke.key.as_str();
        let modifiers = event.keystroke.modifiers;
        let which = if self.project_menu.open {
            "project"
        } else if self.tag_menu.open {
            "tag"
        } else if self.editor_project_menu.open {
            "editorProject"
        } else if self.editor_tag_menu.open {
            "editorTag"
        } else {
            return false;
        };
        let Some(select) = self.snapshot.as_ref().and_then(|snapshot| match which {
            "project" => project_select(snapshot),
            "tag" => tag_select(snapshot),
            "editorProject" => snapshot
                .editor
                .as_ref()
                .map(|editor| editor.projects.clone()),
            _ => snapshot.editor.as_ref().map(|editor| editor.tags.clone()),
        }) else {
            return false;
        };
        let state = match which {
            "project" => &mut self.project_menu,
            "tag" => &mut self.tag_menu,
            "editorProject" => &mut self.editor_project_menu,
            _ => &mut self.editor_tag_menu,
        };
        let count = visible_options(&select, &state.query).len();
        match key {
            "escape" => {
                state.close();
                cx.notify();
                return true;
            }
            "up" | "down" if count > 0 => {
                let delta = if key == "down" { 1 } else { count - 1 };
                state.highlight = (state.highlight.min(count - 1) + delta) % count;
                state.scroll.scroll_to_item(state.highlight);
                cx.notify();
                return true;
            }
            "backspace" if select.searchable && !state.query.is_empty() => {
                state.query.pop();
                state.highlight = 0;
                cx.notify();
                return true;
            }
            "enter" if count > 0 => {
                let highlight = state.highlight.min(count - 1);
                let value = visible_options(&select, &state.query)[highlight]
                    .value
                    .clone();
                self.choose_menu_value(which, value, cx);
                cx.notify();
                return true;
            }
            _ => {}
        }
        if select.searchable
            && !modifiers.platform
            && !modifiers.control
            && !modifiers.alt
            && let Some(text) = event.keystroke.key_char.as_deref()
            && text.chars().all(|character| !character.is_control())
        {
            state.query.push_str(text);
            state.highlight = 0;
            cx.notify();
            return true;
        }
        false
    }

    fn choose_menu_value(&mut self, which: &str, value: String, cx: &mut Context<Self>) {
        match which {
            "project" => {
                self.project_menu.close();
                self.post(json!({ "type": "project", "value": value }), cx);
            }
            "tag" => {
                self.post(json!({ "type": "tagFilter", "value": value }), cx);
            }
            "editorProject" => {
                self.editor_project_menu.close();
                self.post(
                    json!({ "type": "editorField", "field": "project", "value": value }),
                    cx,
                );
            }
            _ => {
                self.editor_tag_menu.close();
                self.post(
                    json!({ "type": "editorField", "field": "tag", "value": value }),
                    cx,
                );
            }
        }
    }

    fn handle_key(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        let key = event.keystroke.key.as_str();
        let modifiers = event.keystroke.modifiers;
        if self.context_menu.is_some() && key == "escape" {
            self.context_menu = None;
            cx.stop_propagation();
            cx.notify();
            return;
        }
        if self.menu_key(event, cx) {
            cx.stop_propagation();
            return;
        }
        // `⌘1`..`⌘4` reach every tab from every tab, matching QuickAccessHeader.
        if modifiers.platform && !modifiers.shift && !modifiers.alt {
            let tab = match key {
                "1" => Some(QuickAccessTabId::Commands),
                "2" => Some(QuickAccessTabId::RecentProjects),
                "3" => Some(QuickAccessTabId::RecentSessions),
                "4" => Some(QuickAccessTabId::SavedPrompts),
                _ => None,
            };
            if let Some(tab) = tab {
                cx.stop_propagation();
                self.post(json!({ "type": "tab", "tab": tab.wire_name() }), cx);
                return;
            }
        }
        /* CDXC:AppModal 2026-09-20 WHY:
        Option+C cycles All / Closed / External and takes precedence over other hotkeys while
        Sessions is open, the same reservation `isReservedQuickAccessSessionScopeHotkey` makes in
        the React host. */
        if modifiers.alt
            && !modifiers.platform
            && !modifiers.control
            && !modifiers.shift
            && key == "c"
            && self.tab() == QuickAccessTabId::RecentSessions
        {
            cx.stop_propagation();
            self.post(json!({ "type": "scope", "value": "cycle" }), cx);
            return;
        }
        if self.editor_input.is_some() {
            // The editor form owns its own keys: Escape cancels, Cmd+Enter saves.
            if key == "escape" {
                cx.stop_propagation();
                self.post(json!({ "type": "editorCancel" }), cx);
            } else if key == "enter" && (modifiers.platform || modifiers.control) {
                cx.stop_propagation();
                self.post(json!({ "type": "editorSubmit" }), cx);
            }
            return;
        }
        if self.tag_name_input.is_some() {
            if key == "escape" {
                cx.stop_propagation();
                self.post(json!({ "type": "tagComposerCancel" }), cx);
            } else if key == "enter" {
                cx.stop_propagation();
                self.post(json!({ "type": "tagComposerSubmit" }), cx);
            }
            return;
        }
        match key {
            "escape" => {
                cx.stop_propagation();
                self.close(cx);
            }
            "up" | "down" => {
                if self.move_selection(if key == "down" { 1 } else { -1 }, cx) {
                    cx.stop_propagation();
                    cx.notify();
                }
            }
            "enter" if !modifiers.alt && !modifiers.control && !modifiers.shift => {
                let selected = self
                    .snapshot
                    .as_ref()
                    .filter(|snapshot| !snapshot.selected_key.is_empty())
                    .and_then(|snapshot| {
                        snapshot
                            .rows()
                            .find(|row| row.key() == snapshot.selected_key)
                            .filter(|row| row.is_activatable())
                            .map(|row| row.key().to_string())
                    });
                if let Some(key) = selected {
                    cx.stop_propagation();
                    self.post(json!({ "type": "activate", "key": key }), cx);
                }
            }
            _ => {
                if self.project_menu.open
                    || self.tag_menu.open
                    || self.editor_project_menu.open
                    || self.editor_tag_menu.open
                {
                    return;
                }
                // Everything else is search text; keep the field focused so a key
                // pressed while a row or button had focus still lands in the query.
                let search = self.search.clone();
                if !search.read(cx).focus_handle(cx).is_focused(window) {
                    search.update(cx, |input, cx| input.focus(window, cx));
                }
            }
        }
    }
}

fn project_select(snapshot: &QuickAccessSnapshot) -> Option<super::model::QuickAccessSelect> {
    match &snapshot.toolbar {
        QuickAccessToolbar::Sessions { projects, .. }
        | QuickAccessToolbar::Prompts { projects, .. } => Some(projects.clone()),
        QuickAccessToolbar::None => None,
    }
}

fn tag_select(snapshot: &QuickAccessSnapshot) -> Option<super::model::QuickAccessSelect> {
    match &snapshot.toolbar {
        QuickAccessToolbar::Sessions { tags, .. } | QuickAccessToolbar::Prompts { tags, .. } => {
            Some(tags.clone())
        }
        QuickAccessToolbar::None => None,
    }
}

impl Render for GpuiQuickAccessWindow {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let p = self.palette();
        let snapshot = self.snapshot.clone();
        let tabs = snapshot
            .as_ref()
            .map(|snapshot| {
                snapshot
                    .tabs
                    .iter()
                    .map(|tab| {
                        (
                            SharedString::from(tab.label.clone()),
                            SharedString::from(tab.hotkey.clone()),
                            tab.id == snapshot.tab,
                        )
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let tab_ids = snapshot
            .as_ref()
            .map(|snapshot| snapshot.tabs.iter().map(|tab| tab.id).collect::<Vec<_>>())
            .unwrap_or_default();
        if let Some(index) = self.pending_scroll.take() {
            self.scroll.scroll_to_item(index);
        }
        let mut overlays: Vec<AnyElement> = Vec::new();
        if let Some(snapshot) = snapshot.as_ref() {
            if let Some(menu) = quick_access_select_menu(
                &p,
                &project_select(snapshot).unwrap_or_default(),
                &self.project_menu,
                "quick-access-project-menu",
                240.0,
                |this: &mut Self, value, _window, cx| {
                    this.project_menu.close();
                    this.post(json!({ "type": "project", "value": value }), cx);
                    cx.notify();
                },
                |this: &mut Self, _window, cx| {
                    this.project_menu.close();
                    cx.notify();
                },
                window,
                cx,
            ) {
                overlays.push(menu);
            }
            if let Some(menu) = quick_access_select_menu(
                &p,
                &tag_select(snapshot).unwrap_or_default(),
                &self.tag_menu,
                "quick-access-tag-menu",
                224.0,
                |this: &mut Self, value, _window, cx| {
                    this.post(json!({ "type": "tagFilter", "value": value }), cx);
                    cx.notify();
                },
                |this: &mut Self, _window, cx| {
                    this.tag_menu.close();
                    cx.notify();
                },
                window,
                cx,
            ) {
                overlays.push(menu);
            }
            if let Some(editor) = snapshot.editor.as_ref() {
                if let Some(menu) = quick_access_select_menu(
                    &p,
                    &editor.projects,
                    &self.editor_project_menu,
                    "quick-access-editor-project-menu",
                    240.0,
                    |this: &mut Self, value, _window, cx| {
                        this.editor_project_menu.close();
                        this.post(
                            json!({ "type": "editorField", "field": "project", "value": value }),
                            cx,
                        );
                        cx.notify();
                    },
                    |this: &mut Self, _window, cx| {
                        this.editor_project_menu.close();
                        cx.notify();
                    },
                    window,
                    cx,
                ) {
                    overlays.push(menu);
                }
                if let Some(menu) = quick_access_select_menu(
                    &p,
                    &editor.tags,
                    &self.editor_tag_menu,
                    "quick-access-editor-tag-menu",
                    224.0,
                    |this: &mut Self, value, _window, cx| {
                        this.editor_tag_menu.close();
                        this.post(
                            json!({ "type": "editorField", "field": "tag", "value": value }),
                            cx,
                        );
                        cx.notify();
                    },
                    |this: &mut Self, _window, cx| {
                        this.editor_tag_menu.close();
                        cx.notify();
                    },
                    window,
                    cx,
                ) {
                    overlays.push(menu);
                }
            }
            if let Some(composer) = snapshot.tag_composer.as_ref() {
                let anchor = if composer.anchor.starts_with("row:") {
                    self.tag_composer_anchor
                } else {
                    self.tag_menu.trigger_bounds.get().map(anchor_below)
                };
                overlays.push(quick_access_tag_composer(
                    &p,
                    composer,
                    self.tag_name_input.as_ref(),
                    anchor,
                    cx,
                ));
            }
            if let Some((position, items)) = self.context_menu.clone()
                && !items.is_empty()
            {
                overlays.push(self.render_context_menu(&p, position, &items, cx));
            }
        }
        div()
            .id("quick-access-window")
            .size_full()
            .overflow_hidden()
            .bg(hsla(p.window))
            .font_family(MODAL_UI_FONT)
            .text_size(px(QUICK_ACCESS_ITEM_FONT_SIZE))
            .line_height(px(18.0))
            .text_color(hsla(p.item))
            .track_focus(&self.focus_handle)
            .capture_key_down(cx.listener(|this, event: &KeyDownEvent, window, cx| {
                this.handle_key(event, window, cx);
            }))
            .on_mouse_down(
                gpui::MouseButton::Left,
                cx.listener(|this, event: &MouseDownEvent, _window, cx| {
                    let inside = this
                        .content_bounds
                        .get()
                        .is_some_and(|bounds| bounds.contains(&event.position));
                    if inside || this.context_menu.is_some() {
                        return;
                    }
                    this.close(cx);
                }),
            )
            .child(
                v_flex()
                    .size_full()
                    .px(px(QUICK_ACCESS_WINDOW_INSET_X))
                    .py(px(QUICK_ACCESS_WINDOW_INSET_Y))
                    .on_children_prepainted(capture_bounds(self.content_bounds.clone(), 0))
                    .child(
                        v_flex()
                            .size_full()
                            .min_h_0()
                            .relative()
                            .pb(px(4.0))
                            .child(quick_access_tab_rail(
                                &p,
                                &tabs,
                                move |this: &mut Self, index, _window, cx| {
                                    if let Some(tab) = tab_ids.get(index).copied() {
                                        this.post(
                                            json!({ "type": "tab", "tab": tab.wire_name() }),
                                            cx,
                                        );
                                    }
                                },
                                cx,
                            ))
                            .children(
                                snapshot
                                    .as_ref()
                                    .map(|snapshot| self.render_body(&p, snapshot, window, cx)),
                            ),
                    ),
            )
            .children(overlays)
    }
}

impl GpuiQuickAccessWindow {
    fn render_body(
        &mut self,
        p: &QuickAccessPalette,
        snapshot: &QuickAccessSnapshot,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        if let Some(editor) = snapshot.editor.as_ref() {
            return quick_access_prompt_editor(
                p,
                editor,
                self.editor_input.as_ref(),
                &self.editor_project_menu,
                &self.editor_tag_menu,
                cx,
            );
        }
        let has_query = !self.query.is_empty();
        v_flex()
            .flex_1()
            .min_h_0()
            .w_full()
            .relative()
            .child(quick_access_search_field(
                p,
                &self.search,
                has_query,
                |this: &mut Self, window, cx| {
                    this.query.clear();
                    this.search.update(cx, |input, cx| {
                        input.set_value("", window, cx);
                        input.focus(window, cx);
                    });
                    this.post(json!({ "type": "query", "query": "" }), cx);
                    cx.notify();
                },
                window,
                cx,
            ))
            .children(self.render_toolbar(p, snapshot, cx))
            .child(self.render_list(p, snapshot, cx))
            .children(snapshot.footer.as_ref().map(|footer| {
                self.render_find_prompts_button(p, &footer.label, &footer.hotkey, cx)
            }))
            .children(
                (!snapshot.hint.is_empty()).then(|| self.render_stash_hint(p, &snapshot.hint, cx)),
            )
            .into_any_element()
    }

    fn render_toolbar(
        &mut self,
        p: &QuickAccessPalette,
        snapshot: &QuickAccessSnapshot,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        match &snapshot.toolbar {
            QuickAccessToolbar::None => None,
            QuickAccessToolbar::Sessions {
                scope,
                scopes,
                scope_hotkey,
                tag_filter_active,
                projects,
                ..
            } => {
                let p = *p;
                let tag_active = *tag_filter_active;
                Some(
                    quick_access_filter_shelf(&p)
                        .child(quick_access_segmented(
                            &p,
                            "quick-access-session-scope",
                            scopes,
                            scope,
                            Some(264.0),
                            |this: &mut Self, value, _window, cx| {
                                this.post(json!({ "type": "scope", "value": value }), cx);
                            },
                            cx,
                        ))
                        .child(
                            div()
                                .flex_shrink_0()
                                .text_size(px(10.0))
                                .opacity(0.58)
                                .text_color(hsla(p.item))
                                .child(SharedString::from(scope_hotkey.clone())),
                        )
                        .child(
                            h_flex()
                                .ml_auto()
                                .min_w_0()
                                .gap(px(6.0))
                                .items_center()
                                .child(
                                    div()
                                        .flex_shrink_0()
                                        .on_children_prepainted(capture_bounds(
                                            self.tag_menu.trigger_bounds.clone(),
                                            0,
                                        ))
                                        .child(
                                            div()
                                                .id("quick-access-tag-filter")
                                                .size(px(32.0))
                                                .flex()
                                                .items_center()
                                                .justify_center()
                                                .rounded(px(QUICK_ACCESS_RADIUS_CONTROL))
                                                .border_1()
                                                .border_color(hsla(p.hairline))
                                                .cursor_pointer()
                                                .hover(move |this| this.bg(hsla(p.raised)))
                                                .on_click(cx.listener(
                                                    |this, _: &ClickEvent, _window, cx| {
                                                        this.project_menu.close();
                                                        this.tag_menu.toggle();
                                                        cx.notify();
                                                    },
                                                ))
                                                .child(
                                                    svg()
                                                        .path(super::chrome::asset_icon_path(
                                                            "filter-2",
                                                        ))
                                                        .size(px(16.0))
                                                        .text_color(hsla(if tag_active {
                                                            p.accent
                                                        } else {
                                                            p.item
                                                        })),
                                                ),
                                        ),
                                )
                                .child(
                                    div()
                                        .flex_shrink(1.0)
                                        .min_w_0()
                                        .on_children_prepainted(capture_bounds(
                                            self.project_menu.trigger_bounds.clone(),
                                            0,
                                        ))
                                        .child(quick_access_select_trigger(
                                            &p,
                                            projects,
                                            &self.project_menu,
                                            "quick-access-project-filter",
                                            Some(180.0),
                                            |this: &mut Self, _window, cx| {
                                                this.tag_menu.close();
                                                this.project_menu.toggle();
                                                cx.notify();
                                            },
                                            cx,
                                        )),
                                ),
                        )
                        .into_any_element(),
                )
            }
            QuickAccessToolbar::Prompts {
                view,
                views,
                projects,
                tags,
                can_add,
            } => {
                let p = *p;
                Some(
                    quick_access_filter_shelf(&p)
                        .child(quick_access_segmented(
                            &p,
                            "quick-access-prompt-view",
                            views,
                            view,
                            Some(210.0),
                            |this: &mut Self, value, _window, cx| {
                                this.post(json!({ "type": "view", "value": value }), cx);
                            },
                            cx,
                        ))
                        .child(
                            div()
                                .flex_shrink(1.0)
                                .min_w_0()
                                .on_children_prepainted(capture_bounds(
                                    self.project_menu.trigger_bounds.clone(),
                                    0,
                                ))
                                .child(quick_access_select_trigger(
                                    &p,
                                    projects,
                                    &self.project_menu,
                                    "quick-access-prompt-project",
                                    Some(180.0),
                                    |this: &mut Self, _window, cx| {
                                        this.tag_menu.close();
                                        this.project_menu.toggle();
                                        cx.notify();
                                    },
                                    cx,
                                )),
                        )
                        .child(
                            div()
                                .flex_shrink(1.0)
                                .min_w_0()
                                .on_children_prepainted(capture_bounds(
                                    self.tag_menu.trigger_bounds.clone(),
                                    0,
                                ))
                                .child(quick_access_select_trigger(
                                    &p,
                                    tags,
                                    &self.tag_menu,
                                    "quick-access-prompt-tag",
                                    Some(160.0),
                                    |this: &mut Self, _window, cx| {
                                        this.project_menu.close();
                                        this.tag_menu.toggle();
                                        cx.notify();
                                    },
                                    cx,
                                )),
                        )
                        .children(can_add.then(|| {
                            h_flex()
                                .id("quick-access-add-prompt")
                                .ml_auto()
                                .flex_shrink_0()
                                .h(px(32.0))
                                .px(px(10.0))
                                .gap(px(6.0))
                                .items_center()
                                .rounded(px(QUICK_ACCESS_RADIUS_CONTROL))
                                .border_1()
                                .border_color(hsla(p.hairline))
                                .cursor_pointer()
                                .text_size(px(QUICK_ACCESS_ITEM_FONT_SIZE))
                                .text_color(hsla(p.item))
                                .hover(move |this| this.bg(hsla(p.raised)))
                                .on_click(cx.listener(|this, _: &ClickEvent, _window, cx| {
                                    this.post(json!({ "type": "addPrompt" }), cx);
                                }))
                                .child(
                                    svg()
                                        .path(super::chrome::asset_icon_path("plus"))
                                        .size(px(16.0))
                                        .text_color(hsla(p.item)),
                                )
                                .child("Add")
                        }))
                        .into_any_element(),
                )
            }
        }
    }

    fn render_list(
        &mut self,
        p: &QuickAccessPalette,
        snapshot: &QuickAccessSnapshot,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let p = *p;
        let callbacks = self.row_callbacks();
        let hovered = self.hovered.clone();
        let selected = snapshot.selected_key.clone();
        let mut children: Vec<AnyElement> = Vec::new();
        let mut row_index = 0usize;
        for group in &snapshot.groups {
            if group.separated && !children.is_empty() {
                children.push(
                    div()
                        .my(px(4.0))
                        .mx(px(QUICK_ACCESS_ROW_PADDING_X))
                        .h(px(1.0))
                        .bg(hsla(p.separator()))
                        .into_any_element(),
                );
            }
            if !group.heading.is_empty() {
                children.push(
                    div()
                        .w_full()
                        .flex_shrink_0()
                        .min_h(px(QUICK_ACCESS_GROUP_HEADING_HEIGHT))
                        .px(px(QUICK_ACCESS_ROW_PADDING_X))
                        .py(px(5.0))
                        .text_size(px(11.0))
                        .font_weight(FontWeight::MEDIUM)
                        .line_height(px(16.0))
                        .text_color(hsla(p.muted))
                        .child(SharedString::from(group.heading.clone()))
                        .into_any_element(),
                );
            }
            for row in &group.rows {
                let is_selected = row.key() == selected;
                let is_hovered = hovered.as_deref() == Some(row.key());
                children.push(quick_access_row(
                    &p,
                    row,
                    row_index,
                    is_selected,
                    is_hovered,
                    &callbacks,
                    cx,
                ));
                row_index += 1;
            }
        }
        if children.is_empty() {
            children.push(
                div()
                    .w_full()
                    .py(px(24.0))
                    .px(px(12.0))
                    .text_size(px(QUICK_ACCESS_ITEM_FONT_SIZE))
                    .text_color(hsla(p.muted))
                    .text_center()
                    .child(SharedString::from(if snapshot.loading {
                        snapshot.loading_label.clone()
                    } else {
                        snapshot.empty.clone()
                    }))
                    .into_any_element(),
            );
        }
        v_flex()
            .id("quick-access-list")
            .flex_1()
            .min_h_0()
            .w_full()
            .p(px(QUICK_ACCESS_LIST_PADDING))
            .overflow_y_scroll()
            .track_scroll(&self.scroll)
            .on_scroll_wheel(cx.listener(|this, _, _window, cx| {
                /* The runtime widens the visible history window and pages gxserver; the
                window only has to say that the reader reached the end of what it has. */
                let offset = this.scroll.offset().y;
                let max = this.scroll.max_offset().y;
                if max <= gpui::px(0.0) || (max + offset) > gpui::px(96.0) {
                    return;
                }
                // The React list throttled its reveal to one step per 150ms.
                let now = std::time::Instant::now();
                if this
                    .last_load_more
                    .is_some_and(|last| now.duration_since(last).as_millis() < 150)
                {
                    return;
                }
                this.last_load_more = Some(now);
                this.post(json!({ "type": "loadMore" }), cx);
            }))
            .children(children)
            .into_any_element()
    }

    /// `.previous-sessions-find-prompts-button`: the floating pill over the
    /// bottom-right of the Sessions list.
    fn render_find_prompts_button(
        &self,
        p: &QuickAccessPalette,
        label: &str,
        hotkey: &str,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let p = *p;
        h_flex()
            .id("quick-access-find-prompts")
            .absolute()
            .right(px(18.0))
            .bottom(px(14.0))
            .h(px(32.0))
            .pl(px(12.0))
            .pr(px(14.0))
            .gap(px(7.0))
            .items_center()
            .rounded_full()
            .border_1()
            .border_color(hsla(p.float_border))
            .bg(hsla(p.float_surface))
            .text_size(px(QUICK_ACCESS_ITEM_FONT_SIZE))
            .line_height(px(20.0))
            .text_color(hsla(p.foreground))
            .cursor_default()
            .hover(move |this| this.bg(hsla(p.raised_hover)))
            .on_click(cx.listener(|this, _: &ClickEvent, _window, cx| {
                this.post(json!({ "type": "footer" }), cx);
            }))
            .child(
                svg()
                    .path(super::chrome::asset_icon_path("file-search"))
                    .size(px(15.0))
                    .flex_shrink_0()
                    .text_color(hsla(p.foreground)),
            )
            .child(SharedString::from(label.to_string()))
            .children((!hotkey.is_empty()).then(|| {
                div()
                    .flex_shrink_0()
                    .text_size(px(10.0))
                    .opacity(0.58)
                    .child(SharedString::from(hotkey.to_string()))
            }))
            .into_any_element()
    }

    /// `.ghostex-stashed-prompts-stash-hint`: the 28px info pill in the corner.
    fn render_stash_hint(
        &self,
        p: &QuickAccessPalette,
        hint: &str,
        _cx: &mut Context<Self>,
    ) -> AnyElement {
        let p = *p;
        let hint = hint.to_string();
        div()
            .id("quick-access-stash-hint")
            .absolute()
            .right(px(10.0))
            .bottom(px(10.0))
            .size(px(28.0))
            .flex()
            .items_center()
            .justify_center()
            .rounded_full()
            .border_1()
            .border_color(hsla(gpui::Rgba {
                a: 0.18,
                ..p.foreground
            }))
            .bg(hsla(p.raised))
            .text_color(hsla(p.muted))
            .hover(move |this| this.bg(hsla(p.raised_hover)))
            .tooltip(move |window, cx| quick_access_tooltip(hint.clone(), window, cx))
            .child(
                svg()
                    .path(super::chrome::asset_icon_path("info-circle"))
                    .size(px(16.0))
                    .text_color(hsla(p.muted)),
            )
            .into_any_element()
    }

    /// The Projects row context menu, drawn as the shared Codex popup surface.
    fn render_context_menu(
        &self,
        p: &QuickAccessPalette,
        position: Point<gpui::Pixels>,
        items: &[QuickAccessMenuItem],
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let p = *p;
        let rows = items
            .iter()
            .enumerate()
            .map(|(index, item)| {
                if item.separator {
                    return div()
                        .my(px(3.0))
                        .h(px(1.0))
                        .w_full()
                        .bg(hsla(p.menu_border))
                        .into_any_element();
                }
                let id = item.id.clone();
                let color = if item.danger { p.destructive } else { p.item };
                h_flex()
                    .id(("quick-access-menu-item", index))
                    .w_full()
                    .min_h(px(28.0))
                    .px(px(8.0))
                    .gap(px(8.0))
                    .items_center()
                    .rounded(px(QUICK_ACCESS_RADIUS_MENU_ITEM))
                    .text_size(px(QUICK_ACCESS_ITEM_FONT_SIZE))
                    .text_color(hsla(color))
                    .when(item.disabled, |this| this.opacity(0.45))
                    .when(!item.disabled, |this| {
                        this.cursor_pointer()
                            .hover(move |this| this.bg(hsla(p.menu_hover)))
                            .on_click(cx.listener(move |this, _: &ClickEvent, _window, cx| {
                                this.context_menu = None;
                                this.post(json!({ "type": "menuItem", "id": id.clone() }), cx);
                                cx.notify();
                            }))
                    })
                    .child(quick_access_icon(&item.icon, 14.0, color))
                    .child(SharedString::from(item.label.clone()))
                    .into_any_element()
            })
            .collect::<Vec<_>>();
        deferred(
            anchored()
                .position(position)
                .snap_to_window_with_margin(px(8.0))
                .child(
                    v_flex()
                        .id("quick-access-context-menu")
                        .occlude()
                        .min_w(px(210.0))
                        .p(px(4.0))
                        .gap(px(1.0))
                        .rounded(px(QUICK_ACCESS_RADIUS_CONTROL))
                        .border_1()
                        .border_color(hsla(p.menu_border))
                        .bg(hsla(p.menu_background))
                        .shadow_lg()
                        .on_mouse_down_out(cx.listener(|this, _: &MouseDownEvent, _window, cx| {
                            this.context_menu = None;
                            cx.notify();
                        }))
                        .children(rows),
                ),
        )
        .with_priority(2)
        .into_any_element()
    }
}

impl Focusable for GpuiQuickAccessWindow {
    fn focus_handle(&self, _cx: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

/// Anchors a popover to a control whose bounds were captured during prepaint.
pub(crate) fn anchor_below(bounds: gpui::Bounds<gpui::Pixels>) -> Point<gpui::Pixels> {
    point(
        bounds.origin.x,
        bounds.origin.y + bounds.size.height + px(6.0),
    )
}

impl super::editor::EditorHost for GpuiQuickAccessWindow {
    fn post_editor(&mut self, command: serde_json::Value, cx: &mut Context<Self>) {
        self.post(command, cx);
        cx.notify();
    }

    fn toggle_editor_project_menu(&mut self, cx: &mut Context<Self>) {
        self.editor_tag_menu.close();
        self.editor_project_menu.toggle();
        cx.notify();
    }

    fn toggle_editor_tag_menu(&mut self, cx: &mut Context<Self>) {
        self.editor_project_menu.close();
        self.editor_tag_menu.toggle();
        cx.notify();
    }
}
