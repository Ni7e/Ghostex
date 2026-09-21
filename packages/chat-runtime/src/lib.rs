use anyhow::{Context as _, Result, anyhow};
use rquickjs::{CaughtError, Context, Runtime};
use serde_json::Value;

mod call;
mod network;
mod platform;
mod service;
mod service_worker;
mod storage;
mod storage_import;
mod storage_metadata;
mod storage_records;
pub use service::ServiceRuntime;
pub use storage_metadata::{
    RecordStoreUsage, apply_record_metadata, recompute_record_metadata, scan_record_usage,
};
pub use storage_records::{
    MAX_BACKEND_BYTES, RecordRead, RecordStore, RecordWrite, read_record, storage_bytes,
    write_record,
};
pub use service_worker::ServiceWorker;

pub struct ChatRuntime {
    context: Context,
    runtime: Runtime,
    revision: u64,
}

impl ChatRuntime {
    pub fn new(config: &Value) -> Result<Self> {
        let runtime = Runtime::new().context("create chat runtime")?;
        runtime.set_memory_limit(96 * 1024 * 1024);
        runtime.set_max_stack_size(1024 * 1024);
        let context = Context::full(&runtime).context("create chat context")?;
        context.with(|ctx| platform::install_crypto(&ctx))?;
        let mut engine = Self {
            context,
            runtime,
            revision: 0,
        };
        engine.evaluate(include_str!(concat!(env!("OUT_DIR"), "/chat-runtime.js")))?;
        engine.call("start", &[config.clone()])?;
        Ok(engine)
    }

    fn evaluate(&mut self, source: &str) -> Result<()> {
        self.context.with(|ctx| {
            ctx.eval::<(), _>(source)
                .map_err(|error| anyhow!("Chat runtime: {}", CaughtError::from_error(&ctx, error)))
        })
    }

    pub fn call(&mut self, method: &str, arguments: &[Value]) -> Result<()> {
        self.context.with(|ctx| {
            call::json(&ctx, "nativeChat", method, arguments)
                .map_err(|error| anyhow!("Chat call: {}", CaughtError::from_error(&ctx, error)))
        })?;
        self.jobs()
    }

    /// `call` with a single argument given as JSON text, parsed by the engine's own JSON reader.
    pub fn call_raw(&mut self, method: &str, raw: &str) -> Result<()> {
        self.context.with(|ctx| {
            call::raw(&ctx, "nativeChat", method, raw)
                .map_err(|error| anyhow!("Chat call: {}", CaughtError::from_error(&ctx, error)))
        })?;
        self.jobs()
    }

    fn jobs(&mut self) -> Result<()> {
        while self.runtime.is_job_pending() {
            self.runtime.execute_pending_job().map_err(|error| {
                error.0.with(|ctx| {
                    anyhow!(
                        "Chat job: {}",
                        CaughtError::from_error(&ctx, rquickjs::Error::Exception)
                    )
                })
            })?;
        }
        Ok(())
    }

    /// Run a synchronous helper on the shared controller and decode its JSON result.
    pub fn query(&mut self, method: &str, arguments: &[Value]) -> Result<Value> {
        let serialized = self.context.with(|ctx| {
            call::json_result(&ctx, "nativeChat", method, arguments)
                .map_err(|error| anyhow!("Chat query: {}", CaughtError::from_error(&ctx, error)))
        })?;
        Ok(serde_json::from_str(&serialized)?)
    }

    pub fn drain(&mut self) -> Result<Value> {
        self.call("tick", &[])?;
        let source = format!("nativeChat.take({})", self.revision);
        let serialized = self.context.with(|ctx| {
            ctx.eval::<String, _>(source)
                .map_err(|error| anyhow!("Chat messages: {}", CaughtError::from_error(&ctx, error)))
        })?;
        let value: Value = serde_json::from_str(&serialized)?;
        self.revision = value["revision"].as_u64().unwrap_or(self.revision);
        Ok(value)
    }
}
