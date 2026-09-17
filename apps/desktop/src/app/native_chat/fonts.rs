use gpui::App;

pub(crate) fn register(cx: &App) {
    static REGISTERED: std::sync::Once = std::sync::Once::new();
    REGISTERED.call_once(|| {
        let fonts = vec![
            include_bytes!("../../../../../.dependencies/app-fonts/dm-sans/normal.ttf")
                .as_slice()
                .into(),
            include_bytes!("../../../../../.dependencies/app-fonts/dm-sans/italic.ttf")
                .as_slice()
                .into(),
        ];
        if let Err(error) = cx.text_system().add_fonts(fonts) {
            eprintln!("Could not register chat fonts: {error}");
        }
    });
}
