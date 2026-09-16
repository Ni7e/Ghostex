use crate::app::helpers::*;
use gpui::{Image, ImageFormat};
use std::sync::Arc;

pub(crate) fn sidebar_image(value: &str) -> Option<Arc<Image>> {
    image(value, false)
}

pub(crate) fn agent_image(value: &str, agent: Option<&str>, light: bool) -> Option<Arc<Image>> {
    image(
        value,
        light
            && matches!(
                agent,
                Some(
                    "codex"
                        | "copilot"
                        | "amp-cli"
                        | "cursor-cli"
                        | "grok-build"
                        | "mastra"
                        | "zcode"
                )
            ),
    )
}

fn image(value: &str, monochrome: bool) -> Option<Arc<Image>> {
    let value = value.trim();
    if value.len() > 4 * 1024 * 1024 {
        return None;
    }
    let (metadata, payload) = value.strip_prefix("data:")?.split_once(',')?;
    let (format, encoded) = if metadata.split(';').next()? == "image/svg+xml" {
        (
            ImageFormat::Svg,
            metadata
                .split(';')
                .any(|part| part.eq_ignore_ascii_case("base64")),
        )
    } else {
        browser_favicon_data_url_metadata(metadata)?
    };
    let bytes = browser_favicon_percent_decode(payload, 4 * 1024 * 1024)?;
    let bytes = if encoded {
        browser_favicon_decode_base64(&bytes)?
    } else {
        bytes
    };
    if bytes.is_empty() {
        return None;
    }
    let bytes = if monochrome && format == ImageFormat::Svg {
        let mut svg = String::from_utf8(bytes).ok()?;
        let start = svg.find("<svg")?;
        let content = start + svg[start..].find('>')? + 1;
        let end = svg.rfind("</svg>")?;
        svg.insert_str(end, "</g>");
        svg.insert_str(content, r##"<defs><filter id="native-sidebar-monochrome" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0"/></filter></defs><g filter="url(#native-sidebar-monochrome)">"##);
        svg.into_bytes()
    } else {
        bytes
    };
    Some(Arc::new(Image::from_bytes(format, bytes)))
}
