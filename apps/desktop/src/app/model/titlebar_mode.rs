// C1 wave-3 re-cluster: TitlebarMode (Agents/Source/Browser/Kanban/Automate/Manage) plus the mode switcher item and the titlebar Exit Focus control signature, moved verbatim out of the
// types1.rs..types6.rs chunk split (docs/2026-08-22/repo-restructure/SPLITS.md
// C1) into this descriptively named module per its FOLLOW-UPS.md note (pure
// move, no logic changes).

#![allow(unused_imports)]

use crate::*;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) struct ExtensionId(&'static str);

impl ExtensionId {
    pub(crate) fn new(value: &str) -> Option<Self> {
        let value = value.trim();
        if value.is_empty()
            || value != value.to_ascii_lowercase()
            || value.starts_with('-')
            || value.ends_with('-')
            || value
                .bytes()
                .any(|byte| !byte.is_ascii_lowercase() && !byte.is_ascii_digit() && byte != b'-')
            || value.as_bytes().windows(2).any(|pair| pair == b"--")
        {
            return None;
        }

        static IDS: OnceLock<Mutex<HashMap<String, &'static str>>> = OnceLock::new();
        let mut ids = IDS.get_or_init(|| Mutex::new(HashMap::new())).lock().ok()?;
        if let Some(value) = ids.get(value) {
            return Some(Self(value));
        }
        let interned = Box::leak(value.to_string().into_boxed_str());
        ids.insert(interned.to_string(), interned);
        Some(Self(interned))
    }

    pub(crate) fn as_str(self) -> &'static str {
        self.0
    }
}

/// CDXC:Titlebar 2026-09-20 DECISION:
/// User (screen 07): Ask Ghostex, Tips & Tricks and Resources stop being native dropdown panels and
/// become pages you open as a view tab, so they can stay open beside the session you are asking
/// about. They are app-wide rather than project surfaces: every project can open them, they are
/// never hidden by a view scope, and they are drawn by GPUI instead of owning a CEF page.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) enum GhostexPage {
    Ask,
    Tips,
    Resources,
}

impl GhostexPage {
    /// Picker and `+` menu order, and the order the three pages are appended to the view list in.
    pub(crate) const ALL: [Self; 3] = [Self::Ask, Self::Tips, Self::Resources];

    pub(crate) fn slug(self) -> &'static str {
        match self {
            Self::Ask => "ask",
            Self::Tips => "tips",
            Self::Resources => "resources",
        }
    }

    fn from_slug(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|page| page.slug() == value)
    }

    pub(crate) fn label(self) -> &'static str {
        match self {
            Self::Ask => "Ask Ghostex",
            Self::Tips => "Tips & Tricks",
            Self::Resources => "Resources",
        }
    }

    /// One line under the page's name in the view picker.
    pub(crate) fn description(self) -> &'static str {
        match self {
            Self::Ask => "Ask how something works or have it set up for you.",
            Self::Tips => "Short tips for getting more out of Ghostex.",
            Self::Resources => "What Ghostex is running, and what it costs.",
        }
    }

    pub(crate) fn icon(self) -> &'static str {
        match self {
            Self::Ask => TITLEBAR_ICON_HELP,
            Self::Tips => TITLEBAR_ICON_INFO,
            Self::Resources => TITLEBAR_ICON_DEVICE_DESKTOP,
        }
    }

    /// The Settings switch that turns the page off. These are the keys the titlebar buttons used,
    /// kept so the existing Settings rows keep meaning what they say.
    pub(crate) fn hidden_settings_key(self) -> &'static str {
        match self {
            Self::Ask => HELP_TITLEBAR_BUTTON_HIDDEN_SETTINGS_KEY,
            Self::Tips => TIPS_TITLEBAR_BUTTON_HIDDEN_SETTINGS_KEY,
            Self::Resources => RESOURCES_TITLEBAR_BUTTON_HIDDEN_SETTINGS_KEY,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) enum TitlebarMode {
    Agents,
    Source,
    Browser,
    Kanban,
    Automate,
    Manage,
    Extension(ExtensionId),
    Ghostex(GhostexPage),
}

impl TitlebarMode {
    pub(crate) fn from_slug(value: &str) -> Option<Self> {
        match value {
            "agents" => Some(Self::Agents),
            "source" => Some(Self::Source),
            "browser" => Some(Self::Browser),
            "kanban" => Some(Self::Kanban),
            "automate" => Some(Self::Automate),
            "manage" => Some(Self::Manage),
            value if value.starts_with("extension:") => {
                ExtensionId::new(value.trim_start_matches("extension:")).map(Self::Extension)
            }
            value if value.starts_with("ghostex:") => {
                GhostexPage::from_slug(value.trim_start_matches("ghostex:")).map(Self::Ghostex)
            }
            _ => None,
        }
    }

    pub(crate) fn element_slug(self) -> String {
        match self {
            Self::Agents => "agents".to_string(),
            Self::Source => "source".to_string(),
            Self::Browser => "browser".to_string(),
            Self::Kanban => "kanban".to_string(),
            Self::Automate => "automate".to_string(),
            Self::Manage => "manage".to_string(),
            Self::Extension(id) => format!("extension:{}", id.as_str()),
            Self::Ghostex(page) => format!("ghostex:{}", page.slug()),
        }
    }

    pub(crate) fn display_label(self) -> &'static str {
        match self {
            Self::Agents => "Agents",
            Self::Source => "Code",
            Self::Browser => "Browser",
            Self::Kanban => "Kanban",
            Self::Automate => "Automate",
            Self::Manage => "Docs",
            Self::Extension(id) => id.as_str(),
            Self::Ghostex(page) => page.label(),
        }
    }

    /// The glyph the view panel's tab strip and the `+` menu draw beside a view's name. Extension
    /// and custom views share the puzzle glyph because their manifests carry no icon.
    pub(crate) fn tab_icon(self) -> &'static str {
        match self {
            Self::Agents => TITLEBAR_ICON_LAYOUT_COLUMNS,
            Self::Source => TITLEBAR_ICON_CODE,
            Self::Browser => TITLEBAR_ICON_WORLD,
            Self::Kanban => TITLEBAR_ICON_LAYOUT_BOARD_SPLIT,
            Self::Automate => TITLEBAR_ICON_BOLT,
            Self::Manage => TITLEBAR_ICON_FILE_TEXT,
            Self::Extension(_) => TITLEBAR_ICON_EXTENSIONS,
            Self::Ghostex(page) => page.icon(),
        }
    }

    /// The label a tab, a `+` row or a menu row shows for this view, resolving an extension or custom
    /// view's own title.
    pub(crate) fn tab_label(self) -> String {
        match self {
            Self::Extension(id) => gpui_extension_view_presentation(id)
                .map(|presentation| presentation.title)
                .unwrap_or_else(|| id.as_str().to_string()),
            mode => mode.display_label().to_string(),
        }
    }

    pub(crate) fn is_project_editor_mode(self) -> bool {
        matches!(
            self,
            Self::Source
                | Self::Browser
                | Self::Kanban
                | Self::Automate
                | Self::Manage
                | Self::Extension(_)
        )
    }

    pub(crate) fn project_editor_order(self) -> u64 {
        match self {
            Self::Source => 0,
            Self::Browser => 1,
            Self::Kanban => 2,
            Self::Automate => 3,
            Self::Manage => 4,
            Self::Extension(_) => 5,
            Self::Ghostex(_) => 6,
            Self::Agents => 7,
        }
    }

    pub(crate) fn switcher_index(self) -> u64 {
        match self {
            Self::Agents => 0,
            Self::Source => 1,
            Self::Browser => 2,
            Self::Kanban => 3,
            Self::Automate => 4,
            Self::Manage => 5,
            Self::Ghostex(GhostexPage::Ask) => 6,
            Self::Ghostex(GhostexPage::Tips) => 7,
            Self::Ghostex(GhostexPage::Resources) => 8,
            Self::Extension(id) => {
                id.as_str()
                    .bytes()
                    .fold(0xcbf29ce484222325_u64, |hash, byte| {
                        (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3)
                    })
                    | (1_u64 << 63)
            }
        }
    }

    pub(crate) fn placeholder_message(self) -> &'static str {
        match self {
            Self::Agents => "",
            // CDXC:Workarea 2026-09-15 DECISION:
            // User: Source must not flash an unavailable-project-context message during startup.
            // This default also covers pending project/runtime restoration; concrete launch states supply their own progress and error messages.
            Self::Source => "",
            Self::Browser => "",
            Self::Kanban => "Kanban is unavailable for the current project context.",
            Self::Automate => "Automate is unavailable for the current project context.",
            Self::Manage => "Docs is unavailable for the current project context.",
            Self::Extension(_) => "This extension is unavailable for the current project context.",
            // A Ghostex page is app-wide, so it is never unavailable.
            Self::Ghostex(_) => "",
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct TitlebarModeSwitcherItem {
    pub(crate) mode: TitlebarMode,
    pub(crate) is_available: bool,
    pub(crate) disabled_reason: Option<&'static str>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct GpuiTitlebarExitFocusControlSignature {
    pub(crate) label: &'static str,
    pub(crate) styled_as_active_mode_tab: bool,
    pub(crate) clears_agents_focus_mode: bool,
}

pub(crate) fn gpui_titlebar_exit_focus_control_signature(
    agents_focus_mode_active: bool,
) -> Option<GpuiTitlebarExitFocusControlSignature> {
    /*
    CDXC:FocusRouting 2026-06-27-02:05:
    The titlebar Exit Focus affordance is visible only while the Agents workspace is in pane Focus mode, and it must reuse active mode-tab chrome instead of a separate outlined or icon-button skin. Activating it clears Agents focus mode through the workspace model without changing command-pane focus mode, project-editor focus, terminal content, paths, commands, or renderer state.
    */
    agents_focus_mode_active.then_some(GpuiTitlebarExitFocusControlSignature {
        label: "Exit focus",
        styled_as_active_mode_tab: true,
        clears_agents_focus_mode: true,
    })
}
