mod cef;

use std::{env, path::PathBuf, rc::Rc};

use anyhow::{Context as _, Result};
use cef::CefBrowser;
use gpui::{
    App, AppContext as _, Bounds, ContentMask, Element, ElementId, Entity, GlobalElementId, Hitbox,
    InteractiveElement as _, IntoElement, LayoutId, ParentElement as _, Pixels, Render, Size,
    Style, Styled as _, Window, WindowBounds, WindowOptions, canvas, div,
    prelude::FluentBuilder as _, px, size,
};
use gpui_component::{
    ActiveTheme as _, Root, h_flex,
    input::{Input, InputEvent, InputState},
    v_flex,
};
use raw_window_handle::{HasWindowHandle as _, RawWindowHandle};

const DEFAULT_BROWSER_URL: &str = "https://www.google.com";
const DEFAULT_SIDEBAR_WIDTH: f32 = 340.0;

pub struct GhostexGpuiApp {
    parent_ns_view: *mut std::ffi::c_void,
    sidebar_url: String,
    browser_url: String,
    sidebar: Option<Entity<CefSurface>>,
    browser: Option<Entity<CefSurface>>,
    address_input: Entity<InputState>,
}

impl GhostexGpuiApp {
    fn new(window: &mut Window, cx: &mut App) -> Result<Entity<Self>> {
        let parent = macos_parent_view(window)?;
        let sidebar_url = sidebar_url().context("failed to resolve sidebar bundle URL")?;
        let browser_url = DEFAULT_BROWSER_URL.to_string();

        let address_input =
            cx.new(|cx| InputState::new(window, cx).default_value(DEFAULT_BROWSER_URL));

        let app = cx.new(|cx| {
            let this = Self {
                parent_ns_view: parent,
                sidebar_url,
                browser_url,
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
        self.sidebar = Some(cx.new(|_| {
            CefSurface::new(
                "phase1-sidebar",
                self.parent_ns_view,
                self.sidebar_url.clone(),
                "phase1-sidebar",
            )
        }));
        self.browser = Some(cx.new(|_| {
            CefSurface::new(
                "phase1-browser",
                self.parent_ns_view,
                self.browser_url.clone(),
                "phase1-browser",
            )
        }));
        trace_startup("deferred CEF surfaces initialized");
        cx.notify();
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
        h_flex()
            .size_full()
            .bg(cx.theme().background)
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
                    .p_2()
                    .gap_2()
                    .child(
                        h_flex()
                            .items_center()
                            .gap_2()
                            .child(div().flex_1().child(Input::new(&self.address_input))),
                    )
                    .child(
                        div()
                            .flex_1()
                            .border_1()
                            .border_color(cx.theme().border)
                            .when_some(self.browser.clone(), |this, browser| this.child(browser)),
                    ),
            )
    }
}

struct CefSurface {
    browser: Rc<CefBrowser>,
    id: &'static str,
    visible: bool,
}

impl CefSurface {
    fn new(
        id: &'static str,
        parent_ns_view: *mut std::ffi::c_void,
        url: String,
        profile: &str,
    ) -> Self {
        let browser = CefBrowser::new(parent_ns_view, &url, profile);
        Self {
            browser: Rc::new(browser),
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
        let id = self.id;

        div()
            .id(id)
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
            .child(CefElement::new(browser, view, window, cx))
    }
}

struct CefElement {
    browser: Rc<CefBrowser>,
    parent: Entity<CefSurface>,
}

impl CefElement {
    fn new(
        browser: Rc<CefBrowser>,
        parent: Entity<CefSurface>,
        _window: &mut Window,
        _cx: &mut App,
    ) -> Self {
        Self { browser, parent }
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
        Some(window.insert_hitbox(bounds, gpui::HitboxBehavior::Normal))
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
        trace_startup("gpui-component initialized");

        let window_bounds = WindowBounds::centered(size(px(1280.0), px(820.0)), cx);
        let options = WindowOptions {
            window_bounds: Some(window_bounds),
            titlebar: Some(gpui::TitlebarOptions {
                title: Some("Ghostex GPUI Phase 1".into()),
                ..Default::default()
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
    format!("https://{trimmed}")
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
