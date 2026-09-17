use crate::GhostexGpuiApp;
use gpui::{ScrollDelta, ScrollWheelEvent, TouchPhase, Window};
use std::time::Instant;

#[derive(Default)]
pub(crate) struct SpaceGesture {
    delta: f32,
    locked: bool,
    native_phases: bool,
    last_event: Option<Instant>,
    transition: Option<SpaceTransition>,
}

struct SpaceTransition {
    started: Instant,
    direction: f32,
    destination: Option<String>,
    phase: TransitionPhase,
}

enum TransitionPhase {
    Exit,
    Waiting,
    Enter,
    Boundary,
}

impl SpaceGesture {
    pub(crate) fn presentation(&self) -> (f32, f32) {
        let Some(transition) = &self.transition else {
            return (0.0, 1.0);
        };
        let elapsed = transition.started.elapsed().as_secs_f32();
        match transition.phase {
            TransitionPhase::Exit => {
                let t = bezier((elapsed / 0.085).min(1.0), 0.4, 0.0, 1.0, 1.0);
                (-12.0 * transition.direction * t, 1.0 - t)
            }
            TransitionPhase::Waiting => (0.0, 0.0),
            TransitionPhase::Enter => {
                let t = bezier((elapsed / 0.165).min(1.0), 0.22, 1.0, 0.36, 1.0);
                (16.0 * transition.direction * (1.0 - t), t)
            }
            TransitionPhase::Boundary => {
                let t = bezier((elapsed / 0.15).min(1.0), 0.22, 1.0, 0.36, 1.0);
                let distance = if t < 0.45 { t / 0.45 } else { (1.0 - t) / 0.55 };
                (-5.0 * transition.direction * distance, 1.0)
            }
        }
    }
}

impl GhostexGpuiApp {
    pub(crate) fn handle_native_space_wheel(
        &mut self,
        event: &ScrollWheelEvent,
        window: &mut Window,
        cx: &mut gpui::Context<Self>,
    ) {
        let Some(snapshot) = self
            .native_sidebar
            .snapshot
            .as_ref()
            .filter(|snapshot| snapshot.spaces_enabled)
        else {
            return;
        };
        if event.modifiers.control
            || event.modifiers.shift
            || cx.has_active_drag()
            || self.native_sidebar.menu.is_some()
        {
            return;
        }
        let gesture = &mut self.native_sidebar.space_gesture;
        let now = Instant::now();
        if event.touch_phase == TouchPhase::Started {
            gesture.native_phases = true;
            gesture.delta = 0.0;
            gesture.locked = false;
        } else if !gesture.native_phases
            && gesture
                .last_event
                .is_none_or(|last| now.duration_since(last).as_millis() >= 64)
        {
            gesture.delta = 0.0;
            gesture.locked = false;
        }
        gesture.last_event = Some(now);
        let (x, y) = match event.delta {
            ScrollDelta::Pixels(delta) => (-f32::from(delta.x), -f32::from(delta.y)),
            ScrollDelta::Lines(delta) => (-delta.x * 16.0, -delta.y * 16.0),
        };
        if x.abs() < 2.0 || x.abs() <= y.abs() * 1.25 {
            return;
        }
        window.prevent_default();
        cx.stop_propagation();
        if x.abs() < 6.0 || gesture.locked {
            return;
        }
        if x.signum() != gesture.delta.signum() {
            gesture.delta = 0.0;
        }
        gesture.delta += x;
        if gesture.delta.abs() < 44.0 {
            return;
        }
        gesture.locked = true;
        let direction = gesture.delta.signum();
        let selected = snapshot
            .spaces
            .iter()
            .position(|space| space.selected)
            .unwrap_or(0);
        let destination = if direction > 0.0 {
            snapshot.spaces.get(selected + 1)
        } else {
            selected
                .checked_sub(1)
                .and_then(|index| snapshot.spaces.get(index))
        }
        .map(|space| space.id.clone());
        if self.gpui_pet_overlay_reduce_motion_enabled {
            if let Some(space_id) = destination {
                self.dispatch_native_sidebar_ui(
                    serde_json::json!({"type": "selectSpace", "spaceId": space_id}),
                    cx,
                );
            }
            return;
        }
        let phase = if destination.is_some() {
            TransitionPhase::Exit
        } else {
            TransitionPhase::Boundary
        };
        gesture.transition = Some(SpaceTransition {
            started: now,
            direction,
            destination,
            phase,
        });
        window.request_animation_frame();
        cx.notify();
    }

    pub(crate) fn update_native_space_transition(
        &mut self,
        window: &mut Window,
        cx: &mut gpui::Context<Self>,
    ) {
        let Some(transition) = self.native_sidebar.space_gesture.transition.as_mut() else {
            return;
        };
        let elapsed = transition.started.elapsed().as_secs_f32();
        let mut command = None;
        let mut complete = false;
        match transition.phase {
            TransitionPhase::Exit if elapsed >= 0.085 => {
                command = transition.destination.clone();
                transition.phase = TransitionPhase::Waiting;
            }
            TransitionPhase::Waiting => {
                if self
                    .native_sidebar
                    .snapshot
                    .as_ref()
                    .is_none_or(|snapshot| {
                        !snapshot.spaces_enabled
                            || !snapshot
                                .spaces
                                .iter()
                                .any(|space| Some(&space.id) == transition.destination.as_ref())
                    })
                {
                    complete = true;
                }

                if self
                    .native_sidebar
                    .snapshot
                    .as_ref()
                    .is_some_and(|snapshot| {
                        snapshot.spaces.iter().any(|space| {
                            space.selected && Some(&space.id) == transition.destination.as_ref()
                        })
                    })
                {
                    transition.phase = TransitionPhase::Enter;
                    transition.started = Instant::now();
                }
            }
            TransitionPhase::Enter if elapsed >= 0.165 => complete = true,
            TransitionPhase::Boundary if elapsed >= 0.15 => complete = true,
            _ => {}
        }
        if complete {
            self.native_sidebar.space_gesture.transition = None;
        }
        if let Some(space_id) = command {
            self.dispatch_native_sidebar_ui(
                serde_json::json!({"type": "selectSpace", "spaceId": space_id}),
                cx,
            );
        }
        window.request_animation_frame();
        cx.notify();
    }
}

pub(super) fn bezier(progress: f32, x1: f32, y1: f32, x2: f32, y2: f32) -> f32 {
    let sample = |t: f32, a: f32, b: f32| {
        3.0 * (1.0 - t).powi(2) * t * a + 3.0 * (1.0 - t) * t * t * b + t.powi(3)
    };
    let (mut low, mut high) = (0.0, 1.0);
    for _ in 0..16 {
        let mid = (low + high) / 2.0;
        if sample(mid, x1, x2) < progress {
            low = mid;
        } else {
            high = mid;
        }
    }
    sample((low + high) / 2.0, y1, y2)
}
