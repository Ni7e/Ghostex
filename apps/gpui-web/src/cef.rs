//! The desktop asks its embedded Chromium a few questions. In the browser build the page IS the Chromium, so the same questions are answered from the DOM.

/// `prefers-color-scheme` of the hosting page, in the words CEF uses.
pub(crate) fn system_page_color_scheme() -> Option<String> {
    let query = web_sys::window()?
        .match_media("(prefers-color-scheme: light)")
        .ok()??;
    Some(if query.matches() { "light" } else { "dark" }.to_string())
}
