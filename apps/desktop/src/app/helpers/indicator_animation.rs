use gpui::{
    AnyElement, App, Bounds, Element, ElementId, GlobalElementId, InspectorElementId, IntoElement,
    LayoutId, Pixels, Window, WindowId,
};
use std::{
    cell::RefCell,
    collections::HashSet,
    time::{Duration, Instant},
};

/// CDXC:Sidebar 2026-09-18 WHY:
/// gpui redraws the whole window for every animation frame, and the repeating indicators (sidebar working spinners, the chat working strip) ran at display rate.
/// With agents working, that redraw alone took about half of the UI thread, because every visible markdown view lays itself out again per frame.
/// Indicators advance on one shared timer at roughly seven frames per second instead; a spinner does not need sixty, and with agents always working the sidebar working state is a static dot since 2026-09-19.
/// SEE-ALSO: apps/desktop/src/app/native_sidebar/status.rs, apps/desktop/src/app/native_chat/working_strip.rs, apps/desktop/src/app/native_chat/working_spark.rs.
pub(crate) const INDICATOR_FRAME_INTERVAL: Duration = Duration::from_millis(150);

thread_local! {
    static FRAMES_PENDING: RefCell<HashSet<WindowId>> = RefCell::new(HashSet::new());
}

/// Schedules one redraw of `window` after the indicator interval, coalescing every indicator visible in that window.
pub(crate) fn request_indicator_frame(window: &mut Window, cx: &mut App) {
    let handle = window.window_handle();
    if !FRAMES_PENDING.with_borrow_mut(|pending| pending.insert(handle.window_id())) {
        return;
    }
    cx.spawn(async move |cx| {
        cx.background_executor()
            .timer(INDICATOR_FRAME_INTERVAL)
            .await;
        FRAMES_PENDING.with_borrow_mut(|pending| pending.remove(&handle.window_id()));
        let _ = handle.update(cx, |_, window, _| window.refresh());
    })
    .detach();
}

/// A repeating animation element that advances at the indicator rate instead of the display rate.
pub(crate) struct ThrottledAnimation<E> {
    id: ElementId,
    period: Duration,
    element: Option<E>,
    animator: Box<dyn Fn(E, f32) -> E + 'static>,
}

struct ThrottledAnimationState {
    start: Instant,
}

pub(crate) trait ThrottledAnimationExt: Sized {
    /// `animator` receives the progress 0..1 through `period`; the animation repeats.
    fn with_throttled_animation(
        self,
        id: impl Into<ElementId>,
        period: Duration,
        animator: impl Fn(Self, f32) -> Self + 'static,
    ) -> ThrottledAnimation<Self> {
        ThrottledAnimation {
            id: id.into(),
            period,
            element: Some(self),
            animator: Box::new(animator),
        }
    }
}

impl<E: IntoElement + 'static> ThrottledAnimationExt for E {}

impl<E: IntoElement + 'static> IntoElement for ThrottledAnimation<E> {
    type Element = Self;

    fn into_element(self) -> Self::Element {
        self
    }
}

impl<E: IntoElement + 'static> Element for ThrottledAnimation<E> {
    type RequestLayoutState = AnyElement;
    type PrepaintState = ();

    fn id(&self) -> Option<ElementId> {
        Some(self.id.clone())
    }

    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        id: Option<&GlobalElementId>,
        _inspector_id: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, Self::RequestLayoutState) {
        window.with_element_state(
            id.expect("a throttled animation carries an element id"),
            |state: Option<ThrottledAnimationState>, window| {
                let state = state.unwrap_or_else(|| ThrottledAnimationState {
                    start: Instant::now(),
                });
                let reduce_motion = cx.reduce_motion();
                let progress = if reduce_motion {
                    0.0
                } else {
                    (state.start.elapsed().as_secs_f32() / self.period.as_secs_f32()).fract()
                };
                let element = self
                    .element
                    .take()
                    .expect("a throttled animation lays out once per frame");
                let mut element = (self.animator)(element, progress).into_any_element();
                let layout_id = element.request_layout(window, cx);
                if !reduce_motion {
                    request_indicator_frame(window, cx);
                }
                ((layout_id, element), state)
            },
        )
    }

    fn prepaint(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&InspectorElementId>,
        _bounds: Bounds<Pixels>,
        element: &mut Self::RequestLayoutState,
        window: &mut Window,
        cx: &mut App,
    ) -> Self::PrepaintState {
        element.prepaint(window, cx);
    }

    fn paint(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&InspectorElementId>,
        _bounds: Bounds<Pixels>,
        element: &mut Self::RequestLayoutState,
        _prepaint: &mut Self::PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        element.paint(window, cx);
    }
}
