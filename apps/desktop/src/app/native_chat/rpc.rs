use crate::app::{helpers::*, model::*};
use serde_json::{Value, json};
use std::time::Duration;

pub(super) fn request(
    remote: Option<GpuiRemoteGxserverRequestTarget>,
    endpoint: &str,
    params: &Value,
) -> Result<Value, Value> {
    let response = match remote {
        Some(target) => gpui_remote_gxserver_post_typed_operation(
            &target,
            endpoint,
            params,
            Duration::from_secs(60),
        ),
        None => gxserver_post_typed_operation(endpoint, params, Duration::from_secs(60)),
    }
    .map_err(|message| json!({"message":message,"endpoint":endpoint}))?;
    let (status, body) = response;
    let mut envelope: Value = serde_json::from_str(&body)
        .map_err(|_| json!({"message":"gxserver returned invalid JSON.","endpoint":endpoint}))?;
    if envelope["ok"] == false {
        return Err(
            json!({"code":envelope["error"],"message":envelope["message"],"endpoint":endpoint}),
        );
    }
    if !(200..300).contains(&status) || envelope["ok"] != true {
        return Err(
            json!({"message":format!("gxserver request failed with HTTP {status}."),"endpoint":endpoint}),
        );
    }
    Ok(envelope["result"].take())
}
