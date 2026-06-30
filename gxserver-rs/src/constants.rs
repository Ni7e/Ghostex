pub const GXSERVER_PRODUCT: &str = "gxserver";
pub const GXSERVER_PROTOCOL_VERSION: u64 = 1;
pub const GXSERVER_PROTOCOL_HEADER: &str = "x-gxserver-protocol-version";
pub const GXSERVER_LOCAL_API_HOST: &str = "127.0.0.1";
pub const GXSERVER_LOCAL_API_PORT: u16 = 58744;
pub const GXSERVER_DEV_LOCAL_API_PORT_ENV: &str = "GHOSTEX_GXSERVER_DEV_PORT";
pub const GXSERVER_REMOTE_API_HOST: &str = "0.0.0.0";
pub const GXSERVER_REMOTE_API_PORT: u16 = 58745;
pub const GXSERVER_JSON_BODY_LIMIT_BYTES: usize = 1024 * 1024;
pub const GXSERVER_VERSION: &str = env!("CARGO_PKG_VERSION");

pub const GXSERVER_CAPABILITIES: &[&str] = &[
    "health",
    "events",
    "localFullApi",
    "remoteLimitedApi",
    "strictProtocolVersion",
];

pub const GXSERVER_MIGRATION_IDS: &[&str] = &[
    "0001_foundation",
    "0002_domain_state",
    "0003_session_sidebar_order",
    "0004_previous_session_history_quality",
    "0005_session_tags",
    "0006_expand_session_tags",
    "0007_expand_session_tags_in_progress_and_type",
    "0008_remove_retired_session_type_tags",
    "0009_remove_legacy_zmux_chat_projects",
    "0010_portless_persistence_model",
    "0011_t3_session_kind",
    "0012_recent_projects",
    "0013_app_user_data",
    "0014_automations",
    "0015_project_visibility",
];
