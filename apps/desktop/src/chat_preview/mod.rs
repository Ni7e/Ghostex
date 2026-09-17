mod window;

pub(crate) fn run() {
    let state_path =
        std::path::PathBuf::from(std::env::var_os("GHOSTEX_CHAT_PREVIEW_STATE").unwrap());
    // A separate data root keeps demo input and preferences out of the desktop app's saved state.
    unsafe {
        std::env::set_var(
            "GHOSTEX_HOME",
            state_path.parent().unwrap().join("native-data"),
        );
    }
    gpui_platform::application()
        .with_assets(crate::assets::GhostexAssets)
        .run(move |cx| {
            gpui_component::init(cx);
            window::open(state_path, cx);
            cx.on_window_closed(|cx, _| {
                if cx.windows().is_empty() { cx.quit(); }
            }).detach();
        });
}
