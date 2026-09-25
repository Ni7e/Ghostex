use rquickjs::{Ctx, Function, Object, function::Args};
use serde_json::Value;

pub(crate) fn json(
    ctx: &Ctx<'_>,
    namespace: &str,
    method: &str,
    arguments: &[Value],
) -> rquickjs::Result<()> {
    let object: Object = ctx.globals().get(namespace)?;
    let function: Function = object.get(method)?;
    let mut args = Args::new(ctx.clone(), arguments.len());
    args.this(object)?;
    for value in arguments {
        args.push_arg(ctx.json_parse(value.to_string())?)?;
    }
    function.call_arg(args)
}
