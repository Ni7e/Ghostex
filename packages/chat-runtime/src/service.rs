use super::{network::Network, platform, storage::Storage};
use anyhow::{Result, anyhow};
use rquickjs::{CaughtError, Context, Function, Promise, Runtime};
use serde_json::{Value, json};
use std::{
    cell::RefCell,
    path::Path,
    rc::Rc,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

pub struct ServiceRuntime {
    context: Context,
    runtime: Runtime,
    network: Rc<RefCell<Network>>,
}
impl ServiceRuntime {
    /// `trace` arms the `native.runtime.trace` records (`network::trace_record`); the desktop
    /// flips it when the diagnostic scenario changes.
    pub fn new(
        config: &Value,
        database: &Path,
        trace: Arc<AtomicBool>,
        post: impl Fn(Value) + 'static,
    ) -> Result<Self> {
        let runtime = Runtime::new()?;
        runtime.set_memory_limit(256 * 1024 * 1024);
        runtime.set_max_stack_size(2 * 1024 * 1024);
        let context = Context::full(&runtime)?;
        // The tables, the browser-era import and the migrations ran at app start
        // (`initialize_client_storage`), before this runtime was started.
        let storage = Rc::new(RefCell::new(Storage::open(database)?));
        let network = Rc::new(RefCell::new(Network::new()));
        let post_network = network.clone();
        context.with(|ctx| -> rquickjs::Result<()> {
            ctx.globals().set(
                "ghostexNativeCall",
                Function::new(ctx.clone(), move |request: String| -> String {
                    let result = serde_json::from_str(&request)
                        .map_err(Into::into)
                        .and_then(|value| platform::call(&mut storage.borrow_mut(), value));
                    match result {
                        Ok(result) => json!({"result":result}),
                        Err(error) => json!({"error":error.to_string()}),
                    }
                    .to_string()
                })?,
            )?;
            ctx.globals().set(
                "ghostexNativePost",
                Function::new(
                    ctx.clone(),
                    move |message: String| -> rquickjs::Result<()> {
                        let message = serde_json::from_str(&message).map_err(|_| {
                            rquickjs::Error::new_from_js("string", "native message")
                        })?;
                        // CDXC:StateSync 2026-09-17 WHY: A ready focus message must reach GPUI before unrelated network callbacks, timer work, or later JavaScript jobs finish. Emitting in bridge-call order also keeps project and wake prerequisites ahead of their dependent focus message.
                        if trace.load(Ordering::Relaxed) {
                            if let Some(record) = super::network::trace_record(&message) {
                                post(record);
                            }
                        }
                        if !post_network.borrow_mut().dispatch(&message) {
                            post(message);
                        }
                        Ok(())
                    },
                )?,
            )?;
            Ok(())
        })?;
        let mut service = Self {
            context,
            runtime,
            network,
        };
        service.evaluate(include_str!(concat!(
            env!("OUT_DIR"),
            "/service-runtime.js"
        )))?;
        service.context.with(|ctx| {
            ctx.eval::<Promise, _>(format!("nativeService.start({config})"))
                .and_then(|promise| promise.finish::<()>())
                .map_err(|error| {
                    anyhow!(
                        "Native service startup: {}",
                        CaughtError::from_error(&ctx, error)
                    )
                })
        })?;
        Ok(service)
    }
    pub fn evaluate(&mut self, source: &str) -> Result<()> {
        self.context.with(|ctx| {
            ctx.eval::<(), _>(source).map_err(|error| {
                anyhow!("Native service: {}", CaughtError::from_error(&ctx, error))
            })
        })?;
        self.jobs()
    }
    fn jobs(&mut self) -> Result<()> {
        while self.runtime.is_job_pending() {
            self.runtime.execute_pending_job().map_err(|error| {
                error.0.with(|ctx| {
                    anyhow!(
                        "Native service job: {}",
                        CaughtError::from_error(&ctx, rquickjs::Error::Exception)
                    )
                })
            })?;
        }
        Ok(())
    }
    pub fn poll_network(&mut self) -> Result<bool> {
        let message = self.network.borrow_mut().receiver.try_recv().ok();
        let Some(message) = message else {
            return Ok(false);
        };
        self.network.borrow_mut().completed(&message);
        self.context.with(|ctx| {
            super::call::json(&ctx, "nativeService", "receive", &[message]).map_err(|error| {
                anyhow!(
                    "Native service network: {}",
                    CaughtError::from_error(&ctx, error)
                )
            })
        })?;
        self.jobs()?;
        Ok(true)
    }

    /// CDXC:Sidebar 2026-09-18 WHY:
    /// The 16ms timer tick used to evaluate source text, so QuickJS parsed and compiled it about sixty times a second on the service thread (a steady 14% of a core in a sample). Call the installed function instead.
    pub fn tick(&mut self) -> Result<()> {
        self.context.with(|ctx| {
            ctx.globals()
                .get::<_, rquickjs::Object>("nativeService")
                .and_then(|service| service.get::<_, Function>("tick"))
                .and_then(|tick| tick.call::<_, ()>(()))
                .map_err(|error| {
                    anyhow!(
                        "Native service tick: {}",
                        CaughtError::from_error(&ctx, error)
                    )
                })
        })?;
        self.jobs()
    }
}
