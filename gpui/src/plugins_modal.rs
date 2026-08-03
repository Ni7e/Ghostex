use super::*;

const PLUGINS_MODAL_WIDTH: f32 = 900.0;
const PLUGINS_MODAL_HEIGHT: f32 = 680.0;
const CODE_SERVER_COMPONENT: &str = "code-server";
const CEF_COMPONENT: &str = "cef";
const GXSERVER_LINUX_X64_ASSET: &str = "gxserver-linux-x64";
const GXSERVER_LINUX_ARM64_ASSET: &str = "gxserver-linux-arm64";
const BD_DARWIN_ARM64_ASSET: &str = "bd-darwin-arm64";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PluginsModalStatus {
    Installed,
    NotInstalled,
    Required,
    Cached,
    NotCached,
    Installing(component_store::ComponentStoreProgressPhase),
}

impl PluginsModalStatus {
    fn label(self) -> String {
        match self {
            Self::Installed => "Installed".to_string(),
            Self::NotInstalled => "Not installed".to_string(),
            Self::Required => "Required".to_string(),
            Self::Cached => "Cached".to_string(),
            Self::NotCached => "Not cached".to_string(),
            Self::Installing(phase) => match phase {
                component_store::ComponentStoreProgressPhase::Checking => "Checking…",
                component_store::ComponentStoreProgressPhase::Downloading => "Downloading…",
                component_store::ComponentStoreProgressPhase::Verifying => "Verifying…",
                component_store::ComponentStoreProgressPhase::Installing => "Installing…",
                component_store::ComponentStoreProgressPhase::Pruning => "Finishing…",
                component_store::ComponentStoreProgressPhase::Ready => "Installed",
            }
            .to_string(),
        }
    }

    fn color(self) -> Hsla {
        match self {
            Self::Installed | Self::Required | Self::Cached => rgb(0x67d391).into(),
            Self::Installing(_) => rgb(0x70a7ff).into(),
            Self::NotInstalled | Self::NotCached => rgb(0xffffff).opacity(0.50).into(),
        }
    }

    fn progress(self) -> Option<f32> {
        let Self::Installing(phase) = self else {
            return None;
        };
        Some(match phase {
            component_store::ComponentStoreProgressPhase::Checking => 0.10,
            component_store::ComponentStoreProgressPhase::Downloading => 0.35,
            component_store::ComponentStoreProgressPhase::Verifying => 0.65,
            component_store::ComponentStoreProgressPhase::Installing => 0.82,
            component_store::ComponentStoreProgressPhase::Pruning => 0.94,
            component_store::ComponentStoreProgressPhase::Ready => 1.0,
        })
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PluginsModalAction {
    InstallCodeServer,
    UninstallCodeServer,
    ShowCodeViewTab,
    RemoveGxserverX64,
    RemoveGxserverArm64,
    RemoveBd,
}

impl PluginsModalAction {
    fn label(self) -> &'static str {
        match self {
            Self::InstallCodeServer => "Install",
            Self::UninstallCodeServer => "Uninstall",
            Self::ShowCodeViewTab => "Show Code view tab",
            Self::RemoveGxserverX64 | Self::RemoveGxserverArm64 | Self::RemoveBd => {
                "Remove cached copy"
            }
        }
    }
}

#[derive(Clone)]
struct PluginsModalRow {
    actions: Vec<PluginsModalAction>,
    description: &'static str,
    id: &'static str,
    name: &'static str,
    size_bytes: u64,
    status: PluginsModalStatus,
    version: String,
}

struct PluginsModalSnapshot {
    rows: Vec<PluginsModalRow>,
    warning: Option<String>,
}

pub(crate) struct GpuiPluginsModalWindow {
    main_app: gpui::WeakEntity<GhostexGpuiApp>,
    notice: Option<(bool, String)>,
    snapshot: PluginsModalSnapshot,
}

impl GpuiPluginsModalWindow {
    fn new(main_app: gpui::WeakEntity<GhostexGpuiApp>, cx: &mut App) -> Entity<Self> {
        let snapshot = main_app
            .read_with(cx, |app, _| plugins_modal_snapshot(app))
            .unwrap_or_else(|error| PluginsModalSnapshot {
                rows: Vec::new(),
                warning: Some(format!("Plugins state is unavailable: {error}")),
            });
        cx.new(|_| Self {
            main_app,
            notice: None,
            snapshot,
        })
    }

    fn refresh(&mut self, cx: &mut gpui::Context<Self>) {
        match self
            .main_app
            .read_with(cx, |app, _| plugins_modal_snapshot(app))
        {
            Ok(snapshot) => self.snapshot = snapshot,
            Err(error) => {
                self.snapshot.warning = Some(format!("Plugins state is unavailable: {error}"));
            }
        }
        cx.notify();
    }

    fn close(&mut self, window: &mut Window, cx: &mut gpui::Context<Self>) {
        let _ = self.main_app.update(cx, |app, _| {
            app.plugins_modal_window = None;
        });
        window.remove_window();
    }

    fn run_action(&mut self, action: PluginsModalAction, cx: &mut gpui::Context<Self>) {
        let result = match action {
            PluginsModalAction::InstallCodeServer => self
                .main_app
                .update(cx, |app, cx| app.install_source_code_server_component(cx))
                .map(|_| ())
                .map_err(|error| error.to_string()),
            PluginsModalAction::UninstallCodeServer => self
                .main_app
                .update(cx, |app, cx| {
                    app.uninstall_component(CODE_SERVER_COMPONENT, cx)
                        .map(|_| ())
                })
                .map_err(|error| error.to_string())
                .and_then(|result| result),
            PluginsModalAction::ShowCodeViewTab => self
                .main_app
                .update(cx, |app, cx| app.show_code_view_tab(cx))
                .map_err(|error| error.to_string())
                .and_then(|result| result),
            PluginsModalAction::RemoveGxserverX64 => self.remove_cached_asset(
                GXSERVER_LINUX_X64_ASSET,
                component_store::ReleaseAssetCachePayload::DownloadArchive,
                cx,
            ),
            PluginsModalAction::RemoveGxserverArm64 => self.remove_cached_asset(
                GXSERVER_LINUX_ARM64_ASSET,
                component_store::ReleaseAssetCachePayload::DownloadArchive,
                cx,
            ),
            PluginsModalAction::RemoveBd => self.remove_cached_asset(
                BD_DARWIN_ARM64_ASSET,
                component_store::ReleaseAssetCachePayload::ExtractedExecutable("bd"),
                cx,
            ),
        };

        match result {
            Ok(()) => {
                self.notice = match action {
                    PluginsModalAction::InstallCodeServer => None,
                    PluginsModalAction::UninstallCodeServer => {
                        Some((false, "VS Code IDE was uninstalled.".to_string()))
                    }
                    PluginsModalAction::ShowCodeViewTab => {
                        Some((false, "The Code view tab is visible again.".to_string()))
                    }
                    PluginsModalAction::RemoveGxserverX64
                    | PluginsModalAction::RemoveGxserverArm64
                    | PluginsModalAction::RemoveBd => Some((
                        false,
                        "Cached copy removed. It will download again on next use.".to_string(),
                    )),
                };
            }
            Err(message) => self.notice = Some((true, message)),
        }
        self.refresh(cx);
    }

    fn remove_cached_asset(
        &self,
        asset_key: &str,
        payload: component_store::ReleaseAssetCachePayload<'static>,
        cx: &mut gpui::Context<Self>,
    ) -> Result<(), String> {
        self.main_app
            .update(cx, |app, cx| {
                app.remove_cached_plugin_asset(asset_key, payload, cx)
                    .map(|_| ())
            })
            .map_err(|error| error.to_string())?
    }

    fn render_action_button(
        &self,
        row_id: &'static str,
        action: PluginsModalAction,
        cx: &mut gpui::Context<Self>,
    ) -> AnyElement {
        let primary = action == PluginsModalAction::InstallCodeServer;
        let background: Hsla = if primary {
            rgb(0x377bd8).into()
        } else {
            rgb(0xffffff).opacity(0.055).into()
        };
        let hover_background: Hsla = if primary {
            rgb(0x4389e7).into()
        } else {
            rgb(0xffffff).opacity(0.10).into()
        };
        div()
            .id(format!("ghostex-gpui-plugins-{row_id}-{:?}", action))
            .flex()
            .h(px(27.0))
            .items_center()
            .justify_center()
            .rounded(px(5.0))
            .border_1()
            .border_color(rgb(0xffffff).opacity(if primary { 0.26 } else { 0.15 }))
            .bg(background)
            .px(px(10.0))
            .text_size(px(11.5))
            .font_weight(FontWeight::SEMIBOLD)
            .text_color(rgb(0xffffff).opacity(0.90))
            .cursor_pointer()
            .hover(move |this| this.bg(hover_background))
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|_, _: &MouseDownEvent, window, cx| {
                    window.prevent_default();
                    cx.stop_propagation();
                }),
            )
            .on_mouse_up(
                MouseButton::Left,
                cx.listener(move |this, _: &MouseUpEvent, window, cx| {
                    window.prevent_default();
                    cx.stop_propagation();
                    this.run_action(action, cx);
                }),
            )
            .child(action.label())
            .into_any_element()
    }

    fn render_row(&self, row: &PluginsModalRow, cx: &mut gpui::Context<Self>) -> AnyElement {
        let status = row.status;
        let progress = status.progress();
        h_flex()
            .id(format!("ghostex-gpui-plugins-row-{}", row.id))
            .min_h(px(86.0))
            .items_center()
            .border_b_1()
            .border_color(rgb(0xffffff).opacity(0.08))
            .px(px(18.0))
            .child(
                v_flex()
                    .w(px(315.0))
                    .min_w_0()
                    .gap(px(4.0))
                    .child(
                        div()
                            .text_size(px(13.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(rgb(0xffffff).opacity(0.94))
                            .child(row.name),
                    )
                    .child(
                        div()
                            .pr(px(20.0))
                            .text_size(px(11.5))
                            .line_height(px(16.0))
                            .text_color(rgb(0xffffff).opacity(0.54))
                            .child(row.description),
                    ),
            )
            .child(
                div()
                    .w(px(145.0))
                    .text_size(px(11.5))
                    .text_color(rgb(0xffffff).opacity(0.66))
                    .child(row.version.clone()),
            )
            .child(
                div()
                    .w(px(95.0))
                    .text_size(px(11.5))
                    .text_color(rgb(0xffffff).opacity(0.66))
                    .child(format_plugins_size(row.size_bytes)),
            )
            .child(
                v_flex()
                    .w(px(120.0))
                    .gap(px(6.0))
                    .child(
                        div()
                            .text_size(px(11.5))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(status.color())
                            .child(status.label()),
                    )
                    .when_some(progress, |this, progress| {
                        this.child(
                            div()
                                .h(px(3.0))
                                .w(px(96.0))
                                .rounded_full()
                                .overflow_hidden()
                                .bg(rgb(0xffffff).opacity(0.10))
                                .child(
                                    div()
                                        .h_full()
                                        .w(px(96.0 * progress))
                                        .rounded_full()
                                        .bg(rgb(0x70a7ff)),
                                ),
                        )
                    }),
            )
            .child(
                h_flex().flex_1().justify_end().gap(px(7.0)).children(
                    row.actions
                        .iter()
                        .copied()
                        .map(|action| self.render_action_button(row.id, action, cx)),
                ),
            )
            .into_any_element()
    }
}

impl Render for GpuiPluginsModalWindow {
    fn render(&mut self, _window: &mut Window, cx: &mut gpui::Context<Self>) -> impl IntoElement {
        let warning = self.snapshot.warning.clone();
        let notice = self.notice.clone();
        let banner = warning.map(|text| (true, text)).or(notice);
        v_flex()
            .id("ghostex-gpui-plugins-modal")
            .size_full()
            .overflow_hidden()
            .key_context(TITLEBAR_DROPDOWN_KEY_CONTEXT)
            .bg(rgb(0x151515))
            .text_color(rgb(0xffffff).opacity(0.90))
            .on_action(cx.listener(|this, _: &TitlebarDropdownCancel, window, cx| {
                this.close(window, cx);
            }))
            .child(
                h_flex()
                    .h(px(76.0))
                    .flex_shrink_0()
                    .items_center()
                    .justify_between()
                    .border_b_1()
                    .border_color(rgb(0xffffff).opacity(0.10))
                    .px(px(22.0))
                    .child(
                        v_flex()
                            .gap(px(3.0))
                            .child(
                                div()
                                    .text_size(px(18.0))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .child("Plugins"),
                            )
                            .child(
                                div()
                                    .text_size(px(12.0))
                                    .text_color(rgb(0xffffff).opacity(0.52))
                                    .child("Manage optional components and downloaded runtime packages."),
                            ),
                    )
                    .child(
                        div()
                            .id("ghostex-gpui-plugins-close")
                            .flex()
                            .h(px(28.0))
                            .items_center()
                            .justify_center()
                            .rounded(px(5.0))
                            .border_1()
                            .border_color(rgb(0xffffff).opacity(0.14))
                            .px(px(12.0))
                            .text_size(px(11.5))
                            .cursor_pointer()
                            .hover(|this| this.bg(rgb(0xffffff).opacity(0.09)))
                            .on_mouse_down(
                                MouseButton::Left,
                                cx.listener(|_, _: &MouseDownEvent, window, cx| {
                                    window.prevent_default();
                                    cx.stop_propagation();
                                }),
                            )
                            .on_mouse_up(
                                MouseButton::Left,
                                cx.listener(|this, _: &MouseUpEvent, window, cx| {
                                    window.prevent_default();
                                    cx.stop_propagation();
                                    this.close(window, cx);
                                }),
                            )
                            .child("Close"),
                    ),
            )
            .when_some(banner, |this, (is_error, text)| {
                this.child(
                    div()
                        .flex_shrink_0()
                        .border_b_1()
                        .border_color(rgb(0xffffff).opacity(0.08))
                        .bg(if is_error {
                            rgb(0x8f3535).opacity(0.22)
                        } else {
                            rgb(0x2f7d54).opacity(0.20)
                        })
                        .px(px(22.0))
                        .py(px(9.0))
                        .text_size(px(11.5))
                        .text_color(rgb(0xffffff).opacity(0.78))
                        .child(text),
                )
            })
            .child(
                h_flex()
                    .h(px(36.0))
                    .flex_shrink_0()
                    .items_center()
                    .border_b_1()
                    .border_color(rgb(0xffffff).opacity(0.08))
                    .px(px(18.0))
                    .text_size(px(10.5))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(rgb(0xffffff).opacity(0.38))
                    .child(div().w(px(315.0)).child("PLUGIN"))
                    .child(div().w(px(145.0)).child("VERSION"))
                    .child(div().w(px(95.0)).child("ON DISK"))
                    .child(div().w(px(120.0)).child("STATUS"))
                    .child(div().flex_1().text_align(gpui::TextAlign::Right).child("ACTION")),
            )
            .child(
                v_flex()
                    .flex_1()
                    .min_h_0()
                    .children(
                        self.snapshot
                            .rows
                            .iter()
                            .map(|row| self.render_row(row, cx)),
                    ),
            )
            .child(
                div()
                    .flex_shrink_0()
                    .border_t_1()
                    .border_color(rgb(0xffffff).opacity(0.08))
                    .px(px(22.0))
                    .py(px(10.0))
                    .text_size(px(10.5))
                    .text_color(rgb(0xffffff).opacity(0.40))
                    .child("Required components stay installed. Removed runtime packages download automatically when they are needed again."),
            )
    }
}

impl GhostexGpuiApp {
    pub(super) fn open_gpui_plugins_modal_window(&mut self, cx: &mut gpui::Context<Self>) {
        if let Some(handle) = self.plugins_modal_window.clone() {
            if handle
                .update(cx, |plugins, window, cx| {
                    plugins.refresh(cx);
                    window.activate_window();
                    window.refresh();
                })
                .is_ok()
            {
                return;
            }
            self.plugins_modal_window = None;
        }

        let options = WindowOptions {
            window_bounds: Some(WindowBounds::centered(
                size(px(PLUGINS_MODAL_WIDTH), px(PLUGINS_MODAL_HEIGHT)),
                cx,
            )),
            app_id: gpui_platform_window_app_id(),
            focus: true,
            icon: gpui_platform_window_icon(),
            show: true,
            is_resizable: false,
            titlebar: Some(gpui::TitlebarOptions {
                title: Some("Ghostex Plugins".into()),
                appears_transparent: false,
                traffic_light_position: None,
            }),
            ..Default::default()
        };
        let main_app = cx.weak_entity();
        self.plugins_modal_window = cx
            .open_window(options, move |window, cx| {
                window.activate_window();
                GpuiPluginsModalWindow::new(main_app, cx)
            })
            .ok();
    }

    pub(super) fn refresh_gpui_plugins_modal(&mut self, cx: &mut gpui::Context<Self>) {
        let Some(handle) = self.plugins_modal_window.clone() else {
            return;
        };
        cx.defer(move |cx| {
            let _ = handle.update(cx, |plugins, window, cx| {
                plugins.refresh(cx);
                window.refresh();
            });
        });
    }

    fn remove_cached_plugin_asset(
        &mut self,
        asset_key: &str,
        payload: component_store::ReleaseAssetCachePayload<'static>,
        cx: &mut gpui::Context<Self>,
    ) -> Result<bool, String> {
        let Some(store) = on_demand_component_store()? else {
            return Err("The sealed on-demand manifest is unavailable.".to_string());
        };
        let removed = store.remove_release_asset_cache(asset_key, payload)?;
        self.refresh_gpui_plugins_modal(cx);
        Ok(removed)
    }
}

fn plugins_modal_snapshot(app: &GhostexGpuiApp) -> PluginsModalSnapshot {
    let store_result = on_demand_component_store();
    let mut warning = store_result.as_ref().err().cloned();
    let store = store_result.ok().flatten();
    let mut rows = Vec::with_capacity(5);
    rows.push(code_server_row(app, store.as_ref(), &mut warning));
    rows.push(cef_row(store.as_ref(), &mut warning));
    rows.push(release_asset_row(
        store.as_ref(),
        GXSERVER_LINUX_X64_ASSET,
        "Remote server (Linux x64)",
        "Used to connect to and manage x64 Linux remote machines.",
        component_store::ReleaseAssetCachePayload::DownloadArchive,
        PluginsModalAction::RemoveGxserverX64,
        &mut warning,
    ));
    rows.push(release_asset_row(
        store.as_ref(),
        GXSERVER_LINUX_ARM64_ASSET,
        "Remote server (Linux arm64)",
        "Used to connect to and manage arm64 Linux remote machines.",
        component_store::ReleaseAssetCachePayload::DownloadArchive,
        PluginsModalAction::RemoveGxserverArm64,
        &mut warning,
    ));
    rows.push(release_asset_row(
        store.as_ref(),
        BD_DARWIN_ARM64_ASSET,
        "Beads (bd)",
        "Project board command-line runtime, downloaded on first board use.",
        component_store::ReleaseAssetCachePayload::ExtractedExecutable("bd"),
        PluginsModalAction::RemoveBd,
        &mut warning,
    ));
    PluginsModalSnapshot { rows, warning }
}

fn code_server_row(
    app: &GhostexGpuiApp,
    store: Option<&component_store::ComponentStore>,
    warning: &mut Option<String>,
) -> PluginsModalRow {
    let installing =
        app.source_code_server_runtime.state == SourceCodeServerRuntimeLaunchState::Installing;
    if let Some(
        failure @ (SourceCodeServerRuntimeFailure::InstallDownload
        | SourceCodeServerRuntimeFailure::InstallIntegrity
        | SourceCodeServerRuntimeFailure::InstallOther),
    ) = app.source_code_server_runtime.failure
    {
        set_first_warning(warning, failure.placeholder_message().to_string());
    }
    let mut actions = Vec::new();
    let mut size_bytes = 0;
    let mut version = "Unavailable".to_string();
    let mut installed = false;
    let mut managed_component = false;
    let mut managed_installed = false;

    if let Some(store) = store {
        if let Some(component) = store.component(CODE_SERVER_COMPONENT) {
            managed_component = true;
            version = component.component_version.clone();
            match store.query_current(CODE_SERVER_COMPONENT) {
                Ok(component) => {
                    installed = component.installed;
                    managed_installed = component.installed;
                    size_bytes = component.size_bytes;
                }
                Err(error) => set_first_warning(warning, error),
            }
        }
    }

    if !installed
        && !installing
        && let Ok(path) = source_code_server_resolve_repo_root()
    {
        installed = true;
        if version == "Unavailable" {
            version = "Development".to_string();
        }
        size_bytes = component_store::path_size_bytes(&path).unwrap_or(0);
    }

    let status = if installing {
        PluginsModalStatus::Installing(
            app.source_code_server_runtime
                .install_progress
                .unwrap_or(component_store::ComponentStoreProgressPhase::Checking),
        )
    } else if installed {
        PluginsModalStatus::Installed
    } else {
        PluginsModalStatus::NotInstalled
    };

    if !installing && managed_component && (!installed || managed_installed) {
        actions.push(if managed_installed {
            PluginsModalAction::UninstallCodeServer
        } else {
            PluginsModalAction::InstallCodeServer
        });
    }
    if gpui_code_view_tab_hidden_from_settings() {
        actions.push(PluginsModalAction::ShowCodeViewTab);
    }

    PluginsModalRow {
        actions,
        description: "VS Code-powered project editor. Optional and installed on demand.",
        id: "code-server",
        name: "VS Code IDE",
        size_bytes,
        status,
        version,
    }
}

fn cef_row(
    store: Option<&component_store::ComponentStore>,
    warning: &mut Option<String>,
) -> PluginsModalRow {
    if let Some(store) = store
        && let Some(component) = store.component(CEF_COMPONENT)
    {
        let version = component.component_version.clone();
        return match store.query_current(CEF_COMPONENT) {
            Ok(installed) => PluginsModalRow {
                actions: Vec::new(),
                description: "Chromium runtime used by Ghostex web surfaces. Required.",
                id: "cef",
                name: "Chromium runtime (CEF)",
                size_bytes: installed.size_bytes,
                status: if installed.installed {
                    PluginsModalStatus::Required
                } else {
                    PluginsModalStatus::NotInstalled
                },
                version,
            },
            Err(error) => {
                set_first_warning(warning, error);
                unavailable_cef_row(version)
            }
        };
    }

    let path = bundled_cef_runtime_path();
    let size_bytes = path
        .as_deref()
        .map(component_store::path_size_bytes)
        .transpose()
        .unwrap_or_else(|error| {
            set_first_warning(warning, error);
            None
        })
        .unwrap_or(0);
    PluginsModalRow {
        actions: Vec::new(),
        description: "Chromium runtime used by Ghostex web surfaces. Required and bundled.",
        id: "cef",
        name: "Chromium runtime (CEF)",
        size_bytes,
        status: if path.is_some() {
            PluginsModalStatus::Required
        } else {
            PluginsModalStatus::NotInstalled
        },
        version: compiled_cef_version(),
    }
}

fn unavailable_cef_row(version: String) -> PluginsModalRow {
    PluginsModalRow {
        actions: Vec::new(),
        description: "Chromium runtime used by Ghostex web surfaces. Required.",
        id: "cef",
        name: "Chromium runtime (CEF)",
        size_bytes: 0,
        status: PluginsModalStatus::NotInstalled,
        version,
    }
}

fn release_asset_row(
    store: Option<&component_store::ComponentStore>,
    asset_key: &'static str,
    name: &'static str,
    description: &'static str,
    payload: component_store::ReleaseAssetCachePayload<'static>,
    remove_action: PluginsModalAction,
    warning: &mut Option<String>,
) -> PluginsModalRow {
    let Some(store) = store else {
        return PluginsModalRow {
            actions: Vec::new(),
            description,
            id: asset_key,
            name,
            size_bytes: 0,
            status: PluginsModalStatus::NotCached,
            version: "Unavailable".to_string(),
        };
    };
    let version = store.release_version().to_string();
    match store.query_release_asset_cache(asset_key, payload) {
        Ok(cached) => PluginsModalRow {
            actions: cached.cached.then_some(remove_action).into_iter().collect(),
            description,
            id: asset_key,
            name,
            size_bytes: cached.size_bytes,
            status: if cached.cached {
                PluginsModalStatus::Cached
            } else {
                PluginsModalStatus::NotCached
            },
            version,
        },
        Err(error) => {
            set_first_warning(warning, error);
            PluginsModalRow {
                actions: Vec::new(),
                description,
                id: asset_key,
                name,
                size_bytes: 0,
                status: PluginsModalStatus::NotCached,
                version,
            }
        }
    }
}

fn set_first_warning(warning: &mut Option<String>, message: String) {
    if warning.is_none() {
        *warning = Some(message);
    }
}

fn format_plugins_size(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;
    let bytes = bytes as f64;
    if bytes >= GB {
        format!("{:.1} GB", bytes / GB)
    } else if bytes >= MB {
        format!("{:.1} MB", bytes / MB)
    } else if bytes >= KB {
        format!("{:.1} KB", bytes / KB)
    } else {
        format!("{} B", bytes as u64)
    }
}

fn compiled_cef_version() -> String {
    let bytes = ::cef::sys::CEF_VERSION;
    std::str::from_utf8(&bytes[..bytes.len().saturating_sub(1)])
        .unwrap_or("Unknown")
        .to_string()
}

#[cfg(target_os = "macos")]
fn bundled_cef_runtime_path() -> Option<PathBuf> {
    let resources = gpui_app_bundle_resources_dir()?;
    let path = resources
        .parent()?
        .join("Frameworks/Chromium Embedded Framework.framework");
    path.is_dir().then_some(path)
}

#[cfg(target_os = "windows")]
fn bundled_cef_runtime_path() -> Option<PathBuf> {
    let executable_dir = env::current_exe().ok()?.parent()?.to_path_buf();
    [executable_dir.join("resources"), executable_dir.clone()]
        .into_iter()
        .find(|path| path.join("libcef.dll").is_file())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn bundled_cef_runtime_path() -> Option<PathBuf> {
    let executable_dir = env::current_exe().ok()?.parent()?.to_path_buf();
    [executable_dir.join("lib"), executable_dir.clone()]
        .into_iter()
        .find(|path| path.join("libcef.so").is_file())
}
