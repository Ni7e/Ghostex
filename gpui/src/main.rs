mod cef;

use std::{env, path::PathBuf, rc::Rc};

use anyhow::{Context as _, Result};
use cef::CefBrowser;
use gpui::{
    App, AppContext as _, Bounds, ContentMask, Element, ElementId, Entity, FocusHandle, FontWeight,
    GlobalElementId, Hitbox, Hsla, InteractiveElement as _, IntoElement, KeyBinding, LayoutId,
    MouseButton, ParentElement as _, Pixels, Render, Size, StatefulInteractiveElement as _, Style,
    Styled as _, Window, WindowBounds, WindowControlArea, WindowOptions, canvas, div,
    prelude::FluentBuilder as _, px, rgb, size, svg,
};
use gpui_component::{
    ActiveTheme as _, Root, Sizable as _, Size as ComponentSize, h_flex,
    input::{Input, InputEvent, InputState},
    tooltip::Tooltip,
    v_flex,
};
use raw_window_handle::{HasWindowHandle as _, RawWindowHandle};

const DEFAULT_BROWSER_URL: &str = "https://www.google.com";
const DEFAULT_SIDEBAR_WIDTH: f32 = 340.0;
const CEF_KEY_CONTEXT: &str = "GhostexGpuiCef";
const TITLEBAR_HEIGHT: f32 = 35.0;
const TITLEBAR_CONTROL_HEIGHT: f32 = TITLEBAR_HEIGHT - 1.0;
const TITLEBAR_PROJECT_LEFT: f32 = 81.0;
const TITLEBAR_ICON_INFO: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/assets/titlebar/info-circle.svg"
);
const TITLEBAR_ICON_COFFEE: &str =
    concat!(env!("CARGO_MANIFEST_DIR"), "/assets/titlebar/coffee.svg");
const TITLEBAR_ICON_DEVICE_DESKTOP: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/assets/titlebar/device-desktop.svg"
);
const TITLEBAR_ICON_GIT_COMMIT: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/assets/titlebar/git-commit.svg"
);
const TITLEBAR_ICON_PLAYER_PLAY: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/assets/titlebar/player-play.svg"
);
const TITLEBAR_ICON_FOLDER_OPEN: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/assets/titlebar/folder-open.svg"
);
const TITLEBAR_ICON_CHEVRON_LEFT: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/assets/titlebar/chevron-left.svg"
);
const BROWSER_TOOLBAR_HEIGHT: f32 = 40.0;
const BROWSER_TOOLBAR_BUTTON_SIZE: f32 = 28.0;
const BROWSER_TOOLBAR_HORIZONTAL_PADDING: f32 = 12.0;
const BROWSER_TOOLBAR_ITEM_GAP: f32 = 10.0;
const BROWSER_TOOLBAR_ADDRESS_GAP: f32 = 18.0;
const BROWSER_TOOLBAR_ADDRESS_RIGHT_GAP: f32 = 14.0;
const BROWSER_ADDRESS_MINIMUM_WIDTH: f32 = 180.0;
const BROWSER_ADDRESS_HEIGHT: f32 = 20.0;
const BROWSER_ICON_CHEVRON_RIGHT: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/assets/titlebar/chevron-right.svg"
);
const BROWSER_ICON_RELOAD: &str =
    concat!(env!("CARGO_MANIFEST_DIR"), "/assets/titlebar/reload.svg");
const BROWSER_ICON_LOCK_FILLED: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/assets/titlebar/lock-filled.svg"
);
const BROWSER_ICON_WORLD: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/assets/titlebar/world.svg");
const BROWSER_ICON_TOOLS: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/assets/titlebar/tools.svg");
const BROWSER_ICON_POINTER: &str =
    concat!(env!("CARGO_MANIFEST_DIR"), "/assets/titlebar/pointer.svg");
const BROWSER_ICON_USER_CIRCLE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/assets/titlebar/user-circle.svg"
);
const BROWSER_ICON_CIRCLE_HALF: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/assets/titlebar/circle-half-2.svg"
);
const BROWSER_FEEDBACK_TOOL_UNAVAILABLE_TOOLTIP: &str = "This site disallows using this tool";

gpui::actions!(ghostex_gpui, [CefSelectAll]);

#[derive(Clone, Copy, PartialEq, Eq)]
enum TitlebarMode {
    Agents,
    Source,
    Browser,
    Kanban,
}

pub struct GhostexGpuiApp {
    parent_ns_view: *mut std::ffi::c_void,
    project_name: String,
    sidebar_url: String,
    browser_url: String,
    active_mode: TitlebarMode,
    sidebar: Option<Entity<CefSurface>>,
    browser: Option<Entity<CefSurface>>,
    address_input: Entity<InputState>,
}

impl GhostexGpuiApp {
    fn new(window: &mut Window, cx: &mut App) -> Result<Entity<Self>> {
        let parent = macos_parent_view(window)?;
        let project_name = project_name();
        let sidebar_url = sidebar_url().context("failed to resolve sidebar bundle URL")?;
        let browser_url = DEFAULT_BROWSER_URL.to_string();

        let address_input = cx.new(|cx| {
            InputState::new(window, cx)
                .placeholder("Search or enter address")
                .default_value(DEFAULT_BROWSER_URL)
        });

        let app = cx.new(|cx| {
            let this = Self {
                parent_ns_view: parent,
                project_name,
                sidebar_url,
                browser_url,
                active_mode: TitlebarMode::Agents,
                sidebar: None,
                browser: None,
                address_input: address_input.clone(),
            };

            cx.subscribe(
                &address_input,
                move |this: &mut Self, input, event: &InputEvent, cx| {
                    if matches!(event, InputEvent::PressEnter { .. }) {
                        let url = normalize_address(input.read(cx).value().as_ref());
                        this.browser_url = url.clone();
                        if let Some(browser) = &this.browser {
                            browser.update(cx, |browser, _| browser.load_url(&url));
                        }
                    }
                },
            )
            .detach();

            this
        });

        Ok(app)
    }

    fn initialize_cef(&mut self, cx: &mut gpui::Context<Self>) {
        if self.sidebar.is_some() {
            return;
        }

        trace_startup("initializing deferred CEF surfaces");
        cef::initialize().expect("failed to initialize CEF");
        self.sidebar = Some(cx.new(|cx| {
            CefSurface::new(
                "phase1-sidebar",
                self.parent_ns_view,
                self.sidebar_url.clone(),
                "phase1-sidebar",
                cx,
            )
        }));
        self.browser = Some(cx.new(|cx| {
            CefSurface::new(
                "phase1-browser",
                self.parent_ns_view,
                self.browser_url.clone(),
                "phase1-browser",
                cx,
            )
        }));
        trace_startup("deferred CEF surfaces initialized");
        cx.notify();
    }

    fn render_titlebar(&self, cx: &mut gpui::Context<Self>) -> impl IntoElement {
        /*
        CDXC:GPUITitlebar 2026-06-14-16:47:
        The GPUI prototype needs the same first-phase titlebar design as the macOS app: native traffic lights, the blue sidebar-collapse dot, passive project identity, centered Agents/Source/Browser/Kanban tabs, and right-side icon buttons. Dropdown panels and modal behavior are intentionally deferred, so these GPUI controls render the chrome and only the tabs keep local selected state.
        */
        div()
            .id("ghostex-gpui-titlebar")
            .relative()
            .flex_shrink_0()
            .w_full()
            .h(px(TITLEBAR_HEIGHT))
            .bg(titlebar_background())
            .text_color(titlebar_text_color())
            .font_family("Inter Variable")
            .line_height(px(TITLEBAR_CONTROL_HEIGHT))
            .window_control_area(WindowControlArea::Drag)
            .child(
                h_flex()
                    .h_full()
                    .w_full()
                    .items_center()
                    .justify_center()
                    .child(self.render_mode_switcher(cx)),
            )
            .child(self.render_project_slot())
            .child(self.render_right_titlebar_controls())
    }

    fn render_project_slot(&self) -> impl IntoElement {
        h_flex()
            .absolute()
            .left(px(TITLEBAR_PROJECT_LEFT))
            .top(px(1.0))
            .h(px(TITLEBAR_CONTROL_HEIGHT))
            .max_w(px(620.0))
            .min_w_0()
            .items_center()
            .window_control_area(WindowControlArea::Drag)
            .child(self.render_sidebar_collapse_button())
            .child(
                h_flex()
                    .h(px(TITLEBAR_CONTROL_HEIGHT))
                    .max_w(px(210.0))
                    .min_w_0()
                    .items_center()
                    .overflow_hidden()
                    .whitespace_nowrap()
                    .px(px(3.0))
                    .mt(px(2.0))
                    .text_size(px(13.5))
                    .font_weight(FontWeight::SEMIBOLD)
                    .line_height(px(TITLEBAR_CONTROL_HEIGHT))
                    .text_color(titlebar_project_text_color())
                    .child(self.project_name.clone()),
            )
    }

    fn render_sidebar_collapse_button(&self) -> impl IntoElement {
        div()
            .id("ghostex-gpui-sidebar-collapse")
            .relative()
            .flex()
            .h(px(33.0))
            .w(px(33.0))
            .ml(px(-9.0))
            .items_center()
            .justify_center()
            .cursor_default()
            .on_mouse_down(MouseButton::Left, |_, window, cx| {
                window.prevent_default();
                cx.stop_propagation();
            })
            .child(
                div()
                    .flex()
                    .size(px(14.0))
                    .mt(px(2.0))
                    .items_center()
                    .justify_center()
                    .rounded_full()
                    .bg(rgb(0x4699d9))
                    .text_color(rgb(0xffffff))
                    .hover(|this| this.bg(rgb(0x5aa7e1)))
                    .child(titlebar_svg_icon(
                        TITLEBAR_ICON_CHEVRON_LEFT,
                        10.0,
                        titlebar_active_text_color(),
                    )),
            )
    }

    fn render_mode_switcher(&self, cx: &mut gpui::Context<Self>) -> impl IntoElement {
        h_flex()
            .id("ghostex-gpui-titlebar-mode-switcher")
            .h(px(TITLEBAR_CONTROL_HEIGHT))
            .items_center()
            .child(self.render_mode_tab(TitlebarMode::Agents, "Agents", false, cx))
            .child(self.render_mode_tab(TitlebarMode::Source, "Source", false, cx))
            .child(self.render_mode_tab(TitlebarMode::Browser, "Browser", false, cx))
            .child(self.render_mode_tab(TitlebarMode::Kanban, "Kanban", true, cx))
    }

    fn render_mode_tab(
        &self,
        mode: TitlebarMode,
        label: &'static str,
        is_last: bool,
        cx: &mut gpui::Context<Self>,
    ) -> impl IntoElement {
        let is_active = self.active_mode == mode;
        div()
            .id(format!("ghostex-gpui-titlebar-mode-{label}"))
            .relative()
            .flex()
            .h(px(TITLEBAR_CONTROL_HEIGHT))
            .min_w(px(70.0))
            .items_center()
            .justify_center()
            .border_l_1()
            .when(is_last, |this| this.border_r_1())
            .border_color(titlebar_button_border_color())
            .px(px(14.0))
            .text_size(px(13.55))
            .font_weight(FontWeight::NORMAL)
            .line_height(px(TITLEBAR_CONTROL_HEIGHT))
            .text_color(if is_active {
                titlebar_active_text_color()
            } else {
                titlebar_inactive_text_color()
            })
            .cursor_default()
            .when(is_active, |this| this.bg(titlebar_active_segment_color()))
            .hover(|this| {
                let this = this.text_color(titlebar_active_text_color());
                if is_active {
                    this.bg(titlebar_active_segment_color())
                } else {
                    this
                }
            })
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(move |this, _event: &gpui::MouseDownEvent, window, cx| {
                    window.prevent_default();
                    cx.stop_propagation();
                    this.active_mode = mode;
                    cx.notify();
                }),
            )
            .child(label)
    }

    fn render_right_titlebar_controls(&self) -> impl IntoElement {
        h_flex()
            .absolute()
            .right_0()
            .top(px(1.0))
            .h(px(TITLEBAR_CONTROL_HEIGHT))
            .items_center()
            .child(self.render_titlebar_icon_button("tips", TITLEBAR_ICON_INFO, 16.0, true))
            .child(self.render_titlebar_icon_button(
                "keep-awake",
                TITLEBAR_ICON_COFFEE,
                14.0,
                false,
            ))
            .child(self.render_titlebar_icon_button(
                "resources",
                TITLEBAR_ICON_DEVICE_DESKTOP,
                16.0,
                false,
            ))
            .child(self.render_titlebar_icon_button("git", TITLEBAR_ICON_GIT_COMMIT, 15.0, false))
            .child(self.render_titlebar_icon_button(
                "actions",
                TITLEBAR_ICON_PLAYER_PLAY,
                16.0,
                false,
            ))
            .child(self.render_titlebar_icon_button(
                "open-project",
                TITLEBAR_ICON_FOLDER_OPEN,
                16.0,
                false,
            ))
    }

    fn render_titlebar_icon_button(
        &self,
        id: &'static str,
        icon_path: &'static str,
        icon_size: f32,
        show_badge: bool,
    ) -> impl IntoElement {
        div()
            .id(format!("ghostex-gpui-titlebar-button-{id}"))
            .relative()
            .flex()
            .h(px(TITLEBAR_CONTROL_HEIGHT))
            .w(px(42.0))
            .items_center()
            .justify_center()
            .border_l_1()
            .border_color(titlebar_button_border_color())
            .text_color(titlebar_icon_color())
            .cursor_default()
            .hover(|this| {
                this.bg(titlebar_button_hover_color())
                    .text_color(titlebar_icon_hover_color())
            })
            .on_mouse_down(MouseButton::Left, |_, window, cx| {
                window.prevent_default();
                cx.stop_propagation();
            })
            .child(titlebar_svg_icon(
                icon_path,
                icon_size,
                titlebar_icon_color(),
            ))
            .when(show_badge, |this| {
                this.child(
                    div()
                        .absolute()
                        .right(px(8.0))
                        .top(px(5.0))
                        .size(px(7.5))
                        .rounded_full()
                        .border_1()
                        .border_color(titlebar_background())
                        .bg(rgb(0x95d7f6)),
                )
            })
    }

    fn render_browser_toolbar(&self, cx: &mut gpui::Context<Self>) -> impl IntoElement {
        /*
        CDXC:GPUIBrowserToolbar 2026-06-14-17:42:
        The GPUI browser pane needs the same first-phase address toolbar as the macOS app, implemented only with GPUI chrome: a 40px black row, compact Back/Forward/Reload controls, a lock-or-globe address field, and the Agentation/Profile/Appearance/DevTools icon group. Keep dropdowns and advanced browser commands deferred, but preserve address commits inside the embedded CEF browser.

        CDXC:GPUIBrowserToolbar 2026-06-15-01:52:
        GitHub disallows the injected feedback tool, so the GPUI toolbar must render the feedback button disabled on github.com pages and expose the tooltip "This site disallows using this tool" instead of letting the user start an unsupported tool action.
        */
        let feedback_tool_unavailable = browser_feedback_tool_unavailable_url(&self.browser_url);
        h_flex()
            .id("ghostex-gpui-browser-toolbar")
            .flex_shrink_0()
            .h(px(BROWSER_TOOLBAR_HEIGHT))
            .w_full()
            .items_center()
            .bg(browser_toolbar_background())
            .px(px(BROWSER_TOOLBAR_HORIZONTAL_PADDING))
            .child(
                h_flex()
                    .items_center()
                    .gap(px(BROWSER_TOOLBAR_ITEM_GAP))
                    .child(self.render_browser_toolbar_button(
                        "back",
                        TITLEBAR_ICON_CHEVRON_LEFT,
                        17.0,
                        false,
                        None,
                    ))
                    .child(self.render_browser_toolbar_button(
                        "forward",
                        BROWSER_ICON_CHEVRON_RIGHT,
                        17.0,
                        false,
                        None,
                    ))
                    .child(self.render_browser_reload_button(cx)),
            )
            .child(
                div()
                    .flex_shrink_0()
                    .w(px(BROWSER_TOOLBAR_ITEM_GAP + BROWSER_TOOLBAR_ADDRESS_GAP)),
            )
            .child(self.render_browser_address_field())
            .child(div().flex_shrink_0().w(px(
                BROWSER_TOOLBAR_ADDRESS_RIGHT_GAP + BROWSER_TOOLBAR_ITEM_GAP
            )))
            .child(
                h_flex()
                    .items_center()
                    .gap(px(BROWSER_TOOLBAR_ITEM_GAP))
                    .child(
                        self.render_browser_toolbar_button(
                            "agentation",
                            BROWSER_ICON_POINTER,
                            16.0,
                            !feedback_tool_unavailable,
                            feedback_tool_unavailable
                                .then_some(BROWSER_FEEDBACK_TOOL_UNAVAILABLE_TOOLTIP),
                        ),
                    )
                    .child(self.render_browser_toolbar_button(
                        "profile",
                        BROWSER_ICON_USER_CIRCLE,
                        17.0,
                        true,
                        None,
                    ))
                    .child(self.render_browser_toolbar_button(
                        "appearance",
                        BROWSER_ICON_CIRCLE_HALF,
                        17.0,
                        true,
                        None,
                    ))
                    .child(self.render_browser_toolbar_button(
                        "devtools",
                        BROWSER_ICON_TOOLS,
                        17.0,
                        true,
                        None,
                    )),
            )
    }

    fn render_browser_address_field(&self) -> impl IntoElement {
        let parent_ns_view = self.parent_ns_view;
        let address_input = self.address_input.clone();

        h_flex()
            .id("ghostex-gpui-browser-address")
            .flex_1()
            .min_w(px(BROWSER_ADDRESS_MINIMUM_WIDTH))
            .h(px(BROWSER_ADDRESS_HEIGHT))
            .items_center()
            .cursor_text()
            .on_mouse_down(MouseButton::Left, move |_, window, cx| {
                /*
                CDXC:GPUIBrowserToolbar 2026-06-14-17:42:
                GPUI owns the browser toolbar input even though CEF owns the page below it. A toolbar click must restore AppKit first-responder ownership to GPUI before focusing the address input so typed URL text does not continue routing to Chromium.
                */
                cef::focus_native_view(parent_ns_view);
                address_input.update(cx, |input, cx| input.focus(window, cx));
            })
            .child(titlebar_svg_icon(
                browser_security_icon_path(&self.browser_url),
                14.0,
                browser_toolbar_security_icon_color(),
            ))
            .child(
                div()
                    .ml(px(8.0))
                    .flex_1()
                    .min_w_0()
                    .h(px(BROWSER_ADDRESS_HEIGHT))
                    .overflow_hidden()
                    .child(
                        Input::new(&self.address_input)
                            .with_size(ComponentSize::XSmall)
                            .appearance(false)
                            .bordered(false)
                            .focus_bordered(false)
                            .w_full()
                            .px(px(0.0))
                            .py(px(0.0))
                            .text_size(px(13.0))
                            .font_weight(FontWeight::MEDIUM)
                            .line_height(px(BROWSER_ADDRESS_HEIGHT))
                            .text_color(browser_toolbar_text_color()),
                    ),
            )
    }

    fn render_browser_toolbar_button(
        &self,
        id: &'static str,
        icon_path: &'static str,
        icon_size: f32,
        enabled: bool,
        tooltip: Option<&'static str>,
    ) -> impl IntoElement {
        div()
            .id(format!("ghostex-gpui-browser-toolbar-button-{id}"))
            .flex()
            .size(px(BROWSER_TOOLBAR_BUTTON_SIZE))
            .items_center()
            .justify_center()
            .rounded(px(5.0))
            .cursor_default()
            .text_color(if enabled {
                browser_toolbar_button_icon_color()
            } else {
                browser_toolbar_disabled_icon_color()
            })
            .when(enabled, |this| {
                this.hover(|this| this.bg(browser_toolbar_button_hover_color()))
                    .on_mouse_down(MouseButton::Left, |_, window, cx| {
                        window.prevent_default();
                        cx.stop_propagation();
                    })
            })
            .child(titlebar_svg_icon(
                icon_path,
                icon_size,
                if enabled {
                    browser_toolbar_button_icon_color()
                } else {
                    browser_toolbar_disabled_icon_color()
                },
            ))
            .when_some(tooltip, |this, tooltip| {
                this.tooltip(move |window, cx| Tooltip::new(tooltip).build(window, cx))
            })
    }

    fn render_browser_reload_button(&self, cx: &mut gpui::Context<Self>) -> impl IntoElement {
        div()
            .id("ghostex-gpui-browser-toolbar-button-reload")
            .flex()
            .size(px(BROWSER_TOOLBAR_BUTTON_SIZE))
            .items_center()
            .justify_center()
            .rounded(px(5.0))
            .cursor_default()
            .text_color(browser_toolbar_button_icon_color())
            .hover(|this| this.bg(browser_toolbar_button_hover_color()))
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|this, _event: &gpui::MouseDownEvent, window, cx| {
                    window.prevent_default();
                    cx.stop_propagation();
                    if let Some(browser) = &this.browser {
                        browser.update(cx, |browser, _| browser.load_url(&this.browser_url));
                    }
                }),
            )
            .child(titlebar_svg_icon(
                BROWSER_ICON_RELOAD,
                16.0,
                browser_toolbar_button_icon_color(),
            ))
    }
}

impl Render for GhostexGpuiApp {
    fn render(&mut self, _window: &mut Window, cx: &mut gpui::Context<Self>) -> impl IntoElement {
        if env::var_os("GHOSTEX_GPUI_TRACE").is_some() {
            eprintln!(
                "[ghostex-gpui] app render sidebar={} browser={}",
                self.sidebar.is_some(),
                self.browser.is_some()
            );
        }
        /*
        CDXC:GPUIPhase1 2026-06-14-12:06:
        Phase 1 must prove the macOS sidebar React UI and a normal browser surface can run as CEF children inside a GPUI shell. Keep the CEF child views as exact GPUI layout siblings, with the address-bar chrome owned by GPUI above only the main browser area, so future Linux and Windows backends can replace the macOS FFI without changing the app layout contract.
        */
        v_flex()
            .size_full()
            .bg(cx.theme().background)
            .child(self.render_titlebar(cx))
            .child(
                h_flex()
                    .flex_1()
                    .w_full()
                    .overflow_hidden()
                    .child(
                        div()
                            .w(px(DEFAULT_SIDEBAR_WIDTH))
                            .h_full()
                            .border_r_1()
                            .border_color(cx.theme().border)
                            .when_some(self.sidebar.clone(), |this, sidebar| this.child(sidebar)),
                    )
                    .child(
                        v_flex()
                            .flex_1()
                            .h_full()
                            .bg(browser_toolbar_background())
                            .child(self.render_browser_toolbar(cx))
                            .child(
                                div()
                                    .flex_1()
                                    .w_full()
                                    .overflow_hidden()
                                    .when_some(self.browser.clone(), |this, browser| {
                                        this.child(browser)
                                    }),
                            ),
                    ),
            )
    }
}

struct CefSurface {
    browser: Rc<CefBrowser>,
    focus_handle: FocusHandle,
    id: &'static str,
    visible: bool,
}

impl CefSurface {
    fn new(
        id: &'static str,
        parent_ns_view: *mut std::ffi::c_void,
        url: String,
        profile: &str,
        cx: &mut gpui::Context<Self>,
    ) -> Self {
        let browser = CefBrowser::new(parent_ns_view, &url, profile);
        Self {
            browser: Rc::new(browser),
            focus_handle: cx.focus_handle().tab_stop(false),
            id,
            visible: true,
        }
    }

    fn load_url(&mut self, url: &str) {
        self.browser.load_url(url);
    }
}

impl Render for CefSurface {
    fn render(&mut self, window: &mut Window, cx: &mut gpui::Context<Self>) -> impl IntoElement {
        let view = cx.entity().clone();
        let browser = self.browser.clone();
        let focus_handle = self.focus_handle.clone();
        let id = self.id;

        div()
            .id(id)
            .key_context(CEF_KEY_CONTEXT)
            .track_focus(&focus_handle)
            .on_action({
                let browser = browser.clone();
                move |_: &CefSelectAll, _, _| {
                    browser.select_all();
                }
            })
            .size_full()
            .child({
                let view = view.clone();
                canvas(
                    move |bounds, _, cx| {
                        view.update(cx, |surface, _| {
                            surface.browser.set_bounds(bounds);
                        })
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .size_full()
            })
            .child(CefElement::new(browser, view, focus_handle, window, cx))
    }
}

struct CefElement {
    browser: Rc<CefBrowser>,
    focus_handle: FocusHandle,
    parent: Entity<CefSurface>,
}

impl CefElement {
    fn new(
        browser: Rc<CefBrowser>,
        parent: Entity<CefSurface>,
        focus_handle: FocusHandle,
        _window: &mut Window,
        _cx: &mut App,
    ) -> Self {
        Self {
            browser,
            focus_handle,
            parent,
        }
    }
}

impl IntoElement for CefElement {
    type Element = CefElement;

    fn into_element(self) -> Self::Element {
        self
    }
}

impl Element for CefElement {
    type RequestLayoutState = ();
    type PrepaintState = Option<Hitbox>;

    fn id(&self) -> Option<ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, Self::RequestLayoutState) {
        let style = Style {
            size: Size::full(),
            flex_shrink: 1.,
            ..Default::default()
        };
        (window.request_layout(style, [], cx), ())
    }

    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut Self::RequestLayoutState,
        window: &mut Window,
        cx: &mut App,
    ) -> Self::PrepaintState {
        if !self.parent.read(cx).visible {
            self.browser.set_visible(false);
            return None;
        }

        if env::var_os("GHOSTEX_GPUI_TRACE").is_some() {
            eprintln!(
                "[ghostex-gpui] CEF prepaint x={:.0} y={:.0} width={:.0} height={:.0}",
                bounds.origin.x.as_f32(),
                bounds.origin.y.as_f32(),
                bounds.size.width.as_f32(),
                bounds.size.height.as_f32()
            );
        }
        self.browser.set_visible(true);
        self.browser.set_bounds(bounds);
        let hitbox = window.insert_hitbox(bounds, gpui::HitboxBehavior::Normal);
        let browser = self.browser.clone();
        let focus_handle = self.focus_handle.clone();
        window.on_mouse_event(move |event: &gpui::MouseDownEvent, phase, window, cx| {
            /*
            CDXC:GPUIPhase1 2026-06-14-16:45:
            The CEF child view owns normal web-page input behavior after it is clicked. Focus a GPUI handle with a CEF key context before restoring CEF focus so page text fields receive command-key shortcuts such as Cmd+A instead of leaving the GPUI address bar as the action target.
            */
            if phase.bubble()
                && event.button == MouseButton::Left
                && bounds.contains(&event.position)
            {
                focus_handle.focus(window, cx);
                browser.focus();
                window.refresh();
            }
        });
        Some(hitbox)
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut Self::RequestLayoutState,
        hitbox: &mut Self::PrepaintState,
        window: &mut Window,
        _: &mut App,
    ) {
        let bounds = hitbox
            .as_ref()
            .map(|hitbox| hitbox.bounds)
            .unwrap_or(bounds);
        window.with_content_mask(Some(ContentMask { bounds }), |_window| {});
    }
}

fn main() {
    cef::prepare_application();

    gpui_platform::application().run(move |cx| {
        trace_startup("application callback entered");
        gpui_component::init(cx);
        cx.bind_keys([KeyBinding::new(
            "cmd-a",
            CefSelectAll,
            Some(CEF_KEY_CONTEXT),
        )]);
        trace_startup("gpui-component initialized");

        let window_bounds = WindowBounds::centered(size(px(1280.0), px(820.0)), cx);
        let options = WindowOptions {
            window_bounds: Some(window_bounds),
            titlebar: Some(gpui::TitlebarOptions {
                title: None,
                appears_transparent: true,
                traffic_light_position: Some(gpui::point(px(9.0), px(9.0))),
            }),
            ..Default::default()
        };

        /*
        CDXC:GPUIPhase1 2026-06-14-13:10:
        CEF is mandatory for the phase-1 shell, but CEF surfaces need an actual GPUI platform window before they attach native AppKit children. Create the GPUI window first, then let the CEF bridge wait for non-zero layout bounds before creating browser hosts.

        CDXC:GPUIPhase1 2026-06-14-13:09:
        CEF startup must run after GPUI completes the first frame because initializing native Chromium children during root construction can stall the GPUI launch path without producing helper processes. Schedule CEF surface creation on the next frame, then explicitly refresh the window so the sidebar and browser elements enter the normal GPUI layout pass.
        */
        trace_startup("opening GPUI window");
        cx.open_window(options, |window, cx| {
            trace_startup("building GPUI root view");
            window.activate_window();
            let view =
                GhostexGpuiApp::new(window, cx).expect("failed to create Ghostex GPUI phase-1 app");
            let view_for_cef = view.clone();
            window.on_next_frame(move |window, cx| {
                view_for_cef.update(cx, |app, cx| app.initialize_cef(cx));
                window.refresh();
            });
            cx.new(|cx| Root::new(view, window, cx).bg(cx.theme().background))
        })
        .expect("failed to open GPUI window");
        trace_startup("GPUI window opened");
    });
    trace_startup("GPUI application run returned");
    cef::shutdown();
    trace_startup("CEF shutdown complete");
}

fn trace_startup(message: &str) {
    if env::var_os("GHOSTEX_GPUI_TRACE").is_some() {
        eprintln!("[ghostex-gpui] {message}");
    }
}

fn titlebar_svg_icon(path: &'static str, icon_size: f32, color: Hsla) -> impl IntoElement {
    svg()
        .size(px(icon_size))
        .external_path(path)
        .text_color(color)
}

fn titlebar_background() -> Hsla {
    rgb(0x0e0e0e).into()
}

fn titlebar_button_border_color() -> Hsla {
    rgb(0x252525).into()
}

fn titlebar_button_hover_color() -> Hsla {
    rgb(0xffffff).opacity(0.08).into()
}

fn titlebar_active_segment_color() -> Hsla {
    rgb(0xffffff).opacity(0.11).into()
}

fn titlebar_text_color() -> Hsla {
    rgb(0xffffff).opacity(0.84).into()
}

fn titlebar_project_text_color() -> Hsla {
    rgb(0xffffff).opacity(0.92).into()
}

fn titlebar_active_text_color() -> Hsla {
    rgb(0xffffff).into()
}

fn titlebar_inactive_text_color() -> Hsla {
    rgb(0xffffff).opacity(0.68).into()
}

fn titlebar_icon_color() -> Hsla {
    rgb(0xffffff).opacity(0.84).into()
}

fn titlebar_icon_hover_color() -> Hsla {
    rgb(0xffffff).into()
}

fn browser_toolbar_background() -> Hsla {
    rgb(0x000000).into()
}

fn browser_toolbar_text_color() -> Hsla {
    rgb(0xffffff).opacity(0.95).into()
}

fn browser_toolbar_security_icon_color() -> Hsla {
    rgb(0xc7c7c7).opacity(0.9).into()
}

fn browser_toolbar_button_icon_color() -> Hsla {
    rgb(0xdbdbdb).opacity(0.82).into()
}

fn browser_toolbar_disabled_icon_color() -> Hsla {
    rgb(0xdbdbdb).opacity(0.34).into()
}

fn browser_toolbar_button_hover_color() -> Hsla {
    rgb(0xffffff).opacity(0.08).into()
}

fn browser_security_icon_path(url: &str) -> &'static str {
    if url.trim_start().to_lowercase().starts_with("https://") {
        BROWSER_ICON_LOCK_FILLED
    } else {
        BROWSER_ICON_WORLD
    }
}

fn browser_feedback_tool_unavailable_url(url: &str) -> bool {
    let Some(host) = browser_url_host(url) else {
        return false;
    };
    host == "github.com" || host.ends_with(".github.com")
}

fn browser_url_host(url: &str) -> Option<String> {
    let trimmed = url.trim();
    let after_scheme = trimmed
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(trimmed);
    let without_userinfo = after_scheme.rsplit('@').next().unwrap_or(after_scheme);
    let authority_end = without_userinfo
        .find(['/', '?', '#'])
        .unwrap_or(without_userinfo.len());
    let authority = &without_userinfo[..authority_end];
    if authority.is_empty() {
        return None;
    }
    let host = if let Some(rest) = authority.strip_prefix('[') {
        rest.split_once(']').map(|(host, _)| host).unwrap_or("")
    } else {
        authority
            .split_once(':')
            .map(|(host, _)| host)
            .unwrap_or(authority)
    };
    let normalized = host.trim_end_matches('.').to_ascii_lowercase();
    (!normalized.is_empty()).then_some(normalized)
}

fn project_name() -> String {
    if let Ok(value) = env::var("GHOSTEX_GPUI_PROJECT_NAME") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }

    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|path| path.file_name())
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| "zmux".to_string())
}

fn macos_parent_view(window: &mut Window) -> Result<*mut std::ffi::c_void> {
    let handle = window
        .window_handle()
        .map_err(|error| anyhow::anyhow!("failed to read GPUI raw window handle: {error:?}"))?;
    match handle.as_raw() {
        RawWindowHandle::AppKit(handle) => Ok(handle.ns_view.as_ptr()),
        other => anyhow::bail!("CEF phase 1 currently requires macOS AppKit, got {other:?}"),
    }
}

fn normalize_address(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return DEFAULT_BROWSER_URL.to_string();
    }
    if trimmed.contains("://") {
        return trimmed.to_string();
    }
    if trimmed == "localhost"
        || trimmed.starts_with("localhost:")
        || trimmed.starts_with("127.0.0.1")
    {
        return format!("http://{trimmed}");
    }
    if trimmed.contains('.') && !trimmed.contains(' ') {
        return format!("https://{trimmed}");
    }
    /*
    CDXC:GPUIBrowserToolbar 2026-06-14-17:42:
    The GPUI address field should resolve committed text the same way as the macOS browser toolbar: explicit schemes are kept, local hosts use http, domain-like text uses https, and free text becomes an in-pane Google search.
    */
    format!(
        "https://www.google.com/search?q={}",
        encode_search_query(trimmed)
    )
}

fn encode_search_query(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    const HEX: &[u8; 16] = b"0123456789ABCDEF";

    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char);
            }
            b' ' => encoded.push('+'),
            _ => {
                encoded.push('%');
                encoded.push(HEX[(byte >> 4) as usize] as char);
                encoded.push(HEX[(byte & 0x0f) as usize] as char);
            }
        }
    }

    encoded
}

fn sidebar_url() -> Result<String> {
    if let Ok(value) = env::var("GHOSTEX_GPUI_SIDEBAR_URL") {
        if !value.trim().is_empty() {
            return Ok(value);
        }
    }

    let executable = env::current_exe().context("failed to resolve current executable")?;
    if let Some(bundle_root) = find_app_bundle_root(&executable) {
        let bundled = bundle_root.join("Contents/Resources/sidebar/index.html");
        if bundled.exists() {
            return Ok(file_url(&bundled));
        }
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let local = manifest_dir.join("dist/sidebar/index.html");
    if local.exists() {
        return Ok(file_url(&local));
    }

    anyhow::bail!(
        "sidebar bundle was not found; run gpui/scripts/build-macos-app.sh or bunx vite build --config gpui/vite.config.ts"
    );
}

fn find_app_bundle_root(path: &std::path::Path) -> Option<PathBuf> {
    for ancestor in path.ancestors() {
        if ancestor
            .extension()
            .is_some_and(|extension| extension == "app")
        {
            return Some(ancestor.to_path_buf());
        }
    }
    None
}

fn file_url(path: &std::path::Path) -> String {
    format!("file://{}", path.to_string_lossy())
}
