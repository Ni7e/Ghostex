//! The QuickJS host for the desktop's app runtime (`apps/desktop/sidebar/service/`, evaluated by
//! [`ServiceRuntime`]) and the client-storage records it shares with the Rust store. The chat's own
//! QuickJS runtime was deleted on 2026-09-25: the desktop chat runs on `packages/gx-chat-core`.

mod call;
mod network;
mod platform;
mod service;
mod service_worker;
mod storage;
mod storage_catalog;
mod storage_import;
mod storage_import_docs;
mod storage_init;
mod storage_metadata;
mod storage_records;
pub use service::ServiceRuntime;
pub use service_worker::ServiceWorker;
pub use storage_catalog::{CATALOG, CatalogBackend, CatalogStore, definition_for_key};
pub use storage_import_docs::import_docs_browser_state;
pub use storage_init::{StorageInitReport, initialize_client_storage};
pub use storage_metadata::{
    RecordStoreUsage, apply_record_metadata, recompute_record_metadata, scan_record_usage,
};
pub use storage_records::{
    MAX_BACKEND_BYTES, RecordRead, RecordStore, RecordWrite, read_record, storage_bytes,
    write_record,
};
