use anyhow::{Context as _, Result, anyhow};
use rquickjs::{Context, Runtime, CaughtError};
use serde_json::Value;

mod service;
mod storage;
mod network;
mod platform;
mod storage_import;
mod call;
mod service_worker;
pub use service::ServiceRuntime;
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
        let mut engine = Self { context, runtime, revision: 0 };
        engine.evaluate(include_str!(concat!(env!("OUT_DIR"), "/chat-runtime.js")))?;
        engine.call("start", &[config.clone()])?;
        Ok(engine)
    }

    fn evaluate(&mut self, source: &str) -> Result<()> {
        self.context.with(|ctx| {
            ctx.eval::<(), _>(source).map_err(|error| {
                anyhow!("Chat runtime: {}", CaughtError::from_error(&ctx,error))
            })
        })
    }

    pub fn call(&mut self, method: &str, arguments: &[Value]) -> Result<()> {
        self.context.with(|ctx| call::json(&ctx,"nativeChat",method,arguments)
            .map_err(|error|anyhow!("Chat call: {}",CaughtError::from_error(&ctx,error))))?;
        self.jobs()
    }

    fn jobs(&mut self) -> Result<()> {
        while self.runtime.is_job_pending() {
            self.runtime.execute_pending_job().map_err(|error|error.0.with(|ctx|anyhow!("Chat job: {}",CaughtError::from_error(&ctx,rquickjs::Error::Exception))))?;
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
        let serialized = self.context.with(|ctx| ctx.eval::<String, _>(source).map_err(|error|anyhow!("Chat messages: {}",CaughtError::from_error(&ctx,error))))?;
        let value: Value = serde_json::from_str(&serialized)?;
        self.revision = value["revision"].as_u64().unwrap_or(self.revision);
        Ok(value)
    }
}
