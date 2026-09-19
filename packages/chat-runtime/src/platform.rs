use super::storage::Storage;
use anyhow::{Result, anyhow, bail};
use base64::Engine;
use serde_json::{Value, json};

fn random_uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub(crate) fn install_crypto(ctx: &rquickjs::Ctx<'_>) -> rquickjs::Result<()> {
    let crypto = rquickjs::Object::new(ctx.clone())?;
    crypto.set(
        "randomUUID",
        rquickjs::Function::new(ctx.clone(), random_uuid)?,
    )?;
    ctx.globals().set("crypto", crypto)
}

pub(crate) fn call(storage: &mut Storage, request: Value) -> Result<Value> {
    let operation = request["operation"]
        .as_str()
        .ok_or_else(|| anyhow!("Missing native operation"))?;
    let value = request["value"].as_str().unwrap_or_default();
    match operation {
        "platform" => Ok(json!(std::env::consts::OS)),
        "uuid" => Ok(json!(random_uuid())),
        "encode" => Ok(json!(value.as_bytes())),
        "decode" => Ok(json!(String::from_utf8_lossy(
            &request["value"]
                .as_array()
                .ok_or_else(|| anyhow!("Expected bytes"))?
                .iter()
                .map(|v| v.as_u64().unwrap_or(0) as u8)
                .collect::<Vec<_>>()
        ))),
        "base64Encode" => Ok(json!(
            base64::engine::general_purpose::STANDARD
                .encode(value.chars().map(|c| c as u8).collect::<Vec<_>>())
        )),
        "base64Decode" => Ok(json!(
            base64::engine::general_purpose::STANDARD
                .decode(value)?
                .iter()
                .map(|b| *b as char)
                .collect::<String>()
        )),
        "queryParse" => Ok(json!(
            url::form_urlencoded::parse(value.trim_start_matches('?').as_bytes())
                .collect::<Vec<_>>()
        )),
        "querySerialize" => {
            let mut serializer = url::form_urlencoded::Serializer::new(String::new());
            for pair in request["pairs"]
                .as_array()
                .ok_or_else(|| anyhow!("Expected query pairs"))?
            {
                serializer.append_pair(
                    pair[0].as_str().unwrap_or_default(),
                    pair[1].as_str().unwrap_or_default(),
                );
            }
            Ok(json!(serializer.finish()))
        }
        "url" => {
            let mut url = if let Some(base) = request["base"].as_str() {
                url::Url::parse(base)?.join(value)?
            } else {
                url::Url::parse(value)?
            };
            let replacement = request["replacement"].as_str().unwrap_or_default();
            match request["key"].as_str() {
                Some("protocol") => url
                    .set_scheme(replacement.trim_end_matches(':'))
                    .map_err(|_| anyhow!("Invalid URL scheme"))?,
                Some("pathname") => url.set_path(replacement),
                Some("search") => url.set_query(
                    (!replacement.is_empty()).then_some(replacement.trim_start_matches('?')),
                ),
                Some(_) => bail!("Unsupported URL field"),
                None => {}
            }
            Ok(
                json!({"href": url.as_str(), "origin": url.origin().ascii_serialization(), "protocol": format!("{}:",url.scheme()), "hostname": url.host_str().unwrap_or_default(), "host": &url[url::Position::BeforeHost..url::Position::AfterPort], "port": url.port().map(|p|p.to_string()).unwrap_or_default(), "pathname": url.path(), "search": url.query().map(|q|format!("?{q}")).unwrap_or_default(), "hash": url.fragment().map(|f|format!("#{f}")).unwrap_or_default()}),
            )
        }
        _ => storage.call(operation, &request),
    }
}
