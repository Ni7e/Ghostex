pub(crate) mod native_modal_kit;
pub(crate) mod popup_frame;

/// AppKit child-window attachment on the desktop. The web platform's windows are canvases of one page, which the platform itself stacks.
pub(crate) fn attach_gpui_app_modal_window_to_main_window(
    _window: &mut gpui::Window,
    _main_window_native_view: *mut std::ffi::c_void,
) {
}
#[allow(dead_code, unused_imports)]
pub(crate) mod space_editor_modal {
    use crate::*;
    include!(concat!(env!("OUT_DIR"), "/space_editor_modal.rs"));
}

/// The desktop's frosted menu and tooltip windows need the macOS window backend's blur; a page keeps its menus and tooltips in the canvas, which is what the desktop does with glass off.
#[allow(dead_code)]
pub(crate) mod frosted_host {
    use std::rc::Rc;

    use gpui::{AnyElement, AnyWindowHandle, App, Bounds, EntityId, Pixels, Window};

    pub(crate) type FrostedContent = Rc<dyn Fn(&mut Window, &mut App) -> AnyElement>;

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub(crate) enum FrostedHostKind {
        Tooltip,
        SidebarMenu,
    }

    pub(crate) fn frosted_hosting_active() -> bool {
        false
    }

    pub(crate) fn show_frosted_host(
        _kind: FrostedHostKind,
        _parent: AnyWindowHandle,
        _frame: Bounds<Pixels>,
        _key: Option<EntityId>,
        _content: FrostedContent,
        _observe: Option<gpui::Entity<crate::GhostexGpuiApp>>,
        _cx: &mut App,
    ) {
    }

    pub(crate) fn hide_frosted_host(_kind: FrostedHostKind, _cx: &mut App) {}
}
