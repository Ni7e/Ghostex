use gpui::App;

pub(crate) fn register(cx: &App) {
    static REGISTERED: std::sync::Once = std::sync::Once::new();
    REGISTERED.call_once(|| {
        // CDXC:SessionChat 2026-09-17 WHY: The variable font declares family "DM Sans 9pt", while chat requests "DM Sans". GPUI also matches concrete weight/style faces, so register the generated static family for the same bold and italic text as React.
        let fonts = vec![
            include_bytes!("../../../../../.dependencies/app-fonts/dm-sans/static/400.ttf")
                .as_slice()
                .into(),
            include_bytes!("../../../../../.dependencies/app-fonts/dm-sans/static/500.ttf")
                .as_slice()
                .into(),
            include_bytes!("../../../../../.dependencies/app-fonts/dm-sans/static/600.ttf")
                .as_slice()
                .into(),
            include_bytes!("../../../../../.dependencies/app-fonts/dm-sans/static/700.ttf")
                .as_slice()
                .into(),
            include_bytes!("../../../../../.dependencies/app-fonts/dm-sans/static/400-italic.ttf")
                .as_slice()
                .into(),
            include_bytes!("../../../../../.dependencies/app-fonts/dm-sans/static/500-italic.ttf")
                .as_slice()
                .into(),
            include_bytes!("../../../../../.dependencies/app-fonts/dm-sans/static/600-italic.ttf")
                .as_slice()
                .into(),
            include_bytes!("../../../../../.dependencies/app-fonts/dm-sans/static/700-italic.ttf")
                .as_slice()
                .into(),
        ];
        if let Err(error) = cx.text_system().add_fonts(fonts) {
            eprintln!("Could not register chat fonts: {error}");
        }
    });
}
