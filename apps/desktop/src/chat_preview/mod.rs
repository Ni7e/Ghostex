mod controls;
mod reference;
mod window;

gpui::actions!(chat_preview, [Quit]);

pub(crate) fn run() {
    let state_path =
        std::path::PathBuf::from(std::env::var_os("GHOSTEX_CHAT_PREVIEW_STATE").unwrap());
    // A separate data root keeps demo input and preferences out of the desktop app's saved state.
    unsafe {
        let inspector = std::net::TcpListener::bind("127.0.0.1:19588")
            .or_else(|_| std::net::TcpListener::bind("127.0.0.1:0"))
            .expect("reserve Chat Lab inspector port");
        let port = inspector.local_addr().unwrap().port();
        std::env::set_var("GHOSTEX_GPUI_CEF_REMOTE_DEBUGGING_PORT", port.to_string());
        let _ = std::fs::write(
            state_path.parent().unwrap().join("inspector-port"),
            port.to_string(),
        );
        std::env::set_var(
            "GHOSTEX_HOME",
            state_path
                .parent()
                .unwrap()
                .join("native-data")
                .join(std::process::id().to_string()),
        );
    }
    crate::cef::prepare_application();
    gpui_platform::application()
        .with_assets(crate::assets::GhostexAssets)
        .run(move |cx| {
            gpui_component::init(cx);
            crate::cef::initialize(cx).expect("initialize Chat Lab React reference");
            // CEF's inherited menu items are not GPUI actions. Install a complete
            // app menu so AppKit accessibility validation has registered actions.
            cx.on_action(|_: &Quit, cx| cx.quit());
            cx.bind_keys([gpui::KeyBinding::new("cmd-q", Quit, None)]);
            cx.set_menus(vec![
                gpui::Menu::new("Ghostex Chat Lab")
                    .items(vec![gpui::MenuItem::action("Quit Chat Lab", Quit)]),
            ]);
            window::open(state_path, cx);
            cx.on_window_closed(|cx, _| {
                if cx.windows().is_empty() {
                    cx.quit();
                }
            })
            .detach();
        });
    crate::cef::shutdown();
}
