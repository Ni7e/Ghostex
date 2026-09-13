use super::{
    client, daemon,
    protocol::{read_frame, Launch},
};
use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::io::{BufReader, Read, Write};

pub(crate) fn run() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let verb = args.first().map(String::as_str).unwrap_or("");
    let argument = |index: usize| {
        args.get(index)
            .map(String::as_str)
            .context("Missing session argument")
    };
    match verb {
        "serve-encoded" => daemon::run(serde_json::from_slice(&STANDARD.decode(argument(1)?)?)?),
        "serve" => daemon::run(read_frame(&mut BufReader::new(std::io::stdin().lock()))?),
        "start-encoded" => client::start(serde_json::from_slice(&STANDARD.decode(argument(1)?)?)?),
        "start" => client::start(read_frame::<Launch>(&mut BufReader::new(
            std::io::stdin().lock(),
        ))?),
        "list" => {
            for endpoint in client::list()? {
                if args.iter().any(|arg| arg == "--short") {
                    println!("{}", endpoint.name);
                } else {
                    println!(
                        "{}",
                        json!({"name": endpoint.name, "pid": endpoint.pid, "shellPid": endpoint.shell_pid})
                    );
                }
            }
            Ok(())
        }
        "process-snapshot" => super::process_snapshot::print(),
        "exists" => {
            client::request(argument(1)?, "ping", Value::Null)?;
            Ok(())
        }
        "attach" => client::attach(argument(1)?),
        "watch-title" => client::watch_title(argument(1)?),
        "kill" => {
            client::request(argument(1)?, "kill", Value::Null)?;
            Ok(())
        }
        "send" => {
            let mut bytes = Vec::new();
            std::io::stdin().take(1024 * 1024).read_to_end(&mut bytes)?;
            client::request(argument(1)?, "input", json!(STANDARD.encode(bytes)))?;
            Ok(())
        }
        "history" => {
            let vt = args.iter().any(|arg| arg == "--vt");
            let scrollback = args
                .iter()
                .position(|arg| arg == "--scrollback")
                .and_then(|index| args.get(index + 1))
                .map(|value| value.parse::<u32>())
                .transpose()?
                .unwrap_or(10_000);
            let reply = client::request(
                argument(1)?,
                "history",
                json!({"vt": vt, "scrollback": scrollback}),
            )?;
            if vt {
                std::io::stdout().write_all(
                    &STANDARD.decode(
                        reply["output"]
                            .as_str()
                            .context("Missing terminal snapshot")?,
                    )?,
                )?;
            } else {
                print!(
                    "{}",
                    reply["text"].as_str().context("Missing terminal text")?
                );
            }
            Ok(())
        }
        "grid" => {
            println!("{}", client::request(argument(1)?, "grid", Value::Null)?);
            Ok(())
        }
        "resize" => {
            client::request(
                argument(1)?,
                "resize",
                json!({"rows": argument(2)?.parse::<u16>()?, "cols": argument(3)?.parse::<u16>()?}),
            )?;
            Ok(())
        }
        _ => bail!("Expected start, attach, list, exists, send, history, grid, resize, or kill"),
    }
}
