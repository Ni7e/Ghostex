//! The frosted pill every titlebar split button shares: Start, Open and Commit in the work area
//! header and the view panel's expand pair at the end of the view tab strip.

use gpui::BoxShadow;
use gpui::Hsla;
use gpui::Styled;
use gpui::div;
use gpui::hsla;
use gpui::px;

use crate::app::helpers::chrome_uses_light_appearance;

/// How far the divider between the two halves stops short of the pill's top and bottom edges.
const TITLEBAR_SPLIT_BUTTON_DIVIDER_INSET: f32 = 7.0;

fn white(alpha: f32) -> Hsla {
    hsla(0.0, 0.0, 1.0, alpha)
}

fn black(alpha: f32) -> Hsla {
    hsla(0.0, 0.0, 0.0, alpha)
}

/// CDXC:Titlebar 2026-09-24 DECISION:
/// User: the four split buttons (Start, Open, Commit, and the view panel's expand pair) become the "pill fill" style "but frosted glass looking": a borderless-looking pill whose surface is a top-to-bottom white gradient with a faint glass rim, a short inset divider and a soft shadow, in dark and light mode alike. Supersedes the 2026-09-23 interim #787779 outline. GPUI cannot blur what is behind a single element, so the frost is the gradient, rim and shadow alone; in transparent mode the window's own glass already blurs everything behind the header.
pub(crate) fn titlebar_split_button_frame<E: Styled>(element: E, control_height: f32) -> E {
    let light = chrome_uses_light_appearance();
    let (top, bottom) = if light {
        (white(0.95), white(0.62))
    } else {
        (white(0.17), white(0.07))
    };
    let (near_shadow, far_shadow) = if light {
        (black(0.07), black(0.04))
    } else {
        (black(0.22), black(0.10))
    };
    element
        .h(px(control_height))
        .rounded(px(control_height / 2.0))
        .border_1()
        .border_color(if light { black(0.08) } else { white(0.14) })
        .bg(gpui::linear_gradient(
            180.0,
            gpui::linear_color_stop(top, 0.0),
            gpui::linear_color_stop(bottom, 1.0),
        ))
        .shadow(vec![
            BoxShadow::new(px(0.0), px(1.0), near_shadow).blur_radius(px(2.0)),
            BoxShadow::new(px(0.0), px(2.0), far_shadow).blur_radius(px(5.0)),
        ])
}

/// The corner radius a half's hover or open fill takes on the pill's outer end, so the fill
/// follows the curve inside the 1px rim instead of showing square corners.
pub(crate) fn titlebar_split_button_segment_radius(control_height: f32) -> gpui::Pixels {
    px(control_height / 2.0 - 1.0)
}

/// The short line between the two halves.
pub(crate) fn titlebar_split_button_divider(control_height: f32) -> gpui::Div {
    div()
        .flex_shrink_0()
        .w(px(1.0))
        .h(px(control_height
            - 2.0
            - 2.0 * TITLEBAR_SPLIT_BUTTON_DIVIDER_INSET))
        .bg(if chrome_uses_light_appearance() {
            black(0.10)
        } else {
            white(0.16)
        })
}
