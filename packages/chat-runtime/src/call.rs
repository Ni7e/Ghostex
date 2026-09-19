use rquickjs::{Ctx, Function, Object, function::Args};
use serde_json::Value;

pub(crate) fn json(ctx: &Ctx<'_>, namespace: &str, method: &str, arguments: &[Value]) -> rquickjs::Result<()> {
    let object: Object = ctx.globals().get(namespace)?;
    let function: Function = object.get(method)?;
    let mut args = Args::new(ctx.clone(), arguments.len());
    args.this(object)?;
    for value in arguments {
        args.push_arg(ctx.json_parse(value.to_string())?)?;
    }
    function.call_arg(args)
}

/// Call with one argument that is already JSON text.
pub(crate) fn raw(ctx: &Ctx<'_>, namespace: &str, method: &str, raw: &str) -> rquickjs::Result<()> {
    let object: Object = ctx.globals().get(namespace)?;
    let function: Function = object.get(method)?;
    let mut args = Args::new(ctx.clone(), 1);
    args.this(object)?;
    args.push_arg(ctx.json_parse(raw)?)?;
    function.call_arg(args)
}

/// Call a synchronous helper and return its result as JSON.
///
/// CDXC:SessionChat 2026-09-18 WHY:
/// `action` is asynchronous, so a composer that needed the shared rules for the draft it is about
/// to paint would render one frame behind the keystroke. Pure helpers answer in the same call.
pub(crate) fn json_result(
    ctx: &Ctx<'_>,
    namespace: &str,
    method: &str,
    arguments: &[Value],
) -> rquickjs::Result<String> {
    let object: Object = ctx.globals().get(namespace)?;
    let function: Function = object.get(method)?;
    let mut args = Args::new(ctx.clone(), arguments.len());
    args.this(object)?;
    for value in arguments {
        args.push_arg(ctx.json_parse(value.to_string())?)?;
    }
    let result: rquickjs::Value = function.call_arg(args)?;
    let Some(serialized) = ctx.json_stringify(result)? else {
        return Ok("null".to_string());
    };
    Ok(serialized.to_string()?)
}
