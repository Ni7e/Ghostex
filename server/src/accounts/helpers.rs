use super::model::*;
use serde_json::Value;
use std::{
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

pub(crate) fn executable(home: &Path, name: &str) -> Option<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    dirs.extend([home.join(".local/bin"), home.join(".cargo/bin")]);
    // CDXC:AgentProviders 2026-09-06 WHY:
    // A GUI or systemd launch may omit Homebrew from PATH even after the account helper is installed.
    #[cfg(target_os = "macos")]
    dirs.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ]);
    #[cfg(target_os = "linux")]
    dirs.extend([
        home.join(".linuxbrew/bin"),
        PathBuf::from("/home/linuxbrew/.linuxbrew/bin"),
    ]);
    dirs.into_iter().map(|dir| dir.join(name)).find(|p| {
        p.metadata().is_ok_and(|m| {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                m.is_file() && m.permissions().mode() & 0o111 != 0
            }
            #[cfg(not(unix))]
            {
                m.is_file()
            }
        })
    })
}
pub(crate) fn json_command(home: &Path, name: &str, args: &[&str]) -> Result<Value, String> {
    let binary =
        executable(home, name).ok_or_else(|| format!("Install {name} on this computer first."))?;
    let mut child = Command::new(binary)
        .args(args)
        .env("HOME", home)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .stdin(Stdio::null())
        .spawn()
        .map_err(|_| format!("Could not start {name}."))?;
    let stdout = child
        .stdout
        .take()
        .ok_or("Account helper output is unavailable.")?;
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout
            .take(2 * 1024 * 1024)
            .read_to_end(&mut bytes)
            .map(|_| bytes)
    });
    let deadline = Instant::now() + Duration::from_secs(45);
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break Ok(s),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(50)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break Err(format!(
                    "{name} did not finish reading accounts. Try refreshing."
                ));
            }
        }
    }?;
    if !status.success() {
        return Err(format!(
            "{name} could not read accounts. Run {name} list in a terminal for details."
        ));
    }
    let bytes = reader
        .join()
        .map_err(|_| "Account helper output failed.")?
        .map_err(|_| "Account helper output could not be read.")?;
    let data: Value = serde_json::from_slice(&bytes)
        .map_err(|_| format!("{name} did not return valid JSON. Update the helper."))?;
    if data.get("schemaVersion").and_then(Value::as_u64) != Some(1) {
        return Err(format!(
            "Update {name}; its account interface is unsupported."
        ));
    }
    Ok(data)
}
fn text(v: &Value, k: &str) -> String {
    v.get(k)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}
fn window(
    id: &str,
    label: &str,
    value: &Value,
    pct: &str,
    model: Option<String>,
) -> Option<UsageWindow> {
    let used = value.get(pct)?.as_f64()?;
    if !used.is_finite() {
        return None;
    }
    Some(UsageWindow {
        id: id.into(),
        label: label.into(),
        used_percent: used.clamp(0., 100.),
        limit_window_seconds: None,
        resets_at: value
            .get("resetsAt")
            .and_then(Value::as_str)
            .map(str::to_string),
        model,
    })
}
/// The user-facing line for a cswap `usageStatus` other than `ok`. `has_last_good` says whether the row still carries an older reading to show, and `last_good_age` is that reading's age in seconds when cswap reports it.
fn claude_usage_notice(
    status: &str,
    has_last_good: bool,
    last_good_age: Option<f64>,
) -> Option<String> {
    Some(match status {
        "ok" => return None,
        "unavailable" => match (has_last_good, last_good_age) {
            (true, Some(age)) => format!(
                "Usage is from {} ago. Refreshing has failed since then; Ghostex keeps trying.",
                age_text(age)
            ),
            (true, None) => {
                "Usage could not be refreshed. Showing the last reading; Ghostex keeps trying."
                    .into()
            }
            (false, _) => "Usage could not be read yet. Ghostex keeps trying.".into(),
        },
        "token_expired" => "The saved login expired. Reconnect this account.".into(),
        "relogin_required" => "This account needs to sign in again. Reconnect it.".into(),
        "no_credentials" => "No saved login was found for this account. Reconnect it.".into(),
        "foreign_credential" => {
            "The saved login belongs to a different account. Reconnect this account.".into()
        }
        "api_key" => "This login uses an API key, so it has no subscription usage limits.".into(),
        "keychain_unavailable" => {
            "The saved login could not be read from the Keychain. Unlock it and refresh.".into()
        }
        other => format!("Usage could not be read (helper status: {other}). Ghostex keeps trying."),
    })
}
fn age_text(seconds: f64) -> String {
    let unit = |count: i64, name: &str| {
        if count == 1 {
            format!("1 {name}")
        } else {
            format!("{count} {name}s")
        }
    };
    let minutes = (seconds.max(0.) / 60.).round() as i64;
    if minutes < 1 {
        "under a minute".into()
    } else if minutes < 60 {
        unit(minutes, "minute")
    } else if minutes < 24 * 60 {
        unit(minutes / 60, "hour")
    } else {
        unit(minutes / (24 * 60), "day")
    }
}
/// CDXC:AgentProviders 2026-09-05 DECISION:
/// cswap owns Claude credentials and selected-account launches; gxserver schedules usage reads and decides when sessions switch. xswap supplies Codex account homes and launches.
pub(crate) fn discover(home: &Path, provider: Provider) -> Result<Vec<DiscoveredAccount>, String> {
    let data = json_command(home, provider.helper(), &["list", "--json"])?;
    let rows = data
        .get("accounts")
        .and_then(Value::as_array)
        .ok_or("The helper account list is missing.")?;
    let mut accounts = Vec::new();
    for row in rows {
        let Some(number) = row.get("number").and_then(Value::as_u64) else {
            continue;
        };
        let email = text(row, "email");
        let alias = text(row, "alias");
        let mut account = DiscoveredAccount {
            provider,
            selector: number.to_string(),
            identity: String::new(),
            name: if alias.is_empty() {
                email.clone()
            } else {
                alias
            },
            email: email.clone(),
            status: "ready".into(),
            shared_history: false,
            usage: vec![],
            reset_credits: None,
            reset_credit_details: None,
            reset_credits_error: None,
            usage_updated_at: None,
            usage_error: None,
        };
        if provider == Provider::Claude {
            account.identity =
                format!("{}:{}", email.to_lowercase(), text(row, "organizationUuid"));
            if email.is_empty() {
                account.status = "loginRequired".into();
            }
            let status = text(row, "usageStatus");
            if matches!(
                status.as_str(),
                "relogin_required" | "no_credentials" | "token_expired"
            ) {
                account.status = "loginRequired".into();
            }
            if status == "foreign_credential" {
                account.status = "identityChanged".into();
            }
            // CDXC:AgentProviders 2026-09-18 WHY:
            // cswap reports `unavailable` with a null `usage` once its last reading is too old to drive a switch, usually because the Anthropic usage endpoint answers 429 with a one-hour retry. Its documented `lastGoodUsage` fields keep that reading for display, so Ghostex shows those bars with their age instead of the bare status code. `usage_error` stays set, and every switch decision (`default_account.rs`, `has_room` in `recovery.rs`) requires it to be absent, so a stale reading never counts as headroom.
            let (usage, fetched_at, last_good_age) = if row["usage"].is_object() {
                (&row["usage"], &row["usageFetchedAt"], None)
            } else {
                (
                    &row["lastGoodUsage"],
                    &row["lastGoodFetchedAt"],
                    row.get("lastGoodAgeSeconds").and_then(Value::as_f64),
                )
            };
            account.usage_error = claude_usage_notice(&status, usage.is_object(), last_good_age);
            if let Some(w) = window(
                "fiveHour",
                "Five-hour limit",
                &usage["fiveHour"],
                "pct",
                None,
            ) {
                account.usage.push(w);
            }
            if let Some(w) = window("sevenDay", "Weekly limit", &usage["sevenDay"], "pct", None) {
                account.usage.push(w);
            }
            if let Some(scoped) = usage.get("scoped").and_then(Value::as_array) {
                for item in scoped {
                    let model = text(item, "name");
                    if let Some(w) = window(
                        &model,
                        &format!("{model} weekly"),
                        item,
                        "pct",
                        Some(model.clone()),
                    ) {
                        account.usage.push(w);
                    }
                }
            }
            if let Some(w) = window("spend", "Extra usage", &usage["spend"], "pct", None) {
                account.usage.push(w);
            }
            account.usage_updated_at = fetched_at.as_str().map(str::to_string);
        } else {
            account.identity = text(row, "accountId");
            account.status = match text(row, "loginStatus").as_str() {
                "present" => "ready",
                "identity_changed" => "identityChanged",
                _ => "loginRequired",
            }
            .into();
            account.shared_history = row.get("shareHistory").and_then(Value::as_bool) == Some(true);
            if account.status == "ready" {
                match codex_usage(row) {
                    Ok((usage, reset_credits)) => {
                        account.usage = usage;
                        account.reset_credits = reset_credits;
                        account.usage_updated_at = Some(chrono::Utc::now().to_rfc3339());
                        match super::reset_credits::read(row) {
                            Ok(credits) => {
                                account.reset_credits = Some(credits.len() as u64);
                                account.reset_credit_details = Some(credits);
                            }
                            Err(error) => account.reset_credits_error = Some(error),
                        }
                    }
                    Err(e) => account.usage_error = Some(e),
                }
            }
        }
        accounts.push(account);
    }
    Ok(accounts)
}
pub(crate) fn codex_get(row: &Value, path: &str) -> Result<Value, String> {
    let home = PathBuf::from(text(row, "home"));
    if !home.is_absolute() {
        return Err("Invalid Codex account home.".into());
    }
    let raw = std::fs::read(home.join("auth.json")).map_err(|_| "Sign in again to read usage.")?;
    let auth: Value =
        serde_json::from_slice(&raw).map_err(|_| "Codex credentials are unreadable.")?;
    let expected = text(row, "accountId");
    if auth.pointer("/tokens/account_id").and_then(Value::as_str) != Some(expected.as_str()) {
        return Err("This account's login identity changed. Reconnect it.".into());
    }
    let token = auth
        .pointer("/tokens/access_token")
        .and_then(Value::as_str)
        .ok_or("Sign in again to read usage.")?;
    let response = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(12))
        .build()
        .get(&format!("https://chatgpt.com/backend-api/wham/{path}"))
        .set("Authorization", &format!("Bearer {token}"))
        .set("ChatGPT-Account-Id", &expected)
        .set("Accept", "application/json")
        .set("OpenAI-Beta", "codex-1")
        .set("originator", "Codex Desktop")
        .call();
    let response = match response {
        Ok(r) => r,
        Err(ureq::Error::Status(401, _)) => {
            return Err("Sign in again to refresh account usage.".into())
        }
        Err(ureq::Error::Status(429, _)) => {
            return Err("Usage requests are temporarily limited. Ghostex will try again.".into())
        }
        Err(_) => return Err("Usage could not be refreshed. Ghostex will try again.".into()),
    };
    response
        .into_json()
        .map_err(|_| "The usage service returned an invalid response.".to_string())
}
fn codex_usage(row: &Value) -> Result<(Vec<UsageWindow>, Option<u64>), String> {
    let value = codex_get(row, "usage")?;
    let mut windows = Vec::new();
    codex_windows(&mut windows, "", &value["rate_limit"]);
    if let Some(extras) = value
        .get("additional_rate_limits")
        .and_then(Value::as_array)
    {
        for extra in extras {
            codex_windows(
                &mut windows,
                &text(extra, "limit_name"),
                &extra["rate_limit"],
            );
        }
    }
    if windows.is_empty() {
        return Err("No usage windows were returned for this account.".into());
    }
    let reset_credits = value
        .pointer("/rate_limit_reset_credits/available_count")
        .and_then(Value::as_u64);
    Ok((windows, reset_credits))
}
fn codex_windows(out: &mut Vec<UsageWindow>, model: &str, value: &Value) {
    for key in ["primary_window", "secondary_window"] {
        let v = &value[key];
        let Some(used) = v.get("used_percent").and_then(Value::as_f64) else {
            continue;
        };
        let seconds = v
            .get("limit_window_seconds")
            .and_then(Value::as_i64)
            .unwrap_or(0);
        if seconds <= 0 || !used.is_finite() {
            continue;
        }
        let label = if seconds >= 604800 {
            "Weekly limit"
        } else if seconds == 18000 {
            "Five-hour limit"
        } else {
            "Usage limit"
        };
        let reset = v
            .get("reset_at")
            .and_then(Value::as_i64)
            .and_then(|s| chrono::DateTime::from_timestamp(s, 0))
            .map(|t| t.to_rfc3339());
        out.push(UsageWindow {
            id: format!("{model}:{key}"),
            label: if model.is_empty() {
                label.into()
            } else {
                format!("{model} · {label}")
            },
            used_percent: used.clamp(0., 100.),
            limit_window_seconds: Some(seconds),
            resets_at: reset,
            model: (!model.is_empty()).then(|| model.to_string()),
        });
    }
}
